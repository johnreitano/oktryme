import { describe, expect, it } from "vitest";
import { classifyCategory } from "../src/ingest/allowlist.js";
import { applyFilters, hasRealWebsite } from "../src/ingest/filters.js";
import type { OutscraperRecord } from "../src/ingest/outscraper.js";

describe("classifyCategory", () => {
  it("maps allowlisted trades to their theme", () => {
    expect(classifyCategory("Auto Repair Shop").trade?.theme).toBe("auto");
    expect(classifyCategory("Heating & Air Conditioning").trade?.theme).toBe("hvac");
    expect(classifyCategory("Lawn Care Service").trade?.theme).toBe("landscaping");
    expect(classifyCategory("Plumber").trade?.theme).toBe("universal");
  });

  it("rejects empty, off-allowlist, and excluded categories", () => {
    expect(classifyCategory("").reason).toBe("empty-category");
    expect(classifyCategory("Sushi Restaurant").reason).toBe("not-on-allowlist");
    expect(classifyCategory("Car Dealership").reason).toBe("excluded");
  });

  it("excludes a national chain even when its trade matches", () => {
    // "Jiffy Lube" matches the auto pattern but is an excluded chain.
    const c = classifyCategory("Jiffy Lube oil change");
    expect(c.allowed).toBe(false);
    expect(c.reason).toBe("excluded");
  });
});

describe("hasRealWebsite", () => {
  it("treats empty/social/auto pages as 'no real website'", () => {
    expect(hasRealWebsite(undefined)).toBe(false);
    expect(hasRealWebsite("")).toBe(false);
    expect(hasRealWebsite("https://facebook.com/joesauto")).toBe(false);
    expect(hasRealWebsite("https://joesauto.business.site")).toBe(false);
  });

  it("treats a real domain as having a website", () => {
    expect(hasRealWebsite("https://joesautoshop.com")).toBe(true);
  });
});

describe("applyFilters", () => {
  const rec = (over: Partial<OutscraperRecord>): OutscraperRecord => ({
    name: "X",
    type: "Auto Repair Shop",
    city: "Knoxville",
    state: "TN",
    ...over,
  });

  it("keeps a no-site allowlisted record and tags its trade", () => {
    const out = applyFilters([rec({})]);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0].trade.trade).toBe("auto-repair");
  });

  it("detects the v3 `website` field (not just legacy `site`)", () => {
    const out = applyFilters([rec({ website: "https://joesauto.com" })]);
    expect(out.rejected[0]?.reason).toBe("has-website");
  });

  it("rejects with the right reason and counts the funnel", () => {
    const out = applyFilters([
      rec({}), // kept
      rec({ website: "https://has-a-site.com" }), // has-website (v3 field)
      rec({ type: "Sushi Restaurant" }), // not-on-allowlist
      rec({ type: "Car Dealership" }), // excluded
      rec({ type: "" }), // ambiguous-type
    ]);
    expect(out.summary).toMatchObject({
      total: 5,
      kept: 1,
      "has-website": 1,
      "not-on-allowlist": 1,
      excluded: 1,
      "ambiguous-type": 1,
    });
    const reasons = out.rejected.map((r) => r.reason).sort();
    expect(reasons).toEqual(
      ["ambiguous-type", "excluded", "has-website", "not-on-allowlist"].sort(),
    );
  });

  it("applies no-site before the allowlist (a real site is dropped regardless of trade)", () => {
    const out = applyFilters([rec({ site: "https://real.com" })]);
    expect(out.rejected[0].reason).toBe("has-website");
  });
});
