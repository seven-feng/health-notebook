import { fullCrop, moveCrop, pixelCrop } from '../../src/domain/photo-crop';

test('crop handles stay inside the image and cannot invert or collapse the region', () => {
  const crop = moveCrop(fullCrop, 'topLeft', 0.2, 0.1);
  expect(crop).toEqual({ x: 0.2, y: 0.1, width: 0.8, height: 0.9 });
  const minimum = moveCrop(crop, 'bottomRight', -2, -2);
  expect(minimum.width).toBeCloseTo(0.1);
  expect(minimum.height).toBeCloseTo(0.1);
  expect(moveCrop(crop, 'move', 2, -2)).toEqual({
    x: expect.closeTo(0.2),
    y: 0,
    width: 0.8,
    height: 0.9,
  });
});

test('fractional selections produce a valid integer crop even at image edges', () => {
  expect(pixelCrop(fullCrop, 1001, 3001)).toEqual({
    originX: 0,
    originY: 0,
    width: 1001,
    height: 3001,
  });
  const rect = pixelCrop({ x: 0.1, y: 0.3, width: 0.9, height: 0.7 }, 1001, 3001);
  expect(rect.originX + rect.width).toBeLessThanOrEqual(1001);
  expect(rect.originY + rect.height).toBeLessThanOrEqual(3001);
  expect(rect.width).toBeGreaterThan(0);
});
