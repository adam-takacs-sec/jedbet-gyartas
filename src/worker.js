import { computeMaturity, hoursToTarget } from './maturity.js';

// ---------------------------------------------------------------------------
// Beállítások
// ---------------------------------------------------------------------------
export const TEMPLATES = ['Végoszlop', 'Középoszlop', 'Mediterrán', 'Homokkő', 'Hullám'];
const PANEL_TEMPLATES = TEMPLATES.filter((t) => !t.endsWith('oszlop'));
const POUR_STATUSES = ['Kötés alatt', 'Raktározott', 'Lefoglalt', 'Beépítve', 'Selejt'];
const MATERIALS = { cement: 'Cement', viz: 'Víz', kavics: 'Kavics', folyosito: 'Folyósító', kalcidur: 'Kalcidur' };
const TZ = 'Europe/Budapest';
const SITE = { lat: 47.65, lon: 17.92 }; // Bana

// ---------------------------------------------------------------------------
// Belépő
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/device/')) {
        if (!deviceAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
        return await routeDevice(request, env, url);
      }
      if (url.pathname.startsWith('/api/')) {
        const user = await accessUser(request, env);
        if (!user) return json({ error: 'unauthorized' }, 401);
        return await routeApi(request, env, url, user);
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Szerverhiba' }, 500);
    }
  },

  // 10 percenként: a Nubila-állomás hőmérsékletét eltároljuk, mint egy „levegő” szenzort.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(logStation(env));
  },
};

const STATION_SENSOR = 'nubila-allomas';

// A saját állomás legfrissebb mérése az eszköz sorozatszáma alapján:
//   GET https://api.nubila.ai/api/v1/weather/device/{SN}?limit=1   (Authorization: Bearer <token>)
// A token a Nubila-fiók bejelentkezési tokenje (JWT, kb. 90 napig él), ezért a lejáratát is visszaadjuk.
async function fetchNubila(env) {
  const token = (env.NUBILA_TOKEN || '').trim();
  const sn = (env.NUBILA_DEVICE_SN || '').trim();
  if (!token || !sn) return { error: 'Nincs beállítva a NUBILA_TOKEN vagy a NUBILA_DEVICE_SN' };
  const token_expires = jwtExp(token);
  if (token_expires && Date.parse(token_expires) < Date.now()) return { error: 'Lejárt a Nubila-token', token_expires };
  const res = await fetch(`https://api.nubila.ai/api/v1/weather/device/${encodeURIComponent(sn)}?limit=1`,
    { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res || !res.ok) {
    return { error: res ? (res.status === 401 ? 'A Nubila elutasította a tokent' : `Nubila hiba (${res.status})`) : 'Nubila nem elérhető', token_expires };
  }
  const body = await res.json().catch(() => null);
  const d = Array.isArray(body?.data) ? body.data[0] : Array.isArray(body) ? body[0] : body?.data;
  if (!d || !Number.isFinite(Number(d.temperature))) return { error: 'Nubila: nincs mérés a válaszban', token_expires };
  const n = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    temp: Number(d.temperature), humidity: n(d.humidity), wind_speed: n(d.wind_speed),
    wind_direction: n(d.wind_direction), pressure: n(d.pressure), rain: n(d.rain),
    ts: d.created_at ? new Date(d.created_at).toISOString() : null,
    token_expires,
  };
}

function jwtExp(token) {
  try {
    const p = JSON.parse(b64urlText(token.split('.')[1]));
    return p.exp ? new Date(p.exp * 1000).toISOString() : null;
  } catch { return null; }
}

async function logStation(env) {
  const w = await fetchNubila(env);
  if (!w || w.error) { if (w) console.warn(w.error); return; }
  // Az állomás saját mérési idejét használjuk, így ugyanazt a mérést nem mentjük kétszer.
  const ts = new Date(w.ts || Date.now());
  ts.setUTCSeconds(0, 0);
  if (Date.now() - ts.getTime() > 60 * 60000) { console.warn('Nubila: elavult mérés', w.ts); return; }
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO sensors (id, label, role) VALUES (?, 'Nubila állomás', 'air')`).bind(STATION_SENSOR),
    env.DB.prepare('INSERT OR IGNORE INTO readings (sensor_id, ts, temp) VALUES (?,?,?)')
      .bind(STATION_SENSOR, ts.toISOString(), Math.round(w.temp * 100) / 100),
  ]);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };
const notFound = () => { throw new HttpError(404, 'Nem található'); };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function body(request) {
  try { return await request.json(); } catch { bad('Érvénytelen JSON'); }
}

const num = (v, name, { min = -Infinity, max = Infinity, def } = {}) => {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) bad(`Érvénytelen érték: ${name}`);
  return n;
};
const str = (v, name, { max = 500, required = false } = {}) => {
  const s = (v ?? '').toString().trim();
  if (required && !s) bad(`Hiányzik: ${name}`);
  if (s.length > max) bad(`Túl hosszú: ${name}`);
  return s;
};

// ---------------------------------------------------------------------------
// Hitelesítés
// ---------------------------------------------------------------------------
// Böngésző: Cloudflare Access JWT (Cf-Access-Jwt-Assertion) ellenőrzése.
// Hibás vagy hiányzó beállításnál zárva marad (fail closed).
let jwksCache = { at: 0, keys: null };

async function accessUser(request, env) {
  if (env.DEV_NO_AUTH === '1') return { email: 'dev@local' };
  const team = env.ACCESS_TEAM_DOMAIN; // pl. jedbet.cloudflareaccess.com
  const aud = env.ACCESS_AUD;
  if (!team || !aud) return null;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(b64urlText(parts[0]));
    payload = JSON.parse(b64urlText(parts[1]));
  } catch { return null; }
  if (header.alg !== 'RS256') return null;
  const now = Date.now() / 1000;
  if (!payload.exp || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss !== `https://${team}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;

  const key = await accessKey(team, header.kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  return ok ? { email: payload.email || '' } : null;
}

async function accessKey(team, kid) {
  if (!jwksCache.keys || Date.now() - jwksCache.at > 3600_000 || !jwksCache.keys[kid]) {
    const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    const { keys = [] } = await res.json();
    const out = {};
    for (const jwk of keys) {
      out[jwk.kid] = await crypto.subtle.importKey(
        'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    }
    jwksCache = { at: Date.now(), keys: out };
  }
  return jwksCache.keys[kid] || null;
}

function b64urlBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const b64urlText = (s) => new TextDecoder().decode(b64urlBytes(s));

// Pi: Authorization: Bearer <DEVICE_TOKEN>
function deviceAuthorized(request, env) {
  const expected = env.DEVICE_TOKEN;
  if (!expected || expected.length < 24) return false;
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Böngészős API
// ---------------------------------------------------------------------------
async function routeApi(request, env, url, user) {
  const db = env.DB;
  const m = request.method;
  const p = url.pathname.replace(/\/+$/, '');
  let r;

  if (p === '/api/me' && m === 'GET') return json(user);
  if (p === '/api/config' && m === 'GET') {
    return json({ templates: TEMPLATES, panelTemplates: PANEL_TEMPLATES, statuses: POUR_STATUSES });
  }

  // --- Keverés ---
  if (p === '/api/mixes' && m === 'GET') {
    const limit = Math.min(num(url.searchParams.get('limit'), 'limit', { min: 1, def: 10 }), 100);
    const { results } = await db.prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM pours WHERE mix_id = m.id) AS pour_count
       FROM mixes m ORDER BY m.id DESC LIMIT ?`).bind(limit).all();
    return json(results);
  }
  if (p === '/api/mixes' && m === 'POST') {
    const b = await body(request);
    const v = {};
    for (const k of Object.keys(MATERIALS)) v[k] = num(b[k], k, { min: 0, max: 100000, def: 0 });
    const roskadas = num(b.roskadas, 'roskadas', { min: 0, max: 1000, def: 0 });
    const terules = num(b.terules, 'terules', { min: 0, max: 2000, def: 0 });
    const note = str(b.note, 'megjegyzés');
    const stmts = [
      db.prepare(`INSERT INTO mixes (cement, viz, kavics, folyosito, kalcidur, roskadas, terules, note, created_by)
                  VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`)
        .bind(v.cement, v.viz, v.kavics, v.folyosito, v.kalcidur, roskadas, terules, note, user.email),
      ...Object.entries(MATERIALS).map(([k, name]) =>
        db.prepare('UPDATE stock SET quantity = quantity - ? WHERE material = ?').bind(v[k], name)),
    ];
    const res = await db.batch(stmts);
    const id = res[0].results[0].id;
    const { results: low } = await db.prepare('SELECT material, quantity, unit FROM stock WHERE quantity < 0').all();
    return json({ mix_id: id, negative_stock: low });
  }

  // --- Öntés / darab ---
  if (p === '/api/pours' && m === 'GET') {
    const mixId = url.searchParams.get('mix_id');
    const status = url.searchParams.get('status');
    let q = 'SELECT id, mix_id, serial, template, extra_water_dl, status, note, created_at FROM pours';
    const where = [], args = [];
    if (mixId) { where.push('mix_id = ?'); args.push(num(mixId, 'mix_id')); }
    if (status) { where.push('status = ?'); args.push(status); }
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    q += ' ORDER BY id DESC LIMIT 500';
    const { results } = await db.prepare(q).bind(...args).all();
    return json(results);
  }
  if (p === '/api/pours' && m === 'POST') {
    const b = await body(request);
    const mixId = num(b.mix_id, 'mix_id', { min: 1 });
    const template = str(b.template, 'sablon', { required: true, max: 60 });
    if (!TEMPLATES.includes(template)) bad('Ismeretlen sablon');
    const extra = num(b.extra_water_dl, 'extra víz', { min: 0, max: 100, def: 0 });
    const note = str(b.note, 'megjegyzés');
    const mix = await db.prepare('SELECT id FROM mixes WHERE id = ?').bind(mixId).first();
    if (!mix) bad('Nincs ilyen keverés');
    const day = localDate(new Date()).replace(/-/g, '');
    // Egyedi sorszám; ütközésnél (két egyidejű mentés) újrapróbál.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM pours WHERE serial LIKE ?`)
        .bind(`JED-${day}-%`).first();
      const serial = `JED-${day}-${String(n + 1 + attempt).padStart(3, '0')}`;
      try {
        const row = await db.prepare(
          `INSERT INTO pours (mix_id, serial, template, extra_water_dl, note, created_by)
           VALUES (?,?,?,?,?,?) RETURNING id, serial, created_at`)
          .bind(mixId, serial, template, extra, note, user.email).first();
        return json({ ...row, mix_id: mixId, template, label_time: localDateTime(new Date()) });
      } catch (e) {
        if (!String(e).includes('UNIQUE')) throw e;
      }
    }
    throw new HttpError(409, 'Nem sikerült sorszámot adni, próbáld újra');
  }
  if ((r = p.match(/^\/api\/pours\/(\d+)$/)) && m === 'PATCH') {
    const b = await body(request);
    const status = str(b.status, 'státusz', { required: true });
    if (!POUR_STATUSES.includes(status)) bad('Ismeretlen státusz');
    const res = await db.prepare('UPDATE pours SET status = ? WHERE id = ?').bind(status, +r[1]).run();
    if (!res.meta.changes) notFound();
    return json({ ok: true });
  }
  if ((r = p.match(/^\/api\/pours\/(\d+)\/print$/)) && m === 'POST') {
    const b = await body(request);
    const png = decodePng(b.png_base64);
    const pour = await db.prepare('SELECT id FROM pours WHERE id = ?').bind(+r[1]).first();
    if (!pour) notFound();
    const row = await db.prepare('INSERT INTO print_jobs (pour_id, png) VALUES (?, ?) RETURNING id')
      .bind(+r[1], png).first();
    return json({ print_job_id: row.id });
  }

  // --- Készlet ---
  if (p === '/api/inventory' && m === 'GET') {
    const [{ results: stock }, { results: products }] = await db.batch([
      db.prepare('SELECT material, quantity, unit FROM stock ORDER BY rowid'),
      db.prepare(`SELECT status, template, COUNT(*) AS count FROM pours
                  GROUP BY status, template ORDER BY template, status`),
    ]);
    return json({ stock, products });
  }
  if (p === '/api/stock' && m === 'POST') {
    const b = await body(request);
    const material = str(b.material, 'anyag', { required: true });
    const delta = num(b.delta, 'mennyiség', { min: -1e6, max: 1e6 });
    const res = await db.prepare('UPDATE stock SET quantity = quantity + ? WHERE material = ?')
      .bind(delta, material).run();
    if (!res.meta.changes) notFound();
    return json({ ok: true });
  }

  // --- Munkák ---
  if (p === '/api/jobs' && m === 'GET') {
    const { results } = await db.prepare(
      `SELECT j.*, (SELECT COALESCE(SUM(length_m),0) FROM job_stages WHERE job_id = j.id) AS total_m
       FROM jobs j ORDER BY (j.status = 'Aktív') DESC, j.id DESC`).all();
    return json(results);
  }
  if (p === '/api/jobs' && m === 'POST') {
    const b = await body(request);
    const row = await db.prepare(
      `INSERT INTO jobs (name, client_name, phone, location, deadline) VALUES (?,?,?,?,?) RETURNING id`)
      .bind(str(b.name, 'projekt neve', { required: true, max: 120 }), str(b.client_name, 'megrendelő', { max: 120 }),
        str(b.phone, 'telefon', { max: 40 }), str(b.location, 'helyszín', { max: 200 }),
        str(b.deadline, 'határidő', { max: 20 })).first();
    return json({ job_id: row.id });
  }
  if ((r = p.match(/^\/api\/jobs\/(\d+)$/)) && m === 'PATCH') {
    const b = await body(request);
    const status = str(b.status, 'státusz', { required: true });
    if (!['Aktív', 'Befejezett'].includes(status)) bad('Ismeretlen státusz');
    await db.prepare('UPDATE jobs SET status = ? WHERE id = ?').bind(status, +r[1]).run();
    return json({ ok: true });
  }
  if ((r = p.match(/^\/api\/jobs\/(\d+)\/stages$/)) && m === 'POST') {
    const b = await body(request);
    const template = str(b.template, 'minta', { required: true });
    if (!PANEL_TEMPLATES.includes(template)) bad('Ismeretlen minta');
    await db.prepare('INSERT INTO job_stages (job_id, stage_name, length_m, template, note) VALUES (?,?,?,?,?)')
      .bind(+r[1], str(b.stage_name, 'szakasz neve', { required: true, max: 120 }),
        num(b.length_m, 'hossz', { min: 0.5, max: 5000 }), template, str(b.note, 'megjegyzés')).run();
    return json({ ok: true });
  }
  if ((r = p.match(/^\/api\/stages\/(\d+)$/)) && m === 'DELETE') {
    await db.prepare('DELETE FROM job_stages WHERE id = ?').bind(+r[1]).run();
    return json({ ok: true });
  }
  if ((r = p.match(/^\/api\/jobs\/(\d+)\/summary$/)) && m === 'GET') {
    return json(await jobSummary(db, +r[1]));
  }

  // --- Szenzorok, érlelés ---
  if (p === '/api/sensors' && m === 'GET') {
    const { results } = await db.prepare(
      `SELECT s.*, (SELECT temp FROM readings WHERE sensor_id = s.id ORDER BY ts DESC LIMIT 1) AS last_temp,
              (SELECT ts FROM readings WHERE sensor_id = s.id ORDER BY ts DESC LIMIT 1) AS last_ts
       FROM sensors s ORDER BY s.label`).all();
    const hb = await db.prepare(`SELECT value FROM meta WHERE key = 'device_heartbeat'`).first();
    return json({ sensors: results.map((s) => ({ ...s, last_temp: s.last_temp === null ? null : s.last_temp + s.offset_c })),
      device: hb ? JSON.parse(hb.value) : null });
  }
  if ((r = p.match(/^\/api\/sensors\/([\w-]+)$/)) && m === 'PATCH') {
    const b = await body(request);
    const role = str(b.role, 'szerep', { required: true });
    if (!['specimen', 'air'].includes(role)) bad('Ismeretlen szerep');
    await db.prepare('UPDATE sensors SET label = ?, role = ?, offset_c = ?, active = ? WHERE id = ?')
      .bind(str(b.label, 'név', { required: true, max: 60 }), role,
        num(b.offset_c, 'eltolás', { min: -5, max: 5, def: 0 }), b.active === false ? 0 : 1, r[1]).run();
    return json({ ok: true });
  }
  if (p === '/api/curing' && m === 'GET') {
    const { results } = await db.prepare(
      `SELECT * FROM curing_runs ORDER BY (ended_at IS NULL) DESC, id DESC LIMIT 30`).all();
    const out = [];
    for (const run of results) out.push(await runStatus(db, run, false));
    return json(out);
  }
  if (p === '/api/curing' && m === 'POST') {
    const b = await body(request);
    const ids = Array.isArray(b.sensor_ids) ? b.sensor_ids.map(String) : [];
    if (!ids.length) bad('Válassz legalább egy szenzort');
    const known = await db.prepare(`SELECT id FROM sensors WHERE id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids).all();
    if (known.results.length !== ids.length) bad('Ismeretlen szenzor');
    const started = b.started_at ? new Date(b.started_at) : new Date();
    if (Number.isNaN(started.getTime())) bad('Érvénytelen kezdési idő');
    const row = await db.prepare(
      `INSERT INTO curing_runs (name, mix_id, sensor_ids, started_at, target_te_h, note)
       VALUES (?,?,?,?,?,?) RETURNING id`)
      .bind(str(b.name, 'név', { required: true, max: 120 }), b.mix_id ? num(b.mix_id, 'mix_id', { min: 1 }) : null,
        JSON.stringify(ids), started.toISOString(), num(b.target_te_h, 'cél', { min: 1, max: 2000, def: 48 }),
        str(b.note, 'megjegyzés')).first();
    return json({ run_id: row.id });
  }
  if ((r = p.match(/^\/api\/curing\/(\d+)$/)) && m === 'GET') {
    const run = await db.prepare('SELECT * FROM curing_runs WHERE id = ?').bind(+r[1]).first();
    if (!run) notFound();
    return json(await runStatus(db, run, true));
  }
  if ((r = p.match(/^\/api\/curing\/(\d+)$/)) && m === 'PATCH') {
    const b = await body(request);
    if (b.end === true) {
      await db.prepare(`UPDATE curing_runs SET ended_at = ? WHERE id = ? AND ended_at IS NULL`)
        .bind(new Date().toISOString(), +r[1]).run();
    }
    if (b.target_te_h !== undefined) {
      await db.prepare('UPDATE curing_runs SET target_te_h = ? WHERE id = ?')
        .bind(num(b.target_te_h, 'cél', { min: 1, max: 2000 }), +r[1]).run();
    }
    return json({ ok: true });
  }
  if (p === '/api/print-jobs' && m === 'GET') {
    const { results } = await db.prepare(
      `SELECT pj.id, pj.status, pj.error, pj.attempts, pj.created_at, pj.updated_at, p.serial
       FROM print_jobs pj LEFT JOIN pours p ON p.id = pj.pour_id ORDER BY pj.id DESC LIMIT 20`).all();
    return json(results);
  }

  // Mért adat a saját Nubila-állomásról; előrejelzés (fagyjelzés) az Open-Meteóból.
  if (p === '/api/weather' && m === 'GET') {
    const [station, fc] = await Promise.all([
      fetchNubila(env),
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${SITE.lat}&longitude=${SITE.lon}` +
        `&hourly=temperature_2m&forecast_days=3&timezone=${encodeURIComponent(TZ)}`,
        { cf: { cacheTtl: 600, cacheEverything: true } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const temps = fc?.hourly?.temperature_2m?.slice(0, 72) || [];
    if (station.error && !temps.length) throw new HttpError(502, station.error);
    return json({
      station: station.error ? null : station,
      station_error: station.error || null,
      token_expires: station.token_expires || null,
      min_next_72h: temps.length ? Math.min(...temps) : null,
    });
  }

  notFound();
}

function decodePng(b64) {
  if (typeof b64 !== 'string' || b64.length > 400_000) bad('Hibás címkekép');
  const clean = b64.replace(/^data:image\/png;base64,/, '');
  let bytes;
  try { bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)); } catch { bad('Hibás címkekép'); }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || sig.some((v, i) => bytes[i] !== v)) bad('A címke nem PNG');
  return bytes;
}

// Munka anyagigénye: 2 m = 1 oszlopköz = 4 panel; szakaszonként 2 végoszlop.
async function jobSummary(db, jobId) {
  const { results: stages } = await db.prepare('SELECT * FROM job_stages WHERE job_id = ? ORDER BY id').bind(jobId).all();
  const need = { 'Végoszlop': 0, 'Középoszlop': 0 };
  const details = stages.map((s) => {
    const spans = Math.max(1, Math.ceil(s.length_m / 2 - 1e-9));
    const veg = 2, kozep = spans - 1, panels = spans * 4;
    need['Végoszlop'] += veg;
    need['Középoszlop'] += kozep;
    need[s.template] = (need[s.template] || 0) + panels;
    return { ...s, spans, veg, kozep, panels };
  });
  const { results: stock } = await db.prepare(
    `SELECT template, COUNT(*) AS n FROM pours WHERE status = 'Raktározott' GROUP BY template`).all();
  const have = Object.fromEntries(stock.map((x) => [x.template, x.n]));
  const summary = Object.entries(need).filter(([, n]) => n > 0).map(([item, needed]) => ({
    item, needed, in_stock: have[item] || 0, missing: Math.max(0, needed - (have[item] || 0)),
  }));
  return { stages: details, summary };
}

async function runStatus(db, run, withSeries) {
  const ids = JSON.parse(run.sensor_ids);
  const end = run.ended_at || new Date().toISOString();
  const { results: sensors } = await db.prepare(
    `SELECT * FROM sensors WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const out = [];
  for (const s of sensors) {
    const { results } = await db.prepare(
      'SELECT ts, temp FROM readings WHERE sensor_id = ? AND ts >= ? AND ts <= ? ORDER BY ts')
      .bind(s.id, run.started_at, end).all();
    const rd = results.map((x) => ({ ts: x.ts, temp: x.temp + s.offset_c }));
    const mt = computeMaturity(rd, { startTs: run.started_at, endTs: end });
    const item = {
      sensor_id: s.id, label: s.label, role: s.role,
      nurse_saul: mt.nurseSaul, eq_age_h: mt.eqAgeH, elapsed_h: mt.elapsedH,
      covered_h: mt.coveredH, gaps: mt.gaps, min_temp: mt.minTemp,
      last_temp: mt.lastTemp, last_ts: mt.lastTs,
      hours_left: s.role === 'specimen' ? hoursToTarget(mt.eqAgeH, run.target_te_h, mt.lastTemp) : null,
    };
    if (withSeries) item.series = thin(mt.series, 600);
    out.push(item);
  }
  // A döntést a legkevésbé érett próbatest adja.
  const specimens = out.filter((x) => x.role === 'specimen' && x.last_ts);
  const governing = specimens.length ? specimens.reduce((a, b) => (a.eq_age_h <= b.eq_age_h ? a : b)) : null;
  const ready = governing ? governing.eq_age_h >= run.target_te_h : false;
  const coldest = specimens.length ? Math.min(...specimens.map((x) => x.min_temp)) : null;
  const frost = !ready && coldest !== null ? (coldest < 0 ? 'fagy' : coldest < 5 ? 'hideg' : null) : null;
  return {
    ...run, sensor_ids: ids, sensors: out,
    governing_sensor: governing ? governing.sensor_id : null,
    eq_age_h: governing ? governing.eq_age_h : 0,
    progress: governing ? Math.min(1, governing.eq_age_h / run.target_te_h) : 0,
    hours_left: governing ? governing.hours_left : null,
    ready, frost,
  };
}

function thin(series, max) {
  if (series.length <= max) return series;
  const step = series.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(series[Math.floor(i * step)]);
  out.push(series[series.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Pi végpontok
// ---------------------------------------------------------------------------
async function routeDevice(request, env, url) {
  const db = env.DB;
  const p = url.pathname.replace(/\/+$/, '');
  const m = request.method;
  let r;

  if (p === '/device/readings' && m === 'POST') {
    const b = await body(request);
    const list = Array.isArray(b.readings) ? b.readings.slice(0, 5000) : [];
    const valid = list.filter((x) => typeof x.sensor_id === 'string' && /^[\w-]{4,40}$/.test(x.sensor_id) &&
      Number.isFinite(x.temp) && x.temp > -55 && x.temp < 125 && !Number.isNaN(Date.parse(x.ts)));
    // Ismeretlen szenzort is felveszünk, hogy egy új DS18B20 magától megjelenjen.
    const newIds = [...new Set(valid.map((x) => x.sensor_id))];
    const stmts = newIds.map((id) =>
      db.prepare(`INSERT OR IGNORE INTO sensors (id, label) VALUES (?, ?)`).bind(id, `Új szenzor ${id.slice(-4)}`));
    for (const x of valid) {
      stmts.push(db.prepare('INSERT OR IGNORE INTO readings (sensor_id, ts, temp) VALUES (?,?,?)')
        .bind(x.sensor_id, new Date(x.ts).toISOString(), Math.round(x.temp * 1000) / 1000));
    }
    stmts.push(db.prepare(`INSERT INTO meta (key, value) VALUES ('device_heartbeat', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify({
      at: new Date().toISOString(), status: typeof b.status === 'object' ? b.status : {},
    })));
    for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
    return json({ accepted: valid.length, rejected: list.length - valid.length });
  }

  if (p === '/device/print-jobs/next' && m === 'GET') {
    // A 2 percnél régebben „nyomtatás alatt” ragadt munkát újra kiadjuk (max. 3 próba).
    const job = await db.prepare(
      `UPDATE print_jobs SET status = 'printing', attempts = attempts + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = (SELECT id FROM print_jobs
                   WHERE (status = 'pending' OR (status = 'printing' AND updated_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-2 minutes')))
                     AND attempts < 3 ORDER BY id LIMIT 1)
       RETURNING id, png`).first();
    if (!job) return new Response(null, { status: 204 });
    const bytes = new Uint8Array(job.png);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return json({ id: job.id, png_base64: btoa(bin) });
  }
  if ((r = p.match(/^\/device\/print-jobs\/(\d+)$/)) && m === 'POST') {
    const b = await body(request);
    await db.prepare(`UPDATE print_jobs SET status = ?, error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                      WHERE id = ?`)
      .bind(b.ok ? 'done' : 'error', str(b.error, 'hiba', { max: 500 }), +r[1]).run();
    return json({ ok: true });
  }
  notFound();
}

// ---------------------------------------------------------------------------
function localDate(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function localDateTime(d) {
  return new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit' }).format(d);
}
