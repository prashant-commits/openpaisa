# Lane B: Recurring, Loans, Fees, Insights, Flows, Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `runAudit()` so `ParsedStatement[]` becomes a ranked `AuditReport`.

**Architecture:** Pure analyser modules (`recurring`, `loans`, `fees`, `insights`, `flows`) each take `Transaction[]` plus `asOf` and return contract types; `audit.ts` wires them after Lane A's normalise → dedupe → categorise (currently stubs — call them as-is). Tests use a synthetic transaction builder with merchant/category pre-set so they do not depend on Lane A.

**Tech Stack:** TypeScript 5 strict, Vitest 3, Node 24.

**Spec:** `docs/tasks/lane-b-analysis.md`, `docs/ARCHITECTURE.md` (steps 5–9), `docs/PRD.md` (advice guardrail), contract `packages/engine/src/types.ts`.

## Global Constraints
- Edit only: `packages/engine/src/{dates,recurring,loans,fees,insights,flows,audit}.ts`, `packages/engine/test/{builders.ts,dates,recurring,loans,fees,insights,flows,audit}.test.ts`, append-only exports in `src/index.ts`. Never `types.ts`, `parsers/**`, `normalise.ts`, `dedupe.ts`, `categorise.ts`, `apps/`.
- Money integer paise; round to paise at every amortisation step (`Math.round`). Format with `formatINR`.
- Pure: no `Date.now()`/`new Date()` without an argument; time comes from `asOf`.
- Insight copy states facts and arithmetic only. Never name or recommend an investment/insurance product. No "you should invest".
- Done = `npm run check:no-network && npm run typecheck && npm test && npm run build` green, ≥60 tests in this lane incl. a 6-month household `runAudit` test, PR titled `Lane B: recurring, loans, fees, insights, audit`.

## Review Focus
1. **Month-end dates**: a subscription billed on the 31st, 30th and 28th/29th must still cluster as monthly, and `nextExpectedDate` after 2026-01-31 is 2026-02-28 (clamp), not 2026-03-03.
2. **Too little history**: one month of statements → no recurring (needs ≥3, yearly ≥2), no `idle_cash`, `flows` has one entry, `runAudit` does not throw.
3. **Loans with missing facts**: an EMI detected with no principal/rate/tenure → `amortise` returns `[]`, `prepay` throws a clear `Error('loan needs principal, annualRatePct, tenureMonths and startDate')`, UI-facing insights skip it.
4. **Credits that look recurring**: monthly salary or rent received must not appear as a recurring *payment*; only `direction: 'debit'` clusters.
5. **Empty input**: `runAudit({ statements: [], asOf })` returns a report with empty arrays and a zero headline.

---

### Task 1: Dates helper + builders

**Files:** Create `src/dates.ts`, `test/builders.ts`, `test/dates.test.ts`

**Interfaces — Produces:**
- `addDays(d: IsoDate, n: number): IsoDate`, `addMonths(d: IsoDate, n: number): IsoDate` (clamps to month end), `diffDays(a: IsoDate, b: IsoDate): number` (b − a), `compareIso(a, b): number`. Implement with `Date.UTC`, never local time.
- `test/builders.ts`: `txn(p: Partial<Transaction> & { date: IsoDate; amount: number /* rupees */ }): Transaction` (defaults: debit, accountId `hdfc-sav-1234`, channel `upi`, source `statement_pdf`, confidence 1, id auto-increment) and `monthly(merchant: string, rupees: number, from: IsoDate, count: number, extra?: Partial<Transaction>): Transaction[]`, `statement(account: Partial<Account>, txns: Transaction[], extra?): ParsedStatement`. Builders set `merchant` explicitly and never reuse one UPI RRN across different transactions in `rawDescription`. After merge, Lane A's normalise pulls `upiRef` out of narrations and dedupe collapses equal refs.

- [ ] **Step 1: Tests:** `addMonths('2026-01-31',1)==='2026-02-28'`; `addMonths('2028-01-31',1)==='2028-02-29'`; `addMonths('2026-03-31',-1)==='2026-02-28'`; `diffDays('2026-02-27','2026-03-01')===2`; `addDays('2026-12-31',1)==='2027-01-01'`.
- [ ] **Steps 2–5:** run fail → implement → pass → commit `feat(engine): date helpers and test builders`.

### Task 2: Recurring detection

**Files:** `src/recurring.ts`, `test/recurring.test.ts`

**Interfaces — Produces:** `detectRecurring(txns: Transaction[], asOf: IsoDate): RecurringPayment[]` (sorted by `annualCost` desc). Frequency gaps (days, median): weekly 6–8, monthly 26–35, quarterly 85–95, half_yearly 175–190, yearly 355–375. `annualCost = typicalAmount × {52,12,4,2,1}`. `typicalAmount` = amount of the latest occurrence. `kind`: category `emi`→emi, `investments`→sip, `insurance`→insurance, `rent`→rent, `utilities|telecom`→utility, `subscriptions|entertainment`→subscription, else other. `id = 'rec-' + merchant slug + frequency`.

- [ ] **Step 1: Tests:**
  - Netflix ₹649 on the 5th × 6 months → 1 monthly, annualCost 778800 paise, nextExpectedDate one month after last.
  - Billing on 31st/30th/28th (Review Focus 1) → monthly; next after `2026-01-31` is `2026-02-28`.
  - Price change ₹499 ×3 then ₹649 ×3 → one cluster (±5% fails, so cluster key is merchant; amount tolerance applies to *splitting* two different plans of the same merchant only when both run concurrently) with `priceChange: {from:49900,to:64900,on:<first 649 date>}`. Decision: cluster by merchant; split a merchant's debits into separate clusters only when two amount bands interleave in the same months.
  - Electricity varying ±25% monthly (category utilities) → recurring; groceries at random ±60% → not.
  - Yearly Amazon Prime ₹1,499 × 2 a year apart → yearly.
  - Only 2 monthly debits → none (Review Focus 2). Salary credits monthly → none (Review Focus 4).
  - `possiblyForgotten`: ₹129 subscription running 7 months → true; Netflix + Hotstar both `subscriptions` video OTT → both true; same merchant on two different accountIds same month → true.
- [ ] **Steps 2–5:** fail → implement → pass → commit.

### Task 3: Loan maths

**Files:** `src/loans.ts`, `test/loans.test.ts`

**Interfaces — Produces:**
- `emiFor(principal: Paise, annualRatePct: number, tenureMonths: number): Paise`
- `amortise(loan: Loan, asOf: IsoDate): AmortisationRow[]` — full schedule from `startDate`, EMI dates `addMonths(startDate, k)`, k=1..n; last row pays exact outstanding + interest. Returns `[]` if principal/rate/tenure/startDate missing.
- `outstandingAt(loan: Loan, asOf: IsoDate): Paise` (after EMIs with date ≤ asOf)
- `prepay(loan: Loan, amount: Paise, mode: 'reduce_tenure' | 'reduce_emi', asOf: IsoDate): PrepaymentResult` — `reduce_tenure` keeps the EMI and counts every payment, including a final partial one, as a month (the same convention as `amortise`'s last row). A rounding residue of ≤ ₹10 left after a regular EMI is folded into that payment instead of adding a month.
- `solveRate(principal: Paise, emi: Paise, tenureMonths: number): number` (annual %, 2 dp; bisection 0–60%)
- `rateResetCheck(loan: Loan, currentRatePct: number, asOf: IsoDate): { tenureExtendedMonths: number; emiIfReduced: Paise } | null` — null when EMI recomputed at current rate over original remaining tenure equals current EMI within ₹1. `loan.annualRatePct` is the rate the EMI was set at; `currentRatePct` is the rate now. `emiIfReduced` = `emiFor(outstandingAt(loan, asOf), currentRatePct, remainingMonths)`. `tenureExtendedMonths` = (months to repay `outstandingAt` at `currentRatePct` keeping the current EMI, same convention as `prepay`) − remainingMonths. It is **signed**: positive when a rate rise stretched the tenure, negative when a rate cut shortened it, because a lower rate with an unchanged EMI repays sooner. If the unchanged EMI no longer covers the monthly interest, return the finite cap `1200 − remainingMonths`.
- `detectLoans(txns: Transaction[], recurring: RecurringPayment[]): Loan[]` — from recurring with `kind: 'emi'` (or NACH debit with `LOAN|EMI` keyword, fixed amount ±₹1, monthly); `lender` = merchant; `kind` from keywords (`HOME|HL`→home, `CAR|AUTO`→car, `PL|PERSONAL`→personal, `EDU`→education, card `EMI \d+/\d+`→card_emi, else other); confidence 0.6.

- [ ] **Step 1: Tests (exact values):**
  - `emiFor(500000000, 8.5, 240) === 4339116` (₹43,391.16).
  - Loan {principal 500000000, rate 8.5, tenure 240, startDate '2025-11-05'}: `amortise` length 240; row 1 interest `Math.round(500000000*8.5/1200)=3541667`; last row outstanding 0; sum of principal = 500000000.
  - `outstandingAt(loan,'2026-11-05') === 490048857`.
  - `prepay(loan, 50000000, 'reduce_tenure', '2026-11-05')` → `monthsSaved === 48`, `interestSaved` within ±10000 paise of `160369091` (exact arithmetic gives 160369090), `newEmi === 4339116`. That is 180 payments left: 179 full EMIs plus a final ₹22,476.98, against 228 remaining. (The original plan said 49, which disagrees with the plan's own last-row convention.)
  - `prepay(..., 'reduce_emi', ...)` → `monthsSaved === 0`, `newEmi === emiFor(490048857-50000000, 8.5, 228)`.
  - `solveRate(500000000, 4339116, 240)` → `8.5`.
  - `rateResetCheck(loan with rate 8.5, 9.5, '2026-11-05')` → `{ tenureExtendedMonths: 57, emiIfReduced: 4649778 }` (rate rise, EMI kept: tenure stretched).
  - `rateResetCheck(loan with rate 8.5, 7.5, '2026-11-05')` → `{ tenureExtendedMonths: -31, emiIfReduced: 4038389 }` (rate cut, EMI kept: tenure shortened by 31 months, or the EMI could fall to ₹40,383.89). With 8.5 → null. (The original plan expected `tenureExtendedMonths > 0` for the 7.5 case, which the arithmetic doesn't allow.)
  - missing fields → `amortise` `[]`, `prepay` throws the Review Focus 3 message.
  - `detectLoans` from a 6-month `NACH/HDFCBANKLTD/HOME LOAN` ₹43,391.16 series → one `home` loan with `emi 4339116`.
- [ ] **Steps 2–5:** fail → implement → pass → commit.

### Task 4: Fees

**Files:** `src/fees.ts`, `test/fees.test.ts`

**Interfaces — Produces:** `detectFees(txns: Transaction[], asOf: IsoDate): Insight[]` — one insight per fee kind found, grouping all matching txns. Patterns → InsightKind: `LATE PAYMENT|LATE FEE`→late_fee (severity act); `FINANCE CHARGE|INTEREST CHARGED` on a credit_card account→card_interest (act); `MARKUP|CROSS CURRENCY|FOREX|DCC`→forex_markup (warn); `ANNUAL FEE|JOINING FEE|AMC|SMS CHARGE|BOUNCE|RETURN CHG|MIN BAL|NON MAINT|ATM.*(FEE|CHG)`→fee_paid (warn). GST lines (`GST|IGST|CGST|SGST`) on the same date as a fee are added to that fee's total. `annualImpact` = total over the observed window × 365 / max(days observed, 30). Title e.g. `You paid ₹1,180 in late fees` (formatINR of observed total), detail states the window and the annualised figure.
- [ ] **Step 1: Tests:** each pattern produces the right kind; ₹1,000 late fee + ₹180 GST same day → one late_fee insight total 118000 paise; 90-day window with ₹59 SMS charge → annualImpact `Math.round(5900*365/90)`; transactionIds include the GST row; no fee rows → `[]`.
- [ ] **Steps 2–5:** fail → implement → pass → commit.

### Task 5: Flows, upcoming, safe-to-spend

**Files:** `src/flows.ts`, `test/flows.test.ts`

**Interfaces — Produces:**
- `detectSalaryDay(txns: Transaction[]): number | undefined` — credits with category `salary` (or `SALARY` keyword) in ≥2 months → median day.
- `buildFlows(txns: Transaction[], salaryDay?: number): MonthlyFlow[]` — cycles start on salaryDay (clamped to month end) else the 1st; `spend` excludes categories `transfers`, `card_payment`, `investments`; `income` = credits excluding `refund`, `transfers` and `card_payment` (a card-bill payment credited on a card statement is not income).
- `buildUpcoming(recurring: RecurringPayment[], statements: ParsedStatement[], loans: Loan[], asOf: IsoDate): UpcomingOutflow[]` — next 45 days inclusive, sorted by date; card dues from `statement.card` with `dueDate ≥ asOf`; EMIs come via recurring kind emi (don't double-add loans already in recurring).
- `safeToSpend(statements: ParsedStatement[], upcoming: UpcomingOutflow[], asOf: IsoDate, salaryDay?: number): { untilDate: IsoDate; amount: Paise } | undefined` — liquid = sum of latest `closingBalance` of savings/current accounts; minus upcoming before next salary date; undefined without salaryDay or balances.
- [ ] **Step 1: Tests:** salary on 1st/31st/30th → day 31 clamps; cycle boundaries with salaryDay 25; transfers excluded from spend; upcoming includes a card due on day 10 and Netflix on day 5 and excludes a yearly due in 60 days; safe-to-spend = ₹80,000 balance − ₹43,391.16 EMI − ₹649 before payday.
- [ ] **Steps 2–5:** fail → implement → pass → commit.

### Task 6: Insights

**Files:** `src/insights.ts`, `test/insights.test.ts`

**Interfaces — Produces:** `buildInsights(ctx: { txns: Transaction[]; statements: ParsedStatement[]; recurring: RecurringPayment[]; loans: Loan[]; fees: Insight[]; asOf: IsoDate; avgMonthlySpend: Paise }): Insight[]` sorted by `annualImpact` desc (undefined = 0), then severity act > warn > info. Rules:
- forgotten_subscription: each `possiblyForgotten` recurring, annualImpact = annualCost, action `{label:'Cancel', kind:'cancel'}`. Not emitted for a recurring payment already covered by a duplicate_subscription insight.
- duplicate_subscription: ≥2 recurring same category subscriptions (or the same merchant on two accounts), impact = cheaper one's annualCost. One leak insight per recurring payment, never two, so the headline doesn't count the same money twice.
- price_increase: `priceChange` → impact (to−from)×periods/yr.
- loan_rate_reset: `rateResetCheck` non-null (only for loans with rate) → action `{label:'Write to bank', kind:'letter'}`. `Loan` has one rate field: treat the user-supplied `annualRatePct` as the current rate and `solveRate(principal, emi, tenureMonths)` as the rate the EMI was set at. When they differ by ≥ 0.05 pp, call `rateResetCheck({ ...loan, annualRatePct: impliedRate }, loan.annualRatePct, asOf)`. Copy states the arithmetic only, e.g. "At 7.5%, the EMI for the remaining 228 months would be ₹40,383.89. Keeping ₹43,391.16 ends the loan 31 months sooner."
- prepayment_opportunity: loans with full facts → info, detail states arithmetic for prepaying one EMI's worth ×6, no recommendation.
- card_due_soon: card dueDate within 7 days of asOf → act, action pay. high_utilisation: totalDue > 30% of creditLimit → warn.
- unknown_debit: first-ever payee in data, debit ≥ ₹10,000, not transfers to self → warn, action review. A payee in any recurring cluster (rent, EMI) never qualifies, even on its first occurrence in the data window.
- duplicate_charge: same merchant + amount + date, ≥2 rows, debit → warn, impact = extra amount.
- idle_cash: only with ≥3 months data; avg savings closing balance > 6 × avgMonthlySpend → info, no product named.
- low_runway: liquid balance < upcoming 45-day outflows → act.
- lumpy_expense_ahead: yearly recurring due in next 60 days → info.
- Fee insights passed through.
- [ ] **Step 1: Tests:** one per rule (positive + negative), sort order, and a guardrail test: every `title`+`detail` across a full household run matches none of `/\b(should invest|buy|recommend|fund|policy from|switch to)\b/i`.
- [ ] **Steps 2–5:** fail → implement → pass → commit.

### Task 7: runAudit + household end-to-end

**Files:** Modify `src/audit.ts`, append exports to `src/index.ts` (`detectRecurring, emiFor, amortise, outstandingAt, prepay, solveRate, rateResetCheck, detectLoans, detectFees, buildFlows, buildUpcoming, safeToSpend, buildInsights, addMonths, addDays, diffDays`); Test `test/audit.test.ts`

**Interfaces — Produces:** `runAudit(input: AuditInput): AuditReport`. Order: flatten statements' transactions → `normaliseTransactions` → `dedupeTransactions` → `categoriseTransactions` → `detectRecurring` → `detectLoans` merged with `input.loans` (match by lender, user fields win) → `detectFees` → `buildInsights` → flows/upcoming/safeToSpend. `headline.annualLeak` = sum of `annualImpact` over insights with kinds forgotten_subscription, duplicate_subscription, price_increase, fee_paid, late_fee, card_interest, forex_markup, duplicate_charge; `recurringAnnual` = sum of recurring annualCost; `emiMonthly` = sum of loan emi. `cards` = one `CardSummary` per credit-card account from its latest statement's `card` block, `utilisationPct = Math.round(totalDue*1000/creditLimit)/10`.
- [ ] **Step 1: Tests:**
  - Empty input → zero headline, empty arrays (Review Focus 5).
  - Household fixture built in `test/builders.ts` → `household(): AuditInput` with asOf `2026-11-03`, 6 months May–Oct 2026, HDFC savings + ICICI card: salary ₹1,20,000 on 1st; rent ₹28,000 on 3rd; home loan ₹43,391.16 NACH on 5th with user loan facts {principal 50L, 8.5%, 240, start 2025-11-05}; Netflix ₹649, Hotstar ₹299, a ₹129 app; Swiggy/Blinkit random; ₹1,000+₹180 late fee once; forex markup ₹350; card due 2026-11-08 ₹42,000 of ₹1,00,000 limit. Assertions: recurring includes Netflix, Hotstar, rent, EMI; insights include late_fee, forex_markup, duplicate_subscription, card_due_soon, high_utilisation; `headline.emiMonthly === 4339116`; `cards[0]` = {accountId 'icici-cc-5678', totalDue 4200000, utilisationPct 42}; insights sorted; `runAudit` twice gives deep-equal output (purity).
- [ ] **Step 2:** Full checks green. **Step 3:** Push `lane-b`. The orchestrator opens PR `Lane B: recurring, loans, fees, insights, audit` after the blind review.

---

## Orchestrator amendments (2026-11-03, before implementation)
Values checked independently with reducing-balance arithmetic, rounding to paise each month. No contract change.
1. Task 3, `prepay` reduce_tenure: `monthsSaved` is **48**, not 49. With the plan's own convention (the last row pays exact outstanding + interest) 180 payments remain, the last a partial ₹22,476.98. `interestSaved` (160369090) and `newEmi` are unchanged.
2. Task 3, `rateResetCheck`: with an unchanged EMI, a rate *cut* shortens the remaining tenure; only a rate *rise* stretches it. `tenureExtendedMonths` is now signed and the tests pin 9.5% → +57, 7.5% → −31 (`emiIfReduced` 4038389), 8.5% → null.
3. Task 5: `income` also excludes `card_payment`.
4. Task 6: no double counting between forgotten_subscription and duplicate_subscription. `loan_rate_reset` gets its two rates from the user-supplied rate and the rate implied by the EMI. `unknown_debit` excludes payees that recur.
5. Task 1: builders set `merchant` and never reuse a UPI RRN, so the household test still passes once Lane A's real normalise/dedupe replace the stubs.
