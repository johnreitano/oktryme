import type { BusinessRecord } from "./types.js";

/**
 * Data store abstraction over the canonical `business.json` records.
 * Keyed by `handle`; a separate domain→handle map resolves live requests.
 */
export interface Store {
  get(handle: string): Promise<BusinessRecord | null>;
  put(rec: BusinessRecord): Promise<void>;
  resolveDomain(domain: string): Promise<string | null>;
  mapDomain(domain: string, handle: string): Promise<void>;
}

const REC_PREFIX = "biz:";
const DOMAIN_PREFIX = "domain:";

/** Cloudflare KV-backed store (production). */
export class KVStore implements Store {
  constructor(private kv: KVNamespace) {}

  async get(handle: string): Promise<BusinessRecord | null> {
    return this.kv.get<BusinessRecord>(REC_PREFIX + handle, "json");
  }

  async put(rec: BusinessRecord): Promise<void> {
    await this.kv.put(REC_PREFIX + rec.handle, JSON.stringify(rec));
    if (rec.domain) await this.mapDomain(rec.domain, rec.handle);
  }

  async resolveDomain(domain: string): Promise<string | null> {
    return this.kv.get(DOMAIN_PREFIX + domain.toLowerCase());
  }

  async mapDomain(domain: string, handle: string): Promise<void> {
    await this.kv.put(DOMAIN_PREFIX + domain.toLowerCase(), handle);
  }
}

/** In-memory store for tests and local spikes. */
export class MemoryStore implements Store {
  private recs = new Map<string, BusinessRecord>();
  private domains = new Map<string, string>();

  async get(handle: string): Promise<BusinessRecord | null> {
    const rec = this.recs.get(handle);
    return rec ? structuredClone(rec) : null;
  }

  async put(rec: BusinessRecord): Promise<void> {
    this.recs.set(rec.handle, structuredClone(rec));
    if (rec.domain) await this.mapDomain(rec.domain, rec.handle);
  }

  async resolveDomain(domain: string): Promise<string | null> {
    return this.domains.get(domain.toLowerCase()) ?? null;
  }

  async mapDomain(domain: string, handle: string): Promise<void> {
    this.domains.set(domain.toLowerCase(), handle);
  }
}
