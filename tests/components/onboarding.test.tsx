import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Pressable, Text } from 'react-native';
import { OnboardingProvider, useOnboarding } from '../../src/components/Onboarding';
import { getSetting, setSetting } from '../../src/db';

jest.mock('../../src/db', () => ({ getSetting: jest.fn(), setSetting: jest.fn() }));
jest.mock('../../src/components/ZoomableSourceImage', () => ({ ZoomableSourceImage: () => null }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
function Replay() {
  const open = useOnboarding();
  return (
    <Pressable testID="replay" onPress={open}>
      <Text>使用引导</Text>
    </Pressable>
  );
}
function mount() {
  return render(
    <OnboardingProvider>
      <Replay />
    </OnboardingProvider>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSetting).mockResolvedValue(null);
  jest.mocked(setSetting).mockResolvedValue();
});
test.each(['onboarding-start', 'onboarding-skip'])(
  '%s remembers completion across launches',
  async (button) => {
    const screen = mount();
    await act(async () => {});
    expect(screen.getByText('看清每一次变化')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId(button)));
    expect(setSetting).toHaveBeenCalledWith('onboarding-seen-v1', '1');
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
    screen.unmount();
    jest.mocked(getSetting).mockResolvedValue('1');
    const next = mount();
    await act(async () => {});
    expect(next.queryByTestId('onboarding-screen')).toBeNull();
  },
);
test('settings replay and closing enlarged preview do not alter completion or record data', async () => {
  jest.mocked(getSetting).mockResolvedValue('1');
  const screen = mount();
  await act(async () => {});
  fireEvent.press(screen.getByTestId('replay'));
  fireEvent.press(screen.getByTestId('onboarding-preview'));
  fireEvent(screen.getByTestId('onboarding-modal'), 'requestClose');
  expect(screen.getByTestId('onboarding-start')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId('onboarding-skip')));
  expect(setSetting).not.toHaveBeenCalled();
  expect(screen.queryByTestId('onboarding-screen')).toBeNull();
});
test('preference read failure leaves records accessible', async () => {
  jest.mocked(getSetting).mockRejectedValue(new Error('unavailable'));
  const screen = mount();
  await act(async () => {});
  expect(screen.queryByTestId('onboarding-screen')).toBeNull();
  expect(screen.getByTestId('replay')).toBeTruthy();
});
test('failed completion save does not trap the user in onboarding', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(setSetting).mockRejectedValue(new Error('unavailable'));
  const screen = mount();
  await act(async () => {});
  await act(async () => fireEvent.press(screen.getByTestId('onboarding-start')));
  expect(alert).toHaveBeenCalled();
  expect(screen.queryByTestId('onboarding-screen')).toBeNull();
  alert.mockRestore();
});
