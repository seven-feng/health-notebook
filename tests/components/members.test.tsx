import { act, fireEvent, render } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';
import { RecordsProvider, useRecords } from '../../src/state';
import { MemberHeader } from '../../src/components/MemberHeader';
import * as db from '../../src/db';
import { selfMember } from '../../src/domain/members';
import { consumeInbox } from '../../src/services/import';

jest.mock('../../modules/local-pdf', () => ({ LocalPdf: {} }));

jest.mock('../../src/services/repair-report-dates', () => ({
  repairMissingReportDates: jest.fn(async () => {}),
}));
jest.mock('../../src/db', () => ({
  database: jest.fn(),
  retryFileDeletions: jest.fn(async () => {}),
  getReports: jest.fn(),
  getDocuments: jest.fn(),
  getVisits: jest.fn(),
  getMembers: jest.fn(),
}));
jest.mock('../../src/services/import', () => ({
  consumeInbox: jest.fn(async () => []),
  recoverImports: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const mom = { ...selfMember, id: 'mom', label: '妈妈', name: '乙' };
function Harness() {
  const state = useRecords();
  return (
    <>
      <MemberHeader title="指标变化" subtitle="测试档案隔离" />
      <Text testID="error">{state.error}</Text>
      <Pressable testID="refresh" onPress={state.refresh}>
        <Text>重新读取</Text>
      </Pressable>
      <Text testID="data">
        {JSON.stringify({
          member: state.activeMember.id,
          reports: state.reports.map((r) => r.id),
          documents: state.documents.map((d) => d.id),
          visits: state.visits.map((v) => v.id),
        })}
      </Text>
      <Pressable
        testID="add-and-select"
        onPress={async () => {
          await state.refresh();
          state.selectMember('new');
        }}
      >
        <Text>加入新成员</Text>
      </Pressable>
    </>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(db.retryFileDeletions).mockResolvedValue();
  jest.mocked(db.getMembers).mockResolvedValue([selfMember, mom]);
  jest.mocked(db.getReports).mockResolvedValue([
    { id: 'self-r', memberId: 'self' },
    { id: 'mom-r', memberId: 'mom' },
  ] as never);
  jest.mocked(db.getDocuments).mockResolvedValue([
    { id: 'self-d', memberId: 'self' },
    { id: 'mom-d', memberId: 'mom' },
  ] as never);
  jest.mocked(db.getVisits).mockResolvedValue([
    { id: 'self-v', memberId: 'self' },
    { id: 'mom-v', memberId: 'mom' },
  ] as never);
});
test('cleanup failure keeps records visible and a successful refresh clears the retry message', async () => {
  jest.mocked(db.retryFileDeletions).mockRejectedValue(new Error('IO_ERROR'));
  const screen = render(
    <RecordsProvider>
      <Harness />
    </RecordsProvider>,
  );
  await act(async () => {});
  expect(screen.getByTestId('data').props.children).toBe(
    JSON.stringify({
      member: 'self',
      reports: ['self-r'],
      documents: ['self-d'],
      visits: ['self-v'],
    }),
  );
  expect(screen.getByTestId('error').props.children).toContain('重新读取');
  const attempts = jest.mocked(db.retryFileDeletions).mock.calls.length;
  jest.mocked(db.retryFileDeletions).mockResolvedValue();
  await act(async () => {
    fireEvent.press(screen.getByTestId('refresh'));
  });
  expect(db.retryFileDeletions).toHaveBeenCalledTimes(attempts + 1);
  expect(screen.getByTestId('error').props.children).toBe('');
  expect(screen.getByTestId('data').props.children).toContain('self-r');
});
test('default self and member switch isolate reports, originals and visits while keeping the page', async () => {
  const screen = render(
    <RecordsProvider>
      <Harness />
    </RecordsProvider>,
  );
  await act(async () => {});
  expect(screen.getByTestId('data').props.children).toBe(
    JSON.stringify({
      member: 'self',
      reports: ['self-r'],
      documents: ['self-d'],
      visits: ['self-v'],
    }),
  );
  fireEvent.press(screen.getByTestId('member-switch'));
  fireEvent.press(screen.getByTestId('member-mom'));
  expect(screen.getByText('指标变化')).toBeTruthy();
  expect(screen.getByTestId('data').props.children).toBe(
    JSON.stringify({ member: 'mom', reports: ['mom-r'], documents: ['mom-d'], visits: ['mom-v'] }),
  );
  screen.unmount();
  const relaunched = render(
    <RecordsProvider>
      <Harness />
    </RecordsProvider>,
  );
  await act(async () => {});
  expect(relaunched.getByTestId('data').props.children).toContain('"member":"self"');
  expect(consumeInbox).toHaveBeenCalledWith('self', expect.any(Function));
});
test('new member can be selected immediately after saving and refreshing, with no previous records', async () => {
  const screen = render(
    <RecordsProvider>
      <Harness />
    </RecordsProvider>,
  );
  await act(async () => {});
  jest
    .mocked(db.getMembers)
    .mockResolvedValue([selfMember, mom, { ...mom, id: 'new', label: '奶奶' }]);
  await act(async () => {
    fireEvent.press(screen.getByTestId('add-and-select'));
  });
  expect(screen.getByTestId('data').props.children).toBe(
    JSON.stringify({ member: 'new', reports: [], documents: [], visits: [] }),
  );
});
