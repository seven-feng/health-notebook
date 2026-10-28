import { act, fireEvent, render } from '@testing-library/react-native';
import Records from '../../app/(tabs)/index';
import { useRecords } from '../../src/state';
import { getSetting, setSetting } from '../../src/db';
import { selfMember } from '../../src/domain/members';
import type { Report, Visit } from '../../src/domain/types';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void) => {
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('../../src/state', () => ({ useRecords: jest.fn() }));
jest.mock('../../src/components/MemberHeader', () => ({ MemberHeader: () => null }));
jest.mock('../../src/db', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }));
jest.mock('../../src/services/import', () => ({}));
jest.mock('../../src/services/picker-cache', () => ({}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
const report: Report = {
  id: 'r',
  memberId: 'self',
  documentId: 'd',
  date: '2026-10-23',
  dateKind: 'sample',
  title: '血常规',
  patient: '测试',
  createdAt: '',
  status: 'confirmed',
  observations: [],
  template: '',
  warnings: [],
};
const visit: Visit = {
  id: 'v',
  memberId: 'self',
  title: '呼吸内科',
  date: '2026-10-23',
  note: '咳嗽',
  reportIds: ['r'],
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSetting).mockResolvedValue(null);
  jest.mocked(setSetting).mockResolvedValue();
  jest
    .mocked(useRecords)
    .mockReturnValue({
      activeMember: selfMember,
      reports: [report],
      visits: [visit],
      documents: [],
      members: [selfMember],
      reportCounts: {},
      selectMember: jest.fn(),
      refresh: jest.fn(),
      loading: false,
      importing: false,
      error: '',
    });
});
test('homepage has two views; linked reports remain visible under reports', async () => {
  const screen = render(<Records />);
  await act(async () => {});
  expect(screen.getByText('呼吸内科')).toBeTruthy();
  expect(screen.queryByText('血常规')).toBeNull();
  expect(screen.queryByText('全部')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId('view-reports'));
  });
  expect(screen.getByText('血常规')).toBeTruthy();
  expect(screen.getByText(/已关联就诊/)).toBeTruthy();
  expect(screen.queryByText('呼吸内科')).toBeNull();
  expect(setSetting).toHaveBeenCalledWith('record-view:self', 'reports');
});
test('report-only member defaults to reports and sees an empty visit view when selected', async () => {
  jest.mocked(useRecords).mockReturnValue({ ...jest.mocked(useRecords)(), visits: [] });
  const screen = render(<Records />);
  await act(async () => {});
  expect(screen.getByText('血常规')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByTestId('view-visits'));
  });
  expect(screen.getByText('留下一次就诊')).toBeTruthy();
});
test('member change loads that member’s own preference', async () => {
  jest
    .mocked(getSetting)
    .mockImplementation(async (key) => (key === 'record-view:self' ? 'reports' : 'visits'));
  const screen = render(<Records />);
  await act(async () => {});
  expect(screen.getByText('血常规')).toBeTruthy();
  jest
    .mocked(useRecords)
    .mockReturnValue({
      ...jest.mocked(useRecords)(),
      activeMember: { ...selfMember, id: 'mom', label: '妈妈' },
      reports: [],
      visits: [{ ...visit, id: 'mom-visit', memberId: 'mom', title: '妈妈复查' }],
    });
  screen.rerender(<Records />);
  await act(async () => {});
  expect(screen.getByText('妈妈复查')).toBeTruthy();
  expect(screen.queryByText('血常规')).toBeNull();
  expect(getSetting).toHaveBeenLastCalledWith('record-view:mom');
});
test('late preference read cannot override a fresh user selection', async () => {
  let resolve!: (value: string) => void;
  jest.mocked(getSetting).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const screen = render(<Records />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('view-reports'));
  });
  await act(async () => {
    resolve('visits');
  });
  expect(screen.getByText('血常规')).toBeTruthy();
});
