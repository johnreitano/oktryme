import type { BusinessRecord, ScanEvent } from "./types.js";
import { assertBusinessRecord, validateBusinessRecord } from "./validate.js";

/**
 * Data store abstraction over the canonical `business.json` records.
 * Keyed by `handle`; a separate domain→handle map resolves live requests.
 */
export interface Store {
  get(handle: string): Promise<BusinessRecord | null>;
  put(rec: BusinessRecord): Promise<void>;
  /** All business records (for the CRM read view / call queue, §6). */
  list(): Promise<BusinessRecord[]>;
  resolveDomain(domain: string): Promise<string | null>;
  mapDomain(domain: string, handle: string): Promise<void>;
  /** Resolve a Stripe customer id back to a handle (dunning/cancel webhooks). */
  resolveCustomer(customerId: string): Promise<string | null>;
  mapCustomer(customerId: string, handle: string): Promise<void>;
  /** Append-only QR-scan log for postcard attribution (§1C). */
  logScan(handle: string, event: ScanEvent): Promise<void>;
  /** All scan events for a handle (attribution / Phase-6 call queue). */
  getScans(handle: string): Promise<ScanEvent[]>;
}

const REC_PREFIX = "biz:";
const DOMAIN_PREFIX = "domain:";
const CUSTOMER_PREFIX = "customer:";
const SCAN_PREFIX = "scan:";

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

  async list(): Promise<BusinessRecord[]> {
    const out: BusinessRecord[] = [];
    let cursor: string | undefined;
    // Page through every biz: key (KV caps list pages at 1000 keys).
    do {
      const page = await this.kv.list({ prefix: REC_PREFIX, cursor });
      for (const { name } of page.keys) {
        const rec = await this.get(name.slice(REC_PREFIX.length));
        if (rec) out.push(rec); // get() drops corrupt records (logged there)
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
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

  // Each scan is its own key (`scan:{handle}:{ts}:{rand}`) so concurrent hits
  // never race on a read-modify-write counter; the count is the list size.
  async logScan(handle: string, event: ScanEvent): Promise<void> {
    const key = `${SCAN_PREFIX}${handle}:${event.at}:${crypto.randomUUID()}`;
    await this.kv.put(key, JSON.stringify(event));
  }

  async getScans(handle: string): Promise<ScanEvent[]> {
    const prefix = `${SCAN_PREFIX}${handle}:`;
    const events: ScanEvent[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix, cursor });
      for (const { name } of page.keys) {
        const raw = await this.kv.get(name, "json");
        if (raw) events.push(raw as ScanEvent);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return events.sort((a, b) => a.at.localeCompare(b.at));
  }
}

/** In-memory store for tests and local spikes. */
export class MemoryStore implements Store {
  private recs = new Map<string, BusinessRecord>();
  private domains = new Map<string, string>();
  private customers = new Map<string, string>();
  private scans = new Map<string, ScanEvent[]>();

  async get(handle: string): Promise<BusinessRecord | null> {
    const rec = this.recs.get(handle);
    return rec ? structuredClone(rec) : null;
  }

  async put(rec: BusinessRecord): Promise<void> {
    this.recs.set(rec.handle, structuredClone(rec));
    if (rec.domain) await this.mapDomain(rec.domain, rec.handle);
    if (rec.stripe?.customerId) await this.mapCustomer(rec.stripe.customerId, rec.handle);
  }

  async list(): Promise<BusinessRecord[]> {
    return [...this.recs.values()].map((r) => structuredClone(r));
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

  async logScan(handle: string, event: ScanEvent): Promise<void> {
    const list = this.scans.get(handle) ?? [];
    list.push({ ...event });
    this.scans.set(handle, list);
  }

  async getScans(handle: string): Promise<ScanEvent[]> {
    return (this.scans.get(handle) ?? [])
      .map((e) => ({ ...e }))
      .sort((a, b) => a.at.localeCompare(b.at));
  }
}
