import type { BusinessRecord } from "../types.js";
import { DAYS_OF_WEEK } from "../types.js";
import { selectTheme, type Theme } from "./themes.js";
import { resolveImageUrl } from "../images/r2.js";

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

function heroSection(rec: BusinessRecord, theme: Theme): string {
  const { business, images } = rec;
  // An explicit image overrides the theme's placeholder gradient via the
  // `--hero-bg` custom property (set in :root, see baseCss); absent an image
  // the gradient shows through, so a hero is never blank.
  const heroUrl = resolveImageUrl(images.hero);
  const style = heroUrl
    ? ` style="--hero-bg:url('${escapeHtml(heroUrl)}')"`
    : "";
  return `
  <header class="hero"${style}>
    <div class="hero__overlay">
      <h1>${escapeHtml(business.name)}</h1>
      <p class="hero__tagline">${escapeHtml(business.category)} · ${escapeHtml(business.address.city)}, ${escapeHtml(business.address.state)}</p>
      <a class="btn btn--primary" href="#contact">${escapeHtml(theme.ctaLabel)}</a>
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

function contactSection(rec: BusinessRecord, theme: Theme): string {
  const { business, handle } = rec;
  const addr = business.address;
  // Labels are present for screen readers but visually hidden (the design
  // relies on placeholders); inputs stay keyboard- and assistive-tech-friendly.
  return `
  <section class="contact" id="contact">
    <h2>Get in Touch</h2>
    <p class="contact__address">
      ${escapeHtml(addr.line1)}${addr.line2 ? ", " + escapeHtml(addr.line2) : ""}<br>
      ${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} ${escapeHtml(addr.zip)}<br>
      <a href="tel:${escapeHtml(business.phone)}">${escapeHtml(business.phone)}</a>
    </p>
    <form class="lead-form" method="POST" action="/lead/${escapeHtml(handle)}">
      <label class="visually-hidden" for="lead-name">Your name</label>
      <input id="lead-name" type="text" name="name" placeholder="Your name" autocomplete="name" required>
      <label class="visually-hidden" for="lead-phone">Your phone</label>
      <input id="lead-phone" type="tel" name="phone" placeholder="Your phone" autocomplete="tel" required>
      <label class="visually-hidden" for="lead-message">How can we help?</label>
      <textarea id="lead-message" name="message" placeholder="How can we help?" required></textarea>
      <button class="btn btn--primary" type="submit">${escapeHtml(theme.ctaLabel)}</button>
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

/**
 * CSS for the page. Theme palette + hero placeholder are injected as custom
 * properties on :root so a single stylesheet skins every trade variant.
 */
function baseCss(theme: Theme): string {
  return `
  :root{--accent:${theme.accent};--accent-dark:${theme.accentDark};--hero-bg:${theme.heroGradient}}
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.5}
  h1,h2,h3{line-height:1.2}h2{margin-top:0}
  a{color:var(--accent-dark)}
  :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
  .visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .hero{position:relative;min-height:60vh;display:flex;align-items:center;justify-content:center;background:var(--hero-bg) #222 center/cover no-repeat;color:#fff;text-align:center;padding:4rem 1rem}
  .hero__overlay{background:rgba(0,0,0,.45);padding:2rem;border-radius:12px;max-width:90%}.hero h1{font-size:clamp(1.8rem,5vw,2.5rem);margin:0 0 .5rem}
  .hero__tagline{margin:0 0 1.25rem;font-size:1.05rem}
  .btn{display:inline-block;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;border:0;cursor:pointer;font:inherit;font-weight:600}
  .btn--primary{background:var(--accent);color:#fff}.btn--primary:hover{background:var(--accent-dark)}.btn--cta{background:#111;color:#fff}
  section{max-width:960px;margin:0 auto;padding:3rem 1.25rem}
  .services__grid,.reviews__list{list-style:none;padding:0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
  .service,.review{background:#f6f7f9;padding:1.25rem;border-radius:10px}
  .review__stars{color:#f5a623}.hours__table{width:100%;max-width:360px;border-collapse:collapse}
  .hours__table th,.hours__table td{text-align:left;padding:.4rem .75rem;border-bottom:1px solid #eee}
  .lead-form{display:grid;gap:.75rem;max-width:420px}.lead-form input,.lead-form textarea{padding:.7rem;border:1px solid #ccc;border-radius:8px;font:inherit;width:100%}
  .lead-form textarea{min-height:120px;resize:vertical}
  footer{text-align:center;padding:2rem 1rem;color:#666;font-size:.9rem}
  .preview-banner{position:sticky;top:0;z-index:10;background:#ffd400;color:#1a1a1a;display:flex;gap:1rem;align-items:center;justify-content:center;flex-wrap:wrap;padding:.6rem 1rem;font-weight:600}
  .preview-banner__label{background:#1a1a1a;color:#ffd400;padding:.15rem .5rem;border-radius:4px;font-size:.8rem;letter-spacing:.05em}
`;
}

/**
 * Render a complete static HTML page from a `business.json` record.
 * The trade theme is chosen from the business category (§7 #2); preview mode
 * adds the yellow banner + CTA and a `noindex` directive (preview sites must
 * never be indexed — §3b / §11 of PLAN.md). Live mode hides the banner and is
 * indexable. One code path drives both, so preview and live never drift.
 */
export function renderSite(rec: BusinessRecord, mode: RenderMode): string {
  const theme = selectTheme(rec.business.category);
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
  <style>${baseCss(theme)}</style>
</head>
<body data-mode="${mode}" data-handle="${escapeHtml(rec.handle)}" data-theme="${theme.key}">
  ${banner}
  ${heroSection(rec, theme)}
  <main>
    ${aboutSection(rec)}
    ${servicesSection(rec)}
    ${reviewsSection(rec)}
    ${hoursSection(rec)}
    ${contactSection(rec, theme)}
  </main>
  <footer><p>© ${escapeHtml(rec.business.name)}</p></footer>
</body>
</html>`;
}
