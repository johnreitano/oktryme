import sample from "./fixtures/business.sample.json";
import type { BusinessRecord } from "../src/types.js";

/** Return a fresh, deep-cloned copy of the sample business record. */
export function sampleBusiness(): BusinessRecord {
  return structuredClone(sample) as unknown as BusinessRecord;
}
