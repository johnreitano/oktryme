# oktryme.com — project guide for Claude

Preemptive websites for service businesses found on Google Maps: generate a static
**preview** per business, mail a postcard with a QR code, convert via **Stripe**, and
flip the site **live on the customer's own domain**. Self-hosted on a single
**Cloudflare Worker** (no third-party site platform). Brand/host: `oktryme.com`;
legal entity: Multiply Technologies LLC.

## Load state at the start of every session
Treat these two docs as the source of truth — don't re-derive state from `git log`:
- **`SPIKES.md` → "Resume here"** — current build status and the exact next actions (operational pick-up point).
- **`PLAN.md`** — strategy, unit economics, and decisions (§-numbered; e.g. §5a provisioning, §11 risks).

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
