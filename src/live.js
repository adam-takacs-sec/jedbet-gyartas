// Egyszerű, csak olvasható élő nézet a kötődobozról (pl. a családnak, telefonra).
// Belépés nélkül, egy titkos kulccsal a linkben érhető el: /device/elo?k=<kulcs>.
// A /device/* útvonal már Access-bypassos (a Pi miatt), ezért itt nincs szükség új szabályra;
// a Pi tokenjét ez az oldal nem ismeri és nem fogadja el, csak a saját kulcsát.

export function livePage() {
  return new Response(HTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
    },
  });
}

const HTML = `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#151515">
<title>Kötődoboz – élő</title>
<style>
  :root { --bg:#151515; --card:#212121; --fg:#f2f2f2; --mut:#9a9a9a; --red:#d6332f; --ok:#3fb950; --warm:#f0883e; --cold:#58a6ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.4 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
         padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom)); }
  main { max-width:480px; margin:0 auto; display:grid; gap:14px; }
  header { display:flex; align-items:center; justify-content:space-between; }
  header b { letter-spacing:.06em; } header b span { color:var(--red); }
  .card { background:var(--card); border-radius:18px; padding:18px; }
  .big { text-align:center; padding:26px 18px; }
  .lbl { color:var(--mut); font-size:15px; }
  .temp { font-size:76px; font-weight:700; line-height:1; margin:8px 0 6px; font-variant-numeric:tabular-nums; }
  .temp small { font-size:32px; font-weight:600; color:var(--mut); }
  .state { display:inline-flex; align-items:center; gap:8px; font-weight:600; font-size:19px; margin-top:10px; }
  .dot { width:12px; height:12px; border-radius:50%; background:var(--mut); }
  .dot.on { background:var(--warm); box-shadow:0 0 10px var(--warm); animation:p 1.6s infinite; }
  .dot.fan { background:var(--cold); }
  .dot.done { background:var(--ok); }
  @keyframes p { 50% { opacity:.45; } }
  .bar { height:14px; background:#333; border-radius:8px; overflow:hidden; margin:10px 0 6px; }
  .bar i { display:block; height:100%; background:var(--ok); width:0; transition:width .6s; }
  .row { display:flex; justify-content:space-between; gap:10px; padding:6px 0; }
  .row + .row { border-top:1px solid #2e2e2e; }
  .row b { font-variant-numeric:tabular-nums; }
  svg { width:100%; height:110px; display:block; }
  .foot { text-align:center; color:var(--mut); font-size:14px; }
  .warn { color:#ff7b72; }
  .ready { color:var(--ok); font-weight:700; font-size:20px; }
</style>
</head>
<body>
<main>
  <header><b>JEDBET <span>●</span> kötődoboz</b><span class="lbl" id="upd">…</span></header>

  <section class="card big">
    <div class="lbl">Hőmérséklet a dobozban</div>
    <div class="temp" id="t">–<small> °C</small></div>
    <div class="lbl" id="range"></div>
    <div class="state"><span class="dot" id="dot"></span><span id="st">Betöltés…</span></div>
  </section>

  <section class="card" id="prog-card" hidden>
    <div class="row" style="padding-top:0"><span>Beton kötése</span><b id="pct">–</b></div>
    <div class="bar"><i id="bar"></i></div>
    <div class="lbl" id="left"></div>
  </section>

  <section class="card">
    <div class="lbl" style="margin-bottom:6px">Az elmúlt 6 óra</div>
    <svg id="chart" viewBox="0 0 300 110" preserveAspectRatio="none" aria-label="Hőmérséklet grafikon"></svg>
    <div class="row"><span>Cél most</span><b id="target">–</b></div>
    <div class="row"><span>Kint</span><b id="out">–</b></div>
  </section>

  <p class="foot" id="foot">Magától frissül.</p>
</main>
<script>
const key = new URLSearchParams(location.search).get('k') || '';
const $ = (id) => document.getElementById(id);
const f1 = (n) => n === null || n === undefined ? '–' : n.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hm = (iso) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
const PH = { varakozas: 'Pihen, mielőtt fűtenénk', felfutes: 'Lassan melegítjük', tartas: 'Melegen tartjuk', hutes: 'Hűl, mindjárt kész', kesz: 'Kész, kivehető' };

function chart(pts, target) {
  const svg = $('chart');
  if (!pts.length) { svg.innerHTML = ''; return; }
  const ts = pts.map((p) => Date.parse(p.ts)), vs = pts.map((p) => p.t);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (target !== null) { lo = Math.min(lo, target); hi = Math.max(hi, target); }
  lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1);
  const t0 = Date.now() - 6 * 3600e3, t1 = Date.now();
  const x = (t) => ((t - t0) / (t1 - t0)) * 300, y = (v) => 104 - ((v - lo) / (hi - lo)) * 98;
  const d = pts.map((p, i) => (i ? 'L' : 'M') + x(ts[i]).toFixed(1) + ' ' + y(vs[i]).toFixed(1)).join(' ');
  let g = '';
  for (const v of [lo + 1, Math.round((lo + hi) / 2), hi - 1]) g += '<line x1="0" x2="300" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#333" stroke-width="1" vector-effect="non-scaling-stroke"/><text x="2" y="' + (y(v) - 3) + '" fill="#777" font-size="9">' + v + '°</text>';
  if (target !== null) g += '<line x1="0" x2="300" y1="' + y(target) + '" y2="' + y(target) + '" stroke="#f0883e" stroke-dasharray="4 4" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
  svg.innerHTML = g + '<path d="' + d + '" fill="none" stroke="#f2f2f2" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
}

async function load() {
  try {
    const r = await fetch('/device/elo/data?k=' + encodeURIComponent(key), { cache: 'no-store' });
    if (r.status === 403) { $('st').textContent = 'Ez a link már nem érvényes.'; $('foot').textContent = ''; return; }
    const d = await r.json();
    $('upd').textContent = d.temp_at ? 'mérés ' + hm(d.temp_at) : '';
    $('t').innerHTML = f1(d.temp) + '<small> °C</small>';
    $('range').textContent = d.min !== null && d.max !== null && d.max - d.min >= 1 ? 'leghidegebb ' + f1(d.min) + ' · legmelegebb ' + f1(d.max) + ' °C' : '';
    const dot = $('dot');
    dot.className = 'dot' + (d.heater ? ' on' : d.fan ? ' fan' : d.phase === 'kesz' ? ' done' : '');
    let st;
    if (!d.active) st = 'Most nem megy kötés';
    else if (d.stale) st = '<span class="warn">Nem jön adat a dobozból</span>';
    else st = (PH[d.phase] || '') + (d.heater ? ' · fűtés be' : d.fan ? ' · szellőztet' : '');
    $('st').innerHTML = st;
    $('prog-card').hidden = !d.active;
    if (d.active) {
      const pct = Math.min(100, Math.round((d.progress || 0) * 100));
      $('pct').textContent = pct + '%';
      $('bar').style.width = pct + '%';
      $('left').innerHTML = d.ready || d.phase === 'kesz' ? '<span class="ready">Kész a beton ✓</span>'
        : d.hours_left !== null ? 'Még kb. ' + Math.max(1, Math.round(d.hours_left)) + ' óra' : '';
    }
    $('target').textContent = d.target === null || d.target === undefined ? '–' : f1(d.target) + ' °C';
    $('out').textContent = d.outside === null ? '–' : f1(d.outside) + ' °C';
    chart(d.series || [], d.active ? d.target : null);
    $('foot').textContent = 'Magától frissül · ' + new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  } catch { $('foot').innerHTML = '<span class="warn">Nincs kapcsolat, próbálom újra…</span>'; }
}
load();
setInterval(() => { if (!document.hidden) load(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
</script>
</body>
</html>`;
