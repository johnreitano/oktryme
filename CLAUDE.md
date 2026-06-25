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
- **When a service only has a web dashboard (no CLI/API for the task), do the change yourself in the browser via Browser MCP** — Cloudflare/Stripe/Outscraper/registrar/print-mail dashboards, etc. Browser MCP drives *my own Chrome* (my real, already-logged-in sessions), so don't hand me click-by-click instructions for something you can do there. Confirm specifics first for money/irreversible actions (below), then make the change and report what you did.
- **Login is the one browser thing I do, and I do it once.** Because Browser MCP uses my own Chrome, I just need to be **signed in to the dashboards you'll need** in that browser (and the Browser MCP connection active). Early in a task — front-loaded with the other gates — ask me to sign into anything I'm not already in and to **stay logged in**; then reuse that session for the rest of the task. Treat a logged-in browser as my durable auth, not a per-step approval.
- Only hand back what you truly can't do, as a single concrete action: **(1)** the initial login above (and any other interactive auth, e.g. `wrangler login`), **(2)** spends that exceed the budget policy below, or irreversible actions — confirm specifics first (within-budget spends you just make and log), **(3)** decisions only I can make.

## Front-load human intervention at the start of each phase
The only things I must do by hand are the three buckets above (interactive auth, over-budget or irreversible actions, decisions only I can make). **Surface all of them up front, batched, before writing phase code** — never drip them out mid-build.
- **Open each phase by scanning for those gates** and presenting them as one bundle: the decisions (with a recommended default each, so I'm approving, not authoring) + the exact dashboard/auth/billing steps. Pre-draft anything I'm signing off (schema, config) so the decision is a yes/no.
- **Account setup gates are one-time, not per-task** — widening a token, enabling a product (R2, Stripe), accepting billing. Doing them once at a phase boundary often unblocks several later phases, so prefer front-loading them even when the code that needs them lands later.
- **After the bundle, run autonomously** — start the non-blocked code immediately (in parallel with my dashboard steps), and don't stop again until the next genuine gate. Aim for one human touchpoint per phase, at the top.

## Spending authority & budget
You may spend money on my behalf **within a running budget** instead of asking before every charge.
- **Budget cap (current): $100.00.** Track every spend against it in the ledger below and **never exceed the cap** without my explicit approval.
- **Within the cap, spend without asking** when the charge serves the current task (Outscraper/Gemini API usage, a domain registration, a print-and-mail batch, etc.). **Log it in the ledger immediately** and tell me what you spent.
- **Confirm with me first** when a single charge is **≥ $25**, the charge is **recurring** (subscription / auto-renew), it would **push the total past the remaining budget**, or it's irreversible and unusual.
- **Estimate before spending** and take the cheapest path that meets the need (small validation pulls before full runs — "validate small first"). When the budget is exhausted (or a needed spend won't fit), **stop and ask me to raise the cap** — never proceed on credit.
- Update the ledger in the same change as the spend; keep `Spent`/`Remaining` and the log in sync.

**Ledger** (update on every spend):

| Allowed | Spent | Remaining |
|---|---|---|
| $100.00 | $10.00 | $90.00 |

| Date | Item | Amount | Running total |
|---|---|---|---|
| 2026-06-25 | Outscraper API credits (prepaid top-up; activates API + funds the §7 #8 validation pull) | $10.00 | $10.00 |

> Known recurring cost *outside* this budget: `assessmybusiness.app` (V1-live, §8) auto-renews ~$14.20/yr — disable in the Cloudflare dashboard if not keeping it. Fold it into the ledger only if/when it renews.

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
