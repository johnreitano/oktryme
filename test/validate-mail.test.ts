import { describe, it, expect } from "vitest";
import { validateBusinessRecord } from "../src/validate.js";
import { sampleBusiness } from "./helpers.js";

// Phase 5 widened the record with a typed `mail` object (replacing the old loose
// `mailStatus?: string`). Validation must guard it like every other field.
describe("validate mail (Phase 5)", () => {
  it("accepts a record with no mail field (absent until the send)", () => {
    expect(validateBusinessRecord(sampleBusiness()).ok).toBe(true);
  });

  it("accepts a well-formed mail object", () => {
    const rec = sampleBusiness() as any;
    rec.mail = {
      status: "delivered",
      provider: "postgrid",
      providerId: "postcard_123",
      mailedAt: "2026-06-27T10:00:00Z",
      updatedAt: "2026-06-27T12:00:00Z",
    };
    expect(validateBusinessRecord(rec).ok).toBe(true);
  });

  it("rejects an unknown mail status", () => {
    const rec = sampleBusiness() as any;
    rec.mail = { status: "teleported" };
    const result = validateBusinessRecord(rec);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object mail", () => {
    const rec = sampleBusiness() as any;
    rec.mail = "mailed";
    expect(validateBusinessRecord(rec).ok).toBe(false);
  });
});
