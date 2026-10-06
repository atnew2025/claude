import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid, Terrain } from '../src/core/grid.js';
import { PairHeap, IndexedHeap } from '../src/core/heap.js';
import { traverse, hasLineOfSight, segmentIntegral } from '../src/core/geometry.js';
import { buildDensity, edgeCost } from '../src/core/cost.js';
import { mulberry32 } from '../src/core/maps.js';
import { randomGrid, close } from './helpers.js';

test('PairHeap pops in lexicographic (k1, k2) order', () => {
  const rng = mulberry32(1);
  const heap = new PairHeap(4);
  const items = [];
  for (let i = 0; i < 500; i++) {
    const k1 = Math.floor(rng() * 20);
    const k2 = rng();
    items.push([k1, k2, i]);
    heap.push(i, k1, k2);
  }
  items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, , id] of items) assert.equal(heap.pop(), id);
  assert.equal(heap.size, 0);
});

test('IndexedHeap supports decrease/increase key and removal', () => {
  const rng = mulberry32(2);
  const heap = new IndexedHeap(200);
  const keys = new Map();
  for (let step = 0; step < 3000; step++) {
    const node = Math.floor(rng() * 200);
    const r = rng();
    if (r < 0.6) {
      const k = rng() * 100;
      heap.update(node, k, 0);
      keys.set(node, k);
    } else if (r < 0.8) {
      heap.remove(node);
      keys.delete(node);
    } else if (heap.size) {
      const min = Math.min(...keys.values());
      assert.equal(heap.topK1, min);
      const top = heap.pop();
      assert.equal(keys.get(top), min);
      keys.delete(top);
    }
    assert.equal(heap.size, keys.size);
  }
});

test('neighbours forbid corner cutting', () => {
  const g = Grid.fromRows(['...', '.#.', '...']);
  const out = new Int32Array(8);
  const n = g.neighbors(g.index(0, 0), true, out);
  // (1,1) is a wall, so the diagonal to (1,1) does not exist and only (1,0) and (0,1) remain.
  assert.deepEqual(Array.from(out.subarray(0, n)).sort(), [1, 3]);
  const g2 = Grid.fromRows(['.#', '..']);
  const m = g2.neighbors(g2.index(0, 0), true, out);
  assert.deepEqual(Array.from(out.subarray(0, m)), [2]);
});

test('traverse covers the whole segment with contiguous intervals', () => {
  const rng = mulberry32(3);
  for (let k = 0; k < 300; k++) {
    const x0 = Math.floor(rng() * 20) + 0.5;
    const y0 = Math.floor(rng() * 20) + 0.5;
    const x1 = Math.floor(rng() * 20) + 0.5;
    const y1 = Math.floor(rng() * 20) + 0.5;
    let last = 0;
    let total = 0;
    traverse(x0, y0, x1, y1, (cx, cy, t0, t1) => {
      if (t1 > t0) {
        assert.ok(Math.abs(t0 - last) < 1e-9, 'intervals are contiguous');
        last = t1;
        total += t1 - t0;
        // The midpoint of the interval lies inside the visited cell.
        const tm = (t0 + t1) / 2;
        assert.equal(Math.floor(x0 + (x1 - x0) * tm), cx);
        assert.equal(Math.floor(y0 + (y1 - y0) * tm), cy);
      }
    });
    if (x0 !== x1 || y0 !== y1) assert.ok(Math.abs(total - 1) < 1e-9);
  }
});

test('segment integral matches grid edge cost for adjacent cells and euclidean length on open ground', () => {
  const { grid } = randomGrid(4, 20, 20, { walls: 0, rough: 0.5 });
  const d = buildDensity(grid, null, { riskMode: 'none' });
  const out = new Int32Array(8);
  for (let i = 0; i < grid.size; i += 7) {
    const cnt = grid.neighbors(i, true, out);
    for (let k = 0; k < cnt; k++) {
      assert.ok(close(segmentIntegral(grid, d, i, out[k]), edgeCost(d, i, out[k], grid.stepLength(i, out[k]))));
    }
  }
  const open = new Grid(30, 30);
  const ones = buildDensity(open, null, { riskMode: 'none' });
  assert.ok(close(segmentIntegral(open, ones, open.index(1, 2), open.index(25, 13)), Math.hypot(24, 11)));
});

test('line of sight is blocked by walls and by diagonal squeezes', () => {
  const g = Grid.fromRows(['.....', '..#..', '.....', '#....', '.#...']);
  assert.equal(hasLineOfSight(g, g.index(0, 1), g.index(4, 1)), false);
  assert.equal(hasLineOfSight(g, g.index(0, 0), g.index(4, 0)), true);
  // (0,4) → (1,3) passes the corner shared by walls (0,3) and (1,4).
  assert.equal(segmentIntegral(g, buildDensity(g, null, { riskMode: 'none' }), g.index(0, 4), g.index(1, 3)), Infinity);
});

test('density encodes time + λ·damage', () => {
  const g = new Grid(3, 1);
  g.cells[1] = Terrain.MUD;
  const fakeModel = { mean: Float32Array.from([0, 10, 0]), peak: Float32Array.from([0, 20, 0]) };
  const d = buildDensity(g, fakeModel, { riskWeight: 0.5 });
  assert.deepEqual(Array.from(d), [1, 2.6 * (1 + 5), 1]);
  const p = buildDensity(g, fakeModel, { riskWeight: 0.5, riskMode: 'peak' });
  assert.equal(p[1], 2.6 * 11);
});
