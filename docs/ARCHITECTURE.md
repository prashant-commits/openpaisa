# Architecture

```
statement file ──(browser: pdf.js text extraction, local password unlock)──▶ text
text ──parseStatement()──▶ ParsedStatement[]
ParsedStatement[] ──runAudit({statements, asOf})──▶ AuditReport ──▶ UI
```

## Engine pipeline (`packages/engine`, pure TypeScript, no I/O)
1. **Parse** — `parsers/*`: one `StatementParser` per bank × statement kind; `detect()` scores the text, `parse()` returns transactions in paise.
2. **Normalise** — `normalise.ts`: clean merchant names (strip UPI handles, refs, digits), detect channel (UPI/NACH/card/…), deterministic ids.
3. **De-duplicate** — `dedupe.ts`: same UPI ref, or same amount + direction + merchant within 2 days across sources; card-bill payments matched against card statement credits so they are not counted as spend twice.
4. **Categorise** — `categorise.ts`: merchant dictionary + keyword rules; user overrides win.
5. **Recurring** — `recurring.ts`: cluster by merchant and amount (±5%, utilities ±30%), classify median gap, predict next date, flag price changes and possibly forgotten ones.
6. **Loans** — `loans.ts`: EMI detection (fixed debit, fixed day, EMI/NACH/loan keywords), amortisation, prepayment maths, rate-reset check (EMI unchanged while tenure implied by rate grows).
7. **Fees** — `fees.ts`: late fee, finance charges, forex markup, GST on fees, AMC, SMS charges, cheque/ECS bounce.
8. **Insights + flows** — `insights.ts`, `flows.ts`: rank by annual rupee impact; salary-cycle flows; upcoming outflows; safe-to-spend.
9. **Audit** — `audit.ts`: `runAudit()` wires 2–8.

## Web app (`apps/web`)
Static Vite + React. Drop files → extract text with pdfjs-dist (worker bundled locally, no CDN) → `parseStatement` → `runAudit` → render. State lives in memory; optional encrypted export to a file the user keeps. CSP forbids external connections.

## Later
- `packages/mcp`: local MCP server exposing `audit_statements` so a chat assistant gets only the redacted report, never raw statements.
- Android (Capacitor) with NotificationListener for UPI.
