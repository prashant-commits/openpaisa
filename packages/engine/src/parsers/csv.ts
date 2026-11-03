import { toPaise } from '../money.js';
import type { Direction, IsoDate, Paise, ParsedStatement, StatementParser, Transaction } from '../types.js';
import { makeId, makeTransaction, nextSeq, parseIndianDate } from './common.js';

/** RFC 4180 split: quoted fields, escaped quotes, embedded commas and newlines, CRLF. */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      records.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); records.push(row); }
  return records;
}

interface Columns { date: number; desc: number; debit: number; credit: number; amount: number; type: number; balance: number }

function findColumns(cells: string[]): Columns | null {
  const names = cells.map((c) => c.trim().toLowerCase());
  const idx = (...tests: RegExp[]): number => {
    for (const re of tests) { const i = names.findIndex((n) => re.test(n)); if (i >= 0) return i; }
    return -1;
  };
  const date = idx(/^(?:txn|transaction|posting|trans)\.? date$/, /^date$/, /date/);
  const debit = idx(/debit|withdrawal|^dr\b/);
  const credit = idx(/credit|deposit|^cr\b/);
  const amount = idx(/^amount/, /^amt/, /\bamount\b/);
  if (date < 0 || (debit < 0 && credit < 0 && amount < 0) || names.filter(Boolean).length < 3) return null;
  return {
    date, debit, credit, amount,
    desc: idx(/description|narration|particulars|remarks|details|transaction details/),
    type: idx(/dr\s*\/\s*cr|cr\s*\/\s*dr|^type$|txn type|debit\/credit/),
    balance: idx(/balance/),
  };
}

function findHeader(records: string[][]): { at: number; cols: Columns } | null {
  for (let i = 0; i < Math.min(records.length, 20); i++) {
    const cols = findColumns(records[i]!);
    if (cols) return { at: i, cols };
  }
  return null;
}

function parseDate(s: string): IsoDate | null {
  const t = s.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return parseIndianDate(`${iso[3]}/${iso[2]}/${iso[1]}`);
  return parseIndianDate(t);
}

function money(s: string | undefined): { value: Paise; marker?: 'Dr' | 'Cr'; bracket: boolean; negative: boolean } | null {
  const raw = (s ?? '').trim();
  if (!raw || raw === '-') return null;
  const bracket = /^\(.*\)$/.test(raw);
  const negative = raw.startsWith('-');
  const marker = /\bcr\b/i.test(raw) ? 'Cr' : /\bdr\b/i.test(raw) ? 'Dr' : undefined;
  try {
    const value = toPaise(raw.replace(/[()]/g, '').replace(/^-/, ''));
    return { value, ...(marker ? { marker } : {}), bracket, negative };
  } catch { return null; }
}

export const csvParser: StatementParser = {
  id: 'generic-csv',
  institution: 'Unknown',
  detect(text) {
    const first = text.split(/\r?\n/).slice(0, 20).join('\n');
    const recs = parseCsv(first);
    return findHeader(recs) ? 0.7 : 0;
  },
  parse(text): ParsedStatement {
    const records = parseCsv(text);
    const header = findHeader(records);
    const warnings: string[] = [];
    if (!header) throw new Error('Not a recognised CSV statement: no header row with a date and an amount column.');
    const { cols } = header;
    const accountId = `csv-${makeId([records[header.at]!.map((c) => c.trim().toLowerCase()).join(',')])}`;
    const txns: Transaction[] = [];
    const seen = new Map<string, number>();
    let prev: Paise | undefined;
    // A lone Amount column that shows a leading '-' or brackets anywhere is signed: bare positives are credits.
    const signedAmounts = cols.amount >= 0 && cols.debit < 0 && cols.credit < 0 &&
      records.slice(header.at + 1).some((r) => { const a = money(r[cols.amount]); return Boolean(a && (a.negative || a.bracket)); });

    for (const rec of records.slice(header.at + 1)) {
      if (rec.every((c) => c.trim() === '')) continue;
      const dateText = rec[cols.date] ?? '';
      const date = parseDate(dateText);
      if (!date) { warnings.push(`Skipped a row with an unreadable date: ${rec.join(',').slice(0, 60)}`); continue; }

      const bal = cols.balance >= 0 ? money(rec[cols.balance]) : null;
      const balance = bal ? bal.value : undefined;
      let amount: Paise | undefined;
      let direction: Direction | undefined;
      const deb = cols.debit >= 0 ? money(rec[cols.debit]) : null;
      const cre = cols.credit >= 0 ? money(rec[cols.credit]) : null;
      if (deb && deb.value > 0) { amount = deb.value; direction = 'debit'; }
      else if (cre && cre.value > 0) { amount = cre.value; direction = 'credit'; }
      else if (cols.amount >= 0) {
        const a = money(rec[cols.amount]);
        if (a) {
          amount = a.value;
          const type = cols.type >= 0 ? (rec[cols.type] ?? '').trim().toLowerCase() : '';
          const m = a.marker ?? (/^(cr|credit|c)$/.test(type) ? 'Cr' : /^(dr|debit|d)$/.test(type) ? 'Dr' : undefined);
          if (m) direction = m === 'Cr' ? 'credit' : 'debit';
          else if (a.negative) direction = 'debit';
          else if (a.bracket) direction = 'debit';
          else if (signedAmounts) direction = 'credit';
          else if (prev !== undefined && balance !== undefined && balance !== prev) direction = balance > prev ? 'credit' : 'debit';
        }
      }
      if (balance !== undefined) prev = balance;
      if (amount === undefined || !direction) { warnings.push(`Skipped a row with no readable amount or direction: ${rec.join(',').slice(0, 60)}`); continue; }

      const desc = (cols.desc >= 0 ? rec[cols.desc] ?? '' : '').replace(/\s+/g, ' ').trim();
      const seq = nextSeq(seen, accountId, date, amount, direction, desc);
      const t = makeTransaction({ accountId, date, amount, direction, rawDescription: desc, seq, source: 'statement_csv', ...(balance !== undefined ? { balanceAfter: balance } : {}) });
      txns.push(t);
    }

    if (txns.length === 0) warnings.push('Recognised a CSV statement but found no transactions.');
    const dates = txns.map((t) => t.date).sort();
    const out: ParsedStatement = { account: { id: accountId, institution: 'Unknown', kind: 'unknown' }, transactions: txns, warnings };
    if (dates[0]) out.periodStart = dates[0];
    if (dates.length) out.periodEnd = dates[dates.length - 1]!;
    return out;
  },
};
