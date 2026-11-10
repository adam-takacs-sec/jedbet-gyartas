// Munkák: projektek kártyákon, szakaszonként kirajzolt kerítéssel.
import { $, $$, esc, fmt, ft, api, toast } from './lib.js';

const js = { templates: [], jobs: [], filter: 'Aktív', selected: null, detail: null, editingStage: null, editingJob: false };
try { js.filter = localStorage.getItem('jobFilter') ?? 'Aktív'; } catch {}

// Mintánként: panel alapszín, minta-vonal színe, kiemelő szín (csík, címke).
const TPL = {
  'Mediterrán': { base: '#b7a98c', ink: '#8a7c60', accent: '#d4a72c' },
  'Homokkő': { base: '#c4a684', ink: '#9b7c5a', accent: '#c06b3e' },
  'Hullám': { base: '#a3acb4', ink: '#6f7a84', accent: '#3d8fd1' },
};
const tpl = (t) => TPL[t] || { base: '#a0a0a0', ink: '#777', accent: '#8f9296' };

// 2 m = 1 oszlopköz = 4 panel; szakaszonként 2 végoszlop (ugyanaz, mint a szerveren).
const stageCalc = (len) => {
  const spans = Math.max(1, Math.ceil(len / 2 - 1e-9));
  return { spans, panels: spans * 4, veg: 2, kozep: spans - 1 };
};
// A rajz a tényleges szélességre készül, így telefonon sem zsugorodnak olvashatatlanra a feliratok.
const tvSize = () => { const w = Math.max(300, ($('#jd-overview')?.clientWidth || 760) - 2); return { maxW: Math.min(w, 900), maxH: w < 600 ? 360 : 420 }; };
const turnLabel = (t) => (TURNS.find(([v]) => v === Number(t)) || [0, `${t}°`])[1].toLowerCase();
const daysLeft = (d) => (d ? Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 86400000) : null);

// Egyszer a lapra: a minták SVG-textúrái (minden kerítésrajz ezeket használja).
function injectPatterns() {
  if ($('#fence-defs')) return;
  const pat = (name, w, h, body) => `<pattern id="pat-${name}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${body}</pattern>`;
  const m = tpl('Mediterrán'), h = tpl('Homokkő'), w = tpl('Hullám');
  document.body.insertAdjacentHTML('beforeend', `<svg id="fence-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    ${pat('Mediterrán', 12, 6, `<rect width="12" height="6" fill="${m.base}"/><path d="M0 0H12M0 3H12M3 0V3M9 3V6" stroke="${m.ink}" stroke-width=".6" fill="none"/>`)}
    ${pat('Homokkő', 8, 6, `<rect width="8" height="6" fill="${h.base}"/><circle cx="1.5" cy="1.5" r=".7" fill="${h.ink}"/><circle cx="5.5" cy="3.8" r=".9" fill="${h.ink}"/><circle cx="3" cy="5" r=".5" fill="${h.ink}"/><circle cx="7" cy=".8" r=".4" fill="${h.ink}"/>`)}
    ${pat('Hullám', 12, 4, `<rect width="12" height="4" fill="${w.base}"/><path d="M0 2.5Q3 .5 6 2.5T12 2.5" stroke="${w.ink}" stroke-width=".8" fill="none"/>`)}
  </defs></svg>`);
}

// Egy szakasz elölnézete: oszlopok 2 m-enként, köztük 4 egymásra rakott panel, alatta méretvonal.
// Hosszú szakaszt több sorba tördelünk, közös léptékkel.
function fenceSvg(len, template, { perRow = 10 } = {}) {
  const { spans } = stageCalc(len);
  const SP = 48, PW = 6, VW = 8, PH = 12, GAP = 1, TOP = 6, PANELS_H = 4 * PH + 3 * GAP;
  const fill = TPL[template] ? `url(#pat-${template})` : '#a0a0a0';
  const rows = [];
  for (let i = 0; i < spans; i += perRow) rows.push([i, Math.min(spans, i + perRow)]);
  // Közös lépték: egy teljes sor (perRow köz) a teljes szélesség, így a rövid szakasz rövidebb is.
  const maxW = perRow * SP + VW;
  return rows.map(([a, b], ri) => {
    const n = b - a, W = n * SP + VW, H = TOP + PANELS_H + 4 + (ri === rows.length - 1 ? 18 : 4);
    let g = '';
    for (let k = 0; k < n; k++) {
      const x = VW / 2 + k * SP + PW / 2;
      for (let p = 0; p < 4; p++) g += `<rect x="${x}" y="${TOP + p * (PH + GAP)}" width="${SP - PW}" height="${PH}" rx=".8" fill="${fill}" stroke="rgba(0,0,0,.35)" stroke-width=".5"/>`;
    }
    for (let k = 0; k <= n; k++) {
      const gi = a + k; // a szakasz elejétől számolt oszlop
      const end = gi === 0 || gi === spans;
      if (k === 0 && ri > 0) continue; // a sor eleji oszlop az előző sor végén már ott van
      const pw = end ? VW : PW, x = VW / 2 + k * SP - pw / 2;
      g += `<rect x="${x}" y="1" width="${pw}" height="${TOP + PANELS_H + 3}" rx="1" fill="${end ? '#5c6066' : '#7d8288'}" stroke="rgba(0,0,0,.4)" stroke-width=".5"/>`;
      g += `<rect x="${x - .8}" y="0" width="${pw + 1.6}" height="2.4" rx=".8" fill="${end ? '#4a4d52' : '#6a6e74'}"/>`;
    }
    g += `<line x1="0" x2="${W}" y1="${TOP + PANELS_H + 4}" y2="${TOP + PANELS_H + 4}" stroke="var(--line)" stroke-width="1"/>`;
    if (ri === rows.length - 1) {
      const y = TOP + PANELS_H + 12;
      const total = rows.length === 1;
      g += `<path d="M${VW / 2} ${y}H${W - VW / 2}M${VW / 2} ${y - 3}V${y + 3}M${W - VW / 2} ${y - 3}V${y + 3}" stroke="var(--muted)" stroke-width=".8"/>`;
      g += `<text x="${W / 2}" y="${y - 2}" text-anchor="middle" font-size="8" font-weight="700" fill="var(--ink)" paint-order="stroke" stroke="var(--card)" stroke-width="3">${fmt(len, len % 1 ? 1 : 0)} m${total ? '' : ' összesen'}</text>`;
    }
    return `<svg class="fence" viewBox="0 0 ${W} ${H}" style="width:${(W / maxW) * 100}%" role="img" aria-label="${esc(template)} kerítés, ${fmt(len, 1)} m">${g}</svg>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Felülnézet: a szakaszok egymáshoz csatlakozva, a megadott fordulással.
// Szürke = még nincs kész, JEDBET-piros = telepítve. Oszlopok 2 m-enként.
const RED = '#d62828', RED_DARK = '#9e1b1b', GREY = '#6b6f75', GREY_POST = '#a3a6aa';
const TURNS = [[90, 'Jobbra fordul'], [-90, 'Balra fordul'], [0, 'Egyenesen tovább'], [45, 'Jobbra, ferdén (45°)'], [-45, 'Balra, ferdén (45°)']];

function layout(stages) {
  let x = 0, y = 0, h = 0;
  return stages.map((st, i) => {
    if (i > 0) h += Number(st.turn ?? 90);
    const r = (h * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
    const seg = { ...st, x0: x, y0: y, x1: x + dx * st.length_m, y1: y + dy * st.length_m, dx, dy };
    x = seg.x1; y = seg.y1;
    return seg;
  });
}

// Oszlop felülről: négyzet, a megadott oldalakon horonnyal (a horony szája kicsit szélesebb), letört sarkokkal.
// sides: { l, r, t, b } – helyi koordinátában x a kerítés iránya.
function postPath(S, sides) {
  const h = S / 2, w = S * 0.3, d = (S - w) / 2, g = S * 0.36, tp = S * 0.07, c = S * 0.09;
  const p = [];
  const add = (x, y) => p.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  add(-h + c, -h);
  if (sides.t) { add(-g / 2 - tp, -h); add(-g / 2, -h + d); add(g / 2, -h + d); add(g / 2 + tp, -h); }
  add(h - c, -h); add(h, -h + c);
  if (sides.r) { add(h, -g / 2 - tp); add(h - d, -g / 2); add(h - d, g / 2); add(h, g / 2 + tp); }
  add(h, h - c); add(h - c, h);
  if (sides.b) { add(g / 2 + tp, h); add(g / 2, h - d); add(-g / 2, h - d); add(-g / 2 - tp, h); }
  add(-h + c, h); add(-h, h - c);
  if (sides.l) { add(-h, g / 2 + tp); add(-h + d, g / 2); add(-h + d, -g / 2); add(-h, -g / 2 - tp); }
  add(-h, -h + c);
  return `M${p.join('L')}Z`;
}

// Panel felülről: a hátoldal egyenes, az előoldalon finom, mintától függő dombormű; hosszában enyhén elvékonyodik.
function panelPath(x0, x1, t, template, seed) {
  const n = Math.max(2, Math.round((x1 - x0) / 3));
  const amp = t * 0.09;
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const top = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, x = x0 + (x1 - x0) * f;
    const thick = t * (1 - 0.22 * f); // lejtés
    let rel = 0;
    if (i > 0 && i < n) {
      if (template === 'Hullám') rel = Math.sin(f * Math.PI * 8) * amp;
      else if (template === 'Mediterrán') rel = (Math.floor(f * 5) % 2 ? amp : -amp * 0.4);
      else rel = (rnd() - 0.5) * 2 * amp;
    }
    top.push(`${x.toFixed(2)} ${(t / 2 - thick - rel).toFixed(2)}`);
  }
  return `M${top.join('L')}L${x1.toFixed(2)} ${(t / 2).toFixed(2)}L${x0.toFixed(2)} ${(t / 2).toFixed(2)}Z`;
}

function topView(stages, { mini = false, highlight = null, maxW = 760, maxH = 400, zoom = 1 } = {}) {
  if (!stages.length) return '';
  const segs = layout(stages);
  const xs = segs.flatMap((s) => [s.x0, s.x1]), ys = segs.flatMap((s) => [s.y0, s.y1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // Szűk helyen (telefon) a címke a vonalra kerül, így nem kell neki hely a rajz körül.
  const onLine = !mini && maxW < 600;
  const padX = mini ? 12 : onLine ? 50 : 110, padY = mini ? 12 : onLine ? 24 : 54;
  const k = Math.min((maxW - 2 * padX) / Math.max(maxX - minX, 1), (maxH - 2 * padY) / Math.max(maxY - minY, 1), mini ? 14 : 30);
  const W = Math.max((maxX - minX) * k + 2 * padX, mini ? 140 : 300), H = Math.max((maxY - minY) * k + 2 * padY, mini ? 50 : 150);
  const ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = (H - (maxY - minY) * k) / 2 - minY * k;
  const P = (x, y) => [ox + x * k, oy + y * k];
  // Méretek pixelben (a valóságnál vastagabbra rajzolva, hogy látszódjon): oszlop S, panel t.
  // Valós arány: oszlop kb. 18 cm, panel kb. 5 cm; távolról legalább 8 képpont, hogy látszódjon.
  const S = mini ? 0 : Math.max(8 / zoom, 0.18 * k);
  const t = S * 0.3;
  const cx = xs.reduce((a, v) => a + v, 0) / xs.length, cy = ys.reduce((a, v) => a + v, 0) / ys.length;

  const perim = segs.reduce((a, x) => a + x.length_m, 0);
  const closed = segs.length >= 3 && Math.hypot(segs.at(-1).x1 - segs[0].x0, segs.at(-1).y1 - segs[0].y0) < 0.15 * perim;
  const pts = segs.map((s) => P(s.x0, s.y0)).concat([P(segs.at(-1).x1, segs.at(-1).y1)]);
  let out = closed ? `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="rgba(255,255,255,.035)"/>` : '';
  let posts = '', badges = '';

  segs.forEach((s, i) => {
    const done = Math.min(s.done_m || 0, s.length_m);
    const dim = highlight !== null && highlight !== s.id ? ' opacity=".28"' : '';
    const [ax, ay] = P(s.x0, s.y0);
    const rot = (Math.atan2(s.dy, s.dx) * 180) / Math.PI;
    const spans = Math.max(1, Math.ceil(s.length_m / 2 - 1e-9));
    if (mini) {
      const [bx, by] = P(s.x1, s.y1);
      const [cx2, cy2] = P(s.x0 + s.dx * done, s.y0 + s.dy * done);
      out += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#7b8087" stroke-width="5"/>`;
      if (done > 0) out += `<line x1="${ax}" y1="${ay}" x2="${cx2}" y2="${cy2}" stroke="${RED}" stroke-width="5"/>`;
      return;
    }
    // A szakasz helyi koordinátarendszerben: x a kerítés mentén (px), 0 = a szakasz eleje.
    const L = s.length_m * k;
    const inset = S / 2 - (S - S * 0.3) / 2 + 0.6 / zoom; // a panel a horony aljáig ér
    let g = `<g${dim} data-sid="${s.id}" transform="translate(${ax.toFixed(2)} ${ay.toFixed(2)}) rotate(${rot.toFixed(2)})">`;
    for (let j = 0; j < spans; j++) {
      const d0 = j * 2, d1 = Math.min(s.length_m, (j + 1) * 2);
      const x0 = d0 * k + inset, x1 = d1 * k - inset;
      const full = d1 <= done + 1e-6, part = !full && done > d0;
      const path = panelPath(x0, x1, t, s.template, i * 97 + j + 1);
      g += `<path d="${path}" fill="${full ? RED : '#8d9299'}" stroke="${full ? '#ff7a7a' : '#b9bdc2'}" stroke-width=".6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      if (part) {
        const cut = done * k;
        g += `<clipPath id="cp-${s.id}-${j}"><rect x="${x0}" y="${-t}" width="${Math.max(0, cut - x0)}" height="${2 * t}"/></clipPath>
          <path d="${path}" fill="${RED}" stroke="#ff7a7a" stroke-width=".6" vector-effect="non-scaling-stroke" clip-path="url(#cp-${s.id}-${j})"/>`;
      }
    }
    // Oszlopok: középoszlop két horonnyal, végoszlop eggyel; sarokoszlopnál a következő szakasz felé is.
    const next = segs[i + 1];
    const nextTurn = next ? ((Number(next.turn) % 360) + 360) % 360 : null;
    for (let j = 0; j <= spans; j++) {
      if (j === 0 && i > 0) continue; // ezt az előző szakasz már kirajzolta (sarokoszlopként)
      const d = Math.min(j * 2, s.length_m);
      const isStart = j === 0, isEnd = j === spans;
      const sides = { l: !isStart, r: !isEnd };
      if (isEnd && next) {
        if (nextTurn === 0) sides.r = true;
        else if (nextTurn === 90 || nextTurn === 45) sides.b = true;
        else if (nextTurn === 270 || nextTurn === 315) sides.t = true;
      }
      const isDone = done > 0 && d <= done + 1e-6;
      const sz = S * (isStart || isEnd ? 1.12 : 1);
      g += `<path transform="translate(${(d * k).toFixed(2)} 0)" d="${postPath(sz, sides)}" fill="${isDone ? '#a51d1d' : '#d9dbde'}" stroke="${isDone ? '#ff8a8a' : '#16181b'}" stroke-width="${isDone ? .8 : 1}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    }
    out += g + '</g>';

    // Címke
    const at = (dd) => P(s.x0 + s.dx * dd, s.y0 + s.dy * dd);
    const [mx, my] = at(s.length_m / 2);
    let nx = -s.dy, ny = s.dx;
    const midX = s.x0 + s.dx * s.length_m / 2, midY = s.y0 + s.dy * s.length_m / 2;
    if ((midX + nx - cx) ** 2 + (midY + ny - cy) ** 2 < (midX - nx - cx) ** 2 + (midY - ny - cy) ** 2) { nx = -nx; ny = -ny; }
    const complete = done >= s.length_m - 1e-6;
    const txt = done > 0 && !complete ? `${fmt(done, 0)}/${fmt(s.length_m, 0)} m` : `${fmt(s.length_m, s.length_m % 1 ? 1 : 0)} m`;
    const tw = 32 + txt.length * 6.6;
    const reach = Math.abs(nx) * tw / 2 + Math.abs(ny) * 12;
    const off = onLine ? 0 : S / 2 + 8 + reach;
    const lx = mx + nx * off, ly = my + ny * off;
    badges += `<g${dim} data-sid="${s.id}" class="tv-badge" data-lx="${lx.toFixed(1)}" data-ly="${ly.toFixed(1)}" transform="translate(${lx.toFixed(1)} ${ly.toFixed(1)})">
      <rect x="${-tw / 2}" y="-12" width="${tw}" height="24" rx="12" fill="${complete ? RED : '#2c3035'}" stroke="${done > 0 ? RED : '#4a4e54'}" stroke-width="1.5"/>
      <circle cx="${-tw / 2 + 12}" cy="0" r="9" fill="${complete ? '#fff' : done > 0 ? RED : '#55595f'}"/>
      <text x="${-tw / 2 + 12}" y="3.8" text-anchor="middle" font-size="11" font-weight="800" fill="${complete ? RED : '#fff'}">${i + 1}</text>
      <text x="${-tw / 2 + 26}" y="4" font-size="11.5" font-weight="700" fill="#fff">${txt}</text></g>`;
  });

  // A szakaszok befoglaló téglalapja (nagyításhoz).
  const boxes = segs.map((sg) => [sg.id, ...P(sg.x0, sg.y0), ...P(sg.x1, sg.y1)].map((v) => +(+v).toFixed(1)));
  return `<svg class="topview ${mini ? 'mini' : ''}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" data-k="${k.toFixed(3)}" data-boxes='${JSON.stringify(boxes)}' role="img" aria-label="Kerítés felülnézetből">${out}${posts}${badges}</svg>`;
}

// ---------------------------------------------------------------------------
// Nagyítás / mozgatás a felülnézeten (viewBox). A címkék nagyításkor is ugyanakkorák maradnak.
function enableZoom(wrap) {
  const svg = wrap.querySelector('svg.topview');
  if (!svg) return;
  const base = svg.getAttribute('viewBox').split(' ').map(Number);
  const k = +svg.dataset.k;
  let v = { x: base[0], y: base[1], w: base[2], h: base[3] };
  const ui = wrap.querySelector('.tv-ui');
  let drawnZ = 1, raf = 0;
  const redraw = (z) => {
    // Nagyításkor újrarajzoljuk a tartalmat a valós arányokkal (az svg elem marad, így a mozdulat nem szakad meg).
    if (!wrap._draw || Math.abs(Math.log(z / drawnZ)) < 0.15) return;
    drawnZ = z;
    const html = wrap._draw(z);
    svg.innerHTML = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</svg>'));
    svg.querySelectorAll('.tv-badge').forEach((g) => g.setAttribute('transform', `translate(${g.dataset.lx} ${g.dataset.ly}) scale(${1 / z})`));
  };
  const apply = () => {
    const z = base[2] / v.w;
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => redraw(z));
    svg.querySelectorAll('.tv-badge').forEach((g) => g.setAttribute('transform', `translate(${g.dataset.lx} ${g.dataset.ly}) scale(${1 / z})`));
    svg.style.touchAction = z > 1.01 ? 'none' : 'pan-x pan-y';
    // Lépték a képernyőn mért pixel/méter alapján.
    const pxPerM = k * (svg.getBoundingClientRect().width / v.w);
    const nice = [0.5, 1, 2, 5, 10, 20, 50, 100].find((m) => m * pxPerM >= 50) || 100;
    ui.querySelector('.tv-scale i').style.width = `${nice * pxPerM}px`;
    ui.querySelector('.tv-scale span').textContent = `${String(nice).replace('.', ',')} m`;
    ui.querySelector('[data-z="fit"]').hidden = z <= 1.01;
  };
  const clamp = () => {
    v.w = Math.min(base[2], Math.max(base[2] / 16, v.w)); v.h = v.w * (base[3] / base[2]);
    v.x = Math.min(base[0] + base[2] - v.w, Math.max(base[0], v.x));
    v.y = Math.min(base[1] + base[3] - v.h, Math.max(base[1], v.y));
  };
  const zoomAt = (f, cx, cy) => {
    const nw = Math.min(base[2], Math.max(base[2] / 16, v.w / f)), r = nw / v.w;
    v = { x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r, w: nw, h: v.h * r };
    clamp(); apply();
  };
  const toSvg = (cxs, cys) => { const r = svg.getBoundingClientRect(); return [v.x + ((cxs - r.left) / r.width) * v.w, v.y + ((cys - r.top) / r.height) * v.h]; };
  const center = () => [v.x + v.w / 2, v.y + v.h / 2];
  const segsPx = JSON.parse(svg.dataset.boxes);
  // A kerítés legközelebbi pontja (hogy a + gomb ne üres területre nagyítson).
  const nearest = (px, py) => {
    let best = null, bd = Infinity;
    for (const [, x1, y1, x2, y2] of segsPx) {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
      const tt = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
      const qx = x1 + tt * dx, qy = y1 + tt * dy, d = (qx - px) ** 2 + (qy - py) ** 2;
      if (d < bd) { bd = d; best = [qx, qy]; }
    }
    return best || [px, py];
  };
  wrap._zoomTo = (id) => {
    const sg = segsPx.find((x) => x[0] === id);
    if (!sg) return;
    // A szakasz eleje felé, kb. 8 m-es ablakkal, hogy az oszlopok és a panelek látszódjanak.
    const w = Math.min(base[2], k * 9), h = w * (base[3] / base[2]);
    const len = Math.hypot(sg[3] - sg[1], sg[4] - sg[2]) || 1;
    const f = Math.min(1, (k * 3.5) / len);
    const cx = sg[1] + (sg[3] - sg[1]) * f, cy = sg[2] + (sg[4] - sg[2]) * f;
    v = { w, h, x: cx - w / 2, y: cy - h / 2 };
    clamp(); apply();
  };
  wrap._fit = () => { v = { x: base[0], y: base[1], w: base[2], h: base[3] }; apply(); };
  ui.onclick = (e) => {
    const b = e.target.closest('[data-z]');
    if (!b) return;
    if (b.dataset.z === 'in') { const c = nearest(...center()); zoomAt(1.6, ...c); const [nx2, ny2] = c; v.x = nx2 - v.w / 2; v.y = ny2 - v.h / 2; clamp(); apply(); }
    if (b.dataset.z === 'out') zoomAt(1 / 1.6, ...center());
    if (b.dataset.z === 'fit') wrap._fit();
  };
  svg.addEventListener('wheel', (e) => {
    // Csak csippentés (trackpad) vagy ctrl + görgő nagyít; a sima görgetés az oldalt görgeti.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * 0.01), ...toSvg(e.clientX, e.clientY));
  }, { passive: false });
  svg.addEventListener('dblclick', (e) => zoomAt(2, ...toSvg(e.clientX, e.clientY)));
  const ptrs = new Map();
  let last = null;
  svg.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, [e.clientX, e.clientY]); svg.setPointerCapture?.(e.pointerId); last = null; });
  svg.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const r = svg.getBoundingClientRect();
    if (ptrs.size === 1 && base[2] / v.w > 1.01) {
      v.x -= ((e.clientX - prev[0]) / r.width) * v.w; v.y -= ((e.clientY - prev[1]) / r.height) * v.h;
      clamp(); apply();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (last) zoomAt(dist / last, ...toSvg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
      last = dist;
    }
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) last = null; };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  apply();
}

function renderTopView(highlight = null) {
  const box = $('.topview-wrap');
  if (!box || !js.detail) return;
  const size = tvSize();
  box._draw = (zoom) => topView(js.detail.stages, { highlight: js.hover ?? null, ...size, zoom });
  box.innerHTML = `${topView(js.detail.stages, { highlight, ...size })}
    <div class="tv-ui"><div class="tv-scale"><i></i><span></span></div>
      <div class="tv-btns"><button type="button" data-z="fit" title="Teljes nézet">⤢</button><button type="button" data-z="out" aria-label="Kicsinyítés">−</button><button type="button" data-z="in" aria-label="Nagyítás">+</button></div></div>`;
  enableZoom(box);
}

// ===================================================================
export function initJobs(config) {
  js.templates = config.panelTemplates;
  $('#stage-template').innerHTML = js.templates.map((t) => `<option>${esc(t)}</option>`).join('');
  injectPatterns();
  $('#stage-turn').innerHTML = TURNS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
}

export async function loadJobs() {
  js.jobs = await api('/api/jobs');
  $$('[data-job-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.jobFilter === js.filter)));
  const list = js.jobs.filter((j) => !js.filter || j.status === js.filter);
  $('#jobs').innerHTML = list.map((j) => {
    const dl = daysLeft(j.deadline);
    const panels = j.stages.reduce((a, s) => a + stageCalc(s.length_m).panels, 0);
    const deadline = j.deadline ? `<span class="chip-s ${dl < 0 && j.status === 'Aktív' ? 'bad' : dl <= 7 && j.status === 'Aktív' ? 'warn' : ''}">${dl === 0 ? 'ma' : dl > 0 ? `${dl} nap` : `${-dl} napja lejárt`} · ${esc(j.deadline.slice(5).replace('-', '.'))}.</span>` : '';
    const pct = j.total_m ? Math.round(Math.min(1, j.done_m / j.total_m) * 100) : 0;
    return `<button type="button" class="job-card ${js.selected === j.id ? 'active' : ''} ${j.status === 'Aktív' ? '' : 'done'}" data-job="${j.id}">
      <div class="job-top"><b>${esc(j.name)}</b>${j.status === 'Aktív' ? deadline : '<span class="chip-s ok">Befejezett</span>'}</div>
      <div class="muted small">${[j.client_name, j.location].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
      <div class="job-thumb">${j.stages.length ? topView(j.stages, { mini: true, maxW: 300, maxH: 110 }) : '<span class="muted small">Nincs szakasz</span>'}</div>
      <div class="job-foot small"><span><b>${fmt(j.total_m, 0)} m</b> · ${j.stages.length} szakasz · ${panels} panel</span>
        ${j.done_m ? `<span>telepítve <b>${pct}%</b></span>` : ''}</div>
    </button>`;
  }).join('') || `<p class="muted">${js.filter ? `Nincs ${js.filter.toLowerCase()} projekt.` : 'Még nincs projekt.'}</p>`;
  if (js.selected && js.jobs.some((j) => j.id === js.selected)) showJob(js.selected, false);
  else $('#job-detail').hidden = true;
}

$$('[data-job-filter]').forEach((b) => b.addEventListener('click', () => {
  js.filter = b.dataset.jobFilter;
  try { localStorage.setItem('jobFilter', js.filter); } catch {}
  loadJobs();
}));
$('#jobs').addEventListener('click', (e) => {
  const c = e.target.closest('[data-job]');
  if (!c) return;
  const id = +c.dataset.job;
  if (js.selected === id && !$('#job-detail').hidden) { js.selected = null; $('#job-detail').hidden = true; $$('.job-card').forEach((x) => x.classList.remove('active')); return; }
  showJob(id, true);
});

async function showJob(id, scroll) {
  const j = js.jobs.find((x) => x.id === id);
  if (!j) return;
  js.selected = id;
  $$('.job-card').forEach((c) => c.classList.toggle('active', +c.dataset.job === id));
  const s = await api(`/api/jobs/${id}/summary`);
  js.detail = { job: j, ...s };
  $('#job-detail').hidden = false;
  $('#jd-name').textContent = j.name;
  $('#jd-status').textContent = j.status === 'Aktív' ? '✓ Befejezettnek jelöl' : 'Újranyitás';
  const dl = daysLeft(j.deadline);
  $('#jd-meta').innerHTML = [
    j.client_name && esc(j.client_name),
    j.phone && `<a href="tel:${esc(j.phone.replace(/\s/g, ''))}">${esc(j.phone)}</a>`,
    j.location && esc(j.location),
    j.deadline && `határidő: ${esc(j.deadline)}${j.status === 'Aktív' && dl !== null ? ` (${dl >= 0 ? `${dl} nap múlva` : `${-dl} napja lejárt`})` : ''}`,
    `<button class="link small" type="button" id="jd-edit">szerkesztés</button>`,
  ].filter(Boolean).join(' · ');

  const t = s.stages.reduce((a, x) => ({ m: a.m + x.length_m, spans: a.spans + x.spans, panels: a.panels + x.panels, veg: a.veg + x.veg, kozep: a.kozep + x.kozep }),
    { m: 0, spans: 0, panels: 0, veg: 0, kozep: 0 });
  $('#jd-tiles').innerHTML = `
    <span>Hossz <b>${fmt(t.m, t.m % 1 ? 1 : 0)}</b><small>m</small></span>
    <span>Szakasz <b>${s.stages.length}</b></span>
    <span>Oszlopköz <b>${t.spans}</b></span>
    <span>Panel <b>${t.panels}</b><small>db</small></span>
    <span>Végoszlop <b>${t.veg}</b></span>
    <span>Középoszlop <b>${t.kozep}</b></span>`;
  const doneTotal = s.stages.reduce((a, x) => a + x.done_m, 0);
  const pctAll = t.m ? Math.round((doneTotal / t.m) * 100) : 0;
  $('#jd-overview').innerHTML = s.stages.length ? `<div class="topview-wrap"></div>
    <div class="tv-legend"><span><i class="lg tv-grey"></i>hátra van: <b>${fmt(t.m - doneTotal, 0)} m</b></span><span><i class="lg tv-red"></i>kész: <b>${fmt(doneTotal, 0)} m</b> (${pctAll}%)</span></div>` : '';

  $('#jd-stages').innerHTML = s.stages.map((x, i) => {
    const pct = Math.round((x.done_m / x.length_m) * 100);
    return `<div class="stage-row" data-stage="${x.id}" style="--c:${tpl(x.template).accent}">
      <span class="stage-no ${pct >= 100 ? 'ok' : pct > 0 ? 'part' : ''}">${i + 1}</span>
      <div class="stage-info"><div><b>${esc(x.stage_name)}</b> <span class="tpl-chip">${esc(x.template)}</span>
        ${i > 0 ? `<span class="muted small">${esc(turnLabel(x.turn))}</span>` : ''}</div>
        <div class="muted small">${fmt(x.length_m, x.length_m % 1 ? 1 : 0)} m · ${x.spans} köz · <b>${x.panels} panel</b> · ${x.veg} vég + ${x.kozep} közép oszlop${x.note ? ' · ' + esc(x.note) : ''}</div>
        <div class="bar sm ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div></div>
      <span class="stage-done"><b>${fmt(x.done_m, 0)}</b>/${fmt(x.length_m, 0)} m</span>
      <span class="row-btns"><button class="btn sm ghost" data-edit-stage="${x.id}" aria-label="Szerkesztés">✎</button><button class="btn sm ghost" data-del-stage="${x.id}" aria-label="Törlés">✕</button></span>
    </div>`;
  }).join('') || '<p class="muted">Még nincs szakasz. Add hozzá az elsőt: hossz, minta, és hogy merre fordul az előzőhöz képest.</p>';
  $('#jd-legend').innerHTML = '';
  renderTopView();

  $('#jd-summary tbody').innerHTML = s.summary.map((x) => `<tr><td>${esc(x.item)}</td><td class="num">${x.needed}</td>
    <td class="num">${x.in_stock}</td><td class="num ${x.missing ? 'neg' : ''}">${x.missing}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">Adj hozzá szakaszt.</td></tr>';

  const ins = s.install;
  const pct = ins.total_m ? Math.min(100, Math.round((ins.done_m / ins.total_m) * 100)) : 0;
  $('#jd-install').innerHTML = `
    <div class="progress-head"><span>${fmt(ins.done_m, 0)} / ${fmt(ins.total_m, 0)} m</span><b>${pct}%</b></div>
    <div class="bar big ${pct >= 100 ? 'done' : ''}"><i style="width:${pct}%"></i></div>
    <div class="kv">
      <span>Munkaóra: <b>${fmt(ins.hours, 1)}</b> · ${ins.work_days} nap</span>
      <span>Bérköltség: <b>${ft(ins.cost)}</b></span>
      <span>m / munkaóra: <b>${ins.hours ? fmt(ins.done_m / ins.hours, 1) : '–'}</b></span>
    </div>
    ${ins.days.length ? `<div class="list">${ins.days.map((d) => `<div class="item small"><span><b>${esc(d.day)}</b> · ${fmt(d.done_m, 0)} m</span><span class="muted">${esc(d.workers || '')}</span></div>`).join('')}</div>`
      : '<p class="muted small">A telepítést a Napi lapon rögzítsd: Telepítés feladat ennél a projektnél.</p>'}`;
  if (scroll) $('#job-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Projekt: új / szerkesztés / státusz ---
$('#job-new').addEventListener('click', () => {
  js.editingJob = false;
  const f = $('#job-form'); f.reset();
  $('#job-dialog-title').textContent = 'Új projekt';
  f.querySelector('[type=submit]').textContent = 'Létrehozás';
  $('#job-dialog').showModal();
});
$('#job-detail').addEventListener('click', async (e) => {
  if (e.target.closest('#jd-edit')) {
    const j = js.detail.job, f = $('#job-form');
    js.editingJob = true;
    for (const k of ['name', 'client_name', 'phone', 'location', 'deadline']) f[k].value = j[k] || '';
    $('#job-dialog-title').textContent = 'Projekt szerkesztése';
    f.querySelector('[type=submit]').textContent = 'Mentés';
    $('#job-dialog').showModal();
  }
  if (e.target.closest('#jd-status')) {
    const j = js.detail.job;
    await api(`/api/jobs/${j.id}`, { method: 'PATCH', body: { status: j.status === 'Aktív' ? 'Befejezett' : 'Aktív' } });
    toast(j.status === 'Aktív' ? 'Befejezettnek jelölve' : 'Újranyitva'); loadJobs();
  }
  const ed = e.target.closest('[data-edit-stage]');
  if (ed) openStage(js.detail.stages.find((x) => x.id === +ed.dataset.editStage));
  const del = e.target.closest('[data-del-stage]');
  if (del && confirm('Törlöd a szakaszt?')) { await api(`/api/stages/${del.dataset.delStage}`, { method: 'DELETE' }); loadJobs(); }
});
$('#stage-new').addEventListener('click', () => openStage(null));
$('#jd-stages').addEventListener('mouseover', (e) => {
  if (!matchMedia('(hover: hover)').matches) return;
  const r = e.target.closest('[data-stage]');
  const id = r ? +r.dataset.stage : null;
  if (id === js.hover || !js.detail) return;
  js.hover = id;
  hl(id);
});
$('#jd-stages').addEventListener('mouseleave', () => { js.hover = null; hl(null); });
// Kiemelés a nagyítás megtartásával: csak az átlátszóságot állítjuk.
function hl(id) {
  $$('.topview-wrap svg [data-sid]').forEach((g) => g.setAttribute('opacity', id === null || +g.dataset.sid === id ? '1' : '.28'));
}
// Szakaszra koppintva a térkép ráközelít.
$('#jd-stages').addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  const r = e.target.closest('[data-stage]');
  const w = $('.topview-wrap');
  if (r && w?._zoomTo) { w._zoomTo(+r.dataset.stage); w.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
});
$$('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('#job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  if (js.editingJob) {
    await api(`/api/jobs/${js.detail.job.id}`, { method: 'PATCH', body: v });
  } else {
    const res = await api('/api/jobs', { method: 'POST', body: v });
    js.selected = res.job_id;
    if (js.filter === 'Befejezett') js.filter = 'Aktív';
  }
  $('#job-dialog').close(); toast('Mentve'); await loadJobs();
  if (!js.editingJob) $('#job-detail').scrollIntoView({ behavior: 'smooth' });
});

// --- Szakasz: felvétel / szerkesztés élő előnézettel ---
function openStage(st) {
  js.editingStage = st;
  const f = $('#stage-form'); f.reset();
  $('#stage-dialog-title').textContent = st ? 'Szakasz szerkesztése' : 'Új szakasz';
  f.querySelector('[type=submit]').textContent = st ? 'Mentés' : 'Hozzáadás';
  const first = st ? js.detail.stages[0]?.id === st.id : !js.detail?.stages.length;
  f.querySelector('[data-for="turn"]').hidden = first;
  f.turn.value = '90';
  if (st) { f.stage_name.value = st.stage_name; f.length_m.value = st.length_m; f.template.value = st.template; f.note.value = st.note || ''; f.turn.value = String(st.turn ?? 90); }
  else if (js.detail?.stages.length) f.template.value = js.detail.stages[js.detail.stages.length - 1].template;
  previewStage();
  $('#stage-dialog').showModal();
}
function previewStage() {
  const f = $('#stage-form');
  const len = parseFloat(String(f.length_m.value).replace(',', '.'));
  if (!(len >= 0.5)) { $('#stage-preview').innerHTML = '<p class="muted small">Add meg a hosszt, és itt látod felülről, hogyan illeszkedik a többihez.</p>'; return; }
  const c = stageCalc(len);
  const me = { id: -1, stage_name: f.stage_name.value || 'Új szakasz', length_m: len, template: f.template.value, turn: Number(f.turn.value), done_m: 0 };
  const others = js.detail?.stages || [];
  const list = js.editingStage ? others.map((x) => (x.id === js.editingStage.id ? { ...me, id: x.id, done_m: x.done_m } : x)) : [...others, me];
  $('#stage-preview').innerHTML = `${topView(list, { highlight: js.editingStage ? js.editingStage.id : -1, maxW: Math.max(300, ($('#stage-preview').clientWidth || 520) - 26), maxH: 280 })}
    <p class="small">${c.spans} oszlopköz · <b>${c.panels} panel</b> · ${c.veg} végoszlop + ${c.kozep} középoszlop${len % 2 ? ` <span class="muted">(az utolsó köz ${fmt(len - 2 * (c.spans - 1), 1)} m)</span>` : ''}</p>`;
}
$('#stage-form').addEventListener('input', previewStage);
$('#stage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  v.length_m = String(v.length_m).replace(',', '.');
  if (js.editingStage) await api(`/api/stages/${js.editingStage.id}`, { method: 'PATCH', body: v });
  else await api(`/api/jobs/${js.selected}/stages`, { method: 'POST', body: v });
  $('#stage-dialog').close(); toast('Mentve'); loadJobs();
});
