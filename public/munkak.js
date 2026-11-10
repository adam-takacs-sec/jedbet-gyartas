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

// Telefonon kevesebb oszlopköz fér egy sorba, hogy olvasható maradjon.
const rowSpans = () => (window.innerWidth < 600 ? 5 : 10);

// Projekt kártyáján és fejlécén: a szakaszok egymás után, hosszuk arányában.
function stageStrip(stages, { labels = true, done = 0 } = {}) {
  const total = stages.reduce((a, s) => a + s.length_m, 0);
  if (!total) return '<div class="strip empty"><span>Nincs szakasz</span></div>';
  const pct = Math.min(100, (done / total) * 100);
  return `<div class="strip">${stages.map((s) => `<span class="seg-${esc(s.template)}" style="flex:${s.length_m};--c:${tpl(s.template).accent}" title="${esc(s.stage_name)} · ${fmt(s.length_m, 0)} m · ${esc(s.template)}">${labels ? `<em>${esc(s.stage_name)}</em><small>${fmt(s.length_m, 0)} m</small>` : ''}</span>`).join('')}
    ${done ? `<i class="strip-done" style="width:${pct}%"></i>` : ''}</div>`;
}

// ===================================================================
export function initJobs(config) {
  js.templates = config.panelTemplates;
  $('#stage-template').innerHTML = js.templates.map((t) => `<option>${esc(t)}</option>`).join('');
  injectPatterns();
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
      ${stageStrip(j.stages, { labels: true, done: j.done_m })}
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
  $('#jd-overview').innerHTML = s.stages.length ? `<div class="overview">${stageStrip(s.stages, { done: s.install.done_m })}
    ${s.install.done_m ? `<p class="muted small">A sötétített rész a telepített hossz (${fmt(s.install.done_m, 0)} m); a napi lapon rögzített telepítésekből.</p>` : ''}</div>` : '';

  $('#jd-stages').innerHTML = s.stages.map((x, i) => `
    <div class="stage" data-stage="${x.id}" style="--c:${tpl(x.template).accent}">
      <div class="stage-head">
        <div><span class="stage-no">${i + 1}</span><b>${esc(x.stage_name)}</b> <span class="tpl-chip">${esc(x.template)}</span>
          <div class="muted small">${fmt(x.length_m, x.length_m % 1 ? 1 : 0)} m · ${x.spans} köz · <b>${x.panels} panel</b> · ${x.veg} vég + ${x.kozep} közép oszlop${x.note ? ' · ' + esc(x.note) : ''}</div></div>
        <span class="row-btns"><button class="btn sm ghost" data-edit-stage="${x.id}" aria-label="Szerkesztés">✎</button><button class="btn sm ghost" data-del-stage="${x.id}" aria-label="Törlés">✕</button></span>
      </div>
      <div class="fence-wrap">${fenceSvg(x.length_m, x.template, { perRow: rowSpans() })}</div>
    </div>`).join('') || '<p class="muted">Még nincs szakasz. Add hozzá az első szakaszt a hosszal és a mintával.</p>';
  $('#jd-legend').innerHTML = s.stages.length ? '<span><i class="lg post-end"></i>végoszlop</span><span><i class="lg post-mid"></i>középoszlop</span><span>2 m = 1 oszlopköz = 4 panel</span>' : '';

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
  if (st) { f.stage_name.value = st.stage_name; f.length_m.value = st.length_m; f.template.value = st.template; f.note.value = st.note || ''; }
  else if (js.detail?.stages.length) f.template.value = js.detail.stages[js.detail.stages.length - 1].template;
  previewStage();
  $('#stage-dialog').showModal();
}
function previewStage() {
  const f = $('#stage-form');
  const len = parseFloat(String(f.length_m.value).replace(',', '.'));
  if (!(len >= 0.5)) { $('#stage-preview').innerHTML = '<p class="muted small">Add meg a hosszt, és itt látod a kerítést.</p>'; return; }
  const c = stageCalc(len);
  $('#stage-preview').innerHTML = `<div class="fence-wrap">${fenceSvg(len, f.template.value, { perRow: rowSpans() })}</div>
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
