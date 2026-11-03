# Lane C — Web app

## Goal
A static, offline web app: drop statements → see the audit and the money view. Clear, calm, trustworthy, works on a phone.

## You own (edit only these)
- `apps/web/**` (add deps to `apps/web/package.json` only)
Do NOT edit `packages/engine/**` or root config. The engine's `runAudit` is a stub being built by Lane B; develop against `apps/web/src/demo/sampleReport.ts`, a hand-written realistic `AuditReport` (synthetic data), and call the real engine behind a "Run on my statements" path that shows a friendly "coming soon" if it throws.

## Deliverables
1. **Upload**: drag-and-drop / file picker for PDF and CSV; multiple files; password prompt for protected PDFs. Text extraction with `pdfjs-dist` — bundle the worker locally (import `pdfjs-dist/build/pdf.worker.min.mjs?url`), no CDN. Group text items into lines by y-position, join with "\n", then `parseStatement(text)`.
2. **Trust panel** (always visible): "Processed on this device. Nothing is uploaded." + link to the repo + how to verify (DevTools → Network). Add a "Try with sample data" button.
3. **Audit view**: headline (`₹X a year is leaking`), ranked insight cards with action labels.
4. **Money view** tabs: Spends (by category for the selected salary cycle, vs 3-month average; searchable transaction list), Recurring (list with yearly totals, next dates, forgotten flags), Loans & EMIs (each loan; amortisation table; prepayment calculator using engine `prepay` when available), Cards (dues, due dates, utilisation), Upcoming (next 45 days + safe-to-spend).
5. Charts with a small dependency (e.g. hand-rolled SVG or `recharts`); ₹ in Indian grouping via engine `formatINR`.
6. Export / import an encrypted JSON of the report (Web Crypto AES-GCM, key from a passphrase via PBKDF2 ≥ 310k iterations). No localStorage of raw statements.
7. Accessible (labels, keyboard), responsive to 360 px, light and dark mode.
8. Keep `index.html` CSP intact; it must still pass `npm run check:no-network`.

## Done when
`npm run check:no-network && npm run typecheck && npm test && npm run build` pass; the built `dist/` works opened from a static server with the network disconnected; PR opened against `main` titled "Lane C: web app"; include screenshots in the PR description if possible.
