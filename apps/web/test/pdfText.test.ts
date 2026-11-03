import { describe, expect, it } from 'vitest';
import { groupItemsIntoLines } from '../src/lib/pdfText';

const item = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] });

describe('groupItemsIntoLines', () => {
  it('groups shuffled items on 3 rows into 2 lines in reading order', () => {
    const lines = groupItemsIntoLines([
      item('1,000.00', 300, 680),
      item('Netflix', 120, 700.8),
      item('02/10/2026', 40, 700),
      item('Opening', 40, 680),
      item('Dr', 200, 700),
    ]);
    expect(lines).toEqual(['02/10/2026 Netflix Dr', 'Opening 1,000.00']);
  });
  it('puts higher y first and ignores blank items', () => {
    expect(groupItemsIntoLines([item('b', 0, 10), item(' ', 5, 50), item('a', 0, 50)])).toEqual(['a', 'b']);
  });
});
