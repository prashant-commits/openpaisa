import type { StatementParser } from '../../types.js';
import { DATE_SRC } from '../common.js';
import { makeSavingsParser } from './base.js';

/** State Bank of India savings: Txn Date | Value Date | Description | Ref No./Cheque No. | Debit | Credit | Balance (DD Mon YYYY dates). */
export const sbiSavings: StatementParser = makeSavingsParser({
  id: 'sbi-savings-pdf',
  institution: 'State Bank of India',
  key: 'sbi',
  identity: /STATE BANK OF INDIA/i,
  kindMarkers: [/Account Statement/i, /Txn Date/i, /Value Date/i, /Ref No\.\/Cheque No\./i, /Debit Credit Balance/i],
  accountLabel: /Account Number\s*:?\s*([X*\d]+)/i,
  tableStart: /^Txn Date Value Date Description/i,
  tableEnd: /^(?:Closing Balance|\*\*\*)/i,
  rowStart: new RegExp(`^(?<date>${DATE_SRC})\\s+(?:${DATE_SRC})\\s+`, 'i'),
});
