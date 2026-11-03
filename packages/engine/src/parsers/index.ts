import type { ParsedStatement, StatementParser } from '../types.js';
import { csvParser } from './csv.js';
import { axisCard } from './cards/axis.js';
import { hdfcCard } from './cards/hdfc.js';
import { iciciCard } from './cards/icici.js';
import { sbiCard } from './cards/sbi.js';
import { axisSavings } from './savings/axis.js';
import { hdfcSavings } from './savings/hdfc.js';
import { iciciSavings } from './savings/icici.js';
import { kotakSavings } from './savings/kotak.js';
import { sbiSavings } from './savings/sbi.js';

/** Registered parsers. Lane A adds bank/card parsers here. */
export const parsers: StatementParser[] = [hdfcSavings, iciciSavings, sbiSavings, axisSavings, kotakSavings, hdfcCard, iciciCard, sbiCard, axisCard, csvParser];

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
