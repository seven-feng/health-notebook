import * as FS from 'expo-file-system/legacy';
import { LocalPdf } from '../../modules/local-pdf';

const active = new Map<string, number>();
let sessions = 0;
const maxAge = 24 * 60 * 60;

// Accept only a direct file in the picker's private cache. Normalize URLs so
// encoded traversal, another cache folder or an external source cannot qualify.
function ownedFile(uri: string): string | undefined {
  if (!FS.cacheDirectory) return;
  try {
    const root = new URL('DocumentPicker/', FS.cacheDirectory);
    const url = new URL(uri);
    if (
      url.protocol !== 'file:' ||
      url.host !== root.host ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(root.pathname)
    )
      return;
    const name = decodeURIComponent(url.pathname.slice(root.pathname.length));
    if (!name || name === '.' || name === '..' || /[/\\\u0000]/.test(name)) return;
    return root.href + encodeURIComponent(name);
  } catch {
    return;
  }
}

// File providers may preserve an old modification time while copying. Pause
// pruning throughout the native picker, before its returned URI is known.
export async function withPickerSession<T>(action: () => Promise<T>): Promise<T> {
  sessions += 1;
  try {
    return await action();
  } finally {
    sessions -= 1;
  }
}

export async function withPickerCache<T>(uri: string, action: () => Promise<T>): Promise<T> {
  const owned = ownedFile(uri);
  if (!owned) return action();
  active.set(owned, (active.get(owned) ?? 0) + 1);
  try {
    await LocalPdf.protectFile(owned);
    return await action();
  } finally {
    const remaining = active.get(owned)! - 1;
    if (remaining) active.set(owned, remaining);
    else active.delete(owned);
    // The picker only copied the source: even a rejected import can discard its
    // temporary copy. The user's external original is never touched here.
    try {
      const info = await FS.getInfoAsync(owned);
      if (!active.has(owned) && info.exists && !info.isDirectory)
        await FS.deleteAsync(owned, { idempotent: true });
    } catch {
      // Cache cleanup failure must not turn a saved import into a failed one.
      // Foreground recovery prunes abandoned copies after the retention window.
    }
  }
}

export async function cleanupStalePickerFiles(): Promise<void> {
  if (!FS.cacheDirectory || sessions) return;
  const root = new URL('DocumentPicker/', FS.cacheDirectory).href;
  const names = await FS.readDirectoryAsync(root).catch(() => [] as string[]);
  for (const name of names) {
    const uri = ownedFile(root + encodeURIComponent(name));
    if (sessions) return;
    if (!uri || active.has(uri)) continue;
    try {
      const info = await FS.getInfoAsync(uri);
      if (
        info.exists &&
        !info.isDirectory &&
        Number.isFinite(info.modificationTime) &&
        info.modificationTime < Date.now() / 1000 - maxAge &&
        !active.has(uri) &&
        !sessions
      )
        await FS.deleteAsync(uri, { idempotent: true });
    } catch {
      /* Retry on a later foreground event. */
    }
  }
}
