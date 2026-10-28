import { useMemo, useRef, useState } from 'react';
import { Image, PanResponder, View } from 'react-native';
import type { ImageResult } from 'expo-image-manipulator';
import type { Rect } from '../domain/types';
import { moveCrop, type CropHandle } from '../domain/photo-crop';
import { color } from '../ui';

function CropTouch({
  handle,
  crop,
  width,
  height,
  onChange,
  disabled,
}: {
  handle: CropHandle;
  crop: Rect;
  width: number;
  height: number;
  onChange: (crop: Rect) => void;
  disabled: boolean;
}) {
  const latest = useRef(crop);
  latest.current = crop;
  const start = useRef(crop);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: () => {
          start.current = latest.current;
        },
        onPanResponderMove: (_, gesture) => {
          if (width && height)
            onChange(moveCrop(start.current, handle, gesture.dx / width, gesture.dy / height));
        },
      }),
    [disabled, handle, height, width, onChange],
  );
  const moving = handle === 'move';
  return (
    <View
      {...responder.panHandlers}
      testID={`crop-${handle}`}
      accessible={!moving}
      accessibilityRole="adjustable"
      accessibilityLabel={`裁剪${{ topLeft: '左上角', topRight: '右上角', bottomLeft: '左下角', bottomRight: '右下角', move: '区域' }[handle]}`}
      accessibilityActions={[
        { name: 'increment', label: '向内裁剪' },
        { name: 'decrement', label: '向外扩展' },
      ]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (disabled) return;
        const step = nativeEvent.actionName === 'increment' ? 0.02 : -0.02;
        onChange(
          moveCrop(
            crop,
            handle,
            handle.endsWith('Left') ? step : -step,
            handle.startsWith('top') ? step : -step,
          ),
        );
      }}
      style={
        moving
          ? { position: 'absolute', left: 22, right: 22, top: 22, bottom: 22 }
          : {
              position: 'absolute',
              width: 44,
              height: 44,
              left: handle.endsWith('Left') ? -22 : undefined,
              right: handle.endsWith('Right') ? -22 : undefined,
              top: handle.startsWith('top') ? -22 : undefined,
              bottom: handle.startsWith('bottom') ? -22 : undefined,
              justifyContent: 'center',
              alignItems: 'center',
            }
      }
    >
      {!moving && (
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            backgroundColor: color.green,
            borderWidth: 2,
            borderColor: 'white',
          }}
        />
      )}
    </View>
  );
}

export function PhotoCrop({
  image,
  crop,
  onChange,
  disabled,
}: {
  image: ImageResult;
  crop: Rect;
  onChange: (crop: Rect) => void;
  disabled: boolean;
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const scale = Math.min(
    Math.max(0, layout.width - 32) / image.width,
    Math.max(0, layout.height - 32) / image.height,
  );
  const width = image.width * scale,
    height = image.height * scale;
  const left = crop.x * width,
    top = crop.y * height,
    right = (crop.x + crop.width) * width,
    bottom = (crop.y + crop.height) * height;
  const shade = 'rgba(0,0,0,0.48)';
  return (
    <View
      testID="photo-editor"
      style={{
        flex: 1,
        minHeight: 180,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#E7EBE4',
        borderRadius: 12,
      }}
      onLayout={({ nativeEvent }) => setLayout(nativeEvent.layout)}
    >
      {width > 0 && (
        <View style={{ width, height }}>
          <Image
            source={{ uri: image.uri }}
            resizeMode="contain"
            style={{ width, height }}
            accessibilityLabel="待裁剪的报告图片"
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: top,
              backgroundColor: shade,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: bottom,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: shade,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top,
              left: 0,
              width: left,
              height: bottom - top,
              backgroundColor: shade,
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top,
              left: right,
              right: 0,
              height: bottom - top,
              backgroundColor: shade,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left,
              top,
              width: right - left,
              height: bottom - top,
              borderColor: color.green,
              borderWidth: 2,
            }}
          >
            {(['move', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).map(
              (handle) => (
                <CropTouch key={handle} {...{ handle, crop, width, height, onChange, disabled }} />
              ),
            )}
          </View>
        </View>
      )}
    </View>
  );
}
