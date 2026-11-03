import type { IsoDate, ParsedStatement, StatementParser, Transaction } from '../../types.js';
import {
  assembleRows, checkBalances, findAmounts, findPeriod, labelAmount, labelDate, last4Of, makeDetect,
  makeTransaction, nextSeq, parseIndianDate, splitLines,
} from '../common.js';

export interface CardConfig {
  id: string;
  institution: string;
  /** Short key used in account ids: "hdfc" gives "hdfc-cc-1234". */
  key: string;
  identity: RegExp;
  /** Extra markers that identify the layout (the shared card markers are always added). */
  kindMarkers?: RegExp[];
  /** Matches the card number line; group 1 is the (masked) number. */
  cardLabel: RegExp;
  /** The transactions table header line. */
  tableStart: RegExp;
  /** First line after the last row. */
  tableEnd: RegExp;
  /** Row start, with a named group `date`. Match[0] is stripped from the description. */
  rowStart: RegExp;
  /** Amount suffix is a single letter (D / C) instead of Dr / Cr. */
  letterMarkers?: boolean;
  /** Lines inside the table to ignore (section titles, page numbers). */
  skip?: RegExp[];
}

const KIND = [/Credit Card/i, /Total (?:Amount|Payment) Due/i, /Min(?:imum)? (?:Amount|Payment) Due/i, /Payment Due Date/i, /Credit Limit/i];
const SAVINGS_MARKERS = [/Withdrawal/i, /Deposit Amount/i, /Narration/i, /Particulars/i, /Opening Balance/i, /Closing Balance/i];

export function makeCardParser(cfg: CardConfig): StatementParser {
  const detect = makeDetect({ identity: cfg.identity, kind: [...KIND, ...(cfg.kindMarkers ?? [])], anti: SAVINGS_MARKERS });

  function parse(text: string): ParsedStatement {
    const lines = splitLines(text);
    const warnings: string[] = [];

    let last4: string | undefined;
    for (const l of lines.slice(0, 40)) {
      const m = cfg.cardLabel.exec(l);
      if (m) { last4 = last4Of(m[1]); break; }
    }
    if (!last4) warnings.push('Could not find the card number; account id uses 0000.');
    const accountId = `${cfg.key}-cc-${last4 ?? '0000'}`;

    const totalDue = labelAmount(text, /Total (?:Amount|Payment) Due/i);
    const minimumDue = labelAmount(text, /Min(?:imum)? (?:Amount|Payment) Due/i);
    const dueDate = labelDate(text, /Payment Due Date/i);
    const statementDate = labelDate(text, /Statement Date/i);
    const creditLimit = labelAmount(text, /Credit Limit/i);
    const previous = labelAmount(text, /Previous (?:Statement )?Balance/i);

    const startIdx = lines.findIndex((l) => cfg.tableStart.test(l));
    const body: string[] = [];
    if (startIdx >= 0) {
      for (const raw of lines.slice(startIdx + 1)) {
        if (cfg.tableEnd.test(raw)) break;
        if (cfg.skip?.some((r) => r.test(raw))) continue;
        body.push(raw);
      }
    }
    const rows = assembleRows(body, (l) => cfg.rowStart.test(l));

    const txns: Transaction[] = [];
    const seen = new Map<string, number>();
    let rowWarnings = 0;
    for (const row of rows) {
      const m = cfg.rowStart.exec(row);
      const date: IsoDate | null = m?.groups?.date ? parseIndianDate(m.groups.date) : null;
      if (!m || !date) { warnings.push(`Skipped a row with an unreadable date: ${row.slice(0, 60)}`); rowWarnings++; continue; }
      const rest = row.slice(m[0].length);
      const amts = findAmounts(rest, { letterMarkers: cfg.letterMarkers ?? false });
      const a = amts[amts.length - 1];
      if (!a) { warnings.push(`Skipped a row with no amount: ${row.slice(0, 60)}`); rowWarnings++; continue; }
      const desc = `${rest.slice(0, a.index)} ${rest.slice(a.index + a.length)}`.replace(/\s+/g, ' ').trim();
      const direction = a.marker === 'Cr' ? 'credit' : 'debit';
      const seq = nextSeq(seen, accountId, date, a.value, direction, desc);
      txns.push(makeTransaction({ accountId, date, amount: a.value, direction, rawDescription: desc, seq }));
    }

    if (txns.length === 0) warnings.push(`Recognised a ${cfg.institution} card statement but found no transactions.`);
    if (rowWarnings === 0 && txns.length > 0) {
      // Balance owed: previous + purchases - payments = total due. checkBalances works on money-in, so negate both ends.
      const w = checkBalances(previous === undefined ? undefined : -previous, txns, totalDue === undefined ? undefined : -totalDue);
      if (w) warnings.push(w.replace(/^Balance/, 'Card balance'));
    }

    const out: ParsedStatement = {
      account: { id: accountId, institution: cfg.institution, kind: 'credit_card', ...(last4 ? { last4 } : {}), ...(creditLimit !== undefined ? { creditLimit } : {}) },
      transactions: txns,
      warnings,
    };
    if (totalDue !== undefined && minimumDue !== undefined && dueDate) {
      out.card = { totalDue, minimumDue, dueDate, ...(statementDate ? { statementDate } : {}) };
    } else warnings.push('Could not read the total due, minimum due and due date.');
    const period = findPeriod(lines.slice(0, startIdx > 0 ? startIdx : 40));
    const dates = txns.map((t) => t.date).sort();
    const ps = period.start ?? dates[0];
    const pe = period.end ?? statementDate ?? dates[dates.length - 1];
    if (ps) out.periodStart = ps;
    if (pe) out.periodEnd = pe;
    if (previous !== undefined) out.openingBalance = previous;
    if (totalDue !== undefined) out.closingBalance = totalDue;
    return out;
  }

  return { id: cfg.id, institution: cfg.institution, detect, parse };
}


