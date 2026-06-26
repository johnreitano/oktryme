import { describe, it, expect } from "vitest";
import {
  provisionForActivation,
  StubProvisioner,
  type Provisioner,
} from "../src/provisioning/provision.js";
import { MemoryStore } from "../src/store.js";
import { sampleBusiness } from "./helpers.js";

async function seeded() {
  const store = new MemoryStore();
  const rec = sampleBusiness();
  await store.put(rec);
  return store;
}

describe("Phase 4: provisionForActivation", () => {
  it("registers + attaches and marks the record provisioned", async () => {
    const store = await seeded();
    const provisioner = new StubProvisioner();
    const rec = await provisionForActivation(
      "joes-auto",
      "joesauto.com",
      ["joesauto.net"],
      store,
      provisioner,
      { previewHost: "oktryme.com" },
    );
    expect(rec.status).toBe("active");
    expect(rec.domain).toBe("joesauto.com");
    expect(rec.provisioning?.state).toBe("provisioned");
    expect(provisioner.attached).toContain("joesauto.com");
  });

  it("is a no-op once provisioned (re-delivery safe)", async () => {
    const store = await seeded();
    const provisioner = new StubProvisioner();
    const opts = { previewHost: "oktryme.com" };
    await provisionForActivation("joes-auto", "joesauto.com", [], store, provisioner, opts);
    await provisionForActivation("joes-auto", "joesauto.com", [], store, provisioner, opts);
    expect(provisioner.registered.filter((d) => d === "joesauto.com")).toHaveLength(1);
  });

  it("falls back to active+subdomain on failure, then a retry can succeed", async () => {
    const store = await seeded();
    // First a provisioner that always fails registration.
    const failing: Provisioner = {
      async registerDomain() {
        throw new Error("registrar 500");
      },
      async attachCustomDomain() {},
    };
    const alerts: any[] = [];
    const rec1 = await provisionForActivation(
      "joes-auto",
      "joesauto.com",
      [],
      store,
      failing,
      { previewHost: "oktryme.com", onFallback: async (i) => { alerts.push(i); } },
    );
    expect(rec1.status).toBe("active");
    expect(rec1.domain).toBeUndefined();
    expect(rec1.provisioning).toMatchObject({ state: "fallback", attempts: 1 });
    expect(alerts[0].fallbackUrl).toBe("https://joes-auto.oktryme.com");

    // Re-delivery with a working provisioner promotes it to the custom domain.
    const ok = new StubProvisioner();
    const rec2 = await provisionForActivation(
      "joes-auto",
      "joesauto.com",
      [],
      store,
      ok,
      { previewHost: "oktryme.com" },
    );
    expect(rec2.provisioning).toMatchObject({ state: "provisioned", attempts: 2 });
    expect(rec2.domain).toBe("joesauto.com");
  });

  it("never lets a failing ops alert break activation", async () => {
    const store = await seeded();
    const failing: Provisioner = {
      async registerDomain() { throw new Error("boom"); },
      async attachCustomDomain() {},
    };
    const rec = await provisionForActivation(
      "joes-auto",
      "joesauto.com",
      [],
      store,
      failing,
      { previewHost: "oktryme.com", onFallback: async () => { throw new Error("alert down"); } },
    );
    expect(rec.status).toBe("active");
    expect(rec.provisioning?.state).toBe("fallback");
  });
});
