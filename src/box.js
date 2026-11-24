// Kötődoboz automatikus fűtésvezérlése.
//
// Egy dobozunk van, ezért egyszerre egy kötés vezérelheti (meta: box_control).
// A fázisok az öntés végétől (a kötés kezdetétől) eltelt időből adódnak:
//
//   várakozás  0 … delay_h           cél: min_c (csak fagyvédelem, nem fűtjük a friss betont)
//   felfűtés   delay_h …             cél: min_c + ramp_c_per_h · (t − delay_h), legfeljebb hold_c
//   tartás     amíg a döntő próbatest el nem éri a küszöböt   cél: hold_c
//   hűtés      cool_h ideig          fűtő ki, ventilátor be
//   kész       minden ki, lehet kiforgatni
//
// Termosztát a doboz levegő-szenzoraira (a kültéri Nubila-állomás nem számít):
// bekapcsol, ha a levegő ≤ cél − hyst_c; kikapcsol, ha ≥ cél + 0,5 °C; köztük marad, ahogy volt.
// Biztonság: ha nincs friss levegőmérés, vagy a levegő eléri a max_air_c-t, a fűtő KI
// (túlmelegedésnél a ventilátor BE). A Pi oldalon a Shelly 2 perces önlekapcsolója is véd.

export const BOX_DEFAULTS = {
  delay_h: 3,          // öntés után ennyi ideig nem fűtünk (csak fagyvédelem)
  min_c: 10,           // fagyvédelem: a várakozás alatt is legalább ennyi legyen
  ramp_c_per_h: 12,    // felfűtés sebessége
  hold_c: 32,          // tartási hőmérséklet
  max_air_c: 40,       // e fölött a fűtő biztosan KI, a ventilátor BE
  hyst_c: 1,           // bekapcsolási hiszterézis
  cool_h: 1,           // hűtés hossza a küszöb elérése után
};
export const STALE_MIN = 3; // ennél régebbi levegőmérés = nincs adat → fűtő KI

const LIMITS = {
  delay_h: [0, 24], min_c: [0, 25], ramp_c_per_h: [1, 30], hold_c: [15, 45],
  max_air_c: [25, 60], hyst_c: [0.2, 5], cool_h: [0, 6],
};

export function cleanSettings(b = {}, cur = BOX_DEFAULTS) {
  const out = { ...BOX_DEFAULTS, ...cur };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (b[k] === undefined || b[k] === '' || b[k] === null) continue;
    const v = Number(String(b[k]).replace(',', '.'));
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError(`${k}: ${lo} és ${hi} között`);
    out[k] = v;
  }
  if (out.hold_c >= out.max_air_c) throw new RangeError('A tartási hőmérséklet legyen a maximum alatt');
  if (out.min_c > out.hold_c) throw new RangeError('A fagyvédelmi minimum legyen a tartási hőmérséklet alatt');
  return out;
}

/** A fázis és a célhőmérséklet adott időpontban. */
export function phaseAt({ s, startedAt, now, coolStartedAt }) {
  if (coolStartedAt) {
    const coolH = (now - Date.parse(coolStartedAt)) / 3600000;
    return coolH < s.cool_h ? { phase: 'hutes', target: null } : { phase: 'kesz', target: null };
  }
  const h = (now - Date.parse(startedAt)) / 3600000;
  if (h < s.delay_h) return { phase: 'varakozas', target: s.min_c };
  const ramp = s.min_c + s.ramp_c_per_h * (h - s.delay_h);
  if (ramp < s.hold_c) return { phase: 'felfutes', target: Math.round(ramp * 10) / 10 };
  return { phase: 'tartas', target: s.hold_c };
}

/**
 * Egy vezérlési lépés. Tiszta függvény, a hívó adja a mért adatot.
 * @param {object} a
 * @param {object} a.s            beállítások
 * @param {string} a.startedAt    a kötés kezdete (ISO)
 * @param {number} a.now          ms
 * @param {string|null} a.coolStartedAt
 * @param {{temp:number, ts:string}[]} a.air   a doboz levegő-szenzorainak utolsó mérése
 * @param {boolean} a.heaterWasOn
 * @returns {{phase, target, air, heater:boolean, fan:boolean, reason:string}}
 */
export function decide({ s, startedAt, now, coolStartedAt, air, heaterWasOn }) {
  const { phase, target } = phaseAt({ s, startedAt, now, coolStartedAt });
  const fresh = air.filter((x) => Number.isFinite(x.temp) && now - Date.parse(x.ts) <= STALE_MIN * 60000);
  const airT = fresh.length ? Math.round((fresh.reduce((a, x) => a + x.temp, 0) / fresh.length) * 10) / 10 : null;
  const hottest = fresh.length ? Math.max(...fresh.map((x) => x.temp)) : null;
  const base = { phase, target, air: airT };

  if (phase === 'hutes') return { ...base, heater: false, fan: true, reason: 'Hűtés a kiforgatás előtt' };
  if (phase === 'kesz') return { ...base, heater: false, fan: false, reason: 'Kész, kiforgatható' };
  if (hottest !== null && hottest >= s.max_air_c) {
    return { ...base, heater: false, fan: true, reason: `Túlmelegedés: ${hottest} °C ≥ ${s.max_air_c} °C` };
  }
  if (airT === null) {
    return { ...base, heater: false, fan: false, reason: `Nincs friss levegőmérés (${STALE_MIN} percen belül), a fűtő biztonságból KI` };
  }
  let heater = heaterWasOn;
  if (airT <= target - s.hyst_c) heater = true;
  else if (airT >= target + 0.5) heater = false;
  return { ...base, heater, fan: false, reason: heater ? 'Fűt' : 'A cél felett vagy körül, nem fűt' };
}

export const PHASE_NAMES = {
  varakozas: 'Várakozás', felfutes: 'Felfűtés', tartas: 'Tartás', hutes: 'Hűtés', kesz: 'Kész',
};
