import type { StatementParser } from '../../types.js';
import { DATE_SRC } from '../common.js';
import { makeCardParser } from './base.js';

/** ICICI Bank credit card: DD/MM/YYYY SerNo. details amount [CR]. */
export const iciciCard: StatementParser = makeCardParser({
  id: 'icici-card-pdf',
  institution: 'ICICI Bank',
  key: 'icici',
  identity: /ICICI BANK/i,
  kindMarkers: [/Card Number/i, /SerNo\./i],
  cardLabel: /Card Number\s*:?\s*([X\d ]+)/i,
  tableStart: /^Date SerNo\. Transaction Details/i,
  tableEnd: /^Important Information/i,
  rowStart: new RegExp(`^(?<date>${DATE_SRC})\\s+(?:\\d{8,12}\\s+)?`, 'i'),
});
