import type { BusinessRecord } from "../types.js";
import { DAYS_OF_WEEK } from "../types.js";

export type RenderMode = "preview" | "live";

/** HTML-escape untrusted text before interpolation. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function heroSection(rec: BusinessRecord): string {
  const { business, images } = rec;
  const style = images.hero
    ? ` style="background-image:url('${escapeHtml(images.hero)}')"`
    : "";
  return `
  <header class="hero"${style}>
    <div class="hero__overlay">
      <h1>${escapeHtml(business.name)}</h1>
      <p class="hero__tagline">${escapeHtml(business.category)} · ${escapeHtml(business.address.city)}, ${escapeHtml(business.address.state)}</p>
      <a class="btn btn--primary" href="#contact">Request a Quote</a>
    </div>
  </header>`;
}

function aboutSection(rec: BusinessRecord): string {
  const copy = rec.business.about ?? rec.business.description;
  if (!copy) return "";
  return `
  <section class="about" id="about">
    <h2>About Us</h2>
    <p>${escapeHtml(copy)}</p>
  </section>`;
}

function servicesSection(rec: BusinessRecord): string {
  if (rec.services.length === 0) return "";
  const items = rec.services
    .map(
      (s) => `
      <li class="service">
        <h3>${escapeHtml(s.name)}</h3>
        ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ""}
      </li>`,
    )
    .join("");
  return `
  <section class="services" id="services">
    <h2>Services</h2>
    <ul class="services__grid">${items}</ul>
  </section>`;
}

function reviewsSection(rec: BusinessRecord): string {
  if (rec.reviews.length === 0) return "";
  const items = rec.reviews
    .map((r) => {
      const stars = "★".repeat(Math.max(0, Math.min(5, Math.round(r.rating))));
      return `
      <li class="review">
        <span class="review__stars" aria-label="${r.rating} out of 5">${stars}</span>
        <p class="review__text">${escapeHtml(r.text)}</p>
        <p class="review__author">— ${escapeHtml(r.author)}</p>
      </li>`;
    })
    .join("");
  return `
  <section class="reviews" id="reviews">
    <h2>What Customers Say</h2>
    <ul class="reviews__list">${items}</ul>
  </section>`;
}

function hoursSection(rec: BusinessRecord): string {
  const rows = DAYS_OF_WEEK.filter((d) => rec.business.hours[d])
    .map(
      (d) =>
        `<tr><th scope="row">${d[0].toUpperCase() + d.slice(1)}</th><td>${escapeHtml(rec.business.hours[d]!)}</td></tr>`,
    )
    .join("");
  if (!rows) return "";
  return `
  <section class="hours" id="hours">
    <h2>Hours</h2>
    <table class="hours__table"><tbody>${rows}</tbody></table>
  </section>`;
}

function contactSection(rec: BusinessRecord): string {
  const { business, handle } = rec;
  const addr = business.address;
  return `
  <section class="contact" id="contact">
    <h2>Get in Touch</h2>
    <p class="contact__address">
      ${escapeHtml(addr.line1)}${addr.line2 ? ", " + escapeHtml(addr.line2) : ""}<br>
      ${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} ${escapeHtml(addr.zip)}<br>
      <a href="tel:${escapeHtml(business.phone)}">${escapeHtml(business.phone)}</a>
    </p>
    <form class="lead-form" method="POST" action="/lead/${escapeHtml(handle)}">
      <input type="text" name="name" placeholder="Your name" required>
      <input type="tel" name="phone" placeholder="Your phone" required>
      <textarea name="message" placeholder="How can we help?" required></textarea>
      <button class="btn btn--primary" type="submit">Request a Quote</button>
    </form>
  </section>`;
}

function previewBanner(rec: BusinessRecord): string {
  return `
  <div class="preview-banner" role="region" aria-label="Preview notice">
    <span class="preview-banner__label">PREVIEW</span>
    <span>This site was built for ${escapeHtml(rec.business.name)}. Make it yours.</span>
    <a class="btn btn--cta" href="/convert/${escapeHtml(rec.handle)}">Make This My Website</a>
  </div>`;
}

const BASE_CSS = `
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.5}
  h1,h2,h3{line-height:1.2}h2{margin-top:0}
  .hero{position:relative;min-height:60vh;display:flex;align-items:center;justify-content:center;background:#222 center/cover no-repeat;color:#fff;text-align:center;padding:4rem 1rem}
  .hero__overlay{background:rgba(0,0,0,.45);padding:2rem;border-radius:12px}.hero h1{font-size:2.5rem;margin:0 0 .5rem}
  .btn{display:inline-block;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;border:0;cursor:pointer}
  .btn--primary{background:#1565c0;color:#fff}.btn--cta{background:#111;color:#fff}
  section{max-width:960px;margin:0 auto;padding:3rem 1.25rem}
  .services__grid,.reviews__list{list-style:none;padding:0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
  .service,.review{background:#f6f7f9;padding:1.25rem;border-radius:10px}
  .review__stars{color:#f5a623}.hours__table{width:100%;max-width:360px;border-collapse:collapse}
  .hours__table th,.hours__table td{text-align:left;padding:.4rem .75rem;border-bottom:1px solid #eee}
  .lead-form{display:grid;gap:.75rem;max-width:420px}.lead-form input,.lead-form textarea{padding:.7rem;border:1px solid #ccc;border-radius:8px;font:inherit}
  .preview-banner{position:sticky;top:0;z-index:10;background:#ffd400;color:#1a1a1a;display:flex;gap:1rem;align-items:center;justify-content:center;flex-wrap:wrap;padding:.6rem 1rem;font-weight:600}
  .preview-banner__label{background:#1a1a1a;color:#ffd400;padding:.15rem .5rem;border-radius:4px;font-size:.8rem;letter-spacing:.05em}
`;

/**
 * Render a complete static HTML page from a `business.json` record.
 * Preview mode adds the yellow banner + CTA and a `noindex` directive
 * (preview sites must never be indexed — §3b / §11 of PLAN.md).
 * Live mode hides the banner and is indexable.
 */
export function renderSite(rec: BusinessRecord, mode: RenderMode): string {
  const robots =
    mode === "preview"
      ? `<meta name="robots" content="noindex,nofollow">`
      : `<meta name="robots" content="index,follow">`;
  const banner = mode === "preview" ? previewBanner(rec) : "";
  const title =
    mode === "preview"
      ? `${rec.business.name} — Preview`
      : `${rec.business.name} — ${rec.business.category} in ${rec.business.address.city}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  ${robots}
  <title>${escapeHtml(title)}</title>
  <style>${BASE_CSS}</style>
</head>
<body data-mode="${mode}" data-handle="${escapeHtml(rec.handle)}">
  ${banner}
  ${heroSection(rec)}
  <main>
    ${aboutSection(rec)}
    ${servicesSection(rec)}
    ${reviewsSection(rec)}
    ${hoursSection(rec)}
    ${contactSection(rec)}
  </main>
  <footer><p>© ${escapeHtml(rec.business.name)}</p></footer>
</body>
</html>`;
}
