/**
 * D* Lite (Koenig & Likhachev 2002). Searches backwards from the goal and
 * repairs only the part of the search tree invalidated by cost changes, so an
 * agent that discovers new attackers mid-route can replan in a fraction of the
 * work a fresh A* would need.
 *
 * Costs are vertex densities (see cost.js); changing a cell's density changes
 * every edge touching it, so the rhs-values of the cell and its neighbours are
 * recomputed from scratch — the classic, provably correct update rule.
 */
import { IndexedHeap } from '../heap.js';
import { edgeCost } from '../cost.js';
import { Trace, TraceKind } from './common.js';

/**
 * Lexicographic key comparison with a relative tolerance on the first key.
 * Keys are sums like g + h + km whose rounding differs by an ulp depending on
 * the order they were accumulated in; an exact comparison would then end the
 * search before ties on the second key are resolved, leaving the start with a
 * stale cost.
 */
function keyLess(a1, a2, b1, b2) {
  if (!Number.isFinite(a1) || !Number.isFinite(b1)) return a1 < b1 || (a1 === b1 && a2 < b2);
  const tol = 1e-9 * Math.max(1, Math.abs(a1), Math.abs(b1));
  if (a1 < b1 - tol) return true;
  if (a1 > b1 + tol) return false;
  return a2 < b2 - tol;
}

export class DStarLite {
  /**
   * @param {import('../grid.js').Grid} grid
   * @param {Float64Array} density initial (known) density; copied
   * @param {number} start
   * @param {number} goal
   * @param {{ diagonal?: boolean, trace?: boolean }} [opts]
   */
  constructor(grid, density, start, goal, { diagonal = true, trace = false } = {}) {
    const n = grid.size;
    this.grid = grid;
    this.density = Float64Array.from(density);
    this.start = start;
    this.last = start;
    this.goal = goal;
    this.diagonal = diagonal;
    this.km = 0;
    this.g = new Float64Array(n).fill(Infinity);
    this.rhs = new Float64Array(n).fill(Infinity);
    this.heap = new IndexedHeap(n);
    this.nb = new Int32Array(8);
    this.nb2 = new Int32Array(8);
    this.expanded = 0;
    this.trace = trace ? new Trace() : null;
    // Densities only grow from the terrain baseline (≥ 1), so octile distance stays admissible.
    this.rhs[goal] = 0;
    this.heap.update(goal, this.h(start, goal), 0);
  }

  h(a, b) {
    return this.grid.octile(a, b);
  }

  cost(a, b) {
    return edgeCost(this.density, a, b, this.grid.stepLength(a, b));
  }

  _key(s) {
    const m = Math.min(this.g[s], this.rhs[s]);
    return [m + this.h(this.start, s) + this.km, m];
  }

  _updateVertex(u) {
    if (u !== this.goal) {
      let best = Infinity;
      const cnt = this.grid.neighbors(u, this.diagonal, this.nb2);
      for (let k = 0; k < cnt; k++) {
        const s = this.nb2[k];
        const v = this.cost(u, s) + this.g[s];
        if (v < best) best = v;
      }
      this.rhs[u] = best;
    }
    if (this.g[u] !== this.rhs[u]) {
      const [k1, k2] = this._key(u);
      this.heap.update(u, k1, k2);
    } else {
      this.heap.remove(u);
    }
  }

  /** Repairs the search tree until the start is locally consistent. Returns nodes expanded. */
  computeShortestPath(maxExpansions = Infinity) {
    const { heap, g, rhs } = this;
    let expanded = 0;
    for (;;) {
      if (!heap.size) break;
      const [s1, s2] = this._key(this.start);
      const t1 = heap.topK1;
      const t2 = heap.topK2;
      const topLess = keyLess(t1, t2, s1, s2);
      if (!topLess && rhs[this.start] === g[this.start]) break;
      if (expanded >= maxExpansions) break;
      const u = heap.pop();
      const [n1, n2] = this._key(u);
      if (keyLess(t1, t2, n1, n2)) {
        heap.update(u, n1, n2);
        continue;
      }
      expanded++;
      this.trace?.push(u, TraceKind.WAVE);
      const cnt = this.grid.neighbors(u, this.diagonal, this.nb);
      const nbs = this.nb.slice(0, cnt);
      if (g[u] > rhs[u]) {
        g[u] = rhs[u];
        for (const s of nbs) this._updateVertex(s);
      } else {
        g[u] = Infinity;
        this._updateVertex(u);
        for (const s of nbs) this._updateVertex(s);
      }
    }
    this.expanded += expanded;
    return expanded;
  }

  /** Moves the agent; call before applying cost changes observed at the new position. */
  moveTo(cell) {
    this.start = cell;
  }

  /**
   * Applies new densities for some cells and repairs the affected vertices.
   * @param {Iterable<[number, number]>} changes [cell, newDensity] pairs
   * @returns {number} cells whose density actually changed
   */
  updateCosts(changes) {
    const touched = new Set();
    let changed = 0;
    this.km += this.h(this.last, this.start);
    this.last = this.start;
    for (const [cell, d] of changes) {
      if (this.density[cell] === d) continue;
      this.density[cell] = d;
      changed++;
      touched.add(cell);
      const cnt = this.grid.neighbors(cell, this.diagonal, this.nb);
      for (let k = 0; k < cnt; k++) touched.add(this.nb[k]);
    }
    for (const u of touched) this._updateVertex(u);
    return changed;
  }

  /** Cost-to-go from the current start (Infinity when cut off). */
  get distance() {
    return this.rhs[this.start];
  }

  /** Best next cell from `cell`, or -1 when no route exists. */
  next(cell = this.start) {
    if (cell === this.goal) return -1;
    let best = -1;
    let bestV = Infinity;
    const cnt = this.grid.neighbors(cell, this.diagonal, this.nb);
    for (let k = 0; k < cnt; k++) {
      const s = this.nb[k];
      const v = this.cost(cell, s) + this.g[s];
      if (v < bestV) {
        bestV = v;
        best = s;
      }
    }
    return Number.isFinite(bestV) ? best : -1;
  }

  /** Current best path from the start, following the cost-to-go gradient. */
  path() {
    const out = [this.start];
    if (!Number.isFinite(this.rhs[this.start])) return null;
    let c = this.start;
    const seen = new Set([c]);
    while (c !== this.goal) {
      c = this.next(c);
      if (c === -1 || seen.has(c)) return null;
      seen.add(c);
      out.push(c);
    }
    return out;
  }
}
