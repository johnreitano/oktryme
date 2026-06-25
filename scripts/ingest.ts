/**
 * Phase 3 ingest orchestration (§1A/§6 of PLAN.md). Run with tsx:
 *
 *   npm run ingest -- businesses            # Outscraper → filter → copy → KV bulk
 *   npm run ingest -- businesses --sample test/fixtures/outscraper.sample.json --no-copy
 *   npm run ingest -- images                # generate the 4 per-trade heroes → R2 cmds
 *
 * Keys come from .dev.vars (gitignored) / the environment: OUTSCRAPER_API_KEY
 * and GEMINI_API_KEY (one Gemini key drives both copy and image generation).
 * Outputs land in `ingest-output/` and are loaded into Cloudflare with the
 * printed wrangler commands — the script never writes to KV/R2 directly (no
 * bindings in Node).
 *
 * "Validate small first" (the chosen Phase-3 sequencing): defaults pull a small
 * sample. Bump --limit / --max for the full ~1,000-business discovery run.
 *
 * This is an operational script (outside the tsc `include`); the logic it calls
 * lives in src/ and is unit-tested.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { ALLOWLIST } from "../src/ingest/allowlist.js";
import {
  fetchBusinesses,
  normalizeOutscraperRecord,
  type OutscraperRecord,
} from "../src/ingest/outscraper.js";
import { applyFilters } from "../src/ingest/filters.js";
import { factsFromRecord, applyCopyToRecord, generateCopy } from "../src/copy/generate.js";
import { validateBusinessRecord } from "../src/validate.js";
import { heroKeyForTheme, fullImagePrompt } from "../src/images/prompts.js";
import { composePrompt, generateImage } from "../src/images/generate.js";
import type { ThemeKey } from "../src/render/themes.js";

const REGION = "Knoxville, TN";
const OUT_DIR = "ingest-output";

// --- tiny .dev.vars loader (KEY=VALUE, optional quotes; no dependency) -------
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
      if (env[m[1]] === undefined) env[m[1]] = val; // process.env wins
    }
  } catch {
    /* no .dev.vars — rely on process.env */
  }
  return env;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function opt(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function ingestBusinesses(env: Record<string, string>): Promise<void> {
  const perQueryLimit = Number(opt("limit", "20"));
  const maxRecords = Number(opt("max", "40"));
  const samplePath = opt("sample");
  const noCopy = flag("no-copy");

  // 1. Gather raw records — from a local sample, or live from Outscraper.
  let raw: OutscraperRecord[] = [];
  if (samplePath) {
    raw = JSON.parse(readFileSync(resolve(samplePath), "utf8"));
    console.log(`Loaded ${raw.length} sample records from ${samplePath}`);
  } else {
    if (!env.OUTSCRAPER_API_KEY) throw new Error("OUTSCRAPER_API_KEY not set (or use --sample)");
    // --trades caps how many allowlist trades to query (validate-small first).
    const trades = ALLOWLIST.slice(0, Number(opt("trades", String(ALLOWLIST.length))));
    for (const trade of trades) {
      const query = `${trade.label}, ${REGION}`;
      process.stdout.write(`Querying Outscraper: ${query} … `);
      const batch = await fetchBusinesses(query, {
        apiKey: env.OUTSCRAPER_API_KEY,
        limit: perQueryLimit,
      });
      console.log(`${batch.length} records`);
      raw.push(...batch);
    }
  }

  // 2. Filter (§1A: no-site / allowlist / unambiguous-type).
  const { kept, summary } = applyFilters(raw);
  console.log("\nFunnel:", JSON.stringify(summary));

  // 3. Normalize → (copy) → validate. Cap at --max for the small validation run.
  const apiKey = env.GEMINI_API_KEY;
  if (!noCopy && !apiKey) throw new Error("GEMINI_API_KEY not set (or pass --no-copy)");

  const taken = new Set<string>();
  const bulk: Array<{ key: string; value: string }> = [];
  for (const { record, trade } of kept.slice(0, maxRecords)) {
    let rec = normalizeOutscraperRecord(record, { trade, takenHandles: taken });
    // Point the hero at the per-trade generated image; renderer falls back to
    // the theme gradient until that R2 object exists.
    rec.images = { hero: heroKeyForTheme(trade.theme) };

    if (!noCopy) {
      try {
        const copy = await generateCopy(factsFromRecord(rec, trade.label), { apiKey });
        rec = applyCopyToRecord(rec, copy);
      } catch (err) {
        console.warn(`  copy failed for ${rec.handle}: ${(err as Error).message}`);
      }
    }

    const result = validateBusinessRecord(rec);
    if (!result.ok) {
      console.warn(`  dropped ${rec.handle}: ${result.issues.join("; ")}`);
      continue;
    }
    rec.createdAt = rec.createdAt ?? new Date().toISOString();
    bulk.push({ key: `biz:${rec.handle}`, value: JSON.stringify(rec) });
  }

  // 4. Emit a wrangler KV bulk file.
  mkdirSync(resolve(OUT_DIR), { recursive: true });
  const outPath = resolve(OUT_DIR, "kv-bulk.json");
  writeFileSync(outPath, JSON.stringify(bulk, null, 2));
  console.log(`\nWrote ${bulk.length} records → ${outPath}`);
  console.log("Load into KV with:");
  console.log(`  npx wrangler kv bulk put --binding BUSINESS_KV ${OUT_DIR}/kv-bulk.json`);
  console.log("Preview locally: add --local, then `npx wrangler dev` and open /p/<handle>");
}

async function ingestImages(env: Record<string, string>): Promise<void> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  mkdirSync(resolve(OUT_DIR, "images"), { recursive: true });
  const themes: ThemeKey[] = ["auto", "hvac", "landscaping", "universal"];
  const cmds: string[] = [];
  for (const theme of themes) {
    process.stdout.write(`Generating hero for ${theme} … `);
    const img = await generateImage(composePrompt(fullImagePrompt(theme)), {
      apiKey: env.GEMINI_API_KEY,
    });
    const ext = img.mimeType.includes("jpeg") ? "jpg" : "png";
    const file = resolve(OUT_DIR, "images", `${theme}.${ext}`);
    writeFileSync(file, img.bytes);
    const key = heroKeyForTheme(theme); // trade/<theme>/hero.jpg
    cmds.push(
      `npx wrangler r2 object put maps-website-builder-images/${key} --file ${OUT_DIR}/images/${theme}.${ext} --content-type ${img.mimeType}`,
    );
    console.log(`${img.bytes.length} bytes → ${file}`);
  }
  console.log("\nUpload to R2 with:");
  for (const c of cmds) console.log(`  ${c}`);
}

async function main(): Promise<void> {
  const env = loadDevVars();
  const cmd = process.argv[2];
  if (cmd === "businesses") await ingestBusinesses(env);
  else if (cmd === "images") await ingestImages(env);
  else {
    console.error("usage: ingest <businesses|images> [--limit N] [--max N] [--sample FILE] [--no-copy]");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
