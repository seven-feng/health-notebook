import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { RecordsProvider, useRecords } from '../../src/state';
import { LocalPdf } from '../../modules/local-pdf';
import { consumeInbox } from '../../src/services/import';
import { selfMember } from '../../src/domain/members';

jest.mock('../../src/db', () => ({
  database: jest.fn(),
  retryFileDeletions: jest.fn(async () => {}),
  getReports: jest.fn(async () => []),
  getDocuments: jest.fn(async () => []),
  getVisits: jest.fn(async () => []),
  getMembers: jest.fn(async () => [
    jest.requireActual('../../src/domain/members').selfMember,
    { ...jest.requireActual('../../src/domain/members').selfMember, id: 'mom', label: '妈妈' },
  ]),
}));
jest.mock('../../modules/local-pdf', () => ({
  LocalPdf: {
    addListener: jest.fn(),
    takeIncomingError: jest.fn(async () => null),
  },
}));
jest.mock('../../src/services/import', () => ({
  consumeInbox: jest.fn(async () => []),
  recoverImports: jest.fn(async () => {}),
  importedDestination: jest.fn(async () => '/document/shared-document'),
}));
jest.mock('../../src/services/repair-report-dates', () => ({
  repairMissingReportDates: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

function Harness() {
  const state = useRecords();
  return (
    <>
      <Text testID="status">{state.importing ? '正在导入报告…' : 'idle'}</Text>
      <Text testID="error">{state.error}</Text>
      <Pressable testID="switch" onPress={() => state.selectMember('mom')}>
        <Text>切换档案</Text>
      </Pressable>
    </>
  );
}
let receive: () => void;
const remove = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(consumeInbox).mockResolvedValue([]);
  jest.mocked(LocalPdf.addListener!).mockImplementation((_event, listener) => {
    receive = listener;
    return { remove };
  });
});
function deferredImport() {
  let done!: (ids: string[]) => void;
  const promise = new Promise<string[]>((resolve) => {
    done = resolve;
  });
  jest.mocked(consumeInbox).mockImplementationOnce(async (_member, onStart) => {
    onStart?.();
    return promise;
  });
  return done;
}
async function mount() {
  const screen = render(
    <RecordsProvider>
      <Harness />
    </RecordsProvider>,
  );
  await act(async () => {});
  return screen;
}
test('a file arriving after the foreground scan imports without another AppState event', async () => {
  const screen = await mount();
  expect(router.push).not.toHaveBeenCalled();
  const done = deferredImport();
  await act(async () => {
    receive();
  });
  expect(consumeInbox).toHaveBeenLastCalledWith(selfMember.id, expect.any(Function));
  expect(screen.getByTestId('status').props.children).toBe('正在导入报告…');
  await act(async () => {
    done(['shared-report']);
  });
  expect(router.push).toHaveBeenCalledWith('/document/shared-document');
  expect(screen.getByTestId('status').props.children).toBe('idle');
});
test('cold-start recovery opens an already persisted incoming file', async () => {
  jest.mocked(consumeInbox).mockResolvedValueOnce(['already-received']);
  await mount();
  expect(router.push).toHaveBeenCalledWith('/document/shared-document');
});
test('changing profiles during OCR keeps the captured owner and does not open another profile', async () => {
  const screen = await mount();
  const done = deferredImport();
  await act(async () => {
    receive();
  });
  fireEvent.press(screen.getByTestId('switch'));
  await act(async () => {
    done(['self-report']);
  });
  expect(consumeInbox).toHaveBeenLastCalledWith('self', expect.any(Function));
  expect(router.push).not.toHaveBeenCalled();
});
test('a native receipt failure is visible after cold launch, without a stuck spinner', async () => {
  jest
    .mocked(LocalPdf.takeIncomingError!)
    .mockResolvedValueOnce('这份报告超过 20 MB，暂时无法导入。');
  const screen = await mount();
  expect(screen.getByTestId('error').props.children).toContain('20 MB');
  expect(screen.getByTestId('status').props.children).toBe('idle');
});
test('unmount removes the listener and an in-flight import cannot navigate afterwards', async () => {
  const screen = await mount();
  const done = deferredImport();
  await act(async () => {
    receive();
  });
  screen.unmount();
  await act(async () => {
    done(['shared-report']);
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(router.push).not.toHaveBeenCalled();
});
