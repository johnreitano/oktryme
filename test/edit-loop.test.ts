import { describe, it, expect } from "vitest";
import { applyEdit, EditError } from "../src/edit/apply.js";
import { renderSite } from "../src/render/renderer.js";
import { sampleBusiness } from "./helpers.js";

// V4 — an edit to business.json re-renders instantly (the editor just mutates
// the record; rendering is preview = live engine, no rebuild step).
describe("V4: edit → re-render loop", () => {
  it("setHours changes the rendered hours immediately", () => {
    const before = sampleBusiness();
    const after = applyEdit(before, {
      type: "setHours",
      day: "monday",
      value: "7:00 AM – 7:00 PM",
    });
    expect(renderSite(after, "live")).toContain("7:00 AM – 7:00 PM");
    // original untouched (immutability)
    expect(before.business.hours.monday).toBe("8:00 AM – 6:00 PM");
  });

  it("addService appears on the page; rewriteAbout updates copy", () => {
    let rec = applyEdit(sampleBusiness(), {
      type: "addService",
      name: "Tire Rotation",
      description: "Extend tire life with regular rotation.",
    });
    rec = applyEdit(rec, {
      type: "setAbout",
      value: "Twenty-five years of trusted, certified auto care.",
    });
    const html = renderSite(rec, "live");
    expect(html).toContain("Tire Rotation");
    expect(html).toContain("Twenty-five years of trusted");
  });

  it("removeService removes it", () => {
    const rec = applyEdit(sampleBusiness(), {
      type: "removeService",
      name: "Oil Changes",
    });
    expect(rec.services.find((s) => s.name === "Oil Changes")).toBeUndefined();
  });

  it("stamps updatedAt on every edit", () => {
    const rec = applyEdit(sampleBusiness(), {
      type: "setPhone",
      value: "(312) 555-9999",
    });
    expect(rec.updatedAt).toBeTypeOf("string");
  });

  it("rejects invalid edits (schema guardrails)", () => {
    expect(() =>
      applyEdit(sampleBusiness(), { type: "setHours", day: "funday" as never, value: "x" }),
    ).toThrow(EditError);
    expect(() =>
      applyEdit(sampleBusiness(), { type: "removeService", name: "Nonexistent" }),
    ).toThrow(EditError);
    expect(() =>
      applyEdit(sampleBusiness(), { type: "setDescription", value: "   " }),
    ).toThrow(EditError);
  });

  it("blocks scraped Google Maps photos (IP guardrail)", () => {
    expect(() =>
      applyEdit(sampleBusiness(), {
        type: "setImage",
        slot: "hero",
        url: "https://lh3.googleusercontent.com/foo.jpg",
      }),
    ).toThrow(/scraped/i);
    // a licensed stock URL is fine
    const ok = applyEdit(sampleBusiness(), {
      type: "setImage",
      slot: "hero",
      url: "https://stock.example-cdn.com/x.jpg",
    });
    expect(ok.images.hero).toContain("example-cdn.com");
  });
});
