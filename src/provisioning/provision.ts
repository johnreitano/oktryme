import type { Store } from "../store.js";
import type { BusinessRecord } from "../types.js";

/**
 * Domain provisioning seam. V3 (Stripe → provision) injects a stub; V1
 * (the real spike) swaps in a Cloudflare Registrar + Workers Custom Domain
 * client behind this same interface. Nothing else changes.
 */
export interface Provisioner {
  /** Register `preferred`, walking `backups` on collision. Returns the domain secured. */
  registerDomain(
    handle: string,
    preferred: string,
    backups: string[],
  ): Promise<{ domain: string }>;
  /** Attach the domain to the site Worker (auto DNS + edge TLS in the real impl). */
  attachCustomDomain(domain: string): Promise<void>;
}

export class ProvisionError extends Error {}

/**
 * Stub provisioner for V3 / local spikes: pretends the preferred domain was
 * registered and attached. Records calls so tests can assert on them. The real
 * V1 client must preserve this contract (idempotent, backup-walking).
 */
export class StubProvisioner implements Provisioner {
  registered: string[] = [];
  attached: string[] = [];
  /** Set of names to treat as already taken, to exercise backup-walking. */
  constructor(private taken: Set<string> = new Set()) {}

  async registerDomain(
    _handle: string,
    preferred: string,
    backups: string[],
  ): Promise<{ domain: string }> {
    for (const candidate of [preferred, ...backups]) {
      if (!this.taken.has(candidate.toLowerCase())) {
        this.registered.push(candidate);
        return { domain: candidate };
      }
    }
    throw new ProvisionError("All candidate domains are taken");
  }

  async attachCustomDomain(domain: string): Promise<void> {
    this.attached.push(domain);
  }
}

/**
 * Provision a paid customer's live site. Idempotent and keyed by `handle`:
 * if the record is already `active` with a domain, it's a no-op (webhook
 * re-delivery is safe — §5a C). Persists the result to the store.
 */
export async function provisionForActivation(
  handle: string,
  preferredDomain: string,
  backups: string[],
  store: Store,
  provisioner: Provisioner,
): Promise<BusinessRecord> {
  const rec = await store.get(handle);
  if (!rec) throw new ProvisionError(`No record for handle: ${handle}`);

  // Idempotency: already provisioned → return as-is.
  if (rec.status === "active" && rec.domain) return rec;

  const { domain } = await provisioner.registerDomain(
    handle,
    preferredDomain,
    backups,
  );
  await provisioner.attachCustomDomain(domain);

  rec.domain = domain;
  rec.status = "active";
  rec.updatedAt = new Date().toISOString();
  await store.put(rec);
  await store.mapDomain(domain, handle);
  return rec;
}
