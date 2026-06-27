import { describe, it, expect } from "vitest";
import {
  advancePipeline,
  applyMailStatus,
  pipelineStatusOf,
  setPipelineManual,
} from "../src/crm/pipeline.js";
import { validateBusinessRecord } from "../src/validate.js";
import { sampleBusiness } from "./helpers.js";

describe("pipeline funnel transitions (Phase 6 Track A)", () => {
  it("treats an untouched record as `new`", () => {
    expect(pipelineStatusOf(sampleBusiness())).toBe("new");
  });

  it("advances forward through the funnel and records history", () => {
    const rec = sampleBusiness();
    expect(advancePipeline(rec, "postcard-sent", { note: "mail:delivered" })).toBe(true);
    expect(advancePipeline(rec, "qr-code-visit", { note: "qr-scan" })).toBe(true);
    expect(advancePipeline(rec, "paid", { note: "stripe" })).toBe(true);
    expect(pipelineStatusOf(rec)).toBe("paid");
    expect(rec.pipeline?.history.map((e) => e.status)).toEqual([
      "postcard-sent",
      "qr-code-visit",
      "paid",
    ]);
    expect(rec.pipeline?.history.every((e) => e.via === "auto")).toBe(true);
  });

  it("is idempotent — re-applying the same stage is a no-op", () => {
    const rec = sampleBusiness();
    advancePipeline(rec, "qr-code-visit");
    expect(advancePipeline(rec, "qr-code-visit")).toBe(false);
    expect(rec.pipeline?.history).toHaveLength(1);
  });

  it("is monotonic — an earlier signal never regresses a later stage", () => {
    const rec = sampleBusiness();
    advancePipeline(rec, "qr-code-visit"); // already scanned
    // A late-arriving `delivered` webhook must NOT drop the lead out of the queue.
    expect(advancePipeline(rec, "postcard-sent")).toBe(false);
    expect(pipelineStatusOf(rec)).toBe("qr-code-visit");
    // A re-delivered scan after payment must NOT regress `paid`.
    advancePipeline(rec, "paid");
    expect(advancePipeline(rec, "qr-code-visit")).toBe(false);
    expect(pipelineStatusOf(rec)).toBe("paid");
  });

  it("cancels from paid and does not auto-revive on a stray earlier signal", () => {
    const rec = sampleBusiness();
    advancePipeline(rec, "paid");
    expect(advancePipeline(rec, "canceled")).toBe(true);
    expect(advancePipeline(rec, "qr-code-visit")).toBe(false);
    expect(pipelineStatusOf(rec)).toBe("canceled");
  });

  it("allows reactivation: canceled → paid (invoice retry succeeded)", () => {
    const rec = sampleBusiness();
    advancePipeline(rec, "paid");
    advancePipeline(rec, "canceled");
    expect(advancePipeline(rec, "paid", { note: "reactivation" })).toBe(true);
    expect(pipelineStatusOf(rec)).toBe("paid");
  });

  it("manual override bypasses the monotonic guard and is tagged manual", () => {
    const rec = sampleBusiness();
    advancePipeline(rec, "paid");
    // Ops corrects a mis-set stage backward (offline event).
    expect(setPipelineManual(rec, "qr-code-visit", { note: "fix" })).toBe(true);
    expect(pipelineStatusOf(rec)).toBe("qr-code-visit");
    expect(rec.pipeline?.history.at(-1)?.via).toBe("manual");
  });

  it("applyMailStatus advances to postcard-sent for sent/delivered, stores status", () => {
    const rec = sampleBusiness();
    expect(applyMailStatus(rec, "delivered")).toBe(true);
    expect(rec.mail?.status).toBe("delivered");
    expect(rec.mail?.mailedAt).toBeTruthy();
    expect(pipelineStatusOf(rec)).toBe("postcard-sent");
  });

  it("applyMailStatus records a terminal status without advancing the funnel", () => {
    const rec = sampleBusiness();
    expect(applyMailStatus(rec, "returned")).toBe(false);
    expect(rec.mail?.status).toBe("returned");
    expect(pipelineStatusOf(rec)).toBe("new");
  });

  it("produces a record that passes runtime validation", () => {
    const rec = sampleBusiness();
    advancePipeline(rec, "qr-code-visit", { note: "qr-scan", at: "2026-06-26T00:00:00Z" });
    expect(validateBusinessRecord(rec).ok).toBe(true);
  });
});
