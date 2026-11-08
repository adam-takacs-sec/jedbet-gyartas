// JEDBET gyártási felület

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toLocaleString('hu-HU', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('hu-HU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
const ago = (iso) => {
  if (!iso) return null;
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 1) return 'most';
  if (min < 60) return `${Math.round(min)} perce`;
  if (min < 1440) return `${Math.round(min / 60)} órája`;
  return `${Math.round(min / 1440)} napja`;
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401) { toast('Lejárt a belépés, frissítsd az oldalt.', true); throw new Error('401'); }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) { const msg = data?.error || `Hiba (${res.status})`; if (!opts.quiet) toast(msg, true); throw new Error(msg); }
  return data;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 5000 : 2500);
}

const state = { config: null, mix: null, mixes: [], sensors: [], charts: {}, selectedJob: null, openRun: null };

// --- Fülek ---
function showTab(name) {
  $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('.tab').forEach((s) => (s.hidden = s.id !== `tab-${name}`));
  try { localStorage.setItem('tab', name); } catch {}
  ({ gyartas: loadMixes, erleles: loadCuring, raktar: loadInventory, munkak: loadJobs })[name]?.();
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// +/- gombok
document.addEventListener('click', (e) => {
  const b = e.target.closest('.qty button[data-step]');
  if (!b) return;
  const inp = b.parentElement.querySelector('input');
  inp.value = Math.max(0, (parseFloat(inp.value) || 0) + parseFloat(b.dataset.step));
});

const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ===================================================================
// Gyártás
// ===================================================================
$('#mix-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = formData(e.target);
  const res = await api('/api/mixes', { method: 'POST', body: d });
  toast(`Keverés #${res.mix_id} rögzítve`);
  if (res.negative_stock?.length) {
    setTimeout(() => toast(`Negatív készlet: ${res.negative_stock.map((s) => s.material).join(', ')} – könyveld a bevételt a Raktár fülön.`, true), 2600);
  }
  e.target.note.value = '';
  await loadMixes();
  selectMix(res.mix_id);
});

async function loadMixes() {
  state.mixes = await api('/api/mixes?limit=15');
  const tb = $('#mix-table tbody');
  tb.innerHTML = state.mixes.map((m) => `
    <tr data-id="${m.id}" class="${state.mix === m.id ? 'selected' : ''}">
      <td>${m.id}</td><td>${fmtTime(m.created_at)}</td>
      <td class="num">${fmt(m.cement, 0)}</td><td class="num">${fmt(m.viz, 0)}</td><td class="num">${fmt(m.kavics, 0)}</td>
      <td class="num">${fmt(m.folyosito, 0)}</td><td class="num">${fmt(m.kalcidur, 0)}</td><td class="num">${fmt(m.roskadas, 0)}</td>
      <td class="num">${m.pour_count}</td>
      <td><button class="btn sm" data-select="${m.id}">Kiválaszt</button></td>
    </tr>`).join('') || '<tr><td colspan="10" class="muted">Még nincs keverés.</td></tr>';
  if (!state.mix && state.mixes.length) selectMix(state.mixes[0].id, false);
}
$('#mix-table').addEventListener('click', (e) => {
  const b = e.target.closest('[data-select]');
  if (b) selectMix(+b.dataset.select);
});

async function selectMix(id, scroll = true) {
  state.mix = id;
  const m = state.mixes.find((x) => x.id === id);
  $('#active-mix').innerHTML = m
    ? `Kiválasztva: <b>#${m.id}</b> · ${fmtTime(m.created_at)} · ${fmt(m.cement, 0)} kg cement, ${fmt(m.viz, 0)} l víz${m.note ? ' · ' + esc(m.note) : ''}`
    : `Kiválasztva: <b>#${id}</b>`;
  $('#pour-submit').disabled = false;
  $$('#mix-table tr').forEach((tr) => tr.classList.toggle('selected', +tr.dataset.id === id));
  await loadPoursOfMix();
  if (scroll && window.innerWidth < 860) $('#pour-card').scrollIntoView({ behavior: 'smooth' });
}

async function loadPoursOfMix() {
  if (!state.mix) return;
  const pours = await api(`/api/pours?mix_id=${state.mix}`);
  $('#pours-of-mix').innerHTML = pours.map((p) => `
    <div class="item"><span><b>${esc(p.serial)}</b> · ${esc(p.template)}${p.extra_water_dl ? ` · +${fmt(p.extra_water_dl, 0)} dl víz` : ''}</span>
    <button class="btn sm" data-reprint="${p.id}" data-serial="${esc(p.serial)}" data-template="${esc(p.template)}" data-time="${esc(p.created_at)}">Újranyomtat</button></div>`).join('');
}
$('#pours-of-mix').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-reprint]');
  if (!b) return;
  const time = new Date(b.dataset.time).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  await sendLabel(+b.dataset.reprint, { serial: b.dataset.serial, template: b.dataset.template, mixId: state.mix, time });
});

$('#pour-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.mix) return;
  const f = e.target;
  const d = formData(f);
  $('#pour-submit').disabled = true;
  try {
    const p = await api('/api/pours', { method: 'POST', body: { mix_id: state.mix, template: d.template, extra_water_dl: d.extra_water_dl, note: d.note } });
    if (f.print.checked) await sendLabel(p.id, { serial: p.serial, template: p.template, mixId: state.mix, time: p.label_time });
    else toast(`${p.serial} mentve`);
    f.note.value = ''; f.extra_water_dl.value = 0;
    await loadPoursOfMix();
    loadMixes();
  } finally { $('#pour-submit').disabled = false; }
});

// --- Címke (384×240, fekete-fehér, a régi elrendezés szerint) ---
function drawLabel({ serial, template, mixId, time }) {
  const c = $('#label-canvas');
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#000'; g.strokeStyle = '#000';
  g.lineWidth = 3; g.strokeRect(5.5, 5.5, W - 11, H - 11);
  const font = (px) => `bold ${px}px "DejaVu Sans", Verdana, Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = font(34); g.fillText('JEDBET Kft.', W / 2, 35);

  // QR
  const qr = qrcode(0, 'M'); qr.addData(serial); qr.make();
  const n = qr.getModuleCount(), size = 100, cell = Math.floor(size / (n + 2)) || 1, off = (size - cell * n) / 2;
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    if (qr.isDark(r, col)) g.fillRect(15 + off + col * cell, 80 + off + r * cell, cell, cell);
  }

  const x = 135, maxW = W - x - 15;
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.font = font(16); g.fillText('sorszám:', x, 75);
  let px = 28; g.font = font(px);
  while (g.measureText(serial).width > maxW && px > 12) { px--; g.font = font(px); }
  g.fillText(serial, x, 92);
  g.font = font(16);
  g.fillText(`sablon: ${template}`, x, 130);
  g.fillText(`Recept ID: ${mixId}`, x, 155);
  g.fillText(`idő: ${time}`, x, 180);

  // 1 bites küszöbölés, hogy a hőnyomtató élesen nyomtasson
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11 < 140 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  c.hidden = false;
  return c.toDataURL('image/png');
}

async function sendLabel(pourId, info) {
  const png = drawLabel(info);
  await api(`/api/pours/${pourId}/print`, { method: 'POST', body: { png_base64: png } });
  toast(`${info.serial} – címke a nyomtatási sorban`);
  setTimeout(loadStatus, 4000);
}

// ===================================================================
// Kötés
// ===================================================================
async function loadSensors() {
  const { sensors, device } = await api('/api/sensors');
  state.sensors = sensors;
  $('#sensor-cards').innerHTML = sensors.filter((s) => s.active).map((s) => {
    const stale = !s.last_ts || Date.now() - Date.parse(s.last_ts) > 20 * 60000;
    return `<div class="sensor"><div class="l">${esc(s.label)} · ${s.role === 'air' ? 'levegő' : 'próbatest'}</div>
      <div class="t">${s.last_temp === null ? '–' : fmt(s.last_temp, 1) + ' °C'}</div>
      <div class="l ${stale ? 'neg' : ''}">${s.last_ts ? ago(s.last_ts) : 'nincs adat'}</div></div>`;
  }).join('') || '<p class="muted">Még nem jött adat a Pi-ről.</p>';

  $('#sensor-settings').innerHTML = sensors.map((s) => `
    <form class="sensor-row" data-id="${esc(s.id)}">
      <span class="id">${esc(s.id)}</span>
      <label>Név<input name="label" value="${esc(s.label)}" maxlength="60" required></label>
      <label>Szerep<select name="role"><option value="specimen" ${s.role === 'specimen' ? 'selected' : ''}>próbatest</option><option value="air" ${s.role === 'air' ? 'selected' : ''}>levegő</option></select></label>
      <label>Eltolás (°C)<input name="offset_c" type="number" step="0.05" min="-5" max="5" value="${s.offset_c}"></label>
      <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> aktív</label>
      <button class="btn sm" type="submit">Mentés</button>
    </form>`).join('');

  $('#run-sensors').innerHTML = sensors.filter((s) => s.active).map((s) =>
    `<label class="check"><input type="checkbox" name="sensor_ids" value="${esc(s.id)}" checked> ${esc(s.label)}${s.role === 'air' ? ' (levegő)' : ''}</label>`).join('');
  return device;
}
$('#sensor-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await api(`/api/sensors/${encodeURIComponent(f.dataset.id)}`, { method: 'PATCH',
    body: { label: f.label.value, role: f.role.value, offset_c: f.offset_c.value, active: f.active.checked } });
  toast('Szenzor mentve'); loadCuring();
});

async function loadCuring() {
  await loadSensors();
  const [runs, pallets] = await Promise.all([api('/api/curing'), api('/api/pallets')]);
  state.pallets = pallets;
  const box = $('#runs');
  Object.values(state.charts).forEach((c) => c.destroy()); state.charts = {};
  if (!runs.length) { box.innerHTML = '<p class="muted">Nincs kötés. Öntés végén indíts egyet.</p>'; return; }
  box.innerHTML = runs.map(runHtml).join('');
  for (const r of runs) if (!r.ended_at || state.openRun === r.id) openRunChart(r.id);
}

const todayLocalInput = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function runHtml(r) {
  const badge = r.ended_at ? '<span class="badge ended">Lezárva</span>'
    : r.ready ? '<span class="badge ready">Kiforgatható</span>'
    : '<span class="badge wait">Kötés alatt</span>';
  const frost = r.frost === 'fagy' ? '<span class="badge fagy">Fagy volt! 0 °C alatt</span>'
    : r.frost === 'hideg' ? '<span class="badge hideg">5 °C alatt is járt</span>' : '';
  const gov = r.sensors.find((s) => s.sensor_id === r.governing_sensor);
  const gaps = r.sensors.flatMap((s) => s.gaps.map((g) => ({ ...g, label: s.label })));
  const left = r.ready ? 'elérte' : r.hours_left === null ? '–' : `kb. ${fmt(r.hours_left, 0)} óra (a mostani hőmérséklettel)`;
  const pals = (state.pallets || []).filter((p) => p.run_id === r.id);
  const total = pals.reduce((a, p) => a + p.panel_count, 0);
  return `<div class="run" data-run="${r.id}">
    <div class="run-head"><div><div class="run-title">${esc(r.name)}</div>
      <div class="muted small">Öntés vége: ${fmtTime(r.started_at)}${r.ended_at ? ` · lezárva: ${fmtTime(r.ended_at)}` : ''}</div></div>
      <div>${badge} ${frost}</div></div>
    <div class="bar ${r.ready ? 'done' : ''}"><i style="width:${Math.round(r.progress * 100)}%"></i></div>
    <div class="kv">
      <span>Egyenértékű kor: <b>${fmt(r.eq_age_h, 1)} / ${fmt(r.target_te_h, 0)} óra</b></span>
      <span>Hátra: <b>${left}</b></span>
      <span>Döntő szenzor: <b>${gov ? esc(gov.label) : '–'}</b></span>
      ${r.sensors.map((s) => s.role === 'air'
        ? `<span>${esc(s.label)} (levegő): <b>${fmt(s.last_temp, 1)} °C</b> · min. ${fmt(s.min_temp, 1)} °C</span>`
        : `<span>${esc(s.label)}: <b>${fmt(s.last_temp, 1)} °C</b> · ${fmt(s.eq_age_h, 1)} ó · NS ${fmt(s.nurse_saul, 0)} °C·h</span>`).join('')}
    </div>
    ${gaps.length ? `<p class="small neg">Adatkiesés: ${gaps.map((g) => `${esc(g.label)} ${fmtTime(g.from)} – ${fmtTime(g.to)} (${g.minutes} perc)`).join('; ')}. Ezalatt az érettség nem nőtt, vagyis az érték óvatos.</p>` : ''}
    <div class="chart-box"><canvas id="chart-${r.id}"></canvas></div>

    <h3>Raklapok ${pals.length ? `· ${pals.length} db, ${total} elem` : ''}</h3>
    <div class="list">${pals.map((p) => `<button class="item" data-open-serial="${esc(p.serial)}" type="button">
      <span><b>${esc(p.serial)}</b> · ${esc(p.template)} · ${p.panel_count} db</span>
      <span class="muted small">kiforgatva ${fmtTime(p.demolded_at)}</span></button>`).join('') || '<p class="muted small">Még nincs kiforgatott raklap.</p>'}</div>

    ${r.ended_at ? '' : `<form class="demold sub" data-demold="${r.id}" hidden>
      <div class="row3">
        <label>Minta<select name="template">${state.config.templates.map((t) => `<option ${t === state.lastTemplate ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Darab a raklapon<span class="qty"><button type="button" data-step="-1">−</button><input name="panel_count" type="number" inputmode="numeric" min="1" step="1" value="${state.lastCount || 12}" required><button type="button" data-step="1">+</button></span></label>
        <label>Kiforgatás ideje<input name="demolded_at" type="datetime-local" value="${todayLocalInput()}"></label>
        <label class="span3">Megjegyzés<input name="note" maxlength="500"></label>
      </div>
      ${r.ready ? '' : '<p class="small neg">Figyelem: a beton még nem érte el a kiforgatási küszöböt.</p>'}
      <label class="check"><input type="checkbox" name="print" checked> Raklapcímke nyomtatása</label>
      <div class="row-btns"><button class="btn success" type="submit">Raklap rögzítése</button><button class="btn" type="button" data-demold-cancel>Mégse</button></div>
    </form>`}
    <div class="row-btns">
      ${r.ended_at ? '' : `<button class="btn primary sm" data-demold-open="${r.id}">Kiforgatás: új raklap</button>
      <button class="btn sm" data-end="${r.id}">Kötés lezárása</button>
      <button class="btn sm" data-target="${r.id}" data-current="${r.target_te_h}">Küszöb módosítása</button>`}
    </div></div>`;
}

function curingChart(canvas, r) {
  const start = Date.parse(r.started_at);
  const colors = ['#d62828', '#3d8fd1', '#2e9e5b', '#d99a1e', '#9b59b6', '#8f9296'];
  const ds = [];
  r.sensors.forEach((s, i) => {
    const pts = (s.series || []).map((p) => ({ x: (Date.parse(p.ts) - start) / 3600000, y: p.temp }));
    ds.push({ label: `${s.label} °C`, data: pts, borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length],
      yAxisID: 'y', pointRadius: 0, borderWidth: 2, tension: .2, borderDash: s.role === 'air' ? [6, 4] : [] });
    if (s.role === 'specimen') {
      ds.push({ label: `${s.label} egyenértékű kor`, data: (s.series || []).map((p) => ({ x: (Date.parse(p.ts) - start) / 3600000, y: p.te })),
        borderColor: colors[i % colors.length], yAxisID: 'y2', pointRadius: 0, borderWidth: 1, borderDash: [2, 3] });
    }
  });
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  return new Chart(canvas, {
    type: 'line', data: { datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: { type: 'linear', title: { display: true, text: 'óra az öntés óta', color: ink }, ticks: { color: ink } },
        y: { title: { display: true, text: '°C', color: ink }, ticks: { color: ink } },
        y2: { position: 'right', min: 0, suggestedMax: r.target_te_h * 1.1, grid: { display: false },
          title: { display: true, text: 'egyenértékű kor (óra)', color: ink }, ticks: { color: ink } },
      },
      plugins: { legend: { labels: { color: ink, boxWidth: 12 } } },
    },
  });
}

async function openRunChart(id) {
  const r = await api(`/api/curing/${id}`);
  const cv = document.getElementById(`chart-${id}`);
  if (!cv || typeof Chart === 'undefined') return;
  state.charts[id]?.destroy();
  state.charts[id] = curingChart(cv, r);
}

$('#runs').addEventListener('click', async (e) => {
  const end = e.target.closest('[data-end]');
  const tgt = e.target.closest('[data-target]');
  const open = e.target.closest('[data-demold-open]');
  const cancel = e.target.closest('[data-demold-cancel]');
  const serial = e.target.closest('[data-open-serial]');
  if (open) {
    const f = $(`form[data-demold="${open.dataset.demoldOpen}"]`);
    f.hidden = false; f.demolded_at.value = todayLocalInput(); f.panel_count.focus();
  }
  if (cancel) cancel.closest('form').hidden = true;
  if (serial) openPallet(serial.dataset.openSerial);
  if (end && confirm('Lezárod ezt a kötést? Utána nem számol tovább, és nem lehet hozzá raklapot rögzíteni.')) {
    await api(`/api/curing/${end.dataset.end}`, { method: 'PATCH', body: { end: true } }); loadCuring();
  }
  if (tgt) {
    const v = prompt('Új küszöb (egyenértékű kor, óra 20 °C-on):', tgt.dataset.current);
    if (v) { await api(`/api/curing/${tgt.dataset.target}`, { method: 'PATCH', body: { target_te_h: v.replace(',', '.') } }); loadCuring(); }
  }
});

$('#runs').addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-demold]');
  if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const p = await api(`/api/curing/${f.dataset.demold}/pallets`, { method: 'POST', body: {
      template: f.template.value, panel_count: parseInt(f.panel_count.value, 10), note: f.note.value,
      demolded_at: f.demolded_at.value ? new Date(f.demolded_at.value).toISOString() : null } });
    state.lastTemplate = p.template; state.lastCount = p.panel_count;
    if (f.print.checked) await printPalletLabel(p);
    else toast(`${p.serial} rögzítve`);
    await loadCuring();
  } finally { btn.disabled = false; }
});

$('#new-run-btn').addEventListener('click', async () => {
  const f = $('#run-form'); f.hidden = false;
  f.started_at.value = todayLocalInput();
  if (!state.mixes.length) state.mixes = await api('/api/mixes?limit=15').catch(() => []);
  $('#run-mix').innerHTML = '<option value="">—</option>' + state.mixes.map((m) => `<option value="${m.id}">#${m.id} · ${fmtTime(m.created_at)}</option>`).join('');
  $('#run-mix').closest('label').hidden = !state.mixes.length;
});
$('#run-cancel').addEventListener('click', () => ($('#run-form').hidden = true));
$('#run-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const ids = $$('input[name="sensor_ids"]:checked', f).map((x) => x.value);
  await api('/api/curing', { method: 'POST', body: {
    name: f.name.value, mix_id: f.mix_id.value || null, sensor_ids: ids, target_te_h: f.target_te_h.value,
    started_at: f.started_at.value ? new Date(f.started_at.value).toISOString() : null } });
  f.hidden = true; f.reset(); toast('Kötés elindítva'); loadCuring();
});

// --- Raklapcímke (384×240, 1 bites) ---
function drawPalletLabel(p) {
  const c = $('#label-canvas');
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#000'; g.strokeStyle = '#000';
  g.lineWidth = 3; g.strokeRect(5.5, 5.5, W - 11, H - 11);
  const font = (px, w = 'bold') => `${w} ${px}px "DejaVu Sans", Verdana, Arial, sans-serif`;

  // Fejléc sáv
  g.fillRect(5, 5, W - 10, 40);
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = font(24); g.fillText('JEDBET', 16, 26);
  g.textAlign = 'right'; g.font = font(18); g.fillText(`${p.panel_count} db`, W - 16, 26);
  g.fillStyle = '#000';

  // QR: a sorszám keresését nyitja meg a gyártási oldalon
  const qr = qrcode(0, 'M'); qr.addData(`${location.origin}/#s=${p.serial}`); qr.make();
  const n = qr.getModuleCount(), size = 108, cell = Math.max(1, Math.floor(size / n)), off = Math.floor((size - cell * n) / 2);
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    if (qr.isDark(r, col)) g.fillRect(14 + off + col * cell, 58 + off + r * cell, cell, cell);
  }

  const x = 134, maxW = W - x - 12;
  g.textAlign = 'left'; g.textBaseline = 'top';
  let px = 30; g.font = font(px);
  while (g.measureText(p.serial).width > maxW && px > 14) { px--; g.font = font(px); }
  g.fillText(p.serial, x, 56);
  const fit = (text, y, size = 18) => { let s = size; g.font = font(s); while (g.measureText(text).width > maxW && s > 11) { s--; g.font = font(s); } g.fillText(text, x, y); };
  fit(p.template, 96, 22);
  g.font = font(14, 'normal'); g.fillText('Öntve', x, 128);
  g.font = font(16); g.fillText(p.label.poured, x, 145);
  g.font = font(14, 'normal'); g.fillText('Kiforgatva', x, 170);
  g.font = font(16); g.fillText(p.label.demolded, x, 187);

  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11 < 140 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

const huDateTime = (iso) => new Date(iso).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

async function printPalletLabel(p) {
  const label = p.label || { poured: huDateTime(p.poured_at), demolded: huDateTime(p.demolded_at) };
  const png = drawPalletLabel({ ...p, label });
  await api(`/api/pallets/${p.id}/print`, { method: 'POST', body: { png_base64: png } });
  toast(`${p.serial} – címke a nyomtatási sorban`);
  setTimeout(loadStatus, 4000);
  return png;
}

// --- Raklap-adatlap (keresés / QR) ---
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q) openPallet(q);
});
$('#pd-close').addEventListener('click', () => $('#pallet-dialog').close());
$('#pallet-dialog').addEventListener('close', () => {
  state.dialogChart?.destroy(); state.dialogChart = null;
  if (location.hash.startsWith('#s=')) history.replaceState(null, '', location.pathname);
});

async function openPallet(serial) {
  let d;
  try { d = await api(`/api/pallets/lookup?q=${encodeURIComponent(serial)}`, { quiet: true }); }
  catch { toast(`Nincs ilyen raklap: ${serial}`, true); return; }
  const p = d.pallet, r = d.run;
  $('#pd-title').textContent = p.serial;
  const h = (p.te_at_demold === null ? null : p.te_at_demold);
  const lastPrint = d.prints[d.prints.length - 1];
  $('#pd-body').innerHTML = `
    <div class="kv">
      <span>Minta: <b>${esc(p.template)}</b></span>
      <span>Darab: <b>${p.panel_count}</b></span>
      <span>Státusz: <select id="pd-status">${state.config.palletStatuses.map((s) => `<option ${s === p.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></span>
      <span>Öntve: <b>${fmtTime(p.poured_at)}</b></span>
      <span>Kiforgatva: <b>${fmtTime(p.demolded_at)}</b></span>
      <span>Kötési idő: <b>${fmt((Date.parse(p.demolded_at) - Date.parse(p.poured_at)) / 3600000, 0)} óra</b></span>
      <span>Egyenértékű kor kiforgatáskor: <b>${h === null ? '–' : fmt(h, 1) + ' óra'}</b>${r && h !== null ? (h >= r.target_te_h ? ' <span class="badge ready">küszöb felett</span>' : ' <span class="badge hideg">küszöb alatt</span>') : ''}</span>
      <span>Nurse–Saul: <b>${p.ns_at_demold === null ? '–' : fmt(p.ns_at_demold, 0) + ' °C·h'}</b></span>
      <span>Legalacsonyabb hőm.: <b>${p.min_temp === null ? '–' : fmt(p.min_temp, 1) + ' °C'}</b>${p.min_temp !== null && p.min_temp < 0 ? ' <span class="badge fagy">fagy</span>' : p.min_temp !== null && p.min_temp < 5 ? ' <span class="badge hideg">5 °C alatt</span>' : ''}</span>
      <span>Döntő szenzor: <b>${esc(p.governing_sensor || '–')}</b></span>
      <span>Kötés: <b>${r ? esc(r.name) : '–'}</b></span>
      <span>Rögzítette: <b>${esc(p.created_by || '–')}</b></span>
    </div>
    <label>Megjegyzés<input id="pd-note" value="${esc(p.note)}" maxlength="500"></label>
    ${r ? '<div class="chart-box"><canvas id="pd-chart"></canvas></div><p class="muted small">A grafikon az öntéstől a kiforgatásig tart.</p>' : ''}
    <div class="row-btns">
      <button class="btn primary" id="pd-save" type="button">Mentés</button>
      <button class="btn" id="pd-print" type="button">Címke újranyomtatása</button>
      <span class="muted small">${lastPrint ? `Utolsó címke: ${fmtTime(lastPrint.created_at)} (${lastPrint.status === 'done' ? 'kinyomtatva' : lastPrint.status === 'error' ? 'hiba' : 'sorban'})` : 'Még nem volt nyomtatva.'}</span>
    </div>`;
  const dlg = $('#pallet-dialog');
  if (!dlg.open) dlg.showModal();
  history.replaceState(null, '', `#s=${encodeURIComponent(p.serial)}`);
  if (r && typeof Chart !== 'undefined') { state.dialogChart?.destroy(); state.dialogChart = curingChart($('#pd-chart'), r); }
  $('#pd-save').onclick = async () => {
    await api(`/api/pallets/${p.id}`, { method: 'PATCH', body: { status: $('#pd-status').value, note: $('#pd-note').value } });
    toast('Mentve'); if (!$('#tab-raktar').hidden) loadInventory();
  };
  $('#pd-print').onclick = () => printPalletLabel(p);
}

// ===================================================================
// Raktár
// ===================================================================
async function loadInventory() {
  const { stock, products } = await api('/api/inventory');
  $('#stock').innerHTML = `<table><tbody>${stock.map((s) => `<tr><td>${esc(s.material)}</td>
    <td class="num ${s.quantity < 0 ? 'neg' : ''}">${fmt(s.quantity, 0)} ${esc(s.unit)}</td></tr>`).join('')}</tbody></table>`;
  $('#stock-material').innerHTML = stock.map((s) => `<option>${esc(s.material)}</option>`).join('');

  const by = {};
  for (const p of products) (by[p.template] ||= {})[p.status] = p;
  const sts = state.config.palletStatuses;
  $('#products').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Minta</th>${sts.map((s) => `<th class="num">${esc(s)}</th>`).join('')}</tr></thead>
    <tbody>${Object.keys(by).map((t) => `<tr><td>${esc(t)}</td>${sts.map((s) => {
      const x = by[t][s];
      return `<td class="num">${x ? `<b>${x.count}</b> <span class="muted small">(${x.pallets} rl.)</span>` : '0'}</td>`;
    }).join('')}</tr>`).join('')
      || `<tr><td colspan="${sts.length + 1}" class="muted">Még nincs raklap.</td></tr>`}</tbody></table></div>
    <p class="muted small">Darabszám, zárójelben a raklapok száma.</p>`;
  await loadPalletTable();
}
async function loadPalletTable() {
  const st = $('#pallet-filter').value;
  const pallets = await api('/api/pallets' + (st ? `?status=${encodeURIComponent(st)}` : ''));
  $('#pallet-table tbody').innerHTML = pallets.map((p) => `<tr>
    <td><button class="link" data-open-serial="${esc(p.serial)}">${esc(p.serial)}</button></td><td>${esc(p.template)}</td>
    <td class="num">${p.panel_count}</td><td>${fmtTime(p.poured_at)}</td><td>${fmtTime(p.demolded_at)}</td>
    <td><select data-pallet-status="${p.id}">${state.config.palletStatuses.map((s) => `<option ${s === p.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></td></tr>`).join('')
    || '<tr><td colspan="6" class="muted">Nincs találat.</td></tr>';
}
$('#pallet-filter').addEventListener('change', loadPalletTable);
$('#pallet-table').addEventListener('change', async (e) => {
  const s = e.target.closest('[data-pallet-status]');
  if (!s) return;
  await api(`/api/pallets/${s.dataset.palletStatus}`, { method: 'PATCH', body: { status: s.value } });
  toast('Státusz mentve'); loadInventory();
});
$('#pallet-table').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open-serial]');
  if (b) openPallet(b.dataset.openSerial);
});
$('#stock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/stock', { method: 'POST', body: formData(e.target) });
  e.target.delta.value = ''; toast('Könyvelve'); loadInventory();
});

// ===================================================================
// Munkák
// ===================================================================
async function loadJobs() {
  const jobs = await api('/api/jobs');
  $('#jobs').innerHTML = jobs.map((j) => `<button class="item ${state.selectedJob?.id === j.id ? 'active' : ''}" data-job="${j.id}">
    <span><b>${esc(j.name)}</b><br><span class="muted small">${esc(j.location || '')}${j.deadline ? ' · határidő: ' + esc(j.deadline) : ''}</span></span>
    <span class="small ${j.status === 'Aktív' ? '' : 'muted'}">${esc(j.status)} · ${fmt(j.total_m, 0)} m</span></button>`).join('')
    || '<p class="muted">Nincs projekt.</p>';
  state.jobs = jobs;
  if (state.selectedJob) showJob(state.selectedJob.id);
}
$('#jobs').addEventListener('click', (e) => { const b = e.target.closest('[data-job]'); if (b) showJob(+b.dataset.job); });

async function showJob(id) {
  const j = state.jobs.find((x) => x.id === id);
  if (!j) return;
  state.selectedJob = j;
  $$('#jobs [data-job]').forEach((b) => b.classList.toggle('active', +b.dataset.job === id));
  $('#job-detail').hidden = false;
  $('#jd-name').textContent = j.name;
  $('#jd-status').textContent = j.status === 'Aktív' ? 'Befejezettnek jelöl' : 'Újranyitás';
  $('#jd-meta').innerHTML = [j.client_name, j.phone && `<a href="tel:${esc(j.phone.replace(/\s/g, ''))}">${esc(j.phone)}</a>`, j.location, j.deadline && 'határidő: ' + j.deadline]
    .filter(Boolean).map((x) => (x.startsWith('<a') ? x : esc(x))).join(' · ');
  const s = await api(`/api/jobs/${id}/summary`);
  $('#jd-stages').innerHTML = s.stages.map((x) => `<div class="item"><span><b>${esc(x.stage_name)}</b> · ${fmt(x.length_m, 1)} m · ${esc(x.template)}
    <br><span class="muted small">${x.spans} köz · ${x.panels} panel · ${x.veg} vég + ${x.kozep} közép oszlop${x.note ? ' · ' + esc(x.note) : ''}</span></span>
    <button class="btn sm" data-del-stage="${x.id}">Törlés</button></div>`).join('') || '<p class="muted">Nincs szakasz.</p>';
  $('#jd-summary tbody').innerHTML = s.summary.map((x) => `<tr><td>${esc(x.item)}</td><td class="num">${x.needed}</td>
    <td class="num">${x.in_stock}</td><td class="num ${x.missing ? 'neg' : ''}">${x.missing}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">Adj hozzá szakaszt.</td></tr>';
}
$('#jd-status').addEventListener('click', async () => {
  const j = state.selectedJob;
  await api(`/api/jobs/${j.id}`, { method: 'PATCH', body: { status: j.status === 'Aktív' ? 'Befejezett' : 'Aktív' } });
  loadJobs();
});
$('#jd-stages').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del-stage]');
  if (b && confirm('Törlöd a szakaszt?')) { await api(`/api/stages/${b.dataset.delStage}`, { method: 'DELETE' }); showJob(state.selectedJob.id); loadJobs(); }
});
$('#job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('/api/jobs', { method: 'POST', body: formData(e.target) });
  e.target.reset(); e.target.closest('details').open = false;
  state.selectedJob = { id: res.job_id }; await loadJobs(); showJob(res.job_id);
});
$('#stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api(`/api/jobs/${state.selectedJob.id}/stages`, { method: 'POST', body: formData(e.target) });
  e.target.reset(); showJob(state.selectedJob.id); loadJobs();
});

// ===================================================================
// Állapotsor
// ===================================================================
async function loadStatus() {
  try {
    const [{ device }, jobs] = await Promise.all([api('/api/sensors', { quiet: true }), api('/api/print-jobs', { quiet: true })]);
    const pi = $('#st-pi');
    if (!device) { pi.textContent = 'Pi: még nem jelentkezett'; pi.className = 'pill bad'; }
    else {
      const min = (Date.now() - Date.parse(device.at)) / 60000;
      const bus = device.status?.sensors_on_bus;
      const noSensors = min < 12 && bus === 0;
      pi.textContent = noSensors ? 'Pi: online, de nem lát szenzort!' : `Pi: ${min < 12 ? 'online' : 'offline'} (${ago(device.at)})`;
      pi.className = 'pill ' + (noSensors ? 'warn' : min < 12 ? 'ok' : 'bad');
    }
    const pending = jobs.filter((j) => j.status === 'pending' || j.status === 'printing').length;
    const failed = jobs.filter((j) => j.status === 'error').slice(0, 1)[0];
    const ps = $('#st-print');
    ps.hidden = !pending && !failed;
    ps.textContent = pending ? `Nyomtatásra vár: ${pending}` : failed ? `Nyomtatási hiba: ${failed.serial || ''}` : '';
    ps.className = 'pill ' + (failed && !pending ? 'bad' : 'warn');
  } catch {}
}
async function loadWeather() {
  try {
    const w = await api('/api/weather', { quiet: true });
    const el = $('#st-weather');
    const s = w.station;
    const parts = [];
    if (s) {
      parts.push(`Állomás: ${fmt(s.temp, 1)} °C`);
      if (s.humidity !== null) parts.push(`${fmt(s.humidity, 0)}%`);
      if (s.wind_speed !== null) parts.push(`szél ${fmt(s.wind_speed, 1)} m/s`);
      if (s.ts && Date.now() - Date.parse(s.ts) > 30 * 60000) parts.push(`⚠ utolsó mérés ${ago(s.ts)}`);
    } else {
      parts.push(`Állomás: ${w.station_error || 'nincs adat'}`);
    }
    const daysLeft = w.token_expires ? (Date.parse(w.token_expires) - Date.now()) / 86400000 : null;
    if (daysLeft !== null && daysLeft < 10) parts.push(daysLeft < 0 ? '⚠ Nubila-token lejárt' : `⚠ Nubila-token ${Math.ceil(daysLeft)} nap múlva lejár`);
    el.textContent = parts.join(' · ');
    el.title = s?.ts ? `Nubila mérés: ${fmtTime(s.ts)}` : '';
    // Sárga csak akkor, ha az állomással van gond; a hideg időjárás önmagában nem hiba.
    el.className = 'pill' + (!s || (daysLeft !== null && daysLeft < 10) ? ' warn' : '');

    // Az előrejelzés külön, semleges jelzés.
    const fc = $('#st-forecast');
    fc.hidden = w.min_next_72h === null;
    fc.textContent = w.min_next_72h !== null && w.min_next_72h < 0
      ? `❄ Fagy várható (3 nap min. ${fmt(w.min_next_72h, 0)} °C)`
      : `3 napos min. ${fmt(w.min_next_72h, 0)} °C`;
  } catch {}
}

// ===================================================================
(async function init() {
  state.config = await api('/api/config');
  $('#pour-template').innerHTML = state.config.templates.map((t) => `<option>${esc(t)}</option>`).join('');
  $('#stage-template').innerHTML = state.config.panelTemplates.map((t) => `<option>${esc(t)}</option>`).join('');
  $('#pallet-filter').innerHTML = '<option value="">Minden státusz</option>' + state.config.palletStatuses.map((s) => `<option>${esc(s)}</option>`).join('');
  let tab = 'erleles';
  try { tab = localStorage.getItem('tab') || tab; } catch {}
  if (!$(`.tabs button[data-tab="${tab}"]`) || $(`.tabs button[data-tab="${tab}"]`).hidden) tab = 'erleles';
  showTab(tab);
  const m = location.hash.match(/^#s=(.+)$/);
  if (m) openPallet(decodeURIComponent(m[1]));
  loadStatus(); loadWeather();
  setInterval(loadStatus, 30000);
  setInterval(() => { if (!$('#tab-erleles').hidden && !document.hidden) loadCuring(); }, 120000);
})();
