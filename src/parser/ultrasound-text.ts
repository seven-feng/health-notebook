import type { LayoutPage, Rect, Span } from '../domain/types';
import { union } from './layout';

const numbered =
  /^(?:[（(]\d{1,2}[）)]|\d{1,2}[、)）]|\d{1,2}[.．](?!\d)|[一二三四五六七八九十]+、)/;
const numericStart = /^(\d+)(?=(?:cm|mm|mL|ml|[，,。;；\s]))/;
const end = (r: Rect) => r.x + r.width;
const overlap = (a: Rect, b: Rect) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

// Native arrays retain reading order, but may contain individual glyphs with
// shared word boxes. Never concatenate evidence across a return to the left.
function evidenceRuns(spans: Span[]): Span[] {
  const runs: Span[] = [];
  let previous: Span | undefined;
  for (const span of spans) {
    if (!Object.values(span.rect).every(Number.isFinite) || !span.text.trim()) continue;
    const last = runs.at(-1);
    if (
      last &&
      previous &&
      span.rect.x >= previous.rect.x - 0.003 &&
      span.rect.x - end(previous.rect) <= Math.max(0.012, previous.rect.height) &&
      overlap(previous.rect, span.rect) >= Math.min(previous.rect.height, span.rect.height) * 0.5
    ) {
      last.text += span.text.normalize('NFKC');
      last.rect = union(last.rect, span.rect);
    } else {
      runs.push({ text: span.text.normalize('NFKC'), rect: { ...span.rect } });
    }
    previous = span;
  }
  return runs;
}

function decimalEvidence(left: Span, right: Span, runs: Span[], whole: string, fraction: string) {
  const nearby = (row: Span, run: Span, atEnd: boolean) =>
    Math.abs(atEnd ? end(row.rect) - end(run.rect) : row.rect.x - run.rect.x) <=
      Math.max(0.008, row.rect.height * 0.6) &&
    overlap(row.rect, run.rect) >= Math.min(row.rect.height, run.rect.height) * 0.5;
  const tails = runs
    .filter((r) => nearby(left, r, true))
    .flatMap((r) => {
      const value = r.text.trim().match(/(?:^|[^\d.])(\d+(?:\.\d*)?)$/)?.[1];
      return value ? [value] : [];
    });
  const heads = runs
    .filter((r) => nearby(right, r, false))
    .flatMap((r) => {
      const value = r.text.trim().match(/^(\d+(?:\.\d+)?)/)?.[1];
      return value ? [value] : [];
    });
  return (
    tails.includes(`${whole}.`) &&
    tails.every((value) => value === whole || value === `${whole}.`) &&
    heads.includes(fraction) &&
    heads.every((value) => value === fraction)
  );
}

// Reflow only adjacent, full-width wrapped lines. Keep sentence/list boundaries,
// paragraph gaps, and uncertain numeric seams. This does not correct words.
export function ultrasoundParagraph(rows: Span[], page: LayoutPage) {
  const original = rows.map((row) => row.text).join('\n');
  const warnings: string[] = [];
  const rightEdge = Math.max(...rows.map((row) => end(row.rect)));
  let runs: Span[] | undefined;
  let text = rows[0]?.text ?? '';
  for (let i = 1; i < rows.length; i++) {
    const left = rows[i - 1]!,
      right = rows[i]!;
    const adjacent =
      right.rect.y >= left.rect.y &&
      right.rect.y - left.rect.y <= Math.max(left.rect.height, right.rect.height) * 1.8 &&
      Math.abs(right.rect.x - left.rect.x) <= 0.06 &&
      rightEdge - end(left.rect) <= 0.06;
    if (!adjacent || /[。！？!?；;]$/.test(left.text) || numbered.test(right.text)) {
      text += '\n' + right.text;
      continue;
    }
    const whole = left.text.match(/(?:^|[^\d.])(\d+)$/)?.[1];
    const fraction = right.text.match(numericStart)?.[1];
    if (/\d$/.test(left.text) && /^\d/.test(right.text)) {
      if (whole && fraction && page.extractionMethod === 'ocr') {
        runs ??= [...evidenceRuns(page.numericSpans ?? []), ...evidenceRuns(page.tableSpans ?? [])];
        if (decimalEvidence(left, right, runs, whole, fraction)) {
          text += '.' + right.text;
          warnings.push('已根据同位置的另一份识别结果恢复跨行小数点，请对照原件核对。');
          continue;
        }
      }
      text += '\n' + right.text;
      warnings.push('有数字跨行且无法确认是否缺少小数点，已保留断行，请对照原件核对。');
      continue;
    }
    // A printed dot before a numeric continuation can be joined without guessing.
    const decimal = /\d\.$/.test(left.text) && fraction;
    if (/\d\.$/.test(left.text) && !decimal) {
      text += '\n' + right.text;
      warnings.push('跨行数字的单位或接续关系未识别清楚，请对照原件核对。');
      continue;
    }
    text +=
      (!decimal && /[A-Za-z0-9]$/.test(left.text) && /^[A-Za-z]/.test(right.text) ? ' ' : '') +
      right.text;
  }
  return { text, original, warnings: [...new Set(warnings)] };
}
