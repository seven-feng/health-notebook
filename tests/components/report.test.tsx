import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Modal, ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import ReportDetail from '../../app/report/[id]';
import { useRecords } from '../../src/state';
import { fillDocumentPatient, saveReport } from '../../src/db';
import type { Report } from '../../src/domain/types';
import { selfMember } from '../../src/domain/members';
import { reviewCopy } from '../../src/domain/review-messages';
import { reparseReport } from '../../src/services/import';
import { sourcePreview } from '../../src/services/source-preview';
jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(),
    dismissTo: jest.fn(),
  },
  useLocalSearchParams: () => ({ id: 'r' }),
}));
jest.mock('../../src/state', () => ({ useRecords: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'manual-observation') }));
jest.mock('../../src/db', () => ({
  saveReport: jest.fn(),
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  deleteReport: jest.fn(),
  fillDocumentPatient: jest.fn(),
}));
jest.mock('../../src/services/analytics', () => ({ track: jest.fn() }));
jest.mock('../../src/services/import', () => ({ reparseReport: jest.fn() }));
jest.mock('../../src/services/source-preview', () => ({ sourcePreview: jest.fn() }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const report: Report = {
  memberId: 'self',
  id: 'r',
  documentId: '',
  title: '合成报告',
  patient: 'SAMPLE',
  date: '2026-10-18',
  dateKind: 'sample',
  status: 'review',
  template: 'sample',
  warnings: [],
  createdAt: '2026-10-22T00:00:00Z',
  observations: [
    {
      id: 'o',
      name: 'ALT',
      code: 'sample:ALT',
      rawValue: '80',
      originalValue: '80',
      unit: 'U/L',
      reference: '0-40',
      specimen: 'serum',
      method: 'sample',
      page: 0,
    },
  ],
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(router.canGoBack).mockReturnValue(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(saveReport).mockResolvedValue();
  jest.mocked(useRecords).mockReturnValue({
    activeMember: selfMember,
    members: [selfMember],
    reportCounts: { self: 1 },
    selectMember: jest.fn(),
    reports: [report],
    documents: [],
    visits: [],
    loading: false,
    importing: false,
    error: '',
    refresh: jest.fn(async () => {}),
  });
});
afterEach(() => jest.restoreAllMocks());
test.each([true, false])(
  'report back follows history when available (%s), otherwise opens records',
  (hasHistory) => {
    jest.mocked(router.canGoBack).mockReturnValue(hasHistory);
    const screen = render(<ReportDetail />);
    fireEvent.press(screen.getByTestId('record-back'));
    if (hasHistory) {
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(router.replace).not.toHaveBeenCalled();
    } else {
      expect(router.replace).toHaveBeenCalledWith('/');
      expect(router.back).not.toHaveBeenCalled();
    }
    expect(saveReport).not.toHaveBeenCalled();
  },
);
test('confirming a multi-page section returns to the existing overview instead of stacking another copy', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [{ ...report, documentId: 'd' }],
    documents: [{ id: 'd', pageCount: 3, uri: 'file:///report.pdf' } as never],
  });
  const screen = render(<ReportDetail />);
  await act(async () => fireEvent.press(screen.getByTestId('review-action')));
  expect(saveReport).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
  expect(router.dismissTo).toHaveBeenCalledWith('/document/d');
  expect(router.replace).not.toHaveBeenCalled();
});
test.each([1, 3])(
  'confirmation keeps the review visible until its single return navigation (%i document pages)',
  async (pageCount) => {
    const original = groupedReport(12);
    const state = jest.mocked(useRecords).getMockImplementation()!();
    let refreshed!: () => void;
    const refresh = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          refreshed = resolve;
        }),
    );
    const currentState = {
      ...state,
      reports: [{ ...original, documentId: 'd' }],
      documents: [{ id: 'd', pageCount, uri: 'file:///report.pdf' } as never],
      refresh,
    };
    jest.mocked(useRecords).mockReturnValue(currentState);
    const screen = render(<ReportDetail />);
    fireEvent.press(screen.getByTestId('next-group'));
    await act(async () => fireEvent.press(screen.getByTestId('review-action')));
    expect(saveReport).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('核对报告')).toBeTruthy();
    expect(screen.queryByText('报告详情')).toBeNull();
    expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 2 / 3 组');
    expect(screen.getByTestId('review-action')).toBeDisabled();
    expect(router.dismissTo).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    // Context receives the saved result while the outgoing native screen is still mounted.
    jest.mocked(useRecords).mockReturnValue({
      ...currentState,
      reports: [jest.mocked(saveReport).mock.calls[0]![0]],
    });
    screen.rerender(<ReportDetail />);
    await act(async () => refreshed());
    expect(screen.getByText('核对报告')).toBeTruthy();
    expect(screen.queryByText('报告详情')).toBeNull();
    expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 2 / 3 组');
    expect(screen.getByTestId('review-action')).toBeDisabled();
    expect(screen.getByTestId('record-back')).toBeDisabled();
    fireEvent.press(screen.getByTestId('review-action'));
    expect(saveReport).toHaveBeenCalledTimes(1);
    if (pageCount > 1) {
      expect(router.dismissTo).toHaveBeenCalledTimes(1);
      expect(router.dismissTo).toHaveBeenCalledWith('/document/d');
      expect(router.replace).not.toHaveBeenCalled();
    } else {
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith('/');
      expect(router.dismissTo).not.toHaveBeenCalled();
    }
  },
);

test('saving a draft still opens the report details locally and allows editing again', async () => {
  const screen = render(<ReportDetail />);
  await act(async () => fireEvent.press(screen.getByTestId('save-draft')));
  expect(saveReport).toHaveBeenCalledWith(expect.objectContaining({ status: 'review' }));
  expect(screen.getByText('报告详情')).toBeTruthy();
  expect(screen.getByTestId('edit-report')).toBeEnabled();
  expect(screen.getByTestId('record-back')).toBeEnabled();
  expect(router.dismissTo).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('edit-report'));
  expect(screen.getByText('核对报告')).toBeTruthy();
  expect(screen.getByTestId('review-action')).toBeEnabled();
});

test('bulk name fill preserves unsaved result edits and does not save or confirm the report', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  const missing = { ...report, documentId: 'd', patient: '' };
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [missing, { ...missing, id: 'sibling', observations: [] }],
    documents: [{ id: 'd', pageCount: 3, uri: 'file:///report.pdf' } as never],
  });
  jest.mocked(fillDocumentPatient).mockResolvedValue(['r', 'sibling']);
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  fireEvent.changeText(screen.getByTestId('value-0'), '75');
  fireEvent.press(screen.getByTestId('open-document-patient'));
  fireEvent.changeText(screen.getByTestId('document-patient-input'), '测试甲');
  await act(async () => fireEvent.press(screen.getByTestId('fill-document-patient')));
  expect(screen.getByTestId('patient-input').props.value).toBe('测试甲');
  expect(screen.getByTestId('value-0').props.value).toBe('75');
  expect(saveReport).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
});
test('a bulk name arriving from the overview preserves edits and does not replace a typed patient', () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  const missing = { ...report, patient: '' };
  jest.mocked(useRecords).mockReturnValue({ ...state, reports: [missing] });
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  fireEvent.changeText(screen.getByTestId('value-0'), '75');
  jest
    .mocked(useRecords)
    .mockReturnValue({ ...state, reports: [{ ...missing, patient: '统一姓名' }] });
  screen.rerender(<ReportDetail />);
  expect(screen.getByTestId('patient-input').props.value).toBe('统一姓名');
  expect(screen.getByTestId('value-0').props.value).toBe('75');
  fireEvent.changeText(screen.getByTestId('patient-input'), '手动姓名');
  jest
    .mocked(useRecords)
    .mockReturnValue({ ...state, reports: [{ ...missing, patient: '外部更新' }] });
  screen.rerender(<ReportDetail />);
  expect(screen.getByTestId('patient-input').props.value).toBe('手动姓名');
  expect(saveReport).not.toHaveBeenCalled();
});
test('thumbnail opens a gesture viewer and closing it preserves the unconfirmed draft', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    documents: [{ id: 'd', uri: 'file:///report.pdf', pageCount: 1 } as never],
    reports: [
      {
        ...report,
        documentId: 'd',
        observations: [
          {
            ...report.observations[0]!,
            sourceRect: { x: 0.1, y: 0.2, width: 0.8, height: 0.03 },
            needsReview: true,
            warnings: ['请核对'],
          },
        ],
      },
    ],
  });
  jest
    .mocked(sourcePreview)
    .mockResolvedValue({ uri: 'file:///preview.png', width: 1000, height: 45 });
  const screen = render(<ReportDetail />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  await act(async () => {});
  expect(screen.getByTestId('source-thumbnail-0')).toBeTruthy();
  expect(screen.queryByTestId('source-image-0')).toBeNull();
  fireEvent.changeText(screen.getByTestId('value-0'), '75');
  fireEvent.press(screen.getByTestId('source-toggle-0'));
  fireEvent(screen.getByTestId('source-image-0'), 'layout', {
    nativeEvent: { layout: { width: 280 } },
  });
  await act(async () => {
    fireGestureHandler(getByGestureTestId('source-pinch-0'), [
      { state: State.BEGAN, scale: 1, focalX: 140, focalY: 60 },
      { state: State.ACTIVE, scale: 1, focalX: 140, focalY: 60 },
      { state: State.ACTIVE, scale: 3, focalX: 140, focalY: 60 },
      { state: State.END, scale: 3 },
    ]);
  });
  expect(screen.getByTestId('source-image-0').props.accessibilityValue.now).toBe(300);
  expect(screen.UNSAFE_getByType(Modal)).toBeTruthy();
  expect(screen.queryByTestId('source-zoom-in')).toBeNull();
  expect(router.push).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('close-source-preview'));
  expect(screen.queryByTestId('source-image-0')).toBeNull();
  fireEvent.press(screen.getByTestId('source-toggle-0'));
  await act(async () => {});
  expect(screen.getByTestId('source-image-0').props.accessibilityValue.now).toBe(100);
  fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  expect(screen.queryByTestId('source-image-0')).toBeNull();
  expect(sourcePreview).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('value-0').props.value).toBe('75');
  expect(screen.getByTestId('review-item-0')).toBeTruthy();
  expect(saveReport).not.toHaveBeenCalled();
});
test('zero is visible and is persisted as zero when a report is confirmed', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [
      {
        ...report,
        observations: [{ ...report.observations[0]!, rawValue: '0', originalValue: '0' }],
      },
    ],
  });
  const screen = render(<ReportDetail />);
  expect(screen.getByTestId('observation-value-0').props.children).toContain('0');
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  expect(screen.getByTestId('value-0').props.value).toBe('0');
  fireEvent.press(screen.getByTestId('review-item-0'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).toHaveBeenCalledWith(
    expect.objectContaining({
      observations: [expect.objectContaining({ rawValue: '0', originalValue: '0' })],
    }),
  );
});
test.each(['review', 'confirmed'] as const)(
  'the printed arrow remains labelled as report provenance in %s',
  async (status) => {
    const state = jest.mocked(useRecords).getMockImplementation()!();
    jest.mocked(useRecords).mockReturnValue({
      ...state,
      reports: [
        { ...report, status, observations: [{ ...report.observations[0]!, reportFlag: 'high' }] },
      ],
    });
    const screen = render(<ReportDetail />);
    expect(screen.queryByTestId('value-0')).toBeNull();
    fireEvent.press(screen.getByTestId('observation-toggle-0'));
    expect(screen.getByText('原报告标记：↑ 高于参考范围')).toBeTruthy();
    if (status === 'confirmed') fireEvent.press(screen.getByTestId('edit-report'));
    fireEvent.changeText(screen.getByTestId('value-0'), '35');
    fireEvent.press(screen.getByTestId('review-item-0'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('review-action'));
    });
    expect(saveReport).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: [expect.objectContaining({ rawValue: '35', reportFlag: 'high' })],
      }),
    );
  },
);
test('confirming a correction saves the new value and retains the extracted value', async () => {
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  fireEvent.changeText(screen.getByTestId('value-0'), '75');
  fireEvent.press(screen.getByTestId('review-item-0'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'confirmed',
      observations: [expect.objectContaining({ rawValue: '75', originalValue: '80' })],
    }),
  );
});
test('a missing patient cannot be confirmed', async () => {
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('edit-metadata'));
  fireEvent.changeText(screen.getByTestId('patient-input'), '');
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('确认归属', expect.any(String));
});
test('a conflicting patient cannot enter the confirmed records', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest
    .mocked(useRecords)
    .mockReturnValue({ ...state, activeMember: { ...selfMember, name: 'PERSON-A' } });
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('edit-metadata'));
  fireEvent.changeText(screen.getByTestId('patient-input'), 'PERSON-B');
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('患者不一致', expect.any(String));
});
test('reparse results stay in the draft and can be discarded without saving', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest
    .mocked(useRecords)
    .mockReturnValue({ ...state, documents: [{ id: '', uri: 'file:///report.pdf' } as never] });
  jest.mocked(reparseReport).mockResolvedValue({
    ...report,
    observations: [{ ...report.observations[0]!, rawValue: '55' }],
  });
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('reparse-report'));
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(async () => {
    buttons?.[1]?.onPress?.();
  });
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  expect(screen.getByTestId('value-0').props.value).toBe('55');
  expect(saveReport).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('discard-reparse'));
  expect(screen.queryByTestId('value-0')).toBeNull();
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  expect(screen.getByTestId('value-0').props.value).toBe('80');
  expect(saveReport).not.toHaveBeenCalled();
});
test('uncertain OCR fields require an explicit check before confirmation', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [
      {
        ...report,
        observations: [
          {
            ...report.observations[0]!,
            needsReview: true,
            warnings: [
              '此生化报告版式为首次适配，请逐项对照原图确认数值、标记和参考区间。',
              '两次识别的单位不一致，请核对。',
              '单位识别为“f1”，按模板暂列 fL，请对照原件核对。',
            ],
          },
        ],
      },
    ],
  });
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('review-action'));
  expect(screen.getByTestId('value-0')).toBeTruthy();
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  expect(screen.getAllByText('请对照原报告，确认本项的数值、单位和参考范围。')).toHaveLength(1);
  expect(screen.queryByText(/首次适配|按模板|两次识别/)).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('review-item-0'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
});

function mixedReport() {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  const observations = Array.from({ length: 5 }, (_, i) => ({
    ...report.observations[0]!,
    id: `item-${i}`,
    name: `项目 ${i + 1}`,
    rawValue: `${i * 10}`,
    needsReview: i === 1 || i === 4,
    // A needsReview flag must remain actionable even without a warning string.
    warnings: i === 1 ? ['请检查单位'] : [],
    sourceRect: { x: 0.1, y: 0.1 + i * 0.1, width: 0.8, height: 0.03 },
  }));
  jest
    .mocked(sourcePreview)
    .mockResolvedValue({ uri: 'file:///sample.png', width: 1000, height: 50 });
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    documents: [{ id: 'd', uri: 'file:///sample.pdf', pageCount: 1 } as never],
    reports: [{ ...report, documentId: 'd', observations }],
  });
}

test('a group shows five compact rows and one combined original crop', async () => {
  mixedReport();
  const screen = render(<ReportDetail />);
  await act(async () => {});
  const rows = screen.getAllByTestId(/^observation-toggle-/);
  expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
    '第 1 项，项目 1，0 U/L',
    '第 2 项，项目 2，10 U/L，待核对',
    '第 3 项，项目 3，20 U/L',
    '第 4 项，项目 4，30 U/L',
    '第 5 项，项目 5，40 U/L，待核对',
  ]);
  expect(rows.map((row) => row.props.accessibilityState.expanded)).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 2 项');
  expect(screen.queryByTestId('value-0')).toBeNull();
  expect(sourcePreview).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('review-item-4')).toBeNull();
});

test('collapsing preserves edits and never acknowledges or saves an uncertain value', async () => {
  mixedReport();
  const screen = render(<ReportDetail />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('observation-toggle-1'));
  fireEvent.changeText(screen.getByTestId('value-1'), '12');
  fireEvent.press(screen.getByTestId('collapse-item-1'));
  expect(screen.queryByTestId('value-1')).toBeNull();
  expect(screen.getByTestId('observation-value-1').props.children).toContain('12');
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 2 项');
  fireEvent.press(screen.getByTestId('observation-toggle-1'));
  await act(async () => {});
  expect(screen.getByTestId('value-1').props.value).toBe('12');
  expect(saveReport).not.toHaveBeenCalled();
});

test('inline checks resolve issues without expanding rows or confirming ordinary values', async () => {
  mixedReport();
  const screen = render(<ReportDetail />);
  await act(async () => {});
  expect(screen.queryByTestId('review-checkbox-0')).toBeNull();
  expect(screen.getByRole('checkbox', { name: '项目 2已核对' })).not.toBeChecked();
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  expect(screen.queryByTestId('value-1')).toBeNull();
  expect(screen.queryByTestId('value-4')).toBeNull();
  expect(saveReport).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('review-checkbox-1'));
  expect(screen.getByTestId('review-checkbox-1')).toBeChecked();
  expect(screen.queryByTestId('value-1')).toBeNull();
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 1 项');
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  fireEvent.press(screen.getByTestId('review-checkbox-4'));
  expect(screen.getByTestId('review-checkbox-4')).toBeChecked();
  expect(screen.queryByTestId('value-4')).toBeNull();
  expect(screen.getByTestId('review-action')).toBeEnabled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'confirmed',
      observations: expect.arrayContaining([
        expect.objectContaining({ id: 'item-4', reviewed: true, needsReview: false }),
      ]),
    }),
  );
});

test('unchecking restores an issue and the draft retains that decision', async () => {
  mixedReport();
  const screen = render(<ReportDetail />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('review-checkbox-1'));
  fireEvent.press(screen.getByTestId('review-checkbox-4'));
  fireEvent.press(screen.getByTestId('review-checkbox-1'));
  expect(screen.getByTestId('review-checkbox-1')).not.toBeChecked();
  expect(screen.getByTestId('review-checkbox-4')).toBeChecked();
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  expect(screen.queryByTestId('value-1')).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId('save-draft')));
  const draft = jest.mocked(saveReport).mock.calls[0]![0];
  expect(draft.status).toBe('review');
  expect(draft.observations[1]).toMatchObject({
    needsReview: true,
    reviewed: false,
    rawValue: '10',
  });
  expect(draft.observations[4]).toMatchObject({ needsReview: false, reviewed: true });
  expect(draft.observations[0]!.reviewed).toBeUndefined();
  const state = jest.mocked(useRecords).getMockImplementation()!();
  screen.unmount();
  jest.mocked(useRecords).mockReturnValue({ ...state, reports: [draft] });
  const resumed = render(<ReportDetail />);
  await act(async () => {});
  expect(resumed.getByTestId('review-checkbox-1')).not.toBeChecked();
  expect(resumed.getByTestId('review-checkbox-4')).toBeChecked();
});

test('inline confirmation accepts zero but editing it revokes confirmation and rejects empty results', async () => {
  mixedReport();
  const screen = render(<ReportDetail />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('observation-toggle-1'));
  fireEvent.changeText(screen.getByTestId('value-1'), '0');
  fireEvent.press(screen.getByTestId('collapse-item-1'));
  fireEvent.press(screen.getByTestId('review-checkbox-1'));
  expect(screen.getByTestId('review-checkbox-1')).toBeChecked();
  fireEvent.press(screen.getByTestId('observation-toggle-1'));
  expect(screen.getByTestId('review-checkbox-1')).toBeChecked();
  fireEvent.changeText(screen.getByTestId('value-1'), '');
  expect(screen.getByTestId('review-checkbox-1')).not.toBeChecked();
  expect(screen.getByTestId('review-checkbox-1')).toBeDisabled();
  fireEvent.press(screen.getByTestId('review-checkbox-1'));
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  fireEvent.changeText(screen.getByTestId('value-1'), '0');
  fireEvent.press(screen.getByTestId('review-checkbox-1'));
  expect(screen.queryByTestId('value-1')).toBeNull();
  expect(screen.getByTestId('review-checkbox-1')).toBeChecked();
  expect(screen.getByTestId('observation-value-1').props.children).toContain('0');
});

test('removing an earlier row keeps the later edit and expansion attached to its observation id', async () => {
  mixedReport();
  const screen = render(<ReportDetail />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('observation-toggle-2'));
  fireEvent.changeText(screen.getByTestId('value-2'), '25');
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  fireEvent.press(screen.getByTestId('remove-item-0'));
  await act(async () => {});
  expect(screen.getByTestId('name-1').props.value).toBe('项目 3');
  expect(screen.getByTestId('value-1').props.value).toBe('25');
  expect(screen.getByTestId('observation-toggle-2').props.accessibilityState.expanded).toBe(false);
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 3 项');
});

test('adding a manual item immediately opens its fields while other rows stay compact', () => {
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('add-observation'));
  expect(screen.getByTestId('name-1').props.value).toBe('');
  expect(screen.getByTestId('value-1').props.value).toBe('');
  expect(screen.queryByTestId('value-0')).toBeNull();
});

function groupedReport(count = 12) {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  const next = {
    ...report,
    observations: Array.from({ length: count }, (_, i) => ({
      ...report.observations[0]!,
      id: `group-${i}`,
      name: `项目 ${i + 1}`,
      needsReview: true,
      warnings: [reviewCopy.item],
    })),
  };
  jest.mocked(useRecords).mockReturnValue({ ...state, reports: [next] });
  return next;
}

test('the fixed action saves all ordinary items from the first group, including unseen zero values', async () => {
  const original = groupedReport(12);
  const state = jest.mocked(useRecords).getMockImplementation()!();
  const observations = original.observations.map((o, i) =>
    i === 11 ? { ...o, rawValue: '0', originalValue: '0' } : o,
  );
  jest
    .mocked(useRecords)
    .mockReturnValue({ ...state, reports: [{ ...original, date: '', observations }] });
  const screen = render(<ReportDetail />);
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 1 / 3 组');
  expect(screen.getByTestId('review-action-hint').props.children).toBe('将保存全部 12 项结果');
  expect(screen.getAllByRole('button', { name: '完成核对' })).toHaveLength(1);
  expect(screen.queryByTestId('observation-toggle-11')).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId('review-action')));
  expect(saveReport).toHaveBeenCalledTimes(1);
  const saved = jest.mocked(saveReport).mock.calls[0]![0];
  expect(saved.status).toBe('confirmed');
  expect(saved.date).toBe('');
  expect(saved.observations).toEqual(
    observations.map((o) => ({ ...o, reviewed: true, needsReview: false })),
  );
});

test('resolving the last issue enables saving immediately without visiting remaining ordinary groups', async () => {
  const original = groupedReport(12);
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [
      {
        ...original,
        observations: original.observations.map((o, i) =>
          i === 0 ? { ...o, warnings: [reviewCopy.value] } : o,
        ),
      },
    ],
  });
  const screen = render(<ReportDetail />);
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  fireEvent.press(screen.getByTestId('review-checkbox-0'));
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 1 / 3 组');
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('完成核对');
  expect(saveReport).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByTestId('review-action')));
  expect(jest.mocked(saveReport).mock.calls[0]![0].observations).toHaveLength(12);
});

test('issues outside the visible group prevent fast confirmation', () => {
  const original = groupedReport(12);
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [
      {
        ...original,
        observations: original.observations.map((o, i) =>
          i === 11 ? { ...o, warnings: [reviewCopy.value] } : o,
        ),
      },
    ],
  });
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('previous-group'));
  fireEvent.press(screen.getByTestId('previous-group'));
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 1 / 3 组');
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  fireEvent.press(screen.getByTestId('review-action'));
  expect(saveReport).not.toHaveBeenCalled();
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 3 / 3 组');
  expect(screen.getByTestId('value-11')).toBeTruthy();
});

test('edited and empty values switch the footer back to resolving issues', () => {
  groupedReport(12);
  const screen = render(<ReportDetail />);
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('完成核对');
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  fireEvent.changeText(screen.getByTestId('value-0'), '75');
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  fireEvent.press(screen.getByTestId('review-item-0'));
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('完成核对');
  fireEvent.press(screen.getByTestId('review-checkbox-0'));
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  fireEvent.changeText(screen.getByTestId('value-0'), '');
  fireEvent.press(screen.getByTestId('review-item-0'));
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  expect(saveReport).not.toHaveBeenCalled();
});

test('fast confirmation validates an entered date and opens report information', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest
    .mocked(useRecords)
    .mockReturnValue({ ...state, reports: [{ ...report, date: '2026-02-30' }] });
  const screen = render(<ReportDetail />);
  expect(screen.queryByTestId('date-input')).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId('review-action')));
  expect(screen.getByTestId('date-input')).toBeTruthy();
  expect(Alert.alert).toHaveBeenCalledWith('检查日期', expect.any(String));
  expect(saveReport).not.toHaveBeenCalled();
});

test('repeated footer confirmation starts only one in-flight write', async () => {
  groupedReport(12);
  let finish!: () => void;
  jest.mocked(saveReport).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = render(<ReportDetail />);
  act(() => {
    fireEvent.press(screen.getByTestId('review-action'));
    fireEvent.press(screen.getByTestId('review-action'));
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(router.replace).toHaveBeenCalledTimes(1);
});

test('the footer stays steady during scrolling and confirmation cancels the pending group', async () => {
  const original = groupedReport(12);
  let finish!: () => void;
  jest.mocked(saveReport).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = render(<ReportDetail />);
  const scroll = screen.UNSAFE_getByType(ScrollView);
  const scrollEvent = (y: number) => ({
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: 1800 },
      layoutMeasurement: { width: 390, height: 600 },
    },
  });
  fireEvent(screen.getByTestId('review-group-start'), 'layout', {
    nativeEvent: { layout: { y: 512, width: 342 } },
  });
  fireEvent.scroll(scroll, scrollEvent(900));
  const opacity = StyleSheet.flatten(screen.getByTestId('review-action').props.style).opacity ?? 1;
  fireEvent.press(screen.getByTestId('next-group'));
  expect(screen.getByTestId('next-group')).toBeDisabled();
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 1 / 3 组');
  expect(screen.getByTestId('review-action')).toBeEnabled();
  expect(StyleSheet.flatten(screen.getByTestId('review-action').props.style).opacity ?? 1).toBe(
    opacity,
  );
  act(() => {
    fireEvent.press(screen.getByTestId('review-action'));
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('review-action')).toBeDisabled();
  // The native animation may finish after saving has started.
  fireEvent(scroll, 'momentumScrollEnd', scrollEvent(500));
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 1 / 3 组');
  await act(async () => finish());
  expect(jest.mocked(saveReport).mock.calls[0]![0].observations).toEqual(
    original.observations.map((o) => ({ ...o, reviewed: true, needsReview: false })),
  );
  expect(router.replace).toHaveBeenCalledTimes(1);
});

test('the footer locates an issue during image preparation and ignores the late group preview', async () => {
  const original = groupedReport(6);
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [
      {
        ...original,
        documentId: 'd',
        observations: original.observations.map((o, i) => ({
          ...o,
          sourceRect: { x: 0.1, y: 0.1 + i * 0.1, width: 0.8, height: 0.03 },
          warnings: i === 0 ? [reviewCopy.value] : o.warnings,
        })),
      },
    ],
    documents: [{ id: 'd', uri: 'file:///report.pdf', pageCount: 1 } as never],
  });
  let ready!: (image: Awaited<ReturnType<typeof sourcePreview>>) => void;
  const preview = new Promise<Awaited<ReturnType<typeof sourcePreview>>>((resolve) => {
    ready = resolve;
  });
  jest.mocked(sourcePreview).mockReturnValue(preview);
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('next-group'));
  expect(screen.getByTestId('next-group')).toBeDisabled();
  expect(screen.getByTestId('review-action')).toBeEnabled();
  fireEvent.press(screen.getByTestId('review-action'));
  expect(screen.getByTestId('value-0')).toBeTruthy();
  await act(async () => ready({ uri: 'file:///crop.png', width: 800, height: 300 }));
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 1 / 2 组');
  expect(screen.getByTestId('value-0')).toBeTruthy();
  expect(screen.getByTestId('next-group')).toBeEnabled();
  expect(saveReport).not.toHaveBeenCalled();
});

test('failed fast saves keep the draft and allow retry without paging', async () => {
  const original = groupedReport(12);
  jest.mocked(saveReport).mockRejectedValueOnce(new Error('write failed'));
  const screen = render(<ReportDetail />);
  await act(async () => fireEvent.press(screen.getByTestId('review-action')));
  expect(Alert.alert).toHaveBeenCalledWith('保存失败', expect.any(String));
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.getByTestId('review-action')).toBeEnabled();
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 1 / 3 组');
  await act(async () => fireEvent.press(screen.getByTestId('review-action')));
  expect(saveReport).toHaveBeenCalledTimes(2);
  expect(jest.mocked(saveReport).mock.calls[1]![0].observations.map((o) => o.rawValue)).toEqual(
    original.observations.map((o) => o.rawValue),
  );
});

test('optional group browsing preserves edits before explicit confirmation', async () => {
  groupedReport();
  const screen = render(<ReportDetail />);
  expect(screen.getAllByTestId(/^observation-toggle-/)).toHaveLength(5);
  expect(screen.queryByTestId('observation-toggle-5')).toBeNull();
  fireEvent.press(screen.getByTestId('next-group'));
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 0 项');
  expect(screen.getByTestId('observation-toggle-5')).toBeTruthy();
  expect(saveReport).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('next-group'));
  expect(screen.getAllByTestId(/^observation-toggle-/)).toHaveLength(2);
  fireEvent.press(screen.getByTestId('observation-toggle-11'));
  fireEvent.changeText(screen.getByTestId('value-11'), '0');
  fireEvent.press(screen.getByTestId('review-item-11'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  const saved = jest.mocked(saveReport).mock.calls[0]![0];
  expect(saved.observations.every((o) => o.reviewed && !o.needsReview)).toBe(true);
  expect(saved.observations[11]).toMatchObject({ rawValue: '0', originalValue: '80' });
  expect(saved.status).toBe('confirmed');
});

test('paging cannot bypass an edited value; the footer locates and expands it', () => {
  groupedReport();
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  fireEvent.changeText(screen.getByTestId('value-0'), '12');
  fireEvent.press(screen.getByTestId('next-group'));
  fireEvent.press(screen.getByTestId('next-group'));
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  fireEvent.press(screen.getByTestId('review-action'));
  expect(screen.getByTestId('observation-toggle-0')).toBeTruthy();
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 1 项');
  expect(screen.getByTestId('value-0').props.value).toBe('12');
  expect(screen.getByTestId('observation-value-0').props.children).toContain('12');
  expect(screen.getByTestId('review-checkbox-0')).not.toBeChecked();
  expect(saveReport).not.toHaveBeenCalled();
});

test('saved drafts resume at the first remaining issue without requiring ordinary items to be checked', async () => {
  const initial = groupedReport(10);
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [
      {
        ...initial,
        observations: initial.observations.map((o, i) =>
          i === 0 || i === 5 ? { ...o, warnings: [reviewCopy.value] } : o,
        ),
      },
    ],
  });
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('review-checkbox-0'));
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 1 / 2 组');
  expect(screen.queryByTestId('observation-toggle-5')).toBeNull();
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  fireEvent.press(screen.getByTestId('review-action'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-draft'));
  });
  const saved = jest.mocked(saveReport).mock.calls[0]![0];
  expect(saved.status).toBe('review');
  expect(saved.observations[0]).toMatchObject({ reviewed: true, needsReview: false });
  expect(saved.observations.slice(1)).toEqual(
    initial.observations
      .slice(1)
      .map((o, i) => (i === 4 ? { ...o, warnings: [reviewCopy.value] } : o)),
  );
  screen.unmount();
  jest.mocked(useRecords).mockReturnValue({ ...state, reports: [saved] });
  const resumed = render(<ReportDetail />);
  expect(resumed.getByTestId('observation-toggle-5')).toBeTruthy();
  expect(resumed.queryByTestId('observation-toggle-0')).toBeNull();
  expect(resumed.getByTestId('review-count').props.children.join('')).toBe('待核对 1 项');
});

test('editing a confirmed result revokes its acknowledgement until checked again', async () => {
  const existing = groupedReport(5);
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [
      {
        ...existing,
        status: 'confirmed',
        observations: existing.observations.map((o) => ({
          ...o,
          needsReview: false,
          reviewed: true,
        })),
      },
    ],
  });
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('edit-report'));
  fireEvent.press(screen.getByTestId('observation-toggle-0'));
  fireEvent.changeText(screen.getByTestId('value-0'), '75');
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 1 项');
  fireEvent.press(screen.getByTestId('review-item-0'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(jest.mocked(saveReport).mock.calls[0]![0].observations[0]).toMatchObject({
    rawValue: '75',
    reviewed: true,
  });
});

test('a blank manual result cannot be confirmed individually or through the footer', async () => {
  const screen = render(<ReportDetail />);
  fireEvent.press(screen.getByTestId('add-observation'));
  fireEvent.press(screen.getByTestId('review-item-1'));
  expect(Alert.alert).toHaveBeenCalledWith('检查指标', expect.any(String));
  fireEvent.press(screen.getByTestId('review-action'));
  expect(saveReport).not.toHaveBeenCalled();
});

test('four resolved issues plus one ordinary result proceed without an extra confirmation', async () => {
  const initial = groupedReport(6);
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [
      {
        ...initial,
        observations: initial.observations.map((o, i) =>
          i === 4 ? o : { ...o, warnings: [reviewCopy.unit] },
        ),
      },
    ],
  });
  const screen = render(<ReportDetail />);
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 5 项');
  for (let i = 0; i < 4; i++) {
    fireEvent.press(screen.getByTestId(`review-checkbox-${i}`));
  }
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 1 项');
  expect(screen.getByTestId('observation-toggle-4').props.accessibilityLabel).not.toContain(
    '待核对',
  );
  expect(screen.queryByTestId('value-4')).toBeNull();
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  expect(saveReport).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('review-action'));
  expect(screen.getByTestId('observation-toggle-5')).toBeTruthy();
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('去核对');
  fireEvent.press(screen.getByTestId('review-action'));
  expect(saveReport).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('review-checkbox-5'));
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 0 项');
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('完成核对');
  expect(saveReport).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(jest.mocked(saveReport).mock.calls[0]![0]).toMatchObject({ status: 'confirmed' });
});

test('a report without recognition issues saves once without individual acknowledgements', async () => {
  const initial = groupedReport(3);
  const state = jest.mocked(useRecords).getMockImplementation()!();
  const observations = [
    initial.observations[0]!,
    { ...initial.observations[1]!, needsReview: false, warnings: [] },
    { ...initial.observations[2]!, warnings: ['此生化报告版式为首次适配，请逐项核对。'] },
  ];
  jest.mocked(useRecords).mockReturnValue({ ...state, reports: [{ ...initial, observations }] });
  const screen = render(<ReportDetail />);
  expect(screen.getByTestId('review-count').props.children.join('')).toBe('待核对 0 项');
  expect(screen.queryByTestId('review-item-0')).toBeNull();
  expect(screen.getByTestId('review-action').props.accessibilityLabel).toBe('完成核对');
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-draft'));
  });
  expect(jest.mocked(saveReport).mock.calls[0]![0].observations).toEqual(observations);
  fireEvent.press(screen.getByTestId('edit-report'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  const saved = jest.mocked(saveReport).mock.calls[1]![0];
  expect(saved.status).toBe('confirmed');
  expect(saved.observations.every((o) => o.reviewed && !o.needsReview)).toBe(true);
  expect(saved.observations.map((o) => o.rawValue)).toEqual(observations.map((o) => o.rawValue));
});

test('a name mismatch can be explicitly confirmed without changing member or printed name', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    activeMember: { ...selfMember, name: 'PERSON-A' },
    reports: [{ ...report, patient: 'PERSON-B' }],
  });
  const screen = render(<ReportDetail />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('confirm-member-identity'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-action'));
  });
  expect(saveReport).toHaveBeenCalledWith(
    expect.objectContaining({
      memberId: 'self',
      patient: 'PERSON-B',
      identityConfirmation: { memberName: 'PERSON-A', patient: 'PERSON-B' },
      status: 'confirmed',
    }),
  );
});

test('an inaccessible report does not expose the prior draft after a member change', async () => {
  const screen = render(<ReportDetail />);
  await act(async () => {});
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest
    .mocked(useRecords)
    .mockReturnValue({ ...state, activeMember: { ...selfMember, id: 'mom' }, reports: [] });
  screen.rerender(<ReportDetail />);
  expect(screen.getByText('当前成员没有这份报告。')).toBeTruthy();
  expect(screen.queryByText('合成报告')).toBeNull();
});

test('switching groups uses the prepared image at its measured width without a loading collapse', async () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  const original = {
    ...report,
    documentId: 'd',
    observations: Array.from({ length: 6 }, (_, i) => ({
      ...report.observations[0]!,
      id: `prepared-${i}`,
      sourceRect: { x: 0.1, y: 0.1 + i * 0.1, width: 0.8, height: 0.03 },
    })),
  };
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [original],
    documents: [{ id: 'd', uri: 'file:///report.pdf', pageCount: 1 } as never],
  });
  jest
    .mocked(sourcePreview)
    .mockResolvedValue({ uri: 'file:///crop.png', width: 800, height: 300 });
  const screen = render(<ReportDetail />);
  await act(async () => {});
  fireEvent(screen.getByTestId('review-group-start'), 'layout', {
    nativeEvent: { layout: { y: 0, width: 342 } },
  });
  expect(sourcePreview).toHaveBeenCalledTimes(2); // Current crop and its neighbour.
  await act(async () => fireEvent.press(screen.getByTestId('next-group')));
  expect(screen.getByTestId('review-group-count').props.children.join('')).toBe('第 2 / 2 组');
  expect(screen.getByTestId('source-thumbnail--2').props.style).toMatchObject({ height: 111.75 });
  expect(screen.queryByText('加载原文…')).toBeNull();
  expect(sourcePreview).toHaveBeenCalledTimes(3); // The previous group is now prepared too.
  expect(saveReport).not.toHaveBeenCalled();
  expect(original.observations).toHaveLength(6);
});

test('ultrasound report reads as full paragraphs and edits preserve the OCR original until explicit review and save', async () => {
  const { parseRecords } = require('../../src/parser/records');
  const { ultrasoundFixture } = require('../fixtures/ultrasound-layout');
  const parsed = parseRecords([ultrasoundFixture()]).reports[0];
  const imaging: Report = {
    ...report,
    ...parsed,
    status: 'confirmed',
    observations: parsed.observations.map((o: Report['observations'][number]) => ({
      ...o,
      needsReview: false,
    })),
  };
  jest.mocked(useRecords).mockReturnValue({ ...jest.mocked(useRecords)(), reports: [imaging] });
  const screen = render(<ReportDetail />);
  expect(screen.getByText(imaging.observations[2]!.rawValue)).toBeTruthy();
  expect(screen.getByText('报告原文')).toBeTruthy();
  expect(screen.queryByText('参考范围')).toBeNull();
  fireEvent.press(screen.getByTestId('edit-report'));
  fireEvent.press(screen.getByTestId('edit-metadata'));
  expect(screen.getByText('报告日期（不确定时留空）')).toBeTruthy();
  fireEvent.press(screen.getByTestId('observation-toggle-2'));
  expect(screen.getByTestId('value-2').props.multiline).toBe(true);
  expect(screen.queryByText('单位')).toBeNull();
  const original = imaging.observations[2]!.rawValue;
  fireEvent.changeText(screen.getByTestId('value-2'), '核对后的原文，0.23*0.41cm。');
  expect(saveReport).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('review-item-2'));
  await act(async () => fireEvent.press(screen.getByTestId('review-action')));
  expect(saveReport).toHaveBeenCalledTimes(1);
  const saved = jest.mocked(saveReport).mock.calls[0]![0];
  expect(saved.reportType).toBe('imaging');
  expect(saved.status).toBe('confirmed');
  expect(saved.observations[2]).toMatchObject({
    rawValue: '核对后的原文，0.23*0.41cm。',
    originalValue: original,
    resultKind: 'text',
  });
  expect(imaging.observations[2]!.rawValue).toBe(original);
});

test('undated imaging records do not claim to be missing from numeric trends', () => {
  const { MissingDateNotice } = require('../../src/components/MissingDateNotice');
  const screen = render(
    <MissingDateNotice
      reports={[{ ...report, reportType: 'imaging', date: '', status: 'confirmed' }]}
    />,
  );
  expect(screen.queryByText(/暂未计入趋势/)).toBeNull();
  screen.rerender(<MissingDateNotice reports={[{ ...report, date: '', status: 'confirmed' }]} />);
  expect(screen.getByText(/暂未计入趋势/)).toBeTruthy();
});
