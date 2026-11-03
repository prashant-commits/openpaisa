# Lane A — Statement parsers, normalise, de-duplicate, categorise

## Goal
Turn statement text into clean, de-duplicated, categorised `Transaction[]`.

## You own (edit only these)
- `packages/engine/src/parsers/**` (add parsers, register them in `parsers/index.ts`)
- `packages/engine/src/normalise.ts`, `dedupe.ts`, `categorise.ts`
- `packages/engine/test/parsers/**`, `test/normalise.test.ts`, `test/dedupe.test.ts`, `test/categorise.test.ts`, `test/fixtures/**`
Do NOT edit `types.ts` (open an issue in your PR description if the contract must change), `audit.ts`, or anything in `apps/`.

## Deliverables
1. Parsers (text as pdf.js would extract it, one line per row) for: HDFC savings, ICICI savings, SBI savings, Axis savings, Kotak savings, HDFC credit card, ICICI credit card, SBI Card, Axis credit card. Plus a generic CSV parser (date, description, debit, credit, balance columns with header auto-detection).
   - Base the layout on publicly documented/sample formats; write SYNTHETIC fixtures (invented data, masked account numbers). Never real data.
   - Each parse: verify opening + credits − debits = closing when balances exist; push a warning if not.
   - Card statements fill `card.totalDue / minimumDue / dueDate`.
2. `normalise.ts`: merchant from UPI narrations (e.g. `UPI/DR/412345678901/NETFLIX/hdfc/netflix@hdfc` → "Netflix", RRN → `upiRef`), NACH/ECS/ACH, POS, NEFT/IMPS, ATM; channel detection; stable `id` (FNV-1a hash, no crypto deps).
3. `dedupe.ts`: same `upiRef`; or same amount + direction + merchant within 2 days from different sources (prefer statement_pdf > statement_csv > email > sms > notification > manual); card-bill payment from savings + payment credit on card statement → mark savings debit as `category: 'card_payment'` (keep it, it is not spend).
4. `categorise.ts`: dictionary of 200+ common Indian merchants/keywords (Swiggy, Zomato, BigBasket, Blinkit, Zepto, Amazon, Flipkart, Myntra, Uber, Ola, Rapido, IRCTC, Jio, Airtel, Vi, BESCOM/MSEDCL/Tata Power, Netflix, Hotstar, Prime, Spotify, YouTube Premium, LIC, HDFC Life, Zerodha, Groww, SIP/BSE/NSE mandates, salary keywords, interest credit, charges/fees/GST), overrides win.

## Done when
`npm run check:no-network && npm run typecheck && npm test && npm run build` all pass; ≥60 tests in your area; PR opened against `main` titled "Lane A: parsers, normalise, dedupe, categorise".
