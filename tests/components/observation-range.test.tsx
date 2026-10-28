import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ObservationRange } from '../../src/components/ObservationRange';
import type { Observation } from '../../src/domain/types';
import { color } from '../../src/ui';

const observation: Observation = {
  id: 'o',
  name: '测试指标',
  rawValue: '0',
  originalValue: '0',
  reference: '0-0.01',
  unit: '%',
  code: '',
  specimen: '',
  method: '',
  page: 0,
};

test('zero at the lower boundary remains visible and inside the reference interval', () => {
  const screen = render(<ObservationRange observation={observation} index={0} confirmed />);
  expect(screen.getByTestId('observation-value-0').props.children).toBe('0');
  expect(screen.getByText('参考范围内')).toBeTruthy();
});

test.each([
  ['0.6', 15, 10, 15, '低于参考范围'],
  ['3.4', 75, 10, 85, '高于参考范围'],
])(
  'out-of-range result %s connects the reference boundary to its marker',
  (value, left, width, marker, label) => {
    const screen = render(
      <ObservationRange
        observation={{ ...observation, rawValue: value, reference: '1-3' }}
        index={0}
        confirmed
      />,
    );
    const line = StyleSheet.flatten(screen.getByTestId('reference-extension-0').props.style);
    const dot = StyleSheet.flatten(screen.getByTestId('reference-marker-0').props.style);
    expect(parseFloat(line.left)).toBeCloseTo(left);
    expect(parseFloat(line.width)).toBeCloseTo(width);
    expect(parseFloat(dot.left)).toBeCloseTo(marker);
    expect(line.backgroundColor).toBe(color.red);
    expect(dot.borderColor).toBe(color.red);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByTestId('observation-value-0')).toHaveTextContent(value);
  },
);

test.each(['1', '2', '3'])('result %s inside or on a boundary has no red extension', (value) => {
  const screen = render(
    <ObservationRange
      observation={{ ...observation, rawValue: value, reference: '1-3' }}
      index={0}
      confirmed
    />,
  );
  expect(screen.queryByTestId('reference-extension-0')).toBeNull();
  expect(screen.getByText('参考范围内')).toBeTruthy();
});

test.each(['-100', '100'])(
  'extreme result %s keeps the extension on the track and the clipping notice',
  (value) => {
    const screen = render(
      <ObservationRange
        observation={{ ...observation, rawValue: value, reference: '1-3' }}
        index={0}
        confirmed
      />,
    );
    const line = StyleSheet.flatten(screen.getByTestId('reference-extension-0').props.style);
    expect(parseFloat(line.left)).toBeGreaterThanOrEqual(2);
    expect(parseFloat(line.width)).toBeCloseTo(23);
    expect(parseFloat(line.left) + parseFloat(line.width)).toBeLessThanOrEqual(98);
    expect(screen.getByText('结果超出图示范围')).toBeTruthy();
  },
);

test.each([false, true])(
  'unconfirmed or uncertain results do not acquire a range status (%s)',
  (confirmed) => {
    const screen = render(
      <ObservationRange
        observation={{ ...observation, needsReview: confirmed }}
        index={0}
        confirmed={confirmed}
      />,
    );
    expect(screen.queryByTestId('reference-range-0')).toBeNull();
    expect(screen.getByText('待核对')).toBeTruthy();
    expect(screen.getByText('参考范围：0-0.01')).toBeTruthy();
  },
);

test('an inequality keeps the exact result and reference rather than inventing a point', () => {
  const screen = render(
    <ObservationRange observation={{ ...observation, rawValue: '<0.01' }} index={0} confirmed />,
  );
  expect(screen.queryByTestId('reference-range-0')).toBeNull();
  expect(screen.getByText('<0.01')).toBeTruthy();
  expect(screen.getByText('参考范围：0-0.01')).toBeTruthy();
});
