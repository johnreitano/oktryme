# Phase 0 — Spikes status

Cheap end-to-end proofs before the pipeline build (PLAN.md §8). This repo
currently implements the two spikes that need **no external credentials or
spend**, and lays production-shaped seams for the rest.

| Spike | What it proves | Status |
|---|---|---|
| **V4 — Render + edit loop** | Worker renders a real `business.json`; a structured edit re-renders instantly (preview = live engine, no drift) | ✅ **Done** — `src/render`, `src/edit`, tests in `test/render.test.ts`, `test/edit-loop.test.ts` |
| **V3 — Stripe → provisioning** | Checkout subscription → signed webhook → status flip → domain provision, idempotent | ✅ **Done in test mode** — `src/billing/stripe.ts`, `src/provisioning`, `test/stripe-webhook.test.ts`. Live run needs Stripe test keys (below) |
| **V1 — Domain → live automation** | Register via Cloudflare Registrar API → Workers Custom Domain → SSL | ⛔ **Blocked on creds** — seam ready (`Provisioner` interface); needs CF account + Registrar beta + token |
| **V2 — Registrar API fit / TLDs** | Confirm beta registers .com at cost; decide renewal path | ⛔ **Blocked on creds** — read-only probe once token exists |
| **V5 — Form email deliverability** | Lead email lands in inbox (SPF/DKIM) | ⛔ **Blocked on creds** — seam ready (`LeadEmailSender`); needs provider key + DNS on the sending domain |

## What's built

- **One Worker** (`src/index.ts`) routing preview (`/p/{handle}`), live (by custom
  domain), contact form (`POST /lead/{handle}`), QR scan redirect (`/r/{handle}`),
  and the Stripe webhook (`POST /stripe/webhook`).
- **Renderer** (`src/render/renderer.ts`) — HTML-escaped, preview banner + CTA +
  `noindex` in preview, indexable in live. Same code both modes (no drift).
- **Edit engine** (`src/edit/apply.ts`) — schema-validated structured ops (the
  AI-editor core). Guardrails: immutable, validated, and **blocks scraped Google
  Maps photo URLs** (§11 IP decision).
- **Stripe** (`src/billing/stripe.ts`) — HMAC-SHA256 signature verification with
  replay tolerance, event handling (`checkout.session.completed` → activate +
  provision; `invoice.payment_failed` → past_due; `customer.subscription.deleted`
  → canceled), plan mapping, backup-domain generation.
- **Provisioning seam** (`src/provisioning/provision.ts`) — `Provisioner`
  interface + `StubProvisioner`. **V1 swaps in the real Cloudflare client behind
  this same interface; nothing else changes.** Idempotent + backup-walking.

## Run it

```bash
npm install
npm run typecheck     # tsc, no errors
npm test              # 25 tests, all green (V3 + V4)
npx wrangler deploy --dry-run --outdir dist   # bundles for the Workers runtime
```

## To take V3 live (test mode)

1. `wrangler kv namespace create BUSINESS_KV` → paste id into `wrangler.toml`.
2. Stripe test-mode: create $49/$99 prices, set secrets:
   `wrangler secret put STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` /
   `PRICE_SELF_SERVE` / `PRICE_DONE_FOR_YOU`.
3. `wrangler dev`, forward webhooks with `stripe listen --forward-to localhost:8787/stripe/webhook`,
   complete a test-card checkout, watch the handle flip `preview → active`.

## Credentials still needed (V1/V2/V5) — see chat thread

- **Cloudflare**: Account ID + API token (Workers, DNS, Zone, **Registrar write**),
  Registrar **beta enrollment**, billing profile, default registrant contact.
- **`multiply.app`** under our control with DNS on Cloudflare (V1 fallback + V5 sender).
- **Email**: provider choice (Resend/Postmark/Cloudflare Email) + API key + SPF/DKIM/DMARC.
