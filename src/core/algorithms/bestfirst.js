/**
 * Classic grid searches: breadth-first, Dijkstra, greedy best-first, A* and
 * weighted A*. They share one engine that differs only in the priority used.
 */
import { IndexedHeap } from '../heap.js';
import { edgeCost } from '../cost.js';
import { Trace, TraceKind, makeHeuristic, reconstruct, result } from './common.js';

/**
 * @typedef {Object} Problem
 * @property {import('../grid.js').Grid} grid
 * @property {Float64Array} density  per-cell cost density (see cost.js)
 * @property {number} start
 * @property {number} goal
 * @property {boolean} [diagonal=true]
 * @property {boolean} [trace=true]
 */

/** Breadth-first search: fewest steps, blind to terrain and threats. */
export function bfs(p) {
  const { grid, start, goal, diagonal = true } = p;
  const n = grid.size;
  const parent = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const trace = p.trace === false ? null : new Trace();
  const nb = new Int32Array(8);
  let head = 0;
  let tail = 0;
  let expanded = 0;
  let generated = 1;
  queue[tail++] = start;
  seen[start] = 1;
  trace?.push(start, TraceKind.OPEN);
  while (head < tail) {
    const u = queue[head++];
    expanded++;
    trace?.push(u, TraceKind.CLOSE);
    if (u === goal) break;
    const cnt = grid.neighbors(u, diagonal, nb);
    for (let k = 0; k < cnt; k++) {
      const v = nb[k];
      if (seen[v]) continue;
      seen[v] = 1;
      parent[v] = u;
      queue[tail++] = v;
      generated++;
      trace?.push(v, TraceKind.OPEN);
    }
  }
  const path = reconstruct(parent, start, goal);
  return result({ path, cost: path ? path.length - 1 : Infinity, expanded, generated, trace });
}

/**
 * Generic best-first search.
 * mode: 'dijkstra' (f = g), 'greedy' (f = h), 'astar' (f = g + w·h).
 */
export function bestFirst(p, { mode = 'astar', weight = 1 } = {}) {
  const { grid, density, start, goal, diagonal = true } = p;
  const n = grid.size;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new IndexedHeap(n);
  const trace = p.trace === false ? null : new Trace();
  const h = mode === 'dijkstra' ? () => 0 : makeHeuristic(grid, goal, { diagonal, density });
  const nb = new Int32Array(8);
  const w = grid.width;
  const priority = (gv, hv) => (mode === 'dijkstra' ? gv : mode === 'greedy' ? hv : gv + weight * hv);
  let expanded = 0;
  let generated = 1;

  g[start] = 0;
  heap.update(start, priority(0, h(start)), h(start));
  trace?.push(start, TraceKind.OPEN);
  while (heap.size) {
    const u = heap.pop();
    closed[u] = 1;
    expanded++;
    trace?.push(u, TraceKind.CLOSE);
    if (u === goal) break;
    const cnt = grid.neighbors(u, diagonal, nb);
    const ux = u % w;
    for (let k = 0; k < cnt; k++) {
      const v = nb[k];
      if (closed[v]) continue;
      const vx = v % w;
      const len = vx !== ux && v - vx !== u - ux ? Math.SQRT2 : 1;
      const ng = g[u] + edgeCost(density, u, v, len);
      if (ng < g[v]) {
        g[v] = ng;
        parent[v] = u;
        const hv = h(v);
        heap.update(v, priority(ng, hv), hv);
        generated++;
        trace?.push(v, TraceKind.OPEN);
      }
    }
  }
  const path = reconstruct(parent, start, goal);
  return result({ path, cost: g[goal], expanded, generated, trace });
}

export const dijkstra = (p) => bestFirst(p, { mode: 'dijkstra' });
export const greedy = (p) => bestFirst(p, { mode: 'greedy' });
export const astar = (p) => bestFirst(p, { mode: 'astar', weight: 1 });
export const weightedAstar = (p) => bestFirst(p, { mode: 'astar', weight: p.weight ?? 1.8 });

/**
 * Bidirectional A* (symmetric approach, Goldberg & Harrelson 2005). Both
 * frontiers use their own consistent heuristic; the search stops as soon as
 * either frontier's smallest key reaches the best meeting cost μ.
 */
export function bidirectionalAstar(p) {
  const { grid, density, start, goal, diagonal = true } = p;
  const n = grid.size;
  const w = grid.width;
  const trace = p.trace === false ? null : new Trace();
  const side = (root, target, openKind, closeKind) => ({
    g: new Float64Array(n).fill(Infinity),
    parent: new Int32Array(n).fill(-1),
    closed: new Uint8Array(n),
    heap: new IndexedHeap(n),
    h: makeHeuristic(grid, target, { diagonal, density }),
    root,
    openKind,
    closeKind,
  });
  const F = side(start, goal, TraceKind.OPEN, TraceKind.CLOSE);
  const B = side(goal, start, TraceKind.OPEN_B, TraceKind.CLOSE_B);
  for (const s of [F, B]) {
    s.g[s.root] = 0;
    s.heap.update(s.root, s.h(s.root), s.h(s.root));
    trace?.push(s.root, s.openKind);
  }
  let mu = start === goal ? 0 : Infinity;
  let meet = start === goal ? start : -1;
  let expanded = 0;
  let generated = 2;
  const nb = new Int32Array(8);

  while (F.heap.size && B.heap.size) {
    if (F.heap.topK1 >= mu || B.heap.topK1 >= mu) break;
    const S = F.heap.topK1 <= B.heap.topK1 ? F : B;
    const O = S === F ? B : F;
    const u = S.heap.pop();
    S.closed[u] = 1;
    expanded++;
    trace?.push(u, S.closeKind);
    const cnt = grid.neighbors(u, diagonal, nb);
    const ux = u % w;
    for (let k = 0; k < cnt; k++) {
      const v = nb[k];
      if (S.closed[v]) continue;
      const vx = v % w;
      const len = vx !== ux && v - vx !== u - ux ? Math.SQRT2 : 1;
      const ng = S.g[u] + edgeCost(density, u, v, len);
      if (ng < S.g[v]) {
        S.g[v] = ng;
        S.parent[v] = u;
        const hv = S.h(v);
        S.heap.update(v, ng + hv, hv);
        generated++;
        trace?.push(v, S.openKind);
        if (O.g[v] < Infinity && ng + O.g[v] < mu) {
          mu = ng + O.g[v];
          meet = v;
        }
      }
    }
  }

  if (meet === -1) return result({ expanded, generated, trace });
  const head = reconstruct(F.parent, start, meet);
  const tail = reconstruct(B.parent, goal, meet);
  const path = head.concat(tail.reverse().slice(1));
  return result({ path, cost: mu, expanded, generated, trace, extra: { meet } });
}
