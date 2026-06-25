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
// Uses the **Gemini** API (same vendor + key as the Nano Banana Pro image
// generation) with structured JSON output, so the result is schema-shaped JSON
// we can merge straight into `business.json`.

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

/** Default Gemini text model for bulk copy (overridable via opts/env). */
export const COPY_MODEL = "gemini-2.5-flash";

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
  "- about: ONE cohesive paragraph (~50-70 words) — what the business does, the",
  "  city it serves, and an invitation to request a quote. No fabricated specifics.",
  "- services: 4-6 services typical of this trade, each with a one-sentence,",
  "  generic description of that service.",
].join("\n");

/**
 * Gemini structured-output schema (the OpenAPI subset Gemini's `responseSchema`
 * accepts — uppercase `Type` enum, `propertyOrdering` to fix field order).
 */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    about: { type: "STRING" },
    services: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          description: { type: "STRING" },
        },
        required: ["name", "description"],
        propertyOrdering: ["name", "description"],
      },
    },
  },
  required: ["about", "services"],
  propertyOrdering: ["about", "services"],
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
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Generate the About copy + typical services for a business via Gemini. Throws
 * if no apiKey is supplied (callers gate on key presence).
 */
export async function generateCopy(
  facts: CopyFacts,
  opts: GenerateCopyOptions,
): Promise<GeneratedCopy> {
  if (!opts?.apiKey) throw new Error("generateCopy: opts.apiKey (Gemini) is required");

  const model = opts.model ?? COPY_MODEL;
  const base = opts.baseUrl ?? "https://generativelanguage.googleapis.com";
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  const res = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: buildCopyUserPrompt(facts) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
  return parseCopyResponse(await res.json());
}

/** Minimal shape of the Gemini generateContent text response we read. */
interface GeminiTextResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Tidy model prose: collapse internal whitespace and insert a missing space
 * after sentence punctuation (the model sometimes joins sentences/paragraphs,
 * e.g. "…Knoxville, TN.Our team…"). The renderer shows `about` as one block.
 */
export function tidyProse(s: string): string {
  return s
    .replace(/\s*\n\s*/g, " ")
    .replace(/([.!?,;:])([A-Z])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Extract + validate the JSON copy from a Gemini response (tested unit). */
export function parseCopyResponse(body: unknown): GeneratedCopy {
  const res = body as GeminiTextResponse;
  const text = (res.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
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
  return { about: tidyProse(obj.about), services };
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
