import { describe, expect, it } from "vitest";
import {
  applyCopyToRecord,
  buildCopyUserPrompt,
  factsFromRecord,
  generateCopy,
  parseCopyResponse,
  tidyProse,
  type CopyFacts,
} from "../src/copy/generate.js";
import { normalizeOutscraperRecord } from "../src/ingest/outscraper.js";
import { ALLOWLIST } from "../src/ingest/allowlist.js";
import { assertBusinessRecord } from "../src/validate.js";

const AUTO = ALLOWLIST.find((t) => t.trade === "auto-repair")!;
const facts: CopyFacts = {
  name: "Joe's Auto",
  trade: "Auto Repair",
  category: "Auto Repair Shop",
  city: "Knoxville",
  state: "TN",
  ownerName: "Joe Smith",
  description: "Independent garage.",
};

/** A Gemini generateContent response whose single text part is `json`. */
function geminiBody(json: string): unknown {
  return { candidates: [{ content: { parts: [{ text: json }] } }] };
}

describe("buildCopyUserPrompt", () => {
  it("includes the supplied facts and omits absent optionals", () => {
    const prompt = buildCopyUserPrompt(facts);
    expect(prompt).toContain("Joe's Auto");
    expect(prompt).toContain("Knoxville, TN");
    expect(prompt).toContain("Owner: Joe Smith");
    const noOwner = buildCopyUserPrompt({ ...facts, ownerName: undefined, description: undefined });
    expect(noOwner).not.toContain("Owner:");
    expect(noOwner).not.toContain("Listed description:");
  });
});

describe("tidyProse", () => {
  it("inserts a missing space after sentence punctuation", () => {
    expect(tidyProse("Serving Knoxville, TN.Our team is ready.")).toBe(
      "Serving Knoxville, TN. Our team is ready.",
    );
  });
  it("collapses newlines and runs of whitespace", () => {
    expect(tidyProse("Line one.\n\nLine two   here.")).toBe("Line one. Line two here.");
  });
});

describe("parseCopyResponse", () => {
  it("parses structured about + services from a Gemini body", () => {
    const copy = parseCopyResponse(
      geminiBody(
        JSON.stringify({
          about: "We keep Knoxville drivers on the road.",
          services: [
            { name: "Brake Repair", description: "Pads and rotors." },
            { name: "Oil Change" },
          ],
        }),
      ),
    );
    expect(copy.about).toContain("Knoxville");
    expect(copy.services).toHaveLength(2);
    expect(copy.services[1]).toEqual({ name: "Oil Change", description: undefined });
  });

  it("throws on empty or non-JSON responses", () => {
    expect(() => parseCopyResponse(geminiBody(""))).toThrow();
    expect(() => parseCopyResponse(geminiBody("not json"))).toThrow();
  });
});

describe("generateCopy", () => {
  it("requires an apiKey", async () => {
    // @ts-expect-error — intentionally omitting required apiKey
    await expect(generateCopy(facts, {})).rejects.toThrow(/apiKey/);
  });

  it("POSTs to Gemini with the guardrail system prompt + structured output", async () => {
    let calledUrl = "";
    let sentBody: any;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      sentBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify(geminiBody(JSON.stringify({ about: "Local garage.", services: [{ name: "Tires" }] }))),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const copy = await generateCopy(facts, { apiKey: "k", fetchImpl });
    expect(copy.about).toBe("Local garage.");
    expect(calledUrl).toContain(":generateContent");
    expect(calledUrl).toContain("key=k");
    expect(sentBody.generationConfig.responseMimeType).toBe("application/json");
    // Guardrails must be in the system instruction.
    expect(sentBody.systemInstruction.parts[0].text).toMatch(/Use ONLY the facts provided/);
  });

  it("throws on a non-OK Gemini response", async () => {
    const fetchImpl = (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch;
    await expect(generateCopy(facts, { apiKey: "k", fetchImpl })).rejects.toThrow(/Gemini 429/);
  });
});

describe("applyCopyToRecord", () => {
  it("merges copy into a draft record and stays valid", () => {
    const draft = normalizeOutscraperRecord(
      {
        name: "Joe's Auto",
        type: "Auto Repair Shop",
        phone: "865-555-1212",
        street: "1 Main St",
        city: "Knoxville",
        state: "TN",
        postal_code: "37902",
        site: "",
      },
      { trade: AUTO },
    );
    const merged = applyCopyToRecord(draft, {
      about: "We keep Knoxville drivers on the road.",
      services: [{ name: "Brake Repair", description: "Pads and rotors." }],
    });
    expect(merged.business.about).toContain("Knoxville");
    expect(merged.services).toHaveLength(1);
    expect(() => assertBusinessRecord(merged)).not.toThrow();
  });
});

describe("factsFromRecord", () => {
  it("pulls copy facts from a record + trade label", () => {
    const draft = normalizeOutscraperRecord(
      { name: "Joe's Auto", type: "Auto Repair Shop", phone: "x", city: "Knoxville", state: "TN" },
      { trade: AUTO },
    );
    const f = factsFromRecord(draft, AUTO.label);
    expect(f).toMatchObject({ name: "Joe's Auto", trade: "Auto Repair", city: "Knoxville" });
  });
});
