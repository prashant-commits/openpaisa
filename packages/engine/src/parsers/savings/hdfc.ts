import type { StatementParser } from '../../types.js';
import { DATE_SRC } from '../common.js';
import { makeSavingsParser } from './base.js';

/** HDFC Bank savings: Date Narration Chq./Ref.No. Value Dt Withdrawal Amt. Deposit Amt. Closing Balance. */
export const hdfcSavings: StatementParser = makeSavingsParser({
  id: 'hdfc-savings-pdf',
  institution: 'HDFC Bank',
  key: 'hdfc',
  identity: /HDFC BANK/i,
  kindMarkers: [/Statement of account/i, /Withdrawal Amt/i, /Closing Balance/i, /Narration/i, /Opening Balance/i],
  accountLabel: /Account No\s*:?\s*([X*\d]+)/i,
  tableStart: /^Date Narration Chq\.\/Ref\.No\./i,
  tableEnd: /^STATEMENT SUMMARY/i,
  rowStart: new RegExp(`^(?<date>${DATE_SRC})\\s+`, 'i'),
  valueDateBeforeAmount: true,
  skip: [/^Page \d+ of \d+$/i],
});
