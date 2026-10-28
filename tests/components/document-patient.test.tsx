import { act, fireEvent, render } from '@testing-library/react-native';
import { DocumentPatientFill } from '../../src/components/DocumentPatientFill';
import { fillDocumentPatient } from '../../src/db';
import { useRecords } from '../../src/state';
import { selfMember } from '../../src/domain/members';
import type { Report } from '../../src/domain/types';

jest.mock('../../src/db', () => ({ fillDocumentPatient: jest.fn() }));
jest.mock('../../src/state', () => ({ useRecords: jest.fn() }));
const report: Report = {
  id: 'r',
  documentId: 'd',
  memberId: 'self',
  patient: '',
  title: '血常规',
  date: '',
  dateKind: 'unknown',
  status: 'review',
  observations: [],
  warnings: [],
  template: null,
  createdAt: '',
};
const refresh = jest.fn(async () => {});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fillDocumentPatient).mockResolvedValue(['r', 'r2']);
  jest.mocked(useRecords).mockReturnValue({
    activeMember: { ...selfMember, name: '测试甲' },
    members: [selfMember],
    reports: [report, { ...report, id: 'r2' }],
    documents: [],
    visits: [],
    reportCounts: {},
    selectMember: jest.fn(),
    loading: false,
    importing: false,
    error: '',
    refresh,
  });
});
test('suggests a name, waits for explicit submit, and cancels without saving', () => {
  const screen = render(<DocumentPatientFill documentId="d" />);
  fireEvent.press(screen.getByTestId('open-document-patient'));
  expect(screen.getByTestId('document-patient-input').props.value).toBe('测试甲');
  expect(screen.getByText('填写 2 类检查')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('document-patient-input'), '另一个姓名');
  fireEvent.press(screen.getByTestId('cancel-document-patient'));
  expect(fillDocumentPatient).not.toHaveBeenCalled();
});
test('uses the current draft name and fills all blanks with one explicit action', async () => {
  const onFilled = jest.fn(),
    onBusyChange = jest.fn();
  const screen = render(
    <DocumentPatientFill
      documentId="d"
      suggestedName="报告姓名"
      onFilled={onFilled}
      onBusyChange={onBusyChange}
    />,
  );
  fireEvent.press(screen.getByTestId('open-document-patient'));
  expect(screen.getByTestId('document-patient-input').props.value).toBe('报告姓名');
  await act(async () => fireEvent.press(screen.getByTestId('fill-document-patient')));
  expect(fillDocumentPatient).toHaveBeenCalledTimes(1);
  expect(fillDocumentPatient).toHaveBeenCalledWith('d', 'self', '报告姓名');
  expect(onFilled).toHaveBeenCalledWith('报告姓名', ['r', 'r2']);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
  expect(screen.getByText('已补全 2 类检查的姓名。')).toBeTruthy();
});
test('prefers the document name over the member name and excludes other documents and members', () => {
  const state = jest.mocked(useRecords).getMockImplementation()!();
  jest.mocked(useRecords).mockReturnValue({
    ...state,
    reports: [
      report,
      { ...report, id: 'named', patient: '原件姓名', status: 'confirmed' },
      { ...report, id: 'other', documentId: 'other', patient: '其他原件' },
      { ...report, id: 'foreign', memberId: 'mom', patient: '其他成员' },
    ],
  });
  const screen = render(<DocumentPatientFill documentId="d" />);
  fireEvent.press(screen.getByTestId('open-document-patient'));
  expect(screen.getByTestId('document-patient-input').props.value).toBe('原件姓名');
  expect(screen.getByText('填写 1 类检查')).toBeTruthy();
});
test('repeated submit during a pending write only saves once', async () => {
  let complete!: (ids: string[]) => void;
  jest.mocked(fillDocumentPatient).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const screen = render(<DocumentPatientFill documentId="d" />);
  fireEvent.press(screen.getByTestId('open-document-patient'));
  fireEvent.press(screen.getByTestId('fill-document-patient'));
  fireEvent.press(screen.getByTestId('fill-document-patient'));
  expect(fillDocumentPatient).toHaveBeenCalledTimes(1);
  await act(async () => complete(['r', 'r2']));
  expect(screen.getByText('已补全 2 类检查的姓名。')).toBeTruthy();
});
test('invalid input and storage failure leave the form editable without success feedback', async () => {
  const screen = render(<DocumentPatientFill documentId="d" />);
  fireEvent.press(screen.getByTestId('open-document-patient'));
  fireEvent.changeText(screen.getByTestId('document-patient-input'), ' ');
  await act(async () => fireEvent.press(screen.getByTestId('fill-document-patient')));
  expect(fillDocumentPatient).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId('document-patient-input'), '甲');
  jest
    .mocked(fillDocumentPatient)
    .mockRejectedValue(new Error('这份报告中已有不同姓名，请分别核对填写。'));
  await act(async () => fireEvent.press(screen.getByTestId('fill-document-patient')));
  expect(screen.getByText('这份报告中已有不同姓名，请分别核对填写。')).toBeTruthy();
  expect(screen.getByTestId('document-patient-input').props.value).toBe('甲');
  expect(refresh).not.toHaveBeenCalled();
});
