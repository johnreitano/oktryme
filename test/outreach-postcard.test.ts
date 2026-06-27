import { describe, it, expect } from "vitest";
import {
  mergeVarsFor,
  recipientFor,
  renderTemplate,
  buildPostcardPayload,
  isMailable,
  type PostcardAddress,
} from "../src/outreach/postcard.js";
import { sampleBusiness } from "./helpers.js";

const FROM: PostcardAddress = {
  companyName: "Multiply Technologies LLC",
  addressLine1: "1 Registered Agent Way",
  city: "Sheridan",
  provinceOrState: "WY",
  postalOrZip: "82801",
  country: "US",
};

describe("mergeVarsFor (§1C merge contract)", () => {
  it("derives all five fields, with QR + short-link pointing at /qr and /r", () => {
    const rec = sampleBusiness();
    const v = mergeVarsFor(rec, "oktryme.com");
    expect(v.business_name).toBe(rec.business.name);
    expect(v.category).toBe(rec.business.category);
    expect(v.city).toBe(rec.business.address.city);
    expect(v.qr_url).toBe(`https://oktryme.com/qr/${rec.handle}.svg`);
    expect(v.preview_short_url).toBe(`oktryme.com/r/${rec.handle}`);
  });
});

describe("recipientFor", () => {
  it("maps the scraped address into the provider recipient shape", () => {
    const rec = sampleBusiness();
    const to = recipientFor(rec);
    expect(to.companyName).toBe(rec.business.name);
    expect(to.addressLine1).toBe(rec.business.address.line1);
    expect(to.city).toBe(rec.business.address.city);
    expect(to.provinceOrState).toBe(rec.business.address.state);
    expect(to.postalOrZip).toBe(rec.business.address.zip);
    expect(to.country).toBe("US");
  });
});

describe("renderTemplate", () => {
  it("substitutes known vars and blanks unknown ones", () => {
    expect(renderTemplate("Hi {{name}} in {{city}}!", { name: "Joe", city: "Knox" })).toBe(
      "Hi Joe in Knox!",
    );
    expect(renderTemplate("{{missing}}x", {})).toBe("x");
  });
});

describe("buildPostcardPayload", () => {
  it("renders front/back with merged content and tags the handle", () => {
    const rec = sampleBusiness();
    const p = buildPostcardPayload(rec, { host: "oktryme.com", from: FROM });
    expect(p.size).toBe("6x4");
    expect(p.metadata.handle).toBe(rec.handle);
    expect(p.from).toEqual(FROM);
    // Front shows the business name + the QR image URL.
    expect(p.frontHTML).toContain(rec.business.name);
    expect(p.frontHTML).toContain(`https://oktryme.com/qr/${rec.handle}.svg`);
    // Back shows the human-readable short URL (non-scanner fallback).
    expect(p.backHTML).toContain(`oktryme.com/r/${rec.handle}`);
    // No unresolved handlebars leak into the printed card.
    expect(p.frontHTML).not.toMatch(/\{\{/);
    expect(p.backHTML).not.toMatch(/\{\{/);
  });
});

describe("isMailable (idempotency by handle)", () => {
  it("mails a preview with no prior mail state", () => {
    const rec = sampleBusiness();
    rec.status = "preview";
    expect(isMailable(rec)).toBe(true);
  });

  it("retries a previously failed send", () => {
    const rec = sampleBusiness();
    rec.status = "preview";
    rec.mail = { status: "failed" };
    expect(isMailable(rec)).toBe(true);
  });

  it("skips already-mailed and non-preview records", () => {
    const mailed = sampleBusiness();
    mailed.status = "preview";
    mailed.mail = { status: "mailed" };
    expect(isMailable(mailed)).toBe(false);

    const active = sampleBusiness();
    active.status = "active";
    expect(isMailable(active)).toBe(false);
  });
});
