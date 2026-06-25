// Per-trade hero image prompts (Phase 3, §6 of PLAN.md).
//
// These are the specialized prompts that drive per-trade hero generation with
// Google Nano Banana Pro (Gemini). Each was produced with the 3-step realism
// workflow in `image-prompting-process.md` (generate → critique/improve →
// compress/de-gloss): the goal is a believable working-environment photograph,
// not a glossy stock ad or AI render.
//
// Design constraints shared by every prompt:
// - Hero BACKGROUND: wide 16:9, a calm/empty upper-left region for the white
//   overlay text the renderer places on top (see renderer `.hero__overlay`).
// - No identifiable faces in the foreground (we don't want a real person's
//   likeness fronting an unrelated business); people, if any, are incidental,
//   mid-task, turned away or cropped.
// - No text, signage, logos, brand marks, or license plates (the renderer adds
//   the business name; baked-in text looks fake and risks trademark issues).
// One image per THEME (not per business) — the renderer assigns the theme's hero
// to any business on that theme that has no custom photo.

import type { ThemeKey } from "../render/themes.js";

export interface ImagePrompt {
  /** The positive generation prompt. */
  prompt: string;
  /** Things to keep out — appended/handled by the generator as an avoid list. */
  negative: string;
}

/**
 * Shared avoid list — the realism killers and the legal/overlay constraints
 * that apply to every trade. Combined with each prompt's own `negative`.
 */
export const SHARED_NEGATIVE =
  "text, lettering, captions, watermark, logo, brand name, signage, license plate, " +
  "poster, cinematic color grade, lens flare, heavy bokeh, glossy advertisement look, " +
  "HDR glow, oversaturation, plastic skin, perfect symmetry, staged stock-photo posing, " +
  "looking at camera, distorted hands, extra fingers, warped tools, duplicated objects";

/**
 * Final, de-glossed prompts per theme. Written as documentary photographs:
 * concrete materials, ordinary daylight, slightly imperfect framing, incidental
 * wear and clutter — the small truths that read as "a real photo," not a render.
 */
export const IMAGE_PROMPTS: Record<ThemeKey, ImagePrompt> = {
  auto: {
    prompt:
      "A working independent auto-repair garage on an overcast morning, shot from " +
      "across the shop floor on a 35mm lens at chest height. A sedan sits raised on a " +
      "two-post lift on the right; the open left half of the frame shows a roller " +
      "door and bare concrete with old oil stains and tire-scuff marks. Daylight " +
      "spills in flat and grey from the open bay, mixing with cool fluorescent tubes " +
      "overhead. A pegboard of hand tools, a red rolling tool chest with a few drawers " +
      "ajar, a coiled air hose on the floor, a grease rag draped over a fender. Paint " +
      "scuffed on the workbench edge. A mechanic in a navy work shirt is bent over the " +
      "engine bay, back to the camera, slightly out of focus. Muted greys, faded reds, " +
      "true-to-life color, soft natural contrast.",
    negative: "showroom car, new luxury vehicle, spotless floor, racing imagery",
  },
  hvac: {
    prompt:
      "An HVAC technician servicing a residential condenser unit beside a suburban " +
      "house on a clear late afternoon, photographed from a few feet away at waist " +
      "height on a 50mm lens. The grey condenser sits on a concrete pad against beige " +
      "siding; its side panel is off, copper lines and the coil visible, a multimeter " +
      "clipped to the fins. The technician kneels at the right in a grey polo and work " +
      "gloves, head down and partly cropped, hands on the unit. Open sky and plain " +
      "siding fill the upper left. Low warm sun rakes across, throwing a long soft " +
      "shadow; dust on the pad, a few dead leaves, a scuff on the siding. Natural " +
      "warm-cool daylight, realistic muted color, gentle contrast.",
    negative: "indoor studio, glowing screens, futuristic equipment, sparkling clean unit",
  },
  landscaping: {
    prompt:
      "A residential front lawn mid-mow on a bright but slightly hazy morning, shot " +
      "low from the grass on a 35mm lens. A green commercial walk-behind mower sits " +
      "at the right with fresh clippings stuck to its deck; a clean mowing stripe " +
      "leads back toward a modest house and a maple tree. The open left half is plain " +
      "cut grass and a strip of pale sky. Morning light comes in soft and a little " +
      "flat, dew still on the uncut edge, a garden hose coiled by the path, a few " +
      "stray clippings on the walkway. Natural greens, no oversaturation, true daylight " +
      "white balance, soft shadows.",
    negative: "manicured golf course, tropical resort, drone top-down view, vivid HDR greens",
  },
  universal: {
    prompt:
      "A local tradesperson's work van parked at a residential curb on a quiet street " +
      "in the morning, photographed from the sidewalk on a 35mm lens at eye level. " +
      "The plain white van has its rear doors open showing organized shelving of " +
      "tools, bins, and coiled cord; a closed step ladder leans against the bumper. " +
      "Plain sky and a neighbor's hedge fill the upper left. Flat even daylight, a " +
      "little road grime on the van's lower panels, a small dent, a coffee cup on the " +
      "wheel well. Ordinary, true-to-life color, soft natural contrast, slightly " +
      "imperfect framing.",
    negative: "fleet of branded vans, billboard, city skyline, neon, dramatic sky",
  },
};

/** Build the full prompt text for a theme (positive + combined avoid list). */
export function fullImagePrompt(theme: ThemeKey): {
  prompt: string;
  negative: string;
} {
  const p = IMAGE_PROMPTS[theme];
  return { prompt: p.prompt, negative: `${p.negative}, ${SHARED_NEGATIVE}` };
}

/** R2 object key the renderer expects for a theme's generated hero. */
export function heroKeyForTheme(theme: ThemeKey): string {
  return `trade/${theme}/hero.jpg`;
}
