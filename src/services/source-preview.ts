import * as FS from 'expo-file-system/legacy';
import { LocalPdf } from '../../modules/local-pdf';
import type { DocumentRecord, Rect } from '../domain/types';
import { validRegion } from '../domain/source-region';

export type SourceImage = { uri: string; width: number; height: number };
const root = `${FS.cacheDirectory}report-previews-v1/`;
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<SourceImage>>();
const deleted = new Set<string>();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}
function folder(id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('原件标识无效');
  return `${root}${id}/`;
}

export function sourcePreview(
  doc: Pick<DocumentRecord, 'id' | 'uri' | 'pageCount'>,
  page: number,
  rect: Rect,
  refresh = false,
): Promise<SourceImage> {
  if (
    !FS.cacheDirectory ||
    !validRegion(rect) ||
    !Number.isInteger(page) ||
    page < 0 ||
    page >= doc.pageCount
  )
    return Promise.reject(new Error('无法定位原文'));
  const directory = folder(doc.id);
  const key = `${page}-${[rect.x, rect.y, rect.width, rect.height].map((v) => v.toFixed(6)).join('-')}`;
  const uri = `${directory}${key}.png`,
    metadata = `${directory}${key}.json`;
  const existing = pending.get(uri);
  if (existing) return existing;
  const next = serialized(async () => {
    if (deleted.has(doc.id)) throw new Error('原件已移除');
    try {
      if (refresh) throw new Error('Reload preview');
      const data = JSON.parse(await FS.readAsStringAsync(metadata)) as SourceImage;
      const info = await FS.getInfoAsync(uri);
      if (
        info.exists &&
        !info.isDirectory &&
        info.size > 0 &&
        Number.isFinite(data.width) &&
        Number.isFinite(data.height) &&
        data.width > 0 &&
        data.height > 0
      )
        return { uri, width: data.width, height: data.height };
    } catch {
      /* Missing or evicted cache: render again from the original, without OCR. */
    }
    await FS.makeDirectoryAsync(directory, { intermediates: true });
    await LocalPdf.protectFile(directory);
    try {
      const dimensions = await LocalPdf.renderRegion(doc.uri, page, rect, uri);
      if (deleted.has(doc.id)) throw new Error('原件已移除');
      const result = { uri, ...dimensions };
      await FS.writeAsStringAsync(metadata, JSON.stringify(dimensions));
      await LocalPdf.protectFile(metadata);
      return result;
    } catch (error) {
      await FS.deleteAsync(uri, { idempotent: true });
      await FS.deleteAsync(metadata, { idempotent: true });
      throw error;
    }
  });
  pending.set(uri, next);
  void next.finally(() => pending.delete(uri)).catch(() => {});
  return next;
}

export function clearDocumentPreviews(id: string): Promise<void> {
  deleted.add(id); // Also invalidates renders already in flight.
  return serialized(() => FS.deleteAsync(folder(id), { idempotent: true }));
}
