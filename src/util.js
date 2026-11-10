// Közös segédfüggvények a Worker moduljainak.

export const TZ = 'Europe/Budapest';
export const TEMPLATES = ['Végoszlop', 'Középoszlop', 'Mediterrán', 'Homokkő', 'Hullám'];
export const PANEL_TEMPLATES = TEMPLATES.filter((t) => !t.endsWith('oszlop'));

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => { throw new HttpError(400, msg); };
export const notFound = () => { throw new HttpError(404, 'Nem található'); };

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function body(request) {
  try { return await request.json(); } catch { bad('Érvénytelen JSON'); }
}

export const num = (v, name, { min = -Infinity, max = Infinity, def } = {}) => {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) bad(`Érvénytelen érték: ${name}`);
  return n;
};
export const str = (v, name, { max = 500, required = false } = {}) => {
  const s = (v ?? '').toString().trim();
  if (required && !s) bad(`Hiányzik: ${name}`);
  if (s.length > max) bad(`Túl hosszú: ${name}`);
  return s;
};

export function localDate(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function localDateTime(d) {
  return new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit' }).format(d);
}
export function localTime(d) {
  return new Intl.DateTimeFormat('hu-HU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
