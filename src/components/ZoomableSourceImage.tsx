import { useContext, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { SourceImage } from '../services/source-preview';
import { PageScrollContext } from '../ui';
import { boundedImage, MAX_IMAGE_SCALE, scaleAtPoint } from './source-image-geometry';

export function ZoomableSourceImage({
  image,
  name,
  accessibilityLabel,
  index,
  onError,
  viewportHeight,
  backgroundColor = 'white',
}: {
  image: SourceImage;
  name: string;
  accessibilityLabel?: string;
  index: number;
  onError: () => void;
  viewportHeight?: number;
  backgroundColor?: string;
}) {
  const scrollRef = useContext(PageScrollContext);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const imageHeight = (width * image.height) / image.width;
  // Leave room for two fingertips even when the source is just a thin table row.
  const height = viewportHeight ?? Math.max(120, Math.min(200, imageHeight));
  const fitHeight = Math.min(height, imageHeight);
  const fitWidth = imageHeight > height ? (width * height) / imageHeight : width;
  const transform = useSharedValue({ scale: 1, x: 0, y: 0 });
  const pinchStart = useSharedValue({ scale: 1, x: 0, y: 0 });
  const anchor = useSharedValue({ x: 0, y: 0 });
  const panStart = useSharedValue({ x: 0, y: 0, translationX: 0, translationY: 0 });
  const touchStart = useSharedValue({ x: 0, y: 0 });
  useEffect(() => {
    transform.value = { scale: 1, x: 0, y: 0 };
    setZoom(1);
  }, [width, height, transform]);

  const pinch = Gesture.Pinch()
    .withTestId(`source-pinch-${index}`)
    .onStart((event) => {
      pinchStart.value = transform.value;
      anchor.value = { x: event.focalX - width / 2, y: event.focalY - height / 2 };
    })
    .onUpdate((event) => {
      transform.value = boundedImage(
        scaleAtPoint(pinchStart.value, pinchStart.value.scale * event.scale, anchor.value, {
          x: event.focalX - width / 2,
          y: event.focalY - height / 2,
        }),
        fitWidth,
        fitHeight,
        height,
        width,
      );
    })
    .onFinalize(() => runOnJS(setZoom)(transform.value.scale));

  const pan = Gesture.Pan()
    .withTestId(`source-pan-${index}`)
    .manualActivation(true)
    .maxPointers(1)
    .onTouchesDown((event, manager) => {
      const touch = event.allTouches[0];
      if (event.numberOfTouches > 1 || transform.value.scale <= 1 || !touch) {
        manager.fail();
      } else {
        touchStart.value = { x: touch.absoluteX, y: touch.absoluteY };
      }
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0];
      if (event.numberOfTouches !== 1 || transform.value.scale <= 1 || !touch) {
        manager.fail();
      } else if (
        Math.hypot(touch.absoluteX - touchStart.value.x, touch.absoluteY - touchStart.value.y) > 6
      ) {
        manager.activate();
      }
    })
    .onStart((event) => {
      panStart.value = {
        x: transform.value.x,
        y: transform.value.y,
        translationX: event.translationX,
        translationY: event.translationY,
      };
    })
    .onUpdate((event) => {
      if (event.numberOfPointers !== 1) return;
      transform.value = boundedImage(
        {
          scale: transform.value.scale,
          x: panStart.value.x + event.translationX - panStart.value.translationX,
          y: panStart.value.y + event.translationY - panStart.value.translationY,
        },
        fitWidth,
        fitHeight,
        height,
        width,
      );
    });

  const doubleTap = Gesture.Tap()
    .withTestId(`source-double-tap-${index}`)
    .numberOfTaps(2)
    .maxDistance(10)
    .onEnd((event, success) => {
      if (!success) return;
      transform.value = boundedImage(
        scaleAtPoint(transform.value, transform.value.scale > 1 ? 1 : 3, {
          x: event.x - width / 2,
          y: event.y - height / 2,
        }),
        fitWidth,
        fitHeight,
        height,
        width,
      );
      runOnJS(setZoom)(transform.value.scale);
    });

  if (scrollRef) {
    pinch.blocksExternalGesture(scrollRef);
    pan.blocksExternalGesture(scrollRef);
    doubleTap.simultaneousWithExternalGesture(scrollRef);
  }
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: transform.value.x },
      { translateY: transform.value.y },
      { scale: transform.value.scale },
    ],
  }));
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <View
        testID={`source-image-${index}`}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel ?? `${name}的原报告片段`}
        accessibilityHint="双指缩放，放大后拖动查看。双击放大或恢复。也可用辅助操作调整大小。"
        accessibilityValue={{
          min: 100,
          max: MAX_IMAGE_SCALE * 100,
          now: Math.round(zoom * 100),
          text: `放大 ${zoom.toFixed(1)} 倍`,
        }}
        accessibilityActions={[
          { name: 'increment', label: '放大原图' },
          { name: 'decrement', label: '缩小原图' },
          { name: 'activate', label: '恢复原图大小' },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          const scale =
            nativeEvent.actionName === 'activate'
              ? 1
              : transform.value.scale + (nativeEvent.actionName === 'increment' ? 1 : -1);
          transform.value = boundedImage({ scale, x: 0, y: 0 }, fitWidth, fitHeight, height, width);
          setZoom(transform.value.scale);
        }}
        onLayout={({ nativeEvent }) => {
          if (nativeEvent.layout.width !== width) {
            setWidth(nativeEvent.layout.width);
            transform.value = { scale: 1, x: 0, y: 0 };
            setZoom(1);
          }
        }}
        style={{
          height,
          overflow: 'hidden',
          backgroundColor,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Animated.Image
          testID={`source-bitmap-${index}`}
          source={{ uri: image.uri }}
          onError={onError}
          accessible={false}
          resizeMode="contain"
          style={[{ width: fitWidth, height: fitHeight }, animatedStyle]}
        />
      </View>
    </GestureDetector>
  );
}
