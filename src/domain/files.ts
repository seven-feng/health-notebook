import type { DocumentRecord } from './types';

// iOS can relocate the sandbox when updating an app. The stable identity of a
// managed original is its document id, not an absolute sandbox path saved earlier.
export function resolveDocument(
  doc: DocumentRecord,
  currentFilesDirectory: string,
): DocumentRecord {
  if (!/^[a-zA-Z0-9-]+$/.test(doc.id)) throw new Error('原件标识无效，已保留现有资料。');
  return { ...doc, uri: `${currentFilesDirectory}${doc.id}.pdf` };
}
