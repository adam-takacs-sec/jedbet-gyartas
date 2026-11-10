// Napi lap (nap / hét / hónap nézet) és Munkások fül.
import { $, $$, esc, fmt, ft, hhmm, api, toast } from './lib.js';

const ns = {
  cfg: null, templates: [], day: null, data: null, view: 'day',
  finishing: null,   // feladat id, aminek a lezáró űrlapja nyitva van
  editingLog: null,  // munkanapló id, ami szerkesztés alatt van
  taskMode: null,    // 'plan' | 'extra' | {edit: id}
  taskSource: null,  // a szerkesztett feladat adatai (hét/hónap nézetből is)
  jobs: [], plan: null,
  worker: null, showInactive: false,
};
try { ns.view = localStorage.getItem('napView') || 'day'; } catch {}

const STATUS = {
  terv: ['Terv', 'plan'], folyamatban: ['Folyamatban', 'wait'], kesz: ['Kész', 'ready'],
  reszben: ['Részben', 'hideg'], nem: ['Nem készült el', 'fagy'],
};
const WEEKDAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
const WD_SHORT = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];
const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const weekday = (d) => WEEKDAYS[dow(d)];
const shiftDay = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const shiftMonth = (d, n) => { const x = new Date(`${d.slice(0, 7)}-01T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monday = (d) => shiftDay(d, -((dow(d) + 6) % 7));
const monthEnd = (d) => shiftDay(shiftMonth(d, 1), -1);
const dm = (d) => `${+d.slice(5, 7)}.${+d.slice(8, 10)}.`;
const nowHHMM = () => new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', hour12: false });
const toIso = (day, time) => (time ? new Date(`${day}T${time}`).toISOString() : null);
const toMin = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
const isoMin = (iso) => (iso ? toMin(hhmm(iso)) : null);
const opts = (list, sel, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
const qtyText = (v, unit) => (v === null || v === undefined ? '–' : `${fmt(v, Number.isInteger(+v) ? 0 : 1)}${unit ? ' ' + unit : ''}`);
const dur = (min) => { min = Math.max(0, Math.round(min)); return `${Math.floor(min / 60)} ó ${String(min % 60).padStart(2, '0')} p`; };

// A tervezett feladatok teljesítése 0–1 között: kész = 1, részben/folyamatban = elkészült / terv.
function completion(tasks) {
  const planned = tasks.filter((t) => !t.unplanned);
  if (!planned.length) return null;
  const score = planned.reduce((a, t) => {
    if (t.status === 'kesz') return a + 1;
    if ((t.status === 'reszben' || t.status === 'folyamatban') && t.planned_qty) return a + Math.min(1, (t.done_qty || 0) / t.planned_qty);
    return a;
  }, 0);
  return score / planned.length;
}

export async function initNap(config) {
  ns.templates = config.templates;
  ns.cfg = await api('/api/nap/config');
  ns.day = ns.cfg.today;
  $('#tf-kind').innerHTML = opts(Object.entries(ns.cfg.kinds).map(([k, v]) => [k, v.label]));
  $('#lf-kind').innerHTML = opts(Object.entries(ns.cfg.workKinds));
  $$('.pay-type').forEach((s) => (s.innerHTML = opts(Object.entries(ns.cfg.payTypes), 'ora')));
  // Futó napnál az óra és az idővonal percenként frissül.
  setInterval(() => {
    if (ns.view === 'day' && ns.data && !$('#tab-nap').hidden && !document.hidden && ns.data.started_at && !ns.data.closed_at) renderHero(ns.data);
  }, 30000);
}

// ===================================================================
// Nézetváltás és lapozás
// ===================================================================
export function loadNap() {
  $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === ns.view)));
  $('#view-day').hidden = ns.view !== 'day';
  $('#view-week').hidden = ns.view !== 'week';
  $('#view-month').hidden = ns.view !== 'month';
  $('#day-date').value = ns.day;
  return ns.view === 'week' ? loadWeek() : ns.view === 'month' ? loadMonth() : loadDay();
}
function setView(v, day) {
  ns.view = v;
  if (day) ns.day = day;
  try { localStorage.setItem('napView', v); } catch {}
  ns.finishing = null; ns.editingLog = null;
  loadNap();
}
$$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
const step = (n) => (ns.view === 'week' ? shiftDay(ns.day, 7 * n) : ns.view === 'month' ? shiftMonth(ns.day, n) : shiftDay(ns.day, n));
$('#nav-prev').addEventListener('click', () => setView(ns.view, step(-1)));
$('#nav-next').addEventListener('click', () => setView(ns.view, step(1)));
$('#nav-today').addEventListener('click', () => setView(ns.view, ns.cfg.today));
$('#day-date').addEventListener('change', (e) => e.target.value && setView(ns.view, e.target.value));
const reload = () => loadNap();

// ===================================================================
// Nap
// ===================================================================
async function loadDay() {
  const d = await api(`/api/day?date=${ns.day}`);
  ns.data = d; ns.jobs = d.jobs;
  const st = dayState(d);
  $('#plan-title').textContent = `${d.day.slice(0, 4)}. ${MONTHS[+d.day.slice(5, 7) - 1]} ${+d.day.slice(8)}., ${weekday(d.day)}${d.day === d.today ? ' · ma' : ''}`;
  // A munkások és a végrehajtás csak a nap indítása után jelenik meg; előtte csak a terv.
  $('#workers-card').hidden = st === 'plan';
  $('#day-body').classList.toggle('single', st === 'plan');
  $('#add-extra').hidden = st === 'plan';
  renderHero(d);
  renderTasks(d);
  if (st !== 'plan') renderLogs(d);
  $('#lf-job').innerHTML = opts(d.jobs.map((j) => [j.id, j.name]), null, '—');
  $('#lf-worker').innerHTML = opts(d.workers.map((w) => [w.id, w.name]), null, 'Válassz…');
}

function dayState(d) {
  if (d.closed_at) return 'closed';
  if (d.started_at) return 'running';
  return 'plan';
}

function renderHero(d) {
  const st = dayState(d);
  const s = d.summary;
  const isToday = d.day === d.today;
  const c = completion(d.tasks);
  const pct = c === null ? null : Math.round(c * 100);
  const startMin = isoMin(d.started_at);
  const planned = d.tasks.filter((t) => !t.unplanned);
  let head, action = '';
  if (st === 'plan') {
    const pour = s.poured_planned ? ` · öntés ${s.poured_planned} db` : '';
    head = `<div class="hero-big">${isToday ? 'Mai terv' : d.day > d.today ? 'Terv' : 'Nem indított nap'}</div>
      <div class="muted">${planned.length ? `${planned.length} feladat${pour}` : 'Még nincs feladat. Vedd fel, mit csináltok aznap.'}</div>`;
    if (d.day <= d.today) action = `<button class="btn primary hero-btn" id="hero-start" type="button">▶ Nap indítása</button>`;
  } else if (st === 'running') {
    const elapsed = isToday && startMin !== null ? dur(toMin(nowHHMM()) - startMin) : '';
    head = `<div class="hero-big"><span class="pulse"></span>Fut a nap</div>
      <div class="muted">Indult ${hhmm(d.started_at)}${elapsed ? ` · <b class="clock">${elapsed}</b>` : ''}</div>`;
    action = `<button class="btn success hero-btn" id="hero-close" type="button">■ Napzárás</button>`;
  } else {
    const len = startMin !== null && d.closed_at.slice(0, 10) <= d.day ? ` · ${dur(isoMin(d.closed_at) - startMin)}` : '';
    head = `<div class="hero-big">✓ Lezárva</div>
      <div class="muted">${d.started_at ? `${hhmm(d.started_at)} – ` : ''}${hhmm(d.closed_at)}${len}${d.note ? ` · ${esc(d.note)}` : ''}</div>`;
    action = `<button class="btn sm" id="hero-reopen" type="button">Újranyitás</button>`;
  }
  let body = '';
  if (st !== 'plan') {
    const stats = [`<span>Öntve <b>${s.poured}</b>${s.poured_planned ? `<small>/${s.poured_planned}</small>` : ''}</span>`];
    if (s.demolded) stats.push(`<span>Kiforgatva <b>${s.demolded}</b></span>`);
    if (s.installed_m) stats.push(`<span>Telepítve <b>${fmt(s.installed_m, 0)}</b><small>m</small></span>`);
    stats.push(`<span>Munkás <b>${s.workers}</b><small>${fmt(s.hours, 1)} ó</small></span>`);
    stats.push(`<span>Bér <b>${Math.round(s.cost / 1000) || 0}</b><small>e Ft</small></span>`);
    if (s.per_man_hour !== null) stats.push(`<span>Db/óra <b>${fmt(s.per_man_hour, 1)}</b></span>`);
    body = `${pct !== null ? `<div class="progress"><div class="progress-head"><span>Terv teljesítése · ${s.planned_done}/${s.planned_total} kész${s.planned_partial ? `, ${s.planned_partial} részben` : ''}</span><b>${pct}%</b></div>
      <div class="bar big ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div></div>` : ''}
      <div class="hero-stats">${stats.join('')}</div>${timelineHtml(d)}`;
  }
  $('#day-hero').className = `card hero hero-${st}`;
  $('#day-hero').innerHTML = `<div class="hero-main"><div class="hero-state">${head}</div>${action}</div>${body}`;
}

// Idővonal: a nap, a munkások jelenléte és az öntések, egy „most” jelzővel.
function timelineHtml(d) {
  const isToday = d.day === d.today;
  const now = isToday ? toMin(nowHHMM()) : null;
  const rows = [];
  const dayEnd = d.closed_at ? (d.closed_at.slice(0, 10) > d.day ? 24 * 60 : isoMin(d.closed_at)) : now;
  if (d.started_at) rows.push({ label: 'Nap', cls: 'tl-day', from: isoMin(d.started_at), to: dayEnd, open: !d.closed_at });
  for (const l of d.logs) {
    const to = toMin(l.end_time) ?? now;
    rows.push({ label: l.worker_name, cls: l.kind === 'telepites' ? 'tl-install' : 'tl-worker', from: toMin(l.start_time), to, open: !l.end_time,
      title: `${l.start_time || '?'}–${l.end_time || 'most'}` });
  }
  for (const t of d.tasks.filter((x) => x.kind === 'ontes' && x.started_at)) {
    rows.push({ label: `Öntés ${t.template}`, cls: 'tl-pour', from: isoMin(t.started_at), to: t.ended_at ? isoMin(t.ended_at) : now,
      open: !t.ended_at, title: `${t.done_qty ?? '…'} db` });
  }
  // A még futó sáv legalább néhány perces, hogy indításkor is látszódjon.
  for (const r of rows) if (r.open && r.from !== null && (r.to === null || r.to - r.from < 5)) r.to = r.from + 5;
  const valid = rows.filter((r) => r.from !== null && r.to !== null && r.to > r.from);
  if (!valid.length) {
    return d.started_at || d.logs.length ? '' : '<p class="muted small tl-empty">Az idővonal a nap indításával és a munkások érkezésével telik meg.</p>';
  }
  let lo = Math.min(6 * 60, ...valid.map((r) => r.from));
  let hi = Math.max(17 * 60, ...valid.map((r) => r.to), now ?? 0);
  lo = Math.floor(lo / 60) * 60; hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  const pos = (m) => ((m - lo) / (hi - lo)) * 100;
  const ticks = [];
  for (let h = lo / 60; h <= hi / 60; h++) ticks.push(`<span class="tl-tick" style="left:${pos(h * 60)}%">${h}</span>`);
  return `<div class="timeline">
    <div class="tl-axis">${ticks.join('')}</div>
    ${valid.map((r) => `<div class="tl-row"><span class="tl-label">${esc(r.label)}</span><div class="tl-track">
      <i class="tl-bar ${r.cls} ${r.open ? 'open' : ''}" style="left:${pos(r.from)}%;width:${pos(r.to) - pos(r.from)}%" title="${esc(r.title || '')}"></i></div></div>`).join('')}
    ${now !== null && now >= lo && now <= hi ? `<div class="tl-now" style="--x:${pos(now)}"><span>${nowHHMM()}</span></div>` : ''}
  </div>`;
}

$('#day-hero').addEventListener('click', async (e) => {
  if (e.target.closest('#hero-start')) {
    const d = ns.data;
    let at = null;
    if (d.day !== d.today) {
      const t = prompt('Mikor indult a nap? (ÓÓ:PP)', '07:00');
      if (!t) return;
      at = toIso(d.day, t);
    }
    await api('/api/day/start', { method: 'POST', body: { date: d.day, at } });
    toast('A nap elindult'); loadDay();
  }
  if (e.target.closest('#hero-close')) openClose();
  if (e.target.closest('#hero-reopen')) { await api('/api/day/reopen', { method: 'POST', body: { date: ns.data.day } }); loadDay(); }
});

function taskName(t) {
  const k = ns.cfg.kinds[t.kind].label;
  if (t.kind === 'ontes' || (t.kind === 'kiforgatas' && t.template)) return `${k}: ${t.template}`;
  if (t.kind === 'telepites') return `${k}: ${t.job_name || '?'}`;
  if (t.kind === 'egyeb') return t.title || k;
  return t.title ? `${k}: ${t.title}` : k;
}

function renderTasks(d) {
  const planned = d.tasks.filter((t) => !t.unplanned), extra = d.tasks.filter((t) => t.unplanned);
  const block = (list) => list.map((t) => taskHtml(t, d)).join('');
  $('#tasks').innerHTML =
    (planned.length ? block(planned) : `<p class="muted">Nincs tervezett feladat erre a napra.</p>`) +
    (extra.length ? `<h3>Plusz munka</h3>${block(extra)}` : '');
}

function taskHtml(t, d) {
  const unit = t.unit;
  const finished = ['kesz', 'reszben', 'nem'].includes(t.status);
  const edit = `<button class="btn sm ghost" data-edit-task="${t.id}" aria-label="Szerkesztés">✎</button><button class="btn sm ghost" data-del-task="${t.id}" aria-label="Törlés">✕</button>`;
  if (dayState(d) === 'plan' && !finished && t.status !== 'folyamatban') {
    return `<div class="task plan-row" data-task="${t.id}"><div class="task-main">
      <div><b>${esc(taskName(t))}</b>${t.carried_from ? ' <span class="muted small">(áthozva)</span>' : ''}${t.note ? `<div class="muted small">${esc(t.note)}</div>` : ''}</div>
      <span class="plan-qty">${t.planned_qty !== null ? qtyText(t.planned_qty, unit) : ''}</span>
      <span class="row-btns">${edit}</span></div></div>`;
  }
  const qty = t.unplanned ? (t.done_qty === null ? '' : qtyText(t.done_qty, unit))
    : t.done_qty !== null ? `${fmt(t.done_qty, 0)}/${qtyText(t.planned_qty, unit)}`
    : t.planned_qty !== null ? qtyText(t.planned_qty, unit) : '';
  const meta = [
    t.kind === 'ontes' && t.started_at ? `${hhmm(t.started_at)}${t.ended_at ? '–' + hhmm(t.ended_at) : ' óta'}` : '',
    t.run_id ? 'kötés indítva' : '',
    t.reason && t.status !== 'kesz' ? `<span class="neg">${esc(t.reason)}</span>` : '',
    t.carried_from ? 'áthozva' : '',
    t.note ? esc(t.note) : '',
  ].filter(Boolean).join(' · ');
  let right;
  if (t.status === 'terv' && t.kind === 'ontes') right = `<button class="btn primary sm" data-start="${t.id}">▶ Indítás</button>`;
  else if (t.status === 'folyamatban') right = `<button class="btn success sm" data-finish="${t.id}">■ Lezárás</button>`;
  else if (t.status === 'terv') right = `<button class="btn sm" data-finish="${t.id}">Lezárás</button>`;
  else right = `<span class="badge ${STATUS[t.status][1]}">${STATUS[t.status][0]}</span>`;
  return `<div class="task st-${t.status} ${ns.finishing === t.id ? 'open' : ''}" data-task="${t.id}">
    <div class="task-main">
      <button class="task-text" type="button" data-finish="${t.id}"><b>${esc(taskName(t))}</b>${meta ? `<span class="muted small">${meta}</span>` : ''}</button>
      <span class="plan-qty">${qty}</span>
      ${right}
    </div>
    ${ns.finishing === t.id ? finishForm(t, d, finished) : ''}
  </div>`;
}

function finishForm(t, d, finished) {
  let def = t.done_qty ?? t.planned_qty ?? '';
  if (t.kind === 'kiforgatas' && t.done_qty === null) {
    const dem = t.template ? d.demolded[t.template] : Object.values(d.demolded).reduce((a, b) => a + b, 0);
    if (dem) def = dem;
  }
  const isPour = t.kind === 'ontes';
  const endDefault = t.ended_at ? hhmm(t.ended_at) : d.day === d.today ? nowHHMM() : '';
  const curing = isPour && !t.run_id ? `<label>Kötés<select name="curing">
      <option value="new">Új kötés indítása az öntés végével</option>
      ${d.open_runs.map((r) => `<option value="${r.id}">Hozzáad: ${esc(r.name)}</option>`).join('')}
      <option value="none">Kötés nélkül</option></select></label>` : '';
  return `<form class="sub finish-form" data-finish-form="${t.id}">
    <div class="row3">
      <label>${isPour ? 'Öntött darab' : 'Elkészült'}${t.unit ? ` (${t.unit})` : ''}<span class="qty"><button type="button" data-step="-1">−</button><input name="done_qty" type="number" inputmode="decimal" min="0" step="any" value="${esc(def)}"><button type="button" data-step="1">+</button></span></label>
      ${isPour ? `<label>Öntés kezdete<input name="started" type="time" value="${t.started_at ? hhmm(t.started_at) : ''}"></label>
      <label>Öntés vége<input name="ended" type="time" value="${esc(endDefault)}" required></label>` : ''}
      <label>Állapot<select name="status"><option value="">automatikus (a mennyiségből)</option>
        ${opts([['kesz', 'Kész'], ['reszben', 'Részben'], ['nem', 'Nem készült el']], finished ? t.status : '')}</select></label>
      <label>Ha nem lett kész, miért?<select name="reason">${opts(ns.cfg.reasons.map((r) => [r, r]), t.reason, '—')}</select></label>
      ${curing}
      <label class="span3">Megjegyzés<input name="note" maxlength="500" value="${esc(t.note)}"></label>
    </div>
    ${isPour && t.run_id ? `<p class="muted small">Már hozzá van rendelve egy kötéshez (${esc(t.run_name || '#' + t.run_id)}).</p>` : ''}
    <div class="row-btns wrap"><button class="btn success" type="submit">Mentés</button>
      ${finished ? `<button class="btn" type="button" data-reopen-task="${t.id}">Vissza tervbe</button>` : ''}
      <button class="btn" type="button" data-finish-cancel>Mégse</button>
      <span class="spacer"></span>
      <button class="btn sm ghost" type="button" data-edit-task="${t.id}">✎ Szerkesztés</button>
      <button class="btn sm ghost" type="button" data-del-task="${t.id}">✕ Törlés</button></div>
  </form>`;
}

$('#tasks').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.start) {
    let body = {};
    if (ns.day !== ns.data.today) {
      const t = prompt('Öntés kezdete (ÓÓ:PP):', '07:00');
      if (!t) return;
      body = { at: toIso(ns.day, t) };
    }
    await api(`/api/tasks/${d.start}/start`, { method: 'POST', body });
    // Az első öntés magától elindítja a napot is.
    if (!ns.data.started_at && ns.day === ns.data.today) await api('/api/day/start', { method: 'POST', body: { date: ns.day } });
    toast('Öntés elindítva'); loadDay();
  } else if (d.finish) {
    ns.finishing = ns.finishing === +d.finish ? null : +d.finish; renderTasks(ns.data);
    $(`[data-finish-form="${d.finish}"] input[name="done_qty"]`)?.focus();
  } else if (d.finishCancel !== undefined) {
    ns.finishing = null; renderTasks(ns.data);
  } else if (d.reopenTask) {
    await api(`/api/tasks/${d.reopenTask}/reopen`, { method: 'POST', body: {} });
    ns.finishing = null; loadDay();
  } else if (d.delTask) {
    const t = ns.data.tasks.find((x) => x.id === +d.delTask);
    if (!confirm(`Törlöd: ${taskName(t)}?${t.run_id ? '\nA hozzá tartozó kötés megmarad.' : ''}`)) return;
    await api(`/api/tasks/${d.delTask}`, { method: 'DELETE' }); loadDay();
  } else if (d.editTask) {
    openTaskForm({ edit: ns.data.tasks.find((x) => x.id === +d.editTask) });
  }
});

$('#tasks').addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-finish-form]');
  if (!f) return;
  e.preventDefault();
  const t = ns.data.tasks.find((x) => x.id === +f.dataset.finishForm);
  const v = Object.fromEntries(new FormData(f).entries());
  const body = { done_qty: v.done_qty, status: v.status || null, reason: v.reason, note: v.note };
  if (t.kind === 'ontes') {
    body.ended_at = toIso(ns.day, v.ended);
    if (v.curing) body.curing = v.curing;
    if (v.started && !t.started_at) await api(`/api/tasks/${t.id}/start`, { method: 'POST', body: { at: toIso(ns.day, v.started) } });
  }
  const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
  try {
    const res = await api(`/api/tasks/${t.id}/finish`, { method: 'POST', body });
    ns.finishing = null;
    toast(res.run_id && !t.run_id ? 'Öntés lezárva, a kötés elindult' : 'Mentve');
    loadDay();
  } finally { btn.disabled = false; }
});

// --- Feladat felvétele / szerkesztése (felugró ablak; nap-, hét- és hónapnézetből is) ---
async function openTaskForm(mode, day = ns.day) {
  if (!ns.jobs.length && !ns.jobsLoaded) { ns.jobs = (await api('/api/jobs')).filter((j) => j.status === 'Aktív'); ns.jobsLoaded = true; }
  ns.taskMode = mode;
  const f = $('#task-form');
  f.reset();
  $('#tf-job').innerHTML = opts(ns.jobs.map((j) => [j.id, j.name]), null, '—');
  const t = mode.edit || null;
  const extra = mode === 'extra' || (t && t.unplanned);
  $('#task-form-title').textContent = t ? 'Feladat szerkesztése' : extra ? 'Plusz munka' : 'Tervezett feladat';
  f.kind.disabled = !!t;
  f.day.value = t ? t.day : day;
  if (t) {
    f.kind.value = t.kind; syncTaskForm();
    f.template.value = t.template || ''; f.job_id.value = t.job_id || '';
    f.qty.value = (extra ? t.done_qty : t.planned_qty) ?? ''; f.title.value = t.title; f.note.value = t.note;
  } else {
    f.kind.value = 'ontes'; syncTaskForm();
  }
  $('#task-dialog').showModal();
}
function syncTaskForm() {
  const f = $('#task-form'), k = f.kind.value;
  const extra = ns.taskMode === 'extra' || ns.taskMode?.edit?.unplanned;
  f.querySelector('[data-for="template"]').hidden = !['ontes', 'kiforgatas'].includes(k);
  f.querySelector('[data-for="job"]').hidden = k !== 'telepites';
  f.querySelector('[data-for="title"]').hidden = ['ontes', 'telepites'].includes(k);
  f.querySelector('[data-for="qty"]').hidden = k === 'egyeb';
  $('#tf-template').innerHTML = (k === 'kiforgatas' ? '<option value="">bármelyik</option>' : '') + opts(ns.templates.map((t) => [t, t]));
  const unit = ns.cfg.kinds[k].unit;
  $('#tf-qty-label').textContent = `${extra ? 'Elvégzett' : 'Tervezett'} mennyiség${unit ? ` (${unit})` : ''}`;
}
$('#tf-kind').addEventListener('change', syncTaskForm);
$('#task-add-btns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add-task]');
  if (b) openTaskForm(b.dataset.addTask);
});
$('#tf-cancel').addEventListener('click', () => $('#task-dialog').close());
$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, k = f.kind.value, mode = ns.taskMode;
  const common = {
    template: ['ontes', 'kiforgatas'].includes(k) ? f.template.value : null,
    job_id: k === 'telepites' ? f.job_id.value : null,
    title: ['ontes', 'telepites'].includes(k) ? '' : f.title.value,
    note: f.note.value,
  };
  if (mode.edit) {
    const t = mode.edit;
    await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { ...common, day: f.day.value, [t.unplanned ? 'done_qty' : 'planned_qty']: f.qty.value } });
  } else {
    await api('/api/tasks', { method: 'POST', body: { day: f.day.value, kind: k, ...common, unplanned: mode === 'extra',
      [mode === 'extra' ? 'done_qty' : 'planned_qty']: f.qty.value } });
  }
  $('#task-dialog').close();
  toast('Mentve'); reload();
});

// --- Munkások aznap ---
function renderLogs(d) {
  const today = d.day === d.today;
  $('#logs').innerHTML = d.logs.map((l) => ns.editingLog === l.id ? logForm(l, d) : `
    <div class="item log">
      <span><b>${esc(l.worker_name)}</b> · ${esc(ns.cfg.workKinds[l.kind])}${l.job_name ? ': ' + esc(l.job_name) : ''}
        <br><span class="muted small">${l.start_time || '?'} – ${l.end_time || (today ? 'most is bent' : '?')}${l.break_min ? ` (−${l.break_min} p)` : ''}${l.hours !== null ? ` · ${fmt(l.hours, 1)} óra` : ''} · ${ft(l.amount)}${l.amount_manual ? ' (kézi)' : ''}</span></span>
      <span class="row-btns">${!l.end_time && today ? `<button class="btn success sm" data-leave="${l.id}">Távozott</button>` : ''}
        <button class="btn sm ghost" data-edit-log="${l.id}" aria-label="Szerkesztés">✎</button></span>
    </div>`).join('') || '<p class="muted">Még senki nincs rögzítve.</p>';
  const inside = new Set(d.logs.map((l) => l.worker_id));
  const rest = d.workers.filter((w) => !inside.has(w.id));
  $('#quick-workers').innerHTML = d.closed_at ? '' : rest.length
    ? `<span class="muted small">${today ? 'Megérkezett (most):' : 'Hozzáad:'}</span>${rest.map((w) => `<button class="chip" data-arrive="${w.id}">+ ${esc(w.name)}</button>`).join('')}`
    : d.workers.length ? '' : '<p class="muted small">Még nincs munkás felvéve. Vedd fel a Munkások fülön.</p>';
}

function logForm(l, d) {
  return `<form class="sub log-edit" data-log-form="${l.id}">
    <b>${esc(l.worker_name)}</b>
    <div class="row3">
      <label>Érkezés<input name="start_time" type="time" value="${esc(l.start_time || '')}"></label>
      <label>Távozás<input name="end_time" type="time" value="${esc(l.end_time || '')}"></label>
      <label>Szünet (perc)<input name="break_min" type="number" min="0" step="5" value="${l.break_min}"></label>
      <label>Munka<select name="kind">${opts(Object.entries(ns.cfg.workKinds), l.kind)}</select></label>
      <label>Projekt<select name="job_id">${opts(d.jobs.map((j) => [j.id, j.name]), l.job_id, '—')}</select></label>
      <label>Díjazás<select name="pay_type">${opts(Object.entries(ns.cfg.payTypes), l.pay_type)}</select></label>
      <label>Díj (Ft)<input name="rate" type="number" min="0" step="any" value="${l.rate}"></label>
      <label>Darab (darabbérnél)<input name="pieces" type="number" min="0" step="any" value="${l.pieces ?? ''}" placeholder="${d.summary.poured || ''}"></label>
      <label>Bér kézzel (Ft)<input name="amount" type="number" min="0" step="any" value="${l.amount_manual ? l.amount : ''}" placeholder="számolt: ${Math.round(l.amount)}"></label>
      <label class="span3">Megjegyzés<input name="note" maxlength="500" value="${esc(l.note)}"></label>
    </div>
    <div class="row-btns wrap"><button class="btn primary" type="submit">Mentés</button>
      <button class="btn" type="button" data-log-cancel>Mégse</button>
      <button class="btn ghost" type="button" data-del-log="${l.id}">Törlés</button></div>
  </form>`;
}

$('#logs').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.leave) { await api(`/api/worklogs/${b.dataset.leave}`, { method: 'PATCH', body: { leave: true } }); toast('Távozás rögzítve'); loadDay(); }
  if (b.dataset.editLog) { ns.editingLog = +b.dataset.editLog; renderLogs(ns.data); }
  if (b.dataset.logCancel !== undefined) { ns.editingLog = null; renderLogs(ns.data); }
  if (b.dataset.delLog && confirm('Törlöd ezt a munkanapot?')) {
    await api(`/api/worklogs/${b.dataset.delLog}`, { method: 'DELETE' }); ns.editingLog = null; loadDay();
  }
});
$('#logs').addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-log-form]');
  if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f).entries());
  await api(`/api/worklogs/${f.dataset.logForm}`, { method: 'PATCH', body: v });
  ns.editingLog = null; toast('Mentve'); loadDay();
});
$('#quick-workers').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-arrive]');
  if (!b) return;
  if (ns.day !== ns.data.today) {
    $('#log-details').open = true; $('#lf-worker').value = b.dataset.arrive; $('#log-form').start_time.focus();
    return;
  }
  await api('/api/worklogs', { method: 'POST', body: { day: ns.day, worker_id: b.dataset.arrive } });
  toast('Érkezés rögzítve'); loadDay();
});
$('#lf-kind').addEventListener('change', () => { $('#log-form [data-for="job"]').hidden = $('#lf-kind').value !== 'telepites'; });
$('#log-form [data-for="job"]').hidden = true;
$('#log-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  if (!v.start_time) delete v.start_time;
  await api('/api/worklogs', { method: 'POST', body: { day: ns.day, ...v } });
  e.target.reset(); $('#log-details').open = false; toast('Rögzítve'); loadDay();
});

// --- Napzárás (felugró ablak) ---
function openClose() {
  const d = ns.data;
  const open = d.tasks.filter((t) => t.status === 'terv');
  const running = d.tasks.filter((t) => t.status === 'folyamatban');
  const noLeave = d.logs.filter((l) => !l.end_time);
  const warn = [];
  if (running.length) warn.push(`Még fut: ${running.map((t) => esc(taskName(t))).join(', ')} – előbb zárd le.`);
  if (noLeave.length) warn.push(`Nincs távozás: ${noLeave.map((l) => esc(l.worker_name)).join(', ')}.`);
  if (open.length) warn.push(`${open.length} feladat nincs lezárva, ezek „nem készült el” állapotba kerülnek.`);
  const s = d.summary;
  $('#close-check').innerHTML = `<div class="kv"><span>Öntve: <b>${s.poured}${s.poured_planned ? ' / ' + s.poured_planned : ''} db</b></span>
      <span>Terv: <b>${s.planned_done}/${s.planned_total} kész</b></span><span>Munkaóra: <b>${fmt(s.hours, 1)}</b></span><span>Bér: <b>${ft(s.cost)}</b></span></div>
    ${warn.map((w) => `<p class="small ${w.startsWith('Még fut') || w.startsWith('Nincs') ? 'neg' : 'muted'}">${w}</p>`).join('')}`;
  $('#day-note').value = d.note || '';
  $('#close-dialog').showModal();
}
$('#close-cancel').addEventListener('click', () => $('#close-dialog').close());
$('#day-close').addEventListener('click', async () => {
  const res = await api('/api/day/close', { method: 'POST', body: { date: ns.day, note: $('#day-note').value, carry: $('#day-carry').checked } });
  $('#close-dialog').close();
  toast(`Nap lezárva${res.carried ? ` · ${res.carried} feladat átkerült a következő napra` : ''}`);
  loadDay(); window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ===================================================================
// Hét és hónap
// ===================================================================
function dayClass(x, today) {
  const planned = x.tasks.filter((t) => !t.unplanned);
  if (x.closed_at) {
    if (!planned.length) return 'done';
    const c = completion(x.tasks);
    return c >= 0.999 ? 'done' : c > 0 ? 'part' : 'miss';
  }
  if (x.started_at) return 'running';
  if (x.day < today && planned.length) return 'open';
  return planned.length ? 'plan' : 'empty';
}
const DAY_STATE_TEXT = { done: '✓ lezárva', part: '✓ lezárva', miss: '✓ lezárva', running: '● fut', open: 'nincs lezárva', plan: 'terv', empty: '' };

function periodSummary(days, el) {
  const sum = (f) => days.reduce((a, x) => a + (Number(f(x.summary)) || 0), 0);
  const all = days.flatMap((x) => x.tasks);
  const c = completion(all.filter((t) => t.day <= ns.cfg.today));
  const prod = sum((s) => s.prod_hours), poured = sum((s) => s.poured);
  $(el).innerHTML = [
    `<span>Öntve <b>${poured}</b><small> / ${sum((s) => s.poured_planned)} db terv</small></span>`,
    `<span>Kiforgatva <b>${sum((s) => s.demolded)}</b> db</span>`,
    `<span>Telepítve <b>${fmt(sum((s) => s.installed_m), 0)}</b> m</span>`,
    `<span>Terv teljesítése <b>${c === null ? '–' : Math.round(c * 100) + '%'}</b><small> (eddigi napok)</small></span>`,
    `<span>Munkaóra <b>${fmt(sum((s) => s.hours), 0)}</b></span>`,
    `<span>Bér <b>${ft(sum((s) => s.cost))}</b></span>`,
    prod && poured ? `<span>Panel/ember-óra <b>${fmt(poured / prod, 1)}</b></span>` : '',
  ].join('');
}

async function loadWeek() {
  const from = monday(ns.day), to = shiftDay(from, 6);
  const p = await api(`/api/plan?from=${from}&to=${to}`);
  ns.plan = p;
  $('#plan-title').textContent = `${from.slice(0, 4)}. ${MONTHS[+from.slice(5, 7) - 1]} ${+from.slice(8)}. – ${from.slice(5, 7) === to.slice(5, 7) ? '' : MONTHS[+to.slice(5, 7) - 1] + ' '}${+to.slice(8)}.`;
  periodSummary(p.days, '#week-summary');
  $('#week').innerHTML = p.days.map((x) => {
    const cls = dayClass(x, p.today);
    const c = completion(x.tasks);
    const s = x.summary;
    return `<div class="wday st-${cls} ${x.day === p.today ? 'today' : ''}" data-drop-day="${x.day}">
      <button class="wday-head" data-goto="${x.day}" type="button">
        <span><b>${WD_SHORT[dow(x.day)]}</b> ${dm(x.day)}</span><span class="small">${DAY_STATE_TEXT[cls]}</span></button>
      ${c !== null ? `<div class="bar sm ${c >= 0.999 ? 'done' : ''}"><i style="width:${Math.round(c * 100)}%"></i></div>` : ''}
      <div class="wtasks">${x.tasks.map((t) => {
        const q = t.unplanned ? (t.done_qty ?? '') : t.done_qty !== null ? `${fmt(t.done_qty, 0)}/${fmt(t.planned_qty, 0)}` : t.planned_qty !== null ? fmt(t.planned_qty, 0) : '';
        return `<div class="tchip st-${t.status} ${t.unplanned ? 'extra' : ''}" draggable="true" data-chip="${t.id}" title="${esc(STATUS[t.status][0])}">
          <span>${t.unplanned ? '+ ' : ''}${esc(taskName(t))}</span>${q !== '' ? `<b>${q}${t.unit ? ' ' + t.unit : ''}</b>` : ''}</div>`;
      }).join('')}</div>
      ${s.poured || s.hours ? `<div class="wfoot small muted">${s.poured ? `${s.poured} db öntve` : ''}${s.poured && s.hours ? ' · ' : ''}${s.hours ? `${fmt(s.hours, 0)} ó` : ''}</div>` : ''}
      <button class="btn sm ghost wadd" data-add-day="${x.day}" type="button">+ feladat</button>
    </div>`;
  }).join('');
}

const weekEl = $('#week');
weekEl.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  const add = e.target.closest('[data-add-day]');
  const chip = e.target.closest('[data-chip]');
  if (go) setView('day', go.dataset.goto);
  else if (add) openTaskForm('plan', add.dataset.addDay);
  else if (chip) {
    const t = ns.plan.days.flatMap((x) => x.tasks).find((x) => x.id === +chip.dataset.chip);
    openTaskForm({ edit: t });
  }
});
// Húzás másik napra (gépen).
weekEl.addEventListener('dragstart', (e) => {
  const c = e.target.closest('[data-chip]');
  if (!c) return;
  e.dataTransfer.setData('text/plain', c.dataset.chip); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging');
});
weekEl.addEventListener('dragend', (e) => e.target.closest?.('[data-chip]')?.classList.remove('dragging'));
weekEl.addEventListener('dragover', (e) => {
  const d = e.target.closest('[data-drop-day]');
  if (!d) return;
  e.preventDefault(); $$('.wday.over').forEach((x) => x !== d && x.classList.remove('over')); d.classList.add('over');
});
weekEl.addEventListener('dragleave', (e) => { const d = e.target.closest('[data-drop-day]'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('over'); });
weekEl.addEventListener('drop', async (e) => {
  const d = e.target.closest('[data-drop-day]');
  if (!d) return;
  e.preventDefault(); d.classList.remove('over');
  const id = e.dataTransfer.getData('text/plain');
  const t = ns.plan.days.flatMap((x) => x.tasks).find((x) => x.id === +id);
  if (!t || t.day === d.dataset.dropDay) return;
  await api(`/api/tasks/${id}`, { method: 'PATCH', body: { day: d.dataset.dropDay } });
  toast(`Áthelyezve: ${dm(d.dataset.dropDay)}`); loadWeek();
});

async function loadMonth() {
  const first = `${ns.day.slice(0, 7)}-01`, last = monthEnd(first);
  const from = monday(first), to = shiftDay(monday(last), 6);
  const p = await api(`/api/plan?from=${from}&to=${to}`);
  ns.plan = p;
  $('#plan-title').textContent = `${first.slice(0, 4)}. ${MONTHS[+first.slice(5, 7) - 1]}`;
  periodSummary(p.days.filter((x) => x.day >= first && x.day <= last), '#month-summary');
  $('#month').innerHTML = p.days.map((x) => {
    const cls = dayClass(x, p.today);
    const c = completion(x.tasks);
    const s = x.summary;
    const planned = x.tasks.filter((t) => !t.unplanned).length;
    const out = x.day < first || x.day > last;
    return `<button type="button" class="mday st-${cls} ${out ? 'out' : ''} ${x.day === p.today ? 'today' : ''}" data-goto="${x.day}">
      <span class="mnum">${+x.day.slice(8)}</span>
      ${c !== null ? `<span class="bar sm ${c >= 0.999 ? 'done' : ''}"><i style="width:${Math.round(c * 100)}%"></i></span>` : ''}
      ${s.poured || s.poured_planned ? `<span class="mline" title="öntött / tervezett darab">${s.poured}${s.poured_planned ? '/' + s.poured_planned : ''}</span>` : ''}
      ${s.installed_m ? `<span class="mline">${fmt(s.installed_m, 0)} m</span>` : ''}
      ${planned && !s.poured_planned ? `<span class="mline muted">${planned} feladat</span>` : ''}
    </button>`;
  }).join('');
}
$('#month').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) setView('day', b.dataset.goto); });

// ===================================================================
// Munkások
// ===================================================================
export async function loadWorkers() {
  const list = await api('/api/workers');
  ns.workers = list;
  const shown = list.filter((w) => w.active || ns.showInactive);
  $('#workers').innerHTML = shown.map((w) => `<button class="item ${ns.worker === w.id ? 'active' : ''}" data-worker="${w.id}">
    <span><b>${esc(w.name)}</b>${w.active ? '' : ' <span class="muted small">(inaktív)</span>'}<br>
      <span class="muted small">${esc(ns.cfg.payTypes[w.pay_type])}: ${ft(w.rate)} · ${w.days_worked} nap${w.last_day ? ` · utoljára ${w.last_day}` : ''}</span></span>
    <span class="small ${w.balance < 0 ? 'neg' : ''}">${balanceText(w.balance)}</span></button>`).join('')
    || '<p class="muted">Még nincs munkás.</p>';
  if (ns.worker) showWorker(ns.worker);
}
const balanceText = (b) => (Math.abs(b) < 1 ? 'rendezve' : b > 0 ? `tartozunk: ${ft(b)}` : `ő tartozik: ${ft(-b)}`);

$('#show-inactive').addEventListener('change', (e) => { ns.showInactive = e.target.checked; loadWorkers(); });
$('#workers').addEventListener('click', (e) => { const b = e.target.closest('[data-worker]'); if (b) showWorker(+b.dataset.worker); });
$('#worker-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('/api/workers', { method: 'POST', body: Object.fromEntries(new FormData(e.target).entries()) });
  e.target.reset(); e.target.closest('details').open = false; ns.worker = res.worker_id;
  toast('Munkás felvéve'); loadWorkers();
});

async function showWorker(id) {
  ns.worker = id;
  $$('#workers [data-worker]').forEach((b) => b.classList.toggle('active', +b.dataset.worker === id));
  const { worker: w, logs, payments } = await api(`/api/workers/${id}`);
  const box = $('#worker-detail');
  box.hidden = false;
  box.innerHTML = `
    <div class="card-head"><h2>${esc(w.name)}</h2>${w.phone ? `<a class="btn sm" href="tel:${esc(w.phone.replace(/\s/g, ''))}">${esc(w.phone)}</a>` : ''}</div>
    <div class="kv big">
      <span>Megdolgozott: <b>${ft(w.earned)}</b></span>
      <span>Kifizetve: <b>${ft(w.paid)}</b></span>
      <span>Egyenleg: <b class="${w.balance < 0 ? 'neg' : ''}">${balanceText(w.balance)}</b></span>
    </div>

    <h3>Kifizetés / előleg / kölcsön</h3>
    <form id="pay-form" class="row3">
      <label>Típus<select name="kind">${opts(Object.entries(ns.cfg.paymentKinds), 'ber')}</select></label>
      <label>Összeg (Ft)<input name="amount" type="number" min="1" step="any" required value="${w.balance > 0 ? Math.round(w.balance) : ''}"></label>
      <label>Dátum<input name="day" type="date" value="${ns.cfg.today}"></label>
      <label class="span3">Megjegyzés<input name="note" maxlength="500"></label>
      <button class="btn primary" type="submit">Rögzítés</button>
    </form>

    <h3>Munkanapok</h3>
    <div class="table-wrap"><table><thead><tr><th>Nap</th><th>Munka</th><th>Idő</th><th class="num">Óra</th><th class="num">Bér</th></tr></thead><tbody>
      ${logs.map((l) => `<tr><td><button class="link" data-goto-day="${l.day}">${l.day}</button></td><td>${esc(ns.cfg.workKinds[l.kind])}${l.job_name ? ': ' + esc(l.job_name) : ''}</td>
        <td>${l.start_time || '?'}–${l.end_time || '?'}</td><td class="num">${l.hours !== null ? fmt(l.hours, 1) : '–'}</td><td class="num">${ft(l.amount)}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">Még nem dolgozott.</td></tr>'}
    </tbody></table></div>

    <h3>Kifizetések</h3>
    <div class="list">${payments.map((p) => `<div class="item small"><span><b>${ft(p.amount)}</b> · ${esc(ns.cfg.paymentKinds[p.kind])} · ${p.day}${p.note ? ' · ' + esc(p.note) : ''}</span>
      <button class="btn sm ghost" data-del-pay="${p.id}" aria-label="Törlés">✕</button></div>`).join('') || '<p class="muted small">Nincs.</p>'}</div>

    <details class="sub"><summary>Adatok szerkesztése</summary>
      <form id="worker-edit">
        <label>Név<input name="name" required maxlength="80" value="${esc(w.name)}"></label>
        <label>Telefon<input name="phone" type="tel" maxlength="40" value="${esc(w.phone)}"></label>
        <div class="row3">
          <label>Díjazás<select name="pay_type">${opts(Object.entries(ns.cfg.payTypes), w.pay_type)}</select></label>
          <label>Díj (Ft)<input name="rate" type="number" min="0" step="any" value="${w.rate}"></label>
        </div>
        <label>Megjegyzés<input name="note" maxlength="500" value="${esc(w.note)}"></label>
        <label class="check"><input type="checkbox" name="active" ${w.active ? 'checked' : ''}> Aktív (megjelenik a napi lapon)</label>
        <p class="muted small">A díj módosítása csak az új munkanapokra vonatkozik; a régiek a rögzítéskori díjjal maradnak.</p>
        <button class="btn primary" type="submit">Mentés</button>
      </form>
    </details>`;
}

$('#worker-detail').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const v = Object.fromEntries(new FormData(f).entries());
  if (f.id === 'pay-form') {
    await api('/api/payments', { method: 'POST', body: { ...v, worker_id: ns.worker } });
    toast('Rögzítve');
  } else if (f.id === 'worker-edit') {
    await api(`/api/workers/${ns.worker}`, { method: 'PATCH', body: { ...v, active: f.active.checked } });
    toast('Mentve');
  }
  loadWorkers();
});
$('#worker-detail').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-pay]');
  const go = e.target.closest('[data-goto-day]');
  if (del && confirm('Törlöd ezt a kifizetést?')) { await api(`/api/payments/${del.dataset.delPay}`, { method: 'DELETE' }); loadWorkers(); }
  if (go) { ns.day = go.dataset.gotoDay; ns.view = 'day'; document.querySelector('.tabs button[data-tab="nap"]').click(); }
});
