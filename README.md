# Dispute Autopilot

**A dispute decision engine for small PayPal merchants, with an AI agent on top.**

When a buyer opens a dispute, Dispute Autopilot investigates it the way an experienced seller would: it reads the claim, traces the payment to the order, checks tracking, compares buyer details and looks for earlier messages that contradict the claim. It then decides whether the case is worth fighting. If it is, it drafts the evidence and the statement for PayPal. If it isn't, it drafts a refund and a polite note to the buyer. Nothing moves until the merchant clicks **Approve**.

Big retailers pay for dispute-management services. A one-person shop usually just misses the response deadline and loses the sale, the product and a fee.

What makes it more than "an LLM that writes evidence":

- **Win odds you can check, not an AI guess.** A small, transparent model over the facts in the case gives the estimate. Every percentage point traces to a named factor ("Carrier confirms delivery to the ship-to address: +48 pts"). The **Track record** page scores those estimates against PayPal's actual rulings on disputes the model hadn't seen (forward-chained Brier score and a calibration chart), next to a claim-type base rate and the LLM's own guess.
- **Outcome learning, with a guard.** Each decision freezes its estimate and factors. When PayPal rules on a dispute you fought, it becomes a training example and the weights are refit. Refunds don't count, because they aren't rulings. Refit weights go live only if they beat the starting rules out of sample, so learning can't make the estimates worse.
- **Your economics.** Fight vs refund includes the dispute fee (charged on loss, or on every fight, per your fee schedule), your time at your hourly rate, and resale value from returned items. Each case shows the **break-even win probability**: the odds above which fighting pays *for you*.
- **Evidence gaps, priced.** A checklist of what PayPal looks for on this claim type, what the records already prove, and what's missing. Each collectable gap says how to get it, how many points it would add, what that's worth in money, and the date to collect it by. Add it (a note plus a PDF or image) and the odds update; the agent reconsiders and the file goes to PayPal with the evidence.
- **Evidence integrity in code.** Every fact sits in a case file with its source record, the record's own timestamp, and a SHA-256 fingerprint of the record as fetched. The agent must cite fact IDs for every piece of evidence. `record_decision` rejects unsourced evidence, tracking numbers that aren't on the order and invented amounts, and sends them back for the model to fix. Submission stays blocked if anything still fails. Contradictions between records ("claim vs carrier", "delivered to a different ZIP", "signature doesn't match") are flagged, along with whose side each one helps.
- **PayPal lifecycle checks.** Before every action (submit evidence, accept claim, message buyer), the app checks the actions PayPal currently offers on the dispute (its HATEOAS links, which reflect stage, status and API permissions) and the response deadline. It never assumes.

## What it does

- **Wakes up on its own.** A PayPal `CUSTOMER.DISPUTE.CREATED` webhook starts the investigation in the background.
- **Investigates with real PayPal data.** It uses the Disputes, Payments (captures), Orders, Transaction Search and Tracking APIs.
- **Decides fight or refund.** It estimates the chance of winning, applies the merchant's refund policy and an "it's cheaper to refund" threshold, and explains its reasoning.
- **Acts after approval.** It submits evidence (`provide-evidence`) or accepts the claim (`accept-claim`, which refunds the buyer) through the PayPal API.
- **Builds an evidence packet.** Every fight goes to PayPal with a PDF that pulls together the dispute, payment, order, shipping and carrier scans, the buyer conversation and the seller statement. You can preview it from the case page.
- **Talks to the buyer.** The agent drafts a message; you edit and send it through the PayPal dispute thread. When the buyer replies, the agent re-investigates on its own (via the `CUSTOMER.DISPUTE.UPDATED` webhook). Many disputes end right there, with the buyer withdrawing the claim.
- **Checks real tracking.** With `SHIPPO_API_KEY` set, the agent looks up carrier delivery scans through Shippo instead of relying on PayPal's tracker alone.
- **Follows your rules.** The Settings page holds your refund policy, the "just refund it" threshold, a "never fight without delivery proof" rule, and an autonomy level: *suggest only* (default) or *handle small disputes alone*, below a dollar limit and only at high confidence. Anything the agent does alone is labelled as such.
- **Spots product problems.** The Insights page shows dispute rates per product, why buyers dispute, and how disputes end, and rewrites a problem listing with Claude so the next buyer isn't surprised.
- **Shows the money.** Every decision comes with an expected-value check: refunding now vs. fighting on average, with your fee schedule, time and return value, and the break-even win odds. The dashboard adds it up: money protected, how much better the agent's calls are than refunding everything, hours saved, and deadlines met.
- **Dashboard.** An AG Grid table of every dispute, with deadlines, money at stake, the agent's recommendation, win odds and the fight-vs-refund edge, plus search and CSV export.

## Quick start (demo data, no PayPal account needed)

You need **Node.js 22+** (see `.nvmrc`) and an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone <this repo> && cd dispute-autopilot
npm install
cp .env.example .env        # then set ANTHROPIC_API_KEY
npm run dev                 # open http://localhost:3000
```

`PAYPAL_MODE=mock` (the default) serves built-in sample disputes shaped exactly like PayPal sandbox responses. There are four open cases (a delivered package marked "not received", a small "not as described" claim, a "friendly fraud" unauthorized claim, and an order that never shipped) plus resolved history. Click **Investigate all open** to watch the agent work, or **⚡ Simulate dispute** to have a new dispute arrive. You can pick a scenario (a "never arrived" claim with porch-delivery proof, friendly fraud, a gift shipped to another address, an order that never shipped, or a repeat size complaint). The new dispute goes through the same intake as a PayPal webhook, so the agent picks it up on its own. **Reset demo** in the same menu removes the simulated disputes.

On a case page, click **Send to buyer** under the agent's draft message. In demo mode the simulated buyer answers a few seconds later. Some of them withdraw the claim, and the agent re-investigates the others with the new information. To see autonomy, open **Settings**, choose *Handle small disputes alone*, and simulate the "Small not as described" scenario.

Below the agent's decision, **Win odds, explained** breaks the estimate into factors and marks your break-even point. **Evidence checklist** prices each missing piece; click **I have this** to add a note or file and watch the odds move. **Case file** lists every fact with its source and fingerprint. To see outcome learning, approve a few fights, then choose **Simulate → PayPal rules on submitted cases** and open **Track record**. Demo mode includes a labelled synthetic history of 400 resolved disputes.

You can also run the agent from the terminal:

```bash
npm run investigate -- PP-D-1003
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app (demo mode unless `.env` says otherwise) |
| `npm run dev:tunnel` | Sandbox mode with a Cloudflare tunnel and automatic PayPal webhook setup |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit and demo-mode integration tests (offline: no API keys, no PayPal, no Claude calls) |
| `npm run check:sandbox` | Verify PayPal sandbox credentials, APIs and webhook |
| `npm run investigate -- <id>` | Run the agent on one dispute from the terminal |

### Environment variables

All are listed with comments in `.env.example`. Only `ANTHROPIC_API_KEY` is required for demo mode.

| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | The agent (always) |
| `PAYPAL_MODE` | `mock` (default, built-in sample disputes) or `sandbox` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox mode |
| `PAYPAL_WEBHOOK_ID` | Webhook signature checks in sandbox mode (`dev:tunnel` fills it in) |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | PayPal buttons on the demo store |
| `SHIPPO_API_KEY` | Optional: real carrier tracking in sandbox mode |
| `MERCHANT_NAME`, `MERCHANT_REFUND_POLICY`, `AUTO_ACCEPT_THRESHOLD` | The merchant profile the agent reasons with |
| `DISPUTE_FEE_USD`, `MANUAL_MINUTES_PER_DISPUTE` | Starting values for the impact math (editable in Settings) |
| `PORT` | Optional: port for `npm run dev:tunnel` (default `3000`) |

Local state (case records, settings, demo-store purchases, simulated disputes, uploaded evidence) is written to `data/`, which is git-ignored and created on first run. Delete the folder to start fresh.

## Running against the PayPal sandbox

1. At [developer.paypal.com](https://developer.paypal.com/dashboard/) open **Apps & Credentials → Sandbox** and create an app. Copy the client ID and secret into `.env`, then set `PAYPAL_MODE=sandbox` and `NEXT_PUBLIC_PAYPAL_CLIENT_ID`.
2. Start everything with **`npm run dev:tunnel`**. It runs the app in sandbox mode, opens a Cloudflare quick tunnel, and points your PayPal webhook at `<tunnel>/api/webhooks/paypal`. If `PAYPAL_WEBHOOK_ID` is empty, it creates the webhook and saves the ID to `.env`. The tunnel URL changes on every run, but the webhook ID stays the same, so there's nothing to paste by hand.
3. Run `npm run check:sandbox`. It checks credentials, the Disputes API, Transaction Search and the webhook subscription.
4. **Create a sandbox dispute.** Open `/store`, buy something with your sandbox *personal* (buyer) account, then log in to [sandbox.paypal.com](https://www.sandbox.paypal.com) as that buyer and report a problem with the payment from the Resolution Center. The webhook fires and the agent starts investigating.

## How it works

```
PayPal webhook ──► /api/webhooks/paypal ──► agent (Claude + PayPal tools)
                                               │ get_case_file (sourced facts, calibrated odds,
                                               │   break-even, gaps, contradictions, allowed actions)
                                               │ get_dispute, get_capture, get_order,
                                               │ search_transaction, check_carrier_status,
                                               │ list_merchant_disputes, get_merchant_policy
                                               ▼
                                         record_decision ── integrity check ──► dashboard (AG Grid)
                                           (rejects unsourced evidence)     │ merchant clicks Approve
                                                                            ▼
                                             lifecycle check (PayPal links, deadline) + integrity
                                                                            ▼
                                             PayPal provide-evidence  /  accept-claim (refund)
                                                                            ▼
                                             PayPal rules ──► outcome learning (Track record)
```

| Path | Role |
|---|---|
| `lib/agent.ts` | The investigator: Claude via the Anthropic SDK tool runner, with read-only PayPal tools and a final `record_decision` tool |
| `lib/execute.ts` | The only code that changes dispute state; runs only after approval and the lifecycle and integrity checks |
| `lib/casefile.ts` | The case file: facts with IDs, source records, timestamps and SHA-256 fingerprints |
| `lib/score.ts` | Calibrated win estimate: logistic model over case-file facts, with per-factor explanations |
| `lib/learning.ts` | Outcome learning: refit on PayPal rulings, forward-chained evaluation, calibration, probation guard |
| `lib/evidence.ts` | Evidence checklist per claim type, with gaps priced in points and money |
| `lib/integrity.ts` | Contradiction detection and verification of the agent's evidence against the case file |
| `lib/guard.ts` | What PayPal allows on a dispute right now (HATEOAS links, status, deadline) |
| `lib/assess.ts` | Puts it all together for the case page, the agent and execution |
| `lib/collect.ts` | Evidence the merchant adds by hand (notes and files, stored under `data/uploads/`) |
| `lib/impact.ts` | Money and time math: expected value per decision and dashboard totals |
| `lib/messaging.ts` | Buyer messages through the PayPal dispute thread, behind the same approval and lifecycle checks |
| `lib/paypal.ts` | PayPal REST client (OAuth, Disputes, Orders, Captures, Transaction Search, webhook verification) |
| `lib/mock.ts` | Sample disputes for demo mode, simulated disputes and buyer replies, and a simulated carrier lookup |
| `lib/intake.ts` | Reacts to new disputes and buyer replies: investigate, then act alone only if settings allow |
| `lib/autopilot.ts` | The autonomy rules (amount limit, minimum confidence) |
| `lib/packet.ts` | Evidence packet PDF (pdf-lib) |
| `lib/carrier.ts` | Carrier tracking via Shippo, or simulated in demo mode |
| `lib/insights.ts` | Per-product dispute patterns and the Claude listing rewrite |
| `lib/settings.ts` | Merchant settings, saved to `data/settings.json` |
| `lib/store.ts` | JSON-file store for case records (`data/store.json`) |
| `lib/purchases.ts`, `lib/products.ts` | Demo-store catalog and purchase log (`data/purchases.json`) |
| `app/page.tsx` | Dispute dashboard (AG Grid) |
| `app/disputes/[id]/page.tsx` | Case view: agent trace and decision, win odds explained, evidence checklist, case file with sources, approve button |
| `app/insights/page.tsx` | Product insights and AI listing rewrites |
| `app/accuracy/page.tsx` | Track record: calibration, prediction error by method, what the model learned |
| `app/settings/page.tsx` | Policy, autonomy and impact assumptions |
| `app/store/page.tsx` | Demo store with PayPal Checkout buttons for creating sandbox orders |

**Safety by design:** the agent's tools are read-only. Money only moves through `lib/execute.ts`, after a human approves or, if the merchant turned it on, under the small-dispute autonomy rule (and every such action is labelled). Buyer messages are never sent without a click unless the merchant allows it. Every tool call is logged on the case. Evidence that doesn't trace to a source record can't be submitted, and no action is attempted that PayPal doesn't currently offer.

## Tools used

- **Claude Opus 5.5** (`claude-opus-5-5`) through the Anthropic TypeScript SDK's tool runner. It plans the investigation, calls PayPal tools, weighs the evidence and writes the statements. Server-side refusal fallback is enabled.
- **PayPal:** Disputes API, Orders v2, Payments v2 (captures), Transaction Search, Order Tracking, Webhooks (with signature verification), and the PayPal JavaScript SDK for checkout.
- **AG Grid** for the dispute dashboard.
- **Render** for hosting (`render.yaml` included).

## Deploy

Push to GitHub, create a Render Blueprint from `render.yaml`, and set `ANTHROPIC_API_KEY` (plus the PayPal variables for sandbox mode). Case records live in `data/store.json`. That's fine for a single-instance demo; use a database for anything more. Render's free plan has no persistent disk, so `data/` resets on every deploy or restart; demo mode recreates the sample disputes automatically.

## License

MIT © 2026 Anshu Raj. See [LICENSE](LICENSE).
