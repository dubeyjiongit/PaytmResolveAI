# PaytmResolve AI — AI Payment Operations Teammate

An AI teammate that investigates failed/stuck UPI payments, decides recovery actions under a **deterministic policy engine** (never the LLM), and either resolves the issue automatically, requires step-up verification for risky payments, or escalates conflicting cases to a human operator.

## Core design rules

1. **Zero LLM financial authority.** The LLM (or its deterministic fallback) only *proposes* a diagnosis/action. A separate, non-AI `actionGate` is the sole authority that allows, blocks, or requires step-up on any money-moving action.
2. **Prompt-injection hard-block.** Override phrases ("I know him", "ignore policy", etc.) are substring-scanned and rejected by the action gate regardless of how the LLM interprets them.
3. **4-way decoupled transaction state.** `bank_status`, `upi_status`, `receiver_status`, `refund_status` are independent rails. `payment_status` is *derived*, never a 5th source of truth. `is_ledger_reconciled` is a separate human-only flag.
4. **Zero external DB.** Everything lives in an in-memory mock DB, seeded on boot. No migrations, no connection strings.
5. **No placeholders, anywhere.** Every route, engine, and component in this repo is fully implemented.

## Run it locally

Requires Node.js 18+.

```bash
# 1. Install everything (root + backend + frontend) and build the frontend once
npm run build

# 2. Start the unified production server (serves API + built frontend on one port)
npm start
```

Then open **http://localhost:5000** in your browser.

### Local development (hot reload, two servers)

```bash
npm run dev
```

This runs the backend (tsx watch, port 5000) and the Vite dev server (port 5173) concurrently. Open **http://localhost:5173** — API calls are proxied to the backend.

### Optional: real LLM reasoning

By default the AI teammate uses a deterministic regex/keyword fallback and never depends on any API key. To let it use a real Claude model for the investigation narrative, copy `backend/.env.example` to `backend/.env` and set `ANTHROPIC_API_KEY`. Every demo still works identically either way.

## The three headline demos

Use the **Demo Control Panel** (top of the app) to trigger each scenario, then follow along in the matching tab.

| Demo | Scenario button | What to show |
|---|---|---|
| **RESOLVE** | "Pending / Settlement Timeout" | Ask the AI Teammate about the stuck payment → it monitors instead of retrying → accelerated poller (0s/3s/6s) resolves it live → "✓ Transaction resolved. Customer notified." |
| **PROTECT** | "New Beneficiary High Value" | Try to pay ₹2,00,000 to a brand-new beneficiary → Risk Center opens at 78/100 (HIGH) → verify OTP → score drops to 48 → confirm & pay executes |
| **ESCALATE** | "Conflicting States" | Bank/UPI/receiver disagree → AI refuses to auto-resolve → escalates to Human Ops case `SUP-48291` → reconcile → refund → close |

7 more scenario buttons (duplicate payment, high-risk block, debit-no-credit, beneficiary history decay, network failure, bank timeout spike) plus a reset button are also available for deeper exploration.

## Project structure

```
Paytm-hackathon/
├── backend/            Express + TypeScript API, all engines, in-memory DB
│   └── src/
│       ├── engine/     riskEngine, decisionEngine, actionGate, monitoringEngine, proactiveEngine, scenarioEngine
│       ├── agents/      opsAgent (LLM + fallback), ocrService, tools
│       ├── routes/      api.ts — all HTTP endpoints
│       └── mockDb/      seeded in-memory transactions/customers/beneficiaries
├── frontend/           React + Vite + Tailwind
│   └── src/
│       ├── components/  PaymentApp, RiskCenterModal, AiTeammateChat, HumanOpsCenter, DemoControlPanel
│       └── services/    api.ts — typed API client
└── package.json        Unified root build/start/dev scripts
```

## Deploying for real (Render / Railway / any Node host)

1. Push this repo to GitHub.
2. Set the build command to `npm run build` and the start command to `npm start`.
3. No environment variables are required. `PORT` is read automatically if the host sets it.

The backend serves the built frontend statically the moment `frontend/dist` exists on disk — no `NODE_ENV` flag needed.
