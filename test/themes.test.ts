import { describe, it, expect } from "vitest";
import { selectTheme } from "../src/render/themes.js";

// Phase 2 — trade-specific template variants chosen from the business category.
describe("selectTheme", () => {
  it("maps auto categories to the auto theme", () => {
    expect(selectTheme("Auto Repair Shop").key).toBe("auto");
    expect(selectTheme("Brake & Tire Center").key).toBe("auto");
    expect(selectTheme("Collision & Body Shop").key).toBe("auto");
  });

  it("maps HVAC categories to the hvac theme", () => {
    expect(selectTheme("HVAC Contractor").key).toBe("hvac");
    expect(selectTheme("Heating & Air Conditioning").key).toBe("hvac");
    expect(selectTheme("Furnace Repair").key).toBe("hvac");
  });

  it("maps landscaping categories to the landscaping theme", () => {
    expect(selectTheme("Landscaping Service").key).toBe("landscaping");
    expect(selectTheme("Lawn Care").key).toBe("landscaping");
    expect(selectTheme("Tree Service").key).toBe("landscaping");
  });

  it("falls back to universal for unknown or missing categories", () => {
    expect(selectTheme("Coffee Shop").key).toBe("universal");
    expect(selectTheme("").key).toBe("universal");
    expect(selectTheme(undefined).key).toBe("universal");
  });

  it("each theme carries a palette, hero placeholder, and CTA label", () => {
    const t = selectTheme("HVAC Contractor");
    expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t.accentDark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t.heroGradient).toContain("linear-gradient");
    expect(t.ctaLabel.length).toBeGreaterThan(0);
  });
});
