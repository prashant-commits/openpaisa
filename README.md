# OpenPaisa

**See everything about your money — without giving it to anyone.**

OpenPaisa reads your own bank and credit-card statements **on your device** and tells you:

- every subscription, autopay, SIP and EMI you pay, with the yearly total and the ones that look forgotten
- your loans: outstanding, interest paid, payoff date, and what a prepayment would save
- whether a floating-rate loan absorbed a rate cut by stretching your tenure
- card dues, interest and late fees, forex markup and other avoidable charges
- where your salary went this cycle, and what will leave your account before next payday

Built for India first: UPI, EMIs, NACH mandates, Indian bank statement formats, ₹ in lakh/crore grouping.

## Why you can trust it

| Promise | How you can check it |
| --- | --- |
| Your statements never leave your device | The web app is static files. Its Content-Security-Policy (`apps/web/index.html`) blocks sending data to any other server. Open DevTools → Network while you use it. |
| No hidden network calls in the code | CI runs `npm run check:no-network` on every commit and fails if `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` appear in the source. |
| No account, no tracking, no ads | There is no backend in this repo. Nothing to sign up to. |
| No conflicts of interest | OpenPaisa will never earn commissions on loans, cards, insurance or funds. |
| The maths is checkable | Every number comes from deterministic code in `packages/engine` with unit tests. No AI computes your numbers. |
| Facts, not product advice | Insights state facts and arithmetic. They never recommend a specific investment or insurance product. |

## Status

Early development (v0.1). See [docs/PRD.md](docs/PRD.md) for the plan and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works.

## Run it locally

```bash
npm install
npm run dev        # open the printed localhost URL
npm test           # engine unit tests
```

## Repository layout

```
packages/engine   Pure TypeScript: statement parsers, de-duplication, recurring detection, loans, insights
apps/web          Static web app: drop statements, see your audit. Runs fully offline.
docs/             Product requirements, architecture, contributor task briefs
scripts/          Trust checks run in CI
```

## Contributing

The most valuable contribution is a parser for your bank's statement format, built from **synthetic** test data. See [CONTRIBUTING.md](CONTRIBUTING.md). Never commit a real statement.

## License

[AGPL-3.0](LICENSE). If you run a modified version as a service, you must publish your changes — so forks stay as inspectable as this one.
