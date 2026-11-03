import type { IsoDate, Paise, ParsedStatement, StatementParser, Transaction } from '../../types.js';
import {
  DATE_SRC, checkBalances, findAmounts, findPeriod, labelAmount, last4Of, makeDetect, makeTransaction, nextSeq,
  parseIndianDate, splitLines, assembleRows,
} from '../common.js';

export interface SavingsConfig {
  id: string;
  institution: string;
  /** Short key used in account ids: "hdfc" gives "hdfc-sav-1234". */
  key: string;
  identity: RegExp;
  kindMarkers: RegExp[];
  /** Matches the account number line; group 1 is the (masked) number. */
  accountLabel: RegExp;
  /** The table's column header line. Rows start after the first match. */
  tableStart: RegExp;
  /** First line after the last row. */
  tableEnd: RegExp;
  /** Matches the start of a row; must have a named group `date` for the transaction date. Match[0] is stripped from the narration. */
  rowStart: RegExp;
  /** A value date sits directly before the amounts and is not part of the narration. */
  valueDateBeforeAmount?: boolean;
  /** Lines to ignore inside the table (page numbers, repeated headers). */
  skip?: RegExp[];
  /** Per-line clean-up before rows are assembled (e.g. a trailing branch code). */
  cleanLine?: (line: string) => string;
}

const CARD_MARKERS = [/Total Amount Due/i, /Minimum Amount Due/i, /Payment Due Date/i, /Credit Limit/i];
const VALUE_DATE_TAIL = new RegExp(`\\s*(?:${DATE_SRC})\\s*$`, 'i');
const looksCredit = /\b(?:CR|NEFT CR|SALARY|REFUND|REVERSAL|DEPOSIT)\b|INT\.?\s*PD|INTEREST/i;

export function makeSavingsParser(cfg: SavingsConfig): StatementParser {
  const detect = makeDetect({ identity: cfg.identity, kind: cfg.kindMarkers, anti: CARD_MARKERS });

  function parse(text: string): ParsedStatement {
    const lines = splitLines(text);
    const warnings: string[] = [];

    let last4: string | undefined;
    for (const l of lines.slice(0, 40)) {
      const m = cfg.accountLabel.exec(l);
      if (m) { last4 = last4Of(m[1]); break; }
    }
    if (!last4) warnings.push('Could not find the account number; account id uses 0000.');
    const accountId = `${cfg.key}-sav-${last4 ?? '0000'}`;

    const startIdx = lines.findIndex((l) => cfg.tableStart.test(l));
    const body: string[] = [];
    if (startIdx >= 0) {
      for (const raw of lines.slice(startIdx + 1)) {
        if (cfg.tableEnd.test(raw)) break;
        if (cfg.tableStart.test(raw) || cfg.skip?.some((r) => r.test(raw))) continue;
        body.push(cfg.cleanLine ? cfg.cleanLine(raw) : raw);
      }
    }
    const rows = assembleRows(body, (l) => cfg.rowStart.test(l));

    const openingBalance = labelAmount(text, /Opening Balance/i);
    const closingBalance = labelAmount(text, /Closing Bal(?:ance|\.)?/i);

    const txns: Transaction[] = [];
    const seen = new Map<string, number>();
    let prev: Paise | undefined = openingBalance;
    let rowWarnings = 0;
    const warn = (w: string) => { warnings.push(w); rowWarnings++; };

    for (const row of rows) {
      const m = cfg.rowStart.exec(row);
      const date: IsoDate | null = m?.groups?.date ? parseIndianDate(m.groups.date) : null;
      const rest = m ? row.slice(m[0].length) : '';
      const amts = findAmounts(rest);
      // A skipped row still moved the running balance: carry its balance forward, or forget it.
      const skipBalance = () => { prev = amts.length >= 2 ? amts[amts.length - 1]!.value : undefined; };
      if (!m || !date) { warn(`Skipped a row with an unreadable date: ${row.slice(0, 60)}`); skipBalance(); continue; }
      if (amts.length === 0) { warn(`Skipped a row with no amount: ${row.slice(0, 60)}`); prev = undefined; continue; }
      const balA = amts.length >= 2 ? amts[amts.length - 1]! : undefined;
      const amtA = amts.length >= 2 ? amts[amts.length - 2]! : amts[0]!;
      const cut = [amtA, balA].filter((x): x is NonNullable<typeof x> => Boolean(x)).sort((a, b) => a.index - b.index);
      let desc = '';
      let pos = 0;
      cut.forEach((c, i) => {
        let piece = rest.slice(pos, c.index);
        if (i === 0 && cfg.valueDateBeforeAmount) piece = piece.replace(VALUE_DATE_TAIL, '');
        desc += ' ' + piece;
        pos = c.index + c.length;
      });
      desc = (desc + ' ' + rest.slice(pos)).replace(/\s+/g, ' ').trim();

      const balance = balA?.value;
      let direction: 'debit' | 'credit';
      const fallback = (): 'debit' | 'credit' =>
        amtA.marker ? (amtA.marker === 'Cr' ? 'credit' : 'debit') : amtA.negative ? 'debit' : looksCredit.test(desc) ? 'credit' : 'debit';
      if (prev !== undefined && balance !== undefined && balance !== prev) {
        if (Math.abs(balance - prev) === amtA.value) direction = balance > prev ? 'credit' : 'debit';
        else {
          direction = fallback();
          warn(`Row on ${date} does not match the running balance: ${desc.slice(0, 50)}`);
        }
      } else direction = fallback();
      if (balance !== undefined) prev = balance;

      const seq = nextSeq(seen, accountId, date, amtA.value, direction, desc);
      txns.push(makeTransaction({ accountId, date, amount: amtA.value, direction, rawDescription: desc, seq, ...(balance !== undefined ? { balanceAfter: balance } : {}) }));
    }

    if (txns.length === 0) warnings.push(`Recognised a ${cfg.institution} statement but found no transactions.`);
    if (rowWarnings === 0) {
      const w = checkBalances(openingBalance, txns, closingBalance);
      if (w) warnings.push(w);
    }

    const period = findPeriod(startIdx > 0 ? lines.slice(0, startIdx) : lines);
    const dates = txns.map((t) => t.date).sort();
    const out: ParsedStatement = {
      account: { id: accountId, institution: cfg.institution, kind: 'savings', ...(last4 ? { last4 } : {}) },
      transactions: txns,
      warnings,
    };
    const ps = period.start ?? dates[0];
    const pe = period.end ?? dates[dates.length - 1];
    if (ps) out.periodStart = ps;
    if (pe) out.periodEnd = pe;
    if (openingBalance !== undefined) out.openingBalance = openingBalance;
    if (closingBalance !== undefined) out.closingBalance = closingBalance;
    return out;
  }

  return { id: cfg.id, institution: cfg.institution, detect, parse };
}
