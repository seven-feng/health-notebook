import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Animated } from 'react-native';
import { router } from 'expo-router';
import {
  deleteWholeDocument,
  getDocumentDeletionScope,
  type DocumentDeletionScope,
} from '../../src/db';
import DocumentDetail from '../../app/document/[id]';
import { useRecords } from '../../src/state';
import { reparseDocument, saveDocumentCandidate } from '../../src/services/import';
import { selfMember } from '../../src/domain/members';
import { parseDocument } from '../../src/parser/document';
import { sectionFixture } from '../fixtures/section-layout';
import type { DocumentRecord, Report } from '../../src/domain/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() },
  useLocalSearchParams: () => ({ id: 'd' }),
}));
jest.mock('../../src/state', () => ({ useRecords: jest.fn() }));
jest.mock('../../src/db', () => ({
  saveReport: jest.fn(),
  fillDocumentPatient: jest.fn(),
  getDocumentDeletionScope: jest.fn(),
  deleteWholeDocument: jest.fn(),
}));
jest.mock('../../src/services/import', () => ({
  reparseDocument: jest.fn(),
  saveDocumentCandidate: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const parsed = parseDocument(sectionFixture());
const doc: DocumentRecord = {
  id: 'd',
  memberId: 'self',
  hash: 'h',
  fileName: '合成报告.pdf',
  uri: 'file:///synthetic.pdf',
  pageCount: 3,
  state: 'ready',
  error: null,
  createdAt: '',
  parsing: parsed.parsing,
};
const reports: Report[] = parsed.reports.map((r, i) => ({
  ...r,
  id: `r${i}`,
  documentId: 'd',
  memberId: 'self',
  createdAt: '',
  dateKind: r.dateKind ?? 'unknown',
  status: 'review',
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(router.canGoBack).mockReturnValue(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: (callback) => callback?.({ finished: true }),
    stop: jest.fn(),
    reset: jest.fn(),
  }));
  jest.mocked(getDocumentDeletionScope).mockResolvedValue(deletionScope);
  jest.mocked(deleteWholeDocument).mockResolvedValue({ status: 'deleted', cleanupPending: false });
  jest.mocked(useRecords).mockReturnValue({
    activeMember: selfMember,
    members: [selfMember],
    reportCounts: { self: 2 },
    selectMember: jest.fn(),
    reports,
    documents: [doc],
    visits: [],
    loading: false,
    importing: false,
    error: '',
    refresh: jest.fn(async () => {}),
  });
  jest.mocked(reparseDocument).mockResolvedValue({
    document: doc,
    reports: reports.map((r) => ({ ...r, id: `new-${r.id}` })),
  });
  jest.mocked(saveDocumentCandidate).mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());
async function start(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getByTestId('reparse-document'));
  await act(async () => {
    jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1]!.onPress!();
  });
}
test.each([true, false])(
  'document back follows history when available (%s), otherwise opens records',
  (hasHistory) => {
    jest.mocked(router.canGoBack).mockReturnValue(hasHistory);
    const screen = render(<DocumentDetail />);
    fireEvent.press(screen.getByTestId('record-back'));
    if (hasHistory) {
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(router.replace).not.toHaveBeenCalled();
    } else {
      expect(router.replace).toHaveBeenCalledWith('/');
      expect(router.back).not.toHaveBeenCalled();
    }
    expect(saveDocumentCandidate).not.toHaveBeenCalled();
  },
);
test('document overview includes cross-page sections and unprocessed originals', () => {
  const screen = render(<DocumentDetail />);
  expect(screen.getByTestId('document-summary').props.children.join('')).toBe(
    '已整理 2 类检查 · 4 项结果',
  );
  expect(screen.getByText('合成检查')).toBeTruthy();
  fireEvent.press(screen.getByTestId('document-unprocessed'));
  expect(screen.getByText('第 3 页 · 尚未整理')).toBeTruthy();
});
test('whole-document candidate can be discarded; only explicit save writes separate sections', async () => {
  const screen = render(<DocumentDetail />);
  await start(screen);
  expect(saveDocumentCandidate).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('discard-document-candidate'));
  expect(saveDocumentCandidate).not.toHaveBeenCalled();
  expect(screen.queryByTestId('save-document-candidate')).toBeNull();
  await start(screen);
  await act(async () => fireEvent.press(screen.getByTestId('save-document-candidate')));
  expect(saveDocumentCandidate).toHaveBeenCalledTimes(1);
  expect(saveDocumentCandidate).toHaveBeenCalledWith(
    expect.objectContaining({
      reports: expect.arrayContaining([expect.objectContaining({ id: 'new-r0' })]),
    }),
  );
});
test('a failed candidate save stays available and keeps the existing section list', async () => {
  jest.mocked(saveDocumentCandidate).mockRejectedValue(new Error('保存失败'));
  const screen = render(<DocumentDetail />);
  await start(screen);
  await act(async () => fireEvent.press(screen.getByTestId('save-document-candidate')));
  expect(screen.getByTestId('save-document-candidate')).toBeTruthy();
  expect(screen.getByTestId('document-section-0')).toBeTruthy();
  expect(reports[0]!.id).toBe('r0');
});

const deletionScope: DocumentDeletionScope = {
  documentId: 'd',
  memberId: 'self',
  memberLabel: '我',
  fileName: '合成报告.pdf',
  sourceType: 'pdf',
  reportCount: 2,
  observationCount: 4,
  visitCount: 0,
  retainedVisitCount: 1,
  retainedReportCount: 0,
  token: 'scope-v1',
};
async function openDelete(screen: ReturnType<typeof render>) {
  await act(async () => fireEvent.press(screen.getByTestId('delete-document')));
}
test('whole deletion is available with sections; confirmation reads actual scope and cancellation writes nothing', async () => {
  const screen = render(<DocumentDetail />);
  expect(screen.getByText('删除整份报告')).toBeTruthy();
  await openDelete(screen);
  expect(getDocumentDeletionScope).toHaveBeenCalledWith('d', 'self');
  expect(screen.getByText('2 份 · 4 项结果')).toBeTruthy();
  expect(screen.getByText('1 次独立就诊记录保留，仅解除关联。')).toBeTruthy();
  expect(screen.getByTestId('delete-document-modal').props.animationType).toBe('none');
  fireEvent.press(screen.getByTestId('cancel-delete-document'));
  expect(screen.queryByTestId('confirm-delete-document')).toBeNull();
  expect(deleteWholeDocument).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
});
test.each(['delete-document-backdrop', 'system-back'])(
  '%s dismisses without deleting',
  async (method) => {
    const screen = render(<DocumentDetail />);
    await openDelete(screen);
    if (method === 'system-back')
      fireEvent(screen.getByTestId('delete-document-modal'), 'requestClose');
    else
      fireEvent.press(
        screen.getByTestId('delete-document-backdrop', { includeHiddenElements: true }),
      );
    expect(deleteWholeDocument).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-delete-document')).toBeNull();
  },
);

test('confirm runs once, refreshes records, returns to list and reports success', async () => {
  let finish!: (value: Awaited<ReturnType<typeof deleteWholeDocument>>) => void;
  jest.mocked(deleteWholeDocument).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = render(<DocumentDetail />);
  await openDelete(screen);
  const button = screen.getByTestId('confirm-delete-document');
  fireEvent.press(button);
  fireEvent.press(button);
  fireEvent.press(screen.getByTestId('cancel-delete-document'));
  expect(deleteWholeDocument).toHaveBeenCalledTimes(1);
  expect(screen.getByText('正在删除…')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
  await act(async () => finish({ status: 'deleted', cleanupPending: false }));
  expect(deleteWholeDocument).toHaveBeenCalledWith(deletionScope);
  expect(useRecords().refresh).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(Alert.alert).toHaveBeenCalledWith('已删除整份报告', '相关记录和本地原件已移除。');
});
test('new scope is shown and requires another deliberate confirm', async () => {
  const changed = { ...deletionScope, token: 'scope-v2', visitCount: 1, retainedReportCount: 1 };
  jest.mocked(deleteWholeDocument).mockResolvedValueOnce({ status: 'changed', scope: changed });
  const screen = render(<DocumentDetail />);
  await openDelete(screen);
  await act(async () => fireEvent.press(screen.getByTestId('confirm-delete-document')));
  expect(screen.getByText('删除整份资料？')).toBeTruthy();
  expect(screen.getByText('1 份其他文件的检验记录保留，仅解除关联。')).toBeTruthy();
  expect(screen.getByText('资料有更新，删除范围已重新列出。请核对后再次确认。')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByTestId('confirm-delete-document')));
  expect(deleteWholeDocument).toHaveBeenLastCalledWith(changed);
  expect(router.replace).toHaveBeenCalledWith('/');
});
test('deletion failure keeps the scope open and allows a safe retry', async () => {
  jest.mocked(deleteWholeDocument).mockRejectedValueOnce(new Error('删除未完成'));
  const screen = render(<DocumentDetail />);
  await openDelete(screen);
  await act(async () => fireEvent.press(screen.getByTestId('confirm-delete-document')));
  expect(screen.getByText('删除未完成')).toBeTruthy();
  expect(screen.getByTestId('document-section-0')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByTestId('confirm-delete-document')));
  expect(router.replace).toHaveBeenCalledWith('/');
});
test('cleanup failure is reported as records removed with file retry pending', async () => {
  jest
    .mocked(deleteWholeDocument)
    .mockResolvedValueOnce({ status: 'deleted', cleanupPending: true });
  const screen = render(<DocumentDetail />);
  await openDelete(screen);
  await act(async () => fireEvent.press(screen.getByTestId('confirm-delete-document')));
  expect(Alert.alert).toHaveBeenCalledWith(
    '已删除整份报告',
    expect.stringContaining('下次打开 App 会继续清理'),
  );
  expect(router.replace).toHaveBeenCalledWith('/');
});
test('unavailable scope never offers confirmation', async () => {
  jest.mocked(getDocumentDeletionScope).mockRejectedValueOnce(new Error('文件已被删除'));
  const screen = render(<DocumentDetail />);
  await openDelete(screen);
  expect(Alert.alert).toHaveBeenCalledWith('暂时无法删除', '文件已被删除');
  expect(screen.queryByTestId('confirm-delete-document')).toBeNull();
});
