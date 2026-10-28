import { Decimal } from 'decimal.js';
import { parseValue } from './metrics';

const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const interval = new RegExp(`^(${number})\\s*(?:-|~|～|－|–|—|至)\\s*(${number})$`);

// A bounded interval and an exact result are required to plot a position.
// Inequalities, qualitative results and ambiguous ranges retain their source text.
export function referencePosition(rawValue: string, reference: string) {
  const result = parseValue(rawValue);
  const match = reference.trim().match(interval);
  if (!result || result.operator !== '=' || !match) return null;
  const lower = parseValue(match[1]!);
  const upper = parseValue(match[2]!);
  if (!lower || !upper) return null;
  const low = new Decimal(lower.value);
  const high = new Decimal(upper.value);
  if (!high.gt(low)) return null;
  const value = new Decimal(result.value);
  const state: 'low' | 'high' | 'within' = value.lt(low) ? 'low' : value.gt(high) ? 'high' : 'within';
  // The printed interval occupies the middle half of the scale.
  const position = value.minus(low).div(high.minus(low)).times(0.5).plus(0.25);
  return {
    lower: match[1]!,
    upper: match[2]!,
    state,
    label: state === 'low' ? '低于参考范围' : state === 'high' ? '高于参考范围' : '参考范围内',
    position: Decimal.max(0.02, Decimal.min(0.98, position)).toNumber(),
    clipped: position.lt(0.02) || position.gt(0.98),
  };
}
