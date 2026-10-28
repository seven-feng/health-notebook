import { LocalPdf } from '../../modules/local-pdf';
import { parsePages } from '../parser';
import type { ExtractedPdf, OcrRegion } from '../domain/types';
import { validRegion } from '../domain/source-region';

// A short, targeted retry can recover isolated characters that full-page OCR
// skipped. An empty cell remains empty unless the original yields actual text.
export async function extractPdf(uri: string): Promise<ExtractedPdf> {
  const extracted = await LocalPdf.extract(uri);
  const ocrPages = new Set(
    extracted.pages.filter((p) => p.extractionMethod === 'ocr').map((p) => p.pageIndex),
  );
  // A continuation page may depend on a header on a preceding text page.
  // Keep that context while locating cells, then restrict the native retries.
  const seen = new Set<string>();
  const regions: OcrRegion[] = parsePages(extracted.pages)
    .flatMap((r) =>
      r.observations
        .filter((o) => !o.rawValue.trim() && ocrPages.has(o.page) && o.valueRect)
        .map((o) => ({ pageIndex: o.page, rect: o.valueRect! })),
    )
    .filter((region) => {
      const r = region.rect;
      if (
        !validRegion(r) ||
        r.width > 0.3 ||
        r.height > 0.08 ||
        r.x + r.width > 1 ||
        r.y + r.height > 1
      )
        return false;
      const key = JSON.stringify([region.pageIndex, r.x, r.y, r.width, r.height]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
  if (!regions.length) return extracted;
  try {
    const cells = await LocalPdf.recognizeRegions(uri, regions);
    return {
      ...extracted,
      pages: extracted.pages.map((p) => ({
        ...p,
        cellSpans: [
          ...(p.cellSpans ?? []),
          ...cells.filter((c) => c.pageIndex === p.pageIndex).flatMap((c) => c.spans),
        ],
      })),
    };
  } catch {
    // Preserve the initial extraction if the optional cell retry fails, including
    // when JS is running against an older development build.
    return extracted;
  }
}
