import type { Transaction } from './types.js';

/** Lane A: clean merchant names, detect channel and UPI ref. Stub returns input unchanged. */
export function normaliseTransactions(txns: Transaction[]): Transaction[] {
  return txns;
}
