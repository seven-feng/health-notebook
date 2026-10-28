import { parsePages } from '../../src/parser';
import { parseZheyiPage } from '../../src/parser/zheyi';
import { buildSeries } from '../../src/domain/metrics';
import type { LayoutPage, Report, Span } from '../../src/domain/types';
import { resolveDocument } from '../../src/domain/files';
import type { DocumentRecord } from '../../src/domain/types';
import { extractPdf } from '../../src/services/extract';
import { LocalPdf } from '../../modules/local-pdf';
import { sourceRegion } from '../../src/domain/source-region';

jest.mock('../../modules/local-pdf', () => ({
  LocalPdf: { extract: jest.fn(), recognizeRegions: jest.fn() },
}));

function word(text: string, x: number, y: number, width = text.length * 0.009): Span[] {
  return [...text].map((char, i, chars) => ({
    text: char,
    rect: { x: x + (width * i) / chars.length, y, width: width / chars.length, height: 0.01 },
  }));
}
function page(dual = false): LayoutPage {
  const spans = [
    ...word('浙江大学医学院附属第一医院（余杭）检验报告单', 0.18, 0.005, 0.62),
    ...word('血常规（五分类）', 0.02, 0.04),
    ...word('姓名：测试人', 0.02, 0.07),
    ...word('样本类型：血液', 0.77, 0.07),
    ...word('采集时间：2026-10-01 10:00', 0.01, 0.95),
  ];
  if (dual) {
    for (const offset of [0, 0.5])
      spans.push(
        ...word('实验项目', 0.03 + offset, 0.12),
        ...word('结果', 0.23 + offset, 0.12),
        ...word('参考范围', 0.31 + offset, 0.12),
        ...word('单位', 0.44 + offset, 0.12),
      );
    spans.push(
      ...word('中性粒细胞(%)', 0.02, 0.2),
      ...word('73.3', 0.222, 0.2, 0.043),
      ...word('1', 0.273, 0.2, 0.005),
      ...word('50.0-70.0', 0.31, 0.2, 0.08),
      ...word('%', 0.45, 0.2),
    );
    spans.push(
      ...word('血红蛋白', 0.515, 0.2),
      ...word('165', 0.725, 0.2, 0.04),
      ...word('131-172', 0.81, 0.2, 0.07),
      ...word('g/L', 0.93, 0.2),
    );
  } else {
    spans.push(
      ...word('实验项目', 0.14, 0.105),
      ...word('结果', 0.45, 0.105),
      ...word('参考范围', 0.63, 0.105),
      ...word('单位', 0.87, 0.105),
    );
    spans.push(
      ...word('1.白细胞计数', 0.11, 0.15),
      ...word('8.76', 0.447, 0.15, 0.04),
      ...word('4.0-10.0', 0.64, 0.15, 0.08),
      ...word('10E9/L', 0.855, 0.15, 0.06),
    );
  }
  return { pageIndex: 0, width: 595, height: 842, extractionMethod: 'ocr', spans };
}
test('OCR fills patient, sampling date, and a normalized metric with provenance', () => {
  const r = parsePages([page()])[0]!;
  expect(r.patient).toBe('测试人');
  expect(r.date).toBe('2026-10-01');
  expect(r.dateKind).toBe('sample');
  expect(r.extractionMethod).toBe('ocr');
  expect(r.sourcePage).toBe(0);
  expect(r.observations).toEqual([
    expect.objectContaining({
      name: '白细胞计数',
      rawValue: '8.76',
      unit: '10^9/L',
      reference: '4.0-10.0',
      code: 'fahzu-yh:cbc:WBC',
    }),
  ]);
});
test('double tables remain separate and an arrow read as 1 is flagged, not added to the result', () => {
  const r = parsePages([page(true)])[0]!;
  expect(r.observations.map((o) => [o.name, o.rawValue])).toEqual([
    ['中性粒细胞(%)', '73.3'],
    ['血红蛋白', '165'],
  ]);
  expect(r.observations[0]?.needsReview).toBe(true);
  const leftBox = r.observations[0]!.sourceRect!;
  const rightBox = r.observations[1]!.sourceRect!;
  expect(leftBox.x + leftBox.width).toBeLessThanOrEqual(0.5);
  expect(leftBox.x + leftBox.width).toBeGreaterThan(0.45);
  expect(rightBox.x).toBeGreaterThanOrEqual(0.5);
  expect(rightBox.x + rightBox.width).toBe(1);
  const legacy = {
    ...r,
    observations: r.observations.map(({ sourceRect: _rect, ...o }) => o),
  } as Report;
  expect(sourceRegion(legacy, legacy.observations[1]!)?.x).toBe(0.5);
  expect(r.observations[0]?.reportFlag).toBeUndefined();
  expect(r.observations[0]?.warnings).toContain(
    '结果旁的箭头未识别清楚，请对照原报告核对数值和 ↑／↓ 标记。',
  );
  expect(
    buildSeries([
      {
        ...r,
        id: 'r',
        memberId: 'self',
        documentId: 'd',
        dateKind: 'sample',
        createdAt: '',
        status: 'confirmed',
      } as Report,
    ]).map((s) => s.name),
  ).toEqual(['血红蛋白']);
});
test.each([
  ['↑', 'high'],
  ['↓', 'low'],
] as const)('a clear %s is a report marker, not a digit or an OCR error', (arrow, flag) => {
  const p = page(true);
  p.spans = p.spans.filter((s) => !(s.rect.x === 0.273 && s.rect.y === 0.2));
  p.spans.push(...word(arrow, 0.273, 0.2, 0.005));
  const [left, right] = parsePages([p])[0]!.observations;
  expect(left).toMatchObject({ rawValue: '73.3', reportFlag: flag, needsReview: false });
  expect(right?.reportFlag).toBeUndefined();
});
test('an inline arrow is removed from a single-table number and kept as provenance', () => {
  const p = page();
  p.spans.push(...word('↑', 0.493, 0.15, 0.006));
  const o = parsePages([p])[0]!.observations[0]!;
  expect(o).toMatchObject({ rawValue: '8.76', reportFlag: 'high', needsReview: false });
  // Do not derive or override the printed flag by comparing to the reference range.
  expect(o.reference).toBe('4.0-10.0');
});
test('the arrow below WBC stays with WBC rather than the next result', () => {
  const p = page(true);
  p.spans.push(
    ...word('白细胞计数', 0.02, 0.15),
    ...word('11.07', 0.222, 0.15, 0.055),
    ...word('4.0-10.0', 0.31, 0.15, 0.08),
    ...word('10E9/L', 0.42, 0.15, 0.06),
    ...word('↑', 0.25, 0.17, 0.006),
  );
  const r = parsePages([p])[0]!;
  expect(r.observations[0]).toMatchObject({
    name: '白细胞计数',
    rawValue: '11.07',
    reportFlag: 'high',
  });
  expect(r.observations[1]?.reportFlag).toBeUndefined();
  const crop = r.observations[0]!.sourceRect!;
  expect(crop.y + crop.height).toBeGreaterThanOrEqual(0.18);
  expect(crop.y + crop.height).toBeLessThanOrEqual(0.2);
  const legacy = {
    ...r,
    observations: r.observations.map(({ sourceRect: _rect, ...o }) => o),
  } as Report;
  const legacyCrop = sourceRegion(legacy, legacy.observations[0]!)!;
  expect(legacyCrop.y + legacyCrop.height).toBeGreaterThanOrEqual(0.18);
  expect(legacyCrop.y + legacyCrop.height).toBeLessThanOrEqual(0.2);
  p.spans = p.spans.filter((s) => s.text !== '↑');
  const missedArrowCrop = parsePages([p])[0]!.observations[0]!.sourceRect!;
  expect(missedArrowCrop.y + missedArrowCrop.height).toBeGreaterThanOrEqual(0.18);
  expect(missedArrowCrop.y + missedArrowCrop.height).toBeLessThanOrEqual(0.2);
});
test('conflicting arrow directions require review without choosing a direction', () => {
  const p = page();
  p.spans.push(...word('↑', 0.52, 0.15, 0.006));
  p.numericSpans = [...p.spans.filter((s) => s.text !== '↑'), ...word('↓', 0.52, 0.15, 0.006)];
  const o = parsePages([p])[0]!.observations[0]!;
  expect(o.rawValue).toBe('8.76');
  expect(o.reportFlag).toBeUndefined();
  expect(o.needsReview).toBe(true);
});
test('a digit-like marker joined by a second OCR pass gets one precise warning', () => {
  const p = page(true);
  p.numericSpans = [{ text: '73.31', rect: { x: 0.222, y: 0.2, width: 0.057, height: 0.01 } }];
  const o = parsePages([p])[0]!.observations[0]!;
  expect(o.rawValue).toBe('73.3');
  expect(o.needsReview).toBe(true);
  expect(o.warnings).toHaveLength(1);
  expect(o.warnings?.[0]).toContain('结果旁的箭头未识别清楚');
  expect(o.reportFlag).toBeUndefined();
});
test('missing values stay empty and require review; they never become zero', () => {
  const p = page();
  p.spans = p.spans.filter((s) => !(s.rect.y === 0.15 && s.rect.x > 0.4 && s.rect.x < 0.52));
  const o = parsePages([p])[0]!.observations[0]!;
  expect(o.rawValue).toBe('');
  expect(o.needsReview).toBe(true);
});
test('a missing result gets a bounded cell retry and an actual zero remains a value', async () => {
  const p = page();
  p.spans = p.spans.filter((s) => !(s.rect.y === 0.15 && s.rect.x > 0.4 && s.rect.x < 0.52));
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [p] });
  jest
    .mocked(LocalPdf.recognizeRegions)
    .mockImplementation(async (_uri, regions) =>
      regions.map((region) => ({ ...region, spans: word('0', 0.476, 0.15, 0.006) })),
    );
  const extracted = await extractPdf('file:///report.pdf');
  const o = parsePages(extracted.pages)[0]!.observations[0]!;
  expect(LocalPdf.recognizeRegions).toHaveBeenLastCalledWith('file:///report.pdf', [
    expect.objectContaining({ pageIndex: 0, rect: expect.objectContaining({ x: 0.36 }) }),
  ]);
  expect(o).toMatchObject({ rawValue: '0', originalValue: '0', needsReview: true });
  expect(o.warnings).toContain('数值可能识别有误，请核对数字和小数点。');
  expect(o.warnings).not.toContain('结果未识别清楚，请按原报告填写。');
});
test.each(['blank', 'failed'] as const)(
  'a %s cell retry never invents a result',
  async (outcome) => {
    const p = page();
    p.spans = p.spans.filter((s) => !(s.rect.y === 0.15 && s.rect.x > 0.4 && s.rect.x < 0.52));
    jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [p] });
    if (outcome === 'failed')
      jest.mocked(LocalPdf.recognizeRegions).mockRejectedValue(new Error('OCR_FAILED'));
    else jest.mocked(LocalPdf.recognizeRegions).mockResolvedValue([]);
    const extracted = await extractPdf('file:///report.pdf');
    expect(parsePages(extracted.pages)[0]!.observations[0]).toMatchObject({
      rawValue: '',
      needsReview: true,
    });
  },
);
test('already-read zeroes do not trigger another OCR call', async () => {
  const p = page();
  p.spans = p.spans.filter((s) => !(s.rect.y === 0.15 && s.rect.x > 0.4 && s.rect.x < 0.52));
  p.spans.push(...word('0', 0.476, 0.15, 0.006));
  jest.mocked(LocalPdf.recognizeRegions).mockClear();
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [p] });
  const extracted = await extractPdf('file:///report.pdf');
  expect(parsePages(extracted.pages)[0]!.observations[0]!.rawValue).toBe('0');
  expect(LocalPdf.recognizeRegions).not.toHaveBeenCalled();
});
test('unknown layouts do not acquire fields from OCR merely because text was recognized', () => {
  const p = page();
  p.spans = p.spans.filter((s) => s.rect.y > 0.03);
  expect(parsePages([p])[0]?.template).toBeNull();
  expect(parsePages([p])[0]?.observations).toEqual([]);
});

function croppedPage(p: LayoutPage, bottom: number): LayoutPage {
  const crop = (spans: Span[]) =>
    spans
      .filter((s) => s.rect.y + s.rect.height <= bottom)
      .map((s) => ({
        ...s,
        rect: { ...s.rect, y: s.rect.y / bottom, height: s.rect.height / bottom },
      }));
  return {
    ...p,
    height: p.height * bottom,
    spans: crop(p.spans),
    numericSpans: p.numericSpans && crop(p.numericSpans),
    cellSpans: p.cellSpans && crop(p.cellSpans),
  };
}

test('cropped report screenshots retain all table rows and original image crop coordinates', () => {
  const p = page(true);
  p.spans.push(
    ...word('白细胞计数', 0.02, 0.15),
    ...word('11.07', 0.222, 0.15, 0.055),
    ...word('4.0-10.0', 0.31, 0.15, 0.08),
    ...word('10E9/L', 0.42, 0.15, 0.06),
    ...word('↑', 0.25, 0.17, 0.006),
    ...word('红细胞计数', 0.02, 0.38),
    ...word('5.53', 0.222, 0.38, 0.043),
    ...word('4.09-5.74', 0.31, 0.38, 0.08),
    ...word('10E12/L', 0.42, 0.38, 0.06),
  );
  p.numericSpans = [...p.spans];
  const full = parsePages([p])[0]!;
  const cropped = parsePages([croppedPage(p, 0.4)])[0]!;
  expect(cropped.template).toBe(full.template);
  const fields = (o: Report['observations'][number]) => ({
    name: o.name,
    rawValue: o.rawValue,
    unit: o.unit,
    reference: o.reference,
    reportFlag: o.reportFlag,
  });
  expect(cropped.observations.map(fields)).toEqual(full.observations.map(fields));
  expect(cropped.observations.find((o) => o.name === '红细胞计数')?.rect?.y).toBeCloseTo(0.95);
  for (const [i, item] of cropped.observations.entries()) {
    for (const key of ['rect', 'sourceRect', 'valueRect'] as const) {
      expect(item[key]!.y).toBeCloseTo(full.observations[i]![key]!.y / 0.4);
      expect(item[key]!.y + item[key]!.height).toBeLessThanOrEqual(1);
      expect(item[key]!.height).toBeGreaterThan(0);
    }
  }
  expect(cropped.date).toBe(''); // A missing sampling-date footer is not inferred.
});

test('cell retries on cropped screenshots use the image coordinates and retain an actual zero', async () => {
  const p = page();
  p.spans = p.spans.filter((s) => !(s.rect.y === 0.15 && s.rect.x > 0.4 && s.rect.x < 0.52));
  const cropped = croppedPage(p, 0.25);
  jest.mocked(LocalPdf.extract).mockResolvedValue({ pageCount: 1, pages: [cropped] });
  jest.mocked(LocalPdf.recognizeRegions).mockImplementation(async (_uri, regions) => {
    expect(regions).toHaveLength(1);
    expect(regions[0]!.rect.y).toBeGreaterThan(0.55);
    expect(regions[0]!.rect.y + regions[0]!.rect.height).toBeLessThan(0.7);
    return regions.map((region) => ({ ...region, spans: word('0', 0.476, 0.615, 0.006) }));
  });
  const extracted = await extractPdf('file:///cropped-report.pdf');
  expect(parsePages(extracted.pages)[0]!.observations[0]).toMatchObject({
    rawValue: '0',
    originalValue: '0',
    needsReview: true,
  });
});

test('the observed OCR typo in the hospital name is tolerated only for OCR and the verified columns', () => {
  const p = page(true);
  const hospitalChar = p.spans.find((s) => s.rect.y === 0.005 && s.text === '大')!;
  hospitalChar.text = '犬';
  expect(parsePages([p])[0]?.template).toBe('fahzu-yh-cbc-double-v3');
  expect(parseZheyiPage({ ...p, extractionMethod: 'text' })).toBeNull();
  // Explicit report identity and measured columns may now use the generic
  // short-table path, without borrowing the hospital's verified metric codes.
  const fallback = parsePages([{ ...p, extractionMethod: 'text' }])[0]!;
  expect(fallback.template).toBe('lab-table-v1');
  expect(fallback.observations.every((o) => o.needsReview && !o.code)).toBe(true);
  const shifted = {
    ...p,
    spans: p.spans.map((s) => ({ ...s, rect: { ...s.rect, x: s.rect.x + 0.1 } })),
  };
  expect(parseZheyiPage(shifted)).toBeNull();
  hospitalChar.text = '小';
  expect(parseZheyiPage(p)).toBeNull();
});
test('biochemistry uses its own columns and keeps ratios unitless with mandatory review', () => {
  const p = page(true);
  p.spans = p.spans.filter((s) => s.rect.y !== 0.04 && s.rect.y !== 0.12 && s.rect.y !== 0.2);
  p.spans.push(...word('血清肌酸激酶测定+肝肾脂糖电解质测定', 0.02, 0.04, 0.38));
  for (const offset of [0, 0.5])
    p.spans.push(
      ...word('实验项目', 0.03 + offset, 0.12),
      ...word('结果', 0.23 + offset, 0.12),
      ...word('参考区间', 0.31 + offset, 0.12),
      ...word('单位', 0.44 + offset, 0.12),
    );
  p.spans.push(
    ...word('白球蛋白比例', 0.02, 0.2),
    ...word('1.8', 0.21, 0.2, 0.04),
    ...word('1.2-2.4', 0.31, 0.2, 0.08),
    ...word('总钙', 0.515, 0.2),
    ...word('2.40', 0.7002, 0.2, 0.05),
    ...word('2.11-2.52', 0.81, 0.2, 0.07),
    ...word('mmol/L', 0.93, 0.2, 0.065),
    ...word('肌酐', 0.02, 0.23),
    ...word('65', 0.21, 0.23, 0.04),
    ...word('57-97', 0.31, 0.23, 0.08),
    ...word('Hmol/L', 0.42, 0.23, 0.07),
  );
  const result = parsePages([p])[0]!;
  expect(result.template).toBe('fahzu-yh-chemistry-double-v1');
  expect(result.observations).toHaveLength(3);
  expect(result.observations[0]).toMatchObject({ rawValue: '1.8', unit: '', needsReview: true });
  expect(result.observations[1]).toMatchObject({ unit: 'μmol/L', originalUnit: 'Hmol/L' });
  expect(result.observations[2]).toMatchObject({ rawValue: '2.40', code: 'fahzu-yh:chemistry:CA' });
  expect(result.observations.every((o) => o.needsReview)).toBe(true);
  expect(result.observations[0]!.sourceRect!.x).toBe(0);
  expect(result.observations[2]!.sourceRect!.x).toBe(0.5);
  p.spans = p.spans.filter((s) => s.rect.y !== 0.04);
  expect(parseZheyiPage(p)).toBeNull();
  const fallback = parsePages([p])[0]!;
  expect(fallback.template).toBe('lab-table-v1');
  expect(fallback.observations.every((o) => o.needsReview && !o.code)).toBe(true);
});
test('missing units are explicit suggestions that cannot enter trends before review', () => {
  const p = page();
  p.spans = p.spans.filter((s) => !(s.rect.y === 0.15 && s.rect.x > 0.82));
  const o = parsePages([p])[0]!.observations[0]!;
  expect(o.unit).toBe('10^9/L');
  expect(o.originalUnit).toBe('');
  expect(o.needsReview).toBe(true);
});
test('two OCR passes disagreeing on digits or reference ranges require review', () => {
  const p = page();
  p.numericSpans = [...word('8.16', 0.447, 0.15, 0.04), ...word('1.0-10.0', 0.64, 0.15, 0.08)];
  const o = parsePages([p])[0]!.observations[0]!;
  expect(o.rawValue).toBe('8.76');
  expect(o.reference).toBe('4.0-10.0');
  expect(o.needsReview).toBe(true);
});
test('adjacent overlapping header lines are not interleaved', () => {
  const p = page();
  p.spans.push(...word('病历号：1234567', 0.02, 0.061));
  expect(parsePages([p])[0]?.patient).toBe('测试人');
});
test('updating an iOS app cannot strand originals at the old sandbox path', () => {
  const old = {
    id: 'document-123',
    uri: 'file:///old-container/Documents/reports/document-123.pdf',
  } as DocumentRecord;
  expect(resolveDocument(old, 'file:///new-container/Documents/reports/').uri).toBe(
    'file:///new-container/Documents/reports/document-123.pdf',
  );
  expect(old.uri).toContain('old-container');
  expect(() => resolveDocument({ ...old, id: '../escape' }, 'file:///private/')).toThrow();
});

test.each([false, true])(
  'a cropped %s-column photo uses its unlabelled header date and restores trends',
  (dual) => {
    const original = page(dual);
    original.spans.push(...word('2024年05月04日', 0.63, 0.04, 0.2));
    const photo = croppedPage(original, 0.4);
    const parsed = parsePages([photo])[0]!;
    expect(parsed).toMatchObject({ date: '2024-05-04', dateKind: 'sample', dateSource: 'header' });
    expect(parsed.warnings).not.toContain('请按原报告填写采样日期；无法确认时可留空。');
    const earlier = parsePages([page(dual)])[0]!;
    const reports = [earlier, parsed].map(
      (r, i) =>
        ({
          ...r,
          id: `r${i}`,
          memberId: 'self',
          documentId: `d${i}`,
          status: 'confirmed',
          createdAt: '',
          observations: r.observations.map((o) => ({ ...o, needsReview: false })),
        }) as Report,
    );
    expect(buildSeries(reports).every((s) => s.points.length === 2)).toBe(true);
    expect(buildSeries(reports).length).toBeGreaterThan(0);
  },
);
test('an explicit sampling date takes priority over the header and report date', () => {
  const p = page();
  p.spans.push(
    ...word('2026年10月03日', 0.63, 0.04, 0.2),
    ...word('报告日期：2026-10-02', 0.6, 0.95, 0.3),
  );
  expect(parsePages([p])[0]).toMatchObject({ date: '2026-10-01', dateKind: 'sample' });
  expect(parsePages([p])[0]?.dateSource).toBeUndefined();
});
test('a long report title on the same line does not hide the separate upper-right date', () => {
  const p = page(true);
  p.spans.push(
    ...word('超敏C反应蛋白测定（急诊）', 0.25, 0.04, 0.31),
    ...word('2024年05月04日', 0.63, 0.04, 0.2),
  );
  expect(parsePages([croppedPage(p, 0.4)])[0]).toMatchObject({
    date: '2024-05-04',
    dateSource: 'header',
  });
});
test.each([
  '2026年02月30日',
  '出生日期：2024年05月04日',
  '打印日期：2024年05月04日',
  'NO.202405040123',
])('invalid or unrelated header text %s does not become a check date', (text) => {
  const p = page();
  p.spans.push(...word(text, 0.6, 0.04, 0.35));
  expect(parsePages([croppedPage(p, 0.4)])[0]?.date).toBe('');
});
test('conflicting header dates remain missing, and labelled dates are not guessed over', () => {
  const p = page();
  p.spans.push(
    ...word('2024年05月04日', 0.63, 0.04, 0.2),
    ...word('2024年05月05日', 0.63, 0.055, 0.2),
  );
  expect(parsePages([croppedPage(p, 0.4)])[0]?.date).toBe('');
  p.spans = p.spans.filter((s) => s.rect.y !== 0.055 && s.rect.y !== 0.95);
  p.spans.push(...word('采样日期：2026-02-30', 0.01, 0.95, 0.3));
  expect(parsePages([p])[0]?.date).toBe('');
});
test('an explicitly labelled report date keeps its source', () => {
  const p = page();
  p.spans = p.spans.filter((s) => s.rect.y !== 0.95);
  p.spans.push(...word('报告日期：2024-05-04', 0.6, 0.04, 0.35));
  expect(parsePages([p])[0]).toMatchObject({ date: '2024-05-04', dateKind: 'report' });
});
