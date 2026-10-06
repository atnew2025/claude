/**
 * Built-in scenarios. Each returns { id, name, blurb, grid, attackers, start, goal }
 * with start/goal as [x, y]. Coordinates are cell indices on a 60 × 36 grid.
 */
import { Grid, Terrain } from './grid.js';

export const MAP_W = 60;
export const MAP_H = 36;

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  constructor(w = MAP_W, h = MAP_H) {
    this.grid = new Grid(w, h);
    this.attackers = [];
  }

  rect(x, y, w, h, t = Terrain.WALL) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.grid.set(xx, yy, t);
    return this;
  }

  frame(x, y, w, h, t = Terrain.WALL) {
    this.rect(x, y, w, 1, t).rect(x, y + h - 1, w, 1, t).rect(x, y, 1, h, t).rect(x + w - 1, y, 1, h, t);
    return this;
  }

  /** Irregular natural patch: a disc with a noisy edge. */
  blob(rng, cx, cy, r, t) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x - cx, (y - cy) * 1.15);
        if (d <= r - 0.6 + rng() * 1.4 && this.grid.inBounds(x, y) && this.grid.get(x, y) !== Terrain.WALL) this.grid.set(x, y, t);
      }
    }
    return this;
  }

  add(spec) {
    this.attackers.push(spec);
    return this;
  }

  done(meta) {
    return { ...meta, grid: this.grid, attackers: this.attackers };
  }
}

function citadel() {
  const rng = mulberry32(7);
  const b = new Builder();
  // Natural cover first so walls drawn afterwards stay intact.
  b.blob(rng, 15, 13, 4, Terrain.BRUSH).blob(rng, 9, 30, 4.5, Terrain.BRUSH).blob(rng, 53, 28, 4, Terrain.BRUSH);
  b.blob(rng, 30, 3, 3.2, Terrain.BRUSH).blob(rng, 4, 18, 3, Terrain.BRUSH);
  b.rect(43, 15, 5, 16, Terrain.MUD).blob(rng, 47, 31, 3, Terrain.MUD).blob(rng, 18, 33, 3, Terrain.MUD);
  // The citadel with four gates and interior pillars.
  b.frame(21, 8, 19, 19);
  b.rect(29, 26, 3, 1, Terrain.OPEN).rect(21, 16, 1, 3, Terrain.OPEN).rect(33, 8, 3, 1, Terrain.OPEN).rect(39, 12, 1, 2, Terrain.OPEN);
  b.rect(25, 12, 1, 1).rect(35, 12, 1, 1).rect(25, 22, 1, 1).rect(35, 22, 1, 1).rect(30, 17, 1, 1);
  // Outlying rocks and a sniper tower.
  b.rect(11, 2, 2, 2).rect(14, 22, 2, 2).rect(47, 5, 2, 3).rect(52, 17, 2, 2).rect(6, 25, 3, 1).rect(55, 10, 1, 4);
  b.add({ type: 'laser', x: 30, y: 17, range: 8.5, dps: 70, period: 7, arms: 2, width: 12, phase: 20 });
  for (const [x, y] of [[21, 8], [39, 8], [21, 26], [39, 26]]) b.add({ type: 'turret', x, y, range: 6.5, dps: 13 });
  b.add({ type: 'sniper', x: 12, y: 3, facing: 8, fov: 30, range: 24, dps: 22 });
  b.add({ type: 'mortar', x: 46, y: 21, radius: 2.8, dps: 42, period: 4, active: 1.1, offset: 0 });
  b.add({ type: 'mortar', x: 50, y: 13, radius: 2.6, dps: 42, period: 4, active: 1.1, offset: 2 });
  b.add({ type: 'patrol', route: [[17, 29], [42, 29], [42, 33], [17, 33]], speed: 2.6, range: 2.6, dps: 22 });
  return b.done({
    id: 'citadel',
    name: 'Citadel',
    blurb: 'A fortified compound blocks the direct line. A laser sweeps its courtyard, turrets hold the corners and mortars shell the eastern marsh.',
    start: [2, 33],
    goal: [57, 2],
  });
}

function gallery() {
  const rng = mulberry32(11);
  const b = new Builder();
  b.blob(rng, 6, 30, 3, Terrain.BRUSH).blob(rng, 8, 6, 2.5, Terrain.BRUSH).blob(rng, 53, 32, 2.5, Terrain.BRUSH);
  b.rect(15, 0, 1, 36).rect(30, 0, 1, 36).rect(45, 0, 1, 36);
  b.rect(15, 3, 1, 3, Terrain.OPEN).rect(30, 30, 1, 3, Terrain.OPEN).rect(45, 3, 1, 3, Terrain.OPEN);
  // Each hall: a sweeper on a central pylon ringed by pillars that cast cover shadows.
  const halls = [
    { x: 22, y: 17, period: 8, arms: 1, phase: 0 },
    { x: 37, y: 17, period: 12, arms: 2, phase: 60 },
    { x: 52, y: 17, period: 7, arms: 1, phase: 200 },
  ];
  for (const h of halls) {
    b.rect(h.x, h.y, 1, 1);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      b.rect(Math.round(h.x + 4.2 * Math.cos(a)), Math.round(h.y + 4.2 * Math.sin(a)), 1, 1);
    }
    b.add({ type: 'laser', x: h.x, y: h.y, range: 11, dps: 75, period: h.period, arms: h.arms, width: 12, phase: h.phase });
  }
  return b.done({
    id: 'gallery',
    name: 'Laser Gallery',
    blurb: 'Three halls, each swept by a rotating laser and ringed with pillars. Static planners pay for exposure. A time-aware planner moves from shadow to shadow between sweeps.',
    start: [2, 18],
    goal: [57, 26],
  });
}

function plaza() {
  const rng = mulberry32(23);
  const b = new Builder();
  b.blob(rng, 30, 18, 5, Terrain.BRUSH).blob(rng, 52, 7, 3, Terrain.BRUSH).blob(rng, 8, 29, 3.5, Terrain.BRUSH);
  // City blocks laid out on a street grid.
  for (const x of [5, 15, 39, 49]) for (const y of [5, 14, 23]) b.rect(x, y, 6, 5);
  b.rect(24, 5, 12, 4).rect(24, 28, 12, 4).rect(24, 13, 3, 3).rect(33, 20, 3, 3);
  b.add({ type: 'turret', x: 21, y: 11, range: 8, dps: 14 });
  b.add({ type: 'turret', x: 38, y: 11, range: 8, dps: 14 });
  b.add({ type: 'turret', x: 21, y: 26, range: 8, dps: 14 });
  b.add({ type: 'turret', x: 38, y: 26, range: 8, dps: 14 });
  b.add({ type: 'sniper', x: 1, y: 20, facing: 0, fov: 14, range: 40, dps: 26 });
  b.add({ type: 'sniper', x: 46, y: 1, facing: 90, fov: 16, range: 34, dps: 26 });
  b.add({ type: 'patrol', route: [[12, 11], [46, 11], [46, 20], [12, 20]], speed: 2.2, range: 2.4, dps: 20 });
  return b.done({
    id: 'plaza',
    name: 'Crossfire Plaza',
    blurb: 'Four turrets cover a central plaza and two snipers watch the long avenues. Buildings cast cover shadows, and the safest route runs through them.',
    start: [1, 1],
    goal: [58, 34],
  });
}

function marsh() {
  const rng = mulberry32(5);
  const b = new Builder();
  b.rect(0, 0, MAP_W, MAP_H, Terrain.MUD);
  b.rect(0, 16, MAP_W, 3, Terrain.OPEN); // causeway
  b.rect(0, 0, MAP_W, 3, Terrain.OPEN).rect(0, 33, MAP_W, 3, Terrain.OPEN);
  for (const [x, y, r] of [[10, 8, 3], [24, 27, 3.5], [38, 7, 3], [50, 27, 3], [17, 10, 2], [44, 24, 2]]) b.blob(rng, x, y, r, Terrain.BRUSH);
  for (const [x, y, r] of [[30, 9, 2.6], [12, 26, 2.4], [42, 12, 2]]) b.blob(rng, x, y, r, Terrain.OPEN);
  b.rect(29, 8, 2, 2).rect(12, 25, 1, 2).rect(41, 11, 1, 2).rect(55, 13, 2, 2).rect(55, 20, 2, 2);
  for (const [x, off] of [[10, 0], [19, 3.1], [28, 5.3], [37, 1.7], [46, 4.4]]) {
    b.add({ type: 'mortar', x, y: 17, radius: 2.2, dps: 48, period: 7, active: 1.2, offset: off });
  }
  b.add({ type: 'turret', x: 30, y: 9, range: 9, dps: 12 });
  b.add({ type: 'mortar', x: 30, y: 1, radius: 2.6, dps: 40, period: 3, active: 1, offset: 0.5 });
  b.add({ type: 'mortar', x: 30, y: 34, radius: 2.6, dps: 40, period: 3, active: 1, offset: 2 });
  b.add({ type: 'sniper', x: 56, y: 14, facing: 180, fov: 12, range: 30, dps: 14 });
  return b.done({
    id: 'marsh',
    name: 'Mortar Marsh',
    blurb: 'A fast causeway crosses a slow swamp under staggered mortar fire. Detouring through the mud is safe but slow. Timing the strikes keeps both speed and health.',
    start: [0, 17],
    goal: [59, 18],
  });
}

/** Cellular-automaton caves with seeded attacker placement. */
export function caves(seed = 1) {
  const rng = mulberry32(seed);
  const b = new Builder();
  const g = b.grid;
  for (let i = 0; i < g.size; i++) g.cells[i] = rng() < 0.42 ? Terrain.WALL : Terrain.OPEN;
  for (let iter = 0; iter < 4; iter++) {
    const next = new Uint8Array(g.cells);
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && g.blocksSight(x + dx, y + dy)) walls++;
        next[g.index(x, y)] = walls >= 5 ? Terrain.WALL : walls <= 3 ? Terrain.OPEN : g.cells[g.index(x, y)];
      }
    }
    g.cells = next;
  }
  const start = [2, 2 + Math.floor(rng() * 6)];
  const goal = [MAP_W - 3, MAP_H - 3 - Math.floor(rng() * 6)];
  b.rect(start[0] - 2, start[1] - 2, 5, 5, Terrain.OPEN).rect(goal[0] - 2, goal[1] - 2, 5, 5, Terrain.OPEN);
  // Guarantee connectivity with a meandering tunnel.
  let [x, y] = start;
  while (x !== goal[0] || y !== goal[1]) {
    b.rect(x, y, 2, 2, Terrain.OPEN);
    if (rng() < 0.55) x += Math.sign(goal[0] - x);
    else y += Math.sign(goal[1] - y);
  }
  for (let k = 0; k < 6; k++) b.blob(rng, 4 + rng() * 52, 3 + rng() * 30, 1.5 + rng() * 2.5, k % 2 ? Terrain.MUD : Terrain.BRUSH);
  const open = [];
  for (let i = 0; i < g.size; i++) {
    const cx = i % g.width;
    const cy = (i / g.width) | 0;
    const far = Math.hypot(cx - start[0], cy - start[1]) > 8 && Math.hypot(cx - goal[0], cy - goal[1]) > 6;
    if (g.walkable(i) && far) open.push([cx, cy]);
  }
  const pick = () => open[Math.floor(rng() * open.length)];
  const types = ['turret', 'turret', 'turret', 'laser', 'mortar', 'mortar', 'sniper'];
  for (const type of types) {
    const [ax, ay] = pick();
    const spec = { type, x: ax, y: ay };
    if (type === 'sniper') spec.facing = Math.round(rng() * 360);
    if (type === 'laser') spec.phase = Math.round(rng() * 360);
    if (type === 'mortar') spec.offset = Math.round(rng() * 40) / 10;
    b.add(spec);
  }
  const [px, py] = pick();
  b.add({ type: 'patrol', route: [[px, py], [Math.min(MAP_W - 2, px + 8), py], [Math.min(MAP_W - 2, px + 8), Math.min(MAP_H - 2, py + 6)], [px, Math.min(MAP_H - 2, py + 6)]] });
  return b.done({
    id: 'caves',
    name: 'Procedural Caves',
    blurb: `Seeded cellular-automaton caverns with randomly placed attackers (seed ${seed}).`,
    start,
    goal,
    seed,
  });
}

function sandbox() {
  const b = new Builder();
  b.rect(28, 6, 2, 24);
  b.add({ type: 'turret', x: 20, y: 18, range: 7, dps: 14 });
  b.add({ type: 'turret', x: 38, y: 12, range: 7, dps: 14 });
  return b.done({
    id: 'sandbox',
    name: 'Sandbox',
    blurb: 'An almost empty field for drawing your own walls, terrain and attackers.',
    start: [4, 18],
    goal: [55, 18],
  });
}

export const SCENARIOS = [
  { id: 'citadel', name: 'Citadel', make: citadel },
  { id: 'gallery', name: 'Laser Gallery', make: gallery },
  { id: 'plaza', name: 'Crossfire Plaza', make: plaza },
  { id: 'marsh', name: 'Mortar Marsh', make: marsh },
  { id: 'caves', name: 'Procedural Caves', make: caves },
  { id: 'sandbox', name: 'Sandbox', make: sandbox },
];

export function loadScenario(id, seed) {
  const s = SCENARIOS.find((x) => x.id === id) ?? SCENARIOS[0];
  return s.id === 'caves' ? caves(seed) : s.make();
}
