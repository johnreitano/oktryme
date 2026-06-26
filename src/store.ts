import type { BusinessRecord } from "./types.js";
import { assertBusinessRecord, validateBusinessRecord } from "./validate.js";

/**
 * Data store abstraction over the canonical `business.json` records.
 * Keyed by `handle`; a separate domain→handle map resolves live requests.
 */
export interface Store {
  get(handle: string): Promise<BusinessRecord | null>;
  put(rec: BusinessRecord): Promise<void>;
  resolveDomain(domain: string): Promise<string | null>;
  mapDomain(domain: string, handle: string): Promise<void>;
  /** Resolve a Stripe customer id back to a handle (dunning/cancel webhooks). */
  resolveCustomer(customerId: string): Promise<string | null>;
  mapCustomer(customerId: string, handle: string): Promise<void>;
}

const REC_PREFIX = "biz:";
const DOMAIN_PREFIX = "domain:";
const CUSTOMER_PREFIX = "customer:";

/** Cloudflare KV-backed store (production). */
export class KVStore implements Store {
  constructor(private kv: KVNamespace) {}

  async get(handle: string): Promise<BusinessRecord | null> {
    const raw = await this.kv.get(REC_PREFIX + handle, "json");
    if (raw === null) return null;
    // A corrupt stored record must never render as a live site. Log it (so it
    // surfaces in Worker logs) and treat as not-found rather than crash.
    const result = validateBusinessRecord(raw);
    if (!result.ok) {
      console.error(`invalid record at ${REC_PREFIX + handle}: ${result.issues.join("; ")}`);
      return null;
    }
    return result.value;
  }

  async put(rec: BusinessRecord): Promise<void> {
    assertBusinessRecord(rec); // reject bad writes loudly at the boundary
    if (!rec.createdAt) rec.createdAt = new Date().toISOString();
    await this.kv.put(REC_PREFIX + rec.handle, JSON.stringify(rec));
    if (rec.domain) await this.mapDomain(rec.domain, rec.handle);
    // Keep the customer index fresh so dunning/cancel events resolve the handle
    // even when the Stripe event object carries no `handle` metadata (§5a).
    if (rec.stripe?.customerId) await this.mapCustomer(rec.stripe.customerId, rec.handle);
  }

  async resolveDomain(domain: string): Promise<string | null> {
    return this.kv.get(DOMAIN_PREFIX + domain.toLowerCase());
  }

  async mapDomain(domain: string, handle: string): Promise<void> {
    await this.kv.put(DOMAIN_PREFIX + domain.toLowerCase(), handle);
  }

  async resolveCustomer(customerId: string): Promise<string | null> {
    return this.kv.get(CUSTOMER_PREFIX + customerId);
  }

  async mapCustomer(customerId: string, handle: string): Promise<void> {
    await this.kv.put(CUSTOMER_PREFIX + customerId, handle);
  }
}

/** In-memory store for tests and local spikes. */
export class MemoryStore implements Store {
  private recs = new Map<string, BusinessRecord>();
  private domains = new Map<string, string>();
  private customers = new Map<string, string>();

  async get(handle: string): Promise<BusinessRecord | null> {
    const rec = this.recs.get(handle);
    return rec ? structuredClone(rec) : null;
  }

  async put(rec: BusinessRecord): Promise<void> {
    this.recs.set(rec.handle, structuredClone(rec));
    if (rec.domain) await this.mapDomain(rec.domain, rec.handle);
    if (rec.stripe?.customerId) await this.mapCustomer(rec.stripe.customerId, rec.handle);
  }

  async resolveDomain(domain: string): Promise<string | null> {
    return this.domains.get(domain.toLowerCase()) ?? null;
  }

  async mapDomain(domain: string, handle: string): Promise<void> {
    this.domains.set(domain.toLowerCase(), handle);
  }

  async resolveCustomer(customerId: string): Promise<string | null> {
    return this.customers.get(customerId) ?? null;
  }

  async mapCustomer(customerId: string, handle: string): Promise<void> {
    this.customers.set(customerId, handle);
  }
}
