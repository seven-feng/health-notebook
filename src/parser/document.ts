import type { DocumentRecord, LayoutPage, Rect } from '../domain/types';
import { parsePages } from './index';

export const DOCUMENT_PARSER_VERSION = 4;

export function parseDocument(pages: LayoutPage[]) {
  const reports = parsePages(pages).map((r, i) => ({
    ...r,
    sourcePage: r.sourcePage ?? r.observations[0]?.page ?? pages[i]?.pageIndex ?? 0,
    sourcePages: r.sourcePages ?? [
      ...new Set([
        r.sourcePage ?? r.observations[0]?.page ?? pages[i]?.pageIndex ?? 0,
        ...r.observations.map((o) => o.page),
      ]),
    ],
    sectionKey:
      r.sectionKey ??
      `page-${r.sourcePage ?? r.observations[0]?.page ?? pages[i]?.pageIndex ?? 0}-${i}`,
  }));
  const unprocessed: { page: number; rect: Rect }[] = [];
  for (const page of pages) {
    const regions = reports.flatMap((r) =>
      r.observations
        .filter((o) => o.page === page.pageIndex)
        .flatMap((o) => (o.sourceRect ? [o.sourceRect] : o.rect ? [o.rect] : [])),
    );
    // Coverage is deliberately conservative: untouched text, pictures and
    // margins remain available. A successful table does not mean a whole page
    // (or its graphic arrows) was read.
    let remaining: Rect[] = [{ x: 0, y: 0, width: 1, height: 1 }];
    for (const region of regions)
      remaining = remaining.flatMap((rect) => {
        const left = Math.max(rect.x, region.x),
          top = Math.max(rect.y, region.y);
        const right = Math.min(rect.x + rect.width, region.x + region.width),
          bottom = Math.min(rect.y + rect.height, region.y + region.height);
        if (right <= left || bottom <= top) return [rect];
        // Keep the other column even where it shares a baseline with a known row.
        return [
          { x: rect.x, y: rect.y, width: rect.width, height: top - rect.y },
          { x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom },
          { x: rect.x, y: top, width: left - rect.x, height: bottom - top },
          { x: right, y: top, width: rect.x + rect.width - right, height: bottom - top },
        ].filter((r) => r.width > 0.0001 && r.height > 0.0001);
      });
    unprocessed.push(...remaining.map((rect) => ({ page: page.pageIndex, rect })));
  }
  const parsing: NonNullable<DocumentRecord['parsing']> = {
    version: DOCUMENT_PARSER_VERSION,
    sections: reports.map((r) => ({ key: r.sectionKey, pages: r.sourcePages, title: r.title })),
    unprocessed,
  };
  return { reports, parsing };
}
