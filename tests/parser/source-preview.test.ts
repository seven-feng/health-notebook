import * as FS from 'expo-file-system/legacy';
import { LocalPdf } from '../../modules/local-pdf';
import { clearDocumentPreviews, sourcePreview } from '../../src/services/source-preview';
import { sourceRegion, validRegion } from '../../src/domain/source-region';
import type { Observation, Report } from '../../src/domain/types';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  readAsStringAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('../../modules/local-pdf', () => ({
  LocalPdf: { renderRegion: jest.fn(), protectFile: jest.fn() },
}));
const region = { x: 0.1, y: 0.2, width: 0.8, height: 0.03 };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(FS.readAsStringAsync).mockRejectedValue(new Error('Not cached'));
  jest.mocked(LocalPdf.renderRegion).mockResolvedValue({ width: 1600, height: 70 });
});
test('requests share one render, and an existing cache loads without invoking native rendering', async () => {
  const doc = { id: 'd-cache', uri: 'file:///doc.pdf', pageCount: 1 };
  const [a, b] = await Promise.all([sourcePreview(doc, 0, region), sourcePreview(doc, 0, region)]);
  expect(a).toEqual(b);
  expect(LocalPdf.renderRegion).toHaveBeenCalledTimes(1);
  jest.mocked(FS.readAsStringAsync).mockResolvedValue(JSON.stringify({ width: 1600, height: 70 }));
  jest
    .mocked(FS.getInfoAsync)
    .mockResolvedValue({ exists: true, isDirectory: false, size: 500 } as never);
  await sourcePreview(doc, 0, region);
  expect(LocalPdf.renderRegion).toHaveBeenCalledTimes(1);
  await sourcePreview(doc, 0, region, true);
  expect(LocalPdf.renderRegion).toHaveBeenCalledTimes(2);
});
test('deleting during rendering removes the image and prevents late recreation', async () => {
  let finish!: (value: { width: number; height: number }) => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  jest.mocked(LocalPdf.renderRegion).mockImplementation(() => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const doc = { id: 'd-deleted', uri: 'file:///doc.pdf', pageCount: 1 };
  const image = sourcePreview(doc, 0, region);
  const rejected = expect(image).rejects.toThrow('原件已移除');
  await began;
  const removed = clearDocumentPreviews(doc.id);
  finish({ width: 1000, height: 50 });
  await rejected;
  await removed;
  expect(FS.deleteAsync).toHaveBeenCalledWith('file:///cache/report-previews-v1/d-deleted/', {
    idempotent: true,
  });
  await expect(sourcePreview(doc, 0, region)).rejects.toThrow('原件已移除');
  expect(LocalPdf.renderRegion).toHaveBeenCalledTimes(1);
});
test('missing or invalid coordinates do not invent a source location', async () => {
  expect(sourceRegion({ template: null } as Report, { page: 0 } as Observation)).toBeUndefined();
  expect(validRegion({ ...region, x: NaN })).toBe(false);
  await expect(
    sourcePreview({ id: 'd-invalid', uri: 'file:///doc.pdf', pageCount: 1 }, 1, region),
  ).rejects.toThrow();
  expect(LocalPdf.renderRegion).not.toHaveBeenCalled();
});
