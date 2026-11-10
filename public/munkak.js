// Munkák: projektek kártyákon, szakaszonként kirajzolt kerítéssel.
import { $, $$, esc, fmt, ft, api, toast } from './lib.js';

const js = { templates: [], jobs: [], filter: 'Aktív', selected: null, detail: null, editingStage: null, editingJob: false };
try { js.filter = localStorage.getItem('jobFilter') ?? 'Aktív'; } catch {}

// Mintánként: panel alapszín, minta-vonal színe, kiemelő szín (csík, címke).
const TPL = {
  'Mediterrán': { base: '#b7a98c', ink: '#8a7c60', accent: '#d4a72c' },
  'Homokkő': { base: '#c4a684', ink: '#9b7c5a', accent: '#c06b3e' },
  'Hullám': { base: '#a3acb4', ink: '#6f7a84', accent: '#3d8fd1' },
};
const tpl = (t) => TPL[t] || { base: '#a0a0a0', ink: '#777', accent: '#8f9296' };

// 2 m = 1 oszlopköz = 4 panel; szakaszonként 2 végoszlop (ugyanaz, mint a szerveren).
const stageCalc = (len) => {
  const spans = Math.max(1, Math.ceil(len / 2 - 1e-9));
  return { spans, panels: spans * 4, veg: 2, kozep: spans - 1 };
};
const turnLabel = (t) => (TURNS.find(([v]) => v === Number(t)) || [0, `${t}°`])[1].toLowerCase();
const daysLeft = (d) => (d ? Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 86400000) : null);

// Egyszer a lapra: a minták SVG-textúrái (minden kerítésrajz ezeket használja).
function injectPatterns() {
  if ($('#fence-defs')) return;
  const pat = (name, w, h, body) => `<pattern id="pat-${name}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${body}</pattern>`;
  const m = tpl('Mediterrán'), h = tpl('Homokkő'), w = tpl('Hullám');
  document.body.insertAdjacentHTML('beforeend', `<svg id="fence-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    ${pat('Mediterrán', 12, 6, `<rect width="12" height="6" fill="${m.base}"/><path d="M0 0H12M0 3H12M3 0V3M9 3V6" stroke="${m.ink}" stroke-width=".6" fill="none"/>`)}
    ${pat('Homokkő', 8, 6, `<rect width="8" height="6" fill="${h.base}"/><circle cx="1.5" cy="1.5" r=".7" fill="${h.ink}"/><circle cx="5.5" cy="3.8" r=".9" fill="${h.ink}"/><circle cx="3" cy="5" r=".5" fill="${h.ink}"/><circle cx="7" cy=".8" r=".4" fill="${h.ink}"/>`)}
    ${pat('Hullám', 12, 4, `<rect width="12" height="4" fill="${w.base}"/><path d="M0 2.5Q3 .5 6 2.5T12 2.5" stroke="${w.ink}" stroke-width=".8" fill="none"/>`)}
  </defs></svg>`);
}

// Egy szakasz elölnézete: oszlopok 2 m-enként, köztük 4 egymásra rakott panel, alatta méretvonal.
// Hosszú szakaszt több sorba tördelünk, közös léptékkel.
function fenceSvg(len, template, { perRow = 10 } = {}) {
  const { spans } = stageCalc(len);
  const SP = 48, PW = 6, VW = 8, PH = 12, GAP = 1, TOP = 6, PANELS_H = 4 * PH + 3 * GAP;
  const fill = TPL[template] ? `url(#pat-${template})` : '#a0a0a0';
  const rows = [];
  for (let i = 0; i < spans; i += perRow) rows.push([i, Math.min(spans, i + perRow)]);
  // Közös lépték: egy teljes sor (perRow köz) a teljes szélesség, így a rövid szakasz rövidebb is.
  const maxW = perRow * SP + VW;
  return rows.map(([a, b], ri) => {
    const n = b - a, W = n * SP + VW, H = TOP + PANELS_H + 4 + (ri === rows.length - 1 ? 18 : 4);
    let g = '';
    for (let k = 0; k < n; k++) {
      const x = VW / 2 + k * SP + PW / 2;
      for (let p = 0; p < 4; p++) g += `<rect x="${x}" y="${TOP + p * (PH + GAP)}" width="${SP - PW}" height="${PH}" rx=".8" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width=".5"/>`;
    }
    for (let k = 0; k <= n; k++) {
      const gi = a + k; // a szakasz elejétől számolt oszlop
      const end = gi === 0 || gi === spans;
      if (k === 0 && ri > 0) continue; // a sor eleji oszlop az előző sor végén már ott van
      const pw = end ? VW : PW, x = VW / 2 + k * SP - pw / 2;
      g += `<rect x="${x}" y="1" width="${pw}" height="${TOP + PANELS_H + 3}" rx="1" fill="${end ? '#5c6066' : '#7d8288'}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/>`;
      g += `<rect x="${x - .8}" y="0" width="${pw + 1.6}" height="2.4" rx=".8" fill="${end ? '#4a4d52' : '#6a6e74'}"/>`;
    }
    g += `<line x1="0" x2="${W}" y1="${TOP + PANELS_H + 4}" y2="${TOP + PANELS_H + 4}" stroke="var(--line)" stroke-width="1"/>`;
    if (ri === rows.length - 1) {
      const y = TOP + PANELS_H + 12;
      const total = rows.length === 1;
      g += `<path d="M${VW / 2} ${y}H${W - VW / 2}M${VW / 2} ${y - 3}V${y + 3}M${W - VW / 2} ${y - 3}V${y + 3}" stroke="var(--muted)" stroke-width=".8"/>`;
      g += `<text x="${W / 2}" y="${y - 2}" text-anchor="middle" font-size="8" font-weight="700" fill="var(--ink)" paint-order="stroke" stroke="var(--card)" stroke-width="3">${fmt(len, len % 1 ? 1 : 0)} m${total ? '' : ' összesen'}</text>`;
    }
    return `<svg class="fence" viewBox="0 0 ${W} ${H}" style="width:${(W / maxW) * 100}%" role="img" aria-label="${esc(template)} kerítés, ${fmt(len, 1)} m">${g}</svg>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Felülnézet: a szakaszok egymáshoz csatlakozva, a megadott fordulással.
// Szürke = még nincs kész, JEDBET-piros = telepítve. Oszlopok 2 m-enként.
const RED = '#d62828', RED_DARK = '#9e1b1b', GREY = '#6b6f75', GREY_POST = '#a3a6aa';
const TURNS = [[90, 'Jobbra fordul'], [-90, 'Balra fordul'], [0, 'Egyenesen tovább'], [45, 'Jobbra, ferdén (45°)'], [-45, 'Balra, ferdén (45°)']];

function layout(stages) {
  let x = 0, y = 0, h = 0;
  return stages.map((st, i) => {
    if (i > 0) h += Number(st.turn ?? 90);
    const r = (h * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
    const seg = { ...st, x0: x, y0: y, x1: x + dx * st.length_m, y1: y + dy * st.length_m, dx, dy };
    x = seg.x1; y = seg.y1;
    return seg;
  });
}

function topView(stages, { mini = false, highlight = null, maxW = 760, maxH = 420 } = {}) {
  if (!stages.length) return '';
  const segs = layout(stages);
  const xs = segs.flatMap((s) => [s.x0, s.x1]), ys = segs.flatMap((s) => [s.y0, s.y1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = mini ? 10 : 56;
  const k = Math.min((maxW - 2 * pad) / Math.max(maxX - minX, 1), (maxH - 2 * pad) / Math.max(maxY - minY, 1), mini ? 12 : 28);
  const W = Math.max((maxX - minX) * k + 2 * pad, mini ? 120 : 260), H = Math.max((maxY - minY) * k + 2 * pad, mini ? 40 : 120);
  const ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = (H - (maxY - minY) * k) / 2 - minY * k;
  const P = (x, y) => [ox + x * k, oy + y * k];
  const pw = mini ? 4 : Math.max(4, Math.min(9, 0.25 * k)); // panelvonal vastagsága
  let lines = '', posts = '', labels = '';
  // Telek-kitöltés, ha a vonal nagyjából körbeér.
  const end = segs[segs.length - 1];
  const closed = segs.length >= 3 && Math.hypot(end.x1 - segs[0].x0, end.y1 - segs[0].y0) < 0.25 * segs.reduce((a, s) => a + s.length_m, 0);
  const poly = segs.map((s) => P(s.x0, s.y0).join(',')).concat([P(end.x1, end.y1).join(',')]).join(' ');
  const fillPoly = segs.length >= 2 ? `<polygon points="${poly}" fill="${closed ? 'rgba(214,40,40,.05)' : 'none'}" stroke="none"/>` : '';

  for (const s of segs) {
    const done = Math.min(s.done_m || 0, s.length_m);
    const at = (d) => P(s.x0 + s.dx * d, s.y0 + s.dy * d);
    const dim = highlight !== null && highlight !== s.id ? ' opacity=".35"' : '';
    const [ax, ay] = at(0), [bx, by] = at(s.length_m), [cx, cy] = at(done);
    lines += `<g${dim}><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${GREY}" stroke-width="${pw}" stroke-linecap="butt"/>`;
    if (done > 0) lines += `<line x1="${ax}" y1="${ay}" x2="${cx}" y2="${cy}" stroke="${RED}" stroke-width="${pw}" stroke-linecap="butt"/>`;
    if (highlight === s.id) lines += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#fff" stroke-opacity=".5" stroke-width="${pw + 6}" stroke-linecap="round" fill="none" style="mix-blend-mode:overlay"/>`;
    lines += '</g>';
    if (!mini) {
      const spans = Math.max(1, Math.ceil(s.length_m / 2 - 1e-9));
      for (let i = 0; i <= spans; i++) {
        const d = Math.min(i * 2, s.length_m), isEnd = i === 0 || i === spans;
        const [px, py] = at(d), sz = isEnd ? pw + 5 : pw + 2;
        const col = d <= done + 1e-6 && done > 0 ? (isEnd ? RED_DARK : RED) : (isEnd ? '#d9dbde' : GREY_POST);
        const rot = (Math.atan2(s.dy, s.dx) * 180) / Math.PI;
        posts += `<rect${dim} x="${px - sz / 2}" y="${py - sz / 2}" width="${sz}" height="${sz}" fill="${col}" stroke="#1b1d20" stroke-width="1" transform="rotate(${rot} ${px} ${py})"/>`;
      }
      // Felirat a szakasz közepénél, a vonal mellett (kifelé), olvasható irányban.
      const [mx, my] = at(s.length_m / 2);
      let ang = (Math.atan2(s.dy, s.dx) * 180) / Math.PI;
      const flip = ang > 90 || ang < -90;
      if (flip) ang += 180;
      const nx = s.dy, ny = -s.dx; // bal oldali normális (a menetirányhoz képest kifelé, ha jobbra fordulunk)
      const off = pw / 2 + 7;
      const tx = mx + nx * off, ty = my + ny * off;
      const name = `${s.stage_name} · ${fmt(s.length_m, s.length_m % 1 ? 1 : 0)} m`;
      const sub = done >= s.length_m - 1e-6 ? 'kész' : done > 0 ? `${fmt(done, 0)} / ${fmt(s.length_m, 0)} m kész` : esc(s.template);
      labels += `<g${dim} transform="translate(${tx} ${ty}) rotate(${ang})"><text text-anchor="middle" y="${flip ? 23 : -15}" font-size="12" font-weight="700" fill="var(--ink)">${esc(name)}</text>
        <text text-anchor="middle" y="${flip ? 10 : -2}" font-size="10" fill="${done > 0 ? RED : 'var(--muted)'}" font-weight="${done > 0 ? 700 : 400}">${sub}</text></g>`;
    }
  }
  // Léptékvonal
  let scale = '';
  if (!mini) {
    const nice = [1, 2, 5, 10, 20, 50, 100].find((m) => m * k >= 60) || 100;
    const sx = 14, sy = H - 14;
    scale = `<g><path d="M${sx} ${sy - 4}V${sy}H${sx + nice * k}V${sy - 4}" stroke="var(--muted)" fill="none" stroke-width="1.2"/>
      <text x="${sx + nice * k + 6}" y="${sy}" font-size="10" fill="var(--muted)">${nice} m</text></g>`;
    // Kezdőpont jelölése
    const [s0x, s0y] = P(segs[0].x0, segs[0].y0);
    scale += `<circle cx="${s0x}" cy="${s0y}" r="${pw / 2 + 6}" fill="none" stroke="var(--muted)" stroke-dasharray="2 2"/>`;
  }
  return `<svg class="topview ${mini ? 'mini' : ''}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" role="img" aria-label="Kerítés felülnézetből">
    ${mini ? '' : '<defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="var(--line)" stroke-width=".5"/></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" opacity=".6"/>'}
    ${fillPoly}${lines}${posts}${labels}${scale}</svg>`;
}

// ===================================================================
export function initJobs(config) {
  js.templates = config.panelTemplates;
  $('#stage-template').innerHTML = js.templates.map((t) => `<option>${esc(t)}</option>`).join('');
  injectPatterns();
  $('#stage-turn').innerHTML = TURNS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
}

export async function loadJobs() {
  js.jobs = await api('/api/jobs');
  $$('[data-job-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.jobFilter === js.filter)));
  const list = js.jobs.filter((j) => !js.filter || j.status === js.filter);
  $('#jobs').innerHTML = list.map((j) => {
    const dl = daysLeft(j.deadline);
    const panels = j.stages.reduce((a, s) => a + stageCalc(s.length_m).panels, 0);
    const deadline = j.deadline ? `<span class="chip-s ${dl < 0 && j.status === 'Aktív' ? 'bad' : dl <= 7 && j.status === 'Aktív' ? 'warn' : ''}">${dl === 0 ? 'ma' : dl > 0 ? `${dl} nap` : `${-dl} napja lejárt`} · ${esc(j.deadline.slice(5).replace('-', '.'))}.</span>` : '';
    const pct = j.total_m ? Math.round(Math.min(1, j.done_m / j.total_m) * 100) : 0;
    return `<button type="button" class="job-card ${js.selected === j.id ? 'active' : ''} ${j.status === 'Aktív' ? '' : 'done'}" data-job="${j.id}">
      <div class="job-top"><b>${esc(j.name)}</b>${j.status === 'Aktív' ? deadline : '<span class="chip-s ok">Befejezett</span>'}</div>
      <div class="muted small">${[j.client_name, j.location].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
      <div class="job-thumb">${j.stages.length ? topView(j.stages, { mini: true, maxW: 300, maxH: 110 }) : '<span class="muted small">Nincs szakasz</span>'}</div>
      <div class="job-foot small"><span><b>${fmt(j.total_m, 0)} m</b> · ${j.stages.length} szakasz · ${panels} panel</span>
        ${j.done_m ? `<span>telepítve <b>${pct}%</b></span>` : ''}</div>
    </button>`;
  }).join('') || `<p class="muted">${js.filter ? `Nincs ${js.filter.toLowerCase()} projekt.` : 'Még nincs projekt.'}</p>`;
  if (js.selected && js.jobs.some((j) => j.id === js.selected)) showJob(js.selected, false);
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
  js.selected = id;
  $$('.job-card').forEach((c) => c.classList.toggle('active', +c.dataset.job === id));
  const s = await api(`/api/jobs/${id}/summary`);
  js.detail = { job: j, ...s };
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

  const t = s.stages.reduce((a, x) => ({ m: a.m + x.length_m, spans: a.spans + x.spans, panels: a.panels + x.panels, veg: a.veg + x.veg, kozep: a.kozep + x.kozep }),
    { m: 0, spans: 0, panels: 0, veg: 0, kozep: 0 });
  $('#jd-tiles').innerHTML = `
    <span>Hossz <b>${fmt(t.m, t.m % 1 ? 1 : 0)}</b><small>m</small></span>
    <span>Szakasz <b>${s.stages.length}</b></span>
    <span>Oszlopköz <b>${t.spans}</b></span>
    <span>Panel <b>${t.panels}</b><small>db</small></span>
    <span>Végoszlop <b>${t.veg}</b></span>
    <span>Középoszlop <b>${t.kozep}</b></span>`;
  const doneTotal = s.stages.reduce((a, x) => a + x.done_m, 0);
  const pctAll = t.m ? Math.round((doneTotal / t.m) * 100) : 0;
  $('#jd-overview').innerHTML = s.stages.length ? `<div class="topview-wrap">${topView(s.stages, { highlight: js.hover ?? null })}</div>
    <div class="legend small muted"><span><i class="lg tv-grey"></i>még nincs kész</span><span><i class="lg tv-red"></i>telepítve (${fmt(doneTotal, 0)} m, ${pctAll}%)</span><span>■ oszlop 2 m-enként, a nagyobb a végoszlop</span><span>◌ kezdőpont</span></div>` : '';

  $('#jd-stages').innerHTML = s.stages.map((x, i) => {
    const pct = Math.round((x.done_m / x.length_m) * 100);
    return `<div class="stage-row" data-stage="${x.id}" style="--c:${tpl(x.template).accent}">
      <span class="stage-no ${pct >= 100 ? 'ok' : ''}">${pct >= 100 ? '✓' : i + 1}</span>
      <div class="stage-info"><div><b>${esc(x.stage_name)}</b> <span class="tpl-chip">${esc(x.template)}</span>
        ${i > 0 ? `<span class="muted small">${esc(turnLabel(x.turn))}</span>` : ''}</div>
        <div class="muted small">${fmt(x.length_m, x.length_m % 1 ? 1 : 0)} m · ${x.spans} köz · <b>${x.panels} panel</b> · ${x.veg} vég + ${x.kozep} közép oszlop${x.note ? ' · ' + esc(x.note) : ''}</div>
        <div class="bar sm ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div></div>
      <span class="stage-done"><b>${fmt(x.done_m, 0)}</b>/${fmt(x.length_m, 0)} m</span>
      <span class="row-btns"><button class="btn sm ghost" data-edit-stage="${x.id}" aria-label="Szerkesztés">✎</button><button class="btn sm ghost" data-del-stage="${x.id}" aria-label="Törlés">✕</button></span>
    </div>`;
  }).join('') || '<p class="muted">Még nincs szakasz. Add hozzá az elsőt: hossz, minta, és hogy merre fordul az előzőhöz képest.</p>';
  $('#jd-legend').innerHTML = '';

  $('#jd-summary tbody').innerHTML = s.summary.map((x) => `<tr><td>${esc(x.item)}</td><td class="num">${x.needed}</td>
    <td class="num">${x.in_stock}</td><td class="num ${x.missing ? 'neg' : ''}">${x.missing}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">Adj hozzá szakaszt.</td></tr>';

  const ins = s.install;
  const pct = ins.total_m ? Math.min(100, Math.round((ins.done_m / ins.total_m) * 100)) : 0;
  $('#jd-install').innerHTML = `
    <div class="progress-head"><span>${fmt(ins.done_m, 0)} / ${fmt(ins.total_m, 0)} m</span><b>${pct}%</b></div>
    <div class="bar big ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>
    <div class="kv">
      <span>Munkaóra: <b>${fmt(ins.hours, 1)}</b> · ${ins.work_days} nap</span>
      <span>Bérköltség: <b>${ft(ins.cost)}</b></span>
      <span>m / munkaóra: <b>${ins.hours ? fmt(ins.done_m / ins.hours, 1) : '–'}</b></span>
    </div>
    ${ins.days.length ? `<div class="list">${ins.days.map((d) => `<div class="item small"><span><b>${esc(d.day)}</b> · ${fmt(d.done_m, 0)} m</span><span class="muted">${esc(d.workers || '')}</span></div>`).join('')}</div>`
      : '<p class="muted small">A telepítést a Napi lapon rögzítsd: Telepítés feladat ennél a projektnél.</p>'}`;
  if (scroll) $('#job-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Projekt: új / szerkesztés / státusz ---
$('#job-new').addEventListener('click', () => {
  js.editingJob = false;
  const f = $('#job-form'); f.reset();
  $('#job-dialog-title').textContent = 'Új projekt';
  f.querySelector('[type=submit]').textContent = 'Létrehozás';
  $('#job-dialog').showModal();
});
$('#job-detail').addEventListener('click', async (e) => {
  if (e.target.closest('#jd-edit')) {
    const j = js.detail.job, f = $('#job-form');
    js.editingJob = true;
    for (const k of ['name', 'client_name', 'phone', 'location', 'deadline']) f[k].value = j[k] || '';
    $('#job-dialog-title').textContent = 'Projekt szerkesztése';
    f.querySelector('[type=submit]').textContent = 'Mentés';
    $('#job-dialog').showModal();
  }
  if (e.target.closest('#jd-status')) {
    const j = js.detail.job;
    await api(`/api/jobs/${j.id}`, { method: 'PATCH', body: { status: j.status === 'Aktív' ? 'Befejezett' : 'Aktív' } });
    toast(j.status === 'Aktív' ? 'Befejezettnek jelölve' : 'Újranyitva'); loadJobs();
  }
  const ed = e.target.closest('[data-edit-stage]');
  if (ed) openStage(js.detail.stages.find((x) => x.id === +ed.dataset.editStage));
  const del = e.target.closest('[data-del-stage]');
  if (del && confirm('Törlöd a szakaszt?')) { await api(`/api/stages/${del.dataset.delStage}`, { method: 'DELETE' }); loadJobs(); }
});
$('#stage-new').addEventListener('click', () => openStage(null));
$('#jd-stages').addEventListener('mouseover', (e) => {
  const r = e.target.closest('[data-stage]');
  const id = r ? +r.dataset.stage : null;
  if (id === js.hover || !js.detail) return;
  js.hover = id;
  $('.topview-wrap').innerHTML = topView(js.detail.stages, { highlight: id });
});
$('#jd-stages').addEventListener('mouseleave', () => { js.hover = null; if (js.detail?.stages.length) $('.topview-wrap').innerHTML = topView(js.detail.stages); });
$$('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('#job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  if (js.editingJob) {
    await api(`/api/jobs/${js.detail.job.id}`, { method: 'PATCH', body: v });
  } else {
    const res = await api('/api/jobs', { method: 'POST', body: v });
    js.selected = res.job_id;
    if (js.filter === 'Befejezett') js.filter = 'Aktív';
  }
  $('#job-dialog').close(); toast('Mentve'); await loadJobs();
  if (!js.editingJob) $('#job-detail').scrollIntoView({ behavior: 'smooth' });
});

// --- Szakasz: felvétel / szerkesztés élő előnézettel ---
function openStage(st) {
  js.editingStage = st;
  const f = $('#stage-form'); f.reset();
  $('#stage-dialog-title').textContent = st ? 'Szakasz szerkesztése' : 'Új szakasz';
  f.querySelector('[type=submit]').textContent = st ? 'Mentés' : 'Hozzáadás';
  const first = st ? js.detail.stages[0]?.id === st.id : !js.detail?.stages.length;
  f.querySelector('[data-for="turn"]').hidden = first;
  f.turn.value = '90';
  if (st) { f.stage_name.value = st.stage_name; f.length_m.value = st.length_m; f.template.value = st.template; f.note.value = st.note || ''; f.turn.value = String(st.turn ?? 90); }
  else if (js.detail?.stages.length) f.template.value = js.detail.stages[js.detail.stages.length - 1].template;
  previewStage();
  $('#stage-dialog').showModal();
}
function previewStage() {
  const f = $('#stage-form');
  const len = parseFloat(String(f.length_m.value).replace(',', '.'));
  if (!(len >= 0.5)) { $('#stage-preview').innerHTML = '<p class="muted small">Add meg a hosszt, és itt látod felülről, hogyan illeszkedik a többihez.</p>'; return; }
  const c = stageCalc(len);
  const me = { id: -1, stage_name: f.stage_name.value || 'Új szakasz', length_m: len, template: f.template.value, turn: Number(f.turn.value), done_m: 0 };
  const others = js.detail?.stages || [];
  const list = js.editingStage ? others.map((x) => (x.id === js.editingStage.id ? { ...me, id: x.id, done_m: x.done_m } : x)) : [...others, me];
  $('#stage-preview').innerHTML = `${topView(list, { highlight: js.editingStage ? js.editingStage.id : -1, maxW: 520, maxH: 260 })}
    <p class="small">${c.spans} oszlopköz · <b>${c.panels} panel</b> · ${c.veg} végoszlop + ${c.kozep} középoszlop${len % 2 ? ` <span class="muted">(az utolsó köz ${fmt(len - 2 * (c.spans - 1), 1)} m)</span>` : ''}</p>`;
}
$('#stage-form').addEventListener('input', previewStage);
$('#stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  v.length_m = String(v.length_m).replace(',', '.');
  if (js.editingStage) await api(`/api/stages/${js.editingStage.id}`, { method: 'PATCH', body: v });
  else await api(`/api/jobs/${js.selected}/stages`, { method: 'POST', body: v });
  $('#stage-dialog').close(); toast('Mentve'); loadJobs();
});
