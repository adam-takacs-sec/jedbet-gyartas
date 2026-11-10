// Munkák: projektek; a kerítés négy oldalon (Észak, Kelet, Dél, Nyugat) – É/D vízszintes, K/Ny függőleges.
// Alapnézet: a kerítés és a „kész” jelölése (húzható piros pötty, Mind kész / 0).
// Szerkesztés nézet: „+ Szakasz” a négy oldalon, a szakaszok módosítása és törlése.
import { $, $$, esc, fmt, ft, api, toast } from './lib.js';

const js = {
  templates: [], jobs: [], filter: 'Aktív', selected: null, shownId: null, detail: null, job: null,
  editingStage: null, editingJob: false, edit: false, sel: null, view: null, newSide: null,
};
try { js.filter = localStorage.getItem('jobFilter') ?? 'Aktív'; } catch {}

const RED = '#d62828';
const TPL_ACCENT = { 'Mediterrán': '#d4a72c', 'Homokkő': '#c06b3e', 'Hullám': '#3d8fd1' };
// Oldalak: a szakasz kezdése a sarokból mérve – É és D a bal (nyugati) saroktól, K és Ny a felső (északi) saroktól.
const SIDES = [
  { i: 0, name: 'Észak', adj: 'északi', short: 'É', from: 'a bal (nyugati) saroktól', dx: 1, dy: 0, nx: 0, ny: -1 },
  { i: 1, name: 'Kelet', adj: 'keleti', short: 'K', from: 'a felső (északi) saroktól', dx: 0, dy: 1, nx: 1, ny: 0 },
  { i: 2, name: 'Dél', adj: 'déli', short: 'D', from: 'a bal (nyugati) saroktól', dx: 1, dy: 0, nx: 0, ny: 1 },
  { i: 3, name: 'Nyugat', adj: 'nyugati', short: 'Ny', from: 'a felső (északi) saroktól', dx: 0, dy: 1, nx: -1, ny: 0 },
];

// 2 m = 1 oszlopköz = 4 panel; szakaszonként 2 végoszlop (ugyanaz, mint a szerveren).
const stageCalc = (len) => {
  const spans = Math.max(1, Math.ceil(len / 2 - 1e-9));
  return { spans, panels: spans * 4, veg: 2, kozep: spans - 1 };
};
const daysLeft = (d) => (d ? Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 86400000) : null);
const m1 = (v) => fmt(v, Math.abs(v % 1) > 0.05 ? 1 : 0);
const sideOf = (st) => (st.side !== null && st.side !== undefined && SIDES[st.side] ? SIDES[st.side] : null);

// Elemenkénti készültség: oszlopok (spans + 1) és panelek (spans). Ha nincs elemenként jelölve,
// a kész hosszból (napi lap / kézi) számoljuk: az elejétől folyamatosan.
function stageMap(st) {
  const n = Math.max(1, Math.ceil(st.length_m / 2 - 1e-9));
  if (st.done_map && st.done_map.includes('|')) {
    const [p, s] = st.done_map.split('|');
    if (p.length === n + 1 && s.length === n) return { p: [...p].map((c) => c === '1'), s: [...s].map((c) => c === '1') };
  }
  const done = Math.min(st.done_m || 0, st.length_m);
  return {
    p: Array.from({ length: n + 1 }, (_, j) => done > 0 && Math.min(j * 2, st.length_m) <= done + 1e-6),
    s: Array.from({ length: n }, (_, j) => Math.min(st.length_m, (j + 1) * 2) <= done + 1e-6),
  };
}
const mapStr = (m) => `${m.p.map((b) => (b ? 1 : 0)).join('')}|${m.s.map((b) => (b ? 1 : 0)).join('')}`;
const mapMeters = (st, m) => m.s.reduce((a, b, j) => a + (b ? Math.min(st.length_m, (j + 1) * 2) - j * 2 : 0), 0);

// A négy oldal elrendezése: a téglalap szélessége az É/D, magassága a K/Ny oldal kerítéséhez igazodik.
function frame(stages) {
  const end = [0, 0, 0, 0];
  for (const st of stages) { const s = sideOf(st); if (s) end[s.i] = Math.max(end[s.i], st.from_m + st.length_m); }
  const W = Math.max(end[0], end[2], 8), H = Math.max(end[1], end[3], 8);
  const origin = [[0, 0], [W, 0], [0, H], [0, 0]];
  const place = {};
  for (const st of stages) {
    const s = sideOf(st);
    if (!s) continue;
    const o = origin[s.i];
    const a = [o[0] + s.dx * st.from_m, o[1] + s.dy * st.from_m];
    place[st.id] = { a, b: [a[0] + s.dx * st.length_m, a[1] + s.dy * st.length_m], dx: s.dx, dy: s.dy, nx: s.nx, ny: s.ny, side: s };
  }
  return { W, H, end, place };
}

// ---------------------------------------------------------------------------
// Rajzelemek
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
const ext = (s, w) => Math.abs(s.nx) * w / 2 + Math.abs(s.ny) * 13;
const pill = (x, y, html, cls = '') => `<foreignObject x="${(x - 90).toFixed(1)}" y="${(y - 13).toFixed(1)}" width="180" height="26" class="fo"><div class="pill-wrap"><span class="vpill ${cls}">${html}</span></div></foreignObject>`;

function fenceView(Wpx) {
  const stages = js.detail.stages;
  const fr = frame(stages);
  const narrow = Wpx < 600;
  const padX = js.edit ? (narrow ? 84 : 120) : (narrow ? 34 : 96);
  const padY = js.edit ? 62 : (narrow ? 34 : 56);
  const maxH = narrow ? 520 : 600;
  const k = Math.min((Wpx - 2 * padX) / fr.W, (maxH - 2 * padY) / fr.H, 40);
  const Hpx = fr.H * k + 2 * padY;
  const ox = (Wpx - fr.W * k) / 2, oy = padY;
  js.view = { k, ox, oy, place: fr.place, W: Wpx, H: Hpx };
  const X = (p) => ox + p[0] * k, Y = (p) => oy + p[1] * k;
  let g = '';

  // Rács és a „telek” kerete
  const step = k >= 9 ? 5 : k >= 4 ? 10 : 20;
  let grid = '';
  for (let x = -Math.ceil(ox / k / step) * step; ox + x * k <= Wpx; x += step) grid += `M${(ox + x * k).toFixed(1)} 0V${Hpx}`;
  for (let y = -Math.ceil(oy / k / step) * step; oy + y * k <= Hpx; y += step) grid += `M0 ${(oy + y * k).toFixed(1)}H${Wpx}`;
  g += `<path d="${grid}" stroke="var(--line)" stroke-width="1" opacity=".4"/>`;
  g += `<rect x="${ox}" y="${oy}" width="${fr.W * k}" height="${fr.H * k}" fill="rgba(255,255,255,.03)" stroke="#5b6066" stroke-width="1.2" stroke-dasharray="6 5"/>`;

  // Kerítés
  const S = Math.max(6, Math.min(16, k * 0.45)), t = S * 0.34;
  stages.forEach((st, idx) => {
    const pl = fr.place[st.id];
    if (!pl) return;
    const L = st.length_m, done = Math.min(st.done_m, L), spans = Math.max(1, Math.ceil(L / 2 - 1e-9));
    const rot = pl.dy ? 90 : 0;
    const px = (m) => m * k;
    const cls = js.sel && js.sel !== st.id ? 'dim' : js.sel === st.id ? 'sel' : '';
    let f = `<g data-stage-g="${st.id}" class="${cls}" transform="translate(${X(pl.a).toFixed(1)} ${Y(pl.a).toFixed(1)}) rotate(${rot})">`;
    if (js.edit) f += `<rect data-hit="${st.id}" x="0" y="-16" width="${px(L).toFixed(1)}" height="32" fill="transparent" style="cursor:pointer"/>`;
    const map = stageMap(st);
    // Panelek: mindegyik külön kattintható (a láthatatlan sáv az egész oszlopközt lefedi).
    for (let j = 0; j < spans; j++) {
      const d0 = j * 2, d1 = Math.min(L, (j + 1) * 2);
      const x0 = px(d0) + S * 0.15, x1 = px(d1) - S * 0.15;
      const ok = map.s[j];
      f += `<rect pointer-events="none" x="${x0.toFixed(1)}" y="${(-t / 2).toFixed(1)}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${t.toFixed(1)}" rx="1" fill="${ok ? RED : '#8d9299'}"/>`;
      if (!js.edit) f += `<rect data-el="s:${j}" data-st="${st.id}" x="${(px(d0) + S / 2).toFixed(1)}" y="-14" width="${Math.max(2, px(d1) - px(d0) - S).toFixed(1)}" height="28" fill="transparent"/>`;
    }
    for (let j = 0; j <= spans; j++) {
      const d = Math.min(j * 2, L), isEnd = j === 0 || j === spans;
      const ok = map.p[j];
      f += `<path pointer-events="none" transform="translate(${px(d).toFixed(1)} 0)" d="${postPath(S * (isEnd ? 1.1 : 1), { l: j > 0, r: j < spans })}" fill="${ok ? '#a51d1d' : '#d9dbde'}" stroke="${ok ? '#ff8a8a' : '#16181b'}" stroke-width="${ok ? .8 : 1}"/>`;
      if (!js.edit) f += `<rect data-el="p:${j}" data-st="${st.id}" x="${(px(d) - S / 2 - 1).toFixed(1)}" y="-14" width="${(S + 2).toFixed(1)}" height="28" fill="transparent"/>`;
    }
    f += '</g>';
    g += f;
    // Címke: sorszám és méter (befelé, a kereten belül)
    const mid = [(pl.a[0] + pl.b[0]) / 2, (pl.a[1] + pl.b[1]) / 2];
    const st2 = done >= L - 1e-6 ? 'ok' : done > 0 ? 'part' : '';
    if (narrow) {
      g += `<g data-hit="${st.id}" style="cursor:pointer" transform="translate(${X(mid).toFixed(1)} ${Y(mid).toFixed(1)})"><circle r="10" fill="${st2 === 'ok' ? RED : '#2c3035'}" stroke="${st2 ? RED : '#fff'}" stroke-width="2"/>
        <text y="4" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">${idx + 1}</text></g>`;
    } else {
      const txt = done > 0 && done < L ? `${m1(done)}/${m1(L)} m` : `${m1(L)} m`;
      const off = 14 + ext(pl, 34 + txt.length * 7.2);
      g += `<g data-hit="${st.id}" style="cursor:pointer">${pill(X(mid) - pl.nx * off, Y(mid) - pl.ny * off, `<i>${idx + 1}</i>${txt}`, `stage ${st2}`)}</g>`;
    }
  });

  // Oldalak: név (és szerkesztésben „+ Szakasz”) kívül
  for (const s of SIDES) {
    const mid = s.i === 0 ? [fr.W / 2, 0] : s.i === 1 ? [fr.W, fr.H / 2] : s.i === 2 ? [fr.W / 2, fr.H] : [0, fr.H / 2];
    const has = fr.end[s.i] > 0;
    const label = `<b>${s.short}</b>${has ? `${m1(stages.filter((x) => sideOf(x) === s).reduce((a, x) => a + x.length_m, 0))} m` : ''}`;
    if (js.edit) {
      const off = narrow ? 30 : 46;
      const lx = X(mid) + s.nx * (narrow ? 44 : off + 20), ly = Y(mid) + s.ny * off;
      g += `<g data-add-side="${s.i}" style="cursor:pointer">${pill(lx, ly, `+ ${narrow ? s.short : s.name}`, 'add')}</g>`;
    } else if (!narrow) {
      const off = 14 + ext(s, 40);
      g += pill(X(mid) + s.nx * off, Y(mid) + s.ny * off, label, 'side');
    }
  }

  // Lépték
  const nice = [1, 2, 5, 10, 20, 50].find((m) => m * k >= 50) || 50;
  g += `<g transform="translate(14 ${Hpx - 12})" opacity=".8"><path d="M0 -5V0H${nice * k}V-5" stroke="var(--muted)" fill="none"/>
    <text x="${nice * k + 6}" y="0" font-size="10" fill="var(--muted)">${nice} m</text></g>`;
  return `<svg class="pv" viewBox="0 0 ${Wpx} ${Hpx.toFixed(0)}" width="${Wpx}" height="${Hpx.toFixed(0)}">${g}</svg>`;
}

// Kártya-előnézet
function miniPlot(j) {
  if (!j.stages.length) return '<span class="muted small">Még nincs kerítés</span>';
  const fr = frame(j.stages);
  const W = 300, H = 110, pad = 12, k = Math.min((W - 2 * pad) / fr.W, (H - 2 * pad) / fr.H);
  const ox = (W - fr.W * k) / 2, oy = (H - fr.H * k) / 2;
  const P = (p) => `${(ox + p[0] * k).toFixed(1)},${(oy + p[1] * k).toFixed(1)}`;
  let g = `<rect x="${ox}" y="${oy}" width="${fr.W * k}" height="${fr.H * k}" fill="rgba(255,255,255,.04)" stroke="#5b6066" stroke-dasharray="3 3"/>`;
  for (const st of j.stages) {
    const pl = fr.place[st.id];
    if (!pl) continue;
    const d = [pl.a[0] + pl.dx * Math.min(st.done_m, st.length_m), pl.a[1] + pl.dy * Math.min(st.done_m, st.length_m)];
    g += `<polyline points="${P(pl.a)} ${P(pl.b)}" stroke="#9aa0a6" stroke-width="5"/>`;
    if (st.done_m > 0) g += `<polyline points="${P(pl.a)} ${P(d)}" stroke="${RED}" stroke-width="5"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="mini-plot">${g}</svg>`;
}

// ===================================================================
export function initJobs(config) {
  js.templates = config.panelTemplates;
  $('#stage-template').innerHTML = js.templates.map((t) => `<option>${esc(t)}</option>`).join('');
  $('#stage-side').innerHTML = SIDES.map((s) => `<option value="${s.i}">${s.name} (${s.i % 2 ? 'függőleges' : 'vízszintes'})</option>`).join('');
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
  showJob(id, true);
});

async function showJob(id, scroll) {
  const j = js.jobs.find((x) => x.id === id);
  if (!j) return;
  if (js.shownId !== id) { js.edit = false; js.sel = null; }
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
  $('#jd-tiles').innerHTML = `
    <span>Kerítés <b>${m1(t.m)}</b><small>m</small></span>
    <span>Panel <b>${t.panels}</b><small>db</small></span>
    <span>Végoszlop <b>${t.veg}</b></span>
    <span>Középoszlop <b>${t.kozep}</b></span>`;
  const pct = t.m ? Math.round((t.done / t.m) * 100) : 0;
  $('#jd-progress').innerHTML = t.m ? `<div class="progress-head"><span>Kész: <b>${m1(t.done)} m</b> · hátra: ${m1(t.m - t.done)} m</span><b>${pct}%</b></div>
    <div class="bar big ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>` : '';

  renderFence();
  renderInstall();
  $('#jd-summary tbody').innerHTML = s.summary.map((x) => `<tr><td>${esc(x.item)}</td><td class="num">${x.needed}</td>
    <td class="num">${x.in_stock}</td><td class="num ${x.missing ? 'neg' : ''}">${x.missing}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">Adj hozzá szakaszt.</td></tr>';
  if (scroll) $('#job-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
// Kerítés-nézet (alap / szerkesztés)
function renderFence() {
  const box = $('#plot-view');
  const stages = js.detail.stages;
  $('#plot-tools').innerHTML = js.edit
    ? '<button class="btn success sm" data-tool="done" type="button">✓ Kész a szerkesztés</button>'
    : `<button class="btn sm" data-tool="edit" type="button">✎ ${stages.length ? 'Kerítés szerkesztése' : 'Kerítés megadása'}</button>`;
  $('#plot-view').classList.toggle('editing', js.edit);
  if (!stages.length && !js.edit) {
    box.innerHTML = `<div class="pv-empty"><p>Még nincs kerítés ennél a projektnél.</p><button class="btn primary" type="button" data-tool="edit">✎ Kerítés megadása</button>
      <p class="muted small">A szerkesztésben a négy oldalon (É, K, D, Ny) adhatsz hozzá szakaszt.</p></div>`;
    $('#plot-hint').textContent = '';
  } else {
    box.innerHTML = fenceView(Math.max(300, box.clientWidth)) + popHtml();
    $('#plot-hint').textContent = js.edit
      ? 'Szerkesztés: „+” az adott oldalra tesz új szakaszt (É és D vízszintes, K és Ny függőleges). Koppints egy szakaszra a módosításhoz vagy törléshez.'
      : 'Koppints egy oszlopra vagy panelre: kész lesz (újra koppintva visszavált). Húzással egyszerre többet jelölhetsz. A szakasz sorszámára koppintva: Mind kész / Nincs kész.';
  }
  renderStageList();
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (!$('#job-detail').hidden && js.detail) renderFence(); }, 150); });

function popHtml() {
  const st = js.sel && js.detail.stages.find((x) => x.id === js.sel);
  const pl = st && js.view?.place[st.id];
  if (!pl) return '';
  const { k, ox, oy, W } = js.view;
  const mid = [(pl.a[0] + pl.b[0]) / 2, (pl.a[1] + pl.b[1]) / 2];
  const x = Math.min(W - 130, Math.max(130, ox + mid[0] * k)), y = oy + mid[1] * k;
  const idx = js.detail.stages.indexOf(st) + 1;
  const below = y < 170;
  const body = js.edit
    ? `<div class="row-btns wrap"><button class="btn sm" type="button" data-pop="edit">✎ Módosítás</button><button class="btn sm ghost" type="button" data-pop="del">✕ Törlés</button></div>`
    : `<div class="small">Kész: <b>${m1(st.done_m)}</b> / ${m1(st.length_m)} m ${st.manual ? '<span class="chip-s">kézzel jelölve</span>' : '<span class="muted">(napi lapból)</span>'}</div>
       <div class="row-btns wrap"><button class="btn sm success" type="button" data-pop="all">✓ Mind kész</button><button class="btn sm" type="button" data-pop="zero">Nincs kész</button>
       ${st.manual ? `<button class="btn sm ghost" type="button" data-pop="auto">Napi lap szerint (${m1(st.done_auto)} m)</button>` : ''}</div>`;
  return `<div class="pv-pop ${below ? 'below' : ''}" style="left:${x}px;top:${below ? y + 24 : y - 24}px">
    <div class="pv-pop-h"><span class="stage-no">${idx}</span><b>${esc(st.stage_name)}</b><button class="pv-x" type="button" data-pop="close" aria-label="Bezárás">✕</button></div>
    <div class="small muted">${pl.side.name} · ${m1(st.from_m)}–${m1(st.from_m + st.length_m)} m · ${esc(st.template)}</div>${body}</div>`;
}

function toMeters(svg, ev) {
  const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [(p.x - js.view.ox) / js.view.k, (p.y - js.view.oy) / js.view.k];
}
function alongStage(st, m) {
  const s = js.view.place[st.id];
  const d = (m[0] - s.a[0]) * s.dx + (m[1] - s.a[1]) * s.dy;
  if (d >= st.length_m - 1) return st.length_m;
  return Math.max(0, Math.min(st.length_m, Math.round(d / 2) * 2));
}

// Oszlop / panel jelölése: koppintás átvált, húzásnál az első elem új állapotával fest végig.
$('#plot-view').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-el]');
  if (!el || js.edit) return;
  e.preventDefault();
  const box = $('#plot-view');
  const maps = {};
  const getMap = (id) => (maps[id] ||= stageMap(js.detail.stages.find((x) => x.id === id)));
  const apply = (node) => {
    const id = +node.dataset.st, [kind, j] = node.dataset.el.split(':');
    const m = getMap(id);
    if (m[kind][+j] === paint) return false;
    m[kind][+j] = paint;
    return true;
  };
  const first = getMap(+el.dataset.st);
  const [k0, j0] = el.dataset.el.split(':');
  const paint = !first[k0][+j0];
  apply(el);
  const redraw = () => {
    for (const [id, m] of Object.entries(maps)) { const st = js.detail.stages.find((x) => x.id === +id); st.done_map = mapStr(m); st.done_m = mapMeters(st, m); }
    box.innerHTML = fenceView(Math.max(300, box.clientWidth)) + popHtml();
  };
  redraw();
  box.setPointerCapture?.(e.pointerId);
  const move = (ev) => {
    const node = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-el]');
    if (node && apply(node)) redraw();
  };
  const up = async () => {
    box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
    try {
      for (const [id, m] of Object.entries(maps)) await api(`/api/stages/${id}`, { method: 'PATCH', body: { done_map: mapStr(m) }, quiet: false });
    } finally { loadJobs(); }
  };
  box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
});

$('#plot-view').addEventListener('click', (e) => {
  const tool = e.target.closest('[data-tool]');
  if (tool) return setEdit(tool.dataset.tool === 'edit');
  const add = e.target.closest('[data-add-side]');
  if (add && js.edit) return openStage(null, +add.dataset.addSide);
  const pop = e.target.closest('[data-pop]');
  if (pop) return popAction(pop.dataset.pop);
  if (e.target.closest('.pv-pop') || e.target.closest('[data-el]')) return;
  const hit = e.target.closest('[data-hit]');
  js.sel = hit ? (js.sel === +hit.dataset.hit ? null : +hit.dataset.hit) : null;
  renderFence();
});
$('#plot-tools').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) setEdit(b.dataset.tool === 'edit');
});
function setEdit(on) { js.edit = on; js.sel = null; renderFence(); }

async function popAction(a) {
  const st = js.detail.stages.find((x) => x.id === js.sel);
  if (a === 'close' || !st) { js.sel = null; return renderFence(); }
  if (a === 'edit') return openStage(st);
  if (a === 'del') {
    if (!confirm(`Törlöd: ${st.stage_name}?`)) return;
    await api(`/api/stages/${st.id}`, { method: 'DELETE' }); js.sel = null; toast('Törölve'); return loadJobs();
  }
  if (a === 'auto') { await api(`/api/stages/${st.id}`, { method: 'PATCH', body: { done_manual: null } }); toast('Napi lap szerint'); return loadJobs(); }
  const m = stageMap(st), on = a === 'all';
  m.p = m.p.map(() => on); m.s = m.s.map(() => on);
  await api(`/api/stages/${st.id}`, { method: 'PATCH', body: { done_map: mapStr(m) } });
  toast(on ? `${st.stage_name}: minden kész` : `${st.stage_name}: semmi sincs kész`); loadJobs();
}

// Szakaszlista a nézet alatt; módosítani csak szerkesztésben lehet.
function renderStageList() {
  const stages = js.detail.stages;
  $('#stage-new').hidden = !js.edit;
  $('#stage-list').innerHTML = stages.map((x, i) => {
    const s = sideOf(x);
    const pos = s ? `${s.name} · ${m1(x.from_m)}–${m1(x.from_m + x.length_m)} m` : '<span class="neg">nincs oldalhoz rendelve – szerkesztésben állítsd be</span>';
    const pct = Math.round((x.done_m / x.length_m) * 100);
    return `<div class="stage-row" data-stage="${x.id}">
      <span class="stage-no ${pct >= 100 ? 'ok' : pct > 0 ? 'part' : ''}">${i + 1}</span>
      <div class="stage-info"><div><b>${esc(x.stage_name)}</b> <span class="tpl-chip" style="--c:${TPL_ACCENT[x.template] || '#888'}">${esc(x.template)}</span></div>
        <div class="muted small">${pos} · ${x.spans} köz · ${x.panels} panel</div></div>
      <div class="band-done"><b>${m1(x.done_m)}</b> / ${m1(x.length_m)} m
        <div class="small">${x.manual ? '<span class="chip-s">kézzel</span>' : '<span class="muted">napi lapból</span>'}</div></div>
      ${js.edit ? `<span class="row-btns"><button class="btn sm ghost" data-edit-stage="${x.id}" aria-label="Módosítás">✎</button><button class="btn sm ghost" data-del-stage="${x.id}" aria-label="Törlés">✕</button></span>` : ''}
    </div>`;
  }).join('') || '<p class="muted small">Még nincs szakasz.</p>';
}
$('#stage-list').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-edit-stage]');
  const del = e.target.closest('[data-del-stage]');
  if (ed) return openStage(js.detail.stages.find((x) => x.id === +ed.dataset.editStage));
  if (del) { if (confirm('Törlöd a szakaszt?')) { await api(`/api/stages/${del.dataset.delStage}`, { method: 'DELETE' }); loadJobs(); } return; }
  const row = e.target.closest('[data-stage]');
  if (row) { js.sel = +row.dataset.stage; renderFence(); $('#plot-view').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
});
$('#stage-new').addEventListener('click', () => openStage(null, 0));

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
// Szakasz felvétele / módosítása (oldal, kezdés a sarokból, hossz, minta)
function sideEnd(side, exceptId) {
  return js.detail.stages.filter((x) => x.side === side && x.id !== exceptId).reduce((a, x) => Math.max(a, x.from_m + x.length_m), 0);
}
function openStage(st, side = 0) {
  js.editingStage = st;
  const f = $('#stage-form'); f.reset();
  $('#stage-dialog-title').textContent = st ? 'Szakasz módosítása' : `Új szakasz – ${SIDES[side]?.name || ''}`;
  f.querySelector('[type=submit]').textContent = st ? 'Mentés' : 'Hozzáadás';
  if (st) {
    f.stage_name.value = st.stage_name; f.length_m.value = st.length_m; f.template.value = st.template;
    f.note.value = st.note || ''; f.side.value = sideOf(st) ? st.side : side; f.from_m.value = st.from_m || 0;
  } else {
    if (js.detail.stages.length) f.template.value = js.detail.stages.at(-1).template;
    f.side.value = side;
    f.from_m.value = +sideEnd(side).toFixed(2);
    f.stage_name.value = `${SIDES[side].adj.charAt(0).toUpperCase() + SIDES[side].adj.slice(1)} oldal`;
  }
  previewStage();
  $('#stage-dialog').showModal();
  if (!st) f.length_m.focus();
}
function previewStage() {
  const f = $('#stage-form');
  const s = SIDES[+f.side.value];
  f.querySelector('[data-for="from"] .lbl').textContent = `Kezdés ${s.from} (m)`;
  const len = parseFloat(String(f.length_m.value).replace(',', '.'));
  const box = $('#stage-preview');
  if (!(len >= 0.5)) { box.innerHTML = `<p class="muted small">${s.name}i oldal: ${s.i % 2 ? 'függőleges' : 'vízszintes'}. Add meg a hosszt.</p>`; return; }
  const c = stageCalc(len);
  const from = parseFloat(String(f.from_m.value).replace(',', '.')) || 0;
  box.innerHTML = `<p class="small">${c.spans} oszlopköz · <b>${c.panels} panel</b> · ${c.veg} végoszlop + ${c.kozep} középoszlop${len % 2 ? ` <span class="muted">(az utolsó köz ${fmt(len - 2 * (c.spans - 1), 1)} m)</span>` : ''}</p>
    <p class="muted small">${s.name}: ${m1(from)} m-től ${m1(from + len)} m-ig, ${s.from}.</p>`;
}
$('#stage-form').addEventListener('input', previewStage);
$('#stage-side').addEventListener('change', () => {
  const f = $('#stage-form');
  if (!js.editingStage) f.from_m.value = +sideEnd(+f.side.value).toFixed(2);
  previewStage();
});
$('#stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  v.length_m = String(v.length_m).replace(',', '.');
  v.from_m = String(v.from_m || 0).replace(',', '.');
  v.heading = ''; v.anchor_id = '';
  if (js.editingStage) await api(`/api/stages/${js.editingStage.id}`, { method: 'PATCH', body: v });
  else await api(`/api/jobs/${js.selected}/stages`, { method: 'POST', body: v });
  $('#stage-dialog').close(); toast('Mentve'); js.sel = null; loadJobs();
});
