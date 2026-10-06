import { Grid, Terrain } from '../src/core/grid.js';
import { mulberry32 } from '../src/core/maps.js';

/** Random grid with walls, brush and mud; start and goal forced open. */
export function randomGrid(seed, w = 24, h = 16, { walls = 0.28, rough = 0.2 } = {}) {
  const rng = mulberry32(seed);
  const g = new Grid(w, h);
  for (let i = 0; i < g.size; i++) {
    const r = rng();
    g.cells[i] = r < walls ? Terrain.WALL : r < walls + rough / 2 ? Terrain.BRUSH : r < walls + rough ? Terrain.MUD : Terrain.OPEN;
  }
  const start = 0;
  const goal = g.size - 1;
  g.cells[start] = Terrain.OPEN;
  g.cells[goal] = Terrain.OPEN;
  return { grid: g, start, goal, rng };
}

/** Reference shortest path costs via a plain O(n²) Dijkstra (no heap). */
export function referenceDistances(grid, density, source, diagonal = true) {
  const n = grid.size;
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const nb = new Int32Array(8);
  dist[source] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u === -1 || dist[i] < dist[u])) u = i;
    if (u === -1) break;
    done[u] = 1;
    const cnt = grid.neighbors(u, diagonal, nb);
    for (let k = 0; k < cnt; k++) {
      const v = nb[k];
      const c = grid.stepLength(u, v) * 0.5 * (density[u] + density[v]);
      if (dist[u] + c < dist[v]) dist[v] = dist[u] + c;
    }
  }
  return dist;
}

export const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

/** Asserts that a dense path is made of legal steps (adjacent, walkable, no corner cutting). */
export function validPath(grid, path, start, goal, diagonal = true) {
  if (path[0] !== start || path[path.length - 1] !== goal) return false;
  const nb = new Int32Array(8);
  for (let k = 1; k < path.length; k++) {
    const cnt = grid.neighbors(path[k - 1], diagonal, nb);
    if (!Array.from(nb.subarray(0, cnt)).includes(path[k])) return false;
  }
  return true;
}
