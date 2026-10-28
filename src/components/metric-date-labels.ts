export const dateLabelFontSize = 10;
const gap = 10;

type DatePoint = { date: string; x: number };
type DateLabel = {
  date: string;
  text: string;
  x: number;
  anchor: 'start' | 'middle' | 'end';
  left: number;
  right: number;
};

export function metricDateLabels(points: DatePoint[], left: number, right: number): DateLabel[] {
  if (right <= left) return [];
  const dates = [...new Map(points.map((p) => [p.date, p])).values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const spansYears = dates[0]?.date.slice(0, 4) !== dates.at(-1)?.date.slice(0, 4);
  const labels = dates.map((p, i): DateLabel => {
    const text = (spansYears ? p.date.slice(2) : p.date.slice(5)).replaceAll('-', '.');
    const x = left + p.x * (right - left);
    const anchor =
      dates.length === 1 ? 'middle' : i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle';
    // Reserve more than the normal digit/dot width at this SVG font size.
    const width = text.length * dateLabelFontSize * 0.65;
    const start = x - (anchor === 'end' ? width : anchor === 'middle' ? width / 2 : 0);
    return { date: p.date, text, x, anchor, left: start, right: start + width };
  });
  if (labels.length <= 1) return labels;
  const first = labels[0]!,
    last = labels.at(-1)!;
  // Keep real time spacing. Omit crowded axis labels, never move the data points.
  if (first.right + gap > last.left) return [last];
  const middle = labels
    .slice(1, -1)
    .filter((label) => label.left >= first.right + gap && label.right + gap <= last.left)
    .sort((a, b) => Math.abs(a.x - (left + right) / 2) - Math.abs(b.x - (left + right) / 2))[0];
  return middle ? [first, middle, last] : [first, last];
}
