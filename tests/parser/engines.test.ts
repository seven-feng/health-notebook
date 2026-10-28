import { parsePages } from '../../src/parser';
import type { LayoutPage } from '../../src/domain/types';
import firstKit from '../fixtures/first-layout.json';
import secondKit from '../fixtures/second-layout.json';
import firstPdfium from '../fixtures/first-pdfium-layout.json';
import secondPdfium from '../fixtures/second-pdfium-layout.json';
const fields = (input: LayoutPage[]) =>
  parsePages(input).map((r) => ({
    date: r.date,
    patient: r.patient,
    warnings: r.warnings,
    observations: r.observations.map(({ code, rawValue, unit, reference }) => ({
      code,
      rawValue,
      unit,
      reference,
    })),
  }));
test.each([
  [firstKit, firstPdfium],
  [secondKit, secondPdfium],
])('desktop PDFKit and PDFium preserve the same table fields', (kit, pdfium) => {
  expect(fields(pdfium as LayoutPage[])).toEqual(fields(kit as LayoutPage[]));
  expect(fields(pdfium as LayoutPage[])[0]?.observations).toHaveLength(3);
});
