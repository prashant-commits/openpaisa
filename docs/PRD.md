# OpenPaisa — Product Requirements (v0.1)

Full PRD with research and council notes: https://claude.ai/artifact/5Z8ekzQ1g7mZ5SnZ9wwGTX

## Problem
Salaried Indians spread money across 2–4 bank accounts, 1–3 cards, UPI apps, EMIs and subscriptions. No tool answers: where did my salary go, what leaves before next payday, what am I overpaying, and am I on track — without handing data to a lending or investing business.

## Decision
Start with a statement-in, action-list-out **money leak audit** that also renders the full money view. Everything runs on the device. Android companion (UPI notifications) comes after users return monthly; Account Aggregator after ~1,000 paying users via a regulated partner.

## MVP scope
- Parse statements (text extracted locally from PDF/CSV; passwords unlocked locally) for HDFC, ICICI, SBI, Axis, Kotak savings + credit cards.
- Audit: recurring payments and subscriptions (yearly total, forgotten flags, price changes), loans and EMIs (amortisation, prepay calculator, rate-reset check), fees and leaks (late fees, card interest, forex markup, AMC/SMS charges), card dues and utilisation, unknown or duplicate debits.
- Money view: spend by category per salary cycle, upcoming outflows (45 days), safe-to-spend till payday.
- One headline: "₹X a year is leaking".
- Out of scope: SMS reading, Account Aggregator, iOS app, tax, product recommendations.

## Guardrail on advice
Facts and arithmetic only ("prepaying ₹50,000 saves ₹1.8L interest"). No recommendations of specific investment or insurance products (SEBI IA / IRDAI).

## Success metrics
≥30% of audits find a leak ≥₹5,000/yr · ≥98% parsing accuracy on supported banks · ≥40% month-2 return.
