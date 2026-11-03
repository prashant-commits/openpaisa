import type { StatementParser } from '../../types.js';
import { DATE_SRC } from '../common.js';
import { makeCardParser } from './base.js';

/** SBI Card: DD Mon YY details amount D|C. */
export const sbiCard: StatementParser = makeCardParser({
  id: 'sbi-card-pdf',
  institution: 'SBI Card',
  key: 'sbi',
  identity: /SBI Card/i,
  kindMarkers: [/SBI CARD AND PAYMENT SERVICES/i],
  cardLabel: /Credit Card Number\s*:?\s*([X\d ]+)/i,
  tableStart: /^Date Transaction Details Amount/i,
  tableEnd: /^\*\*\* End of Statement/i,
  rowStart: new RegExp(`^(?<date>${DATE_SRC})\\s+`, 'i'),
  letterMarkers: true,
});
