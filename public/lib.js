// Közös segédfüggvények a felülethez.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toLocaleString('hu-HU', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const ft = (n) => (n === null || n === undefined ? '–' : `${Math.round(n).toLocaleString('hu-HU')} Ft`);
export const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('hu-HU', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
export const hhmm = (iso) => iso ? new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) : '–';
export const ago = (iso) => {
  if (!iso) return null;
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 1) return 'most';
  if (min < 60) return `${Math.round(min)} perce`;
  if (min < 1440) return `${Math.round(min / 60)} órája`;
  return `${Math.round(min / 1440)} napja`;
};
export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export async function api(path, opts = {}) {
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
export function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 5000 : 2500);
}
