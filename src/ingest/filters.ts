// Ingest filters (Phase 3, §1A of PLAN.md).
//
// Three hard filters applied to scraped records before anything else:
//   1. On the category allowlist  — keep only worthwhile trades (§1A Step-0).
//   2. No existing website (core) — keep only records with an empty `site`.
//   3. Unambiguous business type  — drop records whose type isn't clear.
// Together these keep the funnel pointed at businesses that lack a real site
// and whose trade we can render believably.

import { classifyCategory, type AllowedTrade } from "./allowlist.js";
import type { OutscraperRecord } from "./outscraper.js";

export type RejectReason =
  | "has-website"
  | "excluded"
  | "not-on-allowlist"
  | "ambiguous-type";

export interface KeptRecord {
  record: OutscraperRecord;
  trade: AllowedTrade;
}

export interface RejectedRecord {
  record: OutscraperRecord;
  reason: RejectReason;
}

export interface FilterResult {
  kept: KeptRecord[];
  rejected: RejectedRecord[];
  /** Reject counts by reason, for the funnel report. */
  summary: Record<RejectReason, number> & { kept: number; total: number };
}

/**
 * A bare Facebook/Instagram link or a Google auto-generated "business profile"
 * page counts as "no real website" — still a target (§1A). Anything else in the
 * `site` field is a real site → drop the record.
 */
const SOCIAL_OR_AUTO = [
  /facebook\.com/i,
  /instagram\.com/i,
  /business\.google\.com/i,
  /\.business\.site/i, // Google "business profile" auto-sites
  /linktr\.ee/i,
  /yelp\.com/i,
];

export function hasRealWebsite(site: string | undefined): boolean {
  const url = (site ?? "").trim();
  if (!url) return false;
  return !SOCIAL_OR_AUTO.some((rx) => rx.test(url));
}

function categoryText(r: OutscraperRecord): string | undefined {
  return (
    [r.category, r.type, r.subtypes].find(
      (v) => typeof v === "string" && v.trim(),
    ) as string | undefined
  );
}

/**
 * Apply the three §1A filters to a batch of raw Outscraper records. Records are
 * evaluated independently; the result carries the survivors (with their matched
 * trade) plus every rejection tagged with a reason for the funnel report.
 *
 * Filter order: no-`site` first (cheapest, highest-signal), then the
 * allowlist/exclude/ambiguity classification.
 */
export function applyFilters(records: OutscraperRecord[]): FilterResult {
  const kept: KeptRecord[] = [];
  const rejected: RejectedRecord[] = [];
  const summary = {
    total: records.length,
    kept: 0,
    "has-website": 0,
    excluded: 0,
    "not-on-allowlist": 0,
    "ambiguous-type": 0,
  } as FilterResult["summary"];

  for (const record of records) {
    // v3 uses `website`; some variants `site`.
    if (hasRealWebsite(record.website ?? record.site)) {
      rejected.push({ record, reason: "has-website" });
      summary["has-website"]++;
      continue;
    }

    const cls = classifyCategory(categoryText(record));
    if (!cls.allowed) {
      const reason: RejectReason =
        cls.reason === "excluded"
          ? "excluded"
          : cls.reason === "empty-category"
            ? "ambiguous-type"
            : "not-on-allowlist";
      rejected.push({ record, reason });
      summary[reason]++;
      continue;
    }

    kept.push({ record, trade: cls.trade! });
  }

  summary.kept = kept.length;
  return { kept, rejected, summary };
}
