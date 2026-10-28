import { act, fireEvent, render } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Settings from '../../app/(tabs)/settings';
import MembersSettings from '../../app/settings/members';
import UsageSettings from '../../app/settings/usage';
import MemberPage from '../../app/member';
import { useRecords } from '../../src/state';
import { saveMember } from '../../src/db';
import { selfMember } from '../../src/domain/members';
import * as analytics from '../../src/services/analytics';

jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-member' }));
jest.mock('../../src/state', () => ({ useRecords: jest.fn() }));
jest.mock('../../src/db', () => ({ saveMember: jest.fn() }));
jest.mock('../../src/services/analytics', () => ({
  __esModule: true,
  analyticsConfigured: true,
  usageEnabled: jest.fn(),
  setUsageConsent: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const mom = { ...selfMember, id: 'mom', label: '妈妈', name: '合成姓名' };
const selectMember = jest.fn(),
  refresh = jest.fn(async () => {});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useRecords).mockReturnValue({
    members: [selfMember, mom],
    activeMember: selfMember,
    reports: [],
    loading: false,
    error: '',
    selectMember,
    refresh,
  } as unknown as ReturnType<typeof useRecords>);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(saveMember).mockResolvedValue();
  jest.mocked(analytics.usageEnabled).mockResolvedValue(false);
  jest.mocked(analytics.setUsageConsent).mockResolvedValue();
  Object.defineProperty(analytics, 'analyticsConfigured', { value: true, configurable: true });
});

test('settings opens global sections without a member selector or unfinished feature entry', () => {
  const view = render(<Settings />);
  expect(view.queryByTestId('member-switch')).toBeNull();
  expect(view.queryByText('备份与恢复')).toBeNull();
  expect(view.queryByText('反馈与建议')).toBeNull();
  for (const [id, path] of [
    ['members', '/settings/members'],
    ['data', '/settings/privacy'],
    ['help', '/settings/help'],
    ['about', '/settings/about'],
  ]) {
    fireEvent.press(view.getByTestId(`settings-${id}`));
    expect(router.push).toHaveBeenLastCalledWith(path);
  }
  expect(selectMember).not.toHaveBeenCalled();
});

test('management lists every member and opens the chosen editor without switching records', () => {
  const view = render(<MembersSettings />);
  expect(view.getByTestId('manage-member-self')).toBeTruthy();
  fireEvent.press(view.getByTestId('manage-member-mom'));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/member',
    params: { id: 'mom', from: 'settings' },
  });
  fireEvent.press(view.getByTestId('settings-add-member'));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/member',
    params: { from: 'settings' },
  });
  expect(selectMember).not.toHaveBeenCalled();
});

test.each([true, false])(
  'saving from settings preserves active member (existing=%s)',
  async (existing) => {
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ ...(existing ? { id: 'mom' } : {}), from: 'settings' });
    const view = render(<MemberPage />);
    fireEvent.changeText(view.getByTestId('member-label'), '妈妈');
    await act(async () => fireEvent.press(view.getByTestId('save-member')));
    expect(saveMember).toHaveBeenCalledWith(
      expect.objectContaining({ id: existing ? 'mom' : 'new-member', label: '妈妈' }),
    );
    expect(refresh).toHaveBeenCalled();
    expect(selectMember).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  },
);

test('adding a member from the original records flow still selects it and returns home', async () => {
  const view = render(<MemberPage />);
  fireEvent.changeText(view.getByTestId('member-label'), '爸爸');
  await act(async () => fireEvent.press(view.getByTestId('save-member')));
  expect(selectMember).toHaveBeenCalledWith('new-member');
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('failed member save stays in the editor and does not switch or navigate', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'mom', from: 'settings' });
  jest.mocked(saveMember).mockRejectedValueOnce(new Error('保存失败，请重试。'));
  const view = render(<MemberPage />);
  await act(async () => fireEvent.press(view.getByTestId('save-member')));
  expect(view.getByText('保存失败，请重试。')).toBeTruthy();
  expect(selectMember).not.toHaveBeenCalled();
  expect(router.back).not.toHaveBeenCalled();
});

test('usage preference loads and can be revoked with the existing service', async () => {
  jest.mocked(analytics.usageEnabled).mockResolvedValue(true);
  const view = render(<UsageSettings />);
  await act(async () => {});
  expect(view.getByTestId('usage-consent').props.value).toBe(true);
  await act(async () => fireEvent(view.getByTestId('usage-consent'), 'valueChange', false));
  expect(analytics.setUsageConsent).toHaveBeenCalledWith(false);
  expect(view.getByTestId('usage-consent').props.value).toBe(false);
});

test('unconfigured statistics cannot open its settings screen', async () => {
  Object.defineProperty(analytics, 'analyticsConfigured', { value: false, configurable: true });
  const view = render(<UsageSettings />);
  await act(async () => {});
  expect(view.queryByTestId('usage-consent')).toBeNull();
  expect(view.queryByText('使用统计')).toBeNull();
  expect(require('expo-router').Redirect.mock.calls.at(-1)[0]).toEqual({
    href: '/settings/privacy',
  });
  expect(analytics.usageEnabled).not.toHaveBeenCalled();
  expect(analytics.setUsageConsent).not.toHaveBeenCalled();
});

test('failed consent write displays the service fail-closed state and permits a retry', async () => {
  jest.mocked(analytics.usageEnabled).mockResolvedValue(true);
  jest.mocked(analytics.setUsageConsent).mockRejectedValueOnce(new Error('storage unavailable'));
  const view = render(<UsageSettings />);
  await act(async () => {});
  await act(async () => fireEvent(view.getByTestId('usage-consent'), 'valueChange', false));
  expect(view.getByTestId('usage-consent').props.value).toBe(false);
  expect(view.getByTestId('usage-consent').props.disabled).toBe(true);
  jest.mocked(analytics.usageEnabled).mockResolvedValue(false);
  await act(async () => fireEvent.press(view.getByText('重新读取')));
  expect(view.getByTestId('usage-consent').props.disabled).toBe(false);
});
