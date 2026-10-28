export type ImageTransform = { scale: number; x: number; y: number };
export const MAX_IMAGE_SCALE = 6;

export function boundedImage(
  transform: ImageTransform,
  width: number,
  imageHeight: number,
  viewportHeight: number,
  viewportWidth = width,
): ImageTransform {
  'worklet';
  const scale = Math.max(1, Math.min(MAX_IMAGE_SCALE, transform.scale));
  const limitX = Math.max(0, (width * scale - viewportWidth) / 2);
  const limitY = Math.max(0, (imageHeight * scale - viewportHeight) / 2);
  return {
    scale,
    x: Math.max(-limitX, Math.min(limitX, transform.x)),
    y: Math.max(-limitY, Math.min(limitY, transform.y)),
  };
}

// Coordinates are relative to the viewport centre. Keep the point between the
// fingers under the same point of the image while their distance changes.
export function scaleAtPoint(
  start: ImageTransform,
  scale: number,
  anchor: { x: number; y: number },
  focal = anchor,
): ImageTransform {
  'worklet';
  const nextScale = Math.max(1, Math.min(MAX_IMAGE_SCALE, scale));
  const ratio = nextScale / start.scale;
  return {
    scale: nextScale,
    x: focal.x - (anchor.x - start.x) * ratio,
    y: focal.y - (anchor.y - start.y) * ratio,
  };
}
