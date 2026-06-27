import { KVStore } from "./store.js";
import { renderSite } from "./render/renderer.js";
import { renderLanding } from "./render/landing.js";
import { serveImage } from "./images/r2.js";
import { handleLead, LogSender, type LeadEmailSender } from "./lead/form.js";
import { ResendSender } from "./lead/resend.js";
import {
  verifyStripeSignature,
  handleStripeEvent,
  createCheckoutSession,
  createPortalSession,
  type PriceMap,
} from "./billing/stripe.js";
import { StubProvisioner, type Provisioner } from "./provisioning/provision.js";
import { CloudflareProvisioner } from "./provisioning/cloudflare.js";
import {
  LogOpsNotifier,
  ResendOpsNotifier,
  type OpsNotifier,
} from "./notify/ops.js";
import { handleDfyRequest } from "./dfy/intake.js";
import {
  advancePipeline,
  applyMailStatus,
  setPipelineManual,
} from "./crm/pipeline.js";
import { renderCrm, buildQueue, statusCounts } from "./crm/view.js";
import { renderQrSvg, scanUrl } from "./outreach/qr.js";
import { handlePostgridWebhook, mapPostgridStatus } from "./outreach/postgrid.js";
import {
  PIPELINE_STATUSES,
  type Plan,
  type PipelineStatus,
} from "./types.js";

export interface Env {
  BUSINESS_KV: KVNamespace;
  // Site imagery (licensed category stock + customer uploads). Consumed by the
  // renderer/ingest in Phase 2; bound now (front-loaded with R2 enablement).
  IMAGES: R2Bucket;
  PREVIEW_HOST: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PRICE_SELF_SERVE?: string;
  PRICE_DONE_FOR_YOU?: string;
  // Cloudflare provisioning (V1) — when present, real provisioning is used.
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_WORKER_SERVICE?: string;
  CF_ENVIRONMENT?: string;
  // Resend outbound email (V5).
  RESEND_API_KEY?: string;
  LEADS_FROM?: string;
  OPS_FALLBACK_EMAIL?: string;
  // Sales CRM admin auth (Phase 6 Track A). When unset, /admin/* is disabled
  // (503) so the call queue never leaks. Reached only on the workers.dev URL —
  // the oktryme.com reverse-proxy (§5b) does not forward /admin.
  ADMIN_TOKEN?: string;
  // PostGrid postcard outreach (Phase 5, §1C). The API key lives in the batch
  // script's env, not the Worker; the Worker only needs the webhook secret.
  POSTGRID_WEBHOOK_SECRET?: string;
}

/**
 * Gate an /admin request behind ADMIN_TOKEN (bearer header or `?token=`).
 * Returns a Response to short-circuit (disabled/unauthorized), or null to allow.
 */
function guardAdmin(req: Request, url: URL, env: Env): Response | null {
  if (!env.ADMIN_TOKEN) return new Response("admin disabled", { status: 503 });
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const token = bearer || url.searchParams.get("token") || "";
  // Length-prefixed compare is fine here (token is a shared secret, not user input).
  if (token !== env.ADMIN_TOKEN) return new Response("unauthorized", { status: 401 });
  return null;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Narrow an untrusted string to a PipelineStatus (else undefined = "all"). */
function parseStatus(raw: string | null): PipelineStatus | undefined {
  return raw && (PIPELINE_STATUSES as readonly string[]).includes(raw)
    ? (raw as PipelineStatus)
    : undefined;
}

/** Real Cloudflare provisioner when creds are present, else the stub (V3). */
function buildProvisioner(env: Env): Provisioner {
  if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN && env.CF_WORKER_SERVICE) {
    return new CloudflareProvisioner({
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_API_TOKEN,
      workerService: env.CF_WORKER_SERVICE,
      environment: env.CF_ENVIRONMENT,
    });
  }
  return new StubProvisioner();
}

/** Resend sender when an API key is present, else the no-op logger. */
function buildSender(env: Env): LeadEmailSender {
  if (env.RESEND_API_KEY && env.LEADS_FROM) {
    return new ResendSender({
      apiKey: env.RESEND_API_KEY,
      from: env.LEADS_FROM,
      fallbackTo: env.OPS_FALLBACK_EMAIL,
    });
  }
  return new LogSender();
}

/** Ops notifier (provisioning alerts + DFY intake) — Resend when configured. */
function buildOps(env: Env): OpsNotifier {
  if (env.RESEND_API_KEY && env.LEADS_FROM && env.OPS_FALLBACK_EMAIL) {
    return new ResendOpsNotifier({
      apiKey: env.RESEND_API_KEY,
      from: env.LEADS_FROM,
      to: env.OPS_FALLBACK_EMAIL,
    });
  }
  return new LogOpsNotifier();
}

/**
 * The single Worker (§3 of PLAN.md): renders preview (by path) and live (by
 * custom domain) from one data source, serves the contact form + QR routes +
 * the convert→Checkout flow, and handles Stripe webhooks.
 */
export default {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // Background work (e.g. scan logging) survives the response via waitUntil;
    // tests invoke fetch without a ctx, so fall back to awaiting inline.
    const background = (p: Promise<unknown>): void => {
      if (ctx) ctx.waitUntil(p);
      else void p;
    };
    const store = new KVStore(env.BUSINESS_KV);
    const host = url.hostname;
    const isPreviewHost =
      host === env.PREVIEW_HOST || host === `www.${env.PREVIEW_HOST}`;

    // ---- www → apex 301 (live custom domains only) ----
    // Custom-domain attach covers www. + apex with one cert, but the Worker
    // must send www to the canonical apex (closes the V1-live `www` 404 finding,
    // §5a C.3 / §8). The preview host's own www is left to the path routes.
    if (host.startsWith("www.") && !isPreviewHost) {
      url.hostname = host.slice(4);
      return Response.redirect(url.toString(), 301);
    }

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
      const ops = buildOps(env);
      const result = await handleStripeEvent(JSON.parse(body), {
        store,
        provisioner: buildProvisioner(env),
        prices,
        previewHost: env.PREVIEW_HOST,
        onProvisionFallback: async ({ handle, error, fallbackUrl }) => {
          await ops.notify({
            subject: `⚠️ Provisioning fell back to subdomain — ${handle}`,
            html: `<p>Custom-domain provisioning failed for <strong>${handle}</strong>; the customer is live on <a href="${fallbackUrl ?? ""}">${fallbackUrl ?? "the fallback subdomain"}</a>. Finish the custom domain manually (§5a E).</p><p>Error: ${error}</p>`,
          });
        },
      });
      return Response.json(result);
    }

    // ---- PostGrid delivery webhook → update mail status + advance funnel ----
    // §1C attribution: maps the provider event onto the record's typed `mail`
    // state and advances the CRM funnel to `postcard-sent` (Phase 6). PostGrid
    // can't send custom headers, so the shared secret rides in the webhook URL's
    // `?secret=` query (header also accepted, for manual/test calls).
    if (req.method === "POST" && url.pathname === "/postgrid/webhook") {
      const provided =
        url.searchParams.get("secret") ?? req.headers.get("x-webhook-secret");
      const ok = !env.POSTGRID_WEBHOOK_SECRET || provided === env.POSTGRID_WEBHOOK_SECRET;
      if (!ok) return new Response("bad secret", { status: 401 });
      const result = await handlePostgridWebhook(await req.json(), store);
      return Response.json(result);
    }

    // ---- Sales CRM (Phase 6 Track A / §6) — token-guarded admin call queue ----
    if (url.pathname.startsWith("/admin/")) {
      const denied = guardAdmin(req, url, env);
      if (denied) return denied;

      // Read view: list/filter businesses by pipeline_status (the call queue).
      if (req.method === "GET" && url.pathname === "/admin/crm.json") {
        const filter = parseStatus(url.searchParams.get("status"));
        const records = await store.list();
        return Response.json({
          counts: statusCounts(records),
          rows: buildQueue(records, filter),
        });
      }
      if (req.method === "GET" && url.pathname === "/admin/crm") {
        const filter = parseStatus(url.searchParams.get("status"));
        const records = await store.list();
        return new Response(
          renderCrm(records, { filter, previewHost: env.PREVIEW_HOST }),
          { headers: { "content-type": "text/html;charset=utf-8" } },
        );
      }

      // Manual override for offline events (a phone close, a correction, §6).
      const pipeMatch = url.pathname.match(/^\/admin\/pipeline\/([^/]+)$/);
      if (req.method === "POST" && pipeMatch) {
        const rec = await store.get(pipeMatch[1]);
        if (!rec) return new Response("Not found", { status: 404 });
        const form = await req.formData();
        const status = parseStatus(form.get("status")?.toString() ?? null);
        if (!status) return new Response("invalid status", { status: 400 });
        const note = form.get("note")?.toString();
        setPipelineManual(rec, status, { note: note || "manual override" });
        await store.put(rec);
        return Response.json({ handle: rec.handle, pipeline: rec.pipeline });
      }

      // Record a mail-provider status (manual/ops entry). The provider string is
      // mapped to our typed MailStatus, stored on `mail`, and a send/in-transit/
      // delivered status advances the funnel to postcard-sent.
      const mailMatch = url.pathname.match(/^\/admin\/mail\/([^/]+)$/);
      if (req.method === "POST" && mailMatch) {
        const rec = await store.get(mailMatch[1]);
        if (!rec) return new Response("Not found", { status: 404 });
        const form = await req.formData();
        const status = form.get("status")?.toString();
        if (!status) return new Response("missing status", { status: 400 });
        // Tolerant of raw provider vocab or our own enum — both map to MailStatus.
        applyMailStatus(rec, mapPostgridStatus(status), { note: "manual" });
        await store.put(rec);
        return Response.json({ handle: rec.handle, pipeline: rec.pipeline, mail: rec.mail });
      }

      return new Response("Not found", { status: 404 });
    }

    // ---- Convert: preview CTA → Stripe Checkout ----
    // `?plan=done_for_you` selects the $99 tier; default is $49 self-serve (§5a A).
    const convertMatch = url.pathname.match(/^\/convert\/([^/]+)$/);
    if (req.method === "GET" && convertMatch) {
      const handle = convertMatch[1];
      const rec = await store.get(handle);
      if (!rec) return new Response("Not found", { status: 404 });
      if (!env.STRIPE_SECRET_KEY || !env.PRICE_SELF_SERVE) {
        return new Response("Checkout not configured", { status: 503 });
      }
      const wantsDfy =
        url.searchParams.get("plan") === "done_for_you" && !!env.PRICE_DONE_FOR_YOU;
      const plan: Plan = wantsDfy ? "done_for_you" : "self_serve";
      const priceId = wantsDfy ? env.PRICE_DONE_FOR_YOU! : env.PRICE_SELF_SERVE;
      const previewUrl = `https://${env.PREVIEW_HOST}/p/${handle}`;
      const { url: checkoutUrl } = await createCheckoutSession(
        {
          handle,
          priceId,
          plan,
          successUrl: `${previewUrl}?welcome=1`,
          cancelUrl: previewUrl,
          customerEmail: rec.business.email,
        },
        env.STRIPE_SECRET_KEY,
      );
      return Response.redirect(checkoutUrl, 303);
    }

    // ---- Customer portal: manage subscription ($49→$99 upgrade, cancel) ----
    const portalMatch = url.pathname.match(/^\/portal\/([^/]+)$/);
    if (req.method === "GET" && portalMatch) {
      const handle = portalMatch[1];
      const rec = await store.get(handle);
      if (!rec?.stripe?.customerId) return new Response("Not found", { status: 404 });
      if (!env.STRIPE_SECRET_KEY) {
        return new Response("Portal not configured", { status: 503 });
      }
      const { url: portalUrl } = await createPortalSession(
        rec.stripe.customerId,
        `https://${env.PREVIEW_HOST}/p/${handle}`,
        env.STRIPE_SECRET_KEY,
      );
      return Response.redirect(portalUrl, 303);
    }

    // ---- Done-for-you intake (bridge until the Phase-6 editor) ----
    const dfyMatch = url.pathname.match(/^\/dfy\/([^/]+)$/);
    if (req.method === "POST" && dfyMatch) {
      const res = await handleDfyRequest(
        dfyMatch[1],
        await req.formData(),
        store,
        buildOps(env),
      );
      return res.ok
        ? new Response("Got it — we'll make that change.", { status: 200 })
        : new Response(res.error, { status: 400 });
    }

    // ---- Contact form ----
    const leadMatch = url.pathname.match(/^\/lead\/([^/]+)$/);
    if (req.method === "POST" && leadMatch) {
      const res = await handleLead(
        leadMatch[1],
        await req.formData(),
        store,
        buildSender(env),
      );
      return res.ok
        ? new Response("Thanks — we'll be in touch.", { status: 200 })
        : new Response(res.error, { status: 400 });
    }

    // ---- QR scan redirect: log the scan (the channel's conversion event, §1C)
    //      then 302 to the preview. The KV write runs in waitUntil so the
    //      redirect is instant — a slow log must never make a warm lead wait. ----
    const scanMatch = url.pathname.match(/^\/r\/([^/]+)$/);
    if (req.method === "GET" && scanMatch) {
      const handle = scanMatch[1];
      // The scan is the channel's conversion event (§1C). Do two things, both in
      // the background so a slow store never makes a warm lead wait for the
      // redirect: (1) log the scan event for attribution (§1C); (2) advance the
      // CRM funnel to `qr-code-visit` — the hot signal feeding the scan→call
      // queue (§7 #9). Best-effort: errors are logged, never surfaced.
      background(
        (async () => {
          try {
            await store.logScan(handle, {
              at: new Date().toISOString(),
              ua: req.headers.get("user-agent") ?? undefined,
            });
            const rec = await store.get(handle);
            if (rec && advancePipeline(rec, "qr-code-visit", { note: "qr-scan" })) {
              await store.put(rec);
            }
          } catch (err) {
            console.error(`scan handling failed for ${handle}: ${err}`);
          }
        })(),
      );
      return Response.redirect(`https://${env.PREVIEW_HOST}/p/${handle}`, 302);
    }

    // ---- QR image: scannable SVG of the /r/{handle} short link (§1C).
    //      Referenced by the postcard's `qr_url` merge var; cached at the edge. ----
    const qrMatch = url.pathname.match(/^\/qr\/([^/]+?)(?:\.svg)?$/);
    if (req.method === "GET" && qrMatch && url.pathname.startsWith("/qr/")) {
      const handle = qrMatch[1];
      const svg = renderQrSvg(scanUrl(env.PREVIEW_HOST, handle));
      return new Response(svg, {
        headers: {
          "content-type": "image/svg+xml;charset=utf-8",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    // ---- Site imagery from R2 (category stock / AI-generated / uploads) ----
    const imgMatch = url.pathname.match(/^\/img\/(.+)$/);
    if (req.method === "GET" && imgMatch) {
      const key = imgMatch[1].split("/").map(decodeURIComponent).join("/");
      return serveImage(env.IMAGES, key);
    }

    // ---- Brand landing page (preview host root, e.g. oktryme.com/) ----
    if (req.method === "GET" && isPreviewHost && url.pathname === "/") {
      return renderLanding();
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

    // ---- Live render (by custom domain, or {handle}.<preview-host> fallback) ----
    // The fallback subdomain (§5a D/E) keeps a paid site reachable while its
    // custom domain registers/issues TLS — or indefinitely if provisioning
    // dead-letters to manual. Resolve the handle from the subdomain first, else
    // from the custom-domain map.
    if (req.method === "GET" && !isPreviewHost) {
      const fallbackSuffix = `.${env.PREVIEW_HOST}`;
      const handle = host.endsWith(fallbackSuffix)
        ? host.slice(0, -fallbackSuffix.length)
        : await store.resolveDomain(host);
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
