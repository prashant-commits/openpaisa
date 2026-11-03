import type { StatementParser } from '../../types.js';
import { DATE_SRC } from '../common.js';
import { makeSavingsParser } from './base.js';

/** ICICI Bank savings: S No. | Value Date | Transaction Date | Cheque Number | Transaction Remarks | Withdrawal | Deposit | Balance. */
export const iciciSavings: StatementParser = makeSavingsParser({
  id: 'icici-savings-pdf',
  institution: 'ICICI Bank',
  key: 'icici',
  identity: /ICICI BANK/i,
  kindMarkers: [/Statement of Transactions in Savings Account/i, /Transaction Remarks/i, /Withdrawal Amount/i, /Deposit Amount/i, /Balance \(INR\)/i],
  accountLabel: /Account Number\s*:?\s*([X*\d]+)/i,
  tableStart: /^S No\. Value Date Transaction Date/i,
  tableEnd: /^(?:Total:|Closing Balance)/i,
  rowStart: new RegExp(`^\\d+\\s+(?:${DATE_SRC})\\s+(?<date>${DATE_SRC})\\s+(?:-\\s+)?`, 'i'),
});
