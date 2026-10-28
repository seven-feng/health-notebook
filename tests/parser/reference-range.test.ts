import { referencePosition } from '../../src/domain/reference-range';

test.each([
  ['76.4', '65.0-85.0', 'within', 0.535],
  ['0', '0-0.01', 'within', 0.25],
  ['0.3', '0.1～0.3', 'within', 0.75],
  ['-3', '-5--1', 'within', 0.5],
  ['8', '3.5–9.5', 'within', 0.625],
  ['11.07', '3.5-9.5', 'high', 0.8808333333],
  ['14.1', '20至50', 'low', 0.1516666667],
  ['1e-30', '0~2e-30', 'within', 0.5],
])(
  'plots %s against %s without changing boundary semantics',
  (value, reference, state, position) => {
    const result = referencePosition(value, reference);
    expect(result?.state).toBe(state);
    expect(result?.position).toBeCloseTo(position, 8);
  },
);

test.each([
  ['≤3', '0-5'],
  ['阴性', '0-5'],
  ['', '0-5'],
  ['3', ''],
  ['3', '≤5'],
  ['3', '0-0'],
  ['3', '5-0'],
  ['3', '0-5 / 10-20'],
  ['3', '成人 0-5'],
  ['3', '0-5 mg/L'],
  ['3.31↑', '0-5'],
])('keeps ambiguous or nonnumeric source text: %s / %s', (value, reference) => {
  expect(referencePosition(value, reference)).toBeNull();
});

test('a result outside the displayed scale is flagged, not represented as the boundary value', () => {
  expect(referencePosition('100', '0-40')).toMatchObject({
    state: 'high',
    position: 0.98,
    clipped: true,
    lower: '0',
    upper: '40',
  });
  expect(referencePosition('-100', '0-40')).toMatchObject({
    state: 'low',
    position: 0.02,
    clipped: true,
  });
});
