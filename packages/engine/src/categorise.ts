import type { Category, Transaction } from './types.js';

/** Lane A: assign categories. `overrides` maps merchant -> category and always wins. Stub sets 'other'. */
export function categoriseTransactions(txns: Transaction[], overrides: Record<string, Category> = {}): Transaction[] {
  return txns.map((t) => ({ ...t, category: t.category ?? (t.merchant ? overrides[t.merchant] : undefined) ?? 'other' }));
}
