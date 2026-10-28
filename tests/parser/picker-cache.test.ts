import * as FS from 'expo-file-system/legacy';
import { LocalPdf } from '../../modules/local-pdf';
import {
  withPickerCache,
  withPickerSession,
  cleanupStalePickerFiles,
} from '../../src/services/picker-cache';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
}));
jest.mock('../../modules/local-pdf', () => ({ LocalPdf: { protectFile: jest.fn() } }));
const uri = 'file:///cache/DocumentPicker/synthetic.pdf';
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(FS.getInfoAsync).mockResolvedValue({
    exists: true,
    isDirectory: false,
    uri,
    size: 100,
    modificationTime: Date.now() / 1000 - 86401,
  });
  jest.mocked(FS.readDirectoryAsync).mockResolvedValue(['synthetic.pdf']);
});
test.each(['saved', 'duplicate', 'rejected'])(
  'a %s import cleans its picker copy without touching the external original',
  async (kind) => {
    const action = jest.fn(async () => {
      expect(FS.deleteAsync).not.toHaveBeenCalled();
      if (kind === 'rejected') throw new Error('IMPORT_REJECTED');
      return kind;
    });
    if (kind === 'rejected')
      await expect(withPickerCache(uri, action)).rejects.toThrow('IMPORT_REJECTED');
    else expect(await withPickerCache(uri, action)).toBe(kind);
    expect(LocalPdf.protectFile).toHaveBeenCalledWith(uri);
    expect(FS.deleteAsync).toHaveBeenCalledTimes(1);
    expect(FS.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
  },
);
test.each([
  'file:///outside.pdf',
  'file:///cache/elsewhere.pdf',
  'file:///cache/DocumentPicker/../outside.pdf',
  'file:///cache/DocumentPicker/%2e%2e%2foutside.pdf',
  'file:///cache/DocumentPicker/nested/report.pdf',
  'content://provider/report.pdf',
])('external or unsafe paths are never removed: %s', async (source) => {
  expect(await withPickerCache(source, async () => 'kept')).toBe('kept');
  expect(FS.deleteAsync).not.toHaveBeenCalled();
  expect(LocalPdf.protectFile).not.toHaveBeenCalled();
});
test('cleanup failure preserves successful import and a later sweep retries it', async () => {
  jest.mocked(FS.deleteAsync).mockRejectedValueOnce(new Error('BUSY'));
  expect(await withPickerCache(uri, async () => 'saved')).toBe('saved');
  await cleanupStalePickerFiles();
  expect(FS.deleteAsync).toHaveBeenCalledTimes(2);
});
test('pruning ignores directories, recent copies and active imports', async () => {
  jest.mocked(FS.readDirectoryAsync).mockResolvedValue(['synthetic.pdf', 'folder', 'recent.pdf']);
  const oldInfo = await FS.getInfoAsync(uri);
  if (!oldInfo.exists) throw new Error('Fixture must exist');
  jest.mocked(FS.getInfoAsync).mockImplementation(async (file) => ({
    ...oldInfo,
    isDirectory: file.endsWith('/folder'),
    modificationTime: file.endsWith('/recent.pdf') ? Date.now() / 1000 : Date.now() / 1000 - 86401,
  }));
  await withPickerCache(uri, async () => {
    await cleanupStalePickerFiles();
    expect(FS.deleteAsync).not.toHaveBeenCalled();
  });
  expect(FS.deleteAsync).toHaveBeenCalledTimes(1);
});
test('pruning pauses while the native picker may be copying a file with an old timestamp', async () => {
  await withPickerSession(async () => {
    await cleanupStalePickerFiles();
    expect(FS.deleteAsync).not.toHaveBeenCalled();
  });
  await cleanupStalePickerFiles();
  expect(FS.deleteAsync).toHaveBeenCalledTimes(1);
});
