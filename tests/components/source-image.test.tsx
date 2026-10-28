import { act, fireEvent, render } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { ZoomableSourceImage } from '../../src/components/ZoomableSourceImage';
import { boundedImage, scaleAtPoint } from '../../src/components/source-image-geometry';

test('pinch preserves an off-centre focal point, including when the fingers move', () => {
  const result = scaleAtPoint({ scale: 2, x: 30, y: -20 }, 4, { x: 80, y: 10 }, { x: 90, y: 30 });
  // The same image point must remain under the moving focal point.
  expect((90 - result.x) / result.scale).toBe((80 - 30) / 2);
  expect((30 - result.y) / result.scale).toBe((10 + 20) / 2);
});

test('panning cannot lose the image, shrinking recentres it, and scaling is bounded', () => {
  expect(boundedImage({ scale: 3, x: -900, y: 900 }, 280, 30, 120)).toEqual({
    scale: 3,
    x: -280,
    y: 0,
  });
  expect(boundedImage({ scale: 0.1, x: 70, y: 20 }, 280, 30, 120)).toEqual({
    scale: 1,
    x: 0,
    y: 0,
  });
  expect(boundedImage({ scale: 20, x: 0, y: 900 }, 280, 30, 120)).toEqual({
    scale: 6,
    x: 0,
    y: 30,
  });
  // A tall source fitted within a wide viewport stays centred until it fills it.
  expect(boundedImage({ scale: 2, x: 200, y: 20 }, 100, 200, 200, 280).x).toBe(0);
});

test('pinch, drag, reset and layout changes leave a usable inline image', async () => {
  const screen = render(
    <ZoomableSourceImage
      image={{ uri: 'file:///sample.png', width: 1000, height: 100 }}
      name="ALT"
      index={0}
      onError={jest.fn()}
    />,
  );
  const viewport = () => screen.getByTestId('source-image-0');
  fireEvent(viewport(), 'layout', { nativeEvent: { layout: { width: 280 } } });
  await act(async () => {
    fireGestureHandler(getByGestureTestId('source-pinch-0'), [
      { state: State.BEGAN, scale: 1, focalX: 140, focalY: 60 },
      { state: State.ACTIVE, scale: 1, focalX: 140, focalY: 60 },
      { state: State.ACTIVE, scale: 3, focalX: 140, focalY: 60 },
      { state: State.END, scale: 3 },
    ]);
  });
  expect(viewport().props.accessibilityValue.now).toBe(300);
  await act(async () => {
    fireGestureHandler(getByGestureTestId('source-pan-0'), [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: -1000, translationY: 1000 },
      { state: State.END },
    ]);
  });
  expect(screen.getByTestId('source-bitmap-0')).toHaveAnimatedStyle({
    transform: [{ translateX: -280 }, { translateY: 0 }, { scale: 3 }],
  });
  await act(async () => {
    fireGestureHandler(getByGestureTestId('source-double-tap-0'), [
      { state: State.BEGAN },
      { state: State.ACTIVE, x: 140, y: 60 },
      { state: State.END, x: 140, y: 60 },
    ]);
  });
  expect(viewport().props.accessibilityValue.now).toBe(100);
  fireEvent(viewport(), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  expect(viewport().props.accessibilityValue.now).toBe(200);
  fireEvent(viewport(), 'layout', { nativeEvent: { layout: { width: 400 } } });
  expect(viewport().props.accessibilityValue.now).toBe(100);
});
