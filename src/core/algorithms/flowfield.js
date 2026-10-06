/**
 * Flow field: one Dijkstra wave from the goal yields the optimal next step for
 * *every* cell at once — the standard technique for steering swarms. Any
 * number of agents can then follow the field for free.
 */
import { IndexedHeap } from '../heap.js';
import { edgeCost } from '../cost.js';
import { Trace, TraceKind, result } from './common.js';

/** Builds the integration field (cost-to-goal) and the next-step field. */
export function buildFlowField(grid, density, goal, { diagonal = true, trace = null } = {}) {
  const n = grid.size;
  const dist = new Float64Array(n).fill(Infinity);
  const next = new Int32Array(n).fill(-1);
  const heap = new IndexedHeap(n);
  const nb = new Int32Array(8);
  dist[goal] = 0;
  heap.update(goal, 0, 0);
  let settled = 0;
  while (heap.size) {
    const u = heap.pop();
    settled++;
    trace?.push(u, TraceKind.WAVE);
    const cnt = grid.neighbors(u, diagonal, nb);
    for (let k = 0; k < cnt; k++) {
      const v = nb[k];
      // Edge costs are symmetric, so the cost of v → u equals u → v.
      const nd = dist[u] + edgeCost(density, v, u, grid.stepLength(u, v));
      if (nd < dist[v]) {
        dist[v] = nd;
        next[v] = u;
        heap.update(v, nd, 0);
      }
    }
  }
  return { dist, next, settled };
}

/** Planner wrapper: builds the field and reads the route for `start` from it. */
export function flowField(p) {
  const { grid, density, start, goal, diagonal = true } = p;
  const trace = p.trace === false ? null : new Trace();
  const field = buildFlowField(grid, density, goal, { diagonal, trace });
  if (!Number.isFinite(field.dist[start])) return result({ expanded: field.settled, trace, extra: { field } });
  const path = [start];
  for (let c = start; c !== goal; ) {
    c = field.next[c];
    path.push(c);
  }
  return result({ path, cost: field.dist[start], expanded: field.settled, generated: field.settled, trace, extra: { field } });
}
