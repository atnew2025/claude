/**
 * Exact grid traversal (Amanatides & Woo) used for line of sight, any-angle
 * segment costs and continuous-path simulation.
 */

const EPS = 1e-9;

/**
 * Visits every cell a segment passes through, in order.
 *
 * `visit(cx, cy, t0, t1)` receives the cell and the parametric interval
 * [t0, t1] ⊆ [0, 1] the segment spends inside it. When the segment passes
 * exactly through a cell corner, the two cells touching that corner are also
 * visited with a zero-length interval so callers can treat a diagonal squeeze
 * between walls as blocked. Returning `false` from `visit` stops the walk.
 *
 * @returns {boolean} false if the walk was stopped early, true otherwise.
 */
export function traverse(x0, y0, x1, y1, visit) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepX > 0 ? (cx + 1 - x0) / dx : stepX < 0 ? (cx - x0) / dx : Infinity;
  let tMaxY = stepY > 0 ? (cy + 1 - y0) / dy : stepY < 0 ? (cy - y0) / dy : Infinity;
  let t = 0;
  const limit = Math.abs(ex - cx) + Math.abs(ey - cy) + 2;
  for (let n = 0; n <= limit; n++) {
    if (cx === ex && cy === ey) return visit(cx, cy, t, 1) !== false;
    const diff = tMaxX - tMaxY;
    if (Math.abs(diff) < EPS) {
      const tn = Math.min(1, tMaxX);
      if (visit(cx, cy, t, tn) === false) return false;
      if (visit(cx + stepX, cy, tn, tn) === false) return false;
      if (visit(cx, cy + stepY, tn, tn) === false) return false;
      cx += stepX;
      cy += stepY;
      t = tn;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (diff < 0) {
      const tn = Math.min(1, tMaxX);
      if (visit(cx, cy, t, tn) === false) return false;
      cx += stepX;
      t = tn;
      tMaxX += tDeltaX;
    } else {
      const tn = Math.min(1, tMaxY);
      if (visit(cx, cy, t, tn) === false) return false;
      cy += stepY;
      t = tn;
      tMaxY += tDeltaY;
    }
  }
  return true;
}

/**
 * Line of sight between the centres of two cells. Intermediate cells (not the
 * endpoints) must not block sight; corner grazes count as blocked if either
 * touching cell blocks.
 */
export function hasLineOfSight(grid, a, b) {
  const w = grid.width;
  const ax = a % w;
  const ay = (a / w) | 0;
  const bx = b % w;
  const by = (b / w) | 0;
  return traverse(ax + 0.5, ay + 0.5, bx + 0.5, by + 0.5, (cx, cy) => {
    if ((cx === ax && cy === ay) || (cx === bx && cy === by)) return true;
    return !grid.blocksSight(cx, cy);
  });
}

/**
 * Integral of a per-cell density along the straight segment between two cell
 * centres: Σ (length inside cell) × density[cell]. Returns Infinity when the
 * segment crosses a non-walkable cell or squeezes diagonally past one.
 * For adjacent cells this equals len × (d[a] + d[b]) / 2, so any-angle and
 * grid costs agree exactly.
 */
export function segmentIntegral(grid, density, a, b) {
  const w = grid.width;
  const ax = (a % w) + 0.5;
  const ay = ((a / w) | 0) + 0.5;
  const bx = (b % w) + 0.5;
  const by = ((b / w) | 0) + 0.5;
  const len = Math.hypot(bx - ax, by - ay);
  let sum = 0;
  const ok = traverse(ax, ay, bx, by, (cx, cy, t0, t1) => {
    if (!grid.open(cx, cy)) return false;
    if (t1 > t0) sum += (t1 - t0) * len * density[cy * w + cx];
    return true;
  });
  return ok ? sum : Infinity;
}

/** Walkable straight-line visibility between two cell centres (no corner squeezing). */
export function walkableLine(grid, a, b) {
  const w = grid.width;
  return traverse((a % w) + 0.5, ((a / w) | 0) + 0.5, (b % w) + 0.5, ((b / w) | 0) + 0.5, (cx, cy) =>
    grid.open(cx, cy),
  );
}

/** Smallest signed difference between two angles in degrees, in (-180, 180]. */
export function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}
