# Lane A: Parsers, Normalise, Dedupe, Categorise — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn extracted statement text into clean, de-duplicated, categorised `Transaction[]` for 5 savings + 4 card formats and generic CSV.

**Architecture:** One `StatementParser` per bank × kind under `packages/engine/src/parsers/`, sharing a small line/date/amount toolkit. Normalise, dedupe and categorise are pure functions over `Transaction[]`. Everything is pure TypeScript with no I/O.

**Tech Stack:** TypeScript 5 (strict, `noUncheckedIndexedAccess`), Vitest 3, npm workspaces, Node 24.

**Spec:** `docs/tasks/lane-a-parsers.md`, `docs/ARCHITECTURE.md` (steps 1–4), contract `packages/engine/src/types.ts`.

## Global Constraints
- Edit only: `packages/engine/src/parsers/**`, `src/normalise.ts`, `src/dedupe.ts`, `src/categorise.ts`, `packages/engine/test/{parsers/**,normalise.test.ts,dedupe.test.ts,categorise.test.ts,fixtures/**}`. Never `types.ts`, `audit.ts`, `apps/`.
- Money is integer paise; use `toPaise` from `src/money.ts`. Dates are ISO `YYYY-MM-DD`.
- No network APIs, no new runtime dependencies, no `crypto` import (ids use FNV-1a).
- Fixtures are SYNTHETIC: invented names, account numbers masked `XXXXXX1234`. Never real data.
- Done = `npm run check:no-network && npm run typecheck && npm test && npm run build` green, ≥60 tests in this lane, PR to `main` titled `Lane A: parsers, normalise, dedupe, categorise`.

## Review Focus
1. **Wrapped narrations**: pdf.js splits a long description across 2–3 lines. A line with no date and no amount must be appended to the previous row's `rawDescription`, not dropped or turned into a row.
2. **Same statement uploaded twice / overlapping periods**: dedupe must collapse identical rows across two `ParsedStatement`s of the same account (same date, amount, direction, rawDescription) even without a `upiRef`.
3. **Date formats**: `03/11/2026`, `03-11-26`, `03 Nov 2026`, `03-Nov-2026`, `03 Nov 26` are all DD-first (Indian). Never parse as MM/DD. A bad date → warning, row skipped.
4. **Amount suffixes**: `1,000.00 Dr`, `1,000.00 Cr`, `(1,000.00)` and a single amount column with Dr/Cr suffix on card statements must give the correct `direction`.
5. **Unrecognised text**: `parseStatement` on random text must throw the existing "Unsupported statement format…" error; a recognised format with zero rows returns `transactions: []` and a warning, never throws.

---

## File Structure
- `src/parsers/common.ts` — `parseIndianDate`, `splitLines`, `extractAmounts`, `assembleRows`, `checkBalances`, `makeId` (FNV-1a).
- `src/parsers/savings/{hdfc,icici,sbi,axis,kotak}.ts` — one parser each.
- `src/parsers/cards/{hdfc,icici,sbi,axis}.ts` — one parser each.
- `src/parsers/csv.ts` — generic CSV parser.
- `src/parsers/index.ts` — register all.
- `src/parsers/merchants.ts` — merchant dictionary (name, patterns, category) shared by normalise and categorise.
- `test/fixtures/<bank>-<kind>.txt` — synthetic extracted text.

### Task 1: Common toolkit

**Files:** Create `src/parsers/common.ts`; Test `test/parsers/common.test.ts`

**Interfaces — Produces:**
- `parseIndianDate(s: string): IsoDate | null`
- `extractAmounts(line: string): { value: Paise; marker?: 'Dr' | 'Cr' }[]` (rightmost amounts on the line, in order)
- `assembleRows(lines: string[], isRowStart: (l: string) => boolean): string[]` (joins continuation lines with a single space)
- `checkBalances(opening: Paise | undefined, txns: Transaction[], closing: Paise | undefined): string | null` (warning text or null)
- `makeId(parts: (string | number)[]): string` (FNV-1a 32-bit, hex, 8 chars)
- `makeTransaction(p: { accountId: string; date: IsoDate; amount: Paise; direction: Direction; rawDescription: string; balanceAfter?: Paise; seq: number; source?: Source }): Transaction` (channel `'other'`, confidence 0.9, id from `makeId([accountId,date,amount,direction,rawDescription,seq])`). **`seq` is the occurrence index of an identical (accountId, date, amount, direction, rawDescription) row earlier in the same statement** — 0 for the first such row, 1 for the second — not the row's position. So the same row in two overlapping statements gets the same id (dedupe collapses it), while two genuinely identical rows in one statement get different ids (both kept).

- [ ] **Step 1: Write failing tests**
```ts
expect(parseIndianDate('03/11/2026')).toBe('2026-11-03');
expect(parseIndianDate('03-11-26')).toBe('2026-11-03');
expect(parseIndianDate('03 Nov 2026')).toBe('2026-11-03');
expect(parseIndianDate('3-Nov-26')).toBe('2026-11-03');
expect(parseIndianDate('31/02/2026')).toBeNull();
expect(extractAmounts('UPI/xyz 1,250.00 Dr 45,000.00')).toEqual([{value:125000,marker:'Dr'},{value:4500000}]);
expect(assembleRows(['01/11/2026 UPI/DR/1/SWIGGY','/swiggy@icici 250.00','02/11/2026 ATM 500.00'], l=>/^\d\d\/\d\d\/\d{4}/.test(l))).toHaveLength(2);
expect(makeId(['a',1])).toBe(makeId(['a',1])); expect(makeId(['a',1])).toMatch(/^[0-9a-f]{8}$/);
expect(checkBalances(100000,[credit 5000, debit 2000],103000)).toBeNull();
expect(checkBalances(100000,[debit 2000],103000)).toMatch(/does not reconcile/);
```
- [ ] **Step 2:** `npx vitest run test/parsers/common.test.ts -w @openpaisa/engine` → FAIL (module missing).
- [ ] **Step 3:** Implement. Two-digit years → 20YY. Month names: Jan…Dec, case-insensitive. Validate day against month length (leap years).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** `git commit -m "feat(engine): statement parsing toolkit"`

### Task 2: HDFC savings parser + fixture (the template for Task 3)

**Files:** Create `src/parsers/savings/hdfc.ts`, `test/fixtures/hdfc-savings.txt`, `test/parsers/hdfc-savings.test.ts`; Modify `src/parsers/index.ts`

**Interfaces — Produces:** `export const hdfcSavings: StatementParser` with `id: 'hdfc-savings-pdf'`, `institution: 'HDFC Bank'`. Account id format `<bank>-<kind>-<last4>`, e.g. `hdfc-sav-1234`; `<kind>` is `sav` for savings and `cc` for credit cards (e.g. `icici-cc-5678`, as Lanes B and C assume).

- [ ] **Step 1: Write fixture** (≈25 rows over 2 months): header lines containing `HDFC BANK`, `Statement of account`, `Account No : XXXXXX1234`, `Statement From : 01/09/2026 To : 31/10/2026`, `Opening Balance`; column header `Date Narration Chq./Ref.No. Value Dt Withdrawal Amt. Deposit Amt. Closing Balance`; rows `DD/MM/YY narration ref DD/MM/YY amount balance`. Include: salary NEFT credit, 3 UPI debits with `UPI-NAME-handle@bank-RRN-...`, a NACH EMI, an ACH SIP, a 2-line wrapped narration, an ATM withdrawal, a `SMS CHARGES` fee, a `CREDIT CARD PAYMENT` debit. Footer with `STATEMENT SUMMARY` opening/debits/credits/closing that reconciles.
- [ ] **Step 2: Write failing tests**
```ts
const s = hdfcSavings.parse(fixture);
expect(hdfcSavings.detect(fixture)).toBeGreaterThan(0.8);
expect(hdfcSavings.detect(iciciFixtureOrPlainText)).toBeLessThan(0.5);
expect(s.account).toMatchObject({ id:'hdfc-sav-1234', institution:'HDFC Bank', kind:'savings', last4:'1234' });
expect(s.periodStart).toBe('2026-09-01'); expect(s.periodEnd).toBe('2026-10-31');
expect(s.transactions).toHaveLength(/* rows in fixture */);
expect(s.warnings).toEqual([]);              // reconciles
// wrapped narration row keeps both parts
expect(s.transactions.some(t => t.rawDescription.includes('<part1>') && t.rawDescription.includes('<part2>'))).toBe(true);
// direction from column position: withdrawal vs deposit decided by comparing balanceAfter with previous balance
// tampered fixture (one amount changed) → warnings has 1 entry
```
- [ ] **Step 3:** Implement. Decide withdrawal vs deposit by balance delta (`prev + credit = balance`), not by column guessing; fall back to Dr/Cr markers. Register in `parsers` array.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(engine): HDFC savings parser`.

### Task 3: ICICI, SBI, Axis, Kotak savings parsers

Same shape as Task 2, one parser + fixture + test file each (`icici-savings-pdf`/`ICICI Bank`, `sbi-savings-pdf`/`State Bank of India`, `axis-savings-pdf`/`Axis Bank`, `kotak-savings-pdf`/`Kotak Mahindra Bank`). Each fixture uses that bank's public sample layout and its distinctive header text for `detect`. Per bank, tests assert: detect > 0.8 on own fixture and < 0.5 on every other fixture; account id/last4; period; row count; reconciles; one wrapped narration. SBI uses `Txn Date Value Date Description Ref No./Cheque No. Debit Credit Balance` with `DD Mon YYYY` dates — exercises the text-month path. Commit per bank.

### Task 4: Credit card parsers (HDFC, ICICI, SBI Card, Axis)

**Files:** `src/parsers/cards/{hdfc,icici,sbi,axis}.ts`, fixtures `test/fixtures/<bank>-card.txt`, tests `test/parsers/<bank>-card.test.ts`

**Interfaces — Produces:** parsers with ids `<bank>-card-pdf`; `account.kind: 'credit_card'`, `account.creditLimit`; `card: { totalDue, minimumDue, dueDate, statementDate }`; transactions with `Cr` suffix → `direction: 'credit'`.

- [ ] **Step 1: Fixtures** include: header with `Credit Limit`, `Total Amount Due`, `Minimum Amount Due`, `Payment Due Date`, `Statement Date`; rows `DD/MM/YYYY description amount [Cr]`; one payment received (Cr), one `LATE PAYMENT FEE`, one `FINANCE CHARGES`, one `IGST`/`GST` on fee, one forex txn with `MARKUP`/`CROSS CURRENCY`, one EMI conversion line (`EMI 3/12`).
- [ ] **Step 2: Tests**
```ts
expect(s.card).toEqual({ totalDue: <paise>, minimumDue: <paise>, dueDate: '2026-11-20', statementDate: '2026-10-31' });
expect(s.account.creditLimit).toBe(<paise>);
expect(s.transactions.find(t => /PAYMENT/.test(t.rawDescription))!.direction).toBe('credit');
```
Plus detect cross-checks against all savings and other card fixtures.
- [ ] **Step 3–5:** Implement, run, commit per bank.

### Task 5: Generic CSV parser

**Files:** `src/parsers/csv.ts`, `test/parsers/csv.test.ts`

**Interfaces — Produces:** `csvParser: StatementParser` id `generic-csv`, institution `'Unknown'`, `account.id: 'csv-<makeId(header)>'`, `kind: 'unknown'`, `source: 'statement_csv'`.

- [ ] **Step 1: Tests:** header auto-detection for `Date,Description,Debit,Credit,Balance`, `Txn Date,Narration,Withdrawal Amt,Deposit Amt,Closing Balance`, and a single `Amount` + `Dr/Cr` column; quoted fields with commas (`"Amazon, Pay"`); leading blank/title rows before the header; detect ≥ 0.6 only if a header row with a date column and an amount column exists, else 0.
- [ ] **Step 2–5:** Implement RFC-4180 split (quotes, escaped quotes), run, commit.

### Task 6: Normalise

**Files:** `src/normalise.ts`, `src/parsers/merchants.ts`, `test/normalise.test.ts`

**Interfaces — Produces:** `normaliseTransactions(txns: Transaction[]): Transaction[]` sets `merchant`, `channel`, `upiRef`; never changes `id`, `amount`, `date`, `direction`. It keeps a `merchant` or `upiRef` that is already set (Lane B's `runAudit` feeds pre-labelled transactions through this function), and sets `channel` when the description matches a channel pattern, else keeps the existing channel. `merchants.ts` exports `MERCHANTS: { name: string; patterns: RegExp[]; category: Category }[]` and `matchMerchant(text: string): { name: string; category: Category } | null`.

- [ ] **Step 1: Tests** (table-driven):
| rawDescription | merchant | channel | upiRef |
|---|---|---|---|
| `UPI/DR/412345678901/NETFLIX/hdfc/netflix@hdfc` | Netflix | upi | 412345678901 |
| `UPI-SWIGGY LIMITED-swiggy.rzp@icici-ICIC0000001-412345678902-PAYMENT` | Swiggy | upi | 412345678902 |
| `UPI/CR/412345678903/RAHUL SHARMA/SBIN/rahul@okaxis` | Rahul Sharma | upi | 412345678903 |
| `NACH/HDFCBANKLTD/LOAN 12345` | HDFC Bank | nach | – |
| `ACH D- BSE LIMITED-SIP` | BSE | nach | – |
| `POS 4321XXXXXXXX1234 AMAZON PAY INDIA` | Amazon | card | – |
| `NEFT CR-ACME TECH PVT LTD-SALARY OCT` | Acme Tech Pvt Ltd | neft | – |
| `IMPS/P2A/412345678904/MOM` | Mom | imps | – |
| `ATM WDL 12345 MG ROAD` | ATM | atm | – |
| `INT.PD:01-07-2026 TO 30-09-2026` | Interest | interest | – |
| `SMS CHARGES QTR` | Bank charges | fee | – |
Unknown payee names are Title Cased; dictionary names win over the raw payee.
- [ ] **Step 2–5:** Implement (dictionary first, then channel-specific regex extraction), run, commit.

### Task 7: Dedupe

**Files:** `src/dedupe.ts`, `test/dedupe.test.ts`

**Interfaces — Produces:** `dedupeTransactions(txns: Transaction[]): Transaction[]` (stable order: date asc, then original order).

- [ ] **Step 1: Tests:**
  - same `upiRef` from `sms` and `statement_pdf` → one row kept, the `statement_pdf` one. A shared `upiRef` counts as a duplicate only when amount and direction also match.
  - a UPI debit and its reversal credit carrying the same `upiRef` → both kept.
  - same amount+direction+merchant, dates 1 day apart, sources `email` and `statement_csv` → keep csv; 3 days apart → keep both.
  - same source, same account, identical date/amount/direction/rawDescription (statement uploaded twice) → one row (Review Focus 2).
  - two genuine same-day identical Swiggy orders inside ONE statement (different `seq` → different ids, same statement) → both kept.
  - savings debit `CREDIT CARD PAYMENT` ₹12,000 on 2026-10-18 + card credit `PAYMENT RECEIVED` ₹12,000 on 2026-10-19 → both kept, and both the savings debit and the card credit get `category: 'card_payment'` (so neither counts as spend or income downstream).
- [ ] **Step 2–5:** Implement. "Identical in one statement" vs "uploaded twice": treat rows as duplicates only when they come from different `ParsedStatement` uploads; since Transaction has no statement id, compare by `id` — the same row parsed twice gets the same deterministic id. Run, commit.

### Task 8: Categorise

**Files:** `src/categorise.ts`, extend `src/parsers/merchants.ts` to ≥200 entries, `test/categorise.test.ts`

**Interfaces — Produces:** `categoriseTransactions(txns, overrides?)` unchanged signature. Order: `overrides[merchant]` → existing `category` (e.g. `card_payment` from dedupe) → dictionary → keyword rules (`SALARY`→salary on credit; `INT.PD|INTEREST`→interest; `CHARGES|FEE|GST|PENALTY`→fees_charges; `EMI|LOAN`→emi; `SIP|BSE|NSE|MUTUAL`→investments; `ATM`→cash_withdrawal; `REFUND|REVERSAL` on credit→refund; `PAYMENT RECEIVED|THANK YOU` on a credit to a card account (account id contains `-cc-`)→card_payment; P2P UPI→transfers) → `'other'`.
- [ ] **Step 1: Tests:** one per keyword rule; overrides beat dictionary; existing `card_payment` preserved; ≥30 spot-checks of dictionary merchants (Swiggy→food_delivery, Blinkit→groceries, Jio→telecom, Netflix→subscriptions, LIC→insurance, Zerodha→investments, IRCTC→travel, BESCOM→utilities, Uber→travel, HP/IOCL petrol→fuel); `MERCHANTS.length >= 200`.
- [ ] **Step 2–5:** Implement, run, commit.

### Task 9: Pipeline test + PR

- [ ] **Step 1:** `test/parsers/pipeline.test.ts`: every fixture → `parseStatement` picks the right parser id; parse all → normalise → dedupe → categorise; assert no transaction has `category: 'other'` for dictionary merchants and that `parseStatement('hello world')` throws `/Unsupported statement format/`.
- [ ] **Step 2:** `npm run check:no-network && npm run typecheck && npm test && npm run build` → all green; `npx vitest run --reporter=verbose | grep -c ✓` in engine ≥ 60.
- [ ] **Step 3:** Push branch `lane-a`. The orchestrator opens PR `Lane A: parsers, normalise, dedupe, categorise` after the blind review, listing banks covered and any contract change requests.

---

## Orchestrator amendments (2026-11-03, before implementation)
Made so this lane's output fits Lanes B and C after merge. No contract change.
1. Task 1: defined `seq` as the occurrence index among identical rows in one statement, which makes Review Focus 2 work for overlapping periods as well as re-uploads.
2. Task 2: card account ids use `cc` (`icici-cc-5678`), matching Lane B's household test and Lane C's sample report.
3. Task 6: normalise keeps a merchant or `upiRef` that is already set, and keeps the existing channel when no pattern matches.
4. Task 7: a shared `upiRef` dedupes only with the same amount and direction, because UPI reversals reuse the original RRN. Both sides of a matched card-bill payment become `card_payment`.
5. Task 8: card-side `PAYMENT RECEIVED` credits are categorised `card_payment`, so they don't count as income.
