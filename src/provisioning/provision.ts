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

export interface ProvisionOptions {
  /**
   * Preview host (e.g. "oktryme.com") used to build the `{handle}.<host>`
   * fallback URL the customer is served on if custom-domain provisioning stalls
   * (§5a E). Omit and the fallback URL is left undefined.
   */
  previewHost?: string;
  /**
   * Notified when provisioning falls back to the subdomain so ops can finish the
   * custom domain manually (§5a E "flag ops"). Failures here are swallowed —
   * alerting must never break the activation path.
   */
  onFallback?: (info: {
    handle: string;
    error: string;
    fallbackUrl?: string;
  }) => Promise<void>;
}

/**
 * Provision a paid customer's live site. Idempotent and keyed by `handle`:
 * if the record is already `active` and fully `provisioned`, it's a no-op
 * (webhook re-delivery is safe — §5a C).
 *
 * Failure handling (§5a E): if registration or attach fails, the subscription
 * is still flipped `active` and the site is served on the `{handle}.<host>`
 * fallback subdomain — a paying customer is never left with nothing and we never
 * auto-refund. The failure is recorded on `provisioning` (state `fallback` +
 * error + attempt count) and ops is alerted; re-delivery retries the custom
 * domain. Persists the result to the store.
 */
export async function provisionForActivation(
  handle: string,
  preferredDomain: string,
  backups: string[],
  store: Store,
  provisioner: Provisioner,
  opts: ProvisionOptions = {},
): Promise<BusinessRecord> {
  const rec = await store.get(handle);
  if (!rec) throw new ProvisionError(`No record for handle: ${handle}`);

  // Idempotency: custom domain already live → no-op (don't re-register).
  if (rec.status === "active" && rec.domain && rec.provisioning?.state === "provisioned") {
    return rec;
  }

  const attempts = (rec.provisioning?.attempts ?? 0) + 1;
  const now = new Date().toISOString();

  try {
    const { domain } = await provisioner.registerDomain(
      handle,
      preferredDomain,
      backups,
    );
    await provisioner.attachCustomDomain(domain);

    rec.domain = domain;
    rec.status = "active";
    rec.provisioning = { state: "provisioned", attempts, updatedAt: now };
    rec.updatedAt = now;
    await store.put(rec);
    await store.mapDomain(domain, handle);
    return rec;
  } catch (err) {
    // §5a E — payment succeeded; deliver on the fallback subdomain, flag ops.
    const error = err instanceof Error ? err.message : String(err);
    rec.status = "active";
    rec.provisioning = { state: "fallback", lastError: error, attempts, updatedAt: now };
    rec.updatedAt = now;
    await store.put(rec);

    const fallbackUrl = opts.previewHost
      ? `https://${handle}.${opts.previewHost}`
      : undefined;
    if (opts.onFallback) {
      try {
        await opts.onFallback({ handle, error, fallbackUrl });
      } catch {
        // Alerting is best-effort — never let it break activation.
      }
    }
    return rec;
  }
}
