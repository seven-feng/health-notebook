import { validateEvent } from '../../src/services/analytics-contract';
const good = {
  id: '11111111-1111-4111-8111-111111111111',
  installation: '22222222-2222-4222-8222-222222222222',
  name: 'screen_view',
  screen: 'records',
  at: '2026-10-22T01:00:00.000Z',
  platform: 'ios',
  version: '0.1.0',
};
test('allows only fixed usage fields', () => expect(validateEvent(good)).toBe(true));
test.each(['patient', 'fileName', 'hospital', 'diagnosis', 'value', 'hash', 'errorStack'])(
  'rejects report-related or arbitrary property %s',
  (key) => expect(validateEvent({ ...good, [key]: 'sensitive' })).toBe(false),
);
test('rejects free-text route names and error messages', () => {
  expect(validateEvent({ ...good, screen: 'reports/any-patient' })).toBe(false);
  expect(validateEvent({ ...good, outcome: 'something went wrong at /private/record.pdf' })).toBe(
    false,
  );
});
