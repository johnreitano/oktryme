/**
 * Phase 5 postcard batch-send (§1C of PLAN.md). Run with tsx:
 *
 *   npm run postcards                       # DRY RUN (default) — builds + reports, sends nothing
 *   npm run postcards -- --live             # actually submit to PostGrid (needs POSTGRID_API_KEY)
 *   npm run postcards -- --source ingest-output/kv-bulk.json --limit 50
 *
 * Reads BusinessRecords from a JSON file (the same artifact `npm run ingest`
 * produces and loads into KV), mails each eligible `preview` site one 4×6
 * postcard via PostGrid, and is **idempotent by handle**: a local ledger
 * (ingest-output/postcards-sent.json) plus the record's own `mail` state mean a
 * re-run never double-mails. After a run it writes the records with `mail`
 * stamped to ingest-output/kv-bulk.postcards.json and prints the `wrangler kv`
 * command to persist that back to KV (mirroring the ingest workflow — the script
 * never writes to KV directly; no bindings in Node).
 *
 * Keys/config come from .dev.vars (gitignored) / the environment:
 *   POSTGRID_API_KEY            — test-mode key (sandbox); live key only for real mail
 *   PREVIEW_HOST                — brand host the QR/short links resolve on (oktryme.com)
 *   POSTGRID_FROM_*             — the §5a non-residential return address (see below)
 *
 * Operational script (outside the tsc `include`); the logic it calls lives in
 * src/ and is unit-tested.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { validateBusinessRecord } from "../src/validate.js";
import {
  buildPostcardPayload,
  isMailable,
  type PostcardAddress,
} from "../src/outreach/postcard.js";
import { sendPostcard } from "../src/outreach/postgrid.js";
import type { BusinessRecord, MailStatus } from "../src/types.js";

const OUT_DIR = "ingest-output";
const LEDGER = resolve(OUT_DIR, "postcards-sent.json");
const PLACEHOLDER = "REPLACE_ME";

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
      if (env[m[1]] === undefined) env[m[1]] = val;
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

/** The §5a non-residential return address, from env (placeholder until set). */
function returnAddress(env: Record<string, string>): PostcardAddress {
  return {
    companyName: env.POSTGRID_FROM_COMPANY ?? "Multiply Technologies LLC",
    addressLine1: env.POSTGRID_FROM_LINE1 ?? PLACEHOLDER,
    addressLine2: env.POSTGRID_FROM_LINE2 || undefined,
    city: env.POSTGRID_FROM_CITY ?? PLACEHOLDER,
    provinceOrState: env.POSTGRID_FROM_STATE ?? PLACEHOLDER,
    postalOrZip: env.POSTGRID_FROM_ZIP ?? PLACEHOLDER,
    country: "US",
  };
}

function loadRecords(source: string): BusinessRecord[] {
  const raw = JSON.parse(readFileSync(resolve(source), "utf8")) as unknown[];
  const recs: BusinessRecord[] = [];
  for (const r of raw) {
    const result = validateBusinessRecord(r);
    if (result.ok) recs.push(result.value);
    else console.warn(`  skipping invalid record: ${result.issues.join("; ")}`);
  }
  return recs;
}

type Ledger = Record<string, { providerId: string; mailedAt: string; status: MailStatus }>;

function loadLedger(): Ledger {
  try {
    return JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const env = loadDevVars();
  const live = flag("live");
  const source = opt("source", `${OUT_DIR}/kv-bulk.json`)!;
  const limit = Number(opt("limit", "0")) || Infinity;
  const host = env.PREVIEW_HOST ?? "oktryme.com";
  const from = returnAddress(env);

  console.log(`Postcard batch — ${live ? "LIVE" : "DRY RUN"} | source=${source} | host=${host}`);

  const records = loadRecords(source);
  const ledger = loadLedger();
  const eligible = records.filter(
    (r) => isMailable(r) && !ledger[r.handle],
  );
  console.log(`${records.length} records → ${eligible.length} eligible (preview, not yet mailed)`);

  if (live) {
    if (!env.POSTGRID_API_KEY) throw new Error("POSTGRID_API_KEY required for --live");
    const ret = [from.addressLine1, from.city, from.provinceOrState, from.postalOrZip];
    if (ret.includes(PLACEHOLDER)) {
      throw new Error(
        "Return address not set — fill POSTGRID_FROM_LINE1/CITY/STATE/ZIP in .dev.vars (§5a: non-residential)",
      );
    }
  }

  const toSend = eligible.slice(0, limit === Infinity ? eligible.length : limit);
  let sent = 0;
  for (const rec of toSend) {
    const payload = buildPostcardPayload(rec, { host, from });
    if (!live) {
      console.log(`  [dry] ${rec.handle} → ${payload.to.companyName}, ${payload.to.city} ${payload.to.provinceOrState}`);
      continue;
    }
    try {
      const res = await sendPostcard(payload, { apiKey: env.POSTGRID_API_KEY! });
      const mailedAt = new Date().toISOString();
      rec.mail = { status: res.status, provider: "postgrid", providerId: res.id, mailedAt, updatedAt: mailedAt };
      ledger[rec.handle] = { providerId: res.id, mailedAt, status: res.status };
      sent++;
      console.log(`  ✓ ${rec.handle} → postcard ${res.id} (${res.status})`);
    } catch (err) {
      console.error(`  ✗ ${rec.handle}: ${(err as Error).message}`);
    }
  }

  mkdirSync(resolve(OUT_DIR), { recursive: true });
  if (live) {
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
    const outPath = resolve(OUT_DIR, "kv-bulk.postcards.json");
    const bulk = records.map((r) => ({ key: `biz:${r.handle}`, value: JSON.stringify(r) }));
    writeFileSync(outPath, JSON.stringify(bulk, null, 2));
    console.log(`\nMailed ${sent}/${toSend.length}. Ledger → ${LEDGER}`);
    console.log("Persist mail status to KV with:");
    console.log(`  npx wrangler kv bulk put --binding BUSINESS_KV ${outPath}`);
  } else {
    console.log(`\nDry run complete — ${toSend.length} would be mailed. Re-run with --live to send.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
