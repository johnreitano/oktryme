import type { BusinessRecord, DayOfWeek } from "../types.js";
import { DAYS_OF_WEEK } from "../types.js";

/**
 * Structured, schema-validated edit operations — the core of the self-serve
 * AI chat editor (§6 of PLAN.md). The AI emits one of these ops; `applyEdit`
 * validates and applies it. Edits are constrained to the schema so the AI
 * cannot break the site or fabricate arbitrary HTML.
 */
export type EditOp =
  | { type: "setHours"; day: DayOfWeek; value: string }
  | { type: "setDescription"; value: string }
  | { type: "setAbout"; value: string }
  | { type: "setPhone"; value: string }
  | { type: "addService"; name: string; description?: string }
  | { type: "removeService"; name: string }
  | { type: "setImage"; slot: string; url: string };

export class EditError extends Error {}

/** Blocked image hosts — enforces the "no scraped Google Maps photos" rule (§11). */
const BLOCKED_IMAGE_HOSTS = [
  "googleusercontent.com",
  "maps.google.com",
  "maps.gstatic.com",
  "lh3.googleusercontent.com",
];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new EditError(msg);
}

function validateImageUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EditError(`Invalid image URL: ${url}`);
  }
  assert(
    parsed.protocol === "https:" || parsed.protocol === "http:",
    "Image URL must be http(s)",
  );
  const host = parsed.hostname.toLowerCase();
  assert(
    !BLOCKED_IMAGE_HOSTS.some((b) => host === b || host.endsWith("." + b)),
    "Google Maps / scraped photos are not allowed; use licensed stock or customer uploads",
  );
}

/**
 * Apply a single validated edit, returning a NEW record (the input is never
 * mutated). Throws `EditError` on any invalid operation. Re-rendering is just
 * calling `renderSite` on the result — no rebuild step.
 */
export function applyEdit(rec: BusinessRecord, op: EditOp): BusinessRecord {
  const next: BusinessRecord = structuredClone(rec);

  switch (op.type) {
    case "setHours": {
      assert(DAYS_OF_WEEK.includes(op.day), `Unknown day: ${op.day}`);
      assert(op.value.trim().length > 0, "Hours value cannot be empty");
      next.business.hours[op.day] = op.value.trim();
      break;
    }
    case "setDescription": {
      assert(op.value.trim().length > 0, "Description cannot be empty");
      next.business.description = op.value.trim();
      break;
    }
    case "setAbout": {
      assert(op.value.trim().length > 0, "About cannot be empty");
      next.business.about = op.value.trim();
      break;
    }
    case "setPhone": {
      assert(/[0-9]/.test(op.value), "Phone must contain digits");
      next.business.phone = op.value.trim();
      break;
    }
    case "addService": {
      assert(op.name.trim().length > 0, "Service name cannot be empty");
      assert(
        !next.services.some(
          (s) => s.name.toLowerCase() === op.name.trim().toLowerCase(),
        ),
        `Service already exists: ${op.name}`,
      );
      next.services.push({
        name: op.name.trim(),
        ...(op.description ? { description: op.description.trim() } : {}),
      });
      break;
    }
    case "removeService": {
      const before = next.services.length;
      next.services = next.services.filter(
        (s) => s.name.toLowerCase() !== op.name.trim().toLowerCase(),
      );
      assert(next.services.length < before, `Service not found: ${op.name}`);
      break;
    }
    case "setImage": {
      assert(op.slot.trim().length > 0, "Image slot cannot be empty");
      validateImageUrl(op.url);
      next.images[op.slot.trim()] = op.url;
      break;
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = op;
      throw new EditError(`Unknown edit op: ${JSON.stringify(_never)}`);
    }
  }

  next.updatedAt = new Date().toISOString();
  return next;
}
