/**
 * Space-Time A*: plans in (cell, time) so it can exploit the *timing* of
 * attacks — slip behind a rotating laser, wait out a mortar cycle, shadow a
 * patrol. Actions are the 8 moves plus "hold position".
 *
 * Time is continuous: a move a → b takes exactly len · (m[a] + m[b]) / 2
 * seconds, the first len·m[a]/2 of them inside a. States are deduplicated in
 * (cell, time-bucket) pairs, which keeps the search finite.
 *
 * Damage is integrated over time-dependent layers of the dynamic threat field.
 * Each layer covers `layerDt` seconds and stores the *maximum* rate sampled
 * across a slightly wider window, so a plan that is safe in the planner stays
 * safe when replayed against the true continuous model.
 *
 * Objective: travel time + λ · damage, identical to the static planners.
 * Heuristic: exact cost-to-go under terrain + *static* fire only, computed by
 * one backward Dijkstra. It is admissible and consistent because dynamic
 * damage and waiting can only add cost, and it is far tighter than distance
 * alone.
 *
 * Two rules keep the time dimension from exploding:
 *  • Holding position is only offered within two cells of ground a dynamic
 *    attacker can reach. Elsewhere the world is time-invariant, so waiting
 *    early is never better than waiting at the edge of the danger.
 *  • Wait dominance: arriving at a cell at t2 with damage d2 is pruned if an
 *    expanded state reached it at t1 ≤ t2 with d1 + (damage of holding there
 *    from t1 to t2) ≤ d2, because holding reproduces it. Hold states
 *    themselves are never pruned this way, as they are that reproduction.
 */
import { PairHeap } from '../heap.js';
import { buildDensity } from '../cost.js';
import { buildFlowField } from './flowfield.js';
import { Trace, TraceKind, result } from './common.js';

export function spaceTimeAStar(p) {
  const {
    grid,
    model,
    start,
    goal,
    diagonal = true,
    riskWeight = 1,
    layerDt = 0.25,
    bucket = 0.25,
    wait = 0.5,
    horizon = 480, // seconds
    maxExpansions = 300000,
    prune = true,
  } = p;
  const n = grid.size;
  const trace = p.trace === false ? null : new Trace();
  const t0 = p.startTime ?? 0;
  const staticRate = model ? model.staticRate : new Float32Array(n);

  const hField = buildFlowField(grid, buildDensity(grid, null, { riskWeight, rate: staticRate }), goal, { diagonal }).dist;
  if (!Number.isFinite(hField[start])) return result({ trace, extra: { reason: 'goal unreachable' } });

  // Compact storage for cells that dynamic attackers can ever reach.
  const dynIndex = new Int32Array(n).fill(-1);
  const dynCells = [];
  if (model) for (let i = 0; i < n; i++) if (model.dynamicCover[i]) dynIndex[i] = dynCells.push(i) - 1;
  // Layers are built in order so each cell also gets a running damage
  // integral, which makes exposure over any interval O(1).
  const layers = [];
  const cumulative = [new Float64Array(dynCells.length)];
  const scratch = new Float32Array(n);
  const offsets = [-0.25, 0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.25];
  function ensure(k) {
    while (layers.length <= k) {
      const idx = layers.length;
      const L = new Float32Array(dynCells.length);
      for (const o of offsets) {
        model.dynamicFieldAt(t0 + (idx + o) * layerDt, scratch);
        for (let j = 0; j < dynCells.length; j++) if (scratch[dynCells[j]] > L[j]) L[j] = scratch[dynCells[j]];
      }
      const prev = cumulative[idx];
      const next = new Float64Array(dynCells.length);
      for (let j = 0; j < dynCells.length; j++) next[j] = prev[j] + L[j] * layerDt;
      layers.push(L);
      cumulative.push(next);
    }
  }
  /** Dynamic damage at slot j integrated over [0, x). */
  function integral(j, x) {
    const k = Math.floor(x / layerDt);
    ensure(k);
    return cumulative[k][j] + layers[k][j] * (x - k * layerDt);
  }
  /** Damage taken standing in `cell` during [a, b) (times relative to t0). */
  function exposure(cell, a, b) {
    let dmg = staticRate[cell] * (b - a);
    const j = dynIndex[cell];
    if (j !== -1 && b > a) dmg += integral(j, b) - integral(j, a);
    return dmg;
  }

  // Growable state storage.
  let cap = 4096;
  let sCell = new Int32Array(cap);
  let sT = new Float64Array(cap);
  let sG = new Float64Array(cap);
  let sPar = new Int32Array(cap);
  let sD = new Float64Array(cap);
  let sClosed = new Uint8Array(cap);
  let count = 0;
  const grow = (A, Ctor) => {
    const out = new Ctor(cap);
    out.set(A);
    return out;
  };
  function addState(cell, t, g, par, d) {
    if (count === cap) {
      cap *= 2;
      sCell = grow(sCell, Int32Array);
      sT = grow(sT, Float64Array);
      sG = grow(sG, Float64Array);
      sPar = grow(sPar, Int32Array);
      sD = grow(sD, Float64Array);
      sClosed = grow(sClosed, Uint8Array);
    }
    sCell[count] = cell;
    sT[count] = t;
    sG[count] = g;
    sPar[count] = par;
    sD[count] = d;
    return count++;
  }

  // Holding position is useful only near ground that dynamic attackers reach.
  const waitOK = new Uint8Array(n);
  const W = grid.width;
  for (const c of dynCells) {
    const cx = c % W;
    const cy = (c / W) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) if (grid.inBounds(cx + dx, cy + dy)) waitOK[(cy + dy) * W + cx + dx] = 1;
    }
  }

  // Expanded (time, damage) records per cell, newest last, for dominance tests.
  const records = new Map();
  function dominated(cell, t, d) {
    if (!prune) return false;
    const list = records.get(cell);
    if (!list) return false;
    for (let k = list.length - 1, seen = 0; k >= 0 && seen < 6; k--) {
      const r = list[k];
      if (r.t > t + 1e-9) continue;
      seen++;
      if (r.d + exposure(cell, r.t, t) <= d + 1e-9) return true;
    }
    return false;
  }
  function record(cell, t, d) {
    let list = records.get(cell);
    if (!list) records.set(cell, (list = []));
    list.push({ t, d });
  }

  const index = new Map();
  const heap = new PairHeap(4096);
  const root = addState(start, 0, 0, -1, 0);
  index.set(start, root);
  heap.push(root, hField[start], hField[start]);
  trace?.push(start, TraceKind.OPEN);
  const nb = new Int32Array(9);
  let expanded = 0;
  let generated = 1;
  let goalState = -1;

  while (heap.size) {
    const id = heap.pop();
    if (sClosed[id]) continue;
    sClosed[id] = 1;
    const u = sCell[id];
    const t = sT[id];
    const d = sD[id];
    const held = sPar[id] !== -1 && sCell[sPar[id]] === u;
    if (!held && dominated(u, t, d)) continue;
    record(u, t, d);
    expanded++;
    trace?.push(u, TraceKind.CLOSE);
    if (u === goal) {
      goalState = id;
      break;
    }
    if (expanded >= maxExpansions) break;
    const cnt = grid.neighbors(u, diagonal, nb);
    nb[cnt] = u;
    const actions = waitOK[u] ? cnt + 1 : cnt;
    const mu = grid.moveCost(u);
    for (let k = 0; k < actions; k++) {
      const v = nb[k];
      const hv = hField[v];
      if (!Number.isFinite(hv)) continue;
      let dur;
      let damage;
      if (v === u) {
        dur = wait;
        damage = exposure(u, t, t + dur);
      } else {
        const half = grid.stepLength(u, v) * 0.5;
        const du = half * mu;
        dur = du + half * grid.moveCost(v);
        damage = exposure(u, t, t + du) + exposure(v, t + du, t + dur);
      }
      const nt = t + dur;
      if (nt > horizon) continue;
      const nd = d + damage;
      if (v !== u && dominated(v, nt, nd)) continue;
      const ng = sG[id] + dur + riskWeight * damage;
      const key = Math.round(nt / bucket) * n + v;
      const existing = index.get(key);
      if (existing !== undefined) {
        if (sClosed[existing] || sG[existing] <= ng) continue;
        sG[existing] = ng;
        sT[existing] = nt;
        sD[existing] = nd;
        sPar[existing] = id;
        heap.push(existing, ng + hv, hv);
      } else {
        index.set(key, addState(v, nt, ng, id, nd));
        heap.push(count - 1, ng + hv, hv);
      }
      generated++;
      if (v !== u) trace?.push(v, TraceKind.OPEN);
    }
  }

  if (goalState === -1) {
    const reason = expanded >= maxExpansions ? 'expansion budget exhausted' : 'no route within the time horizon';
    return result({ expanded, generated, trace, extra: { reason } });
  }
  const timeline = [];
  for (let s = goalState; s !== -1; s = sPar[s]) timeline.push({ cell: sCell[s], t: t0 + sT[s] });
  timeline.reverse();
  const path = [];
  const waits = [];
  for (let k = 0; k < timeline.length; k++) {
    const { cell, t } = timeline[k];
    if (path[path.length - 1] !== cell) {
      path.push(cell);
      continue;
    }
    const prevT = timeline[k - 1].t;
    const last = waits[waits.length - 1];
    if (last && last.cell === cell && last.t1 === prevT) last.t1 = t;
    else waits.push({ cell, t0: prevT, t1: t });
  }
  return result({
    path,
    cost: sG[goalState],
    expanded,
    generated,
    trace,
    extra: { timeline, waits, split: 'terrain', arrival: timeline[timeline.length - 1].t, states: count, layers: layers.length },
  });
}
