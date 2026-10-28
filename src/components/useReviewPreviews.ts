import { useCallback, useEffect, useRef } from 'react';
import { Image } from 'react-native';
import type { DocumentRecord } from '../domain/types';
import type { ReviewGroup } from '../domain/review-groups';
import { sourcePreview, type SourceImage } from '../services/source-preview';

function previewKey(document: DocumentRecord, group: ReviewGroup) {
  return JSON.stringify([document.id, document.uri, document.pageCount, group.page, group.rect]);
}

export function useReviewPreviews(
  document: DocumentRecord | undefined,
  groups: ReviewGroup[],
  index: number,
  enabled: boolean,
) {
  const cache = useRef(new Map<string, Promise<SourceImage | undefined>>());
  const prepare = useCallback(
    (group: ReviewGroup) => {
      if (!document || !group.rect) return Promise.resolve(undefined);
      const key = previewKey(document, group);
      let request = cache.current.get(key);
      if (!request) {
        request = sourcePreview(document, group.page, group.rect)
          .then(async (image) => {
            try {
              await Image.prefetch(image.uri);
            } catch {
              // The visible image still provides retry / original-page fallback.
            }
            return image;
          })
          .catch(() => undefined);
        cache.current.set(key, request);
      }
      return request;
    },
    [document],
  );
  const previous = groups[index - 1];
  const next = groups[index + 1];
  const current = groups[index];
  useEffect(() => {
    const keep = new Set(
      document && enabled
        ? [previous, current, next].filter(Boolean).map((g) => previewKey(document, g!))
        : [],
    );
    for (const key of cache.current.keys()) if (!keep.has(key)) cache.current.delete(key);
    if (!enabled) return;
    if (previous?.rect) void prepare(previous);
    if (next?.rect) void prepare(next);
  }, [document, enabled, previous, current, next, prepare]);
  return prepare;
}
