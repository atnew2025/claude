/**
 * Continuous-time replay of a plan against the *true* threat model.
 *
 * A trajectory is a list of keyframes {x, y, t} in continuous grid coordinates
 * (cell centres at +0.5). Keyframes are placed at every cell boundary, so the
 * agent's speed changes exactly where the terrain does. Damage is integrated
 * with a fine midpoint rule, which is how planners are scored fairly: a
 * planner that relies on averaged threat fields will be caught by a laser it
 * did not time correctly.
 */
import { traverse } from './geometry.js';

const centre = (grid, c) => [(c % grid.width) + 0.5, ((c / grid.width) | 0) + 0.5];

/** Keyframes for a polyline through cell centres, moving at terrain speed. */
export function keyframesFromWaypoints(grid, waypoints, t0 = 0) {
  if (!waypoints || !waypoints.length) return [];
  const [sx, sy] = centre(grid, waypoints[0]);
  const frames = [{ x: sx, y: sy, t: t0 }];
  let t = t0;
  for (let k = 1; k < waypoints.length; k++) {
    const [ax, ay] = centre(grid, waypoints[k - 1]);
    const [bx, by] = centre(grid, waypoints[k]);
    const len = Math.hypot(bx - ax, by - ay);
    traverse(ax, ay, bx, by, (cx, cy, u0, u1) => {
      if (u1 <= u0 || !grid.inBounds(cx, cy)) return true;
      t += (u1 - u0) * len * grid.moveCost(cy * grid.width + cx);
      frames.push({ x: ax + (bx - ax) * u1, y: ay + (by - ay) * u1, t });
      return true;
    });
  }
  return frames;
}

/**
 * Keyframes for a timed plan [{cell, t}] (space-time A*, recon runs). A move
 * from a to b crosses the shared boundary at `split` of the step's duration:
 * 'half' (what Space-Time A* assumes) or 'terrain' (proportional to each
 * cell's movement cost).
 */
export function keyframesFromTimeline(grid, timeline, split = 'half') {
  if (!timeline || !timeline.length) return [];
  const frames = [];
  const [x0, y0] = centre(grid, timeline[0].cell);
  frames.push({ x: x0, y: y0, t: timeline[0].t });
  for (let k = 1; k < timeline.length; k++) {
    const a = timeline[k - 1];
    const b = timeline[k];
    const [bx, by] = centre(grid, b.cell);
    if (a.cell !== b.cell) {
      const [ax, ay] = centre(grid, a.cell);
      const ma = grid.moveCost(a.cell);
      const mb = grid.moveCost(b.cell);
      const f = split === 'terrain' ? ma / (ma + mb) : 0.5;
      frames.push({ x: (ax + bx) / 2, y: (ay + by) / 2, t: a.t + (b.t - a.t) * f });
    }
    frames.push({ x: bx, y: by, t: b.t });
  }
  return frames;
}

/** Interpolated position on a trajectory at time t (clamped to its ends). */
export function sampleTrajectory(frames, t) {
  const n = frames.length;
  if (!n) return null;
  if (t <= frames[0].t) return { x: frames[0].x, y: frames[0].y, heading: headingAt(frames, 1), done: false };
  if (t >= frames[n - 1].t) return { x: frames[n - 1].x, y: frames[n - 1].y, heading: headingAt(frames, n - 1), done: true };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, heading: headingAt(frames, hi), done: false };
}

function headingAt(frames, k) {
  for (let j = Math.min(k, frames.length - 1); j > 0; j--) {
    const dx = frames[j].x - frames[j - 1].x;
    const dy = frames[j].y - frames[j - 1].y;
    if (dx || dy) return Math.atan2(dy, dx);
  }
  return 0;
}

/**
 * Integrates true damage along a trajectory.
 * @returns {{ duration, damage, deathTime, curve: Float32Array, dt }}
 *   curve[i] — cumulative damage at time t0 + (i + 1)·dt.
 */
export function simulate(grid, model, frames, { dt = 0.05, hp = 100 } = {}) {
  if (!frames.length) return { duration: 0, damage: 0, deathTime: null, curve: new Float32Array(0), dt };
  const t0 = frames[0].t;
  const duration = frames[frames.length - 1].t - t0;
  const steps = Math.max(1, Math.ceil(duration / dt));
  const h = duration / steps || dt;
  const curve = new Float32Array(steps);
  let damage = 0;
  let deathTime = null;
  for (let s = 0; s < steps; s++) {
    const t = t0 + (s + 0.5) * h;
    const p = sampleTrajectory(frames, t);
    const cx = Math.min(grid.width - 1, Math.max(0, Math.floor(p.x)));
    const cy = Math.min(grid.height - 1, Math.max(0, Math.floor(p.y)));
    if (model) damage += model.rateAt(cy * grid.width + cx, t) * h;
    curve[s] = damage;
    if (deathTime === null && damage >= hp) deathTime = t0 + (s + 1) * h;
  }
  return { duration, damage, deathTime, curve, dt: h };
}

/** Path length in cells along consecutive waypoints. */
export function polylineLength(grid, waypoints) {
  let len = 0;
  for (let k = 1; k < (waypoints?.length ?? 0); k++) len += grid.euclidean(waypoints[k - 1], waypoints[k]);
  return len;
}

/** Keyframes for any planner result. */
export function trajectoryOf(grid, res) {
  if (!res?.found) return [];
  if (res.extra?.timeline) return keyframesFromTimeline(grid, res.extra.timeline, res.extra.split ?? 'half');
  return keyframesFromWaypoints(grid, res.waypoints);
}
