// Brand landing page served at the preview host root (`oktryme.com/`).
//
// After the §5b cutover moves the oktryme.com zone into the dedicated account
// and the apex is attached to this Worker, `/` serves this page (the standalone
// `oktryme-landing` Worker + its `oktryme.com/*` route in the old account are
// then retired). Preview/live routes (`/p/`, `/r/`, custom domains) are
// unaffected — this only answers the bare root of the preview host.

const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ok, Try Me — High-Performance Business Websites</title>
<meta name="description" content="Ok, Try Me builds high-performance websites for businesses. Get in touch: hello@oktryme.com">
<meta name="theme-color" content="#0b1220">
<meta property="og:title" content="Ok, Try Me">
<meta property="og:description" content="High-Performance Business Websites">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✅</text></svg>">
<style>
  :root{
    --bg:#0b1220; --ink:#f4f7fb; --muted:#9fb0c9;
    --accent:#ffd400; --accent-ink:#1a1a1a; --ring:rgba(255,212,0,.35);
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:
      radial-gradient(1100px 600px at 50% -10%, #1b2a4a 0%, rgba(27,42,74,0) 60%),
      linear-gradient(180deg,#0b1220 0%, #0a0f1b 100%);
    display:flex; flex-direction:column; min-height:100%;
    -webkit-font-smoothing:antialiased;
  }
  main{flex:1; display:flex; align-items:center; justify-content:center; padding:7vh 1.25rem}
  .card{width:100%; max-width:640px; text-align:center}
  .eyebrow{
    display:inline-block; letter-spacing:.18em; text-transform:uppercase;
    font-size:.72rem; font-weight:700; color:var(--accent-ink);
    background:var(--accent); padding:.32rem .6rem; border-radius:999px; margin-bottom:1.6rem;
  }
  h1{font-size:clamp(2.6rem,9vw,4.6rem); line-height:1.02; margin:0 0 .5rem; font-weight:800; letter-spacing:-.02em}
  h1 .dot{color:var(--accent)}
  .tagline{font-size:clamp(1.05rem,3.4vw,1.5rem); color:var(--muted); margin:0 auto 2.4rem; max-width:30ch; font-weight:500}
  .cta{
    display:inline-flex; align-items:center; gap:.55rem;
    background:var(--accent); color:var(--accent-ink); text-decoration:none;
    font-weight:700; font-size:1.02rem; padding:.85rem 1.4rem; border-radius:12px;
    transition:transform .12s ease, box-shadow .12s ease; box-shadow:0 10px 30px -12px var(--ring);
  }
  .cta:hover{transform:translateY(-2px); box-shadow:0 16px 36px -12px var(--ring)}
  .cta:focus-visible{outline:3px solid var(--ring); outline-offset:3px}
  .contact-note{margin-top:1rem; color:var(--muted); font-size:.92rem}
  .contact-note a{color:var(--ink); text-decoration:underline; text-underline-offset:3px}
  footer{text-align:center; color:var(--muted); font-size:.8rem; padding:1.6rem 1.25rem 2.2rem}
</style>
</head>
<body>
  <main>
    <div class="card">
      <span class="eyebrow">Now building</span>
      <h1>Ok, Try Me<span class="dot">.</span></h1>
      <p class="tagline">High-Performance Business Websites</p>
      <a class="cta" href="mailto:hello@oktryme.com">Get in touch →</a>
      <p class="contact-note">or email us at <a href="mailto:hello@oktryme.com">hello@oktryme.com</a></p>
    </div>
  </main>
  <footer>© 2026 Multiply Technologies LLC DBA Ok, Try Me</footer>
</body>
</html>`;

/** The brand landing page response for the preview host root. */
export function renderLanding(): Response {
  return new Response(LANDING_HTML, {
    headers: {
      "content-type": "text/html;charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
