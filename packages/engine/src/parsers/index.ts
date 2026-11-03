import type { ParsedStatement, StatementParser } from '../types.js';

/** Registered parsers. Lane A adds bank/card parsers here. */
export const parsers: StatementParser[] = [];

/** Pick the best parser for extracted statement text and parse it. */
export function parseStatement(text: string): ParsedStatement {
  const ranked = parsers
    .map((p) => ({ p, score: p.detect(text) }))
    .filter((x) => x.score > 0.5)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) throw new Error('Unsupported statement format. See CONTRIBUTING.md to add your bank.');
  return best.p.parse(text);
}
