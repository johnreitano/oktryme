// Outscraper ingest (Phase 3, §1A/§6 of PLAN.md).
//
// Pulls Google Maps service-business listings and turns the **factual/text
// fields only** into a draft `business.json`. We deliberately do NOT use Google
// Maps photos or republish scraped reviews (§11 — IP we don't own); imagery
// comes from generated per-trade stock (Phase 3 imagery step) or customer
// upload, and marketing copy is generated separately with guardrails (§7 #5).
//
// `normalizeOutscraperRecord` is a pure function (the tested unit). The thin
// `fetchBusinesses` client is gated behind an API key and only runs in the
// ingest script.

import { DAYS_OF_WEEK, type BusinessRecord, type DayOfWeek, type Hours } from "../types.js";
import type { AllowedTrade } from "./allowlist.js";

/**
 * The subset of Outscraper Google Maps fields we consume. Outscraper returns
 * many more; we read only the factual text ones. `working_hours` is a
 * day→string map; everything else is a plain string. The index signature keeps
 * unknown extra fields from breaking typing.
 */
export interface OutscraperRecord {
  name?: string;
  /** Owner name, when Outscraper resolves it (often absent). */
  owner_name?: string;
  owner_title?: string;
  /** Free-text category / business type. */
  type?: string;
  category?: string;
  subtypes?: string;
  /** Existing website URL — the core no-`site` filter keys on this. */
  site?: string;
  description?: string;
  phone?: string;
  full_address?: string;
  street?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  /** Day → "9:00 AM-5:00 PM" | "Closed". Keys may be capitalized. */
  working_hours?: Record<string, string> | null;
  [extra: string]: unknown;
}

/** Lowercase a value to a URL/slug-safe token. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Build a stable `handle` from name + city. Collisions (same name+city) are the
 * caller's problem — the ingest script de-dupes by appending a counter.
 */
export function makeHandle(name: string, city?: string): string {
  const base = slugify(name);
  const suffix = city ? slugify(city) : "";
  // Skip the city suffix when the name already contains it (avoids
  // "knoxville-auto-knoxville").
  return suffix && !base.includes(suffix) ? `${base}-${suffix}` : base;
}

/** Outscraper working_hours → our lowercase-day Hours map (string values only). */
function normalizeHours(raw: OutscraperRecord["working_hours"]): Hours {
  const hours: Hours = {};
  if (!raw || typeof raw !== "object") return hours;
  const byLower = new Map<string, string>();
  for (const [day, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim()) {
      byLower.set(day.trim().toLowerCase(), value.trim());
    }
  }
  for (const day of DAYS_OF_WEEK) {
    const v = byLower.get(day as DayOfWeek);
    if (v) hours[day] = v;
  }
  return hours;
}

/** First non-empty trimmed string from the candidates, or undefined. */
function firstNonEmpty(...candidates: (string | undefined)[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

/**
 * Split a one-line `full_address` ("123 Main St, Knoxville, TN 37902") into the
 * structured Address when the discrete fields are missing. Best-effort; the
 * discrete Outscraper fields are preferred when present.
 */
function splitFullAddress(full: string): {
  line1?: string;
  city?: string;
  state?: string;
  zip?: string;
} {
  const parts = full.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { line1: full.trim() };
  const line1 = parts[0];
  const city = parts[1];
  const stateZip = parts[2] ?? "";
  const m = stateZip.match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
  return {
    line1,
    city,
    state: m?.[1],
    zip: m?.[2],
  };
}

export interface NormalizeOptions {
  /** The matched trade (from the allowlist) — drives label + image theme. */
  trade: AllowedTrade;
  /** Existing handles to avoid collisions against (deduped by appending -2, -3…). */
  takenHandles?: Set<string>;
}

/**
 * Turn one Outscraper record into a draft `BusinessRecord` (status `preview`,
 * `self_serve` plan). Uses factual text fields only — no photos, no reviews.
 * `about` (marketing copy) and `services` are left empty for the copy step;
 * `images` is left empty so the renderer shows the theme gradient until the
 * per-trade image is generated and assigned.
 *
 * The result is a best-effort draft — callers MUST validate it
 * (`validateBusinessRecord`) and drop records that don't pass (e.g. no phone,
 * no parseable address), which doubles as the §7 #6 data-completeness gate.
 */
export function normalizeOutscraperRecord(
  raw: OutscraperRecord,
  opts: NormalizeOptions,
): BusinessRecord {
  const name = firstNonEmpty(raw.name) ?? "";
  const fromFull = raw.full_address ? splitFullAddress(raw.full_address) : {};
  const city = firstNonEmpty(raw.city, fromFull.city) ?? "";
  const state = firstNonEmpty(raw.state, fromFull.state) ?? "";

  // The category string shown in the hero tagline — prefer the scraped type,
  // fall back to our trade label so the tagline is never blank.
  const category =
    firstNonEmpty(raw.category, raw.type, raw.subtypes) ?? opts.trade.label;

  // Factual description only. If Outscraper has none, fall back to a plain
  // trade+location line (a fact, not a marketing claim — §7 #5).
  const description =
    firstNonEmpty(raw.description) ??
    (city && state ? `${opts.trade.label} in ${city}, ${state}.` : opts.trade.label);

  let handle = makeHandle(name || opts.trade.trade, city);
  if (opts.takenHandles) {
    let n = 2;
    const base = handle;
    while (opts.takenHandles.has(handle)) handle = `${base}-${n++}`;
    opts.takenHandles.add(handle);
  }

  return {
    handle,
    status: "preview",
    plan: "self_serve",
    business: {
      name,
      ownerName: firstNonEmpty(raw.owner_name, raw.owner_title),
      category,
      address: {
        line1: firstNonEmpty(raw.street, fromFull.line1) ?? "",
        city,
        state,
        zip: firstNonEmpty(raw.postal_code, fromFull.zip) ?? "",
      },
      phone: firstNonEmpty(raw.phone) ?? "",
      hours: normalizeHours(raw.working_hours),
      description,
    },
    services: [],
    reviews: [], // never republish scraped Maps reviews
    images: {}, // per-trade image assigned later; renderer falls back to gradient
  };
}

// --- live client (gated; only used by scripts/ingest.ts) ---------------------

export interface FetchOptions {
  apiKey: string;
  /** Max records to pull (the validation run uses ~25–50). */
  limit?: number;
  /** Override the API base (tests / mocks). */
  baseUrl?: string;
  /** fetch impl (injectable for tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Pull Google Maps listings for a query (e.g. "auto repair, Knoxville, TN")
 * via Outscraper's synchronous Maps Search. Synchronous mode is fine for the
 * small validation pull; the full discovery run should switch to async polling.
 * Returns the raw records — filtering/normalization happen downstream.
 */
export async function fetchBusinesses(
  query: string,
  opts: FetchOptions,
): Promise<OutscraperRecord[]> {
  const base = opts.baseUrl ?? "https://api.outscraper.cloud";
  const doFetch = opts.fetchImpl ?? fetch;
  const url = new URL("/maps/search-v3", base);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(opts.limit ?? 50));
  url.searchParams.set("async", "false");

  const res = await doFetch(url.toString(), {
    headers: { "X-API-KEY": opts.apiKey },
  });
  if (!res.ok) {
    throw new Error(`Outscraper ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: unknown };
  // Maps Search returns `data` as an array-of-arrays (one per query); flatten.
  const data = Array.isArray(body.data) ? body.data : [];
  const flat = data.flat() as OutscraperRecord[];
  return flat.filter((r) => r && typeof r === "object");
}
