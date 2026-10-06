/**
 * Planner registry, a single entry point to run any of them on a scenario,
 * and the metrics used to compare them.
 */
import { bfs, dijkstra, greedy, astar, weightedAstar, bidirectionalAstar, bestFirst } from './algorithms/bestfirst.js';
import { jps } from './algorithms/jps.js';
import { thetaStar } from './algorithms/thetastar.js';
import { spaceTimeAStar } from './algorithms/spacetime.js';
import { flowField } from './algorithms/flowfield.js';
import { DStarLite } from './algorithms/dstarlite.js';
import { result } from './algorithms/common.js';
import { buildDensity, RiskMode } from './cost.js';
import { recommendPlanner } from './recognition.js';
import { simulate, trajectoryOf, polylineLength } from './simulate.js';

function dstarLite(p) {
  const planner = new DStarLite(p.grid, p.density, p.start, p.goal, { diagonal: p.diagonal, trace: p.trace !== false });
  const expanded = planner.computeShortestPath();
  const path = planner.path();
  return result({ path, cost: planner.distance, expanded, generated: expanded, trace: planner.trace });
}

function adaptive(p) {
  const probe = bestFirst({ ...p, trace: false });
  const decision = p.analysis
    ? recommendPlanner(p.grid, p.model, p.analysis, probe.path)
    : { id: 'astar', reason: 'No threat analysis available.' };
  const chosen = PLANNERS.find((x) => x.id === decision.id);
  const res = chosen.run(p);
  res.extra = { ...res.extra, decision: { ...decision, name: chosen.name } };
  return res;
}

/**
 * aware: which inputs the planner takes into account.
 * optimal: guarantee on the objective (time + λ·damage under its own model).
 */
export const PLANNERS = [
  {
    id: 'auto',
    name: 'Adaptive',
    family: 'Meta',
    optimal: 'Inherits',
    aware: { terrain: true, threat: true, timing: true },
    blurb: 'Reads the recognised threat picture along the corridor and dispatches the best-suited planner.',
    run: adaptive,
  },
  {
    id: 'spacetime',
    name: 'Space-Time A*',
    family: 'Temporal',
    optimal: 'Optimal in (cell, time)',
    aware: { terrain: true, threat: true, timing: true },
    blurb: 'Plans in cell × time with a hold action, so it can slip past rotating beams and between mortar cycles.',
    run: spaceTimeAStar,
  },
  {
    id: 'astar',
    name: 'Threat-aware A*',
    family: 'Heuristic',
    optimal: 'Optimal',
    aware: { terrain: true, threat: true, timing: false },
    blurb: 'Minimises travel time + λ·expected damage with an admissible octile heuristic.',
    run: astar,
  },
  {
    id: 'theta',
    name: 'Theta*',
    family: 'Any-angle',
    optimal: 'Near-optimal',
    aware: { terrain: true, threat: true, timing: false },
    blurb: 'Any-angle paths: shortcuts by line of sight, priced by the exact line integral through the threat field.',
    run: thetaStar,
  },
  {
    id: 'bidir',
    name: 'Bidirectional A*',
    family: 'Heuristic',
    optimal: 'Optimal',
    aware: { terrain: true, threat: true, timing: false },
    blurb: 'Two frontiers grow from start and goal and stop once neither can beat the best meeting point.',
    run: bidirectionalAstar,
  },
  {
    id: 'wastar',
    name: 'Weighted A*',
    family: 'Heuristic',
    optimal: '≤ w × optimal',
    aware: { terrain: true, threat: true, timing: false },
    blurb: 'Inflates the heuristic by w to trade a bounded amount of quality for far fewer expansions.',
    run: weightedAstar,
  },
  {
    id: 'dstar',
    name: 'D* Lite',
    family: 'Incremental',
    optimal: 'Optimal',
    aware: { terrain: true, threat: true, timing: false },
    blurb: 'Searches back from the goal and repairs only what changed when new threats are recognised. Run Recon to see it replan.',
    run: dstarLite,
  },
  {
    id: 'dijkstra',
    name: 'Dijkstra',
    family: 'Uninformed',
    optimal: 'Optimal',
    aware: { terrain: true, threat: true, timing: false },
    blurb: 'Uniform-cost search with no heuristic. Optimal, but floods in every direction.',
    run: dijkstra,
  },
  {
    id: 'flow',
    name: 'Flow Field',
    family: 'Swarm',
    optimal: 'Optimal (all cells)',
    aware: { terrain: true, threat: true, timing: false },
    blurb: 'One Dijkstra wave from the goal gives every cell its best next step, so any number of agents can follow it.',
    run: flowField,
  },
  {
    id: 'jps',
    name: 'Jump Point Search',
    family: 'Geometric',
    optimal: 'Shortest distance',
    aware: { terrain: false, threat: false, timing: false },
    blurb: 'Prunes symmetric paths by jumping along straight lines. Very fast, but blind to terrain and threats.',
    run: jps,
  },
  {
    id: 'greedy',
    name: 'Greedy Best-First',
    family: 'Heuristic',
    optimal: 'None',
    aware: { terrain: false, threat: false, timing: false },
    blurb: 'Always expands the cell that looks closest to the goal. Quick, but it ignores accumulated cost.',
    run: greedy,
  },
  {
    id: 'bfs',
    name: 'Breadth-First',
    family: 'Uninformed',
    optimal: 'Fewest steps',
    aware: { terrain: false, threat: false, timing: false },
    blurb: 'Expands the grid ring by ring and minimises the number of steps, not time or risk.',
    run: bfs,
  },
];

export const plannerById = (id) => PLANNERS.find((p) => p.id === id);

/**
 * Builds a planning problem from a scenario state.
 * @param {object} s { grid, model, analysis, start, goal, riskWeight, riskMode, diagonal, weight }
 */
export function makeProblem(s) {
  const riskWeight = s.riskWeight ?? 1;
  const riskMode = s.riskMode ?? RiskMode.MEAN;
  return {
    grid: s.grid,
    model: s.model,
    analysis: s.analysis,
    start: s.start,
    goal: s.goal,
    diagonal: s.diagonal ?? true,
    weight: s.weight ?? 1.8,
    riskWeight,
    riskMode,
    density: s.density ?? buildDensity(s.grid, s.model, { riskWeight, riskMode }),
    trace: s.trace ?? true,
  };
}

/** Runs one planner and scores the result against the true threat model. */
export function runPlanner(id, problem, { hp = 100 } = {}) {
  const planner = plannerById(id);
  if (!planner) throw new Error(`Unknown planner: ${id}`);
  const t0 = performance.now();
  const res = planner.run(problem);
  const ms = performance.now() - t0;
  return { id, planner, res, metrics: evaluate(problem, res, { hp, ms }) };
}

export function evaluate(problem, res, { hp = 100, ms = 0 } = {}) {
  const { grid, model, riskWeight } = problem;
  if (!res.found) {
    return { found: false, ms, expanded: res.expanded, generated: res.generated, reason: res.extra?.reason };
  }
  const frames = trajectoryOf(grid, res);
  const sim = simulate(grid, model, frames, { hp });
  return {
    found: true,
    ms,
    expanded: res.expanded,
    generated: res.generated,
    distance: polylineLength(grid, res.waypoints),
    steps: res.path.length - 1,
    time: sim.duration,
    damage: sim.damage,
    survived: sim.damage < hp,
    deathTime: sim.deathTime,
    objective: sim.duration + riskWeight * sim.damage,
    curve: sim.curve,
    curveDt: sim.dt,
    frames,
  };
}

/**
 * Risk sweep: runs a planner for a range of risk weights and marks the
 * Pareto-optimal (time, damage) trade-offs.
 */
export function riskSweep(problem, { lambdas = [0, 0.05, 0.15, 0.3, 0.6, 1, 2, 4, 8, 20], planner = 'astar', hp = 100 } = {}) {
  const points = [];
  const seen = new Map();
  for (const lambda of lambdas) {
    const p = {
      ...problem,
      riskWeight: lambda,
      density: buildDensity(problem.grid, problem.model, { riskWeight: lambda, riskMode: problem.riskMode }),
      trace: false,
    };
    const run = runPlanner(planner, p, { hp });
    if (!run.res.found) continue;
    const key = run.res.path.join(',');
    if (seen.has(key)) {
      seen.get(key).lambdas.push(lambda);
      continue;
    }
    const point = { lambda, lambdas: [lambda], path: run.res.path, waypoints: run.res.waypoints, ...pick(run.metrics) };
    seen.set(key, point);
    points.push(point);
  }
  for (const a of points) {
    a.pareto = !points.some((b) => b !== a && b.time <= a.time && b.damage <= a.damage && (b.time < a.time || b.damage < a.damage));
  }
  return points;
}

const pick = (m) => ({ time: m.time, damage: m.damage, distance: m.distance, survived: m.survived, frames: m.frames });
