# Lane B — Recurring, loans, fees, insights, audit

## Goal
Implement `runAudit()` so a list of `ParsedStatement` becomes a ranked `AuditReport`.

## You own (edit only these)
- `packages/engine/src/recurring.ts`, `loans.ts`, `fees.ts`, `insights.ts`, `flows.ts`, `audit.ts` (create the new ones)
- `packages/engine/test/{recurring,loans,fees,insights,flows,audit}.test.ts`, `packages/engine/test/builders.ts` (synthetic transaction builders)
- Exports for your modules in `packages/engine/src/index.ts` (append only)
Do NOT edit `types.ts`, `parsers/**`, `normalise.ts`, `dedupe.ts`, `categorise.ts` (call them as-is; they are stubs being implemented by Lane A), or `apps/`.

## Deliverables
1. `recurring.ts` `detectRecurring(txns, asOf)`: cluster by merchant (fallback normalised description) + amount (±5%; utilities ±30%); ≥3 occurrences (≥2 for yearly); classify median gap weekly/monthly/quarterly/half-yearly/yearly with tolerance; `nextExpectedDate`; `annualCost`; `priceChange`; `kind` from category/keywords (EMI, SIP, insurance, rent); `possiblyForgotten` heuristics (small subscription running ≥6 months; two services in the same category, e.g. two video OTTs; same merchant charged on two cards).
2. `loans.ts`: `detectLoans(txns, recurring)`, `amortise(loan, asOf)`, `prepay(loan, amount, mode, asOf)`, `solveRate(principal, emi, tenureMonths)` (Newton/bisection), `rateResetCheck(loan, history)` that flags when the EMI stayed flat but the user-supplied or inferred rate fell (tenure extended instead of EMI cut). Standard reducing-balance EMI formula; round to paise at each step; tests against known values (e.g. ₹50,00,000 at 8.5% for 240 months → EMI ₹43,391).
3. `fees.ts` `detectFees(txns)`: late payment fee, finance/interest charges on cards, forex markup / cross-currency fee, GST on fees, annual/joining fee, AMC, SMS alert charges, cheque/ECS/NACH bounce, min-balance penalty, ATM fees. Each → `Insight` with annualised impact.
4. `insights.ts` builds all `Insight`s (see `InsightKind`), including `card_due_soon`, `high_utilisation` (>30% of limit), `unknown_debit` (first-time payee ≥ ₹10,000), `duplicate_charge` (same merchant + amount same day), `idle_cash` (avg balance > 6× monthly spend), `lumpy_expense_ahead` (yearly recurring in next 60 days). Titles in plain English with ₹ via `formatINR`. Facts and arithmetic only — never recommend a product.
5. `flows.ts`: salary-cycle `MonthlyFlow[]` (detect salary credits; fall back to calendar months), `upcoming` (45 days from recurring + card dues + EMIs), `safeToSpend` = current liquid balance − upcoming outflows before next salary.
6. `audit.ts` `runAudit(input)`: normalise → dedupe → categorise → recurring → loans (merge user-supplied `input.loans`) → fees → insights → flows; sort insights by `annualImpact` desc then severity; `headline`.

## Done when
`npm run check:no-network && npm run typecheck && npm test && npm run build` pass; ≥60 tests in your area including one end-to-end `runAudit` test on a 6-month synthetic household; PR opened against `main` titled "Lane B: recurring, loans, fees, insights, audit".
