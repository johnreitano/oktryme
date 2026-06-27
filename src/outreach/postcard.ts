// Postcard content + provider payload (§1C of PLAN.md).
//
// The 4×6 card: front = hero + big QR ("We built a website for {business}");
// back = value lines + the human-readable short URL (fallback for non-scanners)
// + a P.S. offer. Address blocks are placed by the provider from the `to`/`from`
// objects, so the back HTML is the message area only.
//
// We render the templates locally (a tiny `{{var}}` substitution) and send fully
// resolved HTML, rather than leaning on the provider's templating engine — keeps
// the output testable and provider-agnostic. The merge-var contract is the five
// fields named in §1C.

import type { BusinessRecord } from "../types.js";

/** The §1C merge-field contract — every postcard template variable. */
export interface PostcardMergeVars {
  business_name: string;
  category: string;
  city: string;
  /** Absolute URL of the QR image (our self-hosted /qr route). */
  qr_url: string;
  /** Human-readable short URL printed for non-scanners (the /r short link). */
  preview_short_url: string;
}

/** A mailing address in the provider's shape (PostGrid contact fields). */
export interface PostcardAddress {
  firstName?: string;
  companyName?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  provinceOrState: string;
  postalOrZip: string;
  /** ISO-3166 alpha-2; US only for MVP. */
  country: string;
}

/** Provider-agnostic create-postcard request (maps 1:1 to PostGrid's body). */
export interface PostcardRequest {
  to: PostcardAddress;
  from: PostcardAddress;
  /** PostGrid sizes are width×height — a 6×4 (landscape 4×6) card. */
  size: "6x4";
  frontHTML: string;
  backHTML: string;
  /** Correlates webhooks + enforces idempotency (one postcard per handle). */
  metadata: { handle: string };
}

/**
 * Whether a record should be mailed by a batch run: a live `preview` site that
 * hasn't already been mailed. A previous `failed` send is retryable; any other
 * mail state (`mailed`/`in_transit`/`delivered`/`returned`/`queued`) is skipped
 * so re-runs never double-mail (idempotency by `handle`, §1C).
 */
export function isMailable(rec: BusinessRecord): boolean {
  if (rec.status !== "preview") return false;
  const s = rec.mail?.status;
  return s === undefined || s === "failed";
}

/** Derive the five merge vars from a business record + the serving host. */
export function mergeVarsFor(rec: BusinessRecord, host: string): PostcardMergeVars {
  return {
    business_name: rec.business.name,
    category: rec.business.category,
    city: rec.business.address.city,
    qr_url: `https://${host}/qr/${rec.handle}.svg`,
    preview_short_url: `${host}/r/${rec.handle}`,
  };
}

/** Map a record's scraped address into the provider's recipient shape. */
export function recipientFor(rec: BusinessRecord): PostcardAddress {
  const a = rec.business.address;
  return {
    firstName: rec.business.ownerName,
    companyName: rec.business.name,
    addressLine1: a.line1,
    addressLine2: a.line2,
    city: a.city,
    provinceOrState: a.state,
    postalOrZip: a.zip,
    country: "US",
  };
}

/** Minimal, dependency-free `{{var}}` substitution. Unknown vars render empty. */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

// 4×6 card at 300 DPI ≈ 1800×1200 px. We size in inches and let the provider
// rasterize; inline styles only (external CSS isn't loaded by print renderers).
const FRONT_TEMPLATE = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  .card{width:6in;height:4in;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;
        display:flex;align-items:center;padding:0.35in 0.4in;color:#0b1f33}
  .copy{flex:1;padding-right:0.3in}
  .h1{font-size:30pt;font-weight:800;line-height:1.05;margin:0 0 0.12in}
  .sub{font-size:13pt;color:#1f3a52;margin:0}
  .qr{width:2.0in;height:2.0in}
  .qr img{width:100%;height:100%;display:block}
  .scan{font-size:10pt;text-align:center;margin:0.06in 0 0;font-weight:700;color:#0b1f33}
</style></head><body>
<div class="card">
  <div class="copy">
    <p class="h1">We built a website for {{business_name}}.</p>
    <p class="sub">A ready-to-launch site for your {{city}} business — yours to see, free.</p>
  </div>
  <div>
    <div class="qr"><img src="{{qr_url}}" alt="Scan to preview"></div>
    <p class="scan">Scan to see it live</p>
  </div>
</div>
</body></html>`;

const BACK_TEMPLATE = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  .msg{width:3.6in;height:4in;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;
       padding:0.35in 0.3in;color:#0b1f33}
  .lead{font-size:12pt;font-weight:700;margin:0 0 0.1in}
  p{font-size:10.5pt;line-height:1.4;margin:0 0 0.1in}
  .url{font-size:11pt;font-weight:700;color:#0b3a82}
  .ps{font-size:9.5pt;color:#42526b;margin-top:0.12in}
</style></head><body>
<div class="msg">
  <p class="lead">Hi {{business_name}} — your website is ready to preview.</p>
  <p>We design sites for {{category}} businesses, host them, and put them on your own
     domain. No setup fees. Cancel anytime.</p>
  <p>See yours: <span class="url">{{preview_short_url}}</span></p>
  <p class="ps">P.S. Scan the code on the front to view it on your phone right now.</p>
</div>
</body></html>`;

/**
 * Build the full create-postcard request for a record. `from` is the (non-
 * residential, §5a) return address supplied by the caller; `host` is the brand
 * host the QR/short links resolve on (`oktryme.com`).
 */
export function buildPostcardPayload(
  rec: BusinessRecord,
  opts: { host: string; from: PostcardAddress },
): PostcardRequest {
  const vars = mergeVarsFor(rec, opts.host) as unknown as Record<string, string>;
  return {
    to: recipientFor(rec),
    from: opts.from,
    size: "6x4",
    frontHTML: renderTemplate(FRONT_TEMPLATE, vars),
    backHTML: renderTemplate(BACK_TEMPLATE, vars),
    metadata: { handle: rec.handle },
  };
}
