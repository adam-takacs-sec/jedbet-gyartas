// Kötődoboz automatikus fűtésvezérlése.
//
// Egy dobozunk van, ezért egyszerre egy kötés vezérelheti (meta: box_control).
// A fázisok az öntés végétől (a kötés kezdetétől) eltelt időből adódnak:
//
//   várakozás  0 … delay_h           cél: min_c (csak fagyvédelem, nem fűtjük a friss betont)
//   felfűtés   delay_h …             cél: a felfűtés indulásakor mért leghidegebb pont
//                                    + ramp_c_per_h · (a felfűtés indulása óta eltelt idő),
//                                    legalább min_c, legfeljebb hold_c. A felfűtés akkor indul,
//                                    amikor a várakozás letelt ÉS az automatika már fut.
//   tartás     amíg a döntő próbatest el nem éri a küszöböt   cél: hold_c
//   hűtés      cool_h ideig          fűtő ki, ventilátor be
//   kész       minden ki, lehet kiforgatni
//
// Termosztát a doboz levegő-szenzoraira (a kültéri Nubila-állomás nem számít), a LEGHIDEGEBB
// pontra szabályoz: bekapcsol, ha a leghidegebb ≤ cél − hyst_c; kikapcsol, ha ≥ cél + 0,5 °C.
// A legmelegebb pont korlátoz: ha eléri a max_air_c-t, a fűtő szünetel (ventilátor nélkül, hogy
// a hő szétterüljön), és csak max_air_c − 1 °C alatt indul újra. Vészhelyzet: ha a legmelegebb
// eléri a max_air_c + EMERGENCY_C-t, a ventilátor is bekapcsol (kiszellőztet).
// Ha nincs friss levegőmérés, a fűtő KI. A Pi oldalon a Shelly 2 perces önlekapcsolója is véd.

export const BOX_DEFAULTS = {
  delay_h: 3,          // öntés után ennyi ideig nem fűtünk (csak fagyvédelem)
  min_c: 10,           // fagyvédelem: a várakozás alatt is legalább ennyi legyen
  ramp_c_per_h: 12,    // felfűtés sebessége
  hold_c: 32,          // tartási hőmérséklet
  max_air_c: 40,       // ha a legmelegebb pont eléri, a fűtő szünetel
  hyst_c: 1,           // bekapcsolási hiszterézis
  cool_h: 1,           // hűtés hossza a küszöb elérése után
};
export const STALE_MIN = 3;
export const EMERGENCY_C = 5;  // max_air_c fölött ennyivel: ventilátor BE // ennél régebbi levegőmérés = nincs adat → fűtő KI

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
export function phaseAt({ s, startedAt, now, coolStartedAt, rampStartedAt = null, rampBase = null }) {
  if (coolStartedAt) {
    const coolH = (now - Date.parse(coolStartedAt)) / 3600000;
    return coolH < s.cool_h ? { phase: 'hutes', target: null } : { phase: 'kesz', target: null };
  }
  const h = (now - Date.parse(startedAt)) / 3600000;
  if (h < s.delay_h) return { phase: 'varakozas', target: s.min_c };
  const rh = rampStartedAt ? Math.max(0, (now - Date.parse(rampStartedAt)) / 3600000) : 0;
  const ramp = Math.max(s.min_c, (rampBase ?? s.min_c) + s.ramp_c_per_h * rh);
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
 * @returns {{phase, target, air, air_min, air_max, heater:boolean, fan:boolean, reason:string}}
 */
export function decide({ s, startedAt, now, coolStartedAt, rampStartedAt = null, rampBase = null, air, heaterWasOn }) {
  const { phase, target } = phaseAt({ s, startedAt, now, coolStartedAt, rampStartedAt, rampBase });
  const fresh = air.filter((x) => Number.isFinite(x.temp) && now - Date.parse(x.ts) <= STALE_MIN * 60000);
  const r1 = (x) => Math.round(x * 10) / 10;
  const coldest = fresh.length ? r1(Math.min(...fresh.map((x) => x.temp))) : null;
  const hottest = fresh.length ? r1(Math.max(...fresh.map((x) => x.temp))) : null;
  const base = { phase, target, air: coldest, air_min: coldest, air_max: hottest };

  if (phase === 'hutes') return { ...base, heater: false, fan: true, reason: 'Hűtés a kiforgatás előtt' };
  if (phase === 'kesz') return { ...base, heater: false, fan: false, reason: 'Kész, kiforgatható' };
  if (coldest === null) {
    return { ...base, heater: false, fan: false, reason: `Nincs friss levegőmérés (${STALE_MIN} percen belül), a fűtő biztonságból KI` };
  }
  if (hottest >= s.max_air_c + EMERGENCY_C) {
    return { ...base, heater: false, fan: true, reason: `Túlmelegedés: ${hottest} °C, szellőztet` };
  }
  if (hottest >= s.max_air_c || (!heaterWasOn && hottest > s.max_air_c - 1)) {
    return { ...base, heater: false, fan: false, reason: `A legmelegebb pont ${hottest} °C, a fűtő szünetel, amíg a hő szétterül` };
  }
  let heater = heaterWasOn;
  if (coldest <= target - s.hyst_c) heater = true;
  else if (coldest >= target + 0.5) heater = false;
  return { ...base, heater, fan: false, reason: heater ? 'Fűt (a leghidegebb pont a cél alatt)' : 'A leghidegebb pont a célon, nem fűt' };
}

export const PHASE_NAMES = {
  varakozas: 'Várakozás', felfutes: 'Felfűtés', tartas: 'Tartás', hutes: 'Hűtés', kesz: 'Kész',
};
