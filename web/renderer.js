/**
 * Canvas renderer for the survey map. Everything is drawn in grid units (one
 * unit = one cell) through a single transform. Static layers (terrain, zone
 * hatching, flow arrows) are cached; per-cell fields (heat, search traces) are
 * written into grid-resolution bitmaps and scaled up in one draw call.
 */
import { Terrain } from '../src/core/grid.js';
import { Zone } from '../src/core/recognition.js';
import { TraceKind } from '../src/core/algorithms/common.js';
import { traverse } from '../src/core/geometry.js';
import { alpha, heatLevel } from './theme.js';

const DEG = Math.PI / 180;

/** Incrementally replays a search trace into per-cell state. */
export class TraceView {
  constructor(trace, size) {
    this.events = trace ? trace.events : [];
    this.size = size;
    this.kind = new Uint8Array(size);
    this.order = new Int32Array(size).fill(-1);
    this.jumps = [];
    this.cursor = 0;
    this.closed = 0;
  }

  get done() {
    return this.cursor >= this.events.length;
  }

  get length() {
    return this.events.length;
  }

  advanceTo(k) {
    const end = Math.min(k, this.events.length);
    for (; this.cursor < end; this.cursor++) {
      const e = this.events[this.cursor];
      const cell = Math.floor(e / 8);
      const kind = e % 8;
      const prev = this.kind[cell];
      if (kind === TraceKind.CLOSE || kind === TraceKind.CLOSE_B || kind === TraceKind.WAVE) this.closed++;
      if (kind === TraceKind.JUMP) this.jumps.push(cell);
      if (kind === TraceKind.SCAN && prev !== 0) continue;
      if (kind === TraceKind.OPEN && (prev === TraceKind.CLOSE || prev === TraceKind.CLOSE_B)) continue;
      if (kind === TraceKind.OPEN_B && (prev === TraceKind.CLOSE || prev === TraceKind.CLOSE_B)) continue;
      this.kind[cell] = kind;
      this.order[cell] = this.cursor;
    }
  }

  finish() {
    this.advanceTo(this.events.length);
  }
}

function hash(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class MapRenderer {
  constructor(canvas, { mini = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = mini;
    this.theme = null;
    this.grid = null;
    this.terrain = document.createElement('canvas');
    this.zones = document.createElement('canvas');
    this.flow = document.createElement('canvas');
    this.heat = document.createElement('canvas');
    this.traceLayer = document.createElement('canvas');
    this.dirty = { terrain: true, zones: true, flow: true };
    this.flowSource = null;
    this.px = 1;
  }

  setTheme(theme) {
    this.theme = theme;
    this.invalidate();
  }

  setWorld(grid, model, analysis) {
    if (grid !== this.grid || this.heat.width !== grid.width || this.heat.height !== grid.height) {
      for (const c of [this.heat, this.traceLayer]) {
        c.width = grid.width;
        c.height = grid.height;
      }
      this.heatImg = this.heat.getContext('2d').createImageData(grid.width, grid.height);
      this.traceImg = this.traceLayer.getContext('2d').createImageData(grid.width, grid.height);
    }
    this.grid = grid;
    this.model = model;
    this.analysis = analysis;
    this.invalidate();
  }

  invalidate() {
    this.dirty.terrain = this.dirty.zones = this.dirty.flow = true;
  }

  /** Matches the backing store to the CSS size. Returns true when it changed. */
  resize() {
    const g = this.grid;
    if (!g) return false;
    const w = this.canvas.clientWidth;
    if (!w) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cs = w / g.width;
    const pw = Math.round(w * dpr);
    const ph = Math.round(cs * g.height * dpr);
    if (this.canvas.width === pw && this.canvas.height === ph) return false;
    this.canvas.width = pw;
    this.canvas.height = ph;
    for (const c of [this.terrain, this.zones, this.flow]) {
      c.width = pw;
      c.height = ph;
    }
    this.px = pw / g.width;
    this.invalidate();
    return true;
  }

  /** Grid coordinates (continuous) for a pointer position. */
  pointAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * this.grid.width, y: ((clientY - r.top) / r.height) * this.grid.height };
  }

  cellAt(clientX, clientY) {
    const { x, y } = this.pointAt(clientX, clientY);
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    return this.grid.inBounds(cx, cy) ? this.grid.index(cx, cy) : -1;
  }

  _unitCtx(ctx) {
    ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
    return ctx;
  }

  _drawTerrain() {
    const { grid: g, theme: t } = this;
    const ctx = this._unitCtx(this.terrain.getContext('2d'));
    ctx.fillStyle = t.ground;
    ctx.fillRect(0, 0, g.width, g.height);
    const hair = 1 / this.px;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const i = y * g.width + x;
        const c = g.cells[i];
        if (c === Terrain.BRUSH) {
          ctx.fillStyle = t.brush;
          ctx.fillRect(x, y, 1, 1);
          if (!this.mini) {
            ctx.fillStyle = t.brushInk;
            for (let k = 0; k < 3; k++) {
              ctx.beginPath();
              ctx.arc(x + 0.2 + 0.6 * hash(i * 3 + k), y + 0.2 + 0.6 * hash(i * 7 + k), 0.09, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else if (c === Terrain.MUD) {
          ctx.fillStyle = t.mud;
          ctx.fillRect(x, y, 1, 1);
          if (!this.mini) {
            ctx.strokeStyle = t.mudInk;
            ctx.lineWidth = 0.07;
            const o = hash(i) * 0.3;
            for (const yy of [0.35, 0.7]) {
              ctx.beginPath();
              ctx.moveTo(x + 0.15 + o * 0.3, y + yy);
              ctx.quadraticCurveTo(x + 0.35 + o * 0.3, y + yy - 0.12, x + 0.55 + o * 0.3, y + yy);
              ctx.stroke();
            }
          }
        }
      }
    }
    if (!this.mini) {
      ctx.lineWidth = hair;
      for (let x = 0; x <= g.width; x++) {
        ctx.strokeStyle = x % 5 === 0 ? t.gridMajor : t.gridLine;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, g.height);
        ctx.stroke();
      }
      for (let y = 0; y <= g.height; y++) {
        ctx.strokeStyle = y % 5 === 0 ? t.gridMajor : t.gridLine;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(g.width, y);
        ctx.stroke();
      }
    }
    // Walls: a solid slab with a lit top edge and a soft cast shadow below.
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (g.get(x, y) !== Terrain.WALL) continue;
        ctx.fillStyle = t.wall;
        ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
        if (!this.mini && !g.blocksSight(x, y + 1) && y + 1 < g.height) {
          ctx.fillStyle = t.dark ? 'rgba(0,0,0,0.35)' : 'rgba(17,26,23,0.14)';
          ctx.fillRect(x, y + 1, 1, 0.22);
        }
      }
    }
    if (!this.mini) {
      ctx.fillStyle = t.wallTop;
      for (let y = 0; y < g.height; y++) {
        for (let x = 0; x < g.width; x++) {
          if (g.get(x, y) === Terrain.WALL && (y === 0 || g.get(x, y - 1) !== Terrain.WALL)) ctx.fillRect(x, y, 1, 0.16);
        }
      }
    }
    this.dirty.terrain = false;
  }

  _drawZones() {
    const { grid: g, theme: t, analysis: a } = this;
    const ctx = this._unitCtx(this.zones.getContext('2d'));
    ctx.clearRect(0, 0, g.width, g.height);
    if (!a) return;
    const hatch = (zone, color, angles, gap, width) => {
      const path = new Path2D();
      let any = false;
      for (let i = 0; i < g.size; i++) {
        if (a.zone[i] === zone) {
          path.rect(i % g.width, (i / g.width) | 0, 1, 1);
          any = true;
        }
      }
      if (!any) return;
      ctx.save();
      ctx.clip(path);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      const span = g.width + g.height;
      for (const ang of angles) {
        ctx.beginPath();
        for (let k = -span; k < span; k += gap) {
          if (ang === 45) {
            ctx.moveTo(k, 0);
            ctx.lineTo(k + g.height, g.height);
          } else {
            ctx.moveTo(k, g.height);
            ctx.lineTo(k + g.height, 0);
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    };
    hatch(Zone.CROSSFIRE, alpha(t.zoneCross, 0.75), [45], 0.5, 0.07);
    hatch(Zone.KILLZONE, alpha(t.zoneKill, 0.85), [45, 135], 0.42, 0.08);
    ctx.fillStyle = alpha(t.zoneShadow, 0.9);
    for (let i = 0; i < g.size; i++) {
      if (a.zone[i] !== Zone.SHADOW) continue;
      const x = i % g.width;
      const y = (i / g.width) | 0;
      ctx.beginPath();
      ctx.arc(x + 0.5, y + 0.5, 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    this.dirty.zones = false;
  }

  _drawFlow(field) {
    const { grid: g, theme: t } = this;
    const ctx = this._unitCtx(this.flow.getContext('2d'));
    ctx.clearRect(0, 0, g.width, g.height);
    let maxD = 0;
    for (let i = 0; i < g.size; i++) if (Number.isFinite(field.dist[i])) maxD = Math.max(maxD, field.dist[i]);
    ctx.lineWidth = 0.07;
    ctx.lineCap = 'round';
    for (let i = 0; i < g.size; i++) {
      const n = field.next[i];
      if (n < 0) continue;
      const x = (i % g.width) + 0.5;
      const y = ((i / g.width) | 0) + 0.5;
      const dx = (n % g.width) + 0.5 - x;
      const dy = ((n / g.width) | 0) + 0.5 - y;
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;
      const k = 1 - field.dist[i] / (maxD || 1);
      ctx.strokeStyle = `rgba(${t.waveRGB.join(',')}, ${0.35 + 0.5 * k})`;
      ctx.beginPath();
      ctx.moveTo(x - ux * 0.28, y - uy * 0.28);
      ctx.lineTo(x + ux * 0.28, y + uy * 0.28);
      ctx.lineTo(x + ux * 0.1 - uy * 0.14, y + uy * 0.1 + ux * 0.14);
      ctx.moveTo(x + ux * 0.28, y + uy * 0.28);
      ctx.lineTo(x + ux * 0.1 + uy * 0.14, y + uy * 0.1 - ux * 0.14);
      ctx.stroke();
    }
    this.flowSource = field;
    this.dirty.flow = false;
  }

  _heatLayer(field, strength) {
    const { grid: g, theme: t } = this;
    const data = this.heatImg.data;
    const [r, gg, b] = t.heatRGB;
    const maxA = (t.dark ? 210 : 190) * strength;
    for (let i = 0; i < g.size; i++) {
      const o = i * 4;
      const lv = g.walkable(i) ? heatLevel(field[i]) : 0;
      data[o] = r;
      data[o + 1] = gg;
      data[o + 2] = b;
      data[o + 3] = lv * maxA;
    }
    this.heat.getContext('2d').putImageData(this.heatImg, 0, 0);
  }

  _traceLayer(tv) {
    const { theme: t } = this;
    const data = this.traceImg.data;
    data.fill(0);
    const total = Math.max(1, tv.cursor);
    const recent = Math.max(40, tv.length * 0.05);
    for (let i = 0; i < tv.size; i++) {
      const k = tv.kind[i];
      if (!k || k === TraceKind.JUMP) continue;
      const age = tv.cursor - tv.order[i];
      const fresh = Math.max(0, 1 - age / recent);
      let rgb = t.traceRGB;
      let a;
      switch (k) {
        case TraceKind.OPEN:
          a = 0.5 + 0.3 * fresh;
          break;
        case TraceKind.CLOSE:
          a = 0.2 + 0.45 * fresh;
          break;
        case TraceKind.OPEN_B:
          rgb = t.traceBRGB;
          a = 0.5 + 0.3 * fresh;
          break;
        case TraceKind.CLOSE_B:
          rgb = t.traceBRGB;
          a = 0.2 + 0.45 * fresh;
          break;
        case TraceKind.SCAN:
          a = 0.12 + 0.3 * fresh;
          break;
        case TraceKind.WAVE:
          rgb = t.waveRGB;
          a = 0.12 + 0.25 * (tv.order[i] / total) + 0.35 * fresh;
          break;
        default:
          a = 0.2;
      }
      const o = i * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = Math.min(255, a * 255);
    }
    this.traceLayer.getContext('2d').putImageData(this.traceImg, 0, 0);
  }

  /**
   * @param {object} v view description, see app.js `view()`
   */
  draw(v) {
    const { grid: g, theme: t, ctx } = this;
    if (!g || !t) return;
    this.resize();
    if (this.dirty.terrain) this._drawTerrain();
    if (this.dirty.zones) this._drawZones();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.terrain, 0, 0);
    this._unitCtx(ctx);

    if (v.heat) {
      this._heatLayer(v.heat, v.heatStrength ?? 1);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = t.dark ? 'screen' : 'multiply';
      ctx.drawImage(this.heat, 0, 0, g.width, g.height);
      ctx.restore();
    }
    if (v.zones) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.zones, 0, 0);
      ctx.restore();
    }
    if (v.flow) {
      if (this.dirty.flow || this.flowSource !== v.flow) this._drawFlow(v.flow);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.flow, 0, 0);
      ctx.restore();
    }
    if (v.trace) {
      this._traceLayer(v.trace);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.traceLayer, 0, 0, g.width, g.height);
      ctx.restore();
      if (v.trace.jumps.length && !this.mini) {
        ctx.fillStyle = `rgb(${t.traceRGB.join(',')})`;
        for (const c of v.trace.jumps) {
          const x = (c % g.width) + 0.5;
          const y = ((c / g.width) | 0) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x, y - 0.3);
          ctx.lineTo(x + 0.3, y);
          ctx.lineTo(x, y + 0.3);
          ctx.lineTo(x - 0.3, y);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    if (v.repair) this._drawRepair(v.repair);
    for (const p of v.paths ?? []) this._drawPath(p);
    for (const w of v.waits ?? []) this._drawWait(w);
    if (v.attackers) this._drawAttackers(v);
    this._drawEndpoints(v.start, v.goal);
    if (v.sensor) {
      ctx.save();
      ctx.setLineDash([0.3, 0.25]);
      ctx.lineWidth = 0.08;
      ctx.strokeStyle = alpha(t.accent, 0.8);
      ctx.beginPath();
      ctx.arc(v.sensor.x, v.sensor.y, v.sensor.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const ping of v.pings ?? []) {
      const a = 1 - ping.age;
      ctx.strokeStyle = alpha(t.zoneKill, a);
      ctx.lineWidth = 0.15;
      ctx.beginPath();
      ctx.arc(ping.x, ping.y, 0.6 + ping.age * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const a of v.agents ?? []) this._drawAgent(a);
    if (v.hover >= 0 && !this.mini) {
      ctx.strokeStyle = alpha(t.dark ? '#ffffff' : '#000000', 0.55);
      ctx.lineWidth = 0.07;
      ctx.strokeRect(v.hover % g.width + 0.04, ((v.hover / g.width) | 0) + 0.04, 0.92, 0.92);
    }
  }

  _drawRepair(rep) {
    const { grid: g, ctx, theme: t } = this;
    const a = Math.max(0, 1 - rep.age);
    if (a <= 0) return;
    ctx.fillStyle = `rgba(${t.waveRGB.join(',')}, ${0.45 * a})`;
    for (const c of rep.cells) ctx.fillRect(c % g.width, (c / g.width) | 0, 1, 1);
  }

  _drawPath(p) {
    const { grid: g, ctx, theme: t } = this;
    const pts = p.points ?? p.waypoints.map((c) => [(c % g.width) + 0.5, ((c / g.width) | 0) + 0.5]);
    if (pts.length < 2) return;
    let count = pts.length;
    let tail = null;
    if (p.progress !== undefined && p.progress < 1) {
      let total = 0;
      const seg = [];
      for (let k = 1; k < pts.length; k++) {
        const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        seg.push(l);
        total += l;
      }
      let left = total * Math.max(0, p.progress);
      count = 1;
      for (let k = 0; k < seg.length; k++) {
        if (left >= seg[k]) {
          left -= seg[k];
          count++;
        } else {
          const u = left / seg[k];
          tail = [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u];
          break;
        }
      }
    }
    const width = p.width ?? (this.mini ? 0.45 : 0.32);
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < count; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      if (tail) ctx.lineTo(tail[0], tail[1]);
    };
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = p.alpha ?? 1;
    if (p.dashed) ctx.setLineDash([0.5, 0.35]);
    trace();
    ctx.strokeStyle = t.casing;
    ctx.lineWidth = width + 0.2;
    ctx.stroke();
    trace();
    ctx.strokeStyle = p.color;
    ctx.lineWidth = width;
    if (t.dark && !this.mini && p.glow !== false) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawWait(w) {
    const { grid: g, ctx, theme: t } = this;
    const x = (w.cell % g.width) + 0.5;
    const y = ((w.cell / g.width) | 0) + 0.5;
    ctx.save();
    ctx.fillStyle = t.casing;
    ctx.strokeStyle = w.color;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.arc(x, y, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = w.color;
    ctx.fillRect(x - 0.2, y - 0.22, 0.13, 0.44);
    ctx.fillRect(x + 0.07, y - 0.22, 0.13, 0.44);
    if (!this.mini && w.label) {
      ctx.font = `600 0.62px ${t.fontMono}`;
      ctx.textBaseline = 'middle';
      const tx = x + 0.75;
      const tw = ctx.measureText(w.label).width;
      ctx.fillStyle = t.casing;
      ctx.fillRect(tx - 0.12, y - 0.42, tw + 0.24, 0.84);
      ctx.fillStyle = t.ink;
      ctx.fillText(w.label, tx, y + 0.02);
    }
    ctx.restore();
  }

  _beamLength(sx, sy, ang, range) {
    const g = this.grid;
    const ex = sx + Math.cos(ang) * range;
    const ey = sy + Math.sin(ang) * range;
    let hit = 1;
    const ox = Math.floor(sx);
    const oy = Math.floor(sy);
    traverse(sx, sy, ex, ey, (cx, cy, t0) => {
      if (cx === ox && cy === oy) return true;
      if (g.blocksSight(cx, cy)) {
        hit = t0;
        return false;
      }
      return true;
    });
    return range * hit;
  }

  _drawAttackers(v) {
    const { ctx, theme: t, model } = this;
    if (!model) return;
    const red = t.zoneKill;
    const time = v.t ?? 0;
    for (const u of model.units) {
      if (v.visible && !v.visible.has(u.index)) {
        if (v.revealHidden) this._ghost(u);
        continue;
      }
      const s = u.spec;
      const sel = v.selected === u.index;
      ctx.save();
      if (u.type === 'turret' || u.type === 'sniper' || u.type === 'laser') {
        const x = s.x + 0.5;
        const y = s.y + 0.5;
        if (v.ranges) {
          ctx.setLineDash([0.25, 0.25]);
          ctx.lineWidth = 0.06;
          ctx.strokeStyle = alpha(red, 0.55);
          ctx.beginPath();
          if (u.type === 'sniper') {
            const a0 = (s.facing - s.fov / 2) * DEG;
            const a1 = (s.facing + s.fov / 2) * DEG;
            ctx.moveTo(x, y);
            ctx.arc(x, y, s.range, a0, a1);
            ctx.closePath();
          } else ctx.arc(x, y, s.range, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (u.type === 'laser') {
          const { angles } = u.stateAt(time);
          for (const deg of angles) {
            const a = deg * DEG;
            const len = this._beamLength(x, y, a, s.range);
            const half = (s.width / 2) * DEG;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, len);
            grad.addColorStop(0, `rgba(${t.heatRGB.join(',')}, 0.55)`);
            grad.addColorStop(1, `rgba(${t.heatRGB.join(',')}, 0.12)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.arc(x, y, len, a - half, a + half);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = t.dark ? 'rgba(255,235,220,0.95)' : `rgb(${t.heatRGB.join(',')})`;
            ctx.lineWidth = 0.09;
            if (t.dark && !this.mini) {
              ctx.shadowColor = `rgb(${t.heatRGB.join(',')})`;
              ctx.shadowBlur = 12;
            }
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          this._glyph('laser', x, y, red, sel);
        } else if (u.type === 'sniper') {
          this._glyph('sniper', x, y, red, sel, s.facing * DEG);
        } else this._glyph('turret', x, y, red, sel);
      } else if (u.type === 'mortar') {
        const x = s.x + 0.5;
        const y = s.y + 0.5;
        const st = u.stateAt(time);
        ctx.lineWidth = 0.08;
        if (st.active) {
          ctx.fillStyle = `rgba(${t.heatRGB.join(',')}, ${0.45 - 0.25 * st.progress})`;
          ctx.beginPath();
          ctx.arc(x, y, s.radius + 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = red;
          ctx.stroke();
        } else {
          if (st.warning > 0) {
            ctx.setLineDash([0.3, 0.2]);
            ctx.strokeStyle = alpha(red, 0.4 + 0.5 * st.warning);
            ctx.beginPath();
            ctx.arc(x, y, (s.radius + 0.5) * (1.6 - 0.6 * st.warning), 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (v.ranges || st.warning > 0) {
            ctx.strokeStyle = alpha(red, 0.45);
            ctx.beginPath();
            ctx.arc(x, y, s.radius + 0.5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        this._glyph('mortar', x, y, red, sel);
      } else if (u.type === 'patrol') {
        if (v.ranges) {
          ctx.setLineDash([0.3, 0.3]);
          ctx.lineWidth = 0.07;
          ctx.strokeStyle = alpha(red, 0.5);
          ctx.beginPath();
          s.route.forEach(([px, py], k) => (k ? ctx.lineTo(px + 0.5, py + 0.5) : ctx.moveTo(px + 0.5, py + 0.5)));
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const st = u.stateAt(time);
        ctx.fillStyle = `rgba(${t.heatRGB.join(',')}, 0.16)`;
        ctx.beginPath();
        ctx.arc(st.x, st.y, s.range, 0, Math.PI * 2);
        ctx.fill();
        this._glyph('patrol', st.x, st.y, red, sel, st.heading);
      }
      ctx.restore();
    }
  }

  _ghost(u) {
    const { ctx, theme: t } = this;
    const s = u.spec;
    const [x, y] = s.type === 'patrol' ? [s.route[0][0] + 0.5, s.route[0][1] + 0.5] : [s.x + 0.5, s.y + 0.5];
    ctx.save();
    ctx.setLineDash([0.2, 0.2]);
    ctx.strokeStyle = alpha(t.ink, 0.35);
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.arc(x, y, 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Attacker icons, shared shapes with the HTML icon set. */
  _glyph(type, x, y, color, selected, angle = 0) {
    const { ctx, theme: t } = this;
    const r = this.mini ? 0.7 : 0.5;
    ctx.save();
    ctx.translate(x, y);
    if (selected) {
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.arc(0, 0, r + 0.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = t.casing;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    if (type === 'turret') {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    } else if (type === 'sniper' || type === 'patrol') {
      ctx.rotate(angle);
      ctx.moveTo(r * 1.15, 0);
      ctx.lineTo(-r * 0.75, r * 0.8);
      ctx.lineTo(-r * 0.4, 0);
      ctx.lineTo(-r * 0.75, -r * 0.8);
      ctx.closePath();
    } else if (type === 'laser') {
      ctx.moveTo(0, -r * 1.1);
      ctx.lineTo(r * 1.1, 0);
      ctx.lineTo(0, r * 1.1);
      ctx.lineTo(-r * 1.1, 0);
      ctx.closePath();
    } else if (type === 'mortar') {
      ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.fill();
    if (type === 'turret' || type === 'mortar') {
      ctx.fillStyle = t.casing;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
    if (type === 'mortar') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.07;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.beginPath();
        ctx.moveTo(dx * r * 1.05, dy * r * 1.05);
        ctx.lineTo(dx * r * 1.45, dy * r * 1.45);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawEndpoints(start, goal) {
    const { grid: g, ctx, theme: t } = this;
    const r = this.mini ? 0.9 : 0.62;
    if (start >= 0) {
      const x = (start % g.width) + 0.5;
      const y = ((start / g.width) | 0) + 0.5;
      ctx.fillStyle = t.ink;
      ctx.strokeStyle = t.casing;
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
      this._letter('S', x, y, t.bg);
    }
    if (goal >= 0) {
      const x = (goal % g.width) + 0.5;
      const y = ((goal / g.width) | 0) + 0.5;
      ctx.fillStyle = t.goodMark;
      ctx.strokeStyle = t.casing;
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.25);
      ctx.lineTo(x + r * 1.25, y);
      ctx.lineTo(x, y + r * 1.25);
      ctx.lineTo(x - r * 1.25, y);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      this._letter('G', x, y, '#ffffff');
    }
  }

  _letter(ch, x, y, color) {
    if (this.mini) return;
    const { ctx, theme: t } = this;
    ctx.fillStyle = color;
    ctx.font = `700 0.78px ${t.fontDisplay}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y + 0.05);
    ctx.textAlign = 'start';
  }

  _drawAgent(a) {
    const { ctx, theme: t } = this;
    const r = this.mini ? 0.75 : 0.5;
    ctx.save();
    ctx.translate(a.x, a.y);
    if (a.dead) {
      ctx.strokeStyle = t.critical;
      ctx.lineWidth = 0.18;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r, -r);
      ctx.lineTo(r, r);
      ctx.moveTo(r, -r);
      ctx.lineTo(-r, r);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (t.dark && !this.mini) {
      ctx.shadowColor = a.color;
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = a.color;
    ctx.strokeStyle = t.casing;
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = t.casing;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a.heading) * r * 0.75, Math.sin(a.heading) * r * 0.75);
    ctx.arc(0, 0, r * 0.3, a.heading + 1.9, a.heading - 1.9, true);
    ctx.closePath();
    ctx.fill();
    if (a.hp !== undefined && !this.mini) {
      const f = Math.max(0, a.hp);
      ctx.lineWidth = 0.13;
      ctx.strokeStyle = alpha(t.dark ? '#ffffff' : '#000000', 0.15);
      ctx.beginPath();
      ctx.arc(0, 0, r + 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = f > 0.6 ? t.goodMark : f > 0.3 ? t.warn : t.critical;
      ctx.beginPath();
      ctx.arc(0, 0, r + 0.28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      ctx.stroke();
    }
    ctx.restore();
  }
}
