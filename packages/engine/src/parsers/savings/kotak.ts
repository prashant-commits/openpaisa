import type { StatementParser } from '../../types.js';
import { DATE_SRC } from '../common.js';
import { makeSavingsParser } from './base.js';

/** Kotak Mahindra Bank savings: Date | Narration | Chq/Ref No. | Withdrawal(Dr)/Deposit(Cr) | Balance, amounts suffixed (Dr)/(Cr). */
export const kotakSavings: StatementParser = makeSavingsParser({
  id: 'kotak-savings-pdf',
  institution: 'Kotak Mahindra Bank',
  key: 'kotak',
  identity: /KOTAK MAHINDRA BANK/i,
  kindMarkers: [/Account Statement/i, /Withdrawal\(Dr\)/i, /Narration/i, /Account No\./i, /Chq\/Ref No/i],
  accountLabel: /Account No\.?\s*:?\s*([X*\d]+)/i,
  tableStart: /^Date Narration Chq\/Ref No/i,
  tableEnd: /^Closing Balance/i,
  rowStart: new RegExp(`^(?<date>${DATE_SRC})\\s+`, 'i'),
});
