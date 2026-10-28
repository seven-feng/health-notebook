import { parsePages } from '../../src/parser';
import { parseLabTable } from '../../src/parser/table';
import { parseRecords } from '../../src/parser/records';
import { seriesKey } from '../../src/domain/metrics';
import { reviewCopy } from '../../src/domain/review-messages';
import type { LayoutPage, Span } from '../../src/domain/types';

// Synthetic layouts; public/medical source pixels are not packaged with tests.
function word(text: string, x: number, y: number, width = text.length * 0.012): Span[] {
  return [...text].map((text, i, chars) => ({
    text,
    confidence: 0.95,
    rect: { x: x + (width * i) / chars.length, y, width: width / chars.length, height: 0.018 },
  }));
}
function page(order: 'unit-first' | 'range-first' = 'unit-first', dual = false): LayoutPage {
  const spans: Span[] = [];
  const unit = order === 'unit-first' ? 0.64 : 0.86;
  const range = order === 'unit-first' ? 0.82 : 0.65;
  for (const offset of dual ? [0, 0.5] : [0]) {
    const scale = dual ? 0.5 : 1;
    const add = (s: Span[]) =>
      spans.push(
        ...s.map((v) => ({
          ...v,
          rect: { ...v.rect, x: offset + v.rect.x * scale, width: v.rect.width * scale },
        })),
      );
    add([
      ...word('项目名称', 0.1, 0.16),
      ...word('结果', 0.48, 0.16),
      ...word('单位', unit, 0.16),
      ...word('参考范围', range, 0.16),
    ]);
    ['白细胞计数', '红细胞计数', '血红蛋白', '血小板计数'].forEach((name, i) => {
      const y = 0.21 + i * 0.04;
      add([
        ...word(name, 0.1, y),
        ...word(i === 0 ? '0' : `${i + 1}.25`, 0.48, y),
        ...word('mg/L', unit, y),
        ...word('0.0~10.0', range, y),
      ]);
    });
  }
  return { pageIndex: 2, width: 720, height: 470, spans, extractionMethod: 'ocr' };
}

test.each(['unit-first', 'range-first'] as const)(
  'reads %s columns without a hospital template and retains zero',
  (order) => {
    const r = parsePages([page(order)])[0]!;
    expect(r.template).toBe('lab-table-v1');
    expect(r.observations).toHaveLength(4);
    expect(r.observations[0]).toMatchObject({
      name: '白细胞计数',
      rawValue: '0',
      unit: 'mg/L',
      reference: '0.0-10.0',
      needsReview: true,
    });
    expect(r.patient).toBe('');
    expect(r.date).toBe('');
    expect(r.observations.every((o) => o.page === 2 && o.sourceRect)).toBe(true);
    // Identical names across hospitals do not prove comparable methods/specimens.
    expect(seriesKey({ ...r.observations[0]!, needsReview: false })).toBeNull();
  },
);

test('keeps unequal side-by-side tables separate, in reading order', () => {
  const p = page('range-first', true);
  p.spans = p.spans.filter((s) => !(s.rect.x > 0.5 && Math.abs(s.rect.y - 0.33) < 0.001));
  const r = parseLabTable(p)!;
  expect(r.observations).toHaveLength(7);
  expect(r.observations.slice(0, 4).every((o) => o.sourceRect!.x < 0.1)).toBe(true);
  expect(r.observations.slice(4).every((o) => o.sourceRect!.x > 0.4)).toBe(true);
  expect(r.observations.map((o) => o.rawValue)).toEqual([
    '0',
    '2.25',
    '3.25',
    '4.25',
    '0',
    '2.25',
    '3.25',
  ]);
});

test('works when the entire table is shifted or the screenshot is cropped vertically', () => {
  const p = page('range-first');
  p.spans = p.spans.map((s) => ({
    ...s,
    rect: {
      ...s.rect,
      x: s.rect.x * 0.7 + 0.12,
      width: s.rect.width * 0.7,
      y: (s.rect.y - 0.15) * 4,
      height: s.rect.height * 4,
    },
  }));
  const r = parseLabTable(p)!;
  expect(r.observations).toHaveLength(4);
  for (const o of r.observations) {
    expect(o.sourceRect!.y).toBeGreaterThanOrEqual(0);
    expect(o.sourceRect!.y + o.sourceRect!.height).toBeLessThanOrEqual(1);
  }
});

test('a missing value stays empty, is flagged and can be retried in its own cell', () => {
  const p = page();
  p.spans = p.spans.filter((s) => !(s.rect.y === 0.21 && s.rect.x >= 0.48 && s.rect.x < 0.6));
  const missing = parseLabTable(p)!.observations[0]!;
  expect(missing.rawValue).toBe('');
  expect(missing.warnings).toContain(reviewCopy.missingValue);
  expect(missing.valueRect).toBeDefined();
  p.cellSpans = word('0', 0.48, 0.21);
  const recovered = parseLabTable(p)!.observations[0]!;
  expect(recovered.rawValue).toBe('0');
  expect(recovered.warnings).toContain(reviewCopy.value);
});

test('takes a secondary header only when its geometry establishes all columns', () => {
  const p = page();
  p.tableSpans = p.spans;
  p.spans = p.spans.filter((s) => s.rect.y !== 0.16);
  expect(parseLabTable(p)?.observations).toHaveLength(4);
  expect(parseLabTable({ ...p, tableSpans: undefined })).toBeNull();
});

test('arrows are provenance and are not derived from the reference range', () => {
  const p = page();
  p.spans.push(...word('↑', 0.52, 0.21));
  const r = parseLabTable(p)!;
  expect(r.observations[0]).toMatchObject({ rawValue: '0', reportFlag: 'high' });
  expect(r.observations[1]!.reportFlag).toBeUndefined();
  p.numericSpans = [...p.spans.filter((s) => s.text !== '↑'), ...word('↓', 0.52, 0.21)];
  const conflict = parseLabTable(p)!.observations[0]!;
  expect(conflict.reportFlag).toBeUndefined();
  expect(conflict.warnings).toContain(reviewCopy.marker);
});

test('two reads disagreeing on digits require explicit review', () => {
  const p = page();
  p.numericSpans = [
    ...p.spans.filter((s) => !(s.rect.y === 0.21 && s.rect.x === 0.48)),
    ...word('8', 0.48, 0.21),
  ];
  const o = parseLabTable(p)!.observations[0]!;
  expect(o.rawValue).toBe('0');
  expect(o.warnings).toContain(reviewCopy.value);
});

test('a marker between two numeric fragments cannot concatenate them', () => {
  const p = page();
  p.spans = p.spans.filter((s) => !(s.rect.y === 0.21 && s.rect.x >= 0.48 && s.rect.x < 0.6));
  p.spans.push(...word('1↑2', 0.48, 0.21));
  const o = parseLabTable(p)!.observations[0]!;
  expect(o.rawValue).not.toBe('12');
  expect(o.warnings).toContain(reviewCopy.value);
});

test('does not repair decimal commas or invent an expected unit', () => {
  const p = page();
  p.spans = p.spans.filter((s) => !(s.rect.y === 0.21 && s.rect.x >= 0.48 && s.rect.x < 0.8));
  p.spans.push(...word('2,35', 0.48, 0.21));
  const o = parseLabTable(p)!.observations[0]!;
  expect(o.rawValue).toBe('');
  expect(o.unit).toBe('');
  expect(o.warnings).toContain(reviewCopy.missingValue);
  expect(o.warnings).toContain(reviewCopy.unit);
});

test('excludes footer text even with numeric dates and a reference-like range', () => {
  const p = page();
  p.spans.push(
    ...word('采集时间', 0.1, 0.5),
    ...word('2026', 0.48, 0.5),
    ...word('mg/L', 0.64, 0.5),
    ...word('10-23', 0.82, 0.5),
  );
  expect(parseLabTable(p)?.observations).toHaveLength(4);
});

test('reference-only tables, isolated values and unreadable tables stay unsupported', () => {
  const p = page();
  expect(
    parseLabTable({
      ...p,
      spans: p.spans.filter((s) => !(s.rect.y === 0.16 && s.rect.x >= 0.48 && s.rect.x < 0.6)),
    }),
  ).toBeNull();
  expect(parseLabTable({ ...p, spans: p.spans.filter((s) => s.rect.y < 0.26) })).toBeNull();
  expect(parseLabTable({ ...p, spans: [] })).toBeNull();
  expect(
    parseLabTable({ ...p, spans: p.spans.map((s) => ({ ...s, rect: { ...s.rect, x: NaN } })) }),
  ).toBeNull();
});

function shortLab(count = 1): LayoutPage {
  return {
    pageIndex: 0,
    width: 600,
    height: 800,
    extractionMethod: 'ocr',
    spans: [
      ...word('合成医院检验报告单', 0.08, 0.06),
      ...word('姓名：测试甲', 0.08, 0.1),
      ...word('实验项目', 0.14, 0.18),
      ...word('结果', 0.37, 0.18),
      ...word('参考范園', 0.52, 0.18),
      ...word('单位', 0.7, 0.18),
      ...word('检测方法', 0.84, 0.18),
      ...Array.from({ length: count }, (_, i) => [
        ...word(`${i + 1}.合成项目${i === 0 ? '甲' : '乙'}`, 0.06, 0.22 + i * 0.04),
        ...word(i === 0 ? '27.4' : '0', 0.31, 0.22 + i * 0.04),
        ...word('2.5-24', 0.52, 0.22 + i * 0.04),
        ...word('ng/mL', 0.69, 0.22 + i * 0.04),
        ...word('合成发光法', 0.84, 0.22 + i * 0.04),
      ]).flat(),
      ...word('采集时间：2026-10-18 09:20', 0.06, 0.9),
    ],
  };
}

function tiltedLab(slope: number, count = 1): LayoutPage {
  const p = shortLab(count);
  // Keep the photo header while cropping away the sampling footer.
  p.spans = p.spans.filter((s) => s.rect.y !== 0.9);
  p.spans.push(...word('2026年10月18日', 0.66, 0.1));
  p.spans = p.spans.map((s) => ({
    ...s,
    rect: { ...s.rect, y: s.rect.y + slope * (s.rect.x + s.rect.width / 2 - 0.5) },
  }));
  return p;
}

test.each([-0.12, 0.12])(
  'a tilted short report (%s) retains the row and original source region',
  (slope) => {
    const p = tiltedLab(slope);
    const before = JSON.stringify(p);
    const r = parseRecords([p]).reports[0]!;
    expect(r).toMatchObject({ patient: '测试甲', date: '', dateKind: 'unknown' });
    expect(r.warnings).toContain(reviewCopy.date);
    expect(r.observations).toHaveLength(1);
    const item = r.observations[0]!;
    expect(item).toMatchObject({
      name: '合成项目甲',
      rawValue: '27.4',
      unit: 'ng/mL',
      reference: '2.5-24',
      needsReview: true,
    });
    const source = item.sourceRect!;
    for (const s of p.spans.filter(
      (s) => Math.abs(s.rect.y - slope * (s.rect.x + s.rect.width / 2 - 0.5) - 0.22) < 0.0001,
    )) {
      expect(s.rect.y).toBeGreaterThanOrEqual(source.y);
      expect(s.rect.y + s.rect.height).toBeLessThanOrEqual(source.y + source.height);
    }
    expect(source.y).toBeGreaterThanOrEqual(0);
    expect(source.y + source.height).toBeLessThanOrEqual(1);
    expect(JSON.stringify(p)).toBe(before);
  },
);

test('tilt recovery keeps adjacent results separate and preserves a numeric zero', () => {
  const r = parseLabTable(tiltedLab(-0.12, 2))!;
  expect(r.observations.map((o) => [o.name, o.rawValue])).toEqual([
    ['合成项目甲', '27.4'],
    ['合成项目乙', '0'],
  ]);
});

test.each(['2026年02月30日', '出生日期：2026年10月18日', '打印时间：2026年10月18日'])(
  'an invalid or unrelated header date cannot establish a short report: %s',
  (date) => {
    const p = shortLab();
    p.spans = p.spans.filter((s) => s.rect.y !== 0.9);
    p.spans.push(...word(date, 0.6, 0.13));
    expect(parseLabTable(p)).toBeNull();
  },
);

test.each(['patient', 'heading', 'reference', 'value', 'educational'])(
  'tilt recovery retains short-report evidence requirements: %s',
  (missing) => {
    const p = shortLab();
    const y = missing === 'heading' ? 0.06 : missing === 'patient' ? 0.1 : -1;
    p.spans = p.spans.filter(
      (s) =>
        s.rect.y !== y &&
        !(
          s.rect.y === 0.22 &&
          ((missing === 'reference' && s.rect.x >= 0.52 && s.rect.x < 0.65) ||
            (missing === 'value' && s.rect.x >= 0.31 && s.rect.x < 0.4))
        ),
    );
    if (missing === 'educational') p.spans.push(...word('科普示例', 0.08, 0.13));
    p.spans = p.spans.map((s) => ({
      ...s,
      rect: { ...s.rect, y: s.rect.y - 0.12 * (s.rect.x + s.rect.width / 2 - 0.5) },
    }));
    expect(parseLabTable(p)).toBeNull();
  },
);

test.each([1, 2])(
  'an identified %i-item lab report keeps the method separate from its unit',
  (count) => {
    const result = parseRecords([shortLab(count)]);
    expect(result.recordKind).toBe('report');
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      patient: '测试甲',
      date: '2026-10-18',
      dateKind: 'sample',
    });
    expect(result.reports[0]!.observations).toHaveLength(count);
    expect(result.reports[0]!.observations[0]).toMatchObject({
      name: '合成项目甲',
      rawValue: '27.4',
      unit: 'ng/mL',
      reference: '2.5-24',
      needsReview: true,
      code: '',
      method: '',
      specimen: '',
    });
    if (count === 2) expect(result.reports[0]!.observations[1]!.rawValue).toBe('0');
  },
);

test.each(['heading', 'patient', 'date', 'reference', 'value', 'educational'])(
  'short tables without sufficient report evidence stay unsupported: %s',
  (missing) => {
    const p = shortLab();
    const y =
      missing === 'heading' ? 0.06 : missing === 'patient' ? 0.1 : missing === 'date' ? 0.9 : -1;
    p.spans = p.spans.filter(
      (s) =>
        s.rect.y !== y &&
        !(
          s.rect.y === 0.22 &&
          ((missing === 'reference' && s.rect.x >= 0.52 && s.rect.x < 0.65) ||
            (missing === 'value' && s.rect.x >= 0.31 && s.rect.x < 0.4))
        ),
    );
    if (missing === 'educational') p.spans.push(...word('科普示例', 0.08, 0.13));
    expect(parseLabTable(p)).toBeNull();
  },
);

test.each(['1', '↑'])(
  'a separated marker %s cannot be glued onto the reference lower limit',
  (marker) => {
    const p = shortLab();
    p.spans.push(...word(marker, 0.47, 0.22, 0.01));
    const item = parseLabTable(p)!.observations[0]!;
    expect(item.rawValue).toBe('27.4');
    expect(item.reference).toBe('2.5-24');
    if (marker === '1') {
      expect(item.reportFlag).toBeUndefined();
      expect(item.warnings).toContain(reviewCopy.marker);
      expect(item.warnings).toContain(reviewCopy.reference);
    } else expect(item.reportFlag).toBe('high');
  },
);

test.each(['ng/ml', 'ng/ml.', 'ng/ml-', 'ng/mL-'])(
  'unit spelling %s preserves the OCR and keeps trailing noise reviewable',
  (rawUnit) => {
    const p = shortLab();
    p.spans = p.spans.filter((s) => !(s.rect.y === 0.22 && s.rect.x >= 0.69 && s.rect.x < 0.8));
    p.spans.push(...word(rawUnit, 0.69, 0.22));
    const item = parseLabTable(p)!.observations[0]!;
    expect(item.unit).toBe('ng/mL');
    expect(item.originalUnit).toBe(rawUnit);
    expect(item.rawValue).toBe('27.4');
    if (/[.-]$/.test(rawUnit)) expect(item.warnings).toContain(reviewCopy.unit);
    else expect(item.warnings).not.toContain(reviewCopy.unit);
  },
);

test('a trailing unit dot stays reviewable and two distinct reference ranges are not silently chosen', () => {
  const p = shortLab();
  p.spans.push(...word('.', 0.75, 0.22, 0.005));
  const item = parseLabTable(p)!.observations[0]!;
  expect(item.unit).toBe('ng/mL');
  expect(item.originalUnit).toBe('ng/mL.');
  expect(item.warnings).toContain(reviewCopy.unit);
  p.spans.push(...word('<1', 0.47, 0.22, 0.018));
  expect(parseLabTable(p)).toBeNull();
});

test('tall OCR characters cannot chain adjacent rows together', () => {
  const p = page();
  p.spans = p.spans.map((s) =>
    s.text === '胞' ? { ...s, rect: { ...s.rect, y: s.rect.y - 0.01, height: 0.045 } } : s,
  );
  expect(parseLabTable(p)!.observations.map((o) => o.rawValue)).toEqual([
    '0',
    '2.25',
    '3.25',
    '4.25',
  ]);
});

test('a code column after the name is not attached to the Chinese name', () => {
  const p = page();
  p.spans.push(
    ...word('代码', 0.36, 0.16),
    ...word('WBC', 0.36, 0.21),
    ...word('RBC', 0.36, 0.25),
    ...word('HGB', 0.36, 0.29),
    ...word('PLT', 0.36, 0.33),
  );
  expect(parseLabTable(p)!.observations[0]!.name).toBe('白细胞计数');
});

test.each([false, true])(
  'preserves meaningful name prefixes with preceding code column: %s',
  (withCode) => {
    const p = page();
    const names = ['C反应蛋白', 'β2微球蛋白', 'α-L-岩藻糖苷酶', '5′核苷酸酶'];
    p.spans = p.spans.filter((s) => s.rect.y === 0.16 || s.rect.x >= 0.48);
    if (withCode) p.spans.push(...word('代码', 0.02, 0.16));
    names.forEach((name, i) => {
      const y = 0.21 + i * 0.04;
      p.spans.push(...word(name, 0.1, y));
      if (withCode) p.spans.push(...word(['CRP', 'BMG', 'AFU', '5NT'][i]!, 0.02, y));
      else p.spans.push(...word(`${i + 1}`, 0.02, y));
    });
    expect(parseLabTable(p)!.observations.map((o) => o.name)).toEqual(names);
  },
);

test('retains a printed abbreviation when the separate name column is unreadable', () => {
  const p = page();
  p.spans = p.spans.filter((s) => !(s.rect.y === 0.21 && s.rect.x < 0.48));
  p.spans.push(...word('代码', 0.02, 0.16), ...word('CRP', 0.02, 0.21));
  const o = parseLabTable(p)!.observations[0]!;
  expect(o.name).toBe('CRP');
  expect(o.warnings).toContain(reviewCopy.name);
});
