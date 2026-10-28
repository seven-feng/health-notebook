import type { LayoutPage, Rect, Span } from '../domain/types';

export const union = (a: Rect, b: Rect): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
  height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
});

export const cx = (s: Span) => s.rect.x + s.rect.width / 2;
export const cy = (s: Span) => s.rect.y + s.rect.height / 2;
// Keep the upper middle value for even counts, as used by both table parsers.
export const median = (a: number[]) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)] ?? 0;
export const bounds = (spans: Span[]) => spans.map((s) => s.rect).reduce(union);

export function lines(page: LayoutPage): { text: string; rect: Rect }[] {
  const result: { spans: LayoutPage['spans']; rect: Rect }[] = [];
  const indexes = new Map(page.spans.map((span, index) => [span, index]));
  for (const span of [...page.spans]
    .filter((s) => s.text.trim())
    .sort(
      (a, b) => a.rect.y + a.rect.height / 2 - b.rect.y - b.rect.height / 2 || a.rect.x - b.rect.x,
    )) {
    // Overlapping glyph boxes are common in densely printed reports. Matching
    // centers prevents adjacent header/footer lines from chaining into one row.
    const center = span.rect.y + span.rect.height / 2;
    const row = result.find(
      (r) =>
        Math.abs(r.rect.y + r.rect.height / 2 - center) <
          Math.max(0.002, Math.min(r.rect.height, span.rect.height) * 0.45) ||
        (span.rect.height < r.rect.height * 0.6 &&
          center >= r.rect.y &&
          center <= r.rect.y + r.rect.height),
    );
    if (row) {
      row.spans.push(span);
      row.rect = union(row.rect, span.rect);
    } else result.push({ spans: [span], rect: span.rect });
  }
  return result.map((row) => {
    const ordered = row.spans.sort((a, b) => a.rect.x - b.rect.x);
    let text = '';
    let previous: (typeof ordered)[number] | undefined;
    for (const s of ordered) {
      const gap = previous ? s.rect.x - (previous.rect.x + previous.rect.width) : 0;
      const before = previous ? indexes.get(previous)! : -1,
        current = indexes.get(s)!;
      const hadSpace =
        previous &&
        current > before &&
        page.spans.slice(before + 1, current).some((v) => /^\s+$/.test(v.text));
      text += (gap > 0.022 ? ' | ' : hadSpace ? ' ' : '') + s.text;
      previous = s;
    }
    return { text: text.trim(), rect: bounds(ordered) };
  });
}
