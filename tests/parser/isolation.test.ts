import { buildSeries } from '../../src/domain/metrics';
import type { Report } from '../../src/domain/types';

const base: Report = {
  memberId: 'self',
  id: 'one',
  documentId: 'file',
  title: 'report',
  patient: 'person A',
  date: '2026-10-01',
  dateKind: 'sample',
  status: 'confirmed',
  template: 'test',
  warnings: [],
  createdAt: '2026-10-01',
  observations: [
    {
      id: 'o',
      name: 'same label',
      code: 'known',
      rawValue: '100',
      originalValue: '100',
      unit: 'U/L',
      specimen: 'serum',
      method: 'known',
      reference: '0-40',
      page: 0,
    },
  ],
};
test('records belonging to different people never share a metric series', () => {
  const different = {
    ...base,
    id: 'two',
    memberId: 'mom',
    patient: 'person B',
    date: '2026-10-02',
  };
  expect(buildSeries([base, different])).toHaveLength(2);
});
test('a missing patient identity cannot enter a trend', () =>
  expect(buildSeries([{ ...base, patient: '' }])).toEqual([]));

test('members with the same printed name cannot share a trend', () => {
  const other = { ...base, id: 'two', memberId: 'mom', date: '2026-10-02' };
  expect(buildSeries([base, other])).toHaveLength(2);
});

test('confirmed name variations within one member keep a single history', () => {
  const variation = {
    ...base,
    id: 'two',
    patient: 'person A alias',
    date: '2026-10-02',
    identityConfirmation: { memberName: 'person A', patient: 'person A alias' },
  };
  const groups = buildSeries([base, variation]);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.points).toHaveLength(2);
});
