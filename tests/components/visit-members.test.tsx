import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import Records from '../../app/(tabs)/index';
import { RecordsProvider, useRecords } from '../../src/state';
import { selfMember } from '../../src/domain/members';
import type { Visit } from '../../src/domain/types';
import * as db from '../../src/db';

jest.mock('../../modules/local-pdf', () => ({ LocalPdf: {} }));
jest.mock('../../src/services/repair-report-dates', () => ({
  repairMissingReportDates: jest.fn(async () => {}),
}));
jest.mock('../../src/services/import', () => ({
  consumeInbox: jest.fn(async () => []),
  recoverImports: jest.fn(async () => {}),
}));
jest.mock('../../src/db', () => ({
  database: jest.fn(),
  retryFileDeletions: jest.fn(async () => {}),
  getReports: jest.fn(async () => []),
  getDocuments: jest.fn(async () => []),
  getVisits: jest.fn(),
  getMembers: jest.fn(),
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void) => {
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

function RefreshRecords() {
  const { refresh } = useRecords();
  return (
    <Pressable onPress={refresh}>
      <Text>测试重新读取</Text>
    </Pressable>
  );
}

const ownVisit: Visit = {
  id: 'self-visit',
  memberId: 'self',
  title: '我的门诊记录',
  date: '2026-10-23',
  note: '自己的就诊备注',
  status: 'review',
  reportIds: [],
};
const momVisit: Visit = {
  ...ownVisit,
  id: 'mom-visit',
  memberId: 'mom',
  title: '妈妈的复诊记录',
  note: '妈妈的就诊备注',
  status: 'confirmed',
};

test.each([{ items: [] as Visit[] }, { items: [momVisit] }])(
  'homepage switches the actual member picker and keeps only that member’s visits after refresh (%j)',
  async ({ items }) => {
    jest
      .mocked(db.getMembers)
      .mockResolvedValue([selfMember, { ...selfMember, id: 'mom', label: '妈妈' }]);
    jest.mocked(db.getVisits).mockResolvedValue([ownVisit, ...items]);
    const screen = render(
      <RecordsProvider>
        <Records />
        <RefreshRecords />
      </RecordsProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('visit-self-visit')).toBeTruthy();
    expect(screen.queryByTestId('visit-mom-visit')).toBeNull();

    fireEvent.press(screen.getByTestId('member-switch'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('member-mom'));
    });
    expect(screen.getByText('妈妈的健康记录')).toBeTruthy();
    expect(screen.queryByTestId('visit-self-visit')).toBeNull();
    expect(screen.getByTestId('visit-count').props.children).toBe(items.length);
    if (items.length) expect(screen.getByTestId('visit-mom-visit')).toBeTruthy();
    else expect(screen.getByText('留下一次就诊')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('测试重新读取'));
    });
    expect(screen.queryByTestId('visit-self-visit')).toBeNull();
    expect(screen.getByTestId('visit-count').props.children).toBe(items.length);
  },
);
