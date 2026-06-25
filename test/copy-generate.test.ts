import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  applyCopyToRecord,
  buildCopyUserPrompt,
  COPY_MODEL,
  factsFromRecord,
  generateCopy,
  parseCopyResponse,
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

function messageWithText(text: string): Anthropic.Message {
  return {
    content: [{ type: "text", text }],
  } as unknown as Anthropic.Message;
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

describe("parseCopyResponse", () => {
  it("parses structured about + services", () => {
    const copy = parseCopyResponse(
      messageWithText(
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
    expect(() => parseCopyResponse(messageWithText(""))).toThrow();
    expect(() => parseCopyResponse(messageWithText("not json"))).toThrow();
  });
});

describe("generateCopy", () => {
  it("requires a client or apiKey", async () => {
    await expect(generateCopy(facts)).rejects.toThrow(/client or opts.apiKey/);
  });

  it("calls the model with Opus 4.8 + structured output and returns parsed copy", async () => {
    const create = vi.fn().mockResolvedValue(
      messageWithText(JSON.stringify({ about: "Local garage.", services: [{ name: "Tires" }] })),
    );
    const client = { messages: { create } } as unknown as Anthropic;
    const copy = await generateCopy(facts, { client });

    expect(copy.about).toBe("Local garage.");
    const params = create.mock.calls[0][0];
    expect(params.model).toBe(COPY_MODEL);
    expect(params.output_config.format.type).toBe("json_schema");
    // Guardrails must be in the system prompt.
    expect(params.system).toMatch(/Use ONLY the facts provided/);
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
