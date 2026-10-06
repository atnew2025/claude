/**
 * Jump Point Search (Harabor & Grastien 2011), variant without corner
 * cutting. Optimal on uniform-cost grids and typically expands an order of
 * magnitude fewer nodes than A*, but it is blind to terrain weights and
 * threats: it plans the geometrically shortest route.
 */
import { IndexedHeap } from '../heap.js';
import { Trace, TraceKind, densify, makeHeuristic, reconstruct, result } from './common.js';

export function jps(p) {
  const { grid, start, goal } = p;
  const n = grid.size;
  const w = grid.width;
  const trace = p.trace === false ? null : new Trace();
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new IndexedHeap(n);
  const h = makeHeuristic(grid, goal, { diagonal: true });
  const W = (x, y) => grid.open(x, y);
  const gx = goal % w;
  const gy = (goal / w) | 0;
  let expanded = 0;
  let generated = 1;

  /** Straight or diagonal jump starting at (x, y) moving (dx, dy). Returns a cell or -1. */
  function jump(x, y, dx, dy) {
    for (;;) {
      if (!W(x, y)) return -1;
      trace?.push(y * w + x, TraceKind.SCAN);
      if (x === gx && y === gy) return y * w + x;
      if (dx !== 0 && dy !== 0) {
        if (jump(x + dx, y, dx, 0) !== -1 || jump(x, y + dy, 0, dy) !== -1) return y * w + x;
        if (!(W(x + dx, y) && W(x, y + dy))) return -1;
      } else if (dx !== 0) {
        if ((W(x, y - 1) && !W(x - dx, y - 1)) || (W(x, y + 1) && !W(x - dx, y + 1))) return y * w + x;
      } else if ((W(x - 1, y) && !W(x - 1, y - dy)) || (W(x + 1, y) && !W(x + 1, y - dy))) {
        return y * w + x;
      }
      x += dx;
      y += dy;
    }
  }

  /** Pruned neighbour directions given the direction we arrived from. */
  function directions(cell) {
    const x = cell % w;
    const y = (cell / w) | 0;
    const par = parent[cell];
    const out = [];
    if (par === -1) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (W(x + dx, y + dy)) out.push([dx, dy]);
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (W(x + dx, y) && W(x, y + dy) && W(x + dx, y + dy)) out.push([dx, dy]);
      }
      return out;
    }
    const dx = Math.sign(x - (par % w));
    const dy = Math.sign(y - ((par / w) | 0));
    if (dx !== 0 && dy !== 0) {
      const v = W(x, y + dy);
      const hz = W(x + dx, y);
      if (v) out.push([0, dy]);
      if (hz) out.push([dx, 0]);
      if (v && hz && W(x + dx, y + dy)) out.push([dx, dy]);
    } else if (dx !== 0) {
      const next = W(x + dx, y);
      const up = W(x, y - 1);
      const down = W(x, y + 1);
      if (next) {
        out.push([dx, 0]);
        if (up && W(x + dx, y - 1)) out.push([dx, -1]);
        if (down && W(x + dx, y + 1)) out.push([dx, 1]);
      }
      if (up) out.push([0, -1]);
      if (down) out.push([0, 1]);
    } else {
      const next = W(x, y + dy);
      const left = W(x - 1, y);
      const right = W(x + 1, y);
      if (next) {
        out.push([0, dy]);
        if (left && W(x - 1, y + dy)) out.push([-1, dy]);
        if (right && W(x + 1, y + dy)) out.push([1, dy]);
      }
      if (left) out.push([-1, 0]);
      if (right) out.push([1, 0]);
    }
    return out;
  }

  g[start] = 0;
  heap.update(start, h(start), h(start));
  trace?.push(start, TraceKind.OPEN);
  while (heap.size) {
    const u = heap.pop();
    closed[u] = 1;
    expanded++;
    trace?.push(u, TraceKind.CLOSE);
    if (u === goal) break;
    const ux = u % w;
    const uy = (u / w) | 0;
    for (const [dx, dy] of directions(u)) {
      const jp = jump(ux + dx, uy + dy, dx, dy);
      if (jp === -1 || closed[jp]) continue;
      const ng = g[u] + grid.octile(u, jp);
      if (ng < g[jp]) {
        g[jp] = ng;
        parent[jp] = u;
        const hv = h(jp);
        heap.update(jp, ng + hv, hv);
        generated++;
        trace?.push(jp, TraceKind.JUMP);
      }
    }
  }
  const waypoints = reconstruct(parent, start, goal);
  return result({ path: densify(grid, waypoints), waypoints, cost: g[goal], expanded, generated, trace });
}
