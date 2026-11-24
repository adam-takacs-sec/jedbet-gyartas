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
<meta name="theme-color" content="#f3f1ec" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16181b" media="(prefers-color-scheme: dark)">
<title>JEDBET kötődoboz</title>
<style>
  :root {
    --bg:#f3f1ec; --card:#ffffff; --ink:#1f2226; --mut:#7b7e83; --line:#e8e5de; --track:#ece9e2;
    --red:#d62828; --warm:#e8590c; --cool:#2f7dd1; --ok:#2e9e5b; --shadow:0 1px 2px rgba(30,30,30,.05), 0 8px 24px rgba(30,30,30,.06);
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16181b; --card:#212429; --ink:#f1efea; --mut:#9a9da1; --line:#2e3237; --track:#2c3036; --shadow:none; }
  }
  * { box-sizing:border-box; }
  html { -webkit-text-size-adjust:100%; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:16px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif;
         padding:max(14px, env(safe-area-inset-top)) 14px max(28px, env(safe-area-inset-bottom)); }
  main { max-width:440px; margin:0 auto; display:grid; gap:12px; }
  header { display:flex; align-items:center; gap:11px; padding:4px 4px 6px; }
  .badge { border-radius:10px; flex:none; }
  .brand { line-height:1.15; }
  .brand b { font-size:17px; letter-spacing:.04em; }
  .brand div { color:var(--mut); font-size:14px; }
  .live { margin-left:auto; display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; color:var(--mut);
          background:var(--card); padding:6px 11px; border-radius:999px; box-shadow:var(--shadow); }
  .live i { width:8px; height:8px; border-radius:50%; background:var(--ok); }
  .live.off i { background:var(--mut); }
  .live:not(.off) i { animation:pulse 2s infinite; }
  @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(46,158,91,.5)} 70%{box-shadow:0 0 0 7px rgba(46,158,91,0)} 100%{box-shadow:0 0 0 0 rgba(46,158,91,0)} }
  .card { background:var(--card); border-radius:22px; padding:18px; box-shadow:var(--shadow); }
  .hero { padding:14px 18px 20px; text-align:center; }
  .gauge { position:relative; width:100%; max-width:300px; margin:0 auto; }
  .gauge svg { width:100%; height:auto; display:block; overflow:visible; }
  .gauge .center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding-top:8px; }
  .temp { font-size:64px; font-weight:700; letter-spacing:-.03em; line-height:1; font-variant-numeric:tabular-nums; }
  .temp sup { font-size:26px; font-weight:600; color:var(--mut); vertical-align:top; position:relative; top:8px; margin-left:2px; }
  .sub { color:var(--mut); font-size:14px; margin-top:6px; min-height:20px; }
  .status { margin-top:4px; font-size:20px; font-weight:650; letter-spacing:-.01em; }
  .status small { display:block; font-size:14px; font-weight:500; color:var(--mut); margin-top:3px; }
  .chips { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; }
  .chip { background:var(--card); border-radius:16px; padding:11px 10px; box-shadow:var(--shadow); text-align:center; }
  .chip .k { color:var(--mut); font-size:12.5px; }
  .chip .v { font-weight:650; font-size:17px; margin-top:2px; font-variant-numeric:tabular-nums; display:flex; align-items:center; justify-content:center; gap:5px; }
  .chip svg { width:16px; height:16px; }
  .flame { color:var(--warm); } .flame.off { color:var(--mut); opacity:.5; }
  .prog-head { display:flex; align-items:baseline; justify-content:space-between; }
  .prog-head h2 { font-size:16px; margin:0; font-weight:650; }
  .prog-head b { font-size:24px; font-variant-numeric:tabular-nums; }
  .bar { height:12px; background:var(--track); border-radius:999px; overflow:hidden; margin:12px 0 10px; }
  .bar i { display:block; height:100%; width:0; border-radius:999px; background:linear-gradient(90deg, #f08c00, var(--warm)); transition:width .8s ease; }
  .bar.done i { background:var(--ok); }
  .eta { color:var(--mut); font-size:15px; }
  .eta b { color:var(--ink); font-weight:650; }
  .chart-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; }
  .chart-head h2 { font-size:16px; margin:0; font-weight:650; }
  .legend { font-size:12.5px; color:var(--mut); display:flex; gap:10px; }
  .legend span::before { content:""; display:inline-block; width:14px; height:0; border-top:2.5px solid var(--warm); vertical-align:middle; margin-right:5px; }
  .legend span.t::before { border-top:2px dashed var(--mut); }
  #chart { width:100%; height:150px; display:block; }
  .foot { text-align:center; color:var(--mut); font-size:13px; padding-top:4px; }
  .warn { color:#d1242f; }
  .idle { text-align:center; color:var(--mut); padding:8px 0 2px; }
</style>
</head>
<body>
<main>
  <header>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="632.5 632.5 1595.0 1595.0" width="40" height="40" aria-hidden="true" class="badge"><rect x="632.5" y="632.5" width="1595.0" height="1595.0" fill="#23262A"/><path d="M797.50,1017.50 L797.50,1842.50 L1017.50,2062.50 L1842.50,2062.50 L2062.50,1842.50 L2062.50,1017.50 L1842.50,797.50 L1017.50,797.50 Z M1808.33,880.00 L1980.00,1051.67 L1980.00,1808.33 L1808.33,1980.00 L1051.67,1980.00 L880.00,1808.33 L880.00,1051.67 L1051.67,880.00 Z" fill="#FFFFFF"/><path d="M880.00,1051.67 L880.00,1808.33 L1051.67,1980.00 L1808.33,1980.00 L1980.00,1808.33 L1980.00,1051.67 L1808.33,880.00 L1051.67,880.00 Z M1785.55,935.00 L1925.00,1074.45 L1925.00,1785.55 L1785.55,1925.00 L1074.45,1925.00 L935.00,1785.55 L935.00,1074.45 L1074.45,935.00 Z" fill="#23262A"/><path d="M1074.45,935.00 L935.00,1074.45 L935.00,1785.55 L1074.45,1925.00 L1785.55,1925.00 L1925.00,1785.55 L1925.00,1074.45 L1785.55,935.00 Z" fill="#23262A"/><path d="M1193.11,1524.29 L1193.11,1430.00 L1054.82,1430.00 L1054.82,1555.71 L1149.11,1650.00 L1227.68,1650.00 L1227.68,1524.29 Z M1262.25,1524.29 L1262.25,1650.00 L1306.25,1650.00 L1400.54,1555.71 L1400.54,1210.00 L1079.96,1210.00 L1079.96,1329.43 L1262.25,1329.43 L1262.25,1452.00 Z" fill="#FFFFFF"/><path d="M1717.18,1650.00 L1805.18,1562.00 L1805.18,1463.94 L1750.49,1419.94 L1792.61,1386.63 L1792.61,1298.00 L1704.61,1210.00 L1600.89,1210.00 L1600.89,1316.86 L1651.18,1316.86 L1651.18,1382.86 L1600.89,1382.86 L1600.89,1470.86 L1660.61,1470.86 L1660.61,1543.14 L1600.89,1543.14 L1600.89,1650.00 Z M1428.04,1210.00 L1428.04,1650.00 L1566.32,1650.00 L1566.32,1543.14 L1566.32,1470.86 L1566.32,1382.86 L1566.32,1316.86 L1566.32,1210.00 Z" fill="#D62828"/></svg>
    <div class="brand"><b>JEDBET</b><div>Kötődoboz</div></div>
    <span class="live off" id="live"><i></i><span id="live-t">Csatlakozás…</span></span>
  </header>

  <section class="card hero">
    <div class="gauge">
      <svg viewBox="0 0 240 200" id="gauge" aria-hidden="true"></svg>
      <div class="center">
        <div class="temp" id="t">–<sup>°C</sup></div>
        <div class="sub" id="range"></div>
      </div>
    </div>
    <div class="status" id="st">Betöltés…<small></small></div>
  </section>

  <section class="chips">
    <div class="chip"><div class="k">Fűtés</div><div class="v" id="heat">–</div></div>
    <div class="chip"><div class="k">Cél</div><div class="v" id="target">–</div></div>
    <div class="chip"><div class="k">Kint</div><div class="v" id="out">–</div></div>
  </section>

  <section class="card" id="prog-card" hidden>
    <div class="prog-head"><h2>A beton kötése</h2><b id="pct">–</b></div>
    <div class="bar" id="bar"><i></i></div>
    <div class="eta" id="eta"></div>
  </section>

  <section class="card">
    <div class="chart-head"><h2>Az elmúlt 6 óra</h2><div class="legend"><span>doboz</span><span class="t">cél</span></div></div>
    <svg id="chart" viewBox="0 0 320 150" aria-label="Hőmérséklet az elmúlt 6 órában"></svg>
  </section>

  <p class="foot" id="foot"></p>
</main>
<script>
const key = new URLSearchParams(location.search).get('k') || '';
const $ = (id) => document.getElementById(id);
const f1 = (n) => n === null || n === undefined ? '–' : n.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hm = (d) => new Date(d).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const FLAME = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5-1.5 5.2-3 7.2C7.5 11.1 6.5 13 6.5 15a5.5 5.5 0 0 0 11 0c0-2.6-1.4-4.4-2.6-5.7.1 1.6-.5 2.9-1.6 3.4.4-3.9-.4-7.6-1.3-10.7z"/></svg>';
const PH = {
  varakozas: ['Pihen a beton', 'Az öntés után még nem fűtünk'],
  felfutes:  ['Lassan melegítjük', 'Fokozatosan emeljük a hőmérsékletet'],
  tartas:    ['Melegen tartjuk', 'A beton szépen köt'],
  hutes:     ['Hűl, mindjárt kész', 'Kivétel előtt kicsit lehűtjük'],
  kesz:      ['Kész, kivehető', 'A beton elérte a szükséges szilárdságot'],
};
let lastOk = 0;

function polar(cx, cy, r, a) { const t = (a - 90) * Math.PI / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; }
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
}
function gauge(temp, target) {
  const LO = 0, HI = 45, A0 = -125, A1 = 125, cx = 120, cy = 118, r = 96;
  const ang = (v) => A0 + (Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO) * (A1 - A0);
  let s = '<defs><linearGradient id="gg" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="' + css('--cool') + '"/><stop offset=".55" stop-color="#f08c00"/><stop offset="1" stop-color="' + css('--red') + '"/></linearGradient></defs>';
  s += '<path d="' + arc(cx, cy, r, A0, A1) + '" fill="none" stroke="' + css('--track') + '" stroke-width="14" stroke-linecap="round"/>';
  if (temp !== null) s += '<path d="' + arc(cx, cy, r, A0, Math.max(A0 + 0.5, ang(temp))) + '" fill="none" stroke="url(#gg)" stroke-width="14" stroke-linecap="round"/>';
  if (target !== null && target !== undefined) {
    const [x0, y0] = polar(cx, cy, r - 13, ang(target)), [x1, y1] = polar(cx, cy, r + 13, ang(target));
    s += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y1 + '" stroke="' + css('--ink') + '" stroke-width="3" stroke-linecap="round"/>';
    const [tx, ty] = polar(cx, cy, r + 26, ang(target));
    s += '<text x="' + tx + '" y="' + (ty + 4) + '" text-anchor="middle" font-size="11" font-weight="600" fill="' + css('--mut') + '">' + Math.round(target) + '°</text>';
  }
  for (const v of [LO, HI]) { const [x, y] = polar(cx, cy, r, ang(v)); s += '<text x="' + x + '" y="' + (y + 24) + '" text-anchor="middle" font-size="11" fill="' + css('--mut') + '">' + v + '°</text>'; }
  $('gauge').innerHTML = s;
}

function chart(pts, target) {
  const svg = $('chart');
  if (!pts.length) { svg.innerHTML = '<text x="160" y="80" text-anchor="middle" font-size="13" fill="' + css('--mut') + '">Még nincs adat</text>'; return; }
  const W = 320, H = 150, L = 26, R = 6, T = 8, B = 22;
  const t1 = Date.now(), t0 = t1 - 6 * 3600e3;
  const vs = pts.map((p) => p.t);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (target !== null && target !== undefined) { lo = Math.min(lo, target); hi = Math.max(hi, target); }
  const step = hi - lo > 20 ? 10 : 5;
  lo = Math.floor((lo - 1) / step) * step; hi = Math.ceil((hi + 1) / step) * step;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const P = pts.map((p) => [x(Date.parse(p.ts)), y(p.t)]);
  let d = 'M' + P[0][0].toFixed(1) + ' ' + P[0][1].toFixed(1);
  for (let i = 1; i < P.length; i++) { const mx = (P[i - 1][0] + P[i][0]) / 2; d += ' C' + mx.toFixed(1) + ' ' + P[i - 1][1].toFixed(1) + ' ' + mx.toFixed(1) + ' ' + P[i][1].toFixed(1) + ' ' + P[i][0].toFixed(1) + ' ' + P[i][1].toFixed(1); }
  const area = d + ' L' + P[P.length - 1][0].toFixed(1) + ' ' + (H - B) + ' L' + P[0][0].toFixed(1) + ' ' + (H - B) + ' Z';
  const mut = css('--mut'), line = css('--line'), warm = css('--warm');
  let s = '<defs><linearGradient id="ca" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + warm + '" stop-opacity=".28"/><stop offset="1" stop-color="' + warm + '" stop-opacity="0"/></linearGradient></defs>';
  for (let v = lo; v <= hi; v += step) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="' + line + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="10" fill="' + mut + '">' + v + '°</text>';
  for (let h = 6; h >= 0; h -= 2) { const t = t1 - h * 3600e3; s += '<text x="' + x(t) + '" y="' + (H - 5) + '" text-anchor="' + (h === 0 ? 'end' : h === 6 ? 'start' : 'middle') + '" font-size="10" fill="' + mut + '">' + (h === 0 ? 'most' : hm(t)) + '</text>'; }
  if (target !== null && target !== undefined) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(target) + '" y2="' + y(target) + '" stroke="' + mut + '" stroke-width="1.5" stroke-dasharray="4 4"/>';
  s += '<path d="' + area + '" fill="url(#ca)"/><path d="' + d + '" fill="none" stroke="' + warm + '" stroke-width="2.5" stroke-linecap="round"/>';
  const lp = P[P.length - 1]; s += '<circle cx="' + lp[0] + '" cy="' + lp[1] + '" r="4" fill="' + warm + '" stroke="' + css('--card') + '" stroke-width="2"/>';
  svg.innerHTML = s;
}

function etaText(hours) {
  const d = new Date(Date.now() + hours * 3600e3), now = new Date();
  const day = d.toDateString() === now.toDateString() ? 'ma' : new Date(now.getTime() + 864e5).toDateString() === d.toDateString() ? 'holnap' : d.toLocaleDateString('hu-HU', { weekday: 'long' });
  return day + ' ' + hm(d) + ' körül';
}

async function load() {
  try {
    const r = await fetch('/device/elo/data?k=' + encodeURIComponent(key), { cache: 'no-store' });
    if (r.status === 403) { $('st').innerHTML = 'Ez a link már nem érvényes.<small>Kérj újat Ádámtól.</small>'; $('live').className = 'live off'; $('live-t').textContent = 'Nem elérhető'; return; }
    const d = await r.json();
    lastOk = Date.now();
    const target = d.active ? d.target : null;
    $('t').innerHTML = f1(d.temp) + '<sup>°C</sup>';
    $('range').textContent = d.min !== null && d.max !== null && d.max - d.min >= 1 ? f1(d.min) + ' – ' + f1(d.max) + ' °C a doboz pontjain' : 'a doboz átlaga';
    gauge(d.temp, target);
    const live = $('live');
    if (d.stale) { live.className = 'live off'; $('live-t').textContent = 'Nincs friss adat'; }
    else { live.className = 'live'; $('live-t').textContent = 'Élő · ' + hm(d.temp_at); }
    let st;
    if (d.stale && d.active) st = ['<span class="warn">Nem jön adat a dobozból</span>', 'Utolsó mérés: ' + (d.temp_at ? hm(d.temp_at) : '–')];
    else if (!d.active) st = ['Most nincs kötés', 'A doboz pihen'];
    else st = PH[d.phase] || ['', ''];
    $('st').innerHTML = st[0] + '<small>' + st[1] + '</small>';
    $('heat').innerHTML = '<span class="flame' + (d.heater ? '' : ' off') + '">' + FLAME + '</span>' + (d.heater ? 'Megy' : d.fan ? 'Szellőz' : 'Áll');
    $('target').textContent = target === null || target === undefined ? '–' : Math.round(target) + ' °C';
    $('out').textContent = d.outside === null ? '–' : f1(d.outside) + ' °C';
    $('prog-card').hidden = !d.active;
    if (d.active) {
      const done = d.ready || d.phase === 'kesz';
      const pct = done ? 100 : Math.min(99, Math.round((d.progress || 0) * 100));
      $('pct').textContent = pct + '%';
      $('bar').className = 'bar' + (done ? ' done' : '');
      $('bar').firstElementChild.style.width = pct + '%';
      $('eta').innerHTML = done ? '<b style="color:var(--ok)">Kész ✓</b> A beton kivehető.'
        : d.hours_left !== null ? 'Várhatóan <b>' + etaText(d.hours_left) + '</b> lesz kész.' : '';
    }
    chart(d.series || [], target);
    $('foot').textContent = 'Fél percenként magától frissül.';
  } catch {
    $('live').className = 'live off'; $('live-t').textContent = 'Nincs kapcsolat';
    $('foot').innerHTML = '<span class="warn">Nincs kapcsolat, újrapróbálom…</span>';
  }
}
load();
setInterval(() => { if (!document.hidden) load(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', load);
</script>
</body>
</html>`;
