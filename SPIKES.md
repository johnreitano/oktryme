# Phase 0 — Spikes status

Cheap end-to-end proofs before the pipeline build (PLAN.md §8). The render/edit
and billing/provisioning/email code is now **written and unit-tested against the
real Cloudflare, Stripe, and Resend APIs (mocked fetch)** — what remains for
V1/V2/V5 is wiring live credentials and running them end-to-end.

| Spike | What it proves | Status |
|---|---|---|
| **V4 — Render + edit loop** | Worker renders a real `business.json`; a structured edit re-renders instantly (preview = live engine, no drift) | ✅ **Done** — `src/render`, `src/edit`; `test/render.test.ts`, `test/edit-loop.test.ts` |
| **V3 — Stripe → provisioning** | Checkout subscription → signed webhook → status flip → domain provision, idempotent | ✅ **Code-complete** — `src/billing/stripe.ts` (+ `createCheckoutSession`), `src/provisioning`; `test/stripe-webhook.test.ts`, `test/email-and-checkout.test.ts`. Live run needs Stripe test keys |
| **V1 — Domain → live automation** | Register via Cloudflare Registrar API → Workers Custom Domain → SSL | 🟡 **Code-complete, awaiting creds** — `CloudflareProvisioner` (`src/provisioning/cloudflare.ts`) implements register + poll + zone + custom-domain attach; `test/cloudflare-provisioner.test.ts`. Needs CF account + Registrar beta + token to run live |
| **V2 — Registrar API fit / TLDs** | Confirm beta registers .com at cost; decide renewal path | 🟡 **Read-only probe once token exists** — endpoints wired in the client |
| **V5 — Form email deliverability** | Lead email lands in inbox (SPF/DKIM) | 🟡 **Code-complete, awaiting creds** — `ResendSender` (`src/lead/resend.ts`); `test/email-and-checkout.test.ts`. Needs Resend API key + verified domain (DKIM) |

## What's built

- **One Worker** (`src/index.ts`) routing preview (`/p/{handle}`), live (by custom
  domain), convert→Checkout (`/convert/{handle}`), contact form
  (`POST /lead/{handle}`), QR scan redirect (`/r/{handle}`), and the Stripe
  webhook (`POST /stripe/webhook`). It auto-selects real vs. stub implementations
  from env: `CF_*` present → `CloudflareProvisioner`; `RESEND_API_KEY` present →
  `ResendSender`; otherwise the no-op stubs (so test runs need no creds).
- **Renderer** (`src/render/renderer.ts`) — HTML-escaped, preview banner + CTA +
  `noindex` in preview, indexable in live. Same code both modes (no drift).
- **Edit engine** (`src/edit/apply.ts`) — schema-validated structured ops (the
  AI-editor core). Guardrails: immutable, validated, and **blocks scraped Google
  Maps photo URLs** (§11 IP decision).
- **Stripe** (`src/billing/stripe.ts`) — HMAC-SHA256 signature verification with
  replay tolerance; event handling (`checkout.session.completed` → activate +
  provision; `invoice.payment_failed` → past_due; `customer.subscription.deleted`
  → canceled); `createCheckoutSession` for the convert flow; plan mapping;
  backup-domain generation.
- **Provisioning** (`src/provisioning/`) — `Provisioner` seam with
  `StubProvisioner` (tests) **and the real `CloudflareProvisioner`** (Registrar
  register + 202 polling, zone ensure/create, Workers Custom Domain attach for
  apex + www). Idempotent + backup-walking.
- **Email** (`src/lead/`) — `LeadEmailSender` seam with `LogSender` (tests) and
  the real `ResendSender` (outbound lead notifications; HTML-escaped).

## Run it

```bash
npm install
npm run typecheck     # tsc, no errors
npm test              # 39 tests, all green (V1 client, V3, V4, V5 sender)
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
- **`oktryme.com`** under our control with DNS on Cloudflare (V1 fallback + V5 sender).
- **Email** (decided, §5a D): **outbound** lead notifications via **Resend** (verify `oktryme.com` + DKIM, API key); **inbound** role addresses via **Cloudflare Email Routing** (free forward). Separate systems.
