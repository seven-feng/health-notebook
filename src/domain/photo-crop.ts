import type { Rect } from './types';

export type CropHandle = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'move';
export const fullCrop: Rect = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function moveCrop(crop: Rect, handle: CropHandle, dx: number, dy: number): Rect {
  if (handle === 'move')
    return {
      ...crop,
      x: clamp(crop.x + dx, 0, 1 - crop.width),
      y: clamp(crop.y + dy, 0, 1 - crop.height),
    };
  let left = crop.x,
    top = crop.y,
    right = crop.x + crop.width,
    bottom = crop.y + crop.height;
  if (handle.endsWith('Left')) left = clamp(left + dx, 0, right - 0.1);
  else right = clamp(right + dx, left + 0.1, 1);
  if (handle.startsWith('top')) top = clamp(top + dy, 0, bottom - 0.1);
  else bottom = clamp(bottom + dy, top + 0.1, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function pixelCrop(crop: Rect, width: number, height: number) {
  const originX = Math.max(0, Math.min(width - 1, Math.floor(crop.x * width)));
  const originY = Math.max(0, Math.min(height - 1, Math.floor(crop.y * height)));
  return {
    originX,
    originY,
    width: Math.max(1, Math.min(width - originX, Math.round(crop.width * width))),
    height: Math.max(1, Math.min(height - originY, Math.round(crop.height * height))),
  };
}
