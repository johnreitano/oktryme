/**
 * Step-0 category discovery (§1A of PLAN.md). Run with tsx:
 *
 *   npm run discover -- --limit 8            # validate small first (~8/query)
 *   npm run discover -- --limit 75           # full ~1,000-business sweep (~$3)
 *   npm run discover -- --use-cache          # re-analyze the cached raw pull (no spend)
 *
 * Unlike `scripts/ingest.ts` — which queries Outscraper *per seed-allowlist
 * trade* and so can only ever rediscover the trades we already listed — this
 * sweeps a set of **broad service sectors** and then aggregates the survivors by
 * Google's own returned category string. That surfaces specific categories we
 * never enumerated, which is the whole point of discovery: decide the allowlist
 * from data, not from our prior guesses.
 *
 * For each Google category we report: how many businesses, how many lack a real
 * website (the core §1A filter, reused from `filters.ts`), and the resulting
 * no-site rate. The ranked report is the input to the human/AI judgment that
 * finalizes `src/ingest/allowlist.ts` (fit-for-static-lead-gen + frequently-
 * lacks-a-site + plausibly-pays-$49–99).
 *
 * Outscraper bills per record *returned* (~$3/1,000, no enrichment), so the raw
 * pull is cached to `discovery-output/raw.json`; re-runs with --use-cache cost
 * nothing. Keys come from .dev.vars / the environment (OUTSCRAPER_API_KEY).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  fetchBusinesses,
  slugify,
  type OutscraperRecord,
} from "../src/ingest/outscraper.js";
import { hasRealWebsite } from "../src/ingest/filters.js";
import { classifyCategory, ALLOWLIST } from "../src/ingest/allowlist.js";

const REGION = "Knoxville, TN";
const OUT_DIR = "discovery-output";

/**
 * Broad service *sectors* (not specific trades). Each pulls a slice of Google
 * Maps; the specific category falls out of each record's own `category` field.
 * Chosen to span the local-service universe a homeowner/small-biz would search,
 * deliberately wider than the seed allowlist so net-new categories surface.
 */
const SECTORS: string[] = [
  "home services",
  "contractors",
  "auto repair",
  "hvac",
  "plumber",
  "electrician",
  "roofing",
  "landscaping",
  "lawn care",
  "pest control",
  "cleaning services",
  "painters",
  "handyman",
  "fencing",
  "garage door",
  "flooring",
  "tree service",
  "appliance repair",
  "auto detailing",
  "towing",
  "locksmith",
  "pressure washing",
  "hair salon",
  "barber shop",
  "nail salon",
  "day spa",
  "concrete contractor",
  "pool service",
];

// --- tiny .dev.vars loader (shared shape with scripts/ingest.ts) -------------
function loadDevVars(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  try {
    const text = readFileSync(resolve(".dev.vars"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (env[m[1]] === undefined) env[m[1]] = val;
    }
  } catch {
    /* no .dev.vars — rely on process.env */
  }
  return env;
}

function opt(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** The specific category Google attached to a record (the discovery signal). */
function primaryCategory(r: OutscraperRecord): string {
  const c = [r.category, r.type, r.subtypes].find(
    (v) => typeof v === "string" && v.trim(),
  ) as string | undefined;
  // `subtypes` can be comma-joined ("Auto repair shop, Brake shop"); take the first.
  return (c ?? "").split(",")[0].trim();
}

/** Stable identity for de-duping the same business pulled by two sectors. */
function dedupeKey(r: OutscraperRecord): string {
  const name = slugify(r.name ?? "");
  const where = slugify(
    (r.full_address ?? r.address ?? r.city ?? "") as string,
  );
  return `${name}|${where}`;
}

interface CatStat {
  category: string;
  total: number;
  noSite: number;
  /** Does the current seed allowlist already catch this category? */
  seedAllowed: boolean;
  /** Seed reason when not allowed (excluded / not-on-allowlist / empty). */
  seedReason?: string;
}

async function gatherRaw(env: Record<string, string>): Promise<OutscraperRecord[]> {
  const cachePath = resolve(OUT_DIR, "raw.json");
  if (flag("use-cache")) {
    if (!existsSync(cachePath)) throw new Error(`--use-cache but ${cachePath} missing`);
    const cached = JSON.parse(readFileSync(cachePath, "utf8")) as OutscraperRecord[];
    console.log(`Loaded ${cached.length} cached records from ${cachePath}`);
    return cached;
  }

  if (!env.OUTSCRAPER_API_KEY) throw new Error("OUTSCRAPER_API_KEY not set (or use --use-cache)");
  const perQueryLimit = Number(opt("limit", "8"));
  const maxSectors = Number(opt("sectors", String(SECTORS.length)));
  const sectors = SECTORS.slice(0, maxSectors);

  console.log(
    `Sweeping ${sectors.length} sectors × ${perQueryLimit} each (≈ ${sectors.length * perQueryLimit} billed records) in ${REGION}`,
  );
  const raw: OutscraperRecord[] = [];
  for (const sector of sectors) {
    const query = `${sector}, ${REGION}`;
    process.stdout.write(`  ${query} … `);
    try {
      const batch = await fetchBusinesses(query, {
        apiKey: env.OUTSCRAPER_API_KEY,
        limit: perQueryLimit,
      });
      console.log(`${batch.length} records`);
      raw.push(...batch);
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
    }
  }

  mkdirSync(resolve(OUT_DIR), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(raw, null, 2));
  console.log(`\nCached ${raw.length} raw records → ${cachePath}`);
  return raw;
}

function analyze(raw: OutscraperRecord[]): {
  stats: CatStat[];
  uniqueCount: number;
  overallNoSiteRate: number;
} {
  // De-dupe across sectors first (same business returned by multiple queries).
  const seen = new Map<string, OutscraperRecord>();
  for (const r of raw) {
    const key = dedupeKey(r);
    if (!seen.has(key)) seen.set(key, r);
  }
  const unique = [...seen.values()].filter((r) => (r.name ?? "").trim());

  const byCat = new Map<string, CatStat>();
  let noSiteTotal = 0;
  for (const r of unique) {
    const cat = primaryCategory(r) || "(uncategorized)";
    const key = cat.toLowerCase();
    let stat = byCat.get(key);
    if (!stat) {
      const cls = classifyCategory(cat);
      stat = {
        category: cat,
        total: 0,
        noSite: 0,
        seedAllowed: cls.allowed,
        seedReason: cls.reason,
      };
      byCat.set(key, stat);
    }
    stat.total++;
    if (!hasRealWebsite(r.website ?? r.site)) {
      stat.noSite++;
      noSiteTotal++;
    }
  }

  const stats = [...byCat.values()].sort(
    (a, b) => b.noSite - a.noSite || b.total - a.total,
  );
  return {
    stats,
    uniqueCount: unique.length,
    overallNoSiteRate: unique.length ? noSiteTotal / unique.length : 0,
  };
}

function pct(n: number, d: number): string {
  return d ? `${Math.round((100 * n) / d)}%` : "—";
}

function writeReport(
  stats: CatStat[],
  uniqueCount: number,
  overallNoSiteRate: number,
): void {
  const lines: string[] = [];
  lines.push(`# Step-0 category discovery — ${REGION}`);
  lines.push("");
  lines.push(
    `Sample: **${uniqueCount} unique businesses** across ${stats.length} Google categories. ` +
      `Overall no-site rate: **${Math.round(overallNoSiteRate * 100)}%**.`,
  );
  lines.push("");
  lines.push("Sorted by no-site count (addressable gap), then total.");
  lines.push("");
  lines.push("| Google category | total | no-site | no-site % | seed allowlist |");
  lines.push("|---|---:|---:|---:|---|");
  for (const s of stats) {
    const seed = s.seedAllowed ? "✅ allowed" : `— ${s.seedReason}`;
    lines.push(
      `| ${s.category} | ${s.total} | ${s.noSite} | ${pct(s.noSite, s.total)} | ${seed} |`,
    );
  }
  lines.push("");
  // How the *seed* allowlist trades perform on this sample.
  lines.push("## Seed-allowlist coverage on this sample");
  lines.push("");
  lines.push("| seed trade | matched records | no-site |");
  lines.push("|---|---:|---:|");
  const matchedByTrade = new Map<string, { total: number; noSite: number }>();
  // recompute from stats by re-classifying each category label
  for (const s of stats) {
    const cls = classifyCategory(s.category);
    if (!cls.allowed || !cls.trade) continue;
    const m = matchedByTrade.get(cls.trade.trade) ?? { total: 0, noSite: 0 };
    m.total += s.total;
    m.noSite += s.noSite;
    matchedByTrade.set(cls.trade.trade, m);
  }
  for (const t of ALLOWLIST) {
    const m = matchedByTrade.get(t.trade) ?? { total: 0, noSite: 0 };
    lines.push(`| ${t.label} (${t.trade}) | ${m.total} | ${m.noSite} |`);
  }
  lines.push("");

  mkdirSync(resolve(OUT_DIR), { recursive: true });
  const mdPath = resolve(OUT_DIR, "report.md");
  const jsonPath = resolve(OUT_DIR, "report.json");
  writeFileSync(mdPath, lines.join("\n"));
  writeFileSync(
    jsonPath,
    JSON.stringify({ region: REGION, uniqueCount, overallNoSiteRate, stats }, null, 2),
  );
  console.log(`\nWrote report → ${mdPath}`);
  console.log(`Wrote data   → ${jsonPath}`);
}

async function main(): Promise<void> {
  const env = loadDevVars();
  const raw = await gatherRaw(env);
  const { stats, uniqueCount, overallNoSiteRate } = analyze(raw);
  console.log(
    `\n${uniqueCount} unique businesses, ${stats.length} categories, ` +
      `${Math.round(overallNoSiteRate * 100)}% overall no-site rate`,
  );
  writeReport(stats, uniqueCount, overallNoSiteRate);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
