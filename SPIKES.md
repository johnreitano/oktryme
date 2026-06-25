# Phase 0 — Spikes status

Cheap end-to-end proofs before the pipeline build (PLAN.md §8). The render/edit
and billing/provisioning/email code is now **written and unit-tested against the
real Cloudflare, Stripe, and Resend APIs (mocked fetch)**. V3 and V5 are now
verified live; **only V1/V2 remain** (need Cloudflare credentials).

| Spike | What it proves | Status |
|---|---|---|
| **V4 — Render + edit loop** | Worker renders a real `business.json`; a structured edit re-renders instantly (preview = live engine, no drift) | ✅ **Done** — `src/render`, `src/edit`; `test/render.test.ts`, `test/edit-loop.test.ts` |
| **V3 — Stripe → provisioning** | Checkout subscription → signed webhook → status flip → domain provision, idempotent | ✅ **Verified LIVE (test mode, 2026-06-24)** — `/convert/{handle}` created a real `cs_test_…` session; completed checkout → webhook `200 OK` (signature verified) → `joes-auto` flipped `preview→active` with Stripe customer/subscription IDs + stub-provisioned domain. Idempotent across the event burst. `src/billing/stripe.ts`, `src/provisioning` |
| **V1 — Domain → live automation** | Register via Cloudflare Registrar API → Workers Custom Domain → SSL | 🟡 **Read path verified LIVE (2026-06-24); write path pending dedicated account.** Live token confirmed Registrar read, zone read (oktryme.com → active zone), Workers domains list. Found+fixed a `domain-check` parser bug. Remaining: attach→DNS→SSL on the new account. `src/provisioning/cloudflare.ts`, `test/v1-probe.live.test.ts` |
| **V2 — Registrar API fit / TLDs** | Confirm API registers .com at cost; decide renewal path | ✅ **Verified LIVE (2026-06-24)** — Registrar API is **GA** (no beta); `.com` `registrable` at **$10.46 reg / $10.46 renewal** (USD, at-cost). Renewal *automation* via API still a lifecycle gap (PLAN §11) — dashboard/auto-renew for now |
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

**Done & verified:** V2 (Registrar API GA + `.com` at-cost pricing — see below), V2a (registrant contact), V3 (Stripe→activate, live test mode), V4 (render/edit), V5 (Resend→inbox). **Remaining: V1 write-path (attach→SSL), gated on the dedicated-account migration below.**

**V1/V2 live read-only probe — run 2026-06-24 (`test/v1-probe.live.test.ts`, env-gated so plain `npm test` skips it):**
- **V2 ✅** — `domain-check` works; `.com` is `registrable` at **$10.46 registration / $10.46 renewal** (USD, at-cost, no markup; renewal == registration). GA, no beta.
- **🐞 Fixed** — the real GA `domain-check` shape is `result.domains[]` with `name`/`registrable` (not `result[]` with `domain_name`/`available`). `CloudflareProvisioner.isAvailable` was misparsing → returned `true` for everything (even `google.com`). Parser corrected + unit-test mocks updated; full suite 43 green, `google.com → false` now.
- **⚠️ Worker-service finding** — the current account's Workers Custom Domains are on a **`multiplytech`** worker (~5 live auto-glass customer domains), not `maps-website-builder`. Resolved by the dedicated-account move (fresh worker, zero pre-existing domains).
- **Decision (2026-06-24): dedicated Cloudflare account** for this project (under the same login), because a dynamic-zone token must be "all zones from an account" → the account is the only scoping boundary that excludes the unrelated `multiplytech` domains. See migration steps below.

**Environment already wired (durable, on disk):**
- `wrangler.toml` — `account_id` (current acct, holds `oktryme.com`) + real `BUSINESS_KV` namespace id. **Will change to the new account_id post-migration.**
- `.dev.vars` (gitignored, **persists across context clears**) — real `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRICE_SELF_SERVE`, `PRICE_DONE_FOR_YOU`, `RESEND_API_KEY`, `LEADS_FROM`, `OPS_FALLBACK_EMAIL`, `PREVIEW_HOST=oktryme.com`. `CF_ACCOUNT_ID`/`CF_API_TOKEN` now set (current acct, Registrar=Read probe token) — **to be re-minted on the new account**. `CF_WORKER_SERVICE=maps-website-builder`.
- Stripe CLI installed + logged in. Resend: `oktryme.com` **verified**.

**To re-run V3 locally:** `npx wrangler dev` → seed `npx wrangler kv key put --local --binding BUSINESS_KV biz:joes-auto "$(cat test/fixtures/business.sample.json)"` → in another tab `stripe listen --forward-to localhost:8787/stripe/webhook` → `curl localhost:8787/convert/joes-auto` → pay with `4242 4242 4242 4242`.

### Next actions — dedicated-account migration, then V1 write-path
The read-only probe (V2) is done; the remaining V1 piece is the **attach→DNS→SSL write path**, which we run in a **dedicated account** (decision above) so the token never spans the `multiplytech` domains.

**Phase A — stand up the new account (unblocks V1, no oktryme.com dependency):**
1. **Create a new account** under the same Cloudflare login; note its **account id**. ✅ **Done (2026-06-24)** — account created.
   - **Login / account email: `oktrymedigital@gmail.com`** — a standalone mailbox, deliberately **off-domain**. Auth identity must not depend on `oktryme.com` routing: Email Routing follows the zone, so once `oktryme.com` migrates here (Phase B) a `hello@oktryme.com` login would be circular (a routing break would lock you out of the account that hosts the routing). Cloudflare also normalizes Gmail dots/`+aliases`, so `jreitano+oktryme@gmail.com` was rejected as a dup of the existing `jreitano@gmail.com` account — hence a fresh standalone mailbox.
   - **Break-glass member: `jreitano@gmail.com`** invited as a second **Super Administrator** (independent login path, also off-domain). ✅ **Active** in Manage Account → Members (2026-06-24).
   - **Customer-facing:** `hello@oktryme.com` → forwards to `oktrymedigital@gmail.com` (branding/inbound only; **not** an account login). ✅ **Verified (2026-06-24)** — routing lives in the **old `jreitano@gmail.com` account** (where the `oktryme.com` zone still is): Status Enabled, MX `route1/2/3.mx.cloudflare.net` + SPF correct, analytics 5/5 forwarded, 0 failed. An early test bounced only because the destination wasn't verified / DNS hadn't propagated yet; resend landed. (Routing will need to be **re-created** in the new account after the Phase B domain migration — it follows the zone.)
   - **New account id:** `684b0476188597fc51262d99cc67e01f` (not a secret — same kind of id already in `wrangler.toml`). Plugs into `wrangler.toml` `account_id` + `.dev.vars` `CF_ACCOUNT_ID` in **step 4**, *after* the token + `BUSINESS_KV` + worker deploy exist on this account.
2. **Enable Registrar API** on it: set **payment profile**, **default registrant contact** (re-do V2a — Multiply Technologies LLC), accept the **Domain Registration Agreement**.
3. **Mint a scoped Custom token** on the new account — same scopes as before (Account: **Registrar: Domains** [Read for probe / Edit for V1-live], Workers Scripts Edit, Account Settings Read; Zone: Zone/DNS/SSL Edit), **Zone Resources = All zones from an account → the new account**.
4. **Update config:** `wrangler.toml` `account_id` → new id; `.dev.vars` `CF_ACCOUNT_ID`/`CF_API_TOKEN` → new values. `wrangler login` (deploy auth) may also need the new account selected.
5. **Deploy** `maps-website-builder` to the new account (`npx wrangler deploy`) so the worker service exists for custom-domain attach.
6. **Re-run the probe** against the new account, then **V1-live (Phase 4):** register a throwaway `.com` → attach apex+www → confirm SSL green + `whois` shows redacted LLC contact.

**Phase B — migrate `oktryme.com` (preview host) into the new account (separate; needed before previews serve on the brand domain, not for V1-live):**
- Feasible via **inter-account transfer** (same login). `oktryme.com` registered 2013 (>10-day gate ✅). Prep: **release transfer lock** (`clienttransferprohibited`), **disable DNSSEC**, **verify registrant email**, add the domain as a website on the new account, then submit the move under **Manage Domain → Configuration**; gaining account approves by email. **30-day transfer-lock afterward.** WHOIS contact moves as-is; nothing else does (re-create DNS/Worker custom-domain on the new account).

> Note: `CF_API_TOKEN` is the **runtime** token the Worker uses to provision; it's separate from how `wrangler` authenticates to deploy (`wrangler login`). The live probe lives in `test/v1-probe.live.test.ts` — run with `set -a; . ./.dev.vars; set +a; npx vitest run test/v1-probe.live.test.ts`.
