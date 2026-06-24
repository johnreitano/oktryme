import { describe, it, expect } from "vitest";
import {
  signPayload,
  verifyStripeSignature,
  handleStripeEvent,
  planForPrice,
  backupDomains,
  type PriceMap,
} from "../src/billing/stripe.js";
import { MemoryStore } from "../src/store.js";
import { StubProvisioner } from "../src/provisioning/provision.js";
import { sampleBusiness } from "./helpers.js";

const SECRET = "whsec_test_secret";
const PRICES: PriceMap = { selfServe: "price_49", doneForYou: "price_99" };

function checkoutEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        customer: "cus_123",
        subscription: "sub_123",
        client_reference_id: "joes-auto",
        metadata: { handle: "joes-auto", domain: "joesauto.com" },
        ...overrides,
      },
    },
  };
}

async function setup() {
  const store = new MemoryStore();
  await store.put(sampleBusiness());
  const provisioner = new StubProvisioner();
  return { store, provisioner };
}

// V3 — Stripe Checkout → webhook → status flip → provision, end-to-end.
describe("V3: Stripe signature verification", () => {
  it("accepts a correctly-signed payload", async () => {
    const body = JSON.stringify(checkoutEvent());
    const t = 1_700_000_000;
    const header = await signPayload(body, SECRET, t);
    expect(await verifyStripeSignature(body, header, SECRET, t)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const t = 1_700_000_000;
    const header = await signPayload("{}", SECRET, t);
    expect(
      await verifyStripeSignature('{"x":1}', header, SECRET, t),
    ).toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const body = "{}";
    const t = 1_700_000_000;
    const header = await signPayload(body, SECRET, t);
    expect(
      await verifyStripeSignature(body, header, "whsec_wrong", t),
    ).toBe(false);
  });

  it("rejects a stale timestamp (replay)", async () => {
    const body = "{}";
    const t = 1_700_000_000;
    const header = await signPayload(body, SECRET, t);
    expect(
      await verifyStripeSignature(body, header, SECRET, t + 10_000),
    ).toBe(false);
  });

  it("rejects a missing header", async () => {
    expect(await verifyStripeSignature("{}", null, SECRET, 1)).toBe(false);
  });
});

describe("V3: checkout.session.completed → activate + provision", () => {
  it("flips preview → active, links Stripe ids, and provisions the domain", async () => {
    const { store, provisioner } = await setup();
    const res = await handleStripeEvent(checkoutEvent(), {
      store,
      provisioner,
      prices: PRICES,
      previewHost: "multiply.app",
    });
    expect(res).toMatchObject({ handled: true, action: "activated", handle: "joes-auto" });

    const rec = await store.get("joes-auto");
    expect(rec?.status).toBe("active");
    expect(rec?.domain).toBe("joesauto.com");
    expect(rec?.stripe?.customerId).toBe("cus_123");
    expect(rec?.stripe?.subscriptionId).toBe("sub_123");
    expect(provisioner.registered).toContain("joesauto.com");
    expect(provisioner.attached).toContain("joesauto.com");
    // domain→handle map is set for live routing
    expect(await store.resolveDomain("joesauto.com")).toBe("joes-auto");
  });

  it("is idempotent on webhook re-delivery (no double provision)", async () => {
    const { store, provisioner } = await setup();
    const deps = { store, provisioner, prices: PRICES, previewHost: "multiply.app" };
    await handleStripeEvent(checkoutEvent(), deps);
    await handleStripeEvent(checkoutEvent(), deps);
    expect(provisioner.registered.filter((d) => d === "joesauto.com")).toHaveLength(1);
  });

  it("walks the backup list when the preferred domain is taken", async () => {
    const store = new MemoryStore();
    await store.put(sampleBusiness());
    const provisioner = new StubProvisioner(new Set(["joesauto.com"]));
    await handleStripeEvent(checkoutEvent(), {
      store,
      provisioner,
      prices: PRICES,
      previewHost: "multiply.app",
    });
    const rec = await store.get("joes-auto");
    expect(rec?.domain).toBe("joesauto.net"); // first backup
  });

  it("ignores events for unknown handles", async () => {
    const { store, provisioner } = await setup();
    const res = await handleStripeEvent(
      checkoutEvent({ client_reference_id: "nobody", metadata: { handle: "nobody" } }),
      { store, provisioner, prices: PRICES, previewHost: "multiply.app" },
    );
    expect(res.handled).toBe(false);
  });
});

describe("V3: plan mapping + dunning transitions", () => {
  it("maps price ids to plans", () => {
    expect(planForPrice("price_99", PRICES)).toBe("done_for_you");
    expect(planForPrice("price_49", PRICES)).toBe("self_serve");
    expect(planForPrice(undefined, PRICES)).toBe("self_serve");
  });

  it("payment_failed → past_due; subscription deleted → canceled", async () => {
    const { store, provisioner } = await setup();
    const deps = { store, provisioner, prices: PRICES, previewHost: "multiply.app" };
    await handleStripeEvent(checkoutEvent(), deps);

    await handleStripeEvent(
      { id: "evt_2", type: "invoice.payment_failed", data: { object: { customer: "cus_123", metadata: { handle: "joes-auto" } } } },
      deps,
    );
    expect((await store.get("joes-auto"))?.status).toBe("past_due");

    await handleStripeEvent(
      { id: "evt_3", type: "customer.subscription.deleted", data: { object: { customer: "cus_123", metadata: { handle: "joes-auto" } } } },
      deps,
    );
    expect((await store.get("joes-auto"))?.status).toBe("canceled");
  });
});

describe("V3: backup domain generation", () => {
  it("derives ranked fallbacks from the desired name", () => {
    expect(backupDomains("joesauto.com", "joes-auto")).toEqual({
      preferred: "joesauto.com",
      backups: ["joesauto.net", "joesauto.co", "getjoesauto.com"],
    });
  });

  it("defaults to {handle}.com when no domain is provided", () => {
    expect(backupDomains(undefined, "joes-auto").preferred).toBe("joes-auto.com");
  });
});
