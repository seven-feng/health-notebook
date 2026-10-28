import type { Observation, Rect, Report } from './types';

export function validRegion(rect: Rect | undefined): rect is Rect {
  return (
    !!rect &&
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1.000001 &&
    rect.y + rect.height <= 1.000001
  );
}

// Older saved reports contain the name/value box. Expand only known layouts;
// the user's saved values are never reparsed or overwritten to show a preview.
export function sourceRegion(report: Report, item: Observation): Rect | undefined {
  if (validRegion(item.sourceRect)) return item.sourceRect;
  if (!validRegion(item.rect)) return undefined;
  const r = item.rect;
  const dual = report.template?.startsWith('fahzu-yh-cbc-double-');
  const single = report.template?.startsWith('fahzu-yh-cbc-single-');
  if (!dual && !single) return r;
  const right = r.x >= 0.5;
  const sameColumn = report.observations.filter(
    (o) => o.page === item.page && validRegion(o.rect) && (!dual || o.rect!.x >= 0.5 === right),
  );
  const previousBottom = Math.max(
    0,
    ...sameColumn.filter((o) => o.rect!.y < r.y - 0.001).map((o) => o.rect!.y + o.rect!.height),
  );
  const nextTop = Math.min(
    1,
    ...sameColumn.filter((o) => o.rect!.y > r.y + 0.001).map((o) => o.rect!.y),
  );
  const top = Math.max(0, previousBottom, r.y - 0.004);
  // The double-table WBC marker is printed below the numeric result.
  const extra =
    dual &&
    !right &&
    (item.code.endsWith(':WBC') || item.originalName === '白细胞计数' || item.name === '白细胞计数')
      ? 0.035
      : 0.004;
  const bottom = Math.min(1, nextTop, r.y + r.height + extra);
  const result = {
    x: dual ? (right ? 0.5 : 0) : 0.05,
    y: top,
    width: dual ? (right ? 0.5 : 0.497) : 0.92,
    height: bottom - top,
  };
  return validRegion(result) ? result : undefined;
}
