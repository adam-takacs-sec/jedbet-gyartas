// Napi lap (terv → öntés → napzárás) és Munkások fül.
import { $, $$, esc, fmt, ft, hhmm, api, toast } from './lib.js';

const ns = {
  cfg: null, templates: [], day: null, data: null,
  finishing: null,   // feladat id, aminek a lezáró űrlapja nyitva van
  editingLog: null,  // munkanapló id, ami szerkesztés alatt van
  taskMode: null,    // 'plan' | 'extra' | {edit: id}
  worker: null, showInactive: false,
};

const STATUS = {
  terv: ['Terv', 'plan'], folyamatban: ['Folyamatban', 'wait'], kesz: ['Kész', 'ready'],
  reszben: ['Részben', 'hideg'], nem: ['Nem készült el', 'fagy'],
};
const WEEKDAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
const weekday = (d) => WEEKDAYS[new Date(`${d}T12:00:00`).getDay()];
const shiftDay = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nowHHMM = () => new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', hour12: false });
const toIso = (day, time) => (time ? new Date(`${day}T${time}`).toISOString() : null);
const opts = (list, sel, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
const qtyText = (v, unit) => (v === null || v === undefined ? '–' : `${fmt(v, Number.isInteger(+v) ? 0 : 1)}${unit ? ' ' + unit : ''}`);

export async function initNap(config) {
  ns.templates = config.templates;
  ns.cfg = await api('/api/nap/config');
  ns.day = ns.cfg.today;
  $('#tf-kind').innerHTML = opts(Object.entries(ns.cfg.kinds).map(([k, v]) => [k, v.label]));
  $('#tf-template').innerHTML = opts(ns.templates.map((t) => [t, t]));
  $('#lf-kind').innerHTML = opts(Object.entries(ns.cfg.workKinds));
  $$('.pay-type').forEach((s) => (s.innerHTML = opts(Object.entries(ns.cfg.payTypes), 'ora')));
}

// ===================================================================
// Napi lap
// ===================================================================
export async function loadNap() {
  const d = await api(`/api/day?date=${ns.day}`);
  ns.data = d;
  $('#day-date').value = d.day;
  $('#day-title').textContent = `${weekday(d.day)}${d.day === d.today ? ' · ma' : ''}`;
  $('#day-badge').innerHTML = d.closed_at ? '<span class="badge ended">Lezárva</span>' : '';
  renderSummary(d);
  renderTasks(d);
  renderLogs(d);
  $('#day-note').value = d.note || '';
  $('#day-close').textContent = d.closed_at ? 'Újra lezárás' : 'Nap lezárása';
  $('#day-reopen').hidden = !d.closed_at;
  $('#tf-job').innerHTML = opts(d.jobs.map((j) => [j.id, j.name]), null, '—');
  $('#lf-job').innerHTML = opts(d.jobs.map((j) => [j.id, j.name]), null, '—');
  $('#lf-worker').innerHTML = opts(d.workers.map((w) => [w.id, w.name]), null, 'Válassz…');
  loadDays();
}

function renderSummary({ summary: s }) {
  const parts = [];
  parts.push(`<span>Öntve: <b>${s.poured} db</b>${s.poured_planned ? ` <span class="muted">/ ${s.poured_planned} terv</span>` : ''}</span>`);
  if (s.demolded) parts.push(`<span>Kiforgatva: <b>${s.demolded} db</b></span>`);
  if (s.installed_m) parts.push(`<span>Telepítve: <b>${fmt(s.installed_m, 0)} m</b></span>`);
  parts.push(`<span>Terv: <b>${s.planned_done}/${s.planned_total} kész</b>${s.planned_partial ? ` · ${s.planned_partial} részben` : ''}${s.planned_missed ? ` · <span class="neg">${s.planned_missed} nem</span>` : ''}${s.unplanned ? ` · +${s.unplanned} plusz` : ''}</span>`);
  parts.push(`<span>Munkások: <b>${s.workers} fő · ${fmt(s.hours, 1)} óra</b></span>`);
  parts.push(`<span>Bér: <b>${ft(s.cost)}</b></span>`);
  if (s.per_man_hour !== null) parts.push(`<span>Panel / ember-óra: <b>${fmt(s.per_man_hour, 1)}</b></span>`);
  $('#day-summary').innerHTML = parts.join('');
}

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
    (planned.length ? block(planned) : '<p class="muted">Nincs tervezett feladat erre a napra.</p>') +
    (extra.length ? `<h3>Plusz munka</h3>${block(extra)}` : '');
}

function taskHtml(t, d) {
  const [stLabel, stCls] = STATUS[t.status];
  const unit = t.unit;
  const qty = t.unplanned ? (t.done_qty === null ? '' : qtyText(t.done_qty, unit))
    : t.done_qty !== null ? `${qtyText(t.done_qty, unit)} / ${qtyText(t.planned_qty, unit)}`
    : t.planned_qty !== null ? `terv: ${qtyText(t.planned_qty, unit)}` : '';
  const times = t.kind === 'ontes' && t.started_at
    ? `${hhmm(t.started_at)}${t.ended_at ? ' – ' + hhmm(t.ended_at) : ' óta'}` : '';
  const finished = ['kesz', 'reszben', 'nem'].includes(t.status);
  let actions = '';
  if (t.status === 'terv' && t.kind === 'ontes') actions = `<button class="btn primary sm" data-start="${t.id}">Öntés indítása</button><button class="btn sm" data-finish="${t.id}">Lezárás</button>`;
  else if (t.status === 'folyamatban') actions = `<button class="btn success sm" data-finish="${t.id}">Öntés lezárása</button>`;
  else if (t.status === 'terv') actions = `<button class="btn primary sm" data-finish="${t.id}">Lezárás</button>`;
  else actions = `<button class="btn sm" data-finish="${t.id}">Módosítás</button>`;
  actions += `<button class="btn sm ghost" data-edit-task="${t.id}" aria-label="Szerkesztés">✎</button><button class="btn sm ghost" data-del-task="${t.id}" aria-label="Törlés">✕</button>`;
  return `<div class="task st-${t.status}" data-task="${t.id}">
    <div class="task-main">
      <div><b>${esc(taskName(t))}</b>${t.carried_from ? ' <span class="muted small">(áthozva)</span>' : ''}
        <div class="muted small">${[qty && `<span class="qty-txt">${qty}</span>`, times,
          t.run_id ? `kötés: ${esc(t.run_name || '#' + t.run_id)}` : '',
          t.reason && t.status !== 'kesz' ? `<span class="neg">${esc(t.reason)}</span>` : '',
          t.note ? esc(t.note) : ''].filter(Boolean).join(' · ')}</div></div>
      <span class="badge ${stCls}">${stLabel}</span>
    </div>
    <div class="row-btns wrap">${actions}</div>
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
      <button class="btn" type="button" data-finish-cancel>Mégse</button></div>
  </form>`;
}

$('#tasks').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.start) {
    await api(`/api/tasks/${d.start}/start`, { method: 'POST', body: ns.day === ns.data.today ? {} : { at: toIso(ns.day, prompt('Öntés kezdete (ÓÓ:PP):', '07:00') || '07:00') } });
    toast('Öntés elindítva'); loadNap();
  } else if (d.finish) {
    ns.finishing = ns.finishing === +d.finish ? null : +d.finish; renderTasks(ns.data);
    $(`[data-finish-form="${d.finish}"] input[name="done_qty"]`)?.focus();
  } else if (d.finishCancel !== undefined) {
    ns.finishing = null; renderTasks(ns.data);
  } else if (d.reopenTask) {
    await api(`/api/tasks/${d.reopenTask}/reopen`, { method: 'POST', body: {} });
    ns.finishing = null; loadNap();
  } else if (d.delTask) {
    const t = ns.data.tasks.find((x) => x.id === +d.delTask);
    if (!confirm(`Törlöd: ${taskName(t)}?${t.run_id ? '\nA hozzá tartozó kötés megmarad.' : ''}`)) return;
    await api(`/api/tasks/${d.delTask}`, { method: 'DELETE' }); loadNap();
  } else if (d.editTask) {
    openTaskForm({ edit: +d.editTask });
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
    // Ha nem indítottad el külön, a kezdést itt is meg lehet adni.
    if (v.started && !t.started_at) await api(`/api/tasks/${t.id}/start`, { method: 'POST', body: { at: toIso(ns.day, v.started) } });
  }
  const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
  try {
    const res = await api(`/api/tasks/${t.id}/finish`, { method: 'POST', body });
    ns.finishing = null;
    toast(res.run_id && !t.run_id ? 'Öntés lezárva, a kötés elindult' : 'Mentve');
    loadNap();
  } finally { btn.disabled = false; }
});

// --- Feladat felvétele / szerkesztése ---
function openTaskForm(mode) {
  ns.taskMode = mode;
  const f = $('#task-form');
  f.reset();
  const t = mode.edit ? ns.data.tasks.find((x) => x.id === mode.edit) : null;
  const extra = mode === 'extra' || (t && t.unplanned);
  $('#task-form-title').textContent = t ? 'Feladat szerkesztése' : extra ? 'Plusz munka (amit nem terveztél, de megcsináltatok)' : 'Tervezett feladat';
  $('#tf-qty-label').textContent = extra ? 'Elvégzett mennyiség' : 'Tervezett mennyiség';
  f.kind.disabled = !!t;
  if (t) {
    f.kind.value = t.kind; f.template.value = t.template || ns.templates[0]; f.job_id.value = t.job_id || '';
    f.qty.value = (extra ? t.done_qty : t.planned_qty) ?? ''; f.title.value = t.title; f.note.value = t.note;
  } else {
    f.kind.value = 'ontes';
  }
  syncTaskForm();
  f.hidden = false; $('#task-add-btns').hidden = true;
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function syncTaskForm() {
  const f = $('#task-form'), k = f.kind.value;
  f.querySelector('[data-for="template"]').hidden = !['ontes', 'kiforgatas'].includes(k);
  f.querySelector('[data-for="job"]').hidden = k !== 'telepites';
  f.querySelector('[data-for="title"]').hidden = ['ontes', 'telepites'].includes(k);
  f.querySelector('[data-for="qty"]').hidden = k === 'egyeb';
  if (k === 'kiforgatas' && !$('#tf-template option[value=""]')) $('#tf-template').insertAdjacentHTML('afterbegin', '<option value="">bármelyik</option>');
  if (k !== 'kiforgatas') $('#tf-template option[value=""]')?.remove();
  const unit = ns.cfg.kinds[k].unit;
  $('#tf-qty-label').textContent = `${ns.taskMode === 'extra' ? 'Elvégzett' : 'Tervezett'} mennyiség${unit ? ` (${unit})` : ''}`;
}
$('#tf-kind').addEventListener('change', syncTaskForm);
$('#task-add-btns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add-task]');
  if (b) openTaskForm(b.dataset.addTask);
});
$('#tf-cancel').addEventListener('click', () => { $('#task-form').hidden = true; $('#task-add-btns').hidden = false; });
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
    const t = ns.data.tasks.find((x) => x.id === mode.edit);
    await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { ...common, [t.unplanned ? 'done_qty' : 'planned_qty']: f.qty.value } });
  } else {
    await api('/api/tasks', { method: 'POST', body: { day: ns.day, kind: k, ...common, unplanned: mode === 'extra',
      [mode === 'extra' ? 'done_qty' : 'planned_qty']: f.qty.value } });
  }
  f.hidden = true; $('#task-add-btns').hidden = false;
  toast('Mentve'); loadNap();
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
  $('#quick-workers').innerHTML = rest.length
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
  if (b.dataset.leave) { await api(`/api/worklogs/${b.dataset.leave}`, { method: 'PATCH', body: { leave: true } }); toast('Távozás rögzítve'); loadNap(); }
  if (b.dataset.editLog) { ns.editingLog = +b.dataset.editLog; renderLogs(ns.data); }
  if (b.dataset.logCancel !== undefined) { ns.editingLog = null; renderLogs(ns.data); }
  if (b.dataset.delLog && confirm('Törlöd ezt a munkanapot?')) {
    await api(`/api/worklogs/${b.dataset.delLog}`, { method: 'DELETE' }); ns.editingLog = null; loadNap();
  }
});
$('#logs').addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-log-form]');
  if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f).entries());
  await api(`/api/worklogs/${f.dataset.logForm}`, { method: 'PATCH', body: v });
  ns.editingLog = null; toast('Mentve'); loadNap();
});
$('#quick-workers').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-arrive]');
  if (!b) return;
  if (ns.day !== ns.data.today) {
    // Múltbeli napnál az időket a részletes űrlapon kell megadni.
    $('#log-details').open = true; $('#lf-worker').value = b.dataset.arrive; $('#log-form').start_time.focus();
    return;
  }
  await api('/api/worklogs', { method: 'POST', body: { day: ns.day, worker_id: b.dataset.arrive } });
  toast('Érkezés rögzítve'); loadNap();
});
$('#lf-kind').addEventListener('change', () => { $('#log-form [data-for="job"]').hidden = $('#lf-kind').value !== 'telepites'; });
$('#log-form [data-for="job"]').hidden = true;
$('#log-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  if (!v.start_time) delete v.start_time;
  await api('/api/worklogs', { method: 'POST', body: { day: ns.day, ...v } });
  e.target.reset(); $('#log-details').open = false; toast('Rögzítve'); loadNap();
});

// --- Napzárás ---
$('#day-close').addEventListener('click', async () => {
  const s = ns.data.summary;
  const open = ns.data.tasks.filter((t) => t.status === 'terv').length;
  if (open && !confirm(`${open} feladat még nincs lezárva; ezek „nem készült el” állapotba kerülnek. Lezárod a napot?`)) return;
  const res = await api('/api/day/close', { method: 'POST', body: { date: ns.day, note: $('#day-note').value, carry: $('#day-carry').checked } });
  toast(`Nap lezárva${res.carried ? ` · ${res.carried} feladat átkerült holnapra` : ''} · ${s.poured} db öntve`);
  loadNap();
});
$('#day-note-save').addEventListener('click', async () => {
  await api('/api/day', { method: 'PATCH', body: { date: ns.day, note: $('#day-note').value } }); toast('Megjegyzés mentve');
});
$('#day-reopen').addEventListener('click', async () => {
  await api('/api/day/reopen', { method: 'POST', body: { date: ns.day } }); loadNap();
});

// --- Napváltás ---
const goDay = (d) => { if (!d) return; ns.day = d; ns.finishing = null; ns.editingLog = null; $('#task-form').hidden = true; $('#task-add-btns').hidden = false; loadNap(); };
$('#day-prev').addEventListener('click', () => goDay(shiftDay(ns.day, -1)));
$('#day-next').addEventListener('click', () => goDay(shiftDay(ns.day, 1)));
$('#day-today').addEventListener('click', () => goDay(ns.data?.today || ns.cfg.today));
$('#day-date').addEventListener('change', (e) => goDay(e.target.value));

async function loadDays() {
  const days = await api('/api/days?limit=21', { quiet: true }).catch(() => []);
  $('#days-table tbody').innerHTML = days.map((x) => `<tr class="${x.day === ns.day ? 'selected' : ''}">
    <td><button class="link" data-goto="${x.day}">${x.day.slice(5).replace('-', '.')}.</button> <span class="muted small">${weekday(x.day).slice(0, 3)}</span></td>
    <td class="num">${x.planned_total ? `${x.planned_done}/${x.planned_total}` : '–'}</td>
    <td class="num">${x.poured || '–'}</td><td class="num">${x.demolded || '–'}</td><td class="num">${x.installed_m ? fmt(x.installed_m, 0) : '–'}</td>
    <td class="num">${x.hours ? fmt(x.hours, 1) : '–'}</td><td class="num">${x.cost ? ft(x.cost) : '–'}</td>
    <td class="num">${x.per_man_hour !== null ? fmt(x.per_man_hour, 1) : '–'}</td>
    <td>${x.closed_at ? '✓' : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Még nincs adat.</td></tr>';
}
$('#days-table').addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto]');
  if (b) { goDay(b.dataset.goto); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});

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
  if (go) { ns.day = go.dataset.gotoDay; document.querySelector('.tabs button[data-tab="nap"]').click(); }
});
