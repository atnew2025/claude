/**
 * Fog-of-war reconnaissance. The agent knows the terrain but not the enemy:
 * attackers are recognised when they come within sensor range or open fire on
 * the agent. Each detection raises the cost of the cells that attacker covers
 * and D* Lite repairs the plan incrementally. For comparison, the work a full
 * A* replan would have needed at every detection is measured too. Repairs win
 * when changes are local; a newly recognised attacker that covers a large area
 * can invalidate much of the search tree, and then a fresh search is cheaper.
 */
import { DStarLite } from './algorithms/dstarlite.js';
import { bestFirst } from './algorithms/bestfirst.js';
import { buildDensity } from './cost.js';

function anchors(unit) {
  const s = unit.spec;
  return s.type === 'patrol' ? s.route : [[s.x, s.y]];
}

/**
 * @returns {{
 *   found: boolean, timeline: {cell:number,t:number}[], events: object[],
 *   expanded: number, scratchExpanded: number, replans: number, knownRate: Float32Array
 * }}
 */
export function reconRun({ grid, model, start, goal, diagonal = true, riskWeight = 1, sensorRange = 6, maxSteps = 4000, compare = true }) {
  const n = grid.size;
  const w = grid.width;
  const base = buildDensity(grid, null, { riskMode: 'none' });
  const knownRate = new Float32Array(n);
  const known = new Set();
  const density = () => {
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = base[i] * (1 + riskWeight * knownRate[i]);
    return d;
  };

  /** Attackers recognised from `cell`: in sensor range, or currently able to hit the agent. */
  function detect(cell) {
    const x = (cell % w) + 0.5;
    const y = ((cell / w) | 0) + 0.5;
    const found = [];
    for (const u of model.units) {
      if (known.has(u.index)) continue;
      const seen = anchors(u).some(([ax, ay]) => Math.hypot(ax + 0.5 - x, ay + 0.5 - y) <= sensorRange);
      const firing = u.slot[cell] !== -1 && u.peak[u.slot[cell]] > 0;
      if (seen || firing) found.push(u.index);
    }
    return found;
  }

  function learn(units) {
    const changed = new Set();
    for (const i of units) {
      known.add(i);
      const u = model.units[i];
      for (let k = 0; k < u.cells.length; k++) {
        knownRate[u.cells[k]] += u.mean[k];
        changed.add(u.cells[k]);
      }
    }
    return changed;
  }

  const events = [];
  const initial = detect(start);
  learn(initial);
  const planner = new DStarLite(grid, density(), start, goal, { diagonal, trace: true });
  let expanded = planner.computeShortestPath();
  let scratchExpanded = expanded;
  events.push({ type: 'plan', t: 0, cell: start, units: initial, expanded, scratch: expanded, path: planner.path(), traceEnd: planner.trace.length });

  const timeline = [{ cell: start, t: 0 }];
  let cur = start;
  let t = 0;
  let replans = 0;
  for (let step = 0; cur !== goal && step < maxSteps; step++) {
    const next = planner.next(cur);
    if (next === -1) {
      events.push({ type: 'stuck', t, cell: cur });
      break;
    }
    const len = grid.stepLength(cur, next);
    t += len * 0.5 * (grid.moveCost(cur) + grid.moveCost(next));
    cur = next;
    timeline.push({ cell: cur, t });
    planner.moveTo(cur);
    const spotted = detect(cur);
    if (!spotted.length) continue;
    const changed = learn(spotted);
    const d = density();
    const traceStart = planner.trace.length;
    planner.updateCosts([...changed].map((c) => [c, d[c]]));
    const exp = planner.computeShortestPath();
    expanded += exp;
    let scratch = 0;
    let scratchCost = NaN;
    if (compare) {
      const fresh = bestFirst({ grid, density: d, start: cur, goal, diagonal, trace: false });
      scratch = fresh.expanded;
      scratchCost = fresh.cost;
      scratchExpanded += scratch;
    }
    replans++;
    events.push({
      type: 'detect',
      t,
      cell: cur,
      units: spotted,
      expanded: exp,
      scratch,
      cost: planner.distance,
      scratchCost,
      path: planner.path(),
      traceStart,
      traceEnd: planner.trace.length,
    });
  }
  return {
    found: cur === goal,
    timeline,
    events,
    expanded,
    scratchExpanded,
    replans,
    known: [...known],
    knownRate,
    trace: planner.trace,
  };
}
