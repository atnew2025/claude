import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid, Terrain } from '../src/core/grid.js';
import { ThreatModel } from '../src/core/threats.js';
import { analyzeThreats, estimatePeriod, Zone, Pattern, recommendPlanner } from '../src/core/recognition.js';
import { spaceTimeAStar } from '../src/core/algorithms/spacetime.js';
import { astar } from '../src/core/algorithms/bestfirst.js';
import { buildDensity } from '../src/core/cost.js';
import { makeProblem, runPlanner, riskSweep, PLANNERS } from '../src/core/planners.js';
import { simulate, keyframesFromWaypoints, sampleTrajectory } from '../src/core/simulate.js';
import { reconRun } from '../src/core/recon.js';
import { SCENARIOS, loadScenario } from '../src/core/maps.js';

test('turret fire is blocked by walls and reduced by brush', () => {
  const g = new Grid(15, 9);
  g.set(6, 4, Terrain.WALL);
  g.set(4, 2, Terrain.BRUSH);
  const model = new ThreatModel(g, [{ type: 'turret', x: 4, y: 4, range: 6, dps: 10 }]);
  assert.equal(model.mean[g.index(8, 4)], 0, 'behind the wall');
  assert.ok(model.shadowCount[g.index(8, 4)] > 0, 'recognised as a cover shadow');
  assert.ok(model.mean[g.index(4, 6)] > 0);
  assert.ok(Math.abs(model.mean[g.index(4, 2)] / model.mean[g.index(4, 6)] - 0.35) < 1e-6, 'brush exposure');
  assert.equal(model.mean[g.index(13, 4)], 0, 'out of range');
});

test('sniper only covers its cone', () => {
  const g = new Grid(30, 15);
  const model = new ThreatModel(g, [{ type: 'sniper', x: 2, y: 7, facing: 0, fov: 20, range: 25 }]);
  assert.ok(model.mean[g.index(20, 7)] > 0);
  assert.equal(model.mean[g.index(20, 1)], 0);
  assert.equal(model.mean[g.index(1, 7)], 0, 'behind the sniper');
});

test('laser mean equals the time average of the true field', () => {
  const g = new Grid(21, 21);
  const model = new ThreatModel(g, [{ type: 'laser', x: 10, y: 10, range: 9, period: 4, arms: 2, width: 14 }]);
  const n = 4000;
  const acc = new Float64Array(g.size);
  const f = new Float32Array(g.size);
  for (let s = 0; s < n; s++) {
    model.fieldAt((s / n) * 4, f);
    for (let i = 0; i < g.size; i++) acc[i] += f[i] / n;
  }
  for (const [x, y] of [[15, 10], [10, 3], [4, 6], [17, 14]]) {
    const i = g.index(x, y);
    assert.ok(Math.abs(acc[i] - model.mean[i]) < 0.02 * model.peak[i] + 1e-6, `(${x},${y}) ${acc[i]} vs ${model.mean[i]}`);
  }
});

test('autocorrelation recovers attack periods', () => {
  const dt = 0.1;
  const pulse = Float32Array.from({ length: 240 }, (_, i) => ((i * dt) % 3.7 < 0.6 ? 1 : 0));
  assert.ok(Math.abs(estimatePeriod(pulse).period * dt - 3.7) < 0.12);
  assert.equal(estimatePeriod(new Float32Array(100).fill(2)).period, 0);

  const g = new Grid(25, 25);
  const model = new ThreatModel(g, [
    { type: 'laser', x: 6, y: 6, range: 5, period: 6, arms: 1 },
    { type: 'mortar', x: 18, y: 18, radius: 2.5, period: 4, active: 1 },
    { type: 'turret', x: 18, y: 4, range: 4 },
  ]);
  const a = analyzeThreats(g, model);
  const laserCell = g.index(9, 6);
  const mortarCell = g.index(18, 18);
  const turretCell = g.index(18, 6);
  assert.equal(a.pattern[laserCell], Pattern.PERIODIC);
  assert.ok(Math.abs(a.period[laserCell] - 6) < 0.25, `laser period ${a.period[laserCell]}`);
  assert.equal(a.pattern[mortarCell], Pattern.PERIODIC);
  assert.ok(Math.abs(a.period[mortarCell] - 4) < 0.2, `mortar period ${a.period[mortarCell]}`);
  assert.ok(Math.abs(a.duty[mortarCell] - 0.25) < 0.03);
  assert.ok(a.safeWindow[mortarCell] > 2.7 && a.safeWindow[mortarCell] < 3.2);
  assert.equal(a.pattern[turretCell], Pattern.CONSTANT);
  assert.equal(a.pattern[g.index(0, 24)], Pattern.NONE);
});

test('zones: crossfire, kill zone, shadow and safe', () => {
  const g = new Grid(30, 12);
  g.set(15, 2, Terrain.WALL);
  const model = new ThreatModel(g, [
    { type: 'turret', x: 10, y: 6, range: 7, dps: 10 },
    { type: 'turret', x: 16, y: 6, range: 7, dps: 10 },
    { type: 'turret', x: 26, y: 6, range: 3, dps: 60 },
    { type: 'turret', x: 15, y: 0, range: 4, dps: 5 },
  ]);
  const a = analyzeThreats(g, model, { killZone: 18 });
  assert.equal(a.zone[g.index(13, 6)], Zone.CROSSFIRE);
  assert.equal(a.zone[g.index(26, 7)], Zone.KILLZONE);
  assert.equal(a.zone[g.index(4, 6)], Zone.EXPOSED);
  assert.equal(a.zone[g.index(0, 0)], Zone.SAFE);
  assert.equal(a.zone[g.index(15, 3)] === Zone.SHADOW || model.coverCount[g.index(15, 3)] > 0, true);
});

test('simulation integrates damage exactly on constant fields', () => {
  const g = new Grid(12, 3);
  const model = new ThreatModel(g, [{ type: 'mortar', x: 6, y: 1, radius: 30, dps: 10, period: 1, active: 1 }]);
  const frames = keyframesFromWaypoints(g, [g.index(0, 1), g.index(11, 1)]);
  assert.ok(Math.abs(frames[frames.length - 1].t - 11) < 1e-9);
  const p = sampleTrajectory(frames, 5.5);
  assert.ok(Math.abs(p.x - 6) < 1e-9 && Math.abs(p.y - 1.5) < 1e-9);
  const sim = simulate(g, null, frames);
  assert.equal(sim.damage, 0);
  // Constant 10·(1 − 0.4·d/30) dps along the row, integrated by the midpoint rule.
  const s2 = simulate(g, model, frames, { dt: 0.01 });
  let exact = 0;
  for (let x = 0; x <= 11; x++) exact += (x === 0 || x === 11 ? 0.5 : 1) * 10 * (1 - (0.4 * Math.hypot(x - 6, 0)) / 30);
  assert.ok(Math.abs(s2.damage - exact) < 0.05);
});

test('space-time A* times a rotating laser better than static A*', () => {
  const sc = loadScenario('gallery');
  const model = new ThreatModel(sc.grid, sc.attackers);
  const problem = makeProblem({ grid: sc.grid, model, start: sc.grid.index(...sc.start), goal: sc.grid.index(...sc.goal), riskWeight: 1, trace: false });
  const st = runPlanner('spacetime', problem);
  const as = runPlanner('astar', problem);
  assert.ok(st.res.found && as.res.found);
  assert.ok(st.metrics.damage < as.metrics.damage * 0.5, `damage ${st.metrics.damage} vs ${as.metrics.damage}`);
  assert.ok(st.metrics.objective < as.metrics.objective);
  // The plan's own estimate is conservative: replaying it never costs more than planned.
  assert.ok(st.metrics.objective <= st.res.cost + 1e-6);
  // Timeline is monotone and every move is a legal step.
  const tl = st.res.extra.timeline;
  for (let k = 1; k < tl.length; k++) {
    assert.ok(tl[k].t > tl[k - 1].t);
    if (tl[k].cell !== tl[k - 1].cell) assert.ok(sc.grid.octile(tl[k].cell, tl[k - 1].cell) < 1.5);
  }
});

test('space-time A* matches static A* when nothing moves', () => {
  const g = new Grid(30, 20);
  for (let y = 3; y < 17; y++) g.set(15, y, Terrain.WALL);
  const model = new ThreatModel(g, [{ type: 'turret', x: 8, y: 10, range: 6, dps: 12 }]);
  const start = g.index(1, 10);
  const goal = g.index(28, 10);
  const density = buildDensity(g, model, { riskWeight: 1 });
  const a = astar({ grid: g, density, start, goal, trace: false });
  const st = spaceTimeAStar({ grid: g, model, start, goal, riskWeight: 1, trace: false });
  assert.ok(Math.abs(a.cost - st.cost) < 1e-6, `${a.cost} vs ${st.cost}`);
});

test('fog-of-war recon detects attackers and replans incrementally', () => {
  const sc = loadScenario('citadel');
  const model = new ThreatModel(sc.grid, sc.attackers);
  const run = reconRun({ grid: sc.grid, model, start: sc.grid.index(...sc.start), goal: sc.grid.index(...sc.goal), riskWeight: 1 });
  assert.ok(run.found);
  assert.ok(run.replans >= 2, `replans ${run.replans}`);
  assert.ok(run.known.length >= 3);
  for (const e of run.events.filter((x) => x.type === 'detect')) {
    // Every repaired plan is optimal for what the agent knows at that moment.
    assert.ok(Math.abs(e.cost - e.scratchCost) < 1e-6 * e.scratchCost, `repair ${e.cost} vs fresh ${e.scratchCost}`);
    assert.equal(e.path[0], e.cell);
  }
  const tl = run.timeline;
  assert.equal(tl[tl.length - 1].cell, sc.grid.index(...sc.goal));
});

test('risk sweep yields a Pareto front trading time for damage', () => {
  const sc = loadScenario('plaza');
  const model = new ThreatModel(sc.grid, sc.attackers);
  const problem = makeProblem({ grid: sc.grid, model, start: sc.grid.index(...sc.start), goal: sc.grid.index(...sc.goal), trace: false });
  const pts = riskSweep(problem);
  const front = pts.filter((p) => p.pareto).sort((a, b) => a.time - b.time);
  assert.ok(front.length >= 2);
  for (let k = 1; k < front.length; k++) assert.ok(front[k].damage <= front[k - 1].damage);
});

test('every planner solves every built-in scenario', () => {
  for (const s of SCENARIOS) {
    const sc = loadScenario(s.id, 3);
    const model = new ThreatModel(sc.grid, sc.attackers);
    const analysis = analyzeThreats(sc.grid, model);
    const problem = makeProblem({ grid: sc.grid, model, analysis, start: sc.grid.index(...sc.start), goal: sc.grid.index(...sc.goal), trace: false });
    for (const p of PLANNERS) {
      const run = runPlanner(p.id, problem);
      assert.ok(run.res.found, `${p.id} on ${s.id}`);
      assert.ok(run.metrics.time > 0);
    }
    const probe = astar({ ...problem, trace: false });
    const rec = recommendPlanner(sc.grid, model, analysis, probe.path);
    assert.ok(PLANNERS.some((p) => p.id === rec.id));
  }
});
