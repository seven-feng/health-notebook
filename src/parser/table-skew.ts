import type { LayoutPage, Rect, Span } from '../domain/types';
import { cx, cy, median } from './layout';

// OCR emits consecutive characters from each recognized word. Agreeing local
// baselines can recover a modest camera tilt without rotating the saved image.
// This is only a fallback for tables that could not be parsed as printed.
export function alignTiltedTable(page: LayoutPage) {
  if (page.extractionMethod !== 'ocr' || !(page.width > 0 && page.height > 0)) return null;
  const pairs: { slope: number; x: number }[] = [];
  for (let i = 1; i < page.spans.length; i++) {
    const a = page.spans[i - 1]!,
      b = page.spans[i]!;
    if (!/^[\u3400-\u9fff]$/.test(a.text) || !/^[\u3400-\u9fff]$/.test(b.text)) continue;
    if (
      b.rect.x <= a.rect.x + a.rect.width * 0.6 ||
      b.rect.x >= a.rect.x + a.rect.width * 1.65 ||
      Math.abs(cy(b) - cy(a)) >= Math.min(a.rect.height, b.rect.height) * 0.32
    )
      continue;
    pairs.push({ slope: (cy(b) - cy(a)) / (cx(b) - cx(a)), x: cx(a) });
  }
  if (pairs.length < 12) return null;
  const slope = median(pairs.map((p) => p.slope));
  const physicalSlope = (slope * page.height) / page.width;
  if (!Number.isFinite(slope) || Math.abs(physicalSlope) < 0.015 || Math.abs(physicalSlope) > 0.18)
    return null;
  const agreed = pairs.filter(
    (p) => Math.abs(((p.slope - slope) * page.height) / page.width) < 0.025,
  );
  if (
    agreed.length < 12 ||
    agreed.length < pairs.length * 0.75 ||
    Math.max(...agreed.map((p) => p.x)) - Math.min(...agreed.map((p) => p.x)) < 0.25
  )
    return null;
  const align = (spans: Span[] | undefined) =>
    spans?.map((s) => ({
      ...s,
      rect: { ...s.rect, y: s.rect.y - slope * (cx(s) - 0.5) },
    }));
  // Regions exposed to the viewer/native OCR must always refer to original
  // pixels, including the vertical extent of a slanted row across its width.
  const originalRect = (rect: Rect): Rect => {
    const shifts = [slope * (rect.x - 0.5), slope * (rect.x + rect.width - 0.5)];
    const top = Math.max(0, rect.y + Math.min(...shifts));
    const bottom = Math.min(1, rect.y + rect.height + Math.max(...shifts));
    return { ...rect, y: top, height: Math.max(0, bottom - top) };
  };
  return {
    page: {
      ...page,
      spans: align(page.spans)!,
      numericSpans: align(page.numericSpans),
      tableSpans: align(page.tableSpans),
      cellSpans: align(page.cellSpans),
      readingLines: align(page.readingLines),
    },
    originalRect,
  };
}
