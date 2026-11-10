// Napi lap: terv → öntés indítása/lezárása → napzárás; munkások, munkanapló, kifizetések.
import { TEMPLATES, bad, notFound, json, body, num, str, localDate, localTime, localDateTime, HttpError } from './util.js';

export const TASK_KINDS = {
  ontes: { label: 'Öntés', unit: 'db' },
  kiforgatas: { label: 'Kiforgatás', unit: 'db' },
  mosas: { label: 'Mosás / zsaluzás', unit: 'db' },
  telepites: { label: 'Telepítés', unit: 'm' },
  egyeb: { label: 'Egyéb', unit: '' },
};
export const TASK_STATUSES = ['terv', 'folyamatban', 'kesz', 'reszben', 'nem'];
export const REASONS = ['Anyaghiány', 'Kevés ember', 'Időjárás', 'Gép / eszköz hiba', 'Nem volt idő', 'Más munka jött közbe', 'Egyéb'];
export const PAY_TYPES = { ora: 'Órabér', nap: 'Napidíj', darab: 'Darabbér' };
export const WORK_KINDS = { gyartas: 'Gyártás', telepites: 'Telepítés' };
export const PAYMENT_KINDS = { ber: 'Bér kifizetés', eloleg: 'Előleg', kolcson: 'Kölcsön', visszafizetes: 'Visszafizetés (tőle)' };

// Munkaórák SQL-ben (HH:MM szövegekből, mínusz szünet); éjfélen átnyúló műszakot nem kezelünk.
const MIN = (c) => `(CAST(substr(${c},1,2) AS INTEGER)*60 + CAST(substr(${c},4,2) AS INTEGER))`;
export const HOURS_SQL = `CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL
  THEN max(0, ${MIN('end_time')} - ${MIN('start_time')} - break_min) / 60.0 ELSE 0 END`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const dateArg = (v, name = 'dátum') => {
  const s = str(v, name, { required: true, max: 10 });
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) bad(`Érvénytelen ${name}`);
  return s;
};
const timeArg = (v, name) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!TIME_RE.test(s)) bad(`Érvénytelen időpont: ${name} (ÓÓ:PP)`);
  return s;
};
const optNum = (v, name, opts) => (v === undefined || v === null || v === '' ? null : num(v, name, opts));
const optId = (v, name) => (v === undefined || v === null || v === '' ? null : num(v, name, { min: 1 }));
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function hoursOf(l) {
  if (!l.start_time || !l.end_time) return null;
  const m = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  return Math.max(0, m(l.end_time) - m(l.start_time) - (l.break_min || 0)) / 60;
}
function computeAmount(l) {
  if (l.amount_manual) return l.amount;
  if (l.pay_type === 'nap') return Math.round(l.rate);
  if (l.pay_type === 'darab') return Math.round((l.pieces || 0) * l.rate);
  const h = hoursOf(l);
  return h === null ? 0 : Math.round(h * l.rate);
}

// Egy nap összesítése a feladatokból és a munkanaplóból.
export function summarize(tasks, logs, demolded = 0) {
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const planned = tasks.filter((t) => !t.unplanned);
  const poured = sum(tasks.filter((t) => t.kind === 'ontes'), (t) => t.done_qty);
  const prodHours = sum(logs.filter((l) => l.kind === 'gyartas'), (l) => hoursOf(l));
  return {
    poured,
    poured_planned: sum(tasks.filter((t) => t.kind === 'ontes' && !t.unplanned), (t) => t.planned_qty),
    demolded,
    installed_m: sum(tasks.filter((t) => t.kind === 'telepites'), (t) => t.done_qty),
    planned_total: planned.length,
    planned_done: planned.filter((t) => t.status === 'kesz').length,
    planned_partial: planned.filter((t) => t.status === 'reszben').length,
    planned_missed: planned.filter((t) => t.status === 'nem').length,
    unplanned: tasks.length - planned.length,
    workers: new Set(logs.map((l) => l.worker_id)).size,
    hours: sum(logs, (l) => hoursOf(l)),
    prod_hours: prodHours,
    cost: sum(logs, (l) => l.amount),
    per_man_hour: prodHours > 0 && poured > 0 ? poured / prodHours : null,
  };
}

async function demoldedByDay(db, fromDay, toDay) {
  // A raklapok kiforgatási idejét UTC-ben tároljuk; helyi nap szerint csoportosítunk.
  const { results } = await db.prepare(
    `SELECT demolded_at, panel_count, template, run_id FROM pallets WHERE demolded_at >= ? AND demolded_at < ?`)
    .bind(`${addDays(fromDay, -1)}T00:00:00Z`, `${addDays(toDay, 2)}T00:00:00Z`).all();
  const out = {};
  for (const p of results) {
    const d = localDate(new Date(p.demolded_at));
    if (d < fromDay || d > toDay) continue;
    (out[d] ||= []).push(p);
  }
  return out;
}

const TASK_SELECT = `SELECT t.*, j.name AS job_name, r.name AS run_name
  FROM tasks t LEFT JOIN jobs j ON j.id = t.job_id LEFT JOIN curing_runs r ON r.id = t.run_id`;
const LOG_SELECT = `SELECT l.*, w.name AS worker_name, j.name AS job_name
  FROM work_logs l JOIN workers w ON w.id = l.worker_id LEFT JOIN jobs j ON j.id = l.job_id`;

async function getTask(db, id) {
  const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!t) notFound();
  return t;
}

async function createRun(db, { name, startedAt, target }) {
  const { results: sensors } = await db.prepare('SELECT id FROM sensors WHERE active = 1').all();
  if (!sensors.length) bad('Nincs aktív szenzor a kötéshez. Zárd le kötés nélkül, vagy kapcsolj be egy szenzort.');
  const row = await db.prepare(
    `INSERT INTO curing_runs (name, sensor_ids, started_at, target_te_h, note) VALUES (?,?,?,?,'') RETURNING id`)
    .bind(name, JSON.stringify(sensors.map((s) => s.id)), startedAt, target).first();
  return row.id;
}

function workerAmountFields(w, b, cur = {}) {
  const l = { ...cur };
  if (b.start_time !== undefined) l.start_time = timeArg(b.start_time, 'érkezés');
  if (b.end_time !== undefined) l.end_time = timeArg(b.end_time, 'távozás');
  if (b.break_min !== undefined) l.break_min = num(b.break_min, 'szünet', { min: 0, max: 600, def: 0 });
  if (b.kind !== undefined) {
    l.kind = str(b.kind, 'munka típusa', { required: true });
    if (!WORK_KINDS[l.kind]) bad('Ismeretlen munka típus');
  }
  if (b.job_id !== undefined) l.job_id = optId(b.job_id, 'projekt');
  if (b.pay_type !== undefined) {
    l.pay_type = str(b.pay_type, 'díjazás', { required: true });
    if (!PAY_TYPES[l.pay_type]) bad('Ismeretlen díjazás');
  }
  if (b.rate !== undefined) l.rate = num(b.rate, 'díj', { min: 0, max: 1e7, def: 0 });
  if (b.pieces !== undefined) l.pieces = optNum(b.pieces, 'darab', { min: 0, max: 100000 });
  if (b.note !== undefined) l.note = str(b.note, 'megjegyzés');
  if (b.amount !== undefined) {
    const a = optNum(b.amount, 'összeg', { min: 0, max: 1e8 });
    l.amount_manual = a === null ? 0 : 1;
    if (a !== null) l.amount = a;
  }
  if (l.start_time && l.end_time && l.end_time <= l.start_time) bad('A távozás az érkezés után legyen');
  if (l.kind === 'telepites' && !l.job_id) bad('Telepítésnél add meg a projektet');
  l.amount = computeAmount(l);
  return l;
}

async function balances(db, workerId = null) {
  const where = workerId ? 'WHERE w.id = ?' : '';
  const { results } = await db.prepare(
    `SELECT w.*,
       (SELECT COALESCE(SUM(amount),0) FROM work_logs WHERE worker_id = w.id) AS earned,
       (SELECT COALESCE(SUM(CASE WHEN kind = 'visszafizetes' THEN -amount ELSE amount END),0) FROM payments WHERE worker_id = w.id) AS paid,
       (SELECT MAX(day) FROM work_logs WHERE worker_id = w.id) AS last_day,
       (SELECT COUNT(DISTINCT day) FROM work_logs WHERE worker_id = w.id) AS days_worked
     FROM workers w ${where} ORDER BY w.active DESC, w.name COLLATE NOCASE`).bind(...(workerId ? [workerId] : [])).all();
  return results.map((w) => ({ ...w, balance: w.earned - w.paid }));
}

// ---------------------------------------------------------------------------
export async function routeNap(request, env, url, user, p, m) {
  const db = env.DB;
  let r;

  if (p === '/api/nap/config' && m === 'GET') {
    return json({ kinds: TASK_KINDS, statuses: TASK_STATUSES, reasons: REASONS, payTypes: PAY_TYPES,
      workKinds: WORK_KINDS, paymentKinds: PAYMENT_KINDS, today: localDate(new Date()), now: localTime(new Date()) });
  }

  // --- Napi lap ---
  if (p === '/api/day' && m === 'GET') {
    const day = url.searchParams.get('date') ? dateArg(url.searchParams.get('date')) : localDate(new Date());
    const [{ results: tasks }, { results: logs }, dayRow, { results: workers }, { results: jobs }, { results: openRuns }] = await db.batch([
      db.prepare(`${TASK_SELECT} WHERE t.day = ? ORDER BY t.unplanned, t.sort, t.id`).bind(day),
      db.prepare(`${LOG_SELECT} WHERE l.day = ? ORDER BY l.start_time, l.id`).bind(day),
      db.prepare('SELECT * FROM days WHERE day = ?').bind(day),
      db.prepare('SELECT id, name, pay_type, rate FROM workers WHERE active = 1 ORDER BY name COLLATE NOCASE'),
      db.prepare(`SELECT id, name FROM jobs WHERE status = 'Aktív' ORDER BY id DESC`),
      db.prepare('SELECT id, name, started_at FROM curing_runs WHERE ended_at IS NULL ORDER BY id DESC LIMIT 10'),
    ]).then((res) => res.map((x, i) => (i === 2 ? x.results[0] || null : x)));
    const dem = (await demoldedByDay(db, day, day))[day] || [];
    const demByTemplate = {};
    for (const p0 of dem) demByTemplate[p0.template] = (demByTemplate[p0.template] || 0) + p0.panel_count;
    const lg = logs.map((l) => ({ ...l, hours: hoursOf(l) }));
    const demTotal = dem.reduce((a, x) => a + x.panel_count, 0);
    return json({
      day, today: localDate(new Date()), now: localTime(new Date()),
      started_at: dayRow?.started_at || null, closed_at: dayRow?.closed_at || null, note: dayRow?.note || '',
      tasks, logs: lg, workers, jobs, open_runs: openRuns,
      demolded: demByTemplate, summary: summarize(tasks, lg, demTotal),
    });
  }
  if (p === '/api/day' && m === 'PATCH') {
    const b = await body(request);
    const day = dateArg(b.date);
    await db.prepare(`INSERT INTO days (day, note) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET note = excluded.note`)
      .bind(day, str(b.note, 'megjegyzés', { max: 2000 })).run();
    return json({ ok: true });
  }
  if (p === '/api/day/start' && m === 'POST') {
    const b = await body(request);
    const day = dateArg(b.date);
    const at = b.at ? new Date(b.at) : new Date();
    if (Number.isNaN(at.getTime())) bad('Érvénytelen időpont');
    await db.prepare(`INSERT INTO days (day, started_at) VALUES (?, ?)
      ON CONFLICT(day) DO UPDATE SET started_at = excluded.started_at, closed_at = NULL`).bind(day, at.toISOString()).run();
    return json({ ok: true, started_at: at.toISOString() });
  }
  // Heti / havi terv: feladatok és napi összesítők egy dátumtartományra.
  if (p === '/api/plan' && m === 'GET') {
    const from = dateArg(url.searchParams.get('from'), 'kezdő dátum');
    const to = dateArg(url.searchParams.get('to'), 'záró dátum');
    if (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 62) bad('Túl hosszú időszak');
    const [{ results: tasks }, { results: logs }, { results: dayRows }] = await db.batch([
      db.prepare(`${TASK_SELECT} WHERE t.day >= ? AND t.day <= ? ORDER BY t.day, t.unplanned, t.sort, t.id`).bind(from, to),
      db.prepare('SELECT * FROM work_logs WHERE day >= ? AND day <= ?').bind(from, to),
      db.prepare('SELECT * FROM days WHERE day >= ? AND day <= ?').bind(from, to),
    ]);
    const dem = await demoldedByDay(db, from, to);
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const row = dayRows.find((x) => x.day === d);
      const tk = tasks.filter((t) => t.day === d);
      days.push({ day: d, started_at: row?.started_at || null, closed_at: row?.closed_at || null, note: row?.note || '',
        tasks: tk, summary: summarize(tk, logs.filter((l) => l.day === d), (dem[d] || []).reduce((a, x) => a + x.panel_count, 0)) });
    }
    return json({ from, to, today: localDate(new Date()), days });
  }
  if (p === '/api/day/close' && m === 'POST') {
    const b = await body(request);
    const day = dateArg(b.date);
    const { results: tasks } = await db.prepare('SELECT * FROM tasks WHERE day = ?').bind(day).all();
    const running = tasks.filter((t) => t.status === 'folyamatban');
    if (running.length) bad(`Előbb zárd le: ${running.map((t) => t.title || TASK_KINDS[t.kind].label).join(', ')}`);
    const { results: open } = await db.prepare(
      `SELECT w.name FROM work_logs l JOIN workers w ON w.id = l.worker_id WHERE l.day = ? AND l.end_time IS NULL`).bind(day).all();
    if (open.length) bad(`Hiányzik a távozás: ${open.map((x) => x.name).join(', ')}`);
    const stmts = [
      db.prepare(`UPDATE tasks SET status = 'nem' WHERE day = ? AND status = 'terv'`).bind(day),
      db.prepare(`INSERT INTO days (day, closed_at, note) VALUES (?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET closed_at = excluded.closed_at, note = CASE WHEN excluded.note = '' THEN days.note ELSE excluded.note END`)
        .bind(day, new Date().toISOString(), str(b.note, 'megjegyzés', { max: 2000 })),
    ];
    let carried = 0;
    if (b.carry) {
      const next = b.carry_to ? dateArg(b.carry_to, 'cél dátum') : addDays(day, 1);
      const { results: done } = await db.prepare(
        `SELECT carried_from FROM tasks WHERE carried_from IN (SELECT id FROM tasks WHERE day = ?)`).bind(day).all();
      const already = new Set(done.map((x) => x.carried_from));
      for (const t of tasks) {
        const status = t.status === 'terv' ? 'nem' : t.status;
        if (!['nem', 'reszben'].includes(status) || already.has(t.id)) continue;
        const left = t.planned_qty === null ? null : Math.max(0, t.planned_qty - (t.done_qty || 0));
        if (left === 0) continue;
        stmts.push(db.prepare(
          `INSERT INTO tasks (day, kind, title, template, job_id, planned_qty, unit, note, carried_from, sort)
           VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .bind(next, t.kind, t.title, t.template, t.job_id, left, t.unit, t.note, t.id, t.sort - 1000));
        carried++;
      }
    }
    await db.batch(stmts);
    return json({ ok: true, carried });
  }
  if (p === '/api/day/reopen' && m === 'POST') {
    const b = await body(request);
    await db.prepare('UPDATE days SET closed_at = NULL WHERE day = ?').bind(dateArg(b.date)).run();
    return json({ ok: true });
  }
  if (p === '/api/days' && m === 'GET') {
    const limit = Math.min(num(url.searchParams.get('limit'), 'limit', { min: 1, def: 14 }), 90);
    const { results: dayList } = await db.prepare(
      `SELECT day FROM (SELECT day FROM tasks UNION SELECT day FROM work_logs UNION SELECT day FROM days)
       ORDER BY day DESC LIMIT ?`).bind(limit).all();
    if (!dayList.length) return json([]);
    const from = dayList[dayList.length - 1].day, to = dayList[0].day;
    const [{ results: tasks }, { results: logs }, { results: dayRows }] = await db.batch([
      db.prepare('SELECT * FROM tasks WHERE day >= ? AND day <= ?').bind(from, to),
      db.prepare('SELECT * FROM work_logs WHERE day >= ? AND day <= ?').bind(from, to),
      db.prepare('SELECT * FROM days WHERE day >= ? AND day <= ?').bind(from, to),
    ]);
    const dem = await demoldedByDay(db, from, to);
    return json(dayList.map(({ day }) => ({
      day, closed_at: dayRows.find((x) => x.day === day)?.closed_at || null, started_at: dayRows.find((x) => x.day === day)?.started_at || null,
      ...summarize(tasks.filter((t) => t.day === day), logs.filter((l) => l.day === day),
        (dem[day] || []).reduce((a, x) => a + x.panel_count, 0)),
    })));
  }

  // --- Feladatok ---
  if (p === '/api/tasks' && m === 'POST') {
    const b = await body(request);
    const day = dateArg(b.day);
    const kind = str(b.kind, 'típus', { required: true });
    if (!TASK_KINDS[kind]) bad('Ismeretlen feladattípus');
    const template = b.template ? str(b.template, 'minta', { max: 60 }) : null;
    if (template && !TEMPLATES.includes(template)) bad('Ismeretlen minta');
    if (kind === 'ontes' && !template) bad('Öntésnél add meg a mintát');
    const jobId = optId(b.job_id, 'projekt');
    if (kind === 'telepites' && !jobId) bad('Telepítésnél add meg a projektet');
    const title = str(b.title, 'megnevezés', { max: 120 });
    if (kind === 'egyeb' && !title) bad('Írd be, mi a feladat');
    const unplanned = b.unplanned ? 1 : 0;
    const planned = optNum(b.planned_qty, 'tervezett mennyiség', { min: 0, max: 100000 });
    const done = optNum(b.done_qty, 'elkészült mennyiség', { min: 0, max: 100000 });
    // Plusz munkát utólag írunk be, ezért alapból kész.
    const status = unplanned ? 'kesz' : 'terv';
    const { mx } = await db.prepare('SELECT COALESCE(MAX(sort),0) AS mx FROM tasks WHERE day = ?').bind(day).first();
    const row = await db.prepare(
      `INSERT INTO tasks (day, kind, title, template, job_id, planned_qty, done_qty, unit, status, unplanned, note, sort)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
      .bind(day, kind, title, template, jobId, unplanned ? null : planned, unplanned ? (done ?? planned) : null,
        TASK_KINDS[kind].unit, status, unplanned, str(b.note, 'megjegyzés'), mx + 1).first();
    return json({ task_id: row.id });
  }
  if ((r = p.match(/^\/api\/tasks\/(\d+)$/)) && m === 'PATCH') {
    const b = await body(request);
    const t = await getTask(db, +r[1]);
    const v = { ...t };
    if (b.title !== undefined) v.title = str(b.title, 'megnevezés', { max: 120 });
    if (b.template !== undefined) {
      v.template = b.template ? str(b.template, 'minta', { max: 60 }) : null;
      if (v.template && !TEMPLATES.includes(v.template)) bad('Ismeretlen minta');
    }
    if (b.job_id !== undefined) v.job_id = optId(b.job_id, 'projekt');
    if (b.planned_qty !== undefined) v.planned_qty = optNum(b.planned_qty, 'tervezett mennyiség', { min: 0, max: 100000 });
    if (b.done_qty !== undefined) v.done_qty = optNum(b.done_qty, 'elkészült mennyiség', { min: 0, max: 100000 });
    if (b.status !== undefined) {
      v.status = str(b.status, 'állapot', { required: true });
      if (!TASK_STATUSES.includes(v.status)) bad('Ismeretlen állapot');
      if (v.status === 'kesz' && b.done_qty === undefined && v.done_qty === null) v.done_qty = v.planned_qty;
    }
    if (b.reason !== undefined) v.reason = str(b.reason, 'ok', { max: 120 });
    if (b.note !== undefined) v.note = str(b.note, 'megjegyzés');
    if (b.day !== undefined) v.day = dateArg(b.day);
    if (b.unplanned !== undefined) v.unplanned = b.unplanned ? 1 : 0;
    if (v.kind === 'ontes' && !v.template) bad('Öntésnél add meg a mintát');
    if (v.kind === 'telepites' && !v.job_id) bad('Telepítésnél add meg a projektet');
    if (['kesz', 'terv', 'folyamatban'].includes(v.status)) v.reason = v.status === 'kesz' ? '' : v.reason;
    await db.prepare(`UPDATE tasks SET title=?, template=?, job_id=?, planned_qty=?, done_qty=?, status=?, reason=?, note=?, day=?, unplanned=?
      WHERE id = ?`).bind(v.title, v.template, v.job_id, v.planned_qty, v.done_qty, v.status, v.reason, v.note, v.day, v.unplanned, t.id).run();
    return json({ ok: true });
  }
  if ((r = p.match(/^\/api\/tasks\/(\d+)$/)) && m === 'DELETE') {
    const t = await getTask(db, +r[1]);
    await db.batch([
      db.prepare('UPDATE tasks SET carried_from = NULL WHERE carried_from = ?').bind(t.id),
      db.prepare('DELETE FROM tasks WHERE id = ?').bind(t.id),
    ]);
    return json({ ok: true });
  }
  if ((r = p.match(/^\/api\/tasks\/(\d+)\/start$/)) && m === 'POST') {
    const b = await body(request);
    const t = await getTask(db, +r[1]);
    if (!['terv', 'nem'].includes(t.status)) bad('Ez a feladat már elindult vagy lezárult');
    const at = b.at ? new Date(b.at) : new Date();
    if (Number.isNaN(at.getTime())) bad('Érvénytelen kezdési idő');
    await db.prepare(`UPDATE tasks SET status = 'folyamatban', started_at = ? WHERE id = ?`).bind(at.toISOString(), t.id).run();
    return json({ ok: true, started_at: at.toISOString() });
  }
  if ((r = p.match(/^\/api\/tasks\/(\d+)\/finish$/)) && m === 'POST') {
    const b = await body(request);
    const t = await getTask(db, +r[1]);
    const done = optNum(b.done_qty, 'elkészült mennyiség', { min: 0, max: 100000 });
    const end = b.ended_at ? new Date(b.ended_at) : new Date();
    if (Number.isNaN(end.getTime())) bad('Érvénytelen befejezési idő');
    if (t.started_at && end.toISOString() < t.started_at) bad('A befejezés a kezdés után legyen');
    let status = b.status ? str(b.status, 'állapot') : null;
    if (status && !['kesz', 'reszben', 'nem'].includes(status)) bad('Ismeretlen állapot');
    if (!status) {
      status = done === null ? 'kesz'
        : t.planned_qty === null || done >= t.planned_qty ? 'kesz' : done > 0 ? 'reszben' : 'nem';
    }
    const reason = status === 'kesz' ? '' : str(b.reason, 'ok', { max: 120 });
    let runId = t.run_id;
    if (t.kind === 'ontes' && done > 0 && !t.run_id) {
      const curing = b.curing ?? 'new';
      if (curing === 'new') {
        const name = `${t.template} · ${done} db · ${localDateTime(end)}`;
        runId = await createRun(db, { name, startedAt: end.toISOString(), target: num(b.target_te_h, 'küszöb', { min: 1, max: 2000, def: 48 }) });
      } else if (curing !== 'none') {
        runId = num(curing, 'kötés', { min: 1 });
        const run = await db.prepare('SELECT id FROM curing_runs WHERE id = ? AND ended_at IS NULL').bind(runId).first();
        if (!run) bad('Ez a kötés már le van zárva');
      }
    }
    const note = str(b.note, 'megjegyzés');
    await db.prepare(`UPDATE tasks SET status = ?, done_qty = ?, reason = ?, note = CASE WHEN ? = '' THEN note ELSE ? END,
        ended_at = ?, run_id = ? WHERE id = ?`)
      .bind(status, done ?? (status === 'kesz' ? t.planned_qty : null), reason, note, note,
        end.toISOString(), runId, t.id).run();
    return json({ ok: true, status, run_id: runId });
  }
  if ((r = p.match(/^\/api\/tasks\/(\d+)\/reopen$/)) && m === 'POST') {
    const t = await getTask(db, +r[1]);
    await db.prepare(`UPDATE tasks SET status = CASE WHEN started_at IS NOT NULL AND ? = 'ontes' THEN 'folyamatban' ELSE 'terv' END,
      ended_at = NULL WHERE id = ?`).bind(t.kind, t.id).run();
    return json({ ok: true });
  }

  // --- Munkások ---
  if (p === '/api/workers' && m === 'GET') return json(await balances(db));
  if (p === '/api/workers' && m === 'POST') {
    const b = await body(request);
    const pay = str(b.pay_type, 'díjazás', { required: true });
    if (!PAY_TYPES[pay]) bad('Ismeretlen díjazás');
    const row = await db.prepare(`INSERT INTO workers (name, phone, pay_type, rate, note) VALUES (?,?,?,?,?) RETURNING id`)
      .bind(str(b.name, 'név', { required: true, max: 80 }), str(b.phone, 'telefon', { max: 40 }), pay,
        num(b.rate, 'díj', { min: 0, max: 1e7, def: 0 }), str(b.note, 'megjegyzés')).first();
    return json({ worker_id: row.id });
  }
  if ((r = p.match(/^\/api\/workers\/(\d+)$/)) && m === 'GET') {
    const [w] = await balances(db, +r[1]);
    if (!w) notFound();
    const [{ results: logs }, { results: payments }] = await db.batch([
      db.prepare(`${LOG_SELECT} WHERE l.worker_id = ? ORDER BY l.day DESC, l.start_time DESC LIMIT 120`).bind(w.id),
      db.prepare('SELECT * FROM payments WHERE worker_id = ? ORDER BY day DESC, id DESC LIMIT 120').bind(w.id),
    ]);
    return json({ worker: w, logs: logs.map((l) => ({ ...l, hours: hoursOf(l) })), payments });
  }
  if ((r = p.match(/^\/api\/workers\/(\d+)$/)) && m === 'PATCH') {
    const b = await body(request);
    const w = await db.prepare('SELECT * FROM workers WHERE id = ?').bind(+r[1]).first();
    if (!w) notFound();
    const pay = b.pay_type === undefined ? w.pay_type : str(b.pay_type, 'díjazás');
    if (!PAY_TYPES[pay]) bad('Ismeretlen díjazás');
    await db.prepare('UPDATE workers SET name=?, phone=?, pay_type=?, rate=?, note=?, active=? WHERE id = ?')
      .bind(b.name === undefined ? w.name : str(b.name, 'név', { required: true, max: 80 }),
        b.phone === undefined ? w.phone : str(b.phone, 'telefon', { max: 40 }), pay,
        b.rate === undefined ? w.rate : num(b.rate, 'díj', { min: 0, max: 1e7 }),
        b.note === undefined ? w.note : str(b.note, 'megjegyzés'),
        b.active === undefined ? w.active : (b.active ? 1 : 0), w.id).run();
    return json({ ok: true });
  }

  // --- Munkanapló ---
  if (p === '/api/worklogs' && m === 'POST') {
    const b = await body(request);
    const day = dateArg(b.day);
    const w = await db.prepare('SELECT * FROM workers WHERE id = ?').bind(num(b.worker_id, 'munkás', { min: 1 })).first();
    if (!w) bad('Nincs ilyen munkás');
    const dup = await db.prepare('SELECT id FROM work_logs WHERE day = ? AND worker_id = ? AND end_time IS NULL').bind(day, w.id).first();
    if (dup) bad(`${w.name} már be van jelentkezve erre a napra`);
    const isToday = day === localDate(new Date());
    const l = workerAmountFields(w, {
      start_time: b.start_time === undefined && isToday ? localTime(new Date()) : b.start_time,
      end_time: b.end_time, break_min: b.break_min ?? 0, kind: b.kind ?? 'gyartas', job_id: b.job_id,
      pay_type: b.pay_type ?? w.pay_type, rate: b.rate ?? w.rate, pieces: b.pieces, note: b.note ?? '', amount: b.amount,
    }, { amount_manual: 0, amount: 0, pieces: null, job_id: null, break_min: 0, note: '' });
    const row = await db.prepare(
      `INSERT INTO work_logs (day, worker_id, start_time, end_time, break_min, kind, job_id, pay_type, rate, pieces, amount, amount_manual, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
      .bind(day, w.id, l.start_time ?? null, l.end_time ?? null, l.break_min, l.kind, l.job_id, l.pay_type, l.rate,
        l.pieces ?? null, l.amount, l.amount_manual, l.note).first();
    return json({ log_id: row.id });
  }
  if ((r = p.match(/^\/api\/worklogs\/(\d+)$/)) && m === 'PATCH') {
    const b = await body(request);
    const cur = await db.prepare('SELECT * FROM work_logs WHERE id = ?').bind(+r[1]).first();
    if (!cur) notFound();
    if (b.leave) b.end_time = localTime(new Date());
    const l = workerAmountFields(null, b, cur);
    await db.prepare(`UPDATE work_logs SET start_time=?, end_time=?, break_min=?, kind=?, job_id=?, pay_type=?, rate=?, pieces=?,
        amount=?, amount_manual=?, note=? WHERE id = ?`)
      .bind(l.start_time, l.end_time, l.break_min, l.kind, l.job_id, l.pay_type, l.rate, l.pieces, l.amount, l.amount_manual, l.note, cur.id).run();
    return json({ ok: true, amount: l.amount });
  }
  if ((r = p.match(/^\/api\/worklogs\/(\d+)$/)) && m === 'DELETE') {
    await db.prepare('DELETE FROM work_logs WHERE id = ?').bind(+r[1]).run();
    return json({ ok: true });
  }

  // --- Kifizetések ---
  if (p === '/api/payments' && m === 'POST') {
    const b = await body(request);
    const kind = str(b.kind, 'típus', { required: true });
    if (!PAYMENT_KINDS[kind]) bad('Ismeretlen kifizetés típus');
    const w = await db.prepare('SELECT id FROM workers WHERE id = ?').bind(num(b.worker_id, 'munkás', { min: 1 })).first();
    if (!w) bad('Nincs ilyen munkás');
    await db.prepare('INSERT INTO payments (worker_id, day, amount, kind, note) VALUES (?,?,?,?,?)')
      .bind(w.id, b.day ? dateArg(b.day) : localDate(new Date()), num(b.amount, 'összeg', { min: 1, max: 1e8 }), kind,
        str(b.note, 'megjegyzés')).run();
    return json({ ok: true });
  }
  if ((r = p.match(/^\/api\/payments\/(\d+)$/)) && m === 'DELETE') {
    await db.prepare('DELETE FROM payments WHERE id = ?').bind(+r[1]).run();
    return json({ ok: true });
  }

  return null;
}

export { HttpError };
