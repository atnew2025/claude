/**
 * Threat model: attackers compiled into sparse, time-dependent damage fields.
 *
 * All rates are *effective* damage per second at a cell — line of sight,
 * distance falloff and terrain cover (brush) are already applied — so planners
 * and the simulator can consume them directly.
 */
import { hasLineOfSight, angleDiff } from './geometry.js';

export const ATTACK_TYPES = Object.freeze({
  turret: { label: 'Turret', pattern: 'static', los: true, blurb: 'Radial fire with distance falloff' },
  sniper: { label: 'Sniper nest', pattern: 'static', los: true, blurb: 'Long, narrow cone of fire' },
  laser: { label: 'Laser sweeper', pattern: 'periodic', los: true, blurb: 'Rotating beam, lethal on contact' },
  mortar: { label: 'Mortar strike', pattern: 'periodic', los: false, blurb: 'Timed area bombardment, ignores walls' },
  patrol: { label: 'Patrol', pattern: 'moving', los: true, blurb: 'Walks a loop, fires at short range' },
});

export const DEFAULTS = Object.freeze({
  turret: { range: 7, dps: 14 },
  sniper: { range: 18, dps: 24, facing: 0, fov: 40 },
  laser: { range: 8, dps: 70, period: 6, width: 12, arms: 2, phase: 0 },
  mortar: { radius: 2.6, dps: 40, period: 4, active: 1.1, offset: 0 },
  patrol: { range: 2.6, dps: 22, speed: 2.4, offset: 0 },
});

const DEG = 180 / Math.PI;

/** Fills in defaults and copies the spec so callers can mutate their own copy. */
export function normalizeAttacker(spec) {
  const base = DEFAULTS[spec.type];
  if (!base) throw new Error(`Unknown attacker type: ${spec.type}`);
  const out = { ...base, ...spec };
  if (spec.route) out.route = spec.route.map((p) => [p[0], p[1]]);
  return out;
}

/** Cells within `radius` of (x, y) whose centres are inside the grid and walkable. */
function cellsInRadius(grid, x, y, radius, fn) {
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(grid.width - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(grid.height - 1, Math.ceil(y + radius));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      if (!grid.open(xx, yy)) continue;
      const d = Math.hypot(xx - x, yy - y);
      if (d <= radius) fn(yy * grid.width + xx, xx, yy, d);
    }
  }
}

class Unit {
  constructor(spec, index, grid) {
    this.spec = spec;
    this.index = index;
    this.type = spec.type;
    this.info = ATTACK_TYPES[spec.type];
    this.dynamic = this.info.pattern !== 'static';
    this.period = 0;
    this.slot = new Int32Array(grid.size).fill(-1);
    this.cellList = [];
    this.baseList = [];
    this.shadowList = [];
  }

  _add(cell, rate) {
    this.slot[cell] = this.cellList.length;
    this.cellList.push(cell);
    this.baseList.push(rate);
  }

  _finish() {
    this.cells = Int32Array.from(this.cellList);
    this.base = Float32Array.from(this.baseList);
    this.shadow = Int32Array.from(this.shadowList);
    this.cellList = this.baseList = this.shadowList = null;
    if (!this.mean) {
      this.mean = this.base;
      this.peak = this.base;
    }
  }

  /** Adds this unit's damage rates at time `t` into `out`. */
  accumulate(t, out) {
    const { cells, base } = this;
    for (let k = 0; k < cells.length; k++) out[cells[k]] += base[k];
  }

  rateAtCell(cell, t) {
    const k = this.slot[cell];
    return k === -1 ? 0 : this.base[k];
  }

  /** Geometry for rendering at time t. */
  stateAt(_t) {
    return {};
  }
}

class Turret extends Unit {
  constructor(spec, index, grid) {
    super(spec, index, grid);
    const origin = grid.index(spec.x, spec.y);
    cellsInRadius(grid, spec.x, spec.y, spec.range, (cell, _x, _y, d) => {
      if (cell !== origin && !hasLineOfSight(grid, origin, cell)) {
        this.shadowList.push(cell);
        return;
      }
      this._add(cell, spec.dps * (1 - 0.6 * (d / spec.range)) * grid.exposure(cell));
    });
    this._finish();
  }
}

class Sniper extends Unit {
  constructor(spec, index, grid) {
    super(spec, index, grid);
    const origin = grid.index(spec.x, spec.y);
    const half = spec.fov / 2;
    cellsInRadius(grid, spec.x, spec.y, spec.range, (cell, x, y, d) => {
      if (d > 0) {
        const ang = Math.atan2(y - spec.y, x - spec.x) * DEG;
        const slack = Math.atan2(0.5, d) * DEG;
        if (Math.abs(angleDiff(ang, spec.facing)) > half + slack) return;
      }
      if (cell !== origin && !hasLineOfSight(grid, origin, cell)) {
        this.shadowList.push(cell);
        return;
      }
      this._add(cell, spec.dps * (1 - 0.3 * (d / spec.range)) * grid.exposure(cell));
    });
    this._finish();
  }
}

class Laser extends Unit {
  constructor(spec, index, grid) {
    super(spec, index, grid);
    const origin = grid.index(spec.x, spec.y);
    const angles = [];
    const slack = [];
    cellsInRadius(grid, spec.x, spec.y, spec.range, (cell, x, y, d) => {
      if (cell !== origin && !hasLineOfSight(grid, origin, cell)) {
        this.shadowList.push(cell);
        return;
      }
      this._add(cell, spec.dps * grid.exposure(cell));
      angles.push(d > 0 ? Math.atan2(y - spec.y, x - spec.x) * DEG : NaN);
      // A cell is hit while any part of it is under the beam.
      slack.push(d > 0 ? Math.atan2(0.5, d) * DEG : 180);
    });
    this._finish();
    this.angles = Float32Array.from(angles);
    this.halfArc = Float32Array.from(slack, (s) => spec.width / 2 + s);
    this.period = spec.period / spec.arms;
    this.mean = new Float32Array(this.cells.length);
    for (let k = 0; k < this.cells.length; k++) {
      const frac = Number.isNaN(this.angles[k]) ? 1 : Math.min(1, (spec.arms * 2 * this.halfArc[k]) / 360);
      this.mean[k] = this.base[k] * frac;
    }
    this.peak = this.base;
  }

  beamAngle(t) {
    return this.spec.phase + (360 * t) / this.spec.period;
  }

  _hit(k, beam) {
    const a = this.angles[k];
    if (Number.isNaN(a)) return true;
    const { arms } = this.spec;
    const step = 360 / arms;
    const limit = this.halfArc[k];
    for (let j = 0; j < arms; j++) {
      if (Math.abs(angleDiff(a, beam + j * step)) <= limit) return true;
    }
    return false;
  }

  accumulate(t, out) {
    const beam = this.beamAngle(t);
    const { cells, base } = this;
    for (let k = 0; k < cells.length; k++) if (this._hit(k, beam)) out[cells[k]] += base[k];
  }

  rateAtCell(cell, t) {
    const k = this.slot[cell];
    return k !== -1 && this._hit(k, this.beamAngle(t)) ? this.base[k] : 0;
  }

  stateAt(t) {
    const beam = this.beamAngle(t);
    const step = 360 / this.spec.arms;
    return { angles: Array.from({ length: this.spec.arms }, (_, j) => beam + j * step) };
  }
}

class Mortar extends Unit {
  constructor(spec, index, grid) {
    super(spec, index, grid);
    cellsInRadius(grid, spec.x, spec.y, spec.radius, (cell, _x, _y, d) => {
      this._add(cell, spec.dps * (1 - 0.4 * (d / spec.radius)) * grid.exposure(cell));
    });
    this._finish();
    this.period = spec.period;
    const duty = Math.min(1, spec.active / spec.period);
    this.mean = Float32Array.from(this.base, (b) => b * duty);
    this.peak = this.base;
  }

  /** Seconds into the current cycle, in [0, period). */
  phase(t) {
    const p = this.spec.period;
    return ((((t - this.spec.offset) % p) + p) % p);
  }

  active(t) {
    return this.phase(t) < this.spec.active;
  }

  accumulate(t, out) {
    if (this.active(t)) super.accumulate(t, out);
  }

  rateAtCell(cell, t) {
    return this.active(t) ? super.rateAtCell(cell, t) : 0;
  }

  stateAt(t) {
    const ph = this.phase(t);
    const { period, active } = this.spec;
    const lead = Math.min(1.2, period - active);
    // `warning` ramps 0→1 during the telegraph window before the next strike.
    const warning = ph >= period - lead ? (ph - (period - lead)) / lead : 0;
    return { active: ph < active, warning, progress: ph < active ? ph / active : 0 };
  }
}

class Patrol extends Unit {
  constructor(spec, index, grid) {
    super(spec, index, grid);
    const pts = spec.route.map(([x, y]) => [x + 0.5, y + 0.5]);
    const segs = [];
    let length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push({ a, b, len, start: length });
      length += len;
    }
    this.segs = segs;
    this.length = Math.max(length, 1e-6);
    this.period = this.length / spec.speed;
    const count = Math.max(1, Math.ceil(this.length / 0.25));
    this.spacing = this.length / count;
    this.samples = [];
    const visCache = new Map();
    const sum = new Float64Array(grid.size);
    const peak = new Float32Array(grid.size);
    const seen = new Uint8Array(grid.size);
    for (let k = 0; k < count; k++) {
      const [px, py] = this.positionAtDistance(k * this.spacing);
      const pc = grid.index(Math.min(grid.width - 1, Math.floor(px)), Math.min(grid.height - 1, Math.floor(py)));
      const cells = [];
      const rates = [];
      cellsInRadius(grid, px - 0.5, py - 0.5, spec.range, (cell, _x, _y, d) => {
        const key = pc * grid.size + cell;
        let vis = visCache.get(key);
        if (vis === undefined) {
          vis = cell === pc || hasLineOfSight(grid, pc, cell);
          visCache.set(key, vis);
        }
        if (!vis) return;
        const r = spec.dps * (1 - 0.5 * (d / spec.range)) * grid.exposure(cell);
        cells.push(cell);
        rates.push(r);
        sum[cell] += r;
        if (r > peak[cell]) peak[cell] = r;
        if (!seen[cell]) {
          seen[cell] = 1;
          this._add(cell, 0);
        }
      });
      this.samples.push({ cells: Int32Array.from(cells), rates: Float32Array.from(rates) });
    }
    this._finish();
    this.mean = Float32Array.from(this.cells, (c) => sum[c] / count);
    this.peak = Float32Array.from(this.cells, (c) => peak[c]);
  }

  positionAtDistance(s) {
    s = ((s % this.length) + this.length) % this.length;
    for (const seg of this.segs) {
      if (s <= seg.start + seg.len || seg === this.segs[this.segs.length - 1]) {
        const u = seg.len > 0 ? (s - seg.start) / seg.len : 0;
        return [seg.a[0] + (seg.b[0] - seg.a[0]) * u, seg.a[1] + (seg.b[1] - seg.a[1]) * u];
      }
    }
    return this.segs[0].a;
  }

  _sample(t) {
    const s = this.spec.speed * t + this.spec.offset;
    const n = this.samples.length;
    return this.samples[((Math.floor(s / this.spacing) % n) + n) % n];
  }

  accumulate(t, out) {
    const { cells, rates } = this._sample(t);
    for (let k = 0; k < cells.length; k++) out[cells[k]] += rates[k];
  }

  rateAtCell(cell, t) {
    const { cells, rates } = this._sample(t);
    for (let k = 0; k < cells.length; k++) if (cells[k] === cell) return rates[k];
    return 0;
  }

  stateAt(t) {
    const s = this.spec.speed * t + this.spec.offset;
    const [x, y] = this.positionAtDistance(s);
    const [nx, ny] = this.positionAtDistance(s + 0.3);
    return { x, y, heading: Math.atan2(ny - y, nx - x) };
  }
}

const CLASSES = { turret: Turret, sniper: Sniper, laser: Laser, mortar: Mortar, patrol: Patrol };

export class ThreatModel {
  /**
   * @param {import('./grid.js').Grid} grid
   * @param {object[]} specs attacker specifications
   */
  constructor(grid, specs = []) {
    this.grid = grid;
    this.specs = specs.map(normalizeAttacker);
    const n = grid.size;
    this.units = this.specs.map((s, i) => new CLASSES[s.type](s, i, grid));
    this.dynamicUnits = this.units.filter((u) => u.dynamic);
    this.staticRate = new Float32Array(n);
    this.mean = new Float32Array(n);
    this.peak = new Float32Array(n);
    this.coverCount = new Uint8Array(n);
    this.shadowCount = new Uint8Array(n);
    this.dynamicCover = new Uint8Array(n);
    for (const u of this.units) {
      for (let k = 0; k < u.cells.length; k++) {
        const c = u.cells[k];
        if (!u.dynamic) this.staticRate[c] += u.base[k];
        this.mean[c] += u.mean[k];
        this.peak[c] += u.peak[k];
        if (u.peak[k] > 0) {
          this.coverCount[c]++;
          if (u.dynamic) this.dynamicCover[c] = 1;
        }
      }
      for (const c of u.shadow) this.shadowCount[c]++;
    }
    this.maxPeriod = this.dynamicUnits.reduce((m, u) => Math.max(m, u.period), 0);
    this.maxMean = this.mean.reduce((m, v) => Math.max(m, v), 0);
    this.maxPeak = this.peak.reduce((m, v) => Math.max(m, v), 0);
  }

  get hasDynamic() {
    return this.dynamicUnits.length > 0;
  }

  /** Effective damage per second at `cell` at time `t`. */
  rateAt(cell, t) {
    let r = this.staticRate[cell];
    for (const u of this.dynamicUnits) r += u.rateAtCell(cell, t);
    return r;
  }

  /** Full damage field at time `t`. */
  fieldAt(t, out = new Float32Array(this.grid.size)) {
    out.set(this.staticRate);
    for (const u of this.dynamicUnits) u.accumulate(t, out);
    return out;
  }

  /** Only the time-varying part of the field at time `t`. */
  dynamicFieldAt(t, out = new Float32Array(this.grid.size)) {
    out.fill(0);
    for (const u of this.dynamicUnits) u.accumulate(t, out);
    return out;
  }

  /** Per-attacker breakdown for one cell (attack attribution). */
  contributions(cell) {
    const list = [];
    for (const u of this.units) {
      const k = u.slot[cell];
      if (k !== -1 && u.peak[k] > 0) list.push({ unit: u, mean: u.mean[k], peak: u.peak[k] });
    }
    return list.sort((a, b) => b.mean - a.mean);
  }

  /** Mean damage field restricted to a subset of attackers (used by fog-of-war recon). */
  meanOf(unitIndices, out = new Float32Array(this.grid.size)) {
    out.fill(0);
    for (const i of unitIndices) {
      const u = this.units[i];
      for (let k = 0; k < u.cells.length; k++) out[u.cells[k]] += u.mean[k];
    }
    return out;
  }
}
