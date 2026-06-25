import { describe, it, expect } from "vitest";
import { renderSite, escapeHtml } from "../src/render/renderer.js";
import { sampleBusiness } from "./helpers.js";

// V4 — the renderer turns a real business.json into a static site, with
// preview and live driven from the SAME code (no drift).
describe("V4: renderSite", () => {
  it("renders core business content in preview mode", () => {
    const html = renderSite(sampleBusiness(), "preview");
    expect(html).toContain("Joe&#39;s Auto Repair"); // name is HTML-escaped
    expect(html).toContain("Oil Changes");
    expect(html).toContain("Engine Diagnostics");
    expect(html).toContain("8:00 AM"); // hours
    expect(html).toContain("Highly recommend"); // review
    expect(html).toContain('action="/lead/joes-auto"'); // contact form
  });

  it("preview mode shows the banner + CTA and is noindex", () => {
    const html = renderSite(sampleBusiness(), "preview");
    expect(html).toContain("PREVIEW");
    expect(html).toContain("Make This My Website");
    expect(html).toContain('content="noindex,nofollow"');
  });

  it("live mode hides the banner and is indexable", () => {
    const html = renderSite(sampleBusiness(), "live");
    expect(html).not.toContain("Make This My Website");
    expect(html).toContain('content="index,follow"');
    expect(html).toContain("Joe&#39;s Auto Repair"); // same content, no drift
  });

  it("escapes untrusted content (no HTML injection)", () => {
    const rec = sampleBusiness();
    rec.business.name = '<script>alert(1)</script>';
    const html = renderSite(rec, "live");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapeHtml handles all the dangerous characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("omits empty sections gracefully", () => {
    const rec = sampleBusiness();
    rec.services = [];
    rec.reviews = [];
    const html = renderSite(rec, "live");
    expect(html).not.toContain("<h2>Services</h2>");
    expect(html).not.toContain("What Customers Say");
    expect(html).toContain("Get in Touch"); // contact always present
  });

  it("gives form fields accessible labels", () => {
    const html = renderSite(sampleBusiness(), "preview");
    expect(html).toContain('for="lead-name"');
    expect(html).toContain('id="lead-name"');
    expect(html).toContain("visually-hidden"); // labels present but not shown
  });
});

// Phase 2 — trade theming + CSS-placeholder imagery (no drift between modes).
describe("renderSite: theming + imagery", () => {
  it("applies the trade theme picked from the category", () => {
    const html = renderSite(sampleBusiness(), "live"); // "Auto Repair Shop" → auto
    expect(html).toContain('data-theme="auto"');
    expect(html).toContain("--accent:#c62828"); // auto palette
    expect(html).toContain("Request a Quote"); // auto CTA label
  });

  it("uses a CSS gradient placeholder when no hero image is set", () => {
    const rec = sampleBusiness();
    delete rec.images.hero;
    const html = renderSite(rec, "live");
    expect(html).toContain("--hero-bg:linear-gradient"); // placeholder in :root
    expect(html).not.toContain("--hero-bg:url("); // no image override on the hero
  });

  it("honors an explicit hero image URL", () => {
    const rec = sampleBusiness();
    rec.images.hero = "https://cdn.example.com/h.jpg";
    const html = renderSite(rec, "live");
    expect(html).toContain("--hero-bg:url('https://cdn.example.com/h.jpg')");
  });

  it("resolves an R2 key hero through the /img route", () => {
    const rec = sampleBusiness();
    rec.images.hero = "auto/hero.png";
    const html = renderSite(rec, "live");
    expect(html).toContain("--hero-bg:url('/img/auto/hero.png')");
  });
});
