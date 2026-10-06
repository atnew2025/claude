/**
 * Theta* (Nash et al. 2007), cost-aware variant. Paths are not restricted to
 * grid edges: a node may take its grandparent as parent when the straight
 * segment is walkable *and* cheaper. Segment costs are exact line integrals of
 * the cost density, so any-angle shortcuts through a kill zone are priced
 * correctly instead of being taken for free.
 */
import { IndexedHeap } from '../heap.js';
import { edgeCost } from '../cost.js';
import { segmentIntegral } from '../geometry.js';
import { Trace, TraceKind, makeHeuristic, result } from './common.js';

export function thetaStar(p) {
  const { grid, density, start, goal, diagonal = true } = p;
  const n = grid.size;
  const w = grid.width;
  const trace = p.trace === false ? null : new Trace();
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new IndexedHeap(n);
  const h = makeHeuristic(grid, goal, { density, kind: 'euclidean' });
  const nb = new Int32Array(8);
  let expanded = 0;
  let generated = 1;

  g[start] = 0;
  parent[start] = start;
  heap.update(start, h(start), h(start));
  trace?.push(start, TraceKind.OPEN);
  while (heap.size) {
    const u = heap.pop();
    closed[u] = 1;
    expanded++;
    trace?.push(u, TraceKind.CLOSE);
    if (u === goal) break;
    const pu = parent[u];
    const cnt = grid.neighbors(u, diagonal, nb);
    for (let k = 0; k < cnt; k++) {
      const v = nb[k];
      if (closed[v]) continue;
      let best = g[u] + edgeCost(density, u, v, grid.stepLength(u, v));
      let bestParent = u;
      if (pu !== u) {
        const shortcut = g[pu] + segmentIntegral(grid, density, pu, v);
        if (shortcut < best) {
          best = shortcut;
          bestParent = pu;
        }
      }
      if (best < g[v]) {
        g[v] = best;
        parent[v] = bestParent;
        const hv = h(v);
        heap.update(v, best + hv, hv);
        generated++;
        trace?.push(v, TraceKind.OPEN);
      }
    }
  }
  if (goal !== start && parent[goal] === -1) return result({ expanded, generated, trace });
  const waypoints = [goal];
  for (let c = goal; c !== start; ) {
    c = parent[c];
    waypoints.push(c);
    if (waypoints.length > n) return result({ expanded, generated, trace });
  }
  waypoints.reverse();
  return result({ path: rasterize(grid, waypoints), waypoints, cost: g[goal], expanded, generated, trace, extra: { anyAngle: true } });

  function rasterize(gr, pts) {
    // Cells touched by the polyline, for overlays and step-wise consumers.
    const cells = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      const ax = a % w;
      const ay = (a / w) | 0;
      const steps = Math.max(Math.abs((b % w) - ax), Math.abs(((b / w) | 0) - ay)) * 4;
      for (let s = 1; s <= steps; s++) {
        const x = Math.floor(ax + 0.5 + ((b % w) - ax) * (s / steps));
        const y = Math.floor(ay + 0.5 + (((b / w) | 0) - ay) * (s / steps));
        const c = y * gr.width + x;
        if (c !== cells[cells.length - 1]) cells.push(c);
      }
    }
    return cells;
  }
}
