import type { LayoutPage, Rect, Span } from '../domain/types';
import { union } from './layout';

function numbers(spans: Span[]): Span[] {
  let text = '';
  const parts = spans.map((span) => {
    const start = text.length;
    text += span.text.normalize('NFKC');
    return { start, end: text.length, rect: span.rect };
  });
  let cursor = 0;
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => {
    while (parts[cursor]!.end <= match.index!) cursor++;
    let rect = parts[cursor]!.rect;
    for (
      let i = cursor + 1;
      i < parts.length && parts[i]!.start < match.index! + match[0].length;
      i++
    )
      rect = union(rect, parts[i]!.rect);
    return { text: match[0], rect };
  });
}

// Native OCR sometimes splits a slanted printed line at a tiny decimal point.
// Recover only punctuation supported by another read of the same page region;
// never infer a value from a medical label or a plausible numeric range.
export function joinVisitDecimalFragments(source: Span[], page: LayoutPage): Span[] {
  if (page.extractionMethod !== 'ocr') return source;
  let alternatives: Span[] | undefined;
  const result: Span[] = [];
  for (let i = 0; i < source.length; i++) {
    const left = source[i]!;
    const right = source[i + 1];
    const whole = left.text.match(/(?:^|[^\d.])(\d+)\s*$/)?.[1];
    const fraction = right?.text.match(/^\s*(\d+)(?![\d.])/)?.[1];
    if (!right || !whole || !fraction || !samePrintedRow(left.rect, right.rect)) {
      result.push(left);
      continue;
    }
    const seamLeft = Math.min(left.rect.x + left.rect.width, right.rect.x);
    const seamRight = Math.max(left.rect.x + left.rect.width, right.rect.x);
    const top = Math.max(left.rect.y, right.rect.y);
    const bottom = Math.min(left.rect.y + left.rect.height, right.rect.y + right.rect.height);
    alternatives ??= [...numbers(page.numericSpans ?? []), ...numbers(page.tableSpans ?? [])];
    const evidence = alternatives.filter(
      ({ rect: r }) =>
        r.width <= 0.16 &&
        r.x <= seamLeft + 0.003 &&
        r.x + r.width >= seamRight - 0.003 &&
        r.y + r.height / 2 >= top - 0.003 &&
        r.y + r.height / 2 <= bottom + 0.003,
    );
    const decimal = `${whole}.${fraction}`;
    const supported = evidence.some((span) => span.text === decimal);
    // A read without punctuation can corroborate the digits; conflicting digits
    // or a decimal at another position must still be checked against the image.
    const conflicts = evidence.some(({ text }) => text !== decimal && text !== whole + fraction);
    if (!supported || conflicts) {
      result.push(left);
      continue;
    }
    result.push({
      ...left,
      text: `${left.text.trimEnd()}.${right.text.trimStart()}`,
      rect: union(left.rect, right.rect),
    });
    i++;
  }
  return result;
}

function samePrintedRow(left: Rect, right: Rect): boolean {
  const height = Math.min(left.height, right.height);
  const overlap =
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return (
    overlap >= height * 0.5 &&
    Math.abs(right.x - left.x - left.width) <= Math.max(0.008, height * 0.6)
  );
}
