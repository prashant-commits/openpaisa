# Contributing to OpenPaisa

## Ground rules

1. **Never commit real financial data.** Test fixtures must be synthetic: invented names, amounts, account numbers (use `XXXX1234`-style masks) and UPI refs.
2. **No network calls** in `packages/engine` or `apps/web`. CI enforces this.
3. **Money is integer paise.** Dates are `YYYY-MM-DD`. See `packages/engine/src/types.ts`.
4. **The engine is pure.** No I/O, no `Date.now()`; take `asOf` as input.
5. Every parser and analyser ships with unit tests.

## Adding a bank statement parser

1. Create `packages/engine/src/parsers/<bank>-<kind>.ts` implementing `StatementParser`.
2. Write a synthetic fixture in `packages/engine/test/fixtures/<bank>-<kind>.txt` that mirrors the real layout (text as extracted by pdf.js).
3. Add tests for `detect()` and `parse()`, including opening/closing balance reconciliation.
4. Register it in `packages/engine/src/parsers/index.ts`.

## Checks before a PR

```bash
npm run check:no-network && npm run typecheck && npm test && npm run build
```
