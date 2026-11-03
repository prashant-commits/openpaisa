import type { StatementParser } from '../../types.js';
import { DATE_SRC } from '../common.js';
import { makeCardParser } from './base.js';

/** Axis Bank credit card: DD/MM/YYYY details amount Dr|Cr. */
export const axisCard: StatementParser = makeCardParser({
  id: 'axis-card-pdf',
  institution: 'Axis Bank',
  key: 'axis',
  identity: /AXIS BANK/i,
  kindMarkers: [/Axis Bank Credit Card Statement/i],
  cardLabel: /Card No\.?\s*:?\s*([X\d ]+)/i,
  tableStart: /^Date Transaction Details Merchant Category/i,
  tableEnd: /^End of Statement/i,
  rowStart: new RegExp(`^(?<date>${DATE_SRC})\\s+`, 'i'),
});
