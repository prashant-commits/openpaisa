import type { Transaction } from './types.js';

/** Lane A: drop duplicates across sources and card-bill double counting. Stub returns input unchanged. */
export function dedupeTransactions(txns: Transaction[]): Transaction[] {
  return txns;
}
