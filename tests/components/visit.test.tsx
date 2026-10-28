import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import VisitPage from '../../app/visit';
import { useRecords } from '../../src/state';
import { saveVisit, setSetting } from '../../src/db';
import { selfMember } from '../../src/domain/members';
import { parseVisitPage } from '../../src/parser/visit';
import { visitFixture } from '../fixtures/visit-layout';
import { sourcePreview } from '../../src/services/source-preview';
import type { DocumentRecord, Report, Visit } from '../../src/domain/types';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({ id: 'v' })),
}));
jest.mock('../../src/state', () => ({ useRecords: jest.fn() }));
jest.mock('../../src/db', () => ({
  saveVisit: jest.fn(),
  setSetting: jest.fn(),
  removeVisit: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'manual-visit' }));
jest.mock('../../src/services/source-preview', () => ({ sourcePreview: jest.fn() }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const original = parseVisitPage(visitFixture())!;
const visit: Visit = {
  id: 'v',
  memberId: 'self',
  title: '呼吸内科就诊',
  hospital: '示例医院',
  department: '呼吸内科',
  date: '2026-10-23',
  note: '',
  status: 'review',
  patient: '测试甲',
  original,
  sections: Object.fromEntries(
    Object.entries(original.sections).map(([key, value]) => [key, value.text]),
  ),
  reportIds: [],
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'v' });
  jest.mocked(saveVisit).mockResolvedValue();
  jest.mocked(setSetting).mockResolvedValue();
  jest.mocked(useRecords).mockReturnValue({
    activeMember: selfMember,
    members: [selfMember],
    reportCounts: {},
    reports: [],
    documents: [],
    visits: [visit],
    loading: false,
    importing: false,
    error: '',
    refresh: jest.fn(async () => {}),
    selectMember: jest.fn(),
  });
});
test('main paragraphs appear immediately; secondary content stays folded and no per-field check is required', async () => {
  const screen = render(<VisitPage />);
  await act(async () => {});
  expect(screen.getByText('咳嗽 3 天。')).toBeTruthy();
  expect(screen.queryByText('无特殊。')).toBeNull();
  fireEvent.press(screen.getByTestId('visit-more'));
  expect(screen.getByText('无特殊。')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit'));
  });
  expect(saveVisit).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'confirmed', original, reportIds: [] }),
  );
  expect(setSetting).toHaveBeenCalledWith('record-view:self', 'visits');
  expect(screen.getByText('已确认')).toBeTruthy();
  expect(screen.queryByTestId('save-visit')).toBeNull();
  expect(router.replace).not.toHaveBeenCalled();
});
test('editing a paragraph keeps OCR original unchanged', async () => {
  const screen = render(<VisitPage />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('edit-chief'));
  fireEvent.changeText(screen.getByTestId('visit-chief'), '咳嗽 4 天。');
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit'));
  });
  const saved = jest.mocked(saveVisit).mock.calls[0]![0];
  expect(saved.sections?.chief).toBe('咳嗽 4 天。');
  expect(saved.original?.sections.chief?.text).toBe('咳嗽 3 天。');
});
test('identity mismatch blocks confirmation until the user acknowledges it', async () => {
  const state = jest.mocked(useRecords)();
  jest
    .mocked(useRecords)
    .mockReturnValue({ ...state, activeMember: { ...selfMember, name: '乙' } });
  const screen = render(<VisitPage />);
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit'));
  });
  expect(saveVisit).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('visit-identity'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit'));
  });
  expect(saveVisit).toHaveBeenCalledWith(
    expect.objectContaining({ identityConfirmation: { memberName: '乙', patient: '测试甲' } }),
  );
});
test('missing date can be saved as draft without inventing today as the visit date', async () => {
  const state = jest.mocked(useRecords)();
  jest.mocked(useRecords).mockReturnValue({ ...state, visits: [{ ...visit, date: '' }] });
  const screen = render(<VisitPage />);
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit'));
  });
  expect(saveVisit).not.toHaveBeenCalled();
  expect(screen.getByText('删除就诊记录')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByText('暂存，稍后补充'));
  });
  expect(saveVisit).toHaveBeenCalledWith(expect.objectContaining({ date: '', status: 'review' }));
});
test('legacy manual entry remains available', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  const screen = render(<VisitPage />);
  await act(async () => {});
  fireEvent.changeText(screen.getByTestId('visit-title'), '门诊复查');
  fireEvent.changeText(screen.getByTestId('visit-date'), '2026-10-22');
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit'));
  });
  expect(saveVisit).toHaveBeenCalledWith(
    expect.objectContaining({ title: '门诊复查', date: '2026-10-22', memberId: 'self' }),
  );
  expect(router.replace).toHaveBeenCalledWith('/visit?id=manual-visit');
});

const document: DocumentRecord = {
  id: 'document',
  memberId: 'self',
  hash: 'synthetic',
  uri: 'file:///synthetic.pdf',
  fileName: '合成病历.pdf',
  pageCount: 3,
  state: 'ready',
  error: null,
  createdAt: '2026-10-23',
};
const report: Report = {
  id: 'blood',
  memberId: 'self',
  documentId: 'lab-document',
  title: '血常规',
  date: '2026-10-22',
  dateKind: 'sample',
  status: 'confirmed',
  template: null,
  patient: '测试甲',
  warnings: [],
  observations: [],
  createdAt: '2026-10-23',
};
function reading(overrides: Partial<Visit> = {}) {
  const state = jest.mocked(useRecords)();
  const saved = {
    ...visit,
    documentId: document.id,
    sourcePage: 1,
    status: 'confirmed' as const,
    note: '我的原始备注',
    reportIds: ['blood'],
    ...overrides,
  };
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    visits: [saved],
    documents: [document],
    reports: [report, { ...report, id: 'other-member', memberId: 'mom', title: '其他成员的检验' }],
  });
  return saved;
}
test('confirmed reading has one whole-original entry and never loads per-section crops, even when expanded', async () => {
  reading();
  const screen = render(<VisitPage />);
  await act(async () => {});
  expect(screen.getByText('呼吸内科就诊')).toBeTruthy();
  expect(screen.getByText('已确认')).toBeTruthy();
  expect(screen.queryByText('查看原文')).toBeNull();
  expect(screen.queryByTestId('source-toggle-0')).toBeNull();
  fireEvent.press(screen.getByTestId('visit-more'));
  expect(screen.getByText('无特殊。')).toBeTruthy();
  expect(screen.queryByText('查看原文')).toBeNull();
  expect(screen.queryByText('查看识别原文')).toBeNull();
  expect(sourcePreview).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('visit-original'));
  expect(router.push).toHaveBeenCalledWith('/pdf/document?page=1');
  fireEvent.press(screen.getByTestId('visit-link-blood'));
  expect(router.push).toHaveBeenCalledWith('/report/blood');
});
test('confirmed records can re-enter review, preserve original OCR and return to reading after saving', async () => {
  reading();
  const screen = render(<VisitPage />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('edit-visit'));
  expect(screen.getByTestId('source-toggle-0')).toBeTruthy();
  fireEvent.press(screen.getByTestId('edit-chief'));
  fireEvent.changeText(screen.getByTestId('visit-chief'), '咳嗽 4 天。');
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit'));
  });
  expect(saveVisit).toHaveBeenCalledWith(
    expect.objectContaining({
      original,
      sections: expect.objectContaining({ chief: '咳嗽 4 天。' }),
    }),
  );
  expect(screen.getByText('咳嗽 4 天。')).toBeTruthy();
  expect(screen.queryByTestId('source-toggle-0')).toBeNull();
  expect(screen.queryByTestId('save-visit')).toBeNull();
});
test('examination typography is shared by reading and review without changing edited or stored text', async () => {
  const exam = '血压:118/72mmHg, BMI:21.97,专科检查:原文描述\n各项评估:评分:0';
  const formatted = '血压：118/72 mmHg，BMI：21.97\n\n专科检查：原文描述\n\n各项评估：评分：0';
  reading({ sections: { ...visit.sections, exam } });
  const screen = render(<VisitPage />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('visit-more'));
  expect(screen.getByTestId('visit-reading-exam').props.children).toBe(formatted);
  fireEvent.press(screen.getByTestId('edit-visit'));
  fireEvent.press(screen.getByTestId('visit-more'));
  expect(screen.getByTestId('visit-reading-exam').props.children).toBe(formatted);
  fireEvent.press(screen.getByTestId('edit-exam'));
  expect(screen.getByTestId('visit-exam').props.value).toBe(exam);
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit'));
  });
  expect(saveVisit).toHaveBeenCalledWith(
    expect.objectContaining({
      original,
      sections: expect.objectContaining({ exam }),
    }),
  );
});
test('discarding a full edit restores saved values without writing to storage', async () => {
  reading();
  const screen = render(<VisitPage />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('edit-visit'));
  fireEvent.press(screen.getByTestId('edit-chief'));
  fireEvent.changeText(screen.getByTestId('visit-chief'), '未保存的修改');
  fireEvent.press(screen.getByText('‹ 返回'));
  act(() => {
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === '放弃修改')!.onPress!();
  });
  expect(screen.getByText('咳嗽 3 天。')).toBeTruthy();
  expect(screen.queryByText('未保存的修改')).toBeNull();
  expect(saveVisit).not.toHaveBeenCalled();
});
test('note edits stay private until save, survive a failed save, and preserve medical content and associations', async () => {
  const saved = reading();
  const screen = render(<VisitPage />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('edit-visit-note'));
  fireEvent.changeText(screen.getByTestId('visit-note-input'), '取消的内容');
  fireEvent.press(screen.getByLabelText('关闭编辑'));
  await waitFor(() => expect(screen.queryByTestId('visit-note-input')).toBeNull());
  expect(screen.getByText('我的原始备注')).toBeTruthy();
  expect(saveVisit).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('edit-visit-note'));
  expect(screen.getByTestId('visit-note-input').props.value).toBe('我的原始备注');
  fireEvent.changeText(screen.getByTestId('visit-note-input'), '新的备注');
  jest.mocked(saveVisit).mockRejectedValueOnce(new Error('本地保存失败'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit-details'));
  });
  expect(screen.getByText('本地保存失败')).toBeTruthy();
  expect(screen.getByTestId('visit-note-input').props.value).toBe('新的备注');
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit-details'));
  });
  expect(saveVisit).toHaveBeenLastCalledWith({ ...saved, note: '新的备注' });
  expect(screen.getByText('新的备注')).toBeTruthy();
  await waitFor(() => expect(screen.queryByTestId('visit-note-input')).toBeNull());
  // A delayed refresh must not roll a successful quick edit back when a later
  // full edit is discarded.
  fireEvent.press(screen.getByTestId('edit-visit'));
  fireEvent.press(screen.getByText('‹ 返回'));
  act(() => {
    jest
      .mocked(Alert.alert)
      .mock.calls.at(-1)![2]!
      .find((button) => button.text === '放弃修改')!.onPress!();
  });
  expect(screen.getByText('新的备注')).toBeTruthy();
});
test('report management only offers the current member and changes associations only on save', async () => {
  const saved = reading();
  const screen = render(<VisitPage />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('manage-visit-reports'));
  expect(screen.queryByText('其他成员的检验')).toBeNull();
  fireEvent.press(screen.getByTestId('visit-associate-blood'));
  expect(saveVisit).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('关闭编辑'));
  await waitFor(() => expect(screen.queryByTestId('visit-associate-blood')).toBeNull());
  expect(screen.getByTestId('visit-link-blood')).toBeTruthy();
  fireEvent.press(screen.getByTestId('manage-visit-reports'));
  expect(screen.getByTestId('visit-associate-blood').props.accessibilityState.checked).toBe(true);
  fireEvent.press(screen.getByTestId('visit-associate-blood'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit-details'));
  });
  expect(saveVisit).toHaveBeenLastCalledWith({ ...saved, reportIds: [] });
  await waitFor(() => expect(screen.queryByTestId('visit-associate-blood')).toBeNull());
  expect(screen.queryByTestId('visit-link-blood')).toBeNull();
  expect(screen.getByText('关联这次就诊的检验报告')).toBeTruthy();
});
test('legacy manual records have no invented confirmation or source, and missing paragraphs stay explicit', async () => {
  reading({ status: undefined, documentId: undefined, original: undefined, sections: undefined });
  const screen = render(<VisitPage />);
  await act(async () => {});
  expect(screen.queryByText('已确认')).toBeNull();
  expect(screen.queryByTestId('visit-original')).toBeNull();
  expect(screen.getAllByText('未记录')).toHaveLength(3);
  fireEvent.press(screen.getByTestId('edit-visit-note'));
  fireEvent.changeText(screen.getByTestId('visit-note-input'), '旧记录的新备注');
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-visit-details'));
  });
  expect(jest.mocked(saveVisit).mock.calls[0]![0].status).toBeUndefined();
  await waitFor(() => expect(screen.queryByTestId('visit-note-input')).toBeNull());
});
test('long medical text and printed line breaks remain complete in reading mode', async () => {
  const longPlan = '医生记载的原文内容。'.repeat(50) + '\n第二行完整内容。';
  reading({ sections: { ...visit.sections, plan: longPlan } });
  const screen = render(<VisitPage />);
  await act(async () => {});
  const text = screen.getByText(longPlan);
  expect(text.props.numberOfLines).toBeUndefined();
  expect(text.props.selectable).toBe(true);
});
