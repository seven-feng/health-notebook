import { isReviewed, needsIndividualReview, reviewGroups } from '../../src/domain/review-groups';
import { reviewCopy } from '../../src/domain/review-messages';
import type { Observation, Report } from '../../src/domain/types';
const item: Observation = {
  id: 'o',
  name: '钾',
  rawValue: '3.31',
  originalValue: '3.31',
  unit: 'mmol/L',
  reference: '3.5-5.3',
  code: '',
  specimen: '',
  method: '',
  page: 0,
};
const report: Report = {
  memberId: 'self',
  id: 'r',
  documentId: 'd',
  title: '合成报告',
  patient: 'SAMPLE',
  date: '2026-10-22',
  dateKind: 'sample',
  status: 'review',
  template: null,
  warnings: [],
  createdAt: '',
  observations: [],
};

test('groups have at most five items and never span pages or table columns', () => {
  const observations = Array.from({ length: 13 }, (_, i) => ({
    ...item,
    id: String(i),
    page: i === 12 ? 1 : 0,
    sourceRect: { x: i < 7 ? 0.05 : 0.55, y: 0.2 + (i % 7) * 0.05, width: 0.4, height: 0.03 },
  }));
  const groups = reviewGroups({ ...report, observations });
  expect(groups.map((g) => g.indices)).toEqual([[0, 1, 2, 3, 4], [5, 6], [7, 8, 9, 10, 11], [12]]);
  expect(groups[0]!.rect!.x).toBe(0.05);
  expect(groups[0]!.rect!.height).toBeCloseTo(0.23);
  expect(groups[2]!.rect!.x).toBe(0.55);
  expect(groups[3]!.page).toBe(1);
});

test('missing crop coordinates never show another item as the source', () => {
  const groups = reviewGroups({
    ...report,
    observations: [
      { ...item, sourceRect: { x: 0.05, y: 0.2, width: 0.9, height: 0.03 } },
      { ...item, id: 'manual' },
    ],
  });
  expect(groups).toHaveLength(2);
  expect(groups[1]!.rect).toBeUndefined();
});

test('generic reminders need no individual check; concrete issues, edits and unknown warnings do', () => {
  expect(needsIndividualReview({ ...item, needsReview: true, warnings: [reviewCopy.item] })).toBe(
    false,
  );
  expect(
    needsIndividualReview({
      ...item,
      needsReview: true,
      warnings: ['此生化报告版式为首次适配，请逐项核对。'],
    }),
  ).toBe(false);
  for (const warnings of [
    [reviewCopy.item, reviewCopy.unit],
    ['两次识别的数值不一致'],
    ['未知识别问题'],
    [],
  ])
    expect(needsIndividualReview({ ...item, needsReview: true, warnings })).toBe(true);
  expect(needsIndividualReview({ ...item, rawValue: '0' })).toBe(false);
  expect(needsIndividualReview({ ...item, rawValue: '' })).toBe(true);
  expect(needsIndividualReview({ ...item, reportFlag: 'low' })).toBe(false);
  expect(
    needsIndividualReview({
      ...item,
      needsReview: true,
      reviewed: false,
      warnings: [reviewCopy.item],
    }),
  ).toBe(true);
  expect(
    needsIndividualReview({
      ...item,
      needsReview: false,
      reviewed: true,
      warnings: [reviewCopy.unit],
    }),
  ).toBe(false);
});

test('previous confirmations survive, while automatic extraction does not count as user review', () => {
  expect(isReviewed(report, { ...item, needsReview: false })).toBe(false);
  expect(isReviewed(report, { ...item, needsReview: false, warnings: [reviewCopy.item] })).toBe(
    true,
  );
  expect(isReviewed({ ...report, status: 'confirmed' }, item)).toBe(true);
  expect(isReviewed({ ...report, status: 'confirmed' }, { ...item, reviewed: false })).toBe(false);
  expect(isReviewed(report, { ...item, reviewed: true, needsReview: true })).toBe(false);
  expect(isReviewed(report, { ...item, reviewed: true, needsReview: false })).toBe(true);
});
