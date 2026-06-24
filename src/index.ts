import { KVStore } from "./store.js";
import { renderSite } from "./render/renderer.js";
import { handleLead, LogSender } from "./lead/form.js";
import {
  verifyStripeSignature,
  handleStripeEvent,
  type PriceMap,
} from "./billing/stripe.js";
import { StubProvisioner } from "./provisioning/provision.js";

export interface Env {
  BUSINESS_KV: KVNamespace;
  PREVIEW_HOST: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PRICE_SELF_SERVE?: string;
  PRICE_DONE_FOR_YOU?: string;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * The single Worker (§3 of PLAN.md): renders preview (by path) and live (by
 * custom domain) from one data source, serves the contact form + QR routes,
 * and handles Stripe webhooks.
 *
 * NOTE: the Registrar + Workers-Custom-Domain provisioner is stubbed here
 * (V1 supplies the real client); everything else is production-shaped.
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const store = new KVStore(env.BUSINESS_KV);
    const host = url.hostname;
    const isPreviewHost =
      host === env.PREVIEW_HOST || host === `www.${env.PREVIEW_HOST}`;

    // ---- Stripe webhook ----
    if (req.method === "POST" && url.pathname === "/stripe/webhook") {
      const body = await req.text();
      const ok = await verifyStripeSignature(
        body,
        req.headers.get("stripe-signature"),
        env.STRIPE_WEBHOOK_SECRET ?? "",
        nowSec(),
      );
      if (!ok) return new Response("bad signature", { status: 400 });
      const prices: PriceMap = {
        selfServe: env.PRICE_SELF_SERVE ?? "",
        doneForYou: env.PRICE_DONE_FOR_YOU ?? "",
      };
      const result = await handleStripeEvent(JSON.parse(body), {
        store,
        provisioner: new StubProvisioner(),
        prices,
        previewHost: env.PREVIEW_HOST,
      });
      return Response.json(result);
    }

    // ---- Contact form ----
    const leadMatch = url.pathname.match(/^\/lead\/([^/]+)$/);
    if (req.method === "POST" && leadMatch) {
      const res = await handleLead(
        leadMatch[1],
        await req.formData(),
        store,
        new LogSender(),
      );
      return res.ok
        ? new Response("Thanks — we'll be in touch.", { status: 200 })
        : new Response(res.error, { status: 400 });
    }

    // ---- QR scan redirect (log scan → preview). QR image gen is a later spike. ----
    const scanMatch = url.pathname.match(/^\/r\/([^/]+)$/);
    if (req.method === "GET" && scanMatch) {
      const handle = scanMatch[1];
      // TODO: log scan event (handle, ts, UA) for attribution (§1C).
      return Response.redirect(
        `https://${env.PREVIEW_HOST}/p/${handle}`,
        302,
      );
    }

    // ---- Preview render ----
    const previewMatch = url.pathname.match(/^\/p\/([^/]+)$/);
    if (req.method === "GET" && previewMatch) {
      const rec = await store.get(previewMatch[1]);
      if (!rec) return new Response("Not found", { status: 404 });
      return new Response(renderSite(rec, "preview"), {
        headers: { "content-type": "text/html;charset=utf-8" },
      });
    }

    // ---- Live render (by custom domain) ----
    if (req.method === "GET" && !isPreviewHost) {
      const handle = await store.resolveDomain(host);
      if (handle) {
        const rec = await store.get(handle);
        if (rec && rec.status === "active") {
          return new Response(renderSite(rec, "live"), {
            headers: { "content-type": "text/html;charset=utf-8" },
          });
        }
        if (rec && (rec.status === "canceled" || rec.status === "past_due")) {
          return new Response("Site paused — update billing.", { status: 402 });
        }
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
