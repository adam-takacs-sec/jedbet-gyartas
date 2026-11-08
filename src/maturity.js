// Érettségi számítás egy szenzor mérési idősorából.
//
// Nurse–Saul:  M = Σ (T_átl − T0) · Δt        [°C·h], T0 = −10 °C
// Egyenértékű kor (Freiesleben Hansen–Pedersen, Arrhenius):
//   t_e = Σ exp[−E/R · (1/T − 1/T_ref)] · Δt    [h, 20 °C-ra vetítve]
//   E = 33,5 kJ/mol, ha T ≥ 20 °C; 33,5 + 1,47·(20 − T) kJ/mol, ha T < 20 °C
//
// Két egymást követő mérés között a trapéz-szabályt használjuk (a két
// hőmérséklet átlagával). Ha a rés hosszabb, mint MAX_GAP_MIN, azt a
// szakaszt NEM töltjük ki: hiányként jelöljük, és az érettség ott nem nő
// (óvatos irányú hiba).

export const T0 = -10;
export const T_REF_C = 20;
export const MAX_GAP_MIN = 20;
const R = 8.314;

export function activationEnergy(tC) {
  return tC >= 20 ? 33500 : 33500 + 1470 * (20 - tC);
}

export function equivalentRate(tC) {
  const T = tC + 273.15;
  const Tr = T_REF_C + 273.15;
  return Math.exp((-activationEnergy(tC) / R) * (1 / T - 1 / Tr));
}

/**
 * @param {{ts:string,temp:number}[]} readings időrendben
 * @returns {{ nurseSaul:number, eqAgeH:number, elapsedH:number,
 *   coveredH:number, gaps:{from:string,to:string,minutes:number}[],
 *   minTemp:number|null, lastTemp:number|null, lastTs:string|null,
 *   series:{ts:string,temp:number,M:number,te:number}[] }}
 */
export function computeMaturity(readings, { startTs, endTs } = {}) {
  const pts = readings
    .filter((r) => Number.isFinite(r.temp))
    .filter((r) => (!startTs || r.ts >= startTs) && (!endTs || r.ts <= endTs));

  let M = 0;
  let te = 0;
  let covered = 0;
  const gaps = [];
  const series = [];
  let minTemp = null;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    minTemp = minTemp === null ? p.temp : Math.min(minTemp, p.temp);
    if (i > 0) {
      const prev = pts[i - 1];
      const dtH = (Date.parse(p.ts) - Date.parse(prev.ts)) / 3600000;
      if (dtH > 0) {
        if (dtH * 60 > MAX_GAP_MIN) {
          gaps.push({ from: prev.ts, to: p.ts, minutes: Math.round(dtH * 60) });
        } else {
          const tAvg = (p.temp + prev.temp) / 2;
          M += Math.max(tAvg - T0, 0) * dtH;
          te += equivalentRate(tAvg) * dtH;
          covered += dtH;
        }
      }
    }
    series.push({ ts: p.ts, temp: p.temp, M: round(M, 1), te: round(te, 2) });
  }

  const first = startTs || (pts[0] && pts[0].ts);
  const last = pts.length ? pts[pts.length - 1] : null;
  const elapsedH = first && last ? (Date.parse(last.ts) - Date.parse(first)) / 3600000 : 0;

  // Hiány a futam kezdete és az első mérés között is lehet.
  if (startTs && pts.length && (Date.parse(pts[0].ts) - Date.parse(startTs)) / 60000 > MAX_GAP_MIN) {
    gaps.unshift({ from: startTs, to: pts[0].ts,
      minutes: Math.round((Date.parse(pts[0].ts) - Date.parse(startTs)) / 60000) });
  }

  return {
    nurseSaul: round(M, 1),
    eqAgeH: round(te, 2),
    elapsedH: round(elapsedH, 2),
    coveredH: round(covered, 2),
    gaps,
    minTemp,
    lastTemp: last ? last.temp : null,
    lastTs: last ? last.ts : null,
    series,
  };
}

/** Becsült hátralévő idő a célig, ha a legutóbbi hőmérséklet marad. */
export function hoursToTarget(eqAgeH, targetH, lastTemp) {
  if (eqAgeH >= targetH) return 0;
  if (lastTemp === null) return null;
  const rate = equivalentRate(lastTemp);
  if (rate <= 0) return null;
  return round((targetH - eqAgeH) / rate, 1);
}

function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
