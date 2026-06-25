// Category allowlist + exclude list (Phase 3, §1A Step-0 of PLAN.md).
//
// Step-0 discovery curates the *worthwhile* service-business categories — those
// that (a) fit the static lead-gen model, (b) frequently lack a website, and
// (c) plausibly pay $49–99/mo — plus an explicit exclude list (chains, types
// that almost always already have sites, poor-fit / low-ability-to-pay).
//
// This is the **seed** allowlist for the first region (Knoxville, TN metro). The
// real allowlist is refined by running discovery on a ~1,000-business sample
// (see `scripts/discover.ts` / §1A); the §10 plan says to re-run periodically as
// regions expand. Keeping it as code (not data) makes the filter testable and
// keeps each trade tied to its render theme.

import type { ThemeKey } from "../render/themes.js";

/** A worthwhile trade on the allowlist. */
export interface AllowedTrade {
  /** Canonical trade slug used in copy/imagery keys and analytics. */
  trade: string;
  /** Human label for prompts and reports. */
  label: string;
  /** Render theme this trade maps to (auto/hvac/landscaping or universal). */
  theme: ThemeKey;
  /** Category-text matcher (tested against the scraped category/type string). */
  pattern: RegExp;
}

/**
 * Seed allowlist. Order matters: the first matching trade wins, so place more
 * specific trades before broader ones (none currently overlap). Themes reuse
 * the three Phase-2 skins where they fit; everything else renders `universal`
 * until a dedicated theme is added.
 */
export const ALLOWLIST: AllowedTrade[] = [
  {
    trade: "auto-repair",
    label: "Auto Repair",
    theme: "auto",
    pattern:
      /\b(auto|car|cars|mechanic|tire|tires|collision|body\s?shop|muffler|brake|transmission|oil\s?change|automotive)\b/i,
  },
  {
    trade: "hvac",
    label: "HVAC",
    theme: "hvac",
    pattern:
      /\b(hvac|heating|cooling|air\s?condition\w*|furnace|\bac\b|refrigeration|ductwork)\b/i,
  },
  {
    trade: "landscaping",
    label: "Landscaping",
    theme: "landscaping",
    pattern:
      /\b(landscap\w*|lawn|garden\w*|tree|trees|yard|irrigation|hardscap\w*|nursery|sod|mulch)\b/i,
  },
  {
    trade: "plumbing",
    label: "Plumbing",
    theme: "universal",
    pattern: /\b(plumb\w*|drain|sewer|septic|water\s?heater|leak|repipe)\b/i,
  },
  {
    trade: "roofing",
    label: "Roofing",
    theme: "universal",
    pattern: /\b(roof\w*|gutter\w*|shingle\w*|siding)\b/i,
  },
  {
    trade: "electrical",
    label: "Electrical",
    theme: "universal",
    pattern: /\b(electric\w*|electrician\w*|wiring|panel\s?upgrade)\b/i,
  },
  {
    trade: "pest-control",
    label: "Pest Control",
    theme: "universal",
    pattern: /\b(pest|exterminat\w*|termite\w*|rodent|wildlife\s?control)\b/i,
  },
  {
    trade: "salon",
    label: "Salon & Barber",
    theme: "universal",
    pattern: /\b(salon|barber\w*|hair\s?(stylist|salon)?|nail\s?salon|spa)\b/i,
  },
  {
    trade: "cleaning",
    label: "Cleaning Services",
    theme: "universal",
    pattern:
      /\b(cleaning|janitorial|maid|housekeep\w*|pressure\s?wash\w*|window\s?clean\w*)\b/i,
  },
  {
    trade: "painting",
    label: "Painting",
    theme: "universal",
    pattern: /\b(paint\w*|drywall|stucco)\b/i,
  },
];

/**
 * Exclude list — categories to drop even if they superficially match an
 * allowlist trade. National chains/franchises (they have corporate sites), and
 * types that almost always already have a website or are a poor fit for the
 * $49–99/mo static lead-gen offer.
 */
export const EXCLUDE: RegExp[] = [
  // Categories that nearly always already have a real website / poor fit.
  /\b(dealership|car\s?dealer|insurance|bank|credit\s?union|hospital|pharmacy|hotel|motel|university|college|government|attorney|law\s?firm|real\s?estate|franchise)\b/i,
  // Big-box / national service chains (corporate-owned web presence).
  /\b(jiffy\s?lube|midas|firestone|walmart|home\s?depot|lowe'?s|autozone|valvoline|meineke|aamco|terminix|orkin|merry\s?maids)\b/i,
];

export interface Classification {
  /** True if the category is on the allowlist and not excluded. */
  allowed: boolean;
  /** Matched trade (present iff `allowed`). */
  trade?: AllowedTrade;
  /** Why it was rejected (present iff not `allowed`). */
  reason?: "excluded" | "not-on-allowlist" | "empty-category";
}

/**
 * Classify a scraped category/type string against the allowlist + exclude list.
 * The exclude list takes precedence over the allowlist (a "Jiffy Lube" matches
 * the auto pattern but is an excluded chain).
 */
export function classifyCategory(category: string | undefined): Classification {
  const text = (category ?? "").trim();
  if (!text) return { allowed: false, reason: "empty-category" };

  if (EXCLUDE.some((rx) => rx.test(text))) {
    return { allowed: false, reason: "excluded" };
  }
  const trade = ALLOWLIST.find((t) => t.pattern.test(text));
  if (!trade) return { allowed: false, reason: "not-on-allowlist" };

  return { allowed: true, trade };
}
