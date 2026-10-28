import { act, renderHook } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Keyboard,
  type ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useReviewGroupNavigation } from '../../src/components/useReviewGroupNavigation';

const scrollEvent = (y: number, height = 1800) =>
  ({
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height },
      layoutMeasurement: { width: 390, height: 600 },
    },
  }) as NativeSyntheticEvent<NativeScrollEvent>;
function setup() {
  const scrollTo = jest.fn();
  const ref = { current: { scrollTo } as unknown as ScrollView };
  const hook = renderHook(({ scope }: { scope: string }) => useReviewGroupNavigation(ref, scope), {
    initialProps: { scope: 'self:r' },
  });
  return { ...hook, scrollTo };
}
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each([
  ['longer', 2400],
  ['shorter', 1400],
] as const)(
  'keeps the outgoing group until one scroll finishes before replacing it with a %s group',
  async (_length, contentHeight) => {
    const { result, scrollTo } = setup();
    await act(async () => {});
    const replaceGroup = jest.fn();
    act(() => result.current.onScroll(scrollEvent(900)));
    act(() => result.current.navigate(512, replaceGroup));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 500, animated: true });
    expect(replaceGroup).not.toHaveBeenCalled();
    act(() => result.current.onScroll(scrollEvent(700)));
    expect(replaceGroup).not.toHaveBeenCalled();
    act(() => result.current.onScroll(scrollEvent(500)));
    expect(replaceGroup).toHaveBeenCalledTimes(1);
    act(() => result.current.onMomentumScrollEnd(scrollEvent(500)));
    act(() => result.current.onScroll(scrollEvent(500, contentHeight)));
    expect(replaceGroup).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(result.current.transitioning).toBe(false);
  },
);

test('at the source anchor it replaces the group without another animation', async () => {
  const { result, scrollTo } = setup();
  await act(async () => {});
  const commit = jest.fn();
  act(() => result.current.onScroll(scrollEvent(500)));
  act(() => result.current.navigate(512, commit));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(scrollTo).not.toHaveBeenCalled();
});

test('waits for both keyboard dismissal and the prepared image before scrolling', async () => {
  jest.mocked(Keyboard.isVisible).mockReturnValue(true);
  let hide!: () => void;
  const remove = jest.fn();
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
    if (name === 'keyboardDidHide') hide = listener as () => void;
    return { remove } as unknown as ReturnType<typeof Keyboard.addListener>;
  });
  const { result, scrollTo } = setup();
  await act(async () => {});
  let ready!: () => void;
  const prepared = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const commit = jest.fn();
  act(() => result.current.onScroll(scrollEvent(900)));
  act(() => result.current.navigate(512, commit, () => prepared));
  await act(async () => ready());
  expect(scrollTo).not.toHaveBeenCalled();
  act(() => hide());
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(commit).not.toHaveBeenCalled();
  act(() => result.current.onScroll(scrollEvent(500)));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalled();
});

test('a manual drag cancels a pending image and repeated taps cannot queue extra groups', async () => {
  const { result, scrollTo } = setup();
  await act(async () => {});
  let ready!: () => void;
  const prepared = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const commit = jest.fn(),
    another = jest.fn();
  act(() => result.current.onScroll(scrollEvent(900)));
  act(() => result.current.navigate(512, commit, () => prepared));
  act(() => result.current.navigate(512, another));
  act(() => result.current.cancel());
  await act(async () => ready());
  expect(scrollTo).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(another).not.toHaveBeenCalled();
  expect(result.current.transitioning).toBe(false);
});

test('image failure still permits navigation and returning to the report', async () => {
  const { result, scrollTo } = setup();
  await act(async () => {});
  const commit = jest.fn();
  act(() => result.current.onScroll(scrollEvent(900)));
  await act(async () =>
    result.current.navigate(512, commit, () => Promise.reject(new Error('unavailable'))),
  );
  expect(scrollTo).toHaveBeenCalledTimes(1);
  act(() => result.current.onMomentumScrollEnd(scrollEvent(500)));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(result.current.transitioning).toBe(false);
});

test.each(['scope', 'unmount'])('%s changes discard late image completion', async (kind) => {
  const { result, scrollTo, rerender, unmount } = setup();
  await act(async () => {});
  let ready!: () => void;
  const prepared = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const commit = jest.fn();
  act(() => result.current.navigate(512, commit, () => prepared));
  if (kind === 'scope') rerender({ scope: 'another:r' });
  else unmount();
  await act(async () => ready());
  expect(commit).not.toHaveBeenCalled();
  expect(scrollTo).not.toHaveBeenCalled();
});

test('respects reduced motion and an anchor beyond the scrollable area', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  const { result, scrollTo } = setup();
  await act(async () => {});
  const commit = jest.fn();
  act(() => result.current.onScroll(scrollEvent(500, 1200)));
  act(() => result.current.navigate(900, commit));
  expect(scrollTo).toHaveBeenCalledWith({ y: 600, animated: false });
  act(() => result.current.onScroll(scrollEvent(600, 1200)));
  expect(commit).toHaveBeenCalledTimes(1);
});
