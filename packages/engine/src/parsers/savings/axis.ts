import type { StatementParser } from '../../types.js';
import { DATE_SRC } from '../common.js';
import { makeSavingsParser } from './base.js';

/** Axis Bank savings: Tran Date | Chq No | Particulars | Debit | Credit | Balance | Init. Br. */
export const axisSavings: StatementParser = makeSavingsParser({
  id: 'axis-savings-pdf',
  institution: 'Axis Bank',
  key: 'axis',
  identity: /AXIS BANK/i,
  kindMarkers: [/Statement of Axis Account/i, /Tran Date/i, /Particulars/i, /Init\. Br/i, /CLOSING BALANCE/],
  accountLabel: /Account No\s*:-?\s*([X*\d]+)/i,
  tableStart: /^Tran Date Chq No Particulars/i,
  tableEnd: /^(?:TRANSACTION TOTAL|CLOSING BALANCE)/,
  rowStart: new RegExp(`^(?<date>${DATE_SRC})\\s+`, 'i'),
  // Drop the trailing branch code that follows the balance.
  cleanLine: (l) => l.replace(/(?<=\d\.\d{2})\s+\d{3,5}$/, ''),
});
