// AI copy generation + guardrails (Phase 3, §6/§7 #5 of PLAN.md).
//
// Turns the verifiable scraped facts of a business into the marketing copy the
// renderer needs — an "About" paragraph and a small set of trade-typical
// services. Hard guardrail (§7 #5): use ONLY the supplied facts; never fabricate
// claims (no invented awards, years-in-business, certifications, prices,
// guarantees, staff counts, or specifics not given). Copy is generic-but-
// professional and location-aware.
//
// Runs at ingest time (a batch Node script), not in the Worker request path.
// Uses the official Anthropic SDK with Claude Opus 4.8 + structured outputs so
// the result is schema-valid JSON we can merge straight into `business.json`.

import Anthropic from "@anthropic-ai/sdk";
import type { BusinessRecord, Service } from "../types.js";

/** The verifiable facts handed to the model — nothing else may be asserted. */
export interface CopyFacts {
  name: string;
  /** Canonical trade label (e.g. "Auto Repair"). */
  trade: string;
  /** Scraped category/type string. */
  category: string;
  city: string;
  state: string;
  ownerName?: string;
  /** Scraped factual description, if any. */
  description?: string;
}

export interface GeneratedCopy {
  about: string;
  services: Service[];
}

/** Default model — Claude Opus 4.8 (see CLAUDE.md / claude-api skill). */
export const COPY_MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = [
  "You write website copy for local service businesses. You are given ONLY a few",
  "verifiable facts about a business scraped from a public listing. Your copy must",
  "be believable and useful to a real owner who will see it on their preview site.",
  "",
  "HARD RULES (these prevent us publishing false claims about a real business):",
  "- Use ONLY the facts provided. Never invent specifics you were not given:",
  "  no years in business, no 'family-owned since', no awards, no certifications,",
  "  no licenses, no number of employees, no prices, no warranties or guarantees,",
  "  no named staff, no review quotes, no service-area towns beyond the given city.",
  "- Do not claim the business is the 'best', '#1', 'award-winning', or 'trusted by",
  "  thousands' — those are unverifiable. Describe what the trade does, plainly.",
  "- The services you list are the COMMON offerings for this trade, described",
  "  generically. Do not assert this specific business performs a niche service.",
  "- Keep it concrete and grounded; avoid hype and filler. American English.",
  "",
  "OUTPUT:",
  "- about: 2 short paragraphs (~40-70 words total) — what the business does, the",
  "  city it serves, and an invitation to request a quote. No fabricated specifics.",
  "- services: 4-6 services typical of this trade, each with a one-sentence,",
  "  generic description of that service.",
].join("\n");

/** JSON Schema for structured output — keeps the result schema-valid. */
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    about: { type: "string" },
    services: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["name", "description"],
      },
    },
  },
  required: ["about", "services"],
} as const;

/** Build the user prompt from the facts (pure — the tested unit). */
export function buildCopyUserPrompt(facts: CopyFacts): string {
  const lines = [
    `Business name: ${facts.name}`,
    `Trade: ${facts.trade}`,
    `Listed category: ${facts.category}`,
    `Location: ${facts.city}, ${facts.state}`,
  ];
  if (facts.ownerName) lines.push(`Owner: ${facts.ownerName}`);
  if (facts.description) lines.push(`Listed description: ${facts.description}`);
  lines.push(
    "",
    "Write the About copy and the typical-services list for this business,",
    "following the hard rules. Return only the structured object.",
  );
  return lines.join("\n");
}

/** Pull the copy-relevant facts out of a (draft) BusinessRecord. */
export function factsFromRecord(rec: BusinessRecord, tradeLabel: string): CopyFacts {
  return {
    name: rec.business.name,
    trade: tradeLabel,
    category: rec.business.category,
    city: rec.business.address.city,
    state: rec.business.address.state,
    ownerName: rec.business.ownerName,
    description: rec.business.description,
  };
}

export interface GenerateCopyOptions {
  /** Provide a configured client, or an apiKey to construct one. */
  client?: Anthropic;
  apiKey?: string;
  model?: string;
}

/**
 * Generate the About copy + typical services for a business. Throws if neither
 * a client nor an apiKey is supplied (callers gate on key presence).
 */
export async function generateCopy(
  facts: CopyFacts,
  opts: GenerateCopyOptions = {},
): Promise<GeneratedCopy> {
  const client =
    opts.client ??
    (opts.apiKey
      ? new Anthropic({ apiKey: opts.apiKey })
      : (() => {
          throw new Error("generateCopy: provide opts.client or opts.apiKey");
        })());

  const response = await client.messages.create({
    model: opts.model ?? COPY_MODEL,
    max_tokens: 2000,
    output_config: {
      effort: "low", // cheap bulk copy; the task is simple and well-specified
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildCopyUserPrompt(facts) }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  return parseCopyResponse(response);
}

/** Extract + validate the JSON copy from a Messages response (tested unit). */
export function parseCopyResponse(response: Anthropic.Message): GeneratedCopy {
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) {
    throw new Error("generateCopy: empty model response");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`generateCopy: response was not JSON: ${text.slice(0, 200)}`);
  }
  const obj = parsed as { about?: unknown; services?: unknown };
  if (typeof obj.about !== "string" || !Array.isArray(obj.services)) {
    throw new Error("generateCopy: response missing about/services");
  }
  const services: Service[] = obj.services
    .filter((s): s is { name: string; description?: string } =>
      !!s && typeof (s as { name?: unknown }).name === "string",
    )
    .map((s) => ({
      name: s.name,
      description: typeof s.description === "string" ? s.description : undefined,
    }));
  return { about: obj.about, services };
}

/** Merge generated copy into a draft record (sets about + services). */
export function applyCopyToRecord(
  rec: BusinessRecord,
  copy: GeneratedCopy,
): BusinessRecord {
  return {
    ...rec,
    business: { ...rec.business, about: copy.about },
    services: copy.services,
    updatedAt: undefined, // stamped by the store/caller on write
  };
}
