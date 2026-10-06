/**
 * Shared plumbing for planners: search traces for visualisation, heuristics
 * and result construction.
 */
import { minDensity } from '../cost.js';

/** Trace event kinds. Events are packed as `cell * 8 + kind`. */
export const TraceKind = Object.freeze({
  OPEN: 1, // added to / improved in the forward frontier
  CLOSE: 2, // expanded by the forward search
  OPEN_B: 3, // backward frontier (bidirectional)
  CLOSE_B: 4, // expanded by the backward search
  SCAN: 5, // cell touched while jumping (JPS) or checked for line of sight
  JUMP: 6, // jump point / waypoint discovered
  WAVE: 7, // settled by a goal-rooted wave (flow fields, D* Lite)
});

export class Trace {
  constructor() {
    this.events = [];
  }

  push(cell, kind) {
    this.events.push(cell * 8 + kind);
  }

  get length() {
    return this.events.length;
  }
}

export const decodeEvent = (e) => [Math.floor(e / 8), e % 8];

/** Returns h(i) — a distance lower bound to `goal` scaled by the cheapest density. */
export function makeHeuristic(grid, goal, { diagonal = true, density = null, kind } = {}) {
  const scale = density ? minDensity(density) : 1;
  const w = grid.width;
  const gx = goal % w;
  const gy = (goal / w) | 0;
  const metric = kind ?? (diagonal ? 'octile' : 'manhattan');
  if (metric === 'euclidean') {
    return (i) => scale * Math.hypot((i % w) - gx, ((i / w) | 0) - gy);
  }
  if (metric === 'manhattan') {
    return (i) => scale * (Math.abs((i % w) - gx) + Math.abs(((i / w) | 0) - gy));
  }
  const k = Math.SQRT2 - 1;
  return (i) => {
    const dx = Math.abs((i % w) - gx);
    const dy = Math.abs(((i / w) | 0) - gy);
    return scale * (dx > dy ? dx + k * dy : dy + k * dx);
  };
}

/** Walks parent pointers back from `goal`. Returns null when unreachable. */
export function reconstruct(parent, start, goal) {
  if (goal !== start && parent[goal] === -1) return null;
  const path = [goal];
  let c = goal;
  while (c !== start) {
    c = parent[c];
    path.push(c);
    if (path.length > parent.length) return null;
  }
  return path.reverse();
}

/**
 * @typedef {Object} SearchResult
 * @property {number[]|null} path     cells visited in order (dense, adjacent steps)
 * @property {number[]|null} waypoints corner cells for any-angle paths (else = path)
 * @property {number} cost            planner's own objective value
 * @property {number} expanded        nodes expanded
 * @property {number} generated       nodes pushed / improved
 * @property {Trace|null} trace
 * @property {object} [extra]         planner-specific data (timeline, waits, field…)
 */
export function result({ path = null, waypoints = null, cost = Infinity, expanded = 0, generated = 0, trace = null, extra = {} }) {
  return { path, waypoints: waypoints ?? path, cost: path ? cost : Infinity, expanded, generated, trace, extra, found: !!path };
}

/** Expands consecutive waypoints (straight or diagonal runs) into a dense cell path. */
export function densify(grid, waypoints) {
  if (!waypoints || waypoints.length === 0) return waypoints;
  const w = grid.width;
  const out = [waypoints[0]];
  for (let k = 1; k < waypoints.length; k++) {
    let x = out[out.length - 1] % w;
    let y = (out[out.length - 1] / w) | 0;
    const tx = waypoints[k] % w;
    const ty = (waypoints[k] / w) | 0;
    while (x !== tx || y !== ty) {
      x += Math.sign(tx - x);
      y += Math.sign(ty - y);
      out.push(y * w + x);
    }
  }
  return out;
}
