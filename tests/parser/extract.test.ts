import { LocalPdf } from '../../modules/local-pdf';
import { extractPdf } from '../../src/services/extract';
import { parseDocument } from '../../src/parser/document';
import { page, span, header, row, sectionFixture } from '../fixtures/section-layout';

jest.mock('../../modules/local-pdf', () => ({
  LocalPdf: { extract: jest.fn(), recognizeRegions: jest.fn() },
}));

beforeEach(() => jest.resetAllMocks());

test.each(['', '↑', '↓'])(
  'recovered zero should reach a section-table observation with %s',
  async (marker) => {
    const source = page(0, [
      span('合成检查', 0.1, 0.12, 0.25),
      ...header(0.2),
      ...row('零结果', marker, '0—10', 'U/L', 0.25),
    ]);
    source.extractionMethod = 'ocr';
    jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [source] });
    jest
      .mocked(LocalPdf.recognizeRegions)
      .mockImplementation(async (_uri, regions) =>
        regions.map((region) => ({ ...region, spans: [span('0', 0.46, 0.25, 0.03)] })),
      );
    const extracted = await extractPdf('file:///synthetic.pdf');
    expect(LocalPdf.recognizeRegions).toHaveBeenCalledTimes(1);
    expect(extracted.pages[0]?.cellSpans?.[0]?.text).toBe('0');
    const report = parseDocument(extracted.pages).reports[0]!;
    expect(report.template).toBe('section-table-v1');
    expect(report.observations[0]?.rawValue).toBe('0');
    expect(report.observations[0]?.reportFlag).toBe(
      marker === '↑' ? 'high' : marker === '↓' ? 'low' : undefined,
    );
  },
);

test('retry planning should preserve a preceding text-page header', async () => {
  const pages = sectionFixture().slice(0, 2);
  pages[1]!.extractionMethod = 'ocr';
  pages[1]!.spans = pages[1]!.spans.filter((s) => !(s.text === '0' && s.rect.y === 0.12));
  const missing = parseDocument(pages)
    .reports.flatMap((r) => r.observations)
    .find((o) => o.name === '项目甲')!;
  expect(missing.rawValue).toBe('');
  expect(missing.valueRect).toBeDefined();
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 2, pages });
  jest
    .mocked(LocalPdf.recognizeRegions)
    .mockImplementation(async (_uri, regions) =>
      regions.map((region) => ({ ...region, spans: [span('0', 0.46, 0.12, 0.03)] })),
    );
  const extracted = await extractPdf('file:///synthetic-cross-page.pdf');
  expect(LocalPdf.recognizeRegions).toHaveBeenCalledWith(
    'file:///synthetic-cross-page.pdf',
    expect.arrayContaining([expect.objectContaining({ pageIndex: 1, rect: missing.valueRect })]),
  );
  expect(
    parseDocument(extracted.pages)
      .reports.flatMap((r) => r.observations)
      .find((o) => o.name === '项目甲')?.rawValue,
  ).toBe('0');
});

test('oversized cells are skipped without cancelling valid retries on other pages', async () => {
  const wide = page(0, [
    span('宽表检查', 0.1, 0.12, 0.2),
    span('检查项目', 0.1, 0.2, 0.1),
    span('测量结果', 0.3, 0.2, 0.09),
    span('参考区间', 0.85, 0.2, 0.1),
    span('单位', 0.96, 0.2, 0.03),
    span('项目甲', 0.11, 0.3, 0.15),
    span('0-10', 0.86, 0.3, 0.08),
  ]);
  const valid = page(1, [
    span('单项检查', 0.1, 0.12, 0.25),
    ...header(0.2),
    ...row('项目乙', '', '0-10', 'U/L', 0.3),
  ]);
  wide.extractionMethod = valid.extractionMethod = 'ocr';
  expect(parseDocument([wide]).reports[0]!.observations[0]!.valueRect!.width).toBeGreaterThan(0.3);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 2, pages: [wide, valid] });
  jest.mocked(LocalPdf.recognizeRegions).mockResolvedValue([]);
  await extractPdf('file:///wide.pdf');
  expect(LocalPdf.recognizeRegions).toHaveBeenCalledWith('file:///wide.pdf', [
    expect.objectContaining({ pageIndex: 1 }),
  ]);
});

test('retry count stays bounded across a long document', async () => {
  const pages = Array.from({ length: 14 }, (_, i) => ({
    ...page(i, [
      span('单项检查', 0.1, 0.12, 0.25),
      ...header(0.2),
      ...row('项目甲', '', '0-10', 'U/L', 0.3),
    ]),
    extractionMethod: 'ocr' as const,
  }));
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: pages.length, pages });
  jest.mocked(LocalPdf.recognizeRegions).mockResolvedValue([]);
  await extractPdf('file:///long.pdf');
  expect(jest.mocked(LocalPdf.recognizeRegions).mock.calls[0]![1]).toHaveLength(12);
});
