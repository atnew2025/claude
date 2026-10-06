import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid } from '../src/core/grid.js';
import { buildDensity, pathCost, timeDensity } from '../src/core/cost.js';
import { bfs, dijkstra, greedy, astar, weightedAstar, bidirectionalAstar } from '../src/core/algorithms/bestfirst.js';
import { jps } from '../src/core/algorithms/jps.js';
import { thetaStar } from '../src/core/algorithms/thetastar.js';
import { DStarLite } from '../src/core/algorithms/dstarlite.js';
import { flowField, buildFlowField } from '../src/core/algorithms/flowfield.js';
import { walkableLine, segmentIntegral } from '../src/core/geometry.js';
import { mulberry32 } from '../src/core/maps.js';
import { randomGrid, referenceDistances, close, validPath } from './helpers.js';

/** Random density with "threat" hot spots on top of terrain. */
function threatDensity(grid, seed) {
  const rng = mulberry32(seed);
  const rate = new Float32Array(grid.size);
  for (let k = 0; k < 4; k++) {
    const cx = rng() * grid.width;
    const cy = rng() * grid.height;
    const r = 2 + rng() * 5;
    const dps = 5 + rng() * 20;
    for (let i = 0; i < grid.size; i++) {
      const d = Math.hypot(grid.xOf(i) - cx, grid.yOf(i) - cy);
      if (d < r) rate[i] += dps * (1 - d / r);
    }
  }
  return buildDensity(grid, null, { riskWeight: 0.7, rate });
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 100);

test('optimal planners agree with a reference Dijkstra on random weighted grids', () => {
  for (const seed of SEEDS) {
    const { grid, start, goal } = randomGrid(seed);
    const density = threatDensity(grid, seed);
    const ref = referenceDistances(grid, density, start)[goal];
    const p = { grid, density, start, goal, trace: false };
    for (const [name, fn] of [['dijkstra', dijkstra], ['astar', astar], ['bidirectional', bidirectionalAstar], ['flow', flowField]]) {
      const r = fn(p);
      if (!Number.isFinite(ref)) {
        assert.equal(r.found, false, `${name} seed ${seed} should fail`);
        continue;
      }
      assert.ok(r.found, `${name} seed ${seed} found`);
      assert.ok(close(r.cost, ref), `${name} seed ${seed}: ${r.cost} vs ${ref}`);
      assert.ok(validPath(grid, r.path, start, goal), `${name} seed ${seed} path valid`);
      assert.ok(close(pathCost(grid, density, r.path), r.cost), `${name} seed ${seed} path cost`);
    }
  }
});

test('optimality also holds with 4-connectivity', () => {
  for (const seed of SEEDS.slice(0, 15)) {
    const { grid, start, goal } = randomGrid(seed, 20, 14, { walls: 0.2 });
    const density = threatDensity(grid, seed);
    const ref = referenceDistances(grid, density, start, false)[goal];
    for (const fn of [astar, bidirectionalAstar, dijkstra]) {
      const r = fn({ grid, density, start, goal, diagonal: false, trace: false });
      if (Number.isFinite(ref)) assert.ok(close(r.cost, ref));
      else assert.equal(r.found, false);
    }
  }
});

test('weighted A* stays within its bound; greedy and BFS return valid paths', () => {
  for (const seed of SEEDS) {
    const { grid, start, goal } = randomGrid(seed);
    const density = threatDensity(grid, seed);
    const ref = referenceDistances(grid, density, start)[goal];
    if (!Number.isFinite(ref)) continue;
    const w = weightedAstar({ grid, density, start, goal, weight: 2, trace: false });
    assert.ok(w.cost <= 2 * ref + 1e-9, `seed ${seed}: ${w.cost} > 2 × ${ref}`);
    for (const fn of [greedy, bfs]) {
      const r = fn({ grid, density, start, goal, trace: false });
      assert.ok(validPath(grid, r.path, start, goal));
    }
    const b = bfs({ grid, density, start, goal, trace: false });
    const unit = referenceDistances(grid, new Float64Array(grid.size).fill(1).map((v, i) => (grid.walkable(i) ? 1 : Infinity)), start);
    // BFS minimises steps; with unit densities each step costs 1 or √2, so steps ≤ any other path's steps.
    assert.ok(b.path.length - 1 <= Math.ceil(unit[goal]));
  }
});

test('jump point search returns shortest geometric paths', () => {
  for (const seed of SEEDS) {
    const { grid, start, goal } = randomGrid(seed, 30, 20, { walls: 0.3, rough: 0 });
    const uniform = timeDensity(grid);
    const ref = referenceDistances(grid, uniform, start)[goal];
    const r = jps({ grid, start, goal, trace: false });
    if (!Number.isFinite(ref)) {
      assert.equal(r.found, false);
      continue;
    }
    assert.ok(close(r.cost, ref), `seed ${seed}: jps ${r.cost} vs ${ref}`);
    assert.ok(validPath(grid, r.path, start, goal), `seed ${seed}: jps path valid`);
    assert.ok(close(pathCost(grid, uniform, r.path), ref));
  }
});

test('theta* produces walkable any-angle paths no costlier than grid paths', () => {
  for (const seed of SEEDS) {
    const { grid, start, goal } = randomGrid(seed);
    const density = threatDensity(grid, seed);
    const grid8 = astar({ grid, density, start, goal, trace: false });
    const r = thetaStar({ grid, density, start, goal, trace: false });
    assert.equal(r.found, grid8.found);
    if (!r.found) continue;
    let cost = 0;
    for (let k = 1; k < r.waypoints.length; k++) {
      assert.ok(walkableLine(grid, r.waypoints[k - 1], r.waypoints[k]), 'segment is walkable');
      cost += segmentIntegral(grid, density, r.waypoints[k - 1], r.waypoints[k]);
    }
    assert.ok(close(cost, r.cost), 'reported cost equals line integral');
    assert.ok(r.cost <= grid8.cost * 1.02 + 1e-9, `seed ${seed}: theta ${r.cost} vs A* ${grid8.cost}`);
  }
});

test('D* Lite repairs its plan to the optimum after repeated cost changes', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const { grid, start, goal, rng } = randomGrid(seed, 22, 16, { walls: 0.2 });
    let density = buildDensity(grid, null, { riskMode: 'none' });
    const dl = new DStarLite(grid, density, start, goal);
    dl.computeShortestPath();
    let pos = start;
    const ref0 = referenceDistances(grid, density, start)[goal];
    assert.ok(Number.isFinite(ref0) ? close(dl.distance, ref0) : !Number.isFinite(dl.distance));
    for (let round = 0; round < 6 && Number.isFinite(dl.distance); round++) {
      // Walk a few steps along the current plan.
      for (let s = 0; s < 3 && pos !== goal; s++) {
        pos = dl.next(pos);
        dl.moveTo(pos);
      }
      // Raise costs in a random disc.
      density = Float64Array.from(density);
      const cx = rng() * grid.width;
      const cy = rng() * grid.height;
      const changes = [];
      for (let i = 0; i < grid.size; i++) {
        if (!grid.walkable(i)) continue;
        if (Math.hypot(grid.xOf(i) - cx, grid.yOf(i) - cy) < 4) {
          density[i] = density[i] * (2 + rng() * 6);
          changes.push([i, density[i]]);
        }
      }
      dl.updateCosts(changes);
      dl.computeShortestPath();
      const ref = referenceDistances(grid, density, pos)[goal];
      if (Number.isFinite(ref)) assert.ok(close(dl.distance, ref), `seed ${seed} round ${round}: ${dl.distance} vs ${ref}`);
      else assert.equal(Number.isFinite(dl.distance), false);
      const path = dl.path();
      if (path) assert.ok(close(pathCost(grid, density, path), ref), 'extracted path is optimal');
    }
  }
});

test('flow field next-steps are consistent with the integration field', () => {
  const { grid, goal } = randomGrid(7, 26, 18);
  const density = threatDensity(grid, 7);
  const { dist, next } = buildFlowField(grid, density, goal);
  const ref = referenceDistances(grid, density, goal);
  for (let i = 0; i < grid.size; i++) {
    if (!Number.isFinite(ref[i])) {
      assert.equal(dist[i], Infinity);
      continue;
    }
    assert.ok(close(dist[i], ref[i]));
    if (i !== goal) {
      const n = next[i];
      assert.ok(close(dist[i], dist[n] + grid.stepLength(i, n) * 0.5 * (density[i] + density[n])));
    }
  }
});

test('planners handle start === goal and unreachable goals', () => {
  const g = Grid.fromRows(['..#..', '..#..', '..#..']);
  const density = buildDensity(g, null, { riskMode: 'none' });
  const s = g.index(0, 1);
  for (const fn of [bfs, dijkstra, astar, greedy, bidirectionalAstar, jps, thetaStar, flowField]) {
    const same = fn({ grid: g, density, start: s, goal: s, trace: false });
    assert.ok(same.found && same.path.length === 1 && same.cost === 0, fn.name);
    const blocked = fn({ grid: g, density, start: s, goal: g.index(4, 1), trace: false });
    assert.equal(blocked.found, false, fn.name);
  }
});
