# Phase 0 — Spikes status

Cheap end-to-end proofs before the pipeline build (PLAN.md §8). The render/edit
and billing/provisioning/email code is now **written and unit-tested against the
real Cloudflare, Stripe, and Resend APIs (mocked fetch)**. V3 and V5 are now
verified live; **only V1/V2 remain** (need Cloudflare credentials).

| Spike | What it proves | Status |
|---|---|---|
| **V4 — Render + edit loop** | Worker renders a real `business.json`; a structured edit re-renders instantly (preview = live engine, no drift) | ✅ **Done** — `src/render`, `src/edit`; `test/render.test.ts`, `test/edit-loop.test.ts` |
| **V3 — Stripe → provisioning** | Checkout subscription → signed webhook → status flip → domain provision, idempotent | ✅ **Verified LIVE (test mode, 2026-06-24)** — `/convert/{handle}` created a real `cs_test_…` session; completed checkout → webhook `200 OK` (signature verified) → `joes-auto` flipped `preview→active` with Stripe customer/subscription IDs + stub-provisioned domain. Idempotent across the event burst. `src/billing/stripe.ts`, `src/provisioning` |
| **V1 — Domain → live automation** | Register via Cloudflare Registrar API → Workers Custom Domain → SSL | 🟡 **Code-complete, awaiting creds** — `CloudflareProvisioner` (`src/provisioning/cloudflare.ts`) implements register + poll + zone + custom-domain attach; `test/cloudflare-provisioner.test.ts`. Needs CF account + Registrar beta + token to run live |
| **V2 — Registrar API fit / TLDs** | Confirm beta registers .com at cost; decide renewal path | 🟡 **Read-only probe once token exists** — endpoints wired in the client |
| **V5 — Form email deliverability** | Lead email lands in inbox (SPF/DKIM) | ✅ **Verified LIVE (2026-06-24)** — `POST /lead/{handle}` → Resend → **landed in Gmail inbox** from `leads@oktryme.com` (domain verified in Resend, DKIM/SPF). `src/lead/resend.ts`; `test/email-and-checkout.test.ts` |

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

## Resume here (single pick-up point after a context clear)

_Project conventions (secrets, git workflow, dev/test commands) live in `CLAUDE.md`, auto-loaded each session. This section is current build **state** + next actions._

**Done & verified:** V2a (registrant contact), V3 (Stripe→activate, live test mode), V4 (render/edit), V5 (Resend→inbox). **Remaining: V1 + V2 only.**

**Environment already wired (durable, on disk):**
- `wrangler.toml` — `account_id` (Jreitano acct, holds `oktryme.com`) + real `BUSINESS_KV` namespace id.
- `.dev.vars` (gitignored, **persists across context clears**) — real `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRICE_SELF_SERVE`, `PRICE_DONE_FOR_YOU`, `RESEND_API_KEY`, `LEADS_FROM`, `OPS_FALLBACK_EMAIL`, `PREVIEW_HOST=oktryme.com`. `CF_ACCOUNT_ID`/`CF_API_TOKEN` are intentionally **blank** so stub provisioning is used until V1.
- Stripe CLI installed + logged in. Resend: `oktryme.com` **verified**.

**To re-run V3 locally:** `npx wrangler dev` → seed `npx wrangler kv key put --local --binding BUSINESS_KV biz:joes-auto "$(cat test/fixtures/business.sample.json)"` → in another tab `stripe listen --forward-to localhost:8787/stripe/webhook` → `curl localhost:8787/convert/joes-auto` → pay with `4242 4242 4242 4242`.

### Next actions — V1 / V2 (the only remaining spikes)
Both need **Cloudflare credentials**, then the `CloudflareProvisioner` (already built) runs live:
1. **Registrar beta enrollment** — Cloudflare dash → Domain Registration → request API beta access. Confirm `.com` is in beta + the renewal path (this *is* V2). Set a **payment method** + **default registrant contact** (business identity, §5a — done as V2a).
2. **Create a scoped API token** — Custom token, **Zone perms = All zones** (new customer domains become new zones):
   - Account: Workers Scripts (Edit), Workers KV Storage (Edit), Domain Registration/Registrar (Edit), Account Settings (Read)
   - Zone: DNS (Edit), Zone (Edit), SSL and Certificates (Edit)
3. **Fill `.dev.vars`**: `CF_ACCOUNT_ID=734b321b1df2945df836ce873a7d2893`, `CF_API_TOKEN=…`, `CF_WORKER_SERVICE=maps-website-builder`. (Non-empty `CF_*` auto-switches the Worker from stub to real `CloudflareProvisioner`.)
4. **Run V1:** register a throwaway test domain → attach Workers Custom Domain → confirm SSL green + `whois` shows redacted business contact (not personal).

> Note: `CF_API_TOKEN` is the **runtime** token the Worker uses to provision; it's separate from how `wrangler` authenticates to deploy (`wrangler login`).
