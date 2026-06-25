// Trade-specific template variants (Phase 2, §6/§7 #2 of PLAN.md).
//
// One renderer, several "skins": a theme only changes palette, the hero
// placeholder gradient, and CTA wording — the section structure is shared, so
// preview and live can never drift and adding a trade is a few lines here.
//
// The starting set (Auto Repair, HVAC, Landscaping) is a best-guess ahead of
// Phase 3 category discovery; everything unmatched falls back to "universal".

export type ThemeKey = "auto" | "hvac" | "landscaping" | "universal";

export interface Theme {
  key: ThemeKey;
  /** Primary accent for buttons/links. */
  accent: string;
  /** Darker accent for hover/active. */
  accentDark: string;
  /** CSS background used for the hero when no image is set (the placeholder). */
  heroGradient: string;
  /** Hero call-to-action wording, tuned per trade. */
  ctaLabel: string;
}

const THEMES: Record<ThemeKey, Theme> = {
  auto: {
    key: "auto",
    accent: "#c62828",
    accentDark: "#8e0000",
    heroGradient: "linear-gradient(135deg,#1f2933 0%,#3e4c59 100%)",
    ctaLabel: "Request a Quote",
  },
  hvac: {
    key: "hvac",
    accent: "#1565c0",
    accentDark: "#0d47a1",
    heroGradient: "linear-gradient(135deg,#0b3d91 0%,#2a7de1 100%)",
    ctaLabel: "Get a Free Estimate",
  },
  landscaping: {
    key: "landscaping",
    accent: "#2e7d32",
    accentDark: "#1b5e20",
    heroGradient: "linear-gradient(135deg,#1b5e20 0%,#4caf50 100%)",
    ctaLabel: "Get a Free Estimate",
  },
  universal: {
    key: "universal",
    accent: "#1565c0",
    accentDark: "#0d47a1",
    heroGradient: "linear-gradient(135deg,#222 0%,#444 100%)",
    ctaLabel: "Request a Quote",
  },
};

// Keyword → theme. First matching rule wins; order matters only where a term
// could be ambiguous (none currently overlap across the three trades).
const RULES: Array<{ theme: ThemeKey; pattern: RegExp }> = [
  {
    theme: "auto",
    pattern:
      /\b(auto|car|cars|mechanic|tire|tires|collision|body\s?shop|muffler|brake|transmission|oil\s?change)\b/i,
  },
  {
    theme: "hvac",
    pattern:
      /\b(hvac|heating|cooling|air\s?condition\w*|furnace|\bac\b|refrigeration|ductwork)\b/i,
  },
  {
    theme: "landscaping",
    pattern:
      /\b(landscap\w*|lawn|garden\w*|tree|trees|yard|irrigation|hardscap\w*|nursery|sod|mulch)\b/i,
  },
];

/**
 * Pick a trade theme from a business category string (free-text, from scraped
 * Maps data). Unknown / ambiguous categories get the neutral universal theme.
 */
export function selectTheme(category: string | undefined): Theme {
  const text = category ?? "";
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return THEMES[rule.theme];
  }
  return THEMES.universal;
}
