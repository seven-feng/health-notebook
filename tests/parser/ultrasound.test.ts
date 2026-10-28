import { parseRecords } from '../../src/parser/records';
import { parseUltrasoundPage } from '../../src/parser/ultrasound';
import { buildMetricData } from '../../src/domain/metrics';
import { needsIndividualReview } from '../../src/domain/review-groups';
import type { LayoutPage, Report } from '../../src/domain/types';
import { ultrasoundFixture, ultrasoundText } from '../fixtures/ultrasound-layout';
import labFixture from '../fixtures/first-layout.json';
import { visitFixture } from '../fixtures/visit-layout';

test('ultrasound prose becomes reviewable report fields, retaining values, grading and source bounds', () => {
  const p = ultrasoundFixture(),
    before = JSON.stringify(p);
  const result = parseRecords([p]);
  expect(result.recordKind).toBe('report');
  expect(result.visits).toEqual([]);
  expect(result.reports).toHaveLength(1);
  const r = result.reports[0]!;
  expect(r).toMatchObject({
    reportType: 'imaging',
    template: 'ultrasound-text-v1',
    patient: '测试甲',
    date: '2026-08-16',
    dateKind: 'report',
    sourcePages: [0],
  });
  expect(r.observations.map((o) => o.name)).toEqual([
    '检查项目',
    '报告所载临床诊断',
    '检查所见',
    '报告提示',
  ]);
  expect(r.observations[2]!.rawValue).toBe(
    '原文所见示例，大小约0.23*0.41cm。\n原文第二行，保留数字与描述。',
  );
  expect(r.observations[3]!.rawValue).toBe('1. 原文分级示例 TI-RADS 3类。');
  for (const o of r.observations) {
    expect(o.originalValue).toBe(o.rawValue);
    expect(o.sourceRect).toBeDefined();
    expect(o.resultKind).toBe('text');
    expect(o.unit).toBe('');
    expect(o.needsReview).toBe(true);
    expect(needsIndividualReview(o)).toBe(false);
  }
  expect(JSON.stringify(p)).toBe(before);
});

test.each(['title', 'patient', 'findings', 'impression', 'educational'])(
  'ambiguous content remains unsupported without %s evidence',
  (missing) => {
    const p = ultrasoundFixture();
    if (missing === 'educational') p.readingLines![0]!.text += '报告示例';
    else if (missing === 'title') p.readingLines![0]!.text = '超声检查预约单';
    else if (missing === 'patient') p.readingLines![1]!.text = '性别：女';
    else if (missing === 'findings') p.readingLines![4]!.text = '其他内容';
    else p.readingLines![7]!.text = '其他内容';
    expect(parseUltrasoundPage(p)).toBeNull();
  },
);

test('side notes stay in the source crop but are not appended to the printed paragraph', () => {
  const p = ultrasoundFixture();
  p.readingLines!.push({ text: '2024 0.6×?', rect: { x: 0.6, y: 0.6, width: 0.25, height: 0.03 } });
  const r = parseUltrasoundPage(p)!;
  const finding = r.observations.find((o) => o.name === '检查所见')!;
  expect(finding.rawValue).not.toContain('0.6×');
  expect(finding.sourceRect!.y + finding.sourceRect!.height).toBeGreaterThanOrEqual(0.63);
  expect(finding.warnings).toContain('本段附近有旁注或零散文字未整理，请连同原件核对。');
  expect(needsIndividualReview(finding)).toBe(true);
});

test.each(['打印时间：2026-08-16', '出生日期：2026-08-16', '报告时间：2026-02-30'])(
  'missing or invalid report dates never use unrelated dates: %s',
  (date) => {
    const text = [...ultrasoundText];
    text[9] = date;
    expect(parseUltrasoundPage(ultrasoundFixture(text))).toMatchObject({
      date: '',
      dateKind: 'unknown',
    });
  },
);
test('an explicit exam date takes precedence; conflicting report dates stay empty', () => {
  const p = ultrasoundFixture();
  p.readingLines!.push({
    text: '检查日期：2026-08-15',
    rect: { x: 0.1, y: 0.12, width: 0.4, height: 0.02 },
  });
  expect(parseUltrasoundPage(p)).toMatchObject({ date: '2026-08-15', dateKind: 'exam' });
  p.readingLines = p.readingLines!.filter((s) => !s.text.startsWith('检查日期'));
  p.readingLines.push({
    text: '报告日期：2026-08-17',
    rect: { x: 0.1, y: 0.92, width: 0.4, height: 0.02 },
  });
  expect(parseUltrasoundPage(p)?.date).toBe('');
});

test('mixed documents preserve visit, lab and ultrasound types and original page indices', () => {
  const result = parseRecords([
    visitFixture(),
    { ...labFixture[0], pageIndex: 1 } as LayoutPage,
    { ...ultrasoundFixture(), pageIndex: 2 },
  ]);
  expect(result.recordKind).toBe('mixed');
  expect(result.visits).toHaveLength(1);
  expect(result.reports).toHaveLength(2);
  expect(result.reports.find((r) => r.reportType === 'imaging')?.sourcePages).toEqual([2]);
  expect(result.reports.find((r) => r.reportType !== 'imaging')?.observations).toHaveLength(3);
});

test('confirmed imaging text and incidental measurements never enter metric trends or text histories', () => {
  const parsed = parseRecords([ultrasoundFixture()]).reports[0]!;
  const r: Report = {
    ...parsed,
    id: 'imaging',
    documentId: 'doc',
    memberId: 'self',
    dateKind: 'report',
    status: 'confirmed',
    createdAt: '2026-10-27',
    observations: parsed.observations.map((o) => ({ ...o, needsReview: false })),
  };
  expect(buildMetricData([r])).toEqual({ groups: [], untrended: [] });
});

test('large handwritten boxes cannot widen the paragraph alignment tolerance', () => {
  const p = ultrasoundFixture();
  p.readingLines!.push({ text: '104×9', rect: { x: 0.29, y: 0.58, width: 0.1, height: 0.07 } });
  const finding = parseUltrasoundPage(p)!.observations.find((o) => o.name === '检查所见')!;
  expect(finding.rawValue).not.toContain('104×9');
  expect(finding.sourceRect!.x + finding.sourceRect!.width).toBeGreaterThanOrEqual(0.39);
  expect(finding.sourceRect!.y + finding.sourceRect!.height).toBeCloseTo(0.65);
  expect(needsIndividualReview(finding)).toBe(true);
});

test('wrapped Chinese prose is continuous while sentence and numbered findings remain separate', () => {
  const p = ultrasoundFixture();
  p.readingLines = p.readingLines!.filter((r) => r.rect.y < 0.53 || r.rect.y >= 0.65);
  p.readingLines.push(
    { text: '原文描述多个结', rect: { x: 0.1, y: 0.53, width: 0.75, height: 0.02 } },
    { text: '节，未见明显血流信', rect: { x: 0.1, y: 0.55, width: 0.75, height: 0.02 } },
    { text: '号。', rect: { x: 0.1, y: 0.57, width: 0.2, height: 0.02 } },
    { text: '另一段原文。', rect: { x: 0.1, y: 0.59, width: 0.3, height: 0.02 } },
    { text: '2. 第二项原文', rect: { x: 0.1, y: 0.72, width: 0.7, height: 0.02 } },
  );
  const before = JSON.stringify(p);
  const r = parseUltrasoundPage(p)!;
  const finding = r.observations.find((o) => o.name === '检查所见')!;
  expect(finding.rawValue).toBe('原文描述多个结节，未见明显血流信号。\n另一段原文。');
  expect(finding.originalValue).toBe('原文描述多个结\n节，未见明显血流信\n号。\n另一段原文。');
  expect(r.observations.find((o) => o.name === '报告提示')!.rawValue).toContain(
    '3类。\n2. 第二项原文',
  );
  expect(JSON.stringify(p)).toBe(before);
});
