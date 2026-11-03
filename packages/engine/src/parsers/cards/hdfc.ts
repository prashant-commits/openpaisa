import type { StatementParser } from '../../types.js';
import { DATE_SRC } from '../common.js';
import { makeCardParser } from './base.js';

/** HDFC Bank credit card: DD/MM/YYYY description amount [Cr]. */
export const hdfcCard: StatementParser = makeCardParser({
  id: 'hdfc-card-pdf',
  institution: 'HDFC Bank',
  key: 'hdfc',
  identity: /HDFC BANK/i,
  kindMarkers: [/Credit Card No/i],
  cardLabel: /Credit Card No\.?\s*:?\s*([X\d ]+)/i,
  tableStart: /^Date Transaction Description Amount/i,
  tableEnd: /^Reward Points/i,
  rowStart: new RegExp(`^(?<date>${DATE_SRC})\\s+`, 'i'),
  skip: [/^(?:Domestic|International) Transactions$/i, /^Page \d+ of \d+$/i],
});
