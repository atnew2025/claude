/**
 * Cost model shared by every planner.
 *
 * A route is scored as   travel time + λ · expected damage   where λ is the
 * risk aversion. Per cell this becomes a *density*
 *
 *     density[c] = move[c] · (1 + λ · rate[c])
 *
 * i.e. seconds spent in the cell plus λ × the damage taken during those
 * seconds. Moving between adjacent cells costs len · (d[a] + d[b]) / 2 — half
 * of the step is spent in each cell — which is also exactly the line integral
 * used by any-angle planners, so all planners agree on what a path costs.
 */

export const RiskMode = Object.freeze({ NONE: 'none', MEAN: 'mean', PEAK: 'peak' });

/**
 * @param {import('./grid.js').Grid} grid
 * @param {import('./threats.js').ThreatModel|null} model
 * @param {{ riskWeight?: number, riskMode?: string, rate?: Float32Array }} [opts]
 *   `rate` overrides the model field (used for partially-known threats).
 */
export function buildDensity(grid, model, { riskWeight = 1, riskMode = RiskMode.MEAN, rate } = {}) {
  const n = grid.size;
  const d = new Float64Array(n);
  const field = rate ?? (model && riskMode !== RiskMode.NONE ? (riskMode === RiskMode.PEAK ? model.peak : model.mean) : null);
  for (let i = 0; i < n; i++) {
    if (!grid.walkable(i)) {
      d[i] = Infinity;
      continue;
    }
    const m = grid.moveCost(i);
    d[i] = field ? m * (1 + riskWeight * field[i]) : m;
  }
  return d;
}

/** Travel-time density (risk ignored). */
export function timeDensity(grid) {
  return buildDensity(grid, null, { riskMode: RiskMode.NONE });
}

export function edgeCost(density, a, b, len) {
  return len * 0.5 * (density[a] + density[b]);
}

/** Smallest finite density — scales heuristics so they stay admissible. */
export function minDensity(density) {
  let m = Infinity;
  for (let i = 0; i < density.length; i++) if (density[i] < m) m = density[i];
  return Number.isFinite(m) ? m : 1;
}

/** Exact cost of a cell path under a density. */
export function pathCost(grid, density, path) {
  let c = 0;
  for (let k = 1; k < path.length; k++) c += edgeCost(density, path[k - 1], path[k], grid.stepLength(path[k - 1], path[k]));
  return c;
}
