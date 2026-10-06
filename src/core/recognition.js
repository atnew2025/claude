/**
 * Attack recognition: turns raw damage fields into tactical intelligence.
 *
 *  • Zone classification per cell — safe, cover shadow, exposed, crossfire,
 *    kill zone.
 *  • Temporal signatures — the threat at each dynamic cell is *observed* over
 *    a window as a black-box signal; autocorrelation recovers its period, and
 *    the signal yields duty cycle and the longest safe window per cycle.
 *  • Attacker intel — coverage, peak / mean damage, recognised pattern.
 *
 * The analysis drives overlays, the hover inspector and the adaptive planner.
 */

export const Zone = Object.freeze({ SAFE: 0, SHADOW: 1, EXPOSED: 2, CROSSFIRE: 3, KILLZONE: 4 });
export const ZONE_INFO = Object.freeze([
  { id: 0, key: 'safe', label: 'Safe' },
  { id: 1, key: 'shadow', label: 'Cover shadow' },
  { id: 2, key: 'exposed', label: 'Exposed' },
  { id: 3, key: 'crossfire', label: 'Crossfire' },
  { id: 4, key: 'killzone', label: 'Kill zone' },
]);

export const Pattern = Object.freeze({ NONE: 0, CONSTANT: 1, PERIODIC: 2, IRREGULAR: 3 });
export const PATTERN_LABEL = Object.freeze(['None', 'Constant fire', 'Periodic', 'Irregular']);

/**
 * Estimates the period of a sampled signal by autocorrelation.
 * @returns {{ period: number, strength: number }} period in samples (0 if none)
 */
export function estimatePeriod(signal) {
  const n = signal.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (signal[i] - mean) ** 2;
  variance /= n;
  if (variance < 1e-9) return { period: 0, strength: 0 };
  const maxLag = Math.floor(n / 2);
  const r = new Float64Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1 && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (signal[i] - mean) * (signal[i + lag] - mean);
    r[lag] = s / ((n - lag) * variance);
  }
  // Leave the zero-lag lobe, then take the earliest strong local maximum.
  let lag = 1;
  while (lag < maxLag && r[lag] > 0.5) lag++;
  let best = -Infinity;
  for (let k = lag; k <= maxLag; k++) best = Math.max(best, r[k]);
  if (best < 0.3) return { period: 0, strength: Math.max(0, best) };
  for (let k = Math.max(lag, 1); k <= maxLag; k++) {
    if (r[k] >= 0.85 * best && r[k] >= r[k - 1] && r[k] >= r[k + 1]) {
      // Parabolic refinement around the peak for sub-sample precision.
      const a = r[k - 1];
      const b = r[k];
      const c = r[k + 1];
      const denom = a - 2 * b + c;
      const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
      return { period: k + shift, strength: b };
    }
  }
  return { period: 0, strength: best };
}

/**
 * @param {import('./grid.js').Grid} grid
 * @param {import('./threats.js').ThreatModel} model
 * @param {{ killZone?: number, samples?: number }} [opts]
 *   killZone — mean effective dps at which a cell is classed as a kill zone.
 */
export function analyzeThreats(grid, model, { killZone = 18, samples = 240 } = {}) {
  const n = grid.size;
  const zone = new Uint8Array(n);
  const pattern = new Uint8Array(n);
  const period = new Float32Array(n);
  const duty = new Float32Array(n);
  const safeWindow = new Float32Array(n);
  const counts = [0, 0, 0, 0, 0];

  for (let i = 0; i < n; i++) {
    if (!grid.walkable(i)) continue;
    let z;
    if (model.peak[i] <= 0) z = model.shadowCount[i] > 0 ? Zone.SHADOW : Zone.SAFE;
    else if (model.mean[i] >= killZone) z = Zone.KILLZONE;
    else if (model.coverCount[i] >= 2) z = Zone.CROSSFIRE;
    else z = Zone.EXPOSED;
    zone[i] = z;
    counts[z]++;
    if (model.peak[i] > 0) {
      pattern[i] = Pattern.CONSTANT;
      duty[i] = 1;
    }
  }

  // Observe the dynamic part of the field as a black-box signal per cell.
  const dynCells = [];
  for (let i = 0; i < n; i++) if (model.dynamicCover[i] && grid.walkable(i)) dynCells.push(i);
  let window = 0;
  let dt = 0;
  if (dynCells.length) {
    window = Math.min(60, Math.max(8, 2.2 * model.maxPeriod));
    dt = window / samples;
    const sig = new Float32Array(dynCells.length * samples);
    const field = new Float32Array(n);
    for (let s = 0; s < samples; s++) {
      model.fieldAt(s * dt, field);
      for (let k = 0; k < dynCells.length; k++) sig[k * samples + s] = field[dynCells[k]];
    }
    for (let k = 0; k < dynCells.length; k++) {
      const c = dynCells[k];
      const x = sig.subarray(k * samples, (k + 1) * samples);
      let on = 0;
      let run = 0;
      let longest = 0;
      // Longest quiet run, measured over two passes to wrap around the window.
      for (let s = 0; s < 2 * samples; s++) {
        const v = x[s % samples];
        if (s < samples && v > 1e-6) on++;
        if (v <= 1e-6) longest = Math.max(longest, ++run);
        else run = 0;
      }
      const est = estimatePeriod(x);
      // Duty cycle over a whole number of detected periods, so partial cycles don't bias it.
      const span = est.period > 0 ? Math.max(1, Math.floor(samples / est.period)) * est.period : samples;
      const usable = Math.min(samples, Math.round(span));
      let onSpan = 0;
      for (let s = 0; s < usable; s++) if (x[s] > 1e-6) onSpan++;
      duty[c] = usable > 0 ? onSpan / usable : on / samples;
      if (est.period > 0) {
        pattern[c] = Pattern.PERIODIC;
        period[c] = est.period * dt;
        safeWindow[c] = Math.min(longest * dt, period[c]);
      } else {
        pattern[c] = model.staticRate[c] > 0 && duty[c] >= 0.999 ? Pattern.CONSTANT : Pattern.IRREGULAR;
        safeWindow[c] = Math.min(longest, samples) * dt;
      }
    }
  }

  const intel = model.units.map((u) => {
    let peak = 0;
    let meanMax = 0;
    for (let k = 0; k < u.cells.length; k++) {
      peak = Math.max(peak, u.peak[k]);
      meanMax = Math.max(meanMax, u.mean[k]);
    }
    return {
      index: u.index,
      type: u.type,
      label: u.info.label,
      pattern: u.info.pattern,
      coverage: u.cells.length,
      shadowed: u.shadow.length,
      peak,
      mean: meanMax,
      period: u.period,
    };
  });

  return { zone, pattern, period, duty, safeWindow, counts, intel, window, dt, dynamicCells: dynCells.length, killZone };
}

/** Describes one cell for the inspector. */
export function describeCell(grid, model, analysis, cell) {
  return {
    cell,
    x: cell % grid.width,
    y: (cell / grid.width) | 0,
    zone: ZONE_INFO[analysis.zone[cell]],
    mean: model.mean[cell],
    peak: model.peak[cell],
    pattern: PATTERN_LABEL[analysis.pattern[cell]],
    period: analysis.period[cell],
    duty: analysis.duty[cell],
    safeWindow: analysis.safeWindow[cell],
    sources: model.contributions(cell),
  };
}

/**
 * Decides which planner fits the situation around a candidate route.
 * `probe` is a risk-weighted static route (cells) between start and goal.
 */
export function recommendPlanner(grid, model, analysis, probe) {
  if (!probe) return { id: 'astar', reason: 'No route found by the probe search, so falling back to risk-weighted A*.' };
  const near = new Set();
  const w = grid.width;
  for (const c of probe) {
    const x = c % w;
    const y = (c / w) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) if (grid.inBounds(x + dx, y + dy)) near.add((y + dy) * w + x + dx);
    }
  }
  let dynamic = 0;
  let exposure = 0;
  const periods = new Set();
  for (const c of near) {
    if (!grid.walkable(c)) continue;
    if (analysis.pattern[c] === Pattern.PERIODIC || analysis.pattern[c] === Pattern.IRREGULAR) {
      dynamic++;
      if (analysis.period[c] > 0) periods.add(analysis.period[c].toFixed(1));
    }
    exposure += model.mean[c];
  }
  if (dynamic >= 3) {
    const list = [...periods].slice(0, 3).map((p) => `${p} s`).join(', ');
    return {
      id: 'spacetime',
      reason: `Timed attacks overlap the best static route (${dynamic} cells${list ? `, cycles of ${list}` : ''}). Space-Time A* can move through the gaps between strikes.`,
    };
  }
  if (exposure > 0) {
    return { id: 'astar', reason: 'Only constant fire covers the corridor, so risk-weighted A* is optimal and runs fastest.' };
  }
  if (grid.isUniform()) {
    return { id: 'jps', reason: 'No threats or rough terrain near the route. Jump Point Search finds the shortest path with the fewest expansions.' };
  }
  return { id: 'astar', reason: 'The corridor has no threats, but the terrain has varying costs. A* handles weighted terrain optimally.' };
}
