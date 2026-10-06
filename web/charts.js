/**
 * Small SVG charts for the intel rail: cumulative damage over time and the
 * time-vs-damage Pareto front. Colours come from theme tokens; text always uses
 * ink tokens, never series colours.
 */

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

/** "Nice" tick values covering [0, max]. */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(6)));
  return ticks;
}

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.hidden = false;
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  t.style.left = `${Math.min(window.innerWidth - w - 8, x + 14)}px`;
  t.style.top = `${Math.max(8, y - h - 10)}px`;
}

export function hideTip() {
  if (tip) tip.hidden = true;
}

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/**
 * Cumulative damage per agent over time, with the HP threshold marked.
 * @param {HTMLElement} host
 * @param {{ label: string, color: string, curve: Float32Array, dt: number, deathTime: number|null }[]} series
 * @returns {{ setNow(t:number): void }}
 */
export function damageChart(host, series, { hp = 100, theme }) {
  host.replaceChildren();
  const W = 300;
  const H = 150;
  const m = { l: 34, r: 12, t: 10, b: 22 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const tMax = Math.max(1, ...series.map((s) => s.curve.length * s.dt));
  const dMax = Math.max(hp * 1.05, ...series.map((s) => Math.min(s.curve[s.curve.length - 1] ?? 0, hp * 2.5)));
  const xt = niceTicks(tMax, 4);
  const yt = niceTicks(dMax, 3);
  const X = (t) => m.l + (t / xt[xt.length - 1]) * iw;
  const Y = (d) => m.t + ih - (Math.min(d, yt[yt.length - 1]) / yt[yt.length - 1]) * ih;

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'Damage taken over time';
  host.appendChild(title);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cumulative damage over time per agent' }, host);
  const grid = el('g', { class: 'axis' }, svg);
  for (const v of yt) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: theme.line, 'stroke-width': 1 }, grid);
    el('text', { x: m.l - 6, y: Y(v) + 3, 'text-anchor': 'end' }, grid).textContent = v;
  }
  for (const v of xt) el('text', { x: X(v), y: H - 6, 'text-anchor': 'middle' }, grid).textContent = `${v}s`;
  // HP threshold: crossing it means the agent is destroyed.
  el('line', { x1: m.l, x2: W - m.r, y1: Y(hp), y2: Y(hp), stroke: theme.critical, 'stroke-width': 1.5 }, svg);
  el('text', { x: W - m.r, y: Y(hp) - 4, 'text-anchor': 'end', style: `fill:${theme.ink2}` }, svg).textContent = `${hp} HP · destroyed`;

  for (const s of series) {
    const n = s.curve.length;
    const stride = Math.max(1, Math.floor(n / 160));
    let d = `M${X(0)},${Y(0)}`;
    for (let i = 0; i < n; i += stride) d += `L${X((i + 1) * s.dt).toFixed(1)},${Y(s.curve[i]).toFixed(1)}`;
    d += `L${X(n * s.dt).toFixed(1)},${Y(s.curve[n - 1] ?? 0).toFixed(1)}`;
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    el('circle', { cx: X(n * s.dt), cy: Y(s.curve[n - 1] ?? 0), r: 4, fill: s.color, stroke: theme.surface, 'stroke-width': 2 }, svg);
  }
  const now = el('line', { x1: m.l, x2: m.l, y1: m.t, y2: m.t + ih, stroke: theme.ink2, 'stroke-width': 1, opacity: 0 }, svg);
  const cross = el('line', { y1: m.t, y2: m.t + ih, stroke: theme.muted, 'stroke-width': 1, opacity: 0 }, svg);
  const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
  hit.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width * W - m.l) / iw * xt[xt.length - 1];
    if (t < 0) return;
    cross.setAttribute('x1', X(t));
    cross.setAttribute('x2', X(t));
    cross.setAttribute('opacity', 1);
    const rows = series
      .map((s) => {
        const i = Math.min(s.curve.length - 1, Math.max(0, Math.floor(t / s.dt)));
        const v = t > s.curve.length * s.dt ? s.curve[s.curve.length - 1] : s.curve[i];
        return `<div><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};margin-right:6px"></i>${s.label}: <b>${fmt(v ?? 0)}</b></div>`;
      })
      .join('');
    showTip(`<div style="color:${theme.muted}">t = ${fmt(t)} s</div>${rows}`, e.clientX, e.clientY);
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('opacity', 0);
    hideTip();
  });
  if (series.length >= 2) {
    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    for (const s of series) {
      const span = document.createElement('span');
      const i = document.createElement('i');
      i.style.background = s.color;
      span.append(i, s.label);
      legend.appendChild(span);
    }
    host.appendChild(legend);
  }
  return {
    setNow(t) {
      if (t <= 0 || t > xt[xt.length - 1]) {
        now.setAttribute('opacity', 0);
        return;
      }
      now.setAttribute('x1', X(t));
      now.setAttribute('x2', X(t));
      now.setAttribute('opacity', 0.6);
    },
  };
}

/**
 * Risk sweep scatter: travel time vs damage, Pareto front as a staircase.
 * @param {{ series: string, color: string, points: object[] }[]} groups
 */
export function paretoChart(host, groups, { theme, hp = 100, selected, onSelect }) {
  host.replaceChildren();
  const W = 300;
  const H = 190;
  const m = { l: 34, r: 14, t: 12, b: 30 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const all = groups.flatMap((g) => g.points);
  const tMin = Math.min(...all.map((p) => p.time));
  const tMaxV = Math.max(...all.map((p) => p.time));
  const span = Math.max(1, tMaxV - tMin);
  const lo = Math.max(0, Math.floor((tMin - span * 0.12) / 5) * 5);
  const xt = niceTicks(tMaxV + span * 0.08 - lo, 4).map((v) => v + lo);
  const yt = niceTicks(Math.max(10, ...all.map((p) => p.damage)) * 1.08, 4);
  const X = (t) => m.l + ((t - xt[0]) / (xt[xt.length - 1] - xt[0])) * iw;
  const Y = (d) => m.t + ih - (d / yt[yt.length - 1]) * ih;

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'Travel time vs damage';
  host.appendChild(title);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Pareto front of travel time against damage' }, host);
  const axis = el('g', { class: 'axis' }, svg);
  for (const v of yt) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: theme.line, 'stroke-width': 1 }, axis);
    el('text', { x: m.l - 6, y: Y(v) + 3, 'text-anchor': 'end' }, axis).textContent = v;
  }
  for (const v of xt) el('text', { x: X(v), y: H - 14, 'text-anchor': 'middle' }, axis).textContent = v;
  el('text', { x: m.l + iw / 2, y: H - 2, 'text-anchor': 'middle' }, axis).textContent = 'travel time (s)';
  if (hp <= yt[yt.length - 1]) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(hp), y2: Y(hp), stroke: theme.critical, 'stroke-width': 1.5 }, svg);
    el('text', { x: W - m.r, y: Y(hp) - 4, 'text-anchor': 'end', style: `fill:${theme.ink2}` }, svg).textContent = `${hp} HP`;
  }
  // Staircase through the non-dominated points.
  const front = all.filter((p) => p.pareto).sort((a, b) => a.time - b.time);
  if (front.length > 1) {
    let d = `M${X(front[0].time)},${Y(front[0].damage)}`;
    for (let k = 1; k < front.length; k++) d += `H${X(front[k].time)}V${Y(front[k].damage)}`;
    el('path', { d, fill: 'none', stroke: theme.ink2, 'stroke-width': 1.5, opacity: 0.7 }, svg);
  }
  for (const g of groups) {
    for (const p of g.points) {
      const isSel = selected === p;
      const c = el('circle', {
        cx: X(p.time),
        cy: Y(p.damage),
        r: isSel ? 6.5 : 4.5,
        fill: p.pareto ? g.color : theme.surface,
        stroke: p.pareto ? theme.surface : g.color,
        'stroke-width': 2,
        tabindex: 0,
        role: 'button',
        'aria-label': `${g.series}, λ ${p.lambdas.join(', ')}: ${fmt(p.time)} s, ${fmt(p.damage)} damage`,
        style: 'cursor:pointer',
      }, svg);
      if (isSel) el('circle', { cx: X(p.time), cy: Y(p.damage), r: 9.5, fill: 'none', stroke: theme.ink, 'stroke-width': 1.5 }, svg);
      const html = `<b>${g.series}</b><div>λ = ${p.lambdas.join(', ')}</div><div>${fmt(p.time)} s · ${fmt(p.damage)} damage</div><div style="color:${theme.muted}">${p.pareto ? 'On the Pareto front' : 'Dominated'}</div>`;
      c.addEventListener('pointerenter', (e) => showTip(html, e.clientX, e.clientY));
      c.addEventListener('pointerleave', hideTip);
      c.addEventListener('click', () => onSelect?.(p));
      c.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && onSelect?.(p));
    }
  }
  // Direct labels only at the two ends of the front.
  for (const p of [front[0], front[front.length - 1]]) {
    if (!p || (p === front[front.length - 1] && front.length < 2)) continue;
    const right = X(p.time) < m.l + iw * 0.7;
    el('text', { x: X(p.time) + (right ? 9 : -9), y: Y(p.damage) - 8, 'text-anchor': right ? 'start' : 'end', style: `fill:${theme.ink2}` }, svg).textContent = `λ ${p.lambdas[0]}`;
  }
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  for (const g of groups) {
    const span = document.createElement('span');
    const i = document.createElement('i');
    i.style.cssText = `background:${g.color};width:9px;height:9px;border-radius:50%`;
    span.append(i, g.series);
    legend.appendChild(span);
  }
  const hollow = document.createElement('span');
  const hi = document.createElement('i');
  hi.style.cssText = `border:2px solid ${theme.muted};width:9px;height:9px;border-radius:50%;background:transparent`;
  hollow.append(hi, 'Dominated');
  legend.appendChild(hollow);
  host.appendChild(legend);
}
