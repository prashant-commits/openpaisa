import { describe, expect, it } from 'vitest';
import { formatINR, toPaise } from '../src/money.js';

describe('money', () => {
  it('parses Indian amounts to paise', () => {
    expect(toPaise('1,23,456.78')).toBe(12345678);
    expect(toPaise('₹ 499.00')).toBe(49900);
    expect(toPaise('1,000.5 Dr')).toBe(100050);
  });
  it('formats paise in Indian grouping', () => {
    expect(formatINR(12345678)).toBe('₹1,23,456.78');
    expect(formatINR(100000)).toBe('₹1,000');
    expect(formatINR(1000000000)).toBe('₹1,00,00,000');
  });
});
