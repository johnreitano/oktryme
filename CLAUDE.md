# oktryme.com — project guide for Claude

Preemptive websites for service businesses found on Google Maps: generate a static
**preview** per business, mail a postcard with a QR code, convert via **Stripe**, and
flip the site **live on the customer's own domain**. Self-hosted on a single
**Cloudflare Worker** (no third-party site platform). Brand/host: `oktryme.com`;
legal entity: Multiply Technologies LLC.

## Load state at the start of every session
**`PLAN.md` is the single source of truth** — strategy, unit economics, decisions, phases, and the forward task list (§-numbered; e.g. §5a provisioning, §5b infra & `oktryme.com` cutover, §8 spikes, §10 phases, §11 risks). Don't re-derive state from `git log`.
- **`SPIKES.md`** is a **temporary Phase-0 build log** (the cheap end-to-end proofs) — the operational pick-up point *only while Phase 0 is open*, and it **retires once Phase 0 closes** (only V1-live remains). For anything forward-looking, **PLAN.md wins**; if the two disagree, fix `SPIKES.md` to match `PLAN.md`.

## Do external config directly on my behalf
- For anything reachable via CLI or API (`wrangler`, Cloudflare/Stripe API, DNS, config edits), **just do it** once auth exists — don't hand me commands to run.
- Only hand back what you truly can't do, as a single concrete action: **(1)** interactive browser auth (e.g. `wrangler login`), **(2)** spending money / irreversible actions (do the call, but confirm specifics first), **(3)** decisions only I can make.

## Secrets
- All secrets live in **`.dev.vars`** (gitignored): Stripe, Resend, and — when set — Cloudflare.
- **Never paste secret values into chat, and never commit them.** Reference key names only.
- `.dev.vars.example` documents every key. Empty `CF_*` keeps the stub provisioner; filling them switches the Worker to real Cloudflare provisioning.

## Git workflow
- Always work on a **feature branch** — never commit directly to `main`.
- Ship via: **PR → merge to `main` → `git fetch origin main` → `git rebase origin/main`**.
- End commit messages with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

## Dev / test
- Cloudflare Worker in **TypeScript**. Wrangler is a local dependency — always use **`npx wrangler …`**.
- Validate with: `npm test` (vitest), `npm run typecheck`, `npx wrangler deploy --dry-run`.
- Local run: `npx wrangler dev --port 8787` (KV is simulated locally; seed with
  `npx wrangler kv key put --local --binding BUSINESS_KV biz:<handle> "<json>"`).
- Stripe test: `stripe listen --forward-to localhost:8787/stripe/webhook`; test card `4242 4242 4242 4242`.
