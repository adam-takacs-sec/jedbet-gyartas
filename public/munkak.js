// Munkák: projektenként egy telek (felülnézet, méterben), a kerítésszakaszok a telek oldalain.
// Egyetlen nézet: a telek a kerítéssel (H-profilú oszlopok, panelek; szürke = hátra, piros = kész),
// a „kész” jelölő közvetlenül a kerítésen húzható. A telek sarkai húzhatók, az oldalhossz beírható.
import { $, $$, esc, fmt, ft, api, toast } from './lib.js';

const js = {
  templates: [], jobs: [], filter: 'Aktív', selected: null, shownId: null, detail: null, job: null,
  editingStage: null, editingJob: false, mode: 'view', draft: null, view: null,
};
try { js.filter = localStorage.getItem('jobFilter') ?? 'Aktív'; } catch {}

const RED = '#d62828';
const TPL_ACCENT = { 'Mediterrán': '#d4a72c', 'Homokkő': '#c06b3e', 'Hullám': '#3d8fd1' };
const TURNS = [[90, 'Jobbra fordul (derékszög)'], [-90, 'Balra fordul (derékszög)'], [0, 'Egyenesen tovább'], [45, 'Jobbra, ferdén (45°)'], [-45, 'Balra, ferdén (45°)']];
const SIDE = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');

// 2 m = 1 oszlopköz = 4 panel; szakaszonként 2 végoszlop (ugyanaz, mint a szerveren).
const stageCalc = (len) => {
  const spans = Math.max(1, Math.ceil(len / 2 - 1e-9));
  return { spans, panels: spans * 4, veg: 2, kozep: spans - 1 };
};
const daysLeft = (d) => (d ? Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 86400000) : null);
const m1 = (v) => fmt(v, Math.abs(v % 1) > 0.05 ? 1 : 0);
const r1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Telek-geometria (méterben; x jobbra, y lefelé). A régi, térképről rajzolt (fok) telkeket átszámoljuk.
function plotPoints(plot) {
  if (!plot?.points?.length) return [];
  if (plot.unit === 'm') return plot.points.map(([x, y]) => [x, y]);
  const [la0, lo0] = plot.points[0], c = Math.cos((la0 * Math.PI) / 180);
  return plot.points.map(([la, lo]) => [r1((lo - lo0) * c * 111320), r1(-(la - la0) * 110540)]);
}
const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
function sides(plot, pts = plotPoints(plot)) {
  const centroid = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], geo = dist(a, b) || 1e-6;
    const dx = (b[0] - a[0]) / geo, dy = (b[1] - a[1]) / geo;
    // Kifelé mutató normális (a telek közepétől el).
    let nx = -dy, ny = dx;
    const mid = lerp(a, b, 0.5);
    if ((mid[0] + nx - centroid[0]) ** 2 + (mid[1] + ny - centroid[1]) ** 2 < (mid[0] - nx - centroid[0]) ** 2 + (mid[1] - ny - centroid[1]) ** 2) { nx = -nx; ny = -ny; }
    const over = plot?.unit === 'm' ? null : plot?.lengths?.[i];
    return { i, a, b, geo, len: over || geo, dx, dy, nx, ny };
  });
}

// Telek nélkül: a szakaszok egymás után, mindegyik az előző végétől, a megadott fordulással (+ = jobbra).
function chainSides(stages) {
  let x = 0, y = 0, h = 0;
  const raw = stages.map((st, i) => {
    if (i > 0) h += Number(st.turn ?? 90);
    const r = (h * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
    const a = [x, y], b = [x + dx * st.length_m, y + dy * st.length_m];
    x = b[0]; y = b[1];
    return { i, a, b, geo: st.length_m, len: st.length_m, dx, dy };
  });
  const all = raw.flatMap((s) => [s.a, s.b]);
  const c = all.reduce((a, p) => [a[0] + p[0] / all.length, a[1] + p[1] / all.length], [0, 0]);
  return raw.map((s) => {
    let nx = -s.dy, ny = s.dx;
    const mid = lerp(s.a, s.b, 0.5);
    if ((mid[0] + nx - c[0]) ** 2 + (mid[1] + ny - c[1]) ** 2 < (mid[0] - nx - c[0]) ** 2 + (mid[1] - ny - c[1]) ** 2) { nx = -nx; ny = -ny; }
    if (raw.length === 1) { nx = 0; ny = -1; }
    return { ...s, nx, ny };
  });
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
// Egy (vízszintes) címke fél kiterjedése az oldal kifelé mutató normálisa mentén.
const ext = (sd, w) => Math.abs(sd.nx) * w / 2 + Math.abs(sd.ny) * 13;
const pill = (x, y, html, cls = '') => `<foreignObject x="${(x - 80).toFixed(1)}" y="${(y - 13).toFixed(1)}" width="160" height="26" class="fo"><div class="pill-wrap"><span class="vpill ${cls}">${html}</span></div></foreignObject>`;

// A teljes nézet: telek + kerítés. Visszaadja az SVG-t; a nézet adatai (lépték, eltolás) js.view-ba kerülnek.
function plotView(W) {
  const edit = js.mode === 'edit';
  const hasPlot = edit || plotPoints(js.job.plot).length >= 3;
  const pts = edit ? js.draft : hasPlot ? plotPoints(js.job.plot) : [];
  const sd = hasPlot ? sides(edit ? { unit: 'm' } : js.job.plot, pts) : [];
  // Melyik szakasz hol fut: telekoldalon, vagy (telek nélkül) egymás után láncolva, a megadott fordulással.
  const place = {};
  const stagesAll = edit ? [] : js.detail.stages;
  if (hasPlot) {
    for (const st of stagesAll) if (sd[st.side]) place[st.id] = { s: sd[st.side], from: st.from_m };
  } else {
    const chain = chainSides(stagesAll);
    stagesAll.forEach((st, i) => { place[st.id] = { s: chain[i], from: 0 }; });
  }
  const geoPts = hasPlot ? pts : Object.values(place).flatMap((x) => [x.s.a, x.s.b]);
  if (!geoPts.length) return '';
  const xs = geoPts.map((p) => p[0]), ys = geoPts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // Telefonon a címkék a telek belsejébe kerülnek, így kevés margó is elég, és nagyobb a rajz.
  const narrow = W < 600, inSide = narrow ? -1 : 1;
  const pad = narrow ? 22 : 84;
  const maxH = W < 600 ? 520 : 600;
  const k = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1), (maxH - 2 * pad) / Math.max(maxY - minY, 1), 40);
  const H = Math.max(220, (maxY - minY) * k + 2 * pad);
  const ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = (H - (maxY - minY) * k) / 2 - minY * k;
  js.view = { k, ox, oy, sd, pts, place };
  const X = (p) => ox + p[0] * k, Y = (p) => oy + p[1] * k;
  const XY = (p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`;
  let g = '';

  // Rács (5 m, ritkábban, ha kicsi a lépték)
  const step = k >= 9 ? 5 : k >= 4 ? 10 : 20;
  const gx0 = Math.floor((minX - pad / k) / step) * step, gx1 = Math.ceil((maxX + pad / k) / step) * step;
  const gy0 = Math.floor((minY - pad / k) / step) * step, gy1 = Math.ceil((maxY + pad / k) / step) * step;
  let grid = '';
  for (let x = gx0; x <= gx1; x += step) grid += `M${(ox + x * k).toFixed(1)} 0V${H}`;
  for (let y = gy0; y <= gy1; y += step) grid += `M0 ${(oy + y * k).toFixed(1)}H${W}`;
  g += `<path d="${grid}" stroke="var(--line)" stroke-width="1" opacity=".45"/>`;

  // Telek
  if (hasPlot) g += `<polygon points="${pts.map(XY).join(' ')}" fill="${edit ? 'rgba(214,40,40,.06)' : 'rgba(255,255,255,.035)'}" stroke="${edit ? RED : '#6b7078'}" stroke-width="${edit ? 2 : 1.3}" stroke-dasharray="${edit ? '' : '6 5'}"/>`;

  // Kerítés a szakaszok szerint
  const S = Math.max(6, Math.min(16, k * 0.45)), t = S * 0.34;
  stagesAll.forEach((st, idx) => {
    const pl = place[st.id];
    if (!pl) return;
    const sdx = pl.s;
    const scale = sdx.geo / sdx.len; // ha a valós hossz el van térítve a rajzolttól
    const start = lerp(sdx.a, sdx.b, Math.min(1, pl.from / sdx.len));
    const L = st.length_m, done = Math.min(st.done_m, L), spans = Math.max(1, Math.ceil(L / 2 - 1e-9));
    const rot = (Math.atan2(sdx.dy, sdx.dx) * 180) / Math.PI;
    const px = (m) => m * scale * k;
    let f = `<g data-stage-g="${st.id}" transform="translate(${X(start).toFixed(1)} ${Y(start).toFixed(1)}) rotate(${rot.toFixed(2)})">`;
    f += `<rect data-hit="${st.id}" x="0" y="-16" width="${px(L).toFixed(1)}" height="32" fill="transparent" style="cursor:pointer"/>`;
    for (let j = 0; j < spans; j++) {
      const d0 = j * 2, d1 = Math.min(L, (j + 1) * 2);
      const x0 = px(d0) + S * 0.15, x1 = px(d1) - S * 0.15;
      const ok = d1 <= done + 1e-6;
      f += `<rect x="${x0.toFixed(1)}" y="${(-t / 2).toFixed(1)}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${t.toFixed(1)}" rx="1" fill="${ok ? RED : '#8d9299'}" pointer-events="none"/>`;
      if (!ok && done > d0) f += `<rect x="${x0.toFixed(1)}" y="${(-t / 2).toFixed(1)}" width="${Math.max(0, px(done) - x0).toFixed(1)}" height="${t.toFixed(1)}" rx="1" fill="${RED}" pointer-events="none"/>`;
    }
    for (let j = 0; j <= spans; j++) {
      const d = Math.min(j * 2, L), isEnd = j === 0 || j === spans;
      const ok = done > 0 && d <= done + 1e-6;
      f += `<path pointer-events="none" transform="translate(${px(d).toFixed(1)} 0)" d="${postPath(S * (isEnd ? 1.1 : 1), { l: j > 0, r: j < spans })}" fill="${ok ? '#a51d1d' : '#d9dbde'}" stroke="${ok ? '#ff8a8a' : '#16181b'}" stroke-width="${ok ? .8 : 1}"/>`;
    }
    // Húzható „idáig kész” jelölő
    f += `<g data-knob="${st.id}" transform="translate(${px(done).toFixed(1)} 0)" style="cursor:ew-resize"><circle r="16" fill="transparent"/>
      <circle r="7.5" fill="${RED}" stroke="#fff" stroke-width="2.5"/></g>`;
    f += '</g>';
    g += f;
    // Címke kifelé: sorszám és kész / teljes méter
    const mid = lerp(start, [start[0] + sdx.dx * L * scale, start[1] + sdx.dy * L * scale], 0.5);
    const txt = done > 0 && done < L ? `${m1(done)}/${m1(L)} m` : `${m1(L)} m`;
    // Az oldal címkéje mögé, kifelé (a címkék szélességét a normális irányában számolva).
    const sideW = 30 + `${m1(sdx.len)} m`.length * 6.5;
    const off = (hasPlot ? 14 + 2 * ext(sdx, sideW) + 6 : 16) + ext(sdx, 34 + txt.length * 7.2);
    const lx = X(mid) + sdx.nx * off * inSide, ly = Y(mid) + sdx.ny * off * inSide;
    const cls = done >= L - 1e-6 ? 'ok' : done > 0 ? 'part' : '';
    g += pill(lx, ly, `<i>${idx + 1}</i>${txt}`, `stage ${cls}`);
  });

  // Oldalak címkéi (szerkesztéskor koppintható a pontos hosszhoz)
  for (const x of sd) {
    const mid = lerp(x.a, x.b, 0.5);
    const off = 14 + ext(x, 30 + `${m1(x.len)} m`.length * 6.5);
    const lx = X(mid) + x.nx * off * inSide, ly = Y(mid) + x.ny * off * inSide;
    g += edit
      ? `<g data-side-len="${x.i}" style="cursor:pointer">${pill(lx, ly, `<b>${SIDE(x.i)}</b>${m1(x.len)} m ✎`, 'side edit')}</g>`
      : pill(lx, ly, `<b>${SIDE(x.i)}</b>${m1(x.len)} m`, 'side');
  }

  // Szerkesztés: sarkok és beszúrás
  if (edit) {
    sd.forEach((x) => {
      const m = lerp(x.a, x.b, 0.5);
      g += `<g data-add="${x.i}" transform="translate(${X(m) - x.nx * 18} ${Y(m) - x.ny * 18})" style="cursor:pointer"><circle r="11" fill="rgba(0,0,0,.6)" stroke="#fff"/><text y="4.5" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">+</text></g>`;
    });
    pts.forEach((p, i) => {
      g += `<g data-vtx="${i}" transform="translate(${X(p).toFixed(1)} ${Y(p).toFixed(1)})" style="cursor:move"><circle r="18" fill="transparent"/>
        <rect x="-8" y="-8" width="16" height="16" rx="3" fill="#fff" stroke="${RED}" stroke-width="3"/></g>`;
    });
  }

  // Lépték
  const nice = [1, 2, 5, 10, 20, 50].find((m) => m * k >= 50) || 50;
  g += `<g transform="translate(14 ${H - 14})" opacity=".8"><path d="M0 -5V0H${nice * k}V-5" stroke="var(--muted)" fill="none"/>
    <text x="${nice * k + 6}" y="0" font-size="10" fill="var(--muted)">${nice} m</text></g>`;
  return `<svg class="pv" viewBox="0 0 ${W} ${H.toFixed(0)}" width="${W}" height="${H.toFixed(0)}">${g}</svg>`;
}

// ---------------------------------------------------------------------------
// Kártya-előnézet: a telek körvonala és rajta a szakaszok (szürke / piros).
function miniPlot(j) {
  const pts = plotPoints(j.plot);
  if (!pts.length) {
    if (!j.stages.length) return '<span class="muted small">Nincs telek és szakasz</span>';
    const tot = j.stages.reduce((a, s) => a + s.length_m, 0);
    return `<div class="mini-bars">${j.stages.map((s) => `<span style="flex:${s.length_m}"><i style="width:${(s.done_m / s.length_m) * 100}%"></i></span>`).join('')}</div>
      <span class="muted small">${m1(tot)} m · telek még nincs megadva</span>`;
  }
  const sd = sides(j.plot, pts);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX || 1, h = Math.max(...ys) - minY || 1;
  const W = 300, H = 110, pad = 10, k = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
  const ox = (W - w * k) / 2 - minX * k, oy = (H - h * k) / 2 - minY * k;
  const P = (p) => `${(ox + p[0] * k).toFixed(1)},${(oy + p[1] * k).toFixed(1)}`;
  let g = `<polygon points="${pts.map(P).join(' ')}" fill="rgba(255,255,255,.05)" stroke="#5b6066" stroke-width="1.2" stroke-dasharray="3 3"/>`;
  for (const st of j.stages) {
    const s = sd[st.side];
    if (!s) continue;
    const f0 = Math.min(1, st.from_m / s.len), f1 = Math.min(1, (st.from_m + st.length_m) / s.len), fd = Math.min(f1, (st.from_m + st.done_m) / s.len);
    g += `<polyline points="${P(lerp(s.a, s.b, f0))} ${P(lerp(s.a, s.b, f1))}" stroke="#9aa0a6" stroke-width="5"/>`;
    if (st.done_m > 0) g += `<polyline points="${P(lerp(s.a, s.b, f0))} ${P(lerp(s.a, s.b, fd))}" stroke="${RED}" stroke-width="5"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="mini-plot">${g}</svg>`;
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
  if (js.shownId !== id) { js.mode = 'view'; js.draft = null; }
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

  renderView();
  renderStageList();
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
// A nézet és az eszközsor
function renderView() {
  const box = $('#plot-view');
  const has = plotPoints(js.job.plot).length >= 3;
  const stages = js.detail.stages;
  const tools = $('#plot-tools');
  if (js.mode === 'edit') tools.innerHTML = '<button class="btn sm ghost" data-tool="delete" type="button">Telek törlése</button><button class="btn sm" data-tool="cancel" type="button">Mégse</button><button class="btn success sm" data-tool="save" type="button">Mentés</button>';
  else tools.innerHTML = has ? '<button class="btn sm" data-tool="edit" type="button">✎ Telek</button>' : '<button class="btn sm ghost" data-tool="new" type="button">+ Telek (nem kötelező)</button>';
  if (!stages.length && !has && js.mode !== 'edit') {
    box.innerHTML = `<div class="pv-empty"><p>Még nincs kerítésszakasz.</p><button class="btn primary" type="button" data-new-stage>+ Szakasz</button>
      <p class="muted small">Elég a hossz és a minta. A telket csak akkor kell megadni, ha a kerítést a telek oldalaihoz akarod igazítani.</p></div>`;
    $('#plot-hint').textContent = '';
    return;
  }
  box.innerHTML = plotView(Math.max(300, box.clientWidth)) || '<div class="pv-empty"><p class="muted">Adj hozzá szakaszt a telek egyik oldalához.</p></div>';
  const unplaced = has && stages.some((x) => !sides(js.job.plot)[x.side]);
  $('#plot-hint').innerHTML = js.mode === 'edit'
    ? 'Húzd a sarkokat (fél méterre ugranak). Oldal pontos hossza: koppints az oldal címkéjére. Új sarok: „+”. Sarok törlése: dupla koppintás a sarokra.'
    : `A piros pöttyöt húzd a kerítésen, vagy koppints a kerítésre: idáig készült el (2 méterenként ugrik).${unplaced ? ' <span class="neg">Van szakasz, ami nincs a telek egyik oldalához kötve, ezért nem látszik a rajzon.</span>' : ''}`;
}
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (!$('#job-detail').hidden && js.detail) renderView(); }, 150); });

// Képernyő → méter (a nézet koordinátáiban)
function toMeters(svg, ev) {
  const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [(p.x - js.view.ox) / js.view.k, (p.y - js.view.oy) / js.view.k];
}
// Egy szakasz mentén mért távolság (m) a ponthoz, 2 m-re kerekítve.
function alongStage(st, m) {
  const { s, from } = js.view.place[st.id];
  const scale = s.geo / s.len;
  const start = lerp(s.a, s.b, Math.min(1, from / s.len));
  const d = ((m[0] - start[0]) * s.dx + (m[1] - start[1]) * s.dy) / scale;
  if (d >= st.length_m - 1) return st.length_m;
  return Math.max(0, Math.min(st.length_m, Math.round(d / 2) * 2));
}

$('#plot-view').addEventListener('pointerdown', (e) => {
  const svg = $('#plot-view svg');
  if (!svg) return;
  // Kész jelölő húzása / koppintás a kerítésre
  const knob = e.target.closest('[data-knob]'), hit = e.target.closest('[data-hit]');
  if ((knob || hit) && js.mode === 'view') {
    e.preventDefault();
    const st = js.detail.stages.find((x) => x.id === +(knob ? knob.dataset.knob : hit.dataset.hit));
    let cur = alongStage(st, toMeters(svg, e));
    const orig = st.done_m;
    const redraw = () => { st.done_m = cur; $('#plot-view').innerHTML = plotView(Math.max(300, $('#plot-view').clientWidth)); };
    redraw();
    const box = $('#plot-view');
    box.setPointerCapture?.(e.pointerId);
    const move = (ev) => { const v = alongStage(st, toMeters($('#plot-view svg'), ev)); if (v !== cur) { cur = v; redraw(); } };
    const up = async () => {
      box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
      if (Math.abs(cur - orig) < 0.01) return;
      await api(`/api/stages/${st.id}`, { method: 'PATCH', body: { done_manual: cur } });
      toast(`${st.stage_name}: ${m1(cur)} m kész`);
      loadJobs();
    };
    box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
    return;
  }
  // Sarok húzása (szerkesztés)
  const v = e.target.closest('[data-vtx]');
  if (v && js.mode === 'edit') {
    e.preventDefault();
    const i = +v.dataset.vtx, box = $('#plot-view');
    const view0 = { ...js.view };
    box.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      // A lépték húzás közben nem változik, hogy a pont ne „szaladjon el”.
      js.view = view0;
      const m = toMeters($('#plot-view svg'), ev);
      js.draft[i] = [Math.round(m[0] * 2) / 2, Math.round(m[1] * 2) / 2];
      renderView();
    };
    const up = () => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up); renderView(); };
    box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  }
});
$('#plot-view').addEventListener('dblclick', (e) => {
  const v = e.target.closest('[data-vtx]');
  if (v && js.mode === 'edit' && js.draft.length > 3) { js.draft.splice(+v.dataset.vtx, 1); renderView(); }
});
$('#plot-view').addEventListener('click', (e) => {
  if (e.target.closest('[data-new-stage]')) return openStage(null);
  if (js.mode !== 'edit') return;
  const add = e.target.closest('[data-add]');
  if (add) { const i = +add.dataset.add, n = js.draft.length; const mid = lerp(js.draft[i], js.draft[(i + 1) % n], 0.5); js.draft.splice(i + 1, 0, mid.map((x) => Math.round(x * 2) / 2)); return renderView(); }
  const sl = e.target.closest('[data-side-len]');
  if (sl) {
    const i = +sl.dataset.sideLen, n = js.draft.length;
    const a = js.draft[i], b = js.draft[(i + 1) % n], cur = dist(a, b);
    const v = prompt(`${SIDE(i)} oldal hossza (m):`, String(r1(cur)).replace('.', ','));
    const L = parseFloat(String(v || '').replace(',', '.'));
    if (!(L > 0)) return;
    // Az oldal vége az oldal irányában mozdul; ha a vége az első pont, akkor az eleje mozdul.
    const dx = (b[0] - a[0]) / cur, dy = (b[1] - a[1]) / cur;
    if ((i + 1) % n === 0) js.draft[i] = [r1(b[0] - dx * L), r1(b[1] - dy * L)];
    else js.draft[(i + 1) % n] = [r1(a[0] + dx * L), r1(a[1] + dy * L)];
    renderView();
  }
});

$('#plot-tools').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tool]');
  if (!b) return;
  const t = b.dataset.tool;
  if (t === 'new') return openPlotDialog();
  if (t === 'edit') { js.mode = 'edit'; js.draft = plotPoints(js.job.plot); }
  if (t === 'cancel') { js.mode = 'view'; js.draft = null; }
  if (t === 'delete') {
    if (!confirm('Törlöd a telket? A szakaszok megmaradnak, de nem lesznek oldalhoz kötve.')) return;
    await api(`/api/jobs/${js.job.id}`, { method: 'PATCH', body: { plot: null } });
    js.mode = 'view'; js.draft = null; toast('Telek törölve'); return loadJobs();
  }
  if (t === 'save') {
    await api(`/api/jobs/${js.job.id}`, { method: 'PATCH', body: { plot: { unit: 'm', points: js.draft } } });
    js.mode = 'view'; js.draft = null; toast('Telek mentve');
    return loadJobs();
  }
  renderView();
});

function openPlotDialog() {
  $('#plot-form').reset();
  $('#plot-dialog').showModal();
}
$('#plot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const w = parseFloat(String(e.target.w.value).replace(',', '.')), h = parseFloat(String(e.target.h.value).replace(',', '.'));
  // A oldal = utcafront (fent), B jobb oldal, C hátsó, D bal oldal.
  const pts = [[0, 0], [w, 0], [w, h], [0, h]];
  await api(`/api/jobs/${js.job.id}`, { method: 'PATCH', body: { plot: { unit: 'm', points: pts } } });
  $('#plot-dialog').close(); toast('Telek létrehozva');
  js.mode = 'view'; loadJobs();
});

// ---------------------------------------------------------------------------
// Szakaszlista (a nézet alatt)
function renderStageList() {
  const sd = sides(js.job.plot);
  $('#stage-list').innerHTML = js.detail.stages.map((x, i) => {
    const side = sd[x.side];
    const turnTxt = i > 0 ? (TURNS.find(([v]) => v === Number(x.turn)) || [0, `${x.turn}°`])[1].toLowerCase().replace(' (derékszög)', '') : 'kezdő szakasz';
    const pos = side ? `${SIDE(x.side)} oldal · ${m1(x.from_m)}–${m1(x.from_m + x.length_m)} m` : sd.length ? '<span class="neg">nincs telek-oldalhoz kötve</span>' : turnTxt;
    const pct = Math.round((x.done_m / x.length_m) * 100);
    const over = side && x.from_m + x.length_m > side.len + 0.5;
    return `<div class="stage-row" data-stage="${x.id}">
      <span class="stage-no ${pct >= 100 ? 'ok' : pct > 0 ? 'part' : ''}">${i + 1}</span>
      <div class="stage-info"><div><b>${esc(x.stage_name)}</b> <span class="tpl-chip" style="--c:${TPL_ACCENT[x.template] || '#888'}">${esc(x.template)}</span></div>
        <div class="muted small">${pos} · ${x.spans} köz · ${x.panels} panel${over ? ' · <span class="neg">hosszabb, mint az oldal</span>' : ''}</div></div>
      <div class="band-done"><b>${m1(x.done_m)}</b> / ${m1(x.length_m)} m
        <div class="small">${x.manual ? `<span class="chip-s">kézzel</span> <button class="link small" type="button" data-auto="${x.id}">napi lapból: ${m1(x.done_auto)} m</button>` : '<span class="muted">napi lapból</span>'}</div></div>
      <span class="row-btns"><button class="btn sm ghost" data-edit-stage="${x.id}" aria-label="Szerkesztés">✎</button><button class="btn sm ghost" data-del-stage="${x.id}" aria-label="Törlés">✕</button></span>
    </div>`;
  }).join('') || '<p class="muted small">Még nincs szakasz.</p>';
}
$('#stage-list').addEventListener('click', async (e) => {
  const auto = e.target.closest('[data-auto]');
  const ed = e.target.closest('[data-edit-stage]');
  const del = e.target.closest('[data-del-stage]');
  if (auto) { await api(`/api/stages/${auto.dataset.auto}`, { method: 'PATCH', body: { done_manual: null } }); toast('Visszaállítva a napi lap szerint'); loadJobs(); }
  if (ed) openStage(js.detail.stages.find((x) => x.id === +ed.dataset.editStage));
  if (del && confirm('Törlöd a szakaszt?')) { await api(`/api/stages/${del.dataset.delStage}`, { method: 'DELETE' }); loadJobs(); }
});
$('#stage-list').addEventListener('mouseover', (e) => {
  const r = e.target.closest('[data-stage]');
  $$('#plot-view [data-stage-g]').forEach((g) => g.classList.toggle('dim', !!r && g.dataset.stageG !== r.dataset.stage));
});
$('#stage-list').addEventListener('mouseleave', () => $$('#plot-view [data-stage-g]').forEach((g) => g.classList.remove('dim')));

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
  $('#stage-turn').innerHTML = TURNS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  f.turn.value = String(st?.turn ?? 90);
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
  // Telek nélkül (vagy oldal nélkül) a szakasz az előző végétől folytatódik; az elsőnél nincs fordulás.
  const isFirst = js.editingStage ? js.detail.stages[0]?.id === js.editingStage.id : !js.detail.stages.length;
  f.querySelector('[data-for="turn"]').hidden = f.side.value !== '' || isFirst || sides(js.job.plot).length > 0;
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
