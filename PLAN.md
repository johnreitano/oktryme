# Maps Website Builder — Project Plan

**One-line concept:** Preemptively build websites for service businesses found on Google Maps, host a live *preview* for each on our own infrastructure, and on conversion flip it live on the customer's own domain — billing via Stripe (kept in full) on a **two-tier plan: $49/mo self-serve (edit your site by chatting with AI) or $99/mo done-for-you**. No third-party site platform: we self-host static sites on **Cloudflare**.

_Status: planning phase — not yet in build. This document consolidates the research and decisions to date._

> **The tradeoff to keep in view:** we self-host, so **we are the platform** — uptime, SSL, form email, and (for the $99 tier) content edits are all ours. Margin runs ~95% and we keep 100% of the subscription.

---

## 0. Scope, glossary & kill criteria

**Glossary (load-bearing terms used throughout):**
- **`handle`** — our internal slug for a business (e.g. `joes-auto`); the primary key everywhere (data store, preview URL, QR, mail status, Stripe linkage).
- **`business.json`** — the canonical per-business record (scraped facts + AI copy). Single source of truth; the renderer turns it into a site, and edits just mutate it.
- **preview vs live** — *preview* = generated-but-unpaid site on our domain (`oktryme.com/p/{handle}`, yellow banner + CTA); *live* = paid site on the customer's own domain (banner hidden). Same renderer, two entry points.
- **allowlist** — the curated set of worthwhile service-business categories from Step-0 discovery (§1A).

**Out of scope (MVP) — explicitly deferred:**
- Carts, bookings, e-commerce (later optional branch — §1).
- Onboarding customers who **already own a domain** (edge case — §5a).
- **Domain transfer-out** (future stub — §5a F).
- Sending lead email **from the customer's own domain** (MVP sends from ours — §5a D).
- Any use of **photos scraped from Google Maps** (see §1A / §11) — imagery comes from category stock or customer upload only.

**Kill criteria (stop / rethink if):**
- **Net postcard→paid < ~0.30% sustained** (≈ fully-loaded CAC > **~$230**, LTV:CAC < 5:1 at the ~$1,160 LTV). This single net-conversion line — *not* separate scan/close cutoffs — is the kill floor, because scan and close trade off and don't enter the economics symmetrically. The §7 #8 go/no-go tripwire (scan ≥~7%) sits deliberately *above* this line to absorb the noisy early close-rate estimate.
- Steady-state churn materially worse than the 8/6/4% schedule (blended LTV falling below ~$800).
- Stripe **dispute rate trending toward ~1%** (merchant-account risk — §11).

---

## 1. Business model

- **Source:** Outscraper pulls Google Maps business listings (name, owner name, category, address, phone, hours, business description) into structured data. **We use the factual/text fields only — we do *not* scrape or republish Google Maps photos** (copyright we don't own); site imagery comes from category stock or customer upload (§11).
- **Generate:** A templated pipeline + AI-generated copy turns each business's data into a **static website**.
- **Preview/pitch:** Each business gets a live preview URL (on our domain) to view its proposed site before paying.
- **Convert:** A **Stripe** subscription flips the site live on the customer's own domain.
- **Monetize (two tiers, 100% ours — no platform partner, no rev share):**
  - **$49/mo — self-serve.** Customer logs in and **edits their site by chatting with an AI** (the AI makes structured edits to the underlying `business.json` and re-renders). Low ops cost — edits don't consume our labor.
  - **$99/mo — done-for-you.** We make changes for them. Upsell for owners who'd rather not touch it; the premium *funds* the high-touch labor instead of it being a cost center.
- **Service model:** self-serve is the **default**; done-for-you is the **paid escalation** ("find it hard? we'll do it for you for $99"). Keeping most edits self-serve directly contains the edit-labor scaling risk (§11).

### Why self-host (platform decision)

The target market is **static lead-gen sites for service trades** (plumber, HVAC, auto repair, landscaper) — contact form + "request a quote," no carts, no bookings. For that, a heavyweight third-party site platform would add cost and dependency without adding value:

- **Margin & control.** Cloudflare static hosting is effectively free at our volumes, so we keep ~$55 net of every blended subscription — no platform partner, no rev share — while the customer pays one low bill.
- **Simplicity.** One Cloudflare Worker renders preview **and** live from the same data — no per-site provisioning machinery, ownership tricks, or third-party SDK.
- **De-risked.** No dependency on another company's ToS, rate limits, or pricing; no "automated bulk site creation" exposure on someone else's platform.
- **Cleaner offer.** One bill from us: *"$49/mo — we build it, host it, and you edit by chatting with AI; or $99 and we handle every change."* Simple and low → better conversion and stickiness.

**Decision:** Self-host static sites on **Cloudflare**; bill via **Stripe** on two tiers; self-serve AI editing by default, done-for-you as the $99 upsell. (Segmenting commerce-capable businesses to a cart platform remains a *later, optional* branch — not in the MVP.)

---

## 1A. Go-to-market funnel & operations

The customer-acquisition engine. **Step 0 is a one-time setup; steps 1–5 are the repeating loop.**

0. **Category discovery (one-time, before the engine runs).** Pull a **sample of ~1,000 businesses** from the target region and review them (AI-assisted + spot-checks) to identify the **worthwhile service-business categories** — those that (a) fit the static lead-gen model (service + "request a quote," not carts/bookings), (b) **frequently lack a website** (a bigger addressable gap → more targets survive the no-site filter), and (c) plausibly pay **$49–99/mo**. Output: a **curated category allowlist** (e.g. auto repair, HVAC, plumbing, landscaping, roofing, electricians, pest control, salons…) and an explicit **exclude list** (national chains/franchises, categories that almost always already have sites, and poor-fit or low-ability-to-pay types). Re-run periodically as you expand regions.
1. **Source, filter & categorize.** Outscraper pulls Google Maps service businesses. Apply three hard filters before anything else:
   - **On the category allowlist (from Step 0)** — exclude every category not on the list. This is what keeps the funnel pointed only at worthwhile trades.
   - **No existing website (the core filter).** Keep only records where Outscraper's **`site` field is empty/null** — businesses with *no* website URL. "We built you a website" only lands on a business that doesn't have one. It sharply narrows the list but raises intent. _(Treat a bare Facebook/Instagram link or a Google-auto "business profile" page as "no real website" — still a target; refine during the §7 #8 test.)_
   - **Unambiguous business type.** Discard records where the service type isn't clear from the Outscraper fields — clean data in → believable AI copy out.
   Then classify the survivors by service type.
2. **Batch & map.** Take a batch (start: **1,000 businesses**). Generate the `business.json` for the batch and load it into the data store (keyed by `handle`).
3. **Outreach (direct-mail postcard + QR).** Mail each business a personalized **4×6 postcard** bearing its business name and a **unique QR code** that opens its **preview site** (`oktryme.com/p/{handle}`). Hook: *"We already built your website — scan to see it live."* Direct mail carries **no TCPA/CAN-SPAM exposure** and **~100% deliverability** (no carrier filtering); the tradeoff is per-piece cost (see §1B). Sent in automated batches via a print-and-mail API (Lob / PostGrid).
4. **Call + convert.** **Every scan triggers a phone call.** The scan notifies us in real time; we call the warm prospect (number from Outscraper) who is *literally looking at their own finished website* and walk them to **Stripe Checkout ($49/mo self-serve, or $99 done-for-you)**. The human call is what lifts conversion from a passive web rate to **10%+** (see §1B) — it's the core of the funnel, not an afterthought. On payment, we auto-provision the domain and flip the site live.
5. **Retain & expand.** Customers edit via the **self-serve AI chat editor** ($49 tier) or hand changes to us ($99 done-for-you); the owned domain + done-for-you option drive stickiness. Upsell self-serve users to $99, and later to extras (more pages, booking, local SEO).

> ☎️ **The phone call is the differentiator.** Calling a business that just scanned a postcard and viewed its own site is a *warm* B2B follow-up — low legal risk (B2B sales calls to business lines are largely exempt from DNC rules; these prospects just self-identified by scanning). The tradeoff is **labor**: every scan = a call, so calling capacity is the operation's binding constraint (see §1B / §11).

> ✅ **Why direct mail (and not cold SMS/email).** Cold marketing SMS to these leads isn't viable: **TCPA liability** ($500–$1,500 per text, B2B not a clean exemption) plus **carrier filtering** that blocks unconsented bulk sends — and no provider makes cold marketing SMS compliant without prior consent, which scraped Maps leads lack. **Direct-mail postcards have no consent requirement, no TCPA/CAN-SPAM exposure, and no carrier filter** — a mailed piece simply arrives. They cost more per piece, but the model is **self-funding** (bootstrappable on ~$2k, §1B), and the "we already built your site, scan to see it" hook is strong on a physical card.

## 1B. Unit economics & revenue projection

### Revenue per customer (two tiers, blended)

We keep **100%** of both tiers. Assuming a **25% upsell take-rate** to the $99 done-for-you plan:

| | $49 self-serve | $99 done-for-you |
|---|---|---|
| Stripe (2.9% + $0.30) | ~$1.72 | ~$3.17 |
| Domain (~$10/yr amortized) | ~$0.83 | ~$0.83 |
| Hosting + AI edit compute | ~$0.60 | ~$0.10 |
| Done-for-you edit labor | — | ~$15 |
| **Net / customer / month** | **~$46** | **~$80** |

- **Blended gross ARPU** ≈ 0.75 × $49 + 0.25 × $99 ≈ **$61.5/mo**
- **Blended net** ≈ 0.75 × $46 + 0.25 × $80 ≈ **~$55/mo**

> The tiering does two things: raises ARPU **and** moves edit labor onto the customers who pay for it. The $49 tier's edits are self-serve (near-zero marginal labor); the labor-heavy customers self-select into the $99 tier that funds it. **Take-rate is a key assumption** (§7) — but even at 0% upsell the floor is the $49 base, so it's pure upside.

### Funnel assumptions (postcard + phone-call base case)

The base case uses the **floor** of the expected ranges (scan ≥10%, call-close ≥10%) — the model is strong even at the floor.

| Stage | Rate |
|---|---|
| Address deliverable (valid mailing address; not returned) | 95% |
| Delivered → QR scan (preview view) | **10%** (floor; likely 10–20%) |
| Scan → phone call | 100% — **we call every scanner** (number from Outscraper) |
| Scan → paid (after the call) | **10%** (floor; likely 10–20%) |
| **Net postcard → paying customer** | **~0.95%** (~1 per 105 postcards) |
| Net revenue / customer / month (blended, two tiers) | ~$55 |
| Customer LTV (tiered churn — see below) | **~$1,160** (~21 expected months × $55) |
| Monthly churn (front-loaded) | **8% mo 1–3, 6% mo 4–6, 4% thereafter** |
| Mail cost (~$0.60/postcard) | → **mail-only CAC ≈ $63** |
| Calling labor (~10 calls/customer @ ~$2.50/call) | → **+ ~$25/customer** |
| **Fully-loaded CAC (mail + calls)** | **~$88** |
| **LTV : CAC** | **~13 : 1**; **payback ≈ 1.6 months** |

> **Why ~$1,160 LTV (not the old flat-4% $1,375):** churn is front-loaded — unsolicited-origin customers are likeliest to leave early, then the survivors stick. Modeling **8%/mo for months 1–3, 6% for 4–6, and 4% thereafter** gives an expected lifetime of **~21 months** → ~$1,160 LTV. This is the conservative anchor used everywhere below; flat-4% (~$1,375) is upside if early retention beats plan.

> Calling every scanner is what lifts net conversion to **~0.95%** and holds fully-loaded CAC at **~$88** — a **~13:1 LTV:CAC and ~1.6-month payback**. The binding constraint is **calling capacity**, not cash.

### Ramp — bootstrapped: ≤ $2,000 out of pocket, scale calls by hiring reps

Two settings define this path: **(1) never fund more than $2,000 total** — seed $2k, then reinvest 100% of net revenue; and **(2) no call cap — hire sales reps as volume grows.** Because each customer pays back in ~1.6 months, reinvested revenue compounds the active base **~50%/month**. Acq spend each month = the net revenue we reinvest (M1 = the $2k seed); **rep wages are already inside the ~$2.50/call cost**, so the calling team is funded from revenue, not a separate draw. Per-postcard all-in ≈ **$0.85**; CAC ≈ **$88/customer**; reps assumed at ~**60 dials/day** each (~22 business days/mo).

| Month | Postcards | Closing calls | Reps (~60 dials/day) | New paying | Active (end, tiered churn) | Gross MRR exiting @ $61.5 | Monthly profit | Cumulative out-of-pocket |
|---|---|---|---|---|---|---|---|---|
| 1 | ~2,400 | ~230 | 1 (you) | ~23 | 23 | ~$1.4k | −$2,000 | **−$2,000** |
| 2 | ~1,490 | ~140 | 1 (you) | ~14 | 35 | ~$2.1k | ~$0 | **−$2,000** |
| 3 | ~2,360 | ~225 | 1 (you) | ~22 | 54 | ~$3.3k | ~$0 | **−$2,000** |
| 4 | ~3,750 | ~355 | 1 | ~36 | 87 | ~$5.3k | ~$0 | **−$2,000** |
| 5 | ~5,940 | ~565 | 1 | ~57 | 139 | ~$8.5k | ~$0 | **−$2,000** |
| 6 | ~9,420 | ~895 | ~1 | ~90 | 221 | ~$13.6k | ~$0 | **−$2,000** |
| 7 | ~14,930 | ~1,420 | ~1–2 | ~142 | 354 | ~$21.8k | ~$0 | **−$2,000** |
| 8 | ~23,670 | ~2,255 | ~2 | ~225 | 565 | ~$34.7k | ~$0 | **−$2,000** |
| 9 | ~37,500 | ~3,570 | ~3 | ~357 | 899 | ~$55.3k | ~$0 | **−$2,000** |
| 10 | ~59,460 | ~5,660 | ~4–5 | ~566 | 1,429 | ~$87.9k | ~$0 | **−$2,000** |
| 11 | ~94,250 | ~8,975 | ~7 | ~898 | 2,270 | ~$140k | ~$0 | **−$2,000** |
| 12 | ~149,400 | ~14,225 | ~10–11 | ~1,423 | 3,602 | **~$222k** | ~$0 | **−$2,000** |

**Reading the table:**
- **Out-of-pocket never exceeds $2,000** (the seed) — every postcard from month 2 on is paid for by an already-converted customer.
- **Calling scales with the base, and reps scale with calls** — you (solo) cover it through ~month 6; first hire ~month 7–8; ~10–11 reps by month 12. Rep wages are inside the per-call cost, so reps are self-funding.
- **$100k/mo gross MRR ≈ month 10–11**; exiting month 12 at ~$222k/mo gross MRR (3,602 customers). Hiring reps to lift the daily call ceiling is what buys this speed (staying solo would stretch it well past a year).
- **Front-loaded churn barely moves the 12-month curve.** The active counts above already use the **8/6/4% schedule** (§1B), not flat 4% — yet month-12 active is ~3,602 vs ~3,608 under flat-4%, because the higher early-churn months hit only the small early cohorts. The model is robust to worse early retention; it's the *steady-state* 4% that drives LTV.
- **Monthly profit reads ~$0 by choice** (reinvesting all to grow). Stop scaling anytime and profit jumps to ~$55 × active — e.g. pause at month 10 (1,429 customers) → **~$79k/mo**.

> **Per-customer economics (why this works):** ~$88 CAC, ~$55/mo net, **payback ~1.6 months**, ~21-month lifetime → **~$1,075 lifetime profit per customer** (~13:1).

> ⚠️ **Treat the headline timing as idealized — plan to ~month 12–18 for $100k/mo, not month 10.** Two real-world frictions drag the curve right: **(1)** hiring, training, and managing ~10 reps inside a year is a genuine operational lift — recruiting lags demand, and ramp time and call quality vary; **(2)** the curve assumes the **scan + call-close rates hold** (≥10% each, §7 #8) — validate them in the month-1 $2k batch before reinvesting hard. If they come in low, you've risked only ~$2k to find out. The conservative read (12–18 months) is the one to commit to externally; month-10 is the optimistic ceiling.

### Scenario sensitivity (validate the two rates first)

| Scenario | Scan | Call-close | Net→paid | Mail CAC | Fully-loaded CAC | LTV:CAC (@ $1,160 LTV) |
|---|---|---|---|---|---|---|
| **Base (floor)** | 10% | 10% | 0.95% | ~$63 | **~$88** | **~13 : 1** |
| Mid | 15% | 15% | 2.1% | ~$28 | ~$45 | ~26 : 1 |
| High | 20% | 20% | 3.8% | ~$16 | ~$28 | ~41 : 1 |
| _Downside check_ | 5% | 7% | 0.33% | ~$180 | ~$215 | ~5 : 1 (still works) |

Even the **downside check** (well below the expected floor) clears a healthy ~5:1 — the phone call provides real margin of safety.

### The honest verdict

**The two assumptions to prove are scan rate (≥10%?) and call-close (≥10%?)** — optimistic until measured, and the model scales on their product. The phone call gives genuine downside protection: even at half the floor rates, LTV:CAC stays ~5:1. **Mandatory first step is the gating ~2–5k-postcard test (§7 #8)** — run it as a go/no-go tripwire (not a precise rate estimate; see the sample-size note there), validate **calling throughput and cost-per-dial** alongside it (now the operational ceiling), and hold the **§0 kill criteria** ready before reinvesting hard.

---

## 1C. Postcard outreach — automation design (the chosen channel)

Fully automatable, batch print-and-mail with per-business personalization and QR-scan tracking. Reuses the **same Cloudflare Worker** that renders the sites — the QR/tracking layer is just two more routes.

### Provider — split by phase (platform-fee economics)

Both Lob and PostGrid are API-first with Handlebars templates, merge variables, US address verification, and delivery webhooks. The deciding factor is **fee structure**: Lob charges a **per-piece cost (~$0.48 print+post) _plus_ a monthly platform fee** (~$260 Small Business / ~$550 Growth / Enterprise custom). That fee is negligible at scale but a real tax at low volume.

| Volume | Lob effective per piece | Note |
|---|---|---|
| 2,000 (test) | ~$0.61 | $260/mo fee dominates |
| 5,000 (test) | ~$0.53 | fee still stings |
| 100,000 (scale) | ~$0.45–0.48 | fee is a rounding error — Lob very competitive |

**Decision:**
- **Validation test → PostGrid** (lower/no monthly platform fee, ~$0.45–0.55/piece, same API quality) — or Postalytics' free tier — so the ~$2k test isn't inflated by a $260 toll.
- **Scale → Lob _or_ PostGrid**, decided on **negotiated Enterprise per-piece** once real volume is known. Lob's edge is a stronger **variable-data / conditional-logic** engine (per-business QR personalization); PostGrid's edge is **no platform-fee drag**. Re-quote both at the volume you land on.
- We never touch a printer or post office — one API call per recipient → provider prints, stamps, mails.

> Cost-model note: §1B uses **$0.60/piece** as a conservative all-in. Real print+post (~$0.48) trims the mail portion (~$50 vs $63) → **fully-loaded CAC ~$75 vs the modeled $88**. The $0.60 figure stays as the conservative anchor.

### What's on the card
- **Front:** clean hero — *"We built a website for {{business_name}}."* + the big **QR code** + *"Scan to see it live — free to preview."*
- **Back:** 2–3 lines of value, the human-readable short URL (fallback for non-scanners), and a P.S. with the offer. Merge fields: `{{business_name}}`, `{{category}}`, `{{city}}`, `{{qr_url}}`, `{{preview_short_url}}`.

### QR code → preview (with scan tracking)
- QR encodes a **branded short link on our Worker**: `https://oktryme.com/r/{handle}`. Reasons: cleaner card, lets us **count scans**, and decouples the card from the underlying preview path.
- Worker route **`GET /r/{handle}`** → logs the scan (handle, timestamp, UA) → **302 redirects** to the preview `oktryme.com/p/{handle}`.
- Worker route **`GET /qr/{handle}.png`** → renders the QR image for that handle's short link on the fly (template just references `{{qr_url}}` = `https://oktryme.com/qr/{handle}.png`). No pre-generating/hosting thousands of images.
- **Scan = the conversion event** for this channel; ties straight through to the Stripe checkout + provisioning flow (§5).

### Batch send flow
```
business list (from data store, by handle)
   └─► for each record:
         POST postgrid|lob /postcards
           to:   { name, business_name, address_line1/2, city, state, zip }   ← from Outscraper
           from: <our return address>
           front/back: <template id> + merge vars { business_name, category, city,
                        qr_url=/qr/{handle}.png, preview_short_url=/r/{handle} }
           size: 4x6
   └─► provider verifies address, prints, mails
   └─► webhooks (in_transit / delivered / returned) ─► data store logs status by handle
```
- **Address source:** Outscraper business address; provider's US verification catches/repairs bad addresses pre-print. Suppress records that fail verification (feeds the 95% deliverable assumption in §1B).
- **Idempotency:** tag each send with the `handle` (provider metadata) so re-runs don't double-mail; track `mailed_at`.
- **Attribution loop:** `mailed → delivered (webhook) → scanned (/r/{handle}) → subscribed (Stripe)` all keyed by `handle` = clean per-postcard funnel measurement for the validation test.

---

## 2. Billing & site lifecycle

The whole lifecycle is a status flag on a `handle` plus a Stripe subscription.

| State | Meaning | URL | Banner |
|---|---|---|---|
| **preview** | Generated, not paid | `oktryme.com/p/{handle}` | Yellow "PREVIEW" + "Make This My Website" CTA |
| **active** | Paying subscriber | customer's own domain | none |
| **canceled / past_due** | Lapsed | redirect to a soft "site paused" page | — |

- **Billing:** **Stripe subscription — $49 self-serve or $99 done-for-you**, owned by us. We are the merchant of record; the customer's card pays us directly. No platform partner in the money flow. (Checkout defaults to $49; $99 is offered as an upgrade — at checkout and later in-app when a self-serve user struggles.)
- **Activation:** Stripe webhook (`checkout.session.completed` → `customer.subscription.active`) flips the handle `preview → active` and triggers domain provisioning (§5).
- **Dunning:** Stripe handles retries; on final failure → `past_due → canceled`, site shows a "paused — update billing" page (recoverable).
- **Ownership stance (managed, per decision):** we own and operate the site and (by default) the domain; the customer is paying for a managed service, not buying an asset. _Mitigation for the "I own nothing" objection: offer a static-HTML **export** or domain transfer on request (§11)._

---

## 3. End-to-end architecture

```
Outscraper + AI copy ─► business.json in DATA STORE (Cloudflare Worker + KV/D1, + R2 for images)
                                   │
        ┌──────────────────────────┴───────────────────────────┐
        │  ONE Cloudflare Worker = renderer + forms + QR + billing │
        └──────────────────────────┬───────────────────────────┘
            renders by handle (preview)        renders by domain (live)
                    │                                   │
   PREVIEW  oktryme.com/p/{handle}          LIVE  joesautoshop.com
     • yellow "PREVIEW" banner + CTA            • Workers Custom Domain (auto DNS + edge SSL)
     • QR routes /r/{handle}, /qr/{handle}.png  • banner hidden; status=active
                    │                                   ▲
   CONVERT ("Make This My Website") ─► Stripe Checkout ─┘
        webhook ─► flip status active ─► register domain ─► attach Workers Custom Domain ─► live
   FORMS  POST /lead/{handle} ─► email business + store lead
```

### 3a. Data store (Cloudflare)
- Canonical `business.json` per business in **KV/D1**; images in **R2**. Keys: `handle` (preview) and `domain → handle` map (live). Plus `status`, `stripe_customer_id`, `subscription_status`, `mail_status`.
- One source of truth for **both** preview and live — an AI-assisted edit just updates `business.json`; no rebuild, the edge re-renders.

### 3b. Renderer (the site engine)
- **One Worker** renders every site from a small set of templates + the business's `business.json`. Preview mode (by path) shows the banner/CTA; live mode (by custom domain) hides it. Same code, two entry points → preview and live can never drift.
- **Preview sites are `noindex` (robots `noindex,nofollow` + excluded from any sitemap).** Thousands of auto-generated pages about real businesses on one domain is a classic **doorway/spam-network footprint** — left indexable it could get `oktryme.com` penalized *and* rank against the very businesses we're pitching. Only **live** customer sites (on their own domains) are indexable. (Risk §11.)
- Output is fast static HTML/CSS at the edge; great Core Web Vitals and local SEO **for live sites**.
- **Contact form** is a Worker route (`POST /lead/{handle}`) → sends email to the business (transactional provider, e.g. Cloudflare Email / Resend / Postmark) and stores the lead. This is the "request a quote" lead-gen value.

### 3c. Postcard QR/tracking
- Same Worker carries `GET /r/{handle}` (log scan → 302 to preview) and `GET /qr/{handle}.png` (render QR). No extra infrastructure (§1C).

---

## 4. Domain strategy — single-vendor Cloudflare ✅

Cloudflare's **Registrar API (beta, verified June 2026)** registers brand-new domains programmatically — search, real-time availability/pricing, and register **at cost** (~$10.44/.com, no markup), WHOIS privacy free, **completing in seconds**. So we use **Cloudflare end-to-end** — register + DNS + routing + SSL, one vendor, one API token. Because **we register and hold every domain in our own Cloudflare account** (§5a), routing uses **Workers Custom Domains** (auto DNS + auto cert) — **not** Cloudflare for SaaS (which is reserved for the customer-owns-a-domain edge case).

| Step | How | Cost | Notes |
|---|---|---|---|
| **Pick name** | Cloudflare Registrar API: search + availability + pricing | — | `joesautoshop.com` + fallbacks pre-checked at preview time |
| **Register** | Cloudflare Registrar API `register` (workflow response, completes in seconds) | **~$10/yr at cost** | needs account ID, API token w/ Registrar write, billing profile + default registrant contact |
| **Attach + DNS + SSL** | **Workers Custom Domain** (domain in our account) | included | auto-creates proxied DNS record + edge TLS cert, routes → our Worker; no per-site config. _(Cloudflare for SaaS only for customer-owned domains — §5a Edge case.)_ |
| **Renewals** | ⚠️ **not yet in the API** (beta) | — | dashboard for now (see caveat); covered by the subscription; we hold the domain by default, transfer on request |

**Beta caveats (verify in Phase 0 / V2):**
- **Post-purchase lifecycle operations — renewals, transfers, and contact updates — are explicitly named by Cloudflare as "on the roadmap" but NOT yet shipped.** Only *registration* is in the beta API today. Year-1 is fully automated; **year-2 renewals must currently be handled via the dashboard** (or wait for the roadmapped API support). This is a stated commitment, not a guaranteed date — fine at early volume, but **revisit before the first renewals come due** and don't architect as if the lifecycle API already exists.
- **TLD coverage:** only a subset of extensions are in the beta — **confirm .com (and any other target TLDs) are supported** before relying on it.
- **Fallback:** if a needed TLD or renewal automation is missing, keep a third-party registrar API (Porkbun / Name.com ~$10/yr) as backstop; Cloudflare for SaaS still handles hostname + SSL regardless of registrar.
- If a customer already owns a domain, skip registration and just attach their hostname (they add one DNS record).

---

## 5. The fulfillment flow (step-by-step)

1. Lead scans the postcard QR → preview at `oktryme.com/p/{handle}` (banner + **"Make This My Website"**).
2. Clicks CTA → **Stripe Checkout** ($49/mo default; $99 done-for-you offered as upgrade), collecting business contact + desired domain.
3. **Stripe webhook** (`checkout.session.completed`) → flip `handle` to `active`.
4. **Provision domain:** availability re-check → register via **Cloudflare Registrar API** (backups ready) → **attach as a Workers Custom Domain** → auto DNS + SSL. (Full detail + failure handling in §5a.)
5. **Go live:** Worker now serves the site at the custom domain, banner hidden; send welcome email. Live within minutes.
6. **Ongoing:** contact-form leads flow to the business; edit requests handled AI-assisted (update `business.json` → instant re-render).
7. **Cancellation** (Stripe webhook): flip to `canceled` → soft "site paused" page; domain renewal policy per §4.

The "magic moment" — their business live on `joesautoshop.com` minutes after paying — is the reward for converting.

---

## 5a. Production upgrade — detailed flow (we register, own & manage everything)

**Decision: we register and hold every customer's domain in our own Cloudflare account, manage all DNS, and manage TLS. The customer never touches DNS or a registrar.** This resolves the §4 fork: because the domain lives in *our* Cloudflare zone, we attach it with **Workers Custom Domains** (auto-creates the proxied DNS record + edge TLS cert) — **Cloudflare for SaaS is not needed** (that's only for attaching a domain the customer owns elsewhere; see Edge case).

### A. Checkout (credit card)
- **Stripe Checkout**, subscription mode — **$49 self-serve** default with **$99 done-for-you** as an upgrade line. Collected: card, business contact (name, email, phone), and the **confirmed domain choice** (see B).
- **Tax:** enable **Stripe Tax** — US SaaS sales tax is state-dependent and must be handled from day one.
- **Cards/SCA:** Checkout handles 3-D Secure + retries; we store `stripe_customer_id` + `subscription_id` against the `handle`.
- **Terms:** monthly default; offer **annual (prepay discount)** for cash flow + lower churn (§7 #1). **No free trial** — the live preview *is* the trial.

### B. Domain selection
- At **preview time**, pre-check availability for `{business}.com` + a ranked **backup** list (`.com` → `.net`/`.co` → `{business}{city}.com`) via the Registrar **availability** API; cache on the `handle`.
- At checkout the customer **confirms or picks** from available names. Chosen + backups are passed into provisioning so a last-second collision still resolves automatically.

### C. Provisioning (atomic & idempotent — triggered by the Stripe `active` webhook)
Keyed by `handle` so webhook re-delivery never double-provisions; state is persisted after each step:
1. **Register domain** — Registrar API `register` (WHOIS privacy on, free). **We are the registrant** (our default contact); business info stored for records. On "name now taken," walk the backup list automatically.
2. **Zone auto-created** in our account (Registrar domains land as a zone we control) — no separate DNS-host step.
3. **Attach as a Workers Custom Domain** on the site Worker → Cloudflare **auto-creates the proxied DNS record and issues the edge TLS cert** (usually seconds). Add **`www`** (second custom domain or CNAME) redirecting to the apex.
4. **Form email:** for MVP, lead notifications send **from our verified domain** (`leads@oktryme.com`) with **reply-to the business** — zero per-domain email DNS, good deliverability. (Later: send from the customer's domain by adding SPF/DKIM/DMARC here; §7 #7.)
5. **Flip status `active`** — Worker renders the live site at the custom domain (preview banner hidden).
6. **Welcome email** — live URL + how to edit (self-serve AI editor, or upsell to $99 done-for-you).

### D. TLS
- Automatic via Cloudflare **Universal SSL / edge certificate** on our zone — no ACME, no manual certs. Active within seconds of the custom-domain attach; until then the site is reachable on its **fallback subdomain** (`{handle}.oktryme.com`), so there's never a "site down" gap.
- A pre-existing **CAA** record could block issuance — non-issue for fresh domains we register; relevant only in the customer-owns edge case.

### E. Failure handling — payment succeeded but provisioning stalls
Service is **delivered on the fallback subdomain even if the custom domain stalls**, so a paying customer is never left with nothing and we **don't auto-refund**:
- **Registration fails** (all backups taken / registrar error): keep the subscription active, **serve the live site at `{handle}.oktryme.com`**, flag ops, email the customer ("you're live here now; your custom domain is being set up"). Retry with backoff → dead-letter to manual after N tries.
- **TLS / DNS pending:** site stays on the fallback subdomain until the cert is green; a health check flips the "primary URL" automatically.
- **Idempotency & rollback:** each step records state; re-runs resume rather than restart. A hard failure lands in a clean, supportable state (live on subdomain) — never a half-charged/half-built mess.
- **Refunds:** manual, on request (service is delivered); standard Stripe dispute handling.

### F. Cancellation & domain disposition
- Stripe `canceled` / `past_due` webhook → status `canceled` → site shows a recoverable **"site paused — update billing"** page. `business.json` retained for easy reactivation.
- **Domain:** we are the registrant and **retain it by default** — hold through a grace window, then let it lapse (or park if cheap). 
- **🔜 Placeholder — domain transfer-out (future, not in MVP).** If a canceling customer wants to keep their domain, provide a path to **transfer it to their own registrar**: unlock, generate the EPP/auth code, guide the transfer. ⚠️ **ICANN imposes a 60-day transfer lock after initial registration**, so this only works for domains older than 60 days. _Stub the endpoint + support flow now; build alongside the §7 #4 ownership/export decision._

### Edge case — customer already owns a domain
Not the MVP default (we register fresh). When needed later: either (a) **Cloudflare for SaaS** custom hostname (customer adds one CNAME, we provision SSL), or (b) guided nameserver move into our account. Track as a later enhancement.

---

## 6. Components to build

- **Data pipeline:** Outscraper ingest (**text/factual fields only — no Maps photos**, §1A) → **filter (no `site` URL + unambiguous type, §1A)** → normalize → `business.json` schema → AI copy generation → **imagery from a licensed per-category stock set** (default hero/services images keyed by trade) → store in Cloudflare KV/D1 (+ images to R2). Customer-uploaded photos replace stock post-conversion (via the editor / done-for-you).
- **Site Worker (the core):** renders preview (by handle) + live (by custom domain) from templates + `business.json`; serves contact form (`/lead/{handle}`), QR routes (`/r`, `/qr`), and Stripe webhooks.
- **Templates:** a small set of responsive static site templates (hero, services, reviews, hours/map, contact). Yellow preview banner + CTA shown only in preview mode.
- **Billing:** Stripe products/prices ($49 + $99 tiers), Checkout, customer portal (self-serve upgrade $49→$99), webhook handler (activate / dunning / cancel).
- **Provisioning (§5a):** Cloudflare Registrar API client (register; renewals via dashboard until API support lands) + **Workers Custom Domain** automation (auto DNS + cert) + idempotent provisioning job with subdomain fallback + status flip. _(Domain transfer-out is a future stub — §5a F.)_
- **AI chat editor (self-serve, the $49 tier's core):** customer login/auth → chat UI → an AI agent that makes **structured, schema-validated edits to `business.json`** ("change my hours to 9–5," "add this photo," "rewrite my About") → preview → publish (instant re-render). Guardrails: edits constrained to the schema; no fabricated claims; diff/undo. Natural fit since the site already renders from `business.json`.
- **Done-for-you intake ($99 tier):** "do it for me" hands the same request to us; we apply it via the same editor (AI-assisted + human review). The upsell path when self-serve feels hard.
- **Outreach — postcard automation (§1C):** PostGrid/Lob account + front/back templates; batch-send script; QR/tracking routes; `mail_status` + delivery webhooks for attribution.

---

## 7. Open questions

### Pricing / model
1. **Pricing — two tiers: $49 self-serve / $99 done-for-you** (100% ours). Open: the **upsell take-rate** (assumed 25% — the key new revenue assumption); whether to offer/anchor the $99 at checkout vs. surface it later when a self-serve user struggles; annual option (prepay discount → cash flow + lower churn); setup fee (none, to maximize conversion). **Also unvalidated: the ~$15/mo done-for-you edit-labor figure** (§1B) — that's only ~20–40 min/customer/month at modest wage; if real done-for-you customers ask for more, $99-tier net erodes. Track actual edit-time-per-$99-customer once live and re-price or tighten SLA (§7 #3) if it overshoots.

### Product / scope
2. **Template breadth** — how many industry templates for a believable MVP across the **allowlisted top trades** (the §1A Step-0 discovery output drives this list)?
3. **AI chat editor scope & guardrails** — which edit types are self-serve (text, hours, photos, services, colors) vs. out of scope; schema constraints so the AI can't break the site or fabricate claims; undo/diff; and the done-for-you SLA (e.g. 1–2 business days) for the $99 tier. This is now the product backbone, not just an ops workflow.
4. **Ownership / export** — confirm default "we manage & own" stance; define an **export / domain-transfer** offer to defuse the "I own nothing" objection and reduce churn friction.
5. **AI copy guardrails + content provenance** — prevent fabricating claims about a business known only from Maps data (use only verifiable scraped facts + clearly generic marketing language); **no Google Maps photos** (licensed category stock or customer upload only, §6); and define a **takedown/opt-out policy** for any business that objects to its public info being used in a preview.
6. **Data completeness** — handling sparse listings (no hours, no photos, miscategorized).
7. **Contact-form email deliverability** — sending lead notifications on behalf of businesses needs proper SPF/DKIM/from-domain setup to avoid spam folders.

### Outreach / operations
8. **Two-rate validation (gating)** — the **~0.95% net** base case = scan rate (≥10%?) × call-close (≥10%?). Both are optimistic until measured. A **~2,000–5,000-postcard test (~$1.2–3k) with disciplined calling of every scanner** must measure real scan + call-close before scaling. _The two numbers the whole model rides on._
   - **Sample-size reality:** scan rate is the easy one — 2,000 postcards at ~10% yields **~200 scans**, enough to estimate scan rate to roughly ±4 pts. **Call-close is the hard read:** ~200 scans × ~10% = only **~20 conversions**, a 95% CI of roughly ±13 pts (≈ 4%–17%) — too wide to confirm the floor confidently. To pin call-close to ~±5 pts you need **~150+ closed-call outcomes ≈ a few thousand scans ≈ ~30k+ postcards**, which is a *scale* decision, not a $2k test. **So treat the $2k test as a go/no-go tripwire (is scan clearly ≥~7%? does *anyone* convert on the call?), not a precise rate estimate** — then refine call-close continuously as volume ramps, holding the kill criteria (§0) ready. **The tripwire and kill criterion are the same yardstick at two confidence levels:** the kill floor is a single economic line — net postcard→paid < ~0.30% (CAC > ~$232, LTV:CAC < 5:1, §0). The scan ≥~7% tripwire sits *above* that line on purpose: at 7% scan even a disappointing 7% close still nets ~0.49% → ~7:1, clearing the floor with margin to absorb the noisy ~20-conversion close estimate. Three bands: **scale** if projected LTV:CAC ≥ ~8:1 (net ≳0.5%); **iterate** (fix card/script/targeting, retest) between 5:1 and 8:1; **kill** below 5:1.
9. **Calling operation (the operational constraint)** — at ~100k postcards/mo, ~9,500 scans/mo = ~9,500 calls/mo (~7–9 reps). Decide: in-house SDRs vs. outsourced calling vs. a hybrid; the real **cost-per-dial** (assumed ~$2.50); call scripts; CRM + real-time scan→call routing (scan webhook → dialer/queue); hours-of-coverage so warm scanners are called fast (ideally within minutes).

---

## 8. Items to verify by spike (Phase 0)

Cheap end-to-end proofs before pipeline build:

- [ ] **V1 — Domain → live automation:** register a test domain via the **Cloudflare Registrar API** → attach as a **Workers Custom Domain** (auto DNS + edge cert) → SSL active, Worker serves it — fully unattended, minutes not hours. (Confirm Registrar domains land as a zone in our account and Workers Custom Domains can be set via API.)
- [ ] **V2 — Cloudflare Registrar API fit:** confirm the beta API registers our target TLDs (.com etc.) unattended at cost, and decide the **year-2 renewal** path (dashboard now vs. API when it lands). Keep a third-party registrar API as fallback.
- [ ] **V3 — Stripe → provisioning:** Checkout subscription → webhook → status flip → domain provision, end-to-end on a test card.
- [ ] **V4 — Render + edit loop:** Worker renders a real `business.json`; an edit to the JSON re-renders instantly (preview = live engine).
- [ ] **V5 — Form email deliverability:** contact-form submission lands in an inbox (not spam) with correct SPF/DKIM.

---

## 9. Verification scorecard

| Item | Verdict |
|---|---|
| Self-hosted static rendering covers service-business needs (lead-gen + form) | ✅ Yes (no cart/booking in MVP) |
| Workers Custom Domain attaches our-account domains + auto DNS/SSL programmatically | ⏳ Verify V1 |
| New-domain registration automatable via Cloudflare Registrar API (~$10/yr at cost) | ✅ Now possible (beta, Apr 2026) — confirm TLDs + renewal path (V2) |
| Stripe subscription + webhook drives activation/provisioning | ⏳ Verify V3 |
| Preview & live share one renderer (no drift) | ✅ By design — confirm V4 |
| 100% of both tiers retained (no platform rev share) | ✅ Yes |
| Contact-form email deliverability | ⏳ Verify V5 |
| Self-serve AI chat editor edits `business.json` safely | ⏳ Build Phase 6 (schema-constrained, preview/undo) |
| Two-tier upsell ($49→$99) raises ARPU + funds edit labor | ✅ By design (take-rate to validate — §7 #1) |

---

## 10. Suggested build phases

1. **Phase 0 — Spikes (V1–V5).** Prove custom-hostname automation, registrar API, Stripe→provision, render/edit loop, form email. Lowest cost, highest risk-reduction.
2. **Phase 1 — Data layer.** `business.json` schema + Cloudflare KV/D1/R2; handle + domain→handle maps; status fields.
3. **Phase 2 — Site Worker + templates.** Renderer (preview/live), preview banner + CTA, contact form. The product core.
4. **Phase 3 — Category discovery + ingest + copy.** Run **Step-0 category discovery** first (~1,000-business sample → category allowlist, §1A), then Outscraper ingest + the allowlist / no-`site` / unambiguous-type filters + AI copy generation populating the data store (with guardrails, §7 #5).
5. **Phase 4 — Billing + provisioning (§5a).** Stripe Checkout/portal/webhooks ($49 + $99 tiers, Stripe Tax) → status flip → register domain → Workers Custom Domain (auto DNS+SSL) → live, with idempotent provisioning + subdomain fallback on failure. Done-for-you intake to bridge until the editor ships.
6. **Phase 5 — Postcard outreach (§1C).** PostGrid/Lob templates + batch-send + QR/tracking + attribution. **Phase 5a = the gating ~2–5k-postcard validation test** (§7 #8) — run *before* any scale spend.
7. **Phase 6 — AI chat editor (self-serve).** Login/auth + chat UI + schema-validated AI edit agent → preview/publish. Fast-follow, not funnel-gating: launch managed-first, then ship the editor to cap edit-labor as the base scales and to make the $49 tier sustainable. _Build before customer count makes manual edits painful._ **The detailed design — the `business.json` schema, the allowed AI edit operations, and the preview/publish/undo flow — will be fleshed out at the start of this phase.**

---

## 11. Risks (ranked)

1. **Two-rate conversion shortfall — CAC vs. LTV.** The base ~0.95% net rides on scan ≥10% **and** call-close ≥10%; both unproven. If they land far below floor, CAC climbs (though the phone call gives a safety margin — even half-floor ≈ 5:1 LTV:CAC). Mitigation: the gating two-rate test with real calling (§7 #8) before scale; stop if fully-loaded CAC > ~$230 (LTV:CAC < 5:1 at the ~$1,160 LTV — §0 kill criteria). _Where the model lives or dies._
2. **Calling capacity & cost (the binding constraint).** Volume is gated by how many warm scanners you can call fast — ~9,500 calls/mo per 100k postcards (~7–9 reps); slow/incomplete calling silently tanks the close rate that justifies the whole funnel. Mitigation: staff/outsource calling ahead of mail volume; real-time scan→call routing; validate cost-per-dial (§7 #9). _The constraint is calling throughput, not capital._
3. **Edit-labor scaling — largely mitigated by the two-tier model.** Self-serve AI chat (the $49 default) means most edits consume no labor; the labor-heavy customers self-select into the paid $99 tier that funds the work. _Residual risks:_ (a) **before the editor ships** (Phase 6) everyone is effectively managed — watch edits-per-customer-per-month and don't out-scale the manual bridge; (b) **AI editor quality/safety** — a bad edit can break or deface a live customer site, so the editor must be schema-constrained, preview-before-publish, with diff/undo (§7 #3).
4. **We are the platform — uptime / SSL / form deliverability.** Outages, cert failures, or lead emails in spam are now *our* fault. Mitigation: Cloudflare's reliability + Workers Custom Domain auto-SSL + proper SPF/DKIM (V1, V5); monitoring/alerting.
5. **Domain custodian liability (we hold every domain) + Cloudflare lifecycle-API gap.** We register and hold thousands of domains in our own account, and **renewals/transfers/contact-updates are roadmapped-but-unshipped in Cloudflare's API** (§4) — so a missed renewal kills a customer's whole web presence, and "if we vanish, customers lose their domain" is a real trust objection. Mitigation: dashboard-driven renewals with calendar alarms until the lifecycle API lands; confirm target-TLD coverage (V2); keep a third-party registrar API as fallback; offer transfer-out (§5a F) to defuse the trust concern.
6. **Chargeback / dispute rate → Stripe-account risk.** A high dispute rate (~1%+) can get the merchant account suspended — existential given the Stripe dependency. **Materially de-risked by design: conversions are *not* unsolicited** — every paying customer has (a) scanned their postcard QR, (b) verbally agreed on a live phone call, and (c) confirmed again at Stripe Checkout (and again at any $49→$99 upgrade). That triple opt-in, plus clear receipts, easy in-app self-cancel, and a recoverable "site paused" page, should keep disputes low. Mitigation: monitor Stripe dispute rate against the §0 kill criteria; log the scan + call as consent evidence for representment.
7. **Data provenance / IP.** Site content is built from scraped Maps data. Mitigated by scope: we publish only **public factual fields** (business name, owner name, address, phone, hours, description) plus clearly-generic AI marketing copy, and we **never use Google Maps photos** (imagery is licensed category stock or customer-uploaded — §6). Residual: AI-copy fabrication (§7 #5 — verifiable facts only) and the small chance a business objects to its public info being used — honor takedown/opt-out requests promptly.
8. **Preview-site SEO footprint.** Thousands of generated pages on `oktryme.com` risk being flagged as a doorway/spam network and could rank against the businesses we pitch. Mitigation: previews are **`noindex,nofollow` and sitemap-excluded** (§3b); only live customer-domain sites are indexable.
9. **"I own nothing" objection / churn.** Customers don't get a transferable asset by default. Mitigation: offer static-HTML export or domain transfer on request (§7 #4); lead with "done-for-you" value.
10. **Pricing rejection.** SMBs may resist $49–$99/mo (and the 25% upsell take-rate is unproven). Mitigation: test price points (headroom both ways); lead with the "already built + your own domain" hook; consider annual/intro pricing.
11. **Churn higher than the 8/6/4% schedule.** Unsolicited-origin customers may churn faster, especially in the first 90 days. The LTV (~$1,160) already prices in front-loaded churn (§1B); the ramp is robust to it but **sensitive to the steady-state 4%**. Mitigation: managed-service stickiness + owned domain; onboarding nudges in the high-churn early months; watch blended LTV against the §0 kill criteria.

---

## Appendix A — Key source links

- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) (primary routing path) · [Cloudflare for SaaS — custom hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/) (customer-owned-domain edge case)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) · [Pages](https://developers.cloudflare.com/pages/) · [KV](https://developers.cloudflare.com/kv/) · [D1](https://developers.cloudflare.com/d1/) · [R2](https://developers.cloudflare.com/r2/)
- [Stripe Billing / Subscriptions](https://stripe.com/docs/billing/subscriptions/overview) · [Stripe Checkout](https://stripe.com/docs/payments/checkout) · [Webhooks](https://stripe.com/docs/webhooks)
- Registrar APIs: [Porkbun](https://porkbun.com/api/json/v3/documentation) · [Name.com](https://www.name.com/api-docs) · [Dynadot](https://www.dynadot.com/domain/api3.html)
- Print/mail APIs: [Lob](https://docs.lob.com/) · [PostGrid](https://docs.postgrid.com/) · [Postalytics](https://www.postalytics.com/)
- [Outscraper — Google Maps data](https://outscraper.com/google-maps-scraper/)
