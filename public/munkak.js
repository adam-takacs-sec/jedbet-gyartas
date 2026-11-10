// Munkák: projektek telekkel (műholdtérképen), a szakaszok a telek oldalaihoz kötve,
// alatta szakaszonként kiterítve, húzható „idáig kész” jelölővel.
import { $, $$, esc, fmt, ft, api, toast } from './lib.js';

const js = {
  templates: [], jobs: [], filter: 'Aktív', selected: null, detail: null, job: null,
  editingStage: null, editingJob: false,
  map: null, mode: 'view', draft: null, layers: null, autoSearched: new Set(),
};
try { js.filter = localStorage.getItem('jobFilter') ?? 'Aktív'; } catch {}

const RED = '#d62828';
const TPL_ACCENT = { 'Mediterrán': '#d4a72c', 'Homokkő': '#c06b3e', 'Hullám': '#3d8fd1' };
const SIDE = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');
const BANA = [47.6525, 17.9205];

// 2 m = 1 oszlopköz = 4 panel; szakaszonként 2 végoszlop (ugyanaz, mint a szerveren).
const stageCalc = (len) => {
  const spans = Math.max(1, Math.ceil(len / 2 - 1e-9));
  return { spans, panels: spans * 4, veg: 2, kozep: spans - 1 };
};
const daysLeft = (d) => (d ? Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 86400000) : null);
const m1 = (v) => fmt(v, Math.abs(v % 1) > 0.05 ? 1 : 0);

// ---------------------------------------------------------------------------
// Telek-geometria
function dist([la1, lo1], [la2, lo2]) {
  const R = 6371008.8, r = Math.PI / 180;
  const a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
function sides(plot) {
  if (!plot?.points?.length) return [];
  const p = plot.points;
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length], geo = dist(a, b);
    const over = plot.lengths?.[i];
    return { i, a, b, geo, len: over || geo, manual: !!over };
  });
}
// A szakasz helye a térképen: az oldal elejétől from_m-től from_m + length_m-ig (az oldal hosszához arányítva).
function stageOnSide(st, sd) {
  const f0 = Math.min(1, st.from_m / sd.len), f1 = Math.min(1, (st.from_m + st.length_m) / sd.len);
  const fd = Math.min(f1, (st.from_m + Math.min(st.done_m, st.length_m)) / sd.len);
  return { p0: lerp(sd.a, sd.b, f0), p1: lerp(sd.a, sd.b, f1), pd: lerp(sd.a, sd.b, fd), f0, f1, over: st.from_m + st.length_m > sd.len + 0.5 };
}

// ---------------------------------------------------------------------------
// Kártya-előnézet: a telek körvonala és rajta a szakaszok (szürke / piros).
function miniPlot(j) {
  const sd = sides(j.plot);
  if (!sd.length) {
    if (!j.stages.length) return '<span class="muted small">Nincs telek és szakasz</span>';
    const tot = j.stages.reduce((a, s) => a + s.length_m, 0);
    return `<div class="mini-bars">${j.stages.map((s) => `<span style="flex:${s.length_m}"><i style="width:${(s.done_m / s.length_m) * 100}%"></i></span>`).join('')}</div>
      <span class="muted small">${m1(tot)} m · telek még nincs rajzolva</span>`;
  }
  const lat0 = j.plot.points[0][0], cosl = Math.cos((lat0 * Math.PI) / 180);
  const xy = ([la, lo]) => [lo * cosl * 111320, -la * 110540];
  const pts = j.plot.points.map(xy);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX || 1, h = Math.max(...ys) - minY || 1;
  const W = 300, H = 110, pad = 10, k = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
  const ox = (W - w * k) / 2, oy = (H - h * k) / 2;
  const P = (ll) => { const [x, y] = xy(ll); return `${(ox + (x - minX) * k).toFixed(1)},${(oy + (y - minY) * k).toFixed(1)}`; };
  let g = `<polygon points="${j.plot.points.map(P).join(' ')}" fill="rgba(255,255,255,.05)" stroke="#5b6066" stroke-width="1.2" stroke-dasharray="3 3"/>`;
  for (const st of j.stages) {
    const s = sd[st.side];
    if (!s) continue;
    const g0 = stageOnSide(st, s);
    g += `<polyline points="${P(g0.p0)} ${P(g0.p1)}" stroke="#9aa0a6" stroke-width="5" stroke-linecap="square"/>`;
    if (st.done_m > 0) g += `<polyline points="${P(g0.p0)} ${P(g0.pd)}" stroke="${RED}" stroke-width="5" stroke-linecap="square"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="mini-plot">${g}</svg>`;
}

// ---------------------------------------------------------------------------
// Kiterített szakasz: felülről, oszlopokkal (H-profil) és panelekkel; a teljes szélességet kitölti.
function postPath(S, s) {
  const h = S / 2, w = S * 0.3, d = (S - w) / 2, g = S * 0.36, tp = S * 0.07, c = S * 0.09;
  const p = [];
  const add = (x, y) => p.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  add(-h + c, -h); add(h - c, -h); add(h, -h + c);
  if (s.r) { add(h, -g / 2 - tp); add(h - d, -g / 2); add(h - d, g / 2); add(h, g / 2 + tp); }
  add(h, h - c); add(h - c, h); add(-h + c, h); add(-h, h - c);
  if (s.l) { add(-h, g / 2 + tp); add(-h + d, g / 2); add(-h + d, -g / 2); add(-h, -g / 2 - tp); }
  add(-h, -h + c);
  return `M${p.join('L')}Z`;
}

function bandSvg(st, W, done) {
  const L = st.length_m, pad = 16, H = 64, y = 36;
  const k = (W - 2 * pad) / L;
  const S = Math.max(6, Math.min(16, k * 0.5)), t = S * 0.34;
  const spans = Math.max(1, Math.ceil(L / 2 - 1e-9));
  const X = (m) => pad + m * k;
  let g = '';
  // Méterskála
  const step = L <= 12 ? 2 : L <= 30 ? 5 : L <= 80 ? 10 : 20;
  for (let m = 0; m <= L + 1e-6; m += step) {
    g += `<line x1="${X(m)}" x2="${X(m)}" y1="12" y2="17" stroke="var(--muted)" stroke-width="1"/><text x="${X(m)}" y="9" font-size="9" text-anchor="middle" fill="var(--muted)">${m}</text>`;
  }
  if (L % step > 0.5) g += `<text x="${X(L)}" y="9" font-size="9" text-anchor="middle" fill="var(--ink)" font-weight="700">${m1(L)} m</text>`;
  // Panelek
  for (let j = 0; j < spans; j++) {
    const d0 = j * 2, d1 = Math.min(L, (j + 1) * 2);
    const x0 = X(d0) + S * 0.15, x1 = X(d1) - S * 0.15;
    const ok = d1 <= done + 1e-6;
    g += `<rect x="${x0.toFixed(1)}" y="${(y - t / 2).toFixed(1)}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${t.toFixed(1)}" rx="1" fill="${ok ? RED : '#8d9299'}"/>`;
    if (!ok && done > d0) g += `<rect x="${x0.toFixed(1)}" y="${(y - t / 2).toFixed(1)}" width="${Math.max(0, X(done) - x0).toFixed(1)}" height="${t.toFixed(1)}" rx="1" fill="${RED}"/>`;
  }
  // Oszlopok
  for (let j = 0; j <= spans; j++) {
    const d = Math.min(j * 2, L), isEnd = j === 0 || j === spans;
    const ok = done > 0 && d <= done + 1e-6;
    g += `<path transform="translate(${X(d).toFixed(1)} ${y})" d="${postPath(S * (isEnd ? 1.1 : 1), { l: j > 0, r: j < spans })}" fill="${ok ? '#a51d1d' : '#d9dbde'}" stroke="${ok ? '#ff8a8a' : '#16181b'}" stroke-width="${ok ? .8 : 1}"/>`;
  }
  // „Idáig kész” jelölő
  const hx = X(done);
  g += `<g class="band-handle" transform="translate(${hx.toFixed(1)} 0)"><line y1="20" y2="${H - 12}" stroke="#fff" stroke-width="2"/>
    <circle cy="${H - 10}" r="8" fill="${RED}" stroke="#fff" stroke-width="2"/></g>`;
  return `<svg class="band" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-k="${k}" data-pad="${pad}">${g}</svg>`;
}

// ===================================================================
export function initJobs(config) {
  js.templates = config.panelTemplates;
  $('#stage-template').innerHTML = js.templates.map((t) => `<option>${esc(t)}</option>`).join('');
}

export async function loadJobs() {
  js.jobs = await api('/api/jobs');
  $$('[data-job-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.jobFilter === js.filter)));
  const list = js.jobs.filter((j) => !js.filter || j.status === js.filter);
  $('#jobs').innerHTML = list.map((j) => {
    const dl = daysLeft(j.deadline);
    const panels = j.stages.reduce((a, s) => a + stageCalc(s.length_m).panels, 0);
    const deadline = j.deadline ? `<span class="chip-s ${dl < 0 ? 'bad' : dl <= 7 ? 'warn' : ''}">${dl === 0 ? 'ma' : dl > 0 ? `${dl} nap` : `${-dl} napja lejárt`} · ${esc(j.deadline.slice(5).replace('-', '.'))}.</span>` : '';
    const pct = j.total_m ? Math.round(Math.min(1, j.done_m / j.total_m) * 100) : 0;
    return `<button type="button" class="job-card ${js.selected === j.id ? 'active' : ''} ${j.status === 'Aktív' ? '' : 'done'}" data-job="${j.id}">
      <div class="job-top"><b>${esc(j.name)}</b>${j.status === 'Aktív' ? deadline : '<span class="chip-s ok">Befejezett</span>'}</div>
      <div class="muted small">${[j.client_name, j.location].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
      <div class="job-thumb">${miniPlot(j)}</div>
      <div class="job-foot small"><span><b>${m1(j.total_m)} m</b> · ${j.stages.length} szakasz · ${panels} panel</span>
        <span>${j.total_m ? `kész <b>${pct}%</b>` : ''}</span></div>
      ${j.total_m ? `<div class="bar sm ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>` : ''}
    </button>`;
  }).join('') || `<p class="muted">${js.filter ? `Nincs ${js.filter.toLowerCase()} projekt.` : 'Még nincs projekt.'}</p>`;
  if (js.selected && js.jobs.some((j) => j.id === js.selected)) await showJob(js.selected, false);
  else $('#job-detail').hidden = true;
}

$$('[data-job-filter]').forEach((b) => b.addEventListener('click', () => {
  js.filter = b.dataset.jobFilter;
  try { localStorage.setItem('jobFilter', js.filter); } catch {}
  loadJobs();
}));
$('#jobs').addEventListener('click', (e) => {
  const c = e.target.closest('[data-job]');
  if (!c) return;
  const id = +c.dataset.job;
  if (js.selected === id && !$('#job-detail').hidden) { js.selected = null; $('#job-detail').hidden = true; $$('.job-card').forEach((x) => x.classList.remove('active')); return; }
  js.mode = 'view';
  showJob(id, true);
});

async function showJob(id, scroll) {
  const j = js.jobs.find((x) => x.id === id);
  if (!j) return;
  const changed = js.shownId !== id;
  js.selected = id; js.shownId = id; js.job = j;
  $$('.job-card').forEach((c) => c.classList.toggle('active', +c.dataset.job === id));
  const s = await api(`/api/jobs/${id}/summary`);
  js.detail = s;
  $('#job-detail').hidden = false;
  $('#jd-name').textContent = j.name;
  $('#jd-status').textContent = j.status === 'Aktív' ? '✓ Befejezettnek jelöl' : 'Újranyitás';
  const dl = daysLeft(j.deadline);
  $('#jd-meta').innerHTML = [
    j.client_name && esc(j.client_name),
    j.phone && `<a href="tel:${esc(j.phone.replace(/\s/g, ''))}">${esc(j.phone)}</a>`,
    j.location && esc(j.location),
    j.deadline && `határidő: ${esc(j.deadline)}${j.status === 'Aktív' && dl !== null ? ` (${dl >= 0 ? `${dl} nap múlva` : `${-dl} napja lejárt`})` : ''}`,
    `<button class="link small" type="button" id="jd-edit">szerkesztés</button>`,
  ].filter(Boolean).join(' · ');

  const t = s.stages.reduce((a, x) => ({ m: a.m + x.length_m, panels: a.panels + x.panels, veg: a.veg + x.veg, kozep: a.kozep + x.kozep, done: a.done + x.done_m }),
    { m: 0, panels: 0, veg: 0, kozep: 0, done: 0 });
  const per = sides(j.plot).reduce((a, x) => a + x.len, 0);
  $('#jd-tiles').innerHTML = `
    <span>Kerítés <b>${m1(t.m)}</b><small>m</small></span>
    ${per ? `<span>Telek kerülete <b>${m1(per)}</b><small>m</small></span>` : ''}
    <span>Panel <b>${t.panels}</b><small>db</small></span>
    <span>Végoszlop <b>${t.veg}</b></span>
    <span>Középoszlop <b>${t.kozep}</b></span>`;
  const pct = t.m ? Math.round((t.done / t.m) * 100) : 0;
  $('#jd-progress').innerHTML = t.m ? `<div class="progress-head"><span>Kész: <b>${m1(t.done)} m</b> · hátra: ${m1(t.m - t.done)} m</span><b>${pct}%</b></div>
    <div class="bar big ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>` : '';

  renderBands();
  renderSides();
  renderInstall();
  $('#jd-summary tbody').innerHTML = s.summary.map((x) => `<tr><td>${esc(x.item)}</td><td class="num">${x.needed}</td>
    <td class="num">${x.in_stock}</td><td class="num ${x.missing ? 'neg' : ''}">${x.missing}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">Adj hozzá szakaszt.</td></tr>';

  if (scroll) $('#job-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  initMap(changed);
}

function renderInstall() {
  const ins = js.detail.install;
  $('#jd-install').innerHTML = `<div class="kv">
      <span>Munkaóra: <b>${fmt(ins.hours, 1)}</b> · ${ins.work_days} nap</span>
      <span>Bérköltség: <b>${ft(ins.cost)}</b></span>
      <span>m / munkaóra: <b>${ins.hours && ins.auto_m ? fmt(ins.auto_m / ins.hours, 1) : '–'}</b></span>
    </div>
    ${ins.days.length ? `<div class="list">${ins.days.map((d) => `<div class="item small"><span><b>${esc(d.day)}</b> · ${fmt(d.done_m, 0)} m</span><span class="muted">${esc(d.workers || '')}</span></div>`).join('')}</div>`
      : '<p class="muted small">A Napi lapon a Telepítés feladatnál rögzített munkák jelennek meg itt.</p>'}`;
}

// ---------------------------------------------------------------------------
// Szakaszok kiterítve
function renderBands() {
  const s = js.detail, sd = sides(js.job.plot);
  const box = $('#jd-bands');
  box.innerHTML = s.stages.map((x, i) => {
    const side = sd[x.side];
    const pos = side ? `${SIDE(x.side)} oldal · ${m1(x.from_m)}–${m1(x.from_m + x.length_m)} m` : 'nincs telek-oldalhoz kötve';
    const pct = Math.round((x.done_m / x.length_m) * 100);
    return `<div class="band-row" data-stage="${x.id}">
      <div class="band-head">
        <span class="stage-no ${pct >= 100 ? 'ok' : pct > 0 ? 'part' : ''}">${i + 1}</span>
        <div class="band-title"><b>${esc(x.stage_name)}</b> <span class="tpl-chip" style="--c:${TPL_ACCENT[x.template] || '#888'}">${esc(x.template)}</span>
          <div class="muted small">${pos} · ${x.spans} köz · ${x.panels} panel${side && stageOnSide(x, side).over ? ' · <span class="neg">hosszabb, mint az oldal</span>' : ''}</div></div>
        <div class="band-done"><b data-done-txt>${m1(x.done_m)}</b> / ${m1(x.length_m)} m
          <div class="small">${x.manual ? `<span class="chip-s">kézzel</span> <button class="link small" type="button" data-auto="${x.id}">napi lapból (${m1(x.done_auto)} m)</button>` : '<span class="muted">napi lapból</span>'}</div></div>
        <span class="row-btns"><button class="btn sm ghost" data-edit-stage="${x.id}" aria-label="Szerkesztés">✎</button><button class="btn sm ghost" data-del-stage="${x.id}" aria-label="Törlés">✕</button></span>
      </div>
      <div class="band-wrap" data-band="${x.id}"></div>
    </div>`;
  }).join('') || `<p class="muted">Még nincs szakasz. ${sd.length ? 'Add hozzá a telek egyik oldalához.' : 'Először rajzold meg a telket a térképen, vagy adj hozzá szakaszt telek nélkül.'}</p>`;
  $('#bands-hint').textContent = s.stages.length ? 'A sávon húzd vagy koppintsd, meddig készült el (2 méterenként ugrik). Ha nem állítod, a Napi lap telepítéseiből számol.' : '';
  drawBands();
}
function drawBands() {
  for (const w of $$('#jd-bands [data-band]')) {
    const st = js.detail.stages.find((x) => x.id === +w.dataset.band);
    w.innerHTML = bandSvg(st, Math.max(280, w.clientWidth), st.done_m);
  }
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (!$('#job-detail').hidden && js.detail) drawBands(); }, 150); });

// Húzás / koppintás a sávon: kész hossz 2 m-es lépésekben (a végén a teljes hossz).
$('#jd-bands').addEventListener('pointerdown', (e) => {
  const w = e.target.closest('[data-band]');
  if (!w) return;
  const st = js.detail.stages.find((x) => x.id === +w.dataset.band);
  const val = (ev) => {
    const svg = w.querySelector('svg'); // újrarajzoláskor cserélődik, ezért mindig a mostanit kérjük
    const k = +svg.dataset.k, pad = +svg.dataset.pad;
    const r = svg.getBoundingClientRect();
    const m = ((ev.clientX - r.left) * (svg.viewBox.baseVal.width / r.width) - pad) / k;
    const snapped = Math.round(m / 2) * 2;
    return Math.max(0, Math.min(st.length_m, m >= st.length_m - 1 ? st.length_m : snapped));
  };
  let cur = val(e);
  const draw = () => {
    w.innerHTML = bandSvg(st, Math.max(280, w.clientWidth), cur);
    w.closest('.band-row').querySelector('[data-done-txt]').textContent = m1(cur);
  };
  draw();
  w.setPointerCapture?.(e.pointerId);
  const move = (ev) => { const v = val(ev); if (v !== cur) { cur = v; draw(); } };
  const up = async () => {
    w.removeEventListener('pointermove', move); w.removeEventListener('pointerup', up); w.removeEventListener('pointercancel', up);
    if (Math.abs(cur - st.done_m) < 0.01) return;
    await api(`/api/stages/${st.id}`, { method: 'PATCH', body: { done_manual: cur } });
    toast(`${st.stage_name}: ${m1(cur)} m kész`);
    loadJobs();
  };
  w.addEventListener('pointermove', move); w.addEventListener('pointerup', up); w.addEventListener('pointercancel', up);
});

$('#jd-bands').addEventListener('click', async (e) => {
  const auto = e.target.closest('[data-auto]');
  const ed = e.target.closest('[data-edit-stage]');
  const del = e.target.closest('[data-del-stage]');
  if (auto) { await api(`/api/stages/${auto.dataset.auto}`, { method: 'PATCH', body: { done_manual: null } }); toast('Visszaállítva a napi lap szerint'); loadJobs(); }
  if (ed) openStage(js.detail.stages.find((x) => x.id === +ed.dataset.editStage));
  if (del && confirm('Törlöd a szakaszt?')) { await api(`/api/stages/${del.dataset.delStage}`, { method: 'DELETE' }); loadJobs(); }
  const row = e.target.closest('.band-head');
  if (row && !e.target.closest('button') && js.map) focusStage(+row.closest('[data-stage]').dataset.stage);
});

// ---------------------------------------------------------------------------
// Telek oldalai (hossz-felülírás, szakasz hozzáadása oldalhoz)
function renderSides() {
  const sd = sides(js.job.plot);
  if (!sd.length) { $('#plot-sides').innerHTML = ''; return; }
  $('#plot-sides').innerHTML = `<div class="table-wrap"><table class="sides-table"><thead><tr><th>Oldal</th><th class="num">Térképen</th><th>Valós hossz (m)</th><th>Szakaszok</th><th></th></tr></thead><tbody>
    ${sd.map((x) => {
      const on = js.detail.stages.filter((st) => st.side === x.i);
      return `<tr><td><span class="side-tag">${SIDE(x.i)}</span></td><td class="num muted">${fmt(x.geo, 1)} m</td>
        <td><input class="len-in" type="number" step="any" min="0" inputmode="decimal" data-side-len="${x.i}" value="${x.manual ? x.len : ''}" placeholder="${fmt(x.geo, 1)}"></td>
        <td class="small">${on.map((st) => `${esc(st.stage_name)} <span class="muted">${m1(st.from_m)}–${m1(st.from_m + st.length_m)} m</span>`).join('<br>') || '<span class="muted">–</span>'}</td>
        <td><button class="btn sm" type="button" data-add-side="${x.i}">+ szakasz</button></td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="muted small">A térképen mért hossz pár tized méter pontos lehet; ha lemérted a valós hosszt, írd be, és a szakaszok ahhoz igazodnak.</p>`;
}
$('#plot-sides').addEventListener('change', async (e) => {
  const inp = e.target.closest('[data-side-len]');
  if (!inp) return;
  const plot = structuredClone(js.job.plot);
  plot.lengths = plot.lengths || {};
  const v = parseFloat(String(inp.value).replace(',', '.'));
  if (v > 0) plot.lengths[inp.dataset.sideLen] = v; else delete plot.lengths[inp.dataset.sideLen];
  await api(`/api/jobs/${js.job.id}`, { method: 'PATCH', body: { plot } });
  toast('Oldalhossz mentve'); loadJobs();
});
$('#plot-sides').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add-side]');
  if (b) openStage(null, +b.dataset.addSide);
});

// ---------------------------------------------------------------------------
// Műholdtérkép (Leaflet + Esri World Imagery), címkeresés (OpenStreetMap Nominatim)
function initMap(jobChanged) {
  if (typeof L === 'undefined') { $('#plot-map').innerHTML = '<p class="muted" style="padding:16px">A térkép nem töltődött be.</p>'; return; }
  if (!js.map) {
    js.map = L.map('plot-map', { zoomControl: true, attributionControl: true, maxZoom: 22 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 22, maxNativeZoom: 19, attribution: 'Műholdkép: Esri',
    }).addTo(js.map);
    js.layers = L.layerGroup().addTo(js.map);
    js.map.on('click', onMapClick);
    js.map.on('zoomend', () => { if (js.mode === 'view') drawPlot(); });
  }
  setTimeout(() => js.map.invalidateSize(), 0);
  if (jobChanged) {
    js.mode = 'view'; js.draft = null;
    const pts = js.job.plot?.points;
    if (pts?.length) js.map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 20 });
    else {
      js.map.setView(BANA, 17);
      if (js.job.location && !js.autoSearched.has(js.job.id)) { js.autoSearched.add(js.job.id); geocode(js.job.location, true); }
    }
  }
  drawPlot();
}

function setHint(text) { const h = $('#map-hint'); h.hidden = !text; h.textContent = text || ''; }

function drawPlot() {
  const map = js.map, lay = js.layers;
  lay.clearLayers();
  renderTools();
  if (js.mode === 'draw' || js.mode === 'edit') return drawDraft();
  setHint('');
  const sd = sides(js.job.plot);
  if (!sd.length) { setHint('Keresd meg a címet, aztán „Telek rajzolása”: kattints a telek sarkaira sorban.'); return; }
  L.polygon(js.job.plot.points, { color: '#ffffff', weight: 1.5, dashArray: '5 5', fillColor: '#ffffff', fillOpacity: 0.07, interactive: false }).addTo(lay);
  const zoom = map.getZoom();
  for (const x of sd) {
    const mid = lerp(x.a, x.b, 0.5);
    L.marker(mid, { interactive: false, icon: L.divIcon({ className: 'side-label', html: `<span><b>${SIDE(x.i)}</b> ${m1(x.len)} m</span>`, iconSize: null }) }).addTo(lay);
  }
  js.detail.stages.forEach((st, idx) => {
    const x = sd[st.side];
    if (!x) return;
    const g = stageOnSide(st, x);
    L.polyline([g.p0, g.p1], { color: '#16181b', weight: 12, opacity: 0.85, interactive: false }).addTo(lay);
    L.polyline([g.p0, g.p1], { color: '#c9ccd0', weight: 8, opacity: 1 }).addTo(lay)
      .bindTooltip(`${idx + 1}. ${esc(st.stage_name)} · ${m1(st.done_m)}/${m1(st.length_m)} m kész`, { sticky: true });
    if (st.done_m > 0) L.polyline([g.p0, g.pd], { color: RED, weight: 8, opacity: 1, interactive: false }).addTo(lay);
    // Oszlopok közelről (2 m-enként)
    if (zoom >= 19) {
      const spans = Math.max(1, Math.ceil(st.length_m / 2 - 1e-9));
      for (let j = 0; j <= spans; j++) {
        const d = Math.min(j * 2, st.length_m);
        const pos = lerp(x.a, x.b, Math.min(1, (st.from_m + d) / x.len));
        L.circleMarker(pos, { radius: j === 0 || j === spans ? 4.5 : 3, color: '#16181b', weight: 1.5, fillColor: d <= st.done_m + 1e-6 && st.done_m > 0 ? '#ff9a9a' : '#ffffff', fillOpacity: 1, interactive: false }).addTo(lay);
      }
    }
    const lbl = lerp(g.p0, g.p1, 0.25); // a negyedénél, hogy ne takarja az oldal címkéjét
    L.marker(lbl, { interactive: false, icon: L.divIcon({ className: 'stage-label', html: `<span class="${st.done_m >= st.length_m ? 'ok' : st.done_m > 0 ? 'part' : ''}">${idx + 1}</span>`, iconSize: null }) }).addTo(lay);
  });
}

function focusStage(id) {
  const st = js.detail.stages.find((x) => x.id === id), x = sides(js.job.plot)[st?.side];
  if (!x) return;
  const g = stageOnSide(st, x);
  js.map.fitBounds(L.latLngBounds([g.p0, g.p1]), { padding: [40, 40], maxZoom: 21 });
  $('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// --- Rajzolás / szerkesztés ---
function renderTools() {
  const has = !!js.job.plot?.points?.length;
  const t = $('#plot-tools');
  if (js.mode === 'draw') t.innerHTML = `<button class="btn sm" data-tool="undo" type="button">↶ Visszavon</button><button class="btn sm" data-tool="cancel" type="button">Mégse</button><button class="btn success sm" data-tool="save" type="button" ${js.draft.length < 3 ? 'disabled' : ''}>Kész (${js.draft.length} pont)</button>`;
  else if (js.mode === 'edit') t.innerHTML = `<button class="btn sm ghost" data-tool="delete" type="button">Telek törlése</button><button class="btn sm" data-tool="cancel" type="button">Mégse</button><button class="btn success sm" data-tool="save" type="button">Mentés</button>`;
  else t.innerHTML = has ? '<button class="btn sm" data-tool="edit" type="button">✎ Telek szerkesztése</button>' : '<button class="btn primary sm" data-tool="draw" type="button">Telek rajzolása</button>';
}
$('#plot-tools').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tool]');
  if (!b) return;
  const t = b.dataset.tool;
  if (t === 'draw') { js.mode = 'draw'; js.draft = []; }
  if (t === 'edit') { js.mode = 'edit'; js.draft = js.job.plot.points.map((p) => [...p]); }
  if (t === 'undo') js.draft.pop();
  if (t === 'cancel') { js.mode = 'view'; js.draft = null; }
  if (t === 'delete') {
    if (!confirm('Törlöd a telket? A szakaszok megmaradnak, de nem lesznek oldalhoz kötve a térképen.')) return;
    await api(`/api/jobs/${js.job.id}`, { method: 'PATCH', body: { plot: null } });
    js.mode = 'view'; js.draft = null; toast('Telek törölve'); return loadJobs();
  }
  if (t === 'save') {
    if (js.draft.length < 3) return;
    const old = js.job.plot;
    // Ha a pontok száma nem változott, a kézi hosszak maradnak.
    const lengths = old && old.points.length === js.draft.length ? old.lengths : {};
    await api(`/api/jobs/${js.job.id}`, { method: 'PATCH', body: { plot: { points: js.draft, lengths } } });
    js.mode = 'view'; js.draft = null; toast('Telek mentve');
    return loadJobs();
  }
  drawPlot();
});

function onMapClick(e) {
  if (js.mode !== 'draw') return;
  js.draft.push([e.latlng.lat, e.latlng.lng]);
  drawPlot();
}

function drawDraft() {
  const lay = js.layers, pts = js.draft;
  const closed = js.mode === 'edit' || pts.length >= 3;
  if (pts.length >= 2) (closed ? L.polygon : L.polyline)(pts, { color: RED, weight: 2.5, fillColor: RED, fillOpacity: 0.08, interactive: false }).addTo(lay);
  // Oldalhosszak a rajzolás közben
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    L.marker(lerp(a, b, 0.5), { interactive: false, icon: L.divIcon({ className: 'side-label', html: `<span><b>${SIDE(i)}</b> ${fmt(dist(a, b), 1)} m</span>`, iconSize: null }) }).addTo(lay);
  }
  pts.forEach((p, i) => {
    const mk = L.marker(p, { draggable: true, icon: L.divIcon({ className: 'vtx', html: `<span>${i === 0 ? '1' : ''}</span>`, iconSize: [18, 18] }) }).addTo(lay);
    mk.on('drag', (ev) => { pts[i] = [ev.latlng.lat, ev.latlng.lng]; });
    mk.on('dragend', () => drawPlot());
    mk.on('click', () => {
      if (js.mode === 'edit' && pts.length > 3) { pts.splice(i, 1); drawPlot(); }
      else if (js.mode === 'draw' && i === 0 && pts.length >= 3) $('#plot-tools [data-tool="save"]').click();
    });
  });
  if (js.mode === 'edit') {
    // Új pont beszúrása az oldal közepén lévő „+” jellel.
    for (let i = 0; i < n; i++) {
      const mid = lerp(pts[i], pts[(i + 1) % n], 0.5);
      L.marker(mid, { icon: L.divIcon({ className: 'vtx-add', html: '<span>+</span>', iconSize: [18, 18], iconAnchor: [9, 26] }) }).addTo(lay)
        .on('click', () => { pts.splice(i + 1, 0, mid); drawPlot(); });
    }
  }
  setHint(js.mode === 'draw'
    ? (pts.length < 3 ? 'Kattints a telek sarkaira sorban (az utcafronti saroktól érdemes kezdeni).' : 'Folytasd, vagy kattints az első pontra / „Kész”. A pontok húzhatók.')
    : 'Húzd a sarkokat a helyükre. Pont törlése: kattints rá. Új pont: a „+” jel az oldal közepén.');
}

// --- Címkeresés ---
async function geocode(q, auto = false) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=hu&accept-language=hu&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const list = await res.json();
    if (auto) { if (list[0]) js.map.setView([+list[0].lat, +list[0].lon], 19); return; }
    const box = $('#map-results');
    box.hidden = false;
    box.innerHTML = list.length ? list.map((r) => `<button type="button" data-ll="${r.lat},${r.lon}">${esc(r.display_name)}</button>`).join('') : '<span class="muted small">Nincs találat.</span>';
  } catch { if (!auto) toast('A címkeresés most nem elérhető', true); }
}
$('#map-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  if (q) geocode(q);
});
$('#map-results').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ll]');
  if (!b) return;
  const [la, lo] = b.dataset.ll.split(',').map(Number);
  js.map.setView([la, lo], 19);
  $('#map-results').hidden = true;
});

// ---------------------------------------------------------------------------
// Projekt: új / szerkesztés / státusz
$('#job-new').addEventListener('click', () => {
  js.editingJob = false;
  const f = $('#job-form'); f.reset();
  $('#job-dialog-title').textContent = 'Új projekt';
  f.querySelector('[type=submit]').textContent = 'Létrehozás';
  $('#job-dialog').showModal();
});
$('#job-detail').addEventListener('click', async (e) => {
  if (e.target.closest('#jd-edit')) {
    const j = js.job, f = $('#job-form');
    js.editingJob = true;
    for (const k of ['name', 'client_name', 'phone', 'location', 'deadline']) f[k].value = j[k] || '';
    $('#job-dialog-title').textContent = 'Projekt szerkesztése';
    f.querySelector('[type=submit]').textContent = 'Mentés';
    $('#job-dialog').showModal();
  }
  if (e.target.closest('#jd-status')) {
    const j = js.job;
    await api(`/api/jobs/${j.id}`, { method: 'PATCH', body: { status: j.status === 'Aktív' ? 'Befejezett' : 'Aktív' } });
    toast(j.status === 'Aktív' ? 'Befejezettnek jelölve' : 'Újranyitva'); loadJobs();
  }
});
$('#stage-new').addEventListener('click', () => openStage(null));
$$('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('#job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  if (js.editingJob) {
    await api(`/api/jobs/${js.job.id}`, { method: 'PATCH', body: v });
  } else {
    const res = await api('/api/jobs', { method: 'POST', body: v });
    js.selected = res.job_id;
    if (js.filter === 'Befejezett') js.filter = 'Aktív';
  }
  $('#job-dialog').close(); toast('Mentve'); await loadJobs();
  if (!js.editingJob) $('#job-detail').scrollIntoView({ behavior: 'smooth' });
});

// ---------------------------------------------------------------------------
// Szakasz felvétele / szerkesztése
function freeFrom(side, exceptId) {
  return js.detail.stages.filter((x) => x.side === side && x.id !== exceptId).reduce((a, x) => Math.max(a, x.from_m + x.length_m), 0);
}
function openStage(st, side = null) {
  js.editingStage = st;
  const f = $('#stage-form'); f.reset();
  const sd = sides(js.job.plot);
  $('#stage-side').innerHTML = '<option value="">— nincs telek-oldalhoz kötve —</option>' +
    sd.map((x) => `<option value="${x.i}">${SIDE(x.i)} oldal · ${m1(x.len)} m</option>`).join('');
  f.querySelector('[data-for="side"]').hidden = !sd.length;
  $('#stage-dialog-title').textContent = st ? 'Szakasz szerkesztése' : 'Új szakasz';
  f.querySelector('[type=submit]').textContent = st ? 'Mentés' : 'Hozzáadás';
  if (st) {
    f.stage_name.value = st.stage_name; f.length_m.value = st.length_m; f.template.value = st.template;
    f.note.value = st.note || ''; f.side.value = st.side ?? ''; f.from_m.value = st.from_m || 0;
  } else {
    if (js.detail.stages.length) f.template.value = js.detail.stages.at(-1).template;
    const s0 = side ?? (sd.length ? sd.findIndex((x) => freeFrom(x.i) < x.len - 0.5) : -1);
    if (s0 !== null && s0 >= 0) {
      f.side.value = s0;
      const from = freeFrom(s0);
      f.from_m.value = +from.toFixed(2);
      f.length_m.value = +Math.max(0.5, sd[s0].len - from).toFixed(2);
      if (!f.stage_name.value) f.stage_name.value = `${SIDE(s0)} oldal`;
    }
  }
  previewStage();
  $('#stage-dialog').showModal();
}
function previewStage() {
  const f = $('#stage-form');
  f.querySelector('[data-for="from"]').hidden = f.side.value === '';
  const len = parseFloat(String(f.length_m.value).replace(',', '.'));
  const box = $('#stage-preview');
  if (!(len >= 0.5)) { box.innerHTML = '<p class="muted small">Add meg a hosszt.</p>'; return; }
  const c = stageCalc(len);
  const sd = sides(js.job.plot)[f.side.value === '' ? -1 : +f.side.value];
  const from = parseFloat(String(f.from_m.value).replace(',', '.')) || 0;
  let warn = '';
  if (sd && from + len > sd.len + 0.5) warn = `<p class="small neg">Túllóg az oldalon: ${SIDE(sd.i)} oldal ${m1(sd.len)} m, a szakasz ${m1(from)}–${m1(from + len)} m.</p>`;
  box.innerHTML = `<p class="small">${c.spans} oszlopköz · <b>${c.panels} panel</b> · ${c.veg} végoszlop + ${c.kozep} középoszlop${len % 2 ? ` <span class="muted">(az utolsó köz ${fmt(len - 2 * (c.spans - 1), 1)} m)</span>` : ''}</p>
    ${sd ? `<p class="muted small">${SIDE(sd.i)} oldal: ${m1(from)} m-től ${m1(from + len)} m-ig (az oldal ${m1(sd.len)} m).</p>` : ''}${warn}`;
}
$('#stage-form').addEventListener('input', previewStage);
$('#stage-side').addEventListener('change', () => {
  const f = $('#stage-form');
  const sd = sides(js.job.plot)[f.side.value === '' ? -1 : +f.side.value];
  if (sd && !js.editingStage) {
    const from = freeFrom(sd.i);
    f.from_m.value = +from.toFixed(2);
    f.length_m.value = +Math.max(0.5, sd.len - from).toFixed(2);
  }
  previewStage();
});
$('#stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  v.length_m = String(v.length_m).replace(',', '.');
  v.from_m = String(v.from_m || 0).replace(',', '.');
  if (v.side === undefined) v.side = '';
  if (js.editingStage) await api(`/api/stages/${js.editingStage.id}`, { method: 'PATCH', body: v });
  else await api(`/api/jobs/${js.selected}/stages`, { method: 'POST', body: v });
  $('#stage-dialog').close(); toast('Mentve'); loadJobs();
});
