/**
 * Aegis Pathfinder — interactive visualizer.
 * Five views share one world: Plan (animated search + agent), Compare (paths and
 * agents of up to 8 planners), Race (small multiples of every planner's
 * search), Risk sweep (Pareto front) and Recon (fog of war with D* Lite).
 */
import * as core from '../src/core/index.js';
import { MapRenderer, TraceView } from './renderer.js';
import { readTheme, watchTheme, alpha, HEAT_SCALE } from './theme.js';
import { damageChart, paretoChart, hideTip } from './charts.js';

const HP = 100;
const $ = (s) => document.querySelector(s);
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmt1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const LAMBDA_MAX = 20;
const sliderToLambda = (s) => (s <= 0 ? 0 : Number((0.05 * (LAMBDA_MAX / 0.05) ** (s / 100)).toPrecision(2)));
const lambdaToSlider = (l) => (l <= 0 ? 0 : Math.round((100 * Math.log(l / 0.05)) / Math.log(LAMBDA_MAX / 0.05)));

/* ── Icons (24×24, currentColor) ───────────────────────── */
const ICON = {
  inspect: '<path d="M6 3l12 8.5-5.2 1.2 3 6-2.4 1.2-3-6L6 18z" fill="currentColor"/>',
  wall: '<path d="M3 6h18v4H3zM3 14h18v4H3z" fill="currentColor"/><path d="M9 6v4M15 14v4" stroke="var(--surface)" stroke-width="1.5"/>',
  brush: '<path d="M5 19c0-5 2.5-9 2.5-9S10 14 10 19M11 19c0-7 3-12 3-12s3 5 3 12M16.5 19c0-4 2-7 2-7s2 3 2 7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  mud: '<path d="M3 9c3-2 6 2 9 0s6 2 9 0M3 15c3-2 6 2 9 0s6 2 9 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  ground: '<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M4 12h16M12 4v16" stroke="currentColor" stroke-width="1" opacity=".6"/>',
  erase: '<path d="M4 16l8-9 7 6-6 7H8z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M8 11l7 6" stroke="currentColor" stroke-width="1.8"/>',
  start: '<circle cx="12" cy="12" r="8" fill="currentColor"/><path d="M14.5 9.2c-.6-.8-1.5-1.2-2.6-1.2-1.4 0-2.4.8-2.4 1.9 0 2.6 5.3 1.5 5.3 4.3 0 1.2-1.1 2-2.7 2-1.2 0-2.2-.5-2.8-1.4" stroke="var(--surface)" stroke-width="1.6" fill="none"/>',
  goal: '<path d="M12 3l9 9-9 9-9-9z" fill="currentColor"/>',
  turret: '<circle cx="12" cy="12" r="7.5" fill="currentColor"/><circle cx="12" cy="12" r="2.8" fill="var(--surface)"/>',
  sniper: '<path d="M20 12L6 20l3-8-3-8z" fill="currentColor"/>',
  laser: '<path d="M12 3l9 9-9 9-9-9z" fill="currentColor"/><path d="M12 12l9-6" stroke="currentColor" stroke-width="2"/>',
  mortar: '<circle cx="12" cy="12" r="6.5" fill="currentColor"/><circle cx="12" cy="12" r="2.4" fill="var(--surface)"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="2"/>',
  patrol: '<path d="M18 12L8 18l2-6-2-6z" fill="currentColor"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.5 2.5" fill="none"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

const TERRAIN_TOOLS = [
  { id: 'inspect', label: 'Select' },
  { id: 'wall', label: 'Wall' },
  { id: 'brush', label: 'Brush' },
  { id: 'mud', label: 'Mud' },
  { id: 'ground', label: 'Ground' },
  { id: 'erase', label: 'Erase' },
  { id: 'start', label: 'Start' },
  { id: 'goal', label: 'Goal' },
];
const ATTACK_TOOLS = ['turret', 'sniper', 'laser', 'mortar', 'patrol'].map((id) => ({ id, label: core.ATTACK_TYPES[id].label.split(' ')[0] }));
const PAINT = { wall: core.Terrain.WALL, brush: core.Terrain.BRUSH, mud: core.Terrain.MUD, ground: core.Terrain.OPEN };

const EDIT_FIELDS = {
  turret: [['range', 'Range', 2, 14, 0.5], ['dps', 'Damage / s', 2, 60, 1]],
  sniper: [['range', 'Range', 4, 40, 1], ['dps', 'Damage / s', 2, 60, 1], ['facing', 'Facing °', 0, 359, 1], ['fov', 'Cone °', 4, 90, 1]],
  laser: [['range', 'Range', 2, 16, 0.5], ['dps', 'Damage / s', 10, 120, 1], ['period', 'Revolution s', 2, 16, 0.5], ['arms', 'Beams', 1, 4, 1], ['width', 'Beam width °', 4, 40, 1]],
  mortar: [['radius', 'Blast radius', 1, 6, 0.1], ['dps', 'Damage / s', 5, 90, 1], ['period', 'Cycle s', 2, 12, 0.5], ['active', 'Strike s', 0.3, 4, 0.1], ['offset', 'Offset s', 0, 12, 0.1]],
  patrol: [['range', 'Range', 1, 6, 0.1], ['dps', 'Damage / s', 2, 60, 1], ['speed', 'Speed cells/s', 0.5, 5, 0.1]],
};

/* ── Preferences ───────────────────────────────────────── */
const DEFAULTS = {
  planner: 'auto',
  riskWeight: 1,
  riskMode: 'mean',
  weight: 1.8,
  anim: 2.5,
  sensor: 6,
  diagonal: true,
  speed: 6,
  heat: 'live',
  overlays: { zones: false, ranges: true, search: true, flow: false },
  scenario: 'citadel',
};
const prefs = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('aegis-prefs') || '{}');
    return { ...DEFAULTS, ...saved, overlays: { ...DEFAULTS.overlays, ...(saved.overlays || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
})();
if (!core.plannerById(prefs.planner)) prefs.planner = 'auto';
function savePrefs() {
  try {
    localStorage.setItem('aegis-prefs', JSON.stringify(prefs));
  } catch {
    /* storage unavailable: preferences simply aren't remembered */
  }
}

/* ── State ─────────────────────────────────────────────── */
const state = {
  mode: 'plan',
  seed: 3,
  scenario: null,
  grid: null,
  attackers: [],
  start: -1,
  goal: -1,
  model: null,
  analysis: null,
  compareSet: new Map([['spacetime', 0], ['astar', 1], ['theta', 2], ['jps', 3], ['bfs', 4]]),
  tool: 'inspect',
  selected: -1,
  hover: -1,
  pinned: -1,
  clock: { t: 0, playing: !reduceMotion },
  agents: [],
  plan: null,
  compare: null,
  race: null,
  pareto: null,
  recon: null,
  flow: null,
  stale: false,
};

let theme = readTheme();
const renderer = new MapRenderer($('#map'));
renderer.setTheme(theme);
const liveField = { buf: null };
let chartHandle = null;

const color = (slot) => theme.series[slot % 8];

/* ── World ─────────────────────────────────────────────── */
function loadScenario(id) {
  const sc = core.loadScenario(id, state.seed);
  state.scenario = sc;
  state.grid = sc.grid;
  state.attackers = sc.attackers.map((a) => structuredClone(a));
  state.start = sc.grid.index(...sc.start);
  state.goal = sc.grid.index(...sc.goal);
  state.selected = -1;
  state.pinned = -1;
  $('#blurb').textContent = sc.blurb;
  $('#reseed').hidden = sc.id !== 'caves';
  rebuildThreats();
}

function rebuildThreats() {
  state.model = new core.ThreatModel(state.grid, state.attackers);
  state.analysis = core.analyzeThreats(state.grid, state.model);
  state.flow = null;
  liveField.buf = new Float32Array(state.grid.size);
  renderer.setWorld(state.grid, state.model, state.analysis);
  renderIntel();
  renderInspector();
}

function problem(trace) {
  return core.makeProblem({
    grid: state.grid,
    model: state.model,
    analysis: state.analysis,
    start: state.start,
    goal: state.goal,
    riskWeight: prefs.riskWeight,
    riskMode: prefs.riskMode,
    diagonal: prefs.diagonal,
    weight: prefs.weight,
    trace,
  });
}

/* ── Agents & clock ────────────────────────────────────── */
function agentOf(m, slot, label) {
  return { frames: m.frames, slot, label, curve: m.curve, dt: m.curveDt, deathTime: m.deathTime };
}

function deploy(agents) {
  state.agents = agents;
  state.clock.t = 0;
  if (!reduceMotion) state.clock.playing = true;
  syncPlayButton();
}

function damageAt(a, t) {
  if (t <= 0 || !a.curve.length) return 0;
  return a.curve[Math.min(a.curve.length - 1, Math.floor(t / a.dt))];
}

function clockRunning() {
  if (!state.clock.playing) return false;
  return !(state.mode === 'plan' && state.plan && state.plan.phase !== 'agent');
}

/* ── Runs ──────────────────────────────────────────────── */
function teardownRace() {
  state.race = null;
  $('#race').replaceChildren();
}

function run(animate = !reduceMotion && prefs.anim > 0) {
  hideTip();
  state.plan = state.compare = state.pareto = state.recon = null;
  state.agents = [];
  state.stale = false;
  if (state.mode !== 'race') teardownRace();
  if (state.mode === 'plan') runPlan(animate);
  else if (state.mode === 'compare') runCompare();
  else if (state.mode === 'race') runRace();
  else if (state.mode === 'pareto') runPareto();
  else runRecon();
  renderResults();
  renderLegend();
}

function runPlan(animate) {
  const r = core.runPlanner(prefs.planner, problem(true), { hp: HP });
  const trace = new TraceView(r.res.trace, state.grid.size);
  state.plan = { run: r, trace, phase: 'search', started: performance.now(), pathStart: 0 };
  state.clock.t = 0;
  if (!animate || !trace.length) finishSearch(true);
}

function finishSearch(instant = false) {
  const p = state.plan;
  p.trace.finish();
  p.phase = 'path';
  p.pathStart = performance.now() - (instant ? 10000 : 0);
}

function stepPlan(now) {
  const p = state.plan;
  if (!p || state.mode !== 'plan') return;
  if (p.phase === 'search') {
    const k = ((now - p.started) / 1000 / Math.max(0.1, prefs.anim)) * p.trace.length;
    p.trace.advanceTo(k);
    if (p.trace.done) finishSearch();
  } else if (p.phase === 'path' && now - p.pathStart > 700) {
    p.phase = 'agent';
    if (p.run.res.found) deploy([agentOf(p.run.metrics, 0, p.run.planner.name)]);
    renderResults();
  }
}

function runCompare() {
  const p = problem(false);
  const runs = [...state.compareSet].map(([id, slot]) => ({ ...core.runPlanner(id, p, { hp: HP }), slot }));
  state.compare = { runs };
  deploy(runs.filter((r) => r.res.found).map((r) => agentOf(r.metrics, r.slot, r.planner.name)));
}

function runRace() {
  teardownRace();
  const p = problem(true);
  const host = $('#race');
  const cells = core.PLANNERS.map((pl) => {
    const r = core.runPlanner(pl.id, p, { hp: HP });
    const node = document.createElement('article');
    node.className = 'race-cell';
    const via = r.res.extra?.decision ? ` → ${core.plannerById(r.res.extra.decision.id).name}` : '';
    node.innerHTML = `<header><h3 title="${esc(pl.name + via)}">${esc(pl.name + via)}</h3><span class="count">0</span></header><canvas></canvas><footer><span class="rank">&nbsp;</span><span class="res"></span></footer>`;
    host.appendChild(node);
    const rr = new MapRenderer(node.querySelector('canvas'), { mini: true });
    rr.setTheme(theme);
    rr.setWorld(state.grid, state.model, state.analysis);
    return { run: r, trace: new TraceView(r.res.trace, state.grid.size), renderer: rr, countEl: node.querySelector('.count'), rankEl: node.querySelector('.rank'), resEl: node.querySelector('.res'), rank: 0 };
  });
  const maxLen = Math.max(1, ...cells.map((c) => c.trace.length));
  const seconds = reduceMotion ? 0.01 : Math.max(1.5, prefs.anim * 1.6);
  state.race = { cells, started: performance.now(), rate: maxLen / seconds, finished: 0 };
}

function stepRace(now) {
  const r = state.race;
  if (!r || state.mode !== 'race') return;
  const k = ((now - r.started) / 1000) * r.rate;
  for (const c of r.cells) {
    c.trace.advanceTo(k);
    c.countEl.textContent = `${fmtInt(c.trace.closed)} expanded`;
    if (c.trace.done && !c.rank) {
      c.rank = ++r.finished;
      const m = c.run.metrics;
      c.rankEl.textContent = ordinal(c.rank);
      c.resEl.textContent = m.found ? `${fmt1(m.time)} s · ${fmt1(m.damage)} dmg` : 'no route';
      if (r.finished === r.cells.length) renderResults();
    }
  }
}

const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

function runPareto() {
  state.pareto = { pending: true };
  setTimeout(() => {
    if (state.mode !== 'pareto' || !state.pareto?.pending) return;
    const p = problem(false);
    const a = core.riskSweep(p, { planner: 'astar', hp: HP });
    const s = core.riskSweep(p, { planner: 'spacetime', lambdas: [0, 0.3, 1, 3], hp: HP });
    const all = [...a, ...s];
    for (const x of all) {
      x.pareto = !all.some((y) => y !== x && y.time <= x.time && y.damage <= x.damage && (y.time < x.time || y.damage < x.damage));
    }
    const groups = [
      { series: 'Threat-aware A*', slot: 0, points: a },
      { series: 'Space-Time A*', slot: 1, points: s },
    ];
    const score = (pt) => pt.time + prefs.riskWeight * pt.damage;
    const best = all.reduce((b, x) => (score(x) < score(b) ? x : b), all[0]);
    state.pareto = { groups, selected: null };
    selectPareto(best);
  }, 30);
}

function selectPareto(pt) {
  const st = state.pareto;
  if (!st || !pt) return;
  st.selected = pt;
  const g = st.groups.find((x) => x.points.includes(pt));
  deploy([{ frames: pt.frames, slot: g.slot, label: g.series, curve: pt.curve, dt: pt.curveDt, deathTime: pt.deathTime }]);
  renderResults();
}

function runRecon() {
  const { grid, model } = state;
  const rec = core.reconRun({ grid, model, start: state.start, goal: state.goal, diagonal: prefs.diagonal, riskWeight: prefs.riskWeight, sensorRange: prefs.sensor });
  const frames = core.keyframesFromTimeline(grid, rec.timeline, 'terrain');
  const sim = core.simulate(grid, model, frames, { hp: HP });
  const known = new Set();
  const events = rec.events.map((e) => {
    e.units.forEach((u) => known.add(u));
    const slice = rec.trace.events.slice(e.traceStart ?? 0, e.traceEnd);
    return { ...e, known: new Set(known), heat: model.meanOf([...known]), repair: [...new Set(slice.map((v) => Math.floor(v / 8)))] };
  });
  state.recon = { rec, events, frames, sim };
  deploy([{ frames, slot: 0, label: 'Recon agent', curve: sim.curve, dt: sim.dt, deathTime: sim.deathTime }]);
}

/* ── Per-frame view ────────────────────────────────────── */
function heatField() {
  if (prefs.heat === 'off') return null;
  if (state.mode === 'recon' && state.recon) return currentReconEvent()?.heat ?? null;
  if (prefs.heat === 'mean') return state.model.mean;
  if (prefs.heat === 'peak') return state.model.peak;
  return state.model.fieldAt(state.clock.t, liveField.buf);
}

function flowField() {
  if (!prefs.overlays.flow) return null;
  if (state.plan?.run.res.extra?.field) return state.plan.run.res.extra.field;
  if (!state.flow) state.flow = core.buildFlowField(state.grid, problem(false).density, state.goal, { diagonal: prefs.diagonal });
  return state.flow;
}

function waitsOf(res, c) {
  return (res.extra?.waits ?? []).filter((w) => w.t1 - w.t0 >= 0.49).map((w) => ({ cell: w.cell, color: c, label: `hold ${fmt1(w.t1 - w.t0)} s` }));
}

function currentReconEvent() {
  const r = state.recon;
  if (!r) return null;
  let cur = r.events[0];
  for (const e of r.events) if (e.t <= state.clock.t + 1e-9) cur = e;
  return cur;
}

function agentViews() {
  const t = state.clock.t;
  return state.agents.map((a) => {
    const dead = a.deathTime !== null && a.deathTime !== undefined && t >= a.deathTime;
    const p = core.sampleTrajectory(a.frames, dead ? a.deathTime : t);
    return { x: p.x, y: p.y, heading: p.heading, color: color(a.slot), hp: 1 - Math.min(HP, damageAt(a, t)) / HP, dead };
  });
}

function view() {
  const v = {
    t: state.clock.t,
    start: state.start,
    goal: state.goal,
    hover: state.hover,
    ranges: prefs.overlays.ranges,
    zones: prefs.overlays.zones,
    attackers: true,
    selected: state.selected,
    heat: heatField(),
    heatStrength: state.mode === 'compare' || state.mode === 'pareto' ? 0.65 : 1,
    flow: flowField(),
    paths: [],
    waits: [],
    agents: agentViews(),
  };
  if (state.mode === 'plan' && state.plan) {
    const p = state.plan;
    if (p.phase === 'search' || prefs.overlays.search) v.trace = p.trace;
    if (p.phase !== 'search' && p.run.res.found) {
      const progress = Math.min(1, (performance.now() - p.pathStart) / 700);
      v.paths.push({ waypoints: p.run.res.waypoints, color: color(0), progress });
      if (progress >= 1) v.waits = waitsOf(p.run.res, color(0));
    }
  } else if (state.mode === 'compare' && state.compare) {
    for (const r of state.compare.runs) {
      if (!r.res.found) continue;
      v.paths.push({ waypoints: r.res.waypoints, color: color(r.slot), width: 0.26 });
      v.waits.push(...waitsOf(r.res, color(r.slot)).map((w) => ({ ...w, label: '' })));
    }
  } else if (state.mode === 'pareto' && state.pareto?.groups) {
    for (const g of state.pareto.groups) {
      for (const pt of g.points) {
        if (pt !== state.pareto.selected) v.paths.push({ waypoints: pt.waypoints, color: color(g.slot), width: 0.16, alpha: 0.55, glow: false });
      }
    }
    const sel = state.pareto.selected;
    if (sel) v.paths.push({ waypoints: sel.waypoints, color: color(state.pareto.groups.find((g) => g.points.includes(sel)).slot), width: 0.34 });
  } else if (state.mode === 'recon' && state.recon) {
    const e = currentReconEvent();
    const r = state.recon;
    v.visible = e.known;
    v.revealHidden = true;
    const t = state.clock.t;
    const trail = r.frames.filter((f) => f.t <= t).map((f) => [f.x, f.y]);
    const here = core.sampleTrajectory(r.frames, t);
    trail.push([here.x, here.y]);
    if (e.path) {
      const w = state.grid.width;
      const ahead = e.path.slice(e.path.indexOf(nearestCell(here)) + 1).map((c) => [(c % w) + 0.5, ((c / w) | 0) + 0.5]);
      v.paths.push({ points: [[here.x, here.y], ...ahead], color: color(0), width: 0.2, dashed: true, alpha: 0.85, glow: false });
    }
    v.paths.push({ points: trail, color: color(0), width: 0.3 });
    v.sensor = { x: here.x, y: here.y, r: prefs.sensor };
    const fade = Math.max(0.6, prefs.speed * 0.6);
    v.pings = [];
    for (const ev of r.events) {
      const age = (t - ev.t) / fade;
      if (ev.type !== 'detect' || age < 0 || age > 1) continue;
      for (const u of ev.units) {
        const s = state.model.units[u].spec;
        const [ax, ay] = s.type === 'patrol' ? s.route[0] : [s.x, s.y];
        v.pings.push({ x: ax + 0.5, y: ay + 0.5, age });
      }
      v.repair = { cells: ev.repair, age };
    }
  }
  return v;
}

function nearestCell(p) {
  return state.grid.index(Math.min(state.grid.width - 1, Math.floor(p.x)), Math.min(state.grid.height - 1, Math.floor(p.y)));
}

function drawRace() {
  const r = state.race;
  if (!r) return;
  for (const c of r.cells) {
    const v = { t: 0, start: state.start, goal: state.goal, hover: -1, trace: c.trace, attackers: true, ranges: false, paths: [] };
    v.heat = state.model.mean;
    v.heatStrength = 0.55;
    if (c.rank && c.run.res.found) v.paths.push({ waypoints: c.run.res.waypoints, color: color(0), width: 0.5, glow: false });
    c.renderer.draw(v);
  }
}

/* ── HUD ───────────────────────────────────────────────── */
let lastBadge = '';
function badgeText() {
  const t = state.clock.t;
  if (state.mode === 'plan' && state.plan) {
    const p = state.plan;
    const name = p.run.planner.name;
    if (p.phase === 'search') return `<strong>${esc(name)}</strong> · searching · ${fmtInt(p.trace.closed)} expanded`;
    if (!p.run.res.found) return `<strong>${esc(name)}</strong> · no route found`;
    return `<strong>${esc(name)}</strong> · ${agentStatus(state.agents[0], t)}`;
  }
  if (state.mode === 'compare' && state.compare) {
    const alive = state.agents.filter((a) => !(a.deathTime !== null && t >= a.deathTime)).length;
    return `<strong>Compare</strong> · ${state.agents.length} agents deployed · ${alive} still standing`;
  }
  if (state.mode === 'pareto') {
    if (state.pareto?.pending) return '<strong>Risk sweep</strong> · computing routes for 14 risk weights…';
    const sel = state.pareto?.selected;
    return sel ? `<strong>Risk sweep</strong> · showing λ = ${sel.lambdas.join(', ')} · ${agentStatus(state.agents[0], t)}` : '';
  }
  if (state.mode === 'recon' && state.recon) {
    const e = currentReconEvent();
    return `<strong>Recon</strong> · recognised ${e.known.size} of ${state.model.units.length} attackers · ${agentStatus(state.agents[0], t)}`;
  }
  return '';
}

function agentStatus(a, t) {
  if (!a) return '';
  const end = a.frames[a.frames.length - 1].t;
  const dmg = damageAt(a, Math.min(t, end));
  if (a.deathTime !== null && a.deathTime !== undefined && t >= a.deathTime) return `destroyed at ${fmt1(a.deathTime)} s`;
  if (t >= end) return `arrived in ${fmt1(end)} s with ${fmt1(dmg)} damage`;
  return `en route · HP ${Math.max(0, Math.round(HP - dmg))}`;
}

function updateHud() {
  $('#clock').textContent = `t ${fmt1(state.clock.t)} s`;
  const b = badgeText();
  if (b !== lastBadge) {
    $('#badge').innerHTML = b;
    $('#badge').hidden = !b || state.mode === 'race';
    lastBadge = b;
  }
  chartHandle?.setNow(state.clock.t);
  if (state.mode === 'recon' && state.recon) {
    document.querySelectorAll('#recon-log li').forEach((li) => li.classList.toggle('past', Number(li.dataset.t) <= state.clock.t + 1e-9));
  }
}

/* ── Panels ────────────────────────────────────────────── */
function statusPill(m) {
  if (!m.found) return `<span class="status bad">${svgX()} No route</span>`;
  return m.survived
    ? `<span class="status good"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" stroke="currentColor" stroke-width="2" fill="none"/></svg>Arrives</span>`
    : `<span class="status bad">${svgX()}Destroyed at ${fmt1(m.deathTime)} s</span>`;
}
const svgX = () => '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="2"/></svg>';
const svgXInline = () => `<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" style="color:var(--critical);vertical-align:-1px"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="2"/></svg>`;
const deadMark = (m) => (m.survived ? '' : `<span role="img" aria-label="destroyed" title="Destroyed at ${fmt1(m.deathTime)} s">${svgXInline()}</span> `);

function meter(damage) {
  const f = Math.min(1, damage / HP);
  const cls = f >= 1 ? 'bad' : f > 0.4 ? 'warn' : '';
  return `<div class="meter ${cls}" role="img" aria-label="${fmt1(Math.max(0, HP - damage))} of ${HP} HP left"><i style="width:${(1 - f) * 100}%"></i></div>`;
}

function statsBlock(m, res) {
  return `<dl class="stats">
    <div><dt>Travel time</dt><dd>${fmt1(m.time)}<small> s</small></dd></div>
    <div><dt>Damage taken</dt><dd>${fmt1(m.damage)}<small> / ${HP}</small></dd>${meter(m.damage)}</div>
    <div><dt>Score</dt><dd>${fmt1(m.objective)}</dd></div>
    <div><dt>Expanded</dt><dd>${fmtInt(m.expanded)}</dd></div>
    <div><dt>Compute</dt><dd>${m.ms < 10 ? m.ms.toFixed(1) : fmtInt(m.ms)}<small> ms</small></dd></div>
    <div><dt>${res.extra?.waits?.length ? 'Holds' : 'Distance'}</dt><dd>${res.extra?.waits?.length ? `${res.extra.waits.length}<small> × ${fmt1(res.extra.waits.reduce((s, w) => s + w.t1 - w.t0, 0))} s</small>` : `${fmt1(m.distance)}<small> cells</small>`}</dd></div>
  </dl>`;
}

function renderResults() {
  const host = $('#results');
  chartHandle = null;
  const mode = state.mode;
  if (mode === 'plan') {
    const p = state.plan;
    if (!p) return void (host.innerHTML = '<h2>Route report</h2><p class="empty">Press Run to plan a route.</p>');
    const { run: r } = p;
    const m = r.metrics;
    const decision = r.res.extra?.decision;
    if (!m.found) {
      host.innerHTML = `<h2>Route report</h2><div class="report-head"><span class="who">${esc(r.planner.name)}</span>${statusPill(m)}</div><p class="hint">${esc(m.reason ?? 'The goal is unreachable from the start.')}</p>`;
      return;
    }
    host.innerHTML = `<h2>Route report <small>λ = ${prefs.riskWeight}</small></h2>
      <div class="report-head"><span class="who">${esc(r.planner.name)}${decision ? ` → ${esc(decision.name)}` : ''}</span>${statusPill(m)}</div>
      ${statsBlock(m, r.res)}
      ${decision ? `<p class="reason">${esc(decision.reason)}</p>` : ''}
      <div class="chart" id="dmg-chart"></div>`;
    chartHandle = damageChart($('#dmg-chart'), [{ label: r.planner.name, color: color(0), curve: m.curve, dt: m.curveDt, deathTime: m.deathTime }], { hp: HP, theme });
  } else if (mode === 'compare') {
    const c = state.compare;
    if (!c) return void (host.innerHTML = '<h2>Comparison</h2><p class="empty">Pick planners on the left, then press Run.</p>');
    const rows = [...c.runs].sort((a, b) => (a.metrics.objective ?? Infinity) - (b.metrics.objective ?? Infinity));
    const best = rows[0];
    host.innerHTML = `<h2>Comparison <small>λ = ${prefs.riskWeight} · best score first</small></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Planner</th><th>Time s</th><th>Damage</th><th>Score</th></tr></thead>
        <tbody>${rows.map((r) => {
          const m = r.metrics;
          return `<tr class="${r === best ? 'best' : ''}"><td><span class="sw" style="background:${color(r.slot)}"></span>${esc(r.planner.name)}<span class="sub">${fmtInt(m.expanded)} nodes · ${m.ms < 10 ? m.ms.toFixed(1) : fmtInt(m.ms)} ms</span></td>
            <td class="num">${m.found ? fmt1(m.time) : '—'}</td><td class="num">${m.found ? `${deadMark(m)}${fmt1(m.damage)}` : '—'}</td><td class="num">${m.found ? fmt1(m.objective) : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="hint" style="margin-top:6px">${svgXInline()} marks an agent destroyed before reaching the goal.</p>
      <div class="chart" id="dmg-chart"></div>`;
    const series = c.runs.filter((r) => r.metrics.found).map((r) => ({ label: r.planner.name, color: color(r.slot), curve: r.metrics.curve, dt: r.metrics.curveDt, deathTime: r.metrics.deathTime }));
    chartHandle = damageChart($('#dmg-chart'), series, { hp: HP, theme });
  } else if (mode === 'race') {
    const r = state.race;
    if (!r) return void (host.innerHTML = '<h2>Race</h2><p class="empty">Press Run to start the race.</p>');
    const rows = [...r.cells].sort((a, b) => a.trace.length - b.trace.length);
    host.innerHTML = `<h2>Race <small>finish order</small></h2>
      ${state.stale ? '<p class="reason">The map changed since this race. Press Start race to run it again.</p>' : ''}
      <p class="hint" style="margin-bottom:8px">Every planner replays its search at the same number of steps per second. A step is an expansion, a frontier update or a jump scan, so planners that touch fewer cells finish first.</p>
      <div class="table-wrap"><table><thead><tr><th>Planner</th><th>Steps</th><th>Time s</th><th>Damage</th></tr></thead>
      <tbody>${rows.map((c, k) => {
        const m = c.run.metrics;
        return `<tr><td>${k + 1}. ${esc(c.run.planner.name)}</td><td class="num">${fmtInt(c.trace.length)}</td><td class="num">${m.found ? fmt1(m.time) : '—'}</td><td class="num">${m.found ? `${deadMark(m)}${fmt1(m.damage)}` : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="hint" style="margin-top:6px">${svgXInline()} marks an agent destroyed before reaching the goal.</p>`;
  } else if (mode === 'pareto') {
    const st = state.pareto;
    if (!st || st.pending) return void (host.innerHTML = '<h2>Risk sweep</h2><p class="empty">Computing routes for each risk weight…</p>');
    const sel = st.selected;
    host.innerHTML = `<h2>Risk sweep</h2>
      <p class="hint">Each point is the best route for one risk weight λ. Filled points are on the Pareto front: no other route is both faster and safer. Click a point to replay it.</p>
      <div class="chart" id="pareto-chart"></div>
      ${sel ? `<div style="margin-top:12px">${statsBlock({ ...sel, objective: sel.time + prefs.riskWeight * sel.damage, expanded: sel.expanded ?? 0, ms: sel.ms ?? 0 }, {})}</div>` : ''}`;
    paretoChart($('#pareto-chart'), st.groups.map((g) => ({ ...g, color: color(g.slot) })), { theme, hp: HP, selected: sel, onSelect: selectPareto });
  } else {
    const r = state.recon;
    if (!r) return void (host.innerHTML = '<h2>Recon</h2><p class="empty">Press Run to send a scout in blind.</p>');
    const detects = r.events.filter((e) => e.type === 'detect');
    const m = { found: r.rec.found, time: r.sim.duration, damage: r.sim.damage, survived: r.sim.damage < HP, deathTime: r.sim.deathTime };
    const sumScratch = detects.reduce((s, e) => s + e.scratch, 0);
    const sumRepair = detects.reduce((s, e) => s + e.expanded, 0);
    host.innerHTML = `<h2>Recon <small>fog of war · D* Lite</small></h2>
      <div class="report-head"><span class="who">Scout, sensor ${prefs.sensor} cells</span>${statusPill(m)}</div>
      <dl class="stats">
        <div><dt>Travel time</dt><dd>${fmt1(m.time)}<small> s</small></dd></div>
        <div><dt>Damage taken</dt><dd>${fmt1(m.damage)}<small> / ${HP}</small></dd>${meter(m.damage)}</div>
        <div><dt>Recognised</dt><dd>${r.rec.known.length}<small> of ${state.model.units.length}</small></dd></div>
        <div><dt>Replans</dt><dd>${r.rec.replans}</dd></div>
        <div><dt>Repair work</dt><dd>${fmtInt(sumRepair)}<small> nodes</small></dd></div>
        <div><dt>Fresh A* would need</dt><dd>${fmtInt(sumScratch)}<small> nodes</small></dd></div>
      </dl>
      <p class="hint" style="margin-top:8px">The scout knows the terrain but not the enemy. It recognises an attacker when one comes within sensor range or opens fire, then D* Lite repairs the plan instead of starting over.</p>
      <ol class="log" id="recon-log">${r.events.map((e) => `<li data-t="${e.t}"><time>${fmt1(e.t)} s</time><span>${reconLine(e)}</span></li>`).join('')}</ol>
      <div class="chart" id="dmg-chart"></div>`;
    chartHandle = damageChart($('#dmg-chart'), [{ label: 'Scout', color: color(0), curve: r.sim.curve, dt: r.sim.dt, deathTime: r.sim.deathTime }], { hp: HP, theme });
  }
}

function reconLine(e) {
  if (e.type === 'plan') {
    return e.units.length ? `Initial plan with ${e.units.length} attacker(s) in view: ${fmtInt(e.expanded)} nodes.` : `Initial plan with no threats known: ${fmtInt(e.expanded)} nodes.`;
  }
  if (e.type === 'stuck') return 'No safe route left.';
  const names = e.units.map((u) => core.ATTACK_TYPES[state.model.units[u].type].label).join(', ');
  return `<b>${esc(names)}</b> recognised. Plan repaired with ${fmtInt(e.expanded)} nodes (fresh A*: ${fmtInt(e.scratch)}).`;
}

function renderIntel() {
  const a = state.analysis;
  const m = state.model;
  if (!a) return;
  const zones = [
    { k: 'Safe', n: a.counts[0], c: alpha(theme.muted, 0.35) },
    { k: 'Cover shadow', n: a.counts[1], c: theme.zoneShadow },
    { k: 'Exposed', n: a.counts[2], c: `rgba(${theme.heatRGB.join(',')}, 0.45)` },
    { k: 'Crossfire', n: a.counts[3], c: theme.zoneCross },
    { k: 'Kill zone', n: a.counts[4], c: theme.zoneKill },
  ];
  const total = zones.reduce((s, z) => s + z.n, 0) || 1;
  const probe = core.astar({ ...problem(false), trace: false });
  const rec = core.recommendPlanner(state.grid, m, a, probe.path);
  const recName = core.plannerById(rec.id).name;
  $('#intel').innerHTML = `<h2>Threat recognition <small>${m.units.length} attackers</small></h2>
    <div class="zonebar" role="img" aria-label="Walkable ground by zone">${zones.map((z) => (z.n ? `<i style="flex:${z.n};background:${z.c}" title="${z.k}: ${z.n} cells"></i>` : '')).join('')}</div>
    <div class="zone-legend">${zones.map((z) => `<span><i style="background:${z.c}"></i>${z.k}<b>${Math.round((100 * z.n) / total)}%</b></span>`).join('')}</div>
    <ul class="intel-list">${a.intel.map((u) => {
      const cyc = u.period ? `cycle ${fmt1(u.period)} s` : u.pattern === 'static' ? 'constant' : '';
      return `<li data-unit="${u.index}" ${state.selected === u.index ? 'aria-current="true"' : ''} title="Select to edit">
        <span style="color:${theme.zoneKill}">${svg(u.type)}</span>
        <span><span class="t">${esc(u.label)}</span><span class="d"><span class="tag ${u.pattern}">${u.pattern}</span> ${esc(cyc)}</span></span>
        <span class="v">${fmtInt(u.coverage)} cells<br>${Math.round(u.peak)} dps peak</span></li>`;
    }).join('') || '<li style="cursor:default"><span></span><span class="d">No attackers on this map.</span><span></span></li>'}</ul>
    <p class="reason"><b>Adaptive pick: ${esc(recName)}.</b> ${esc(rec.reason)}</p>`;
  $('#intel').querySelectorAll('[data-unit]').forEach((li) =>
    li.addEventListener('click', () => {
      state.selected = Number(li.dataset.unit);
      setTool('inspect');
      renderInspector();
      renderIntel();
    }),
  );
}

function renderInspector() {
  const host = $('#inspector');
  if (state.selected >= 0 && state.attackers[state.selected]) {
    const spec = state.attackers[state.selected];
    const fields = EDIT_FIELDS[spec.type];
    const full = core.ATTACK_DEFAULTS[spec.type];
    host.innerHTML = `<h2>${esc(core.ATTACK_TYPES[spec.type].label)} <small>#${state.selected + 1}</small></h2>
      <p class="hint" style="margin-bottom:10px">${esc(core.ATTACK_TYPES[spec.type].blurb)}. Drag it on the map to move it.</p>
      <div class="editor">${fields.map(([k, label, min, max, step]) => {
        const val = spec[k] ?? full[k];
        return `<div class="param"><div class="param-head"><label class="label" for="ed-${k}">${label}</label><output id="ed-${k}-out">${val}</output></div>
          <input type="range" id="ed-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
      }).join('')}</div>
      <div class="row-actions"><button class="btn small" id="ed-delete" type="button">Remove attacker</button><button class="btn small" id="ed-done" type="button">Done</button></div>`;
    host.querySelectorAll('input[type=range]').forEach((inp) =>
      inp.addEventListener('input', () => {
        spec[inp.dataset.k] = Number(inp.value);
        host.querySelector(`#ed-${inp.dataset.k}-out`).textContent = inp.value;
        scheduleRebuild();
      }),
    );
    $('#ed-delete').addEventListener('click', () => removeAttacker(state.selected));
    $('#ed-done').addEventListener('click', () => {
      state.selected = -1;
      renderInspector();
      renderIntel();
    });
    return;
  }
  const cell = state.hover >= 0 ? state.hover : state.pinned;
  if (cell < 0 || !state.analysis) {
    host.innerHTML = '<h2>Inspector</h2><p class="empty">Point at the map to see what the recognizer knows about a cell: which attackers reach it, how hard and when.</p>';
    return;
  }
  const g = state.grid;
  const info = core.describeCell(g, state.model, state.analysis, cell);
  const terr = core.TERRAIN_INFO[g.cells[cell]];
  const periodic = info.pattern === 'Periodic';
  host.innerHTML = `<h2>Inspector <small>cell ${info.x}, ${info.y}</small></h2>
    <dl class="kv">
      <dt>Terrain</dt><dd>${esc(terr.name)}${terr.walkable ? ` · ×${terr.move} time` : ''}</dd>
      ${terr.walkable ? `<dt>Zone</dt><dd>${esc(info.zone.label)}</dd>
      <dt>Average fire</dt><dd>${fmt1(info.mean)} dps</dd>
      <dt>Worst case</dt><dd>${fmt1(info.peak)} dps</dd>
      <dt>Pattern</dt><dd>${esc(info.pattern)}${periodic ? ` · ${fmt1(info.period)} s cycle` : ''}</dd>
      ${info.peak > 0 && info.pattern !== 'Constant fire' ? `<dt>Under fire</dt><dd>${Math.round(info.duty * 100)}% of the time</dd><dt>Longest safe gap</dt><dd>${fmt1(info.safeWindow)} s</dd>` : ''}` : ''}
    </dl>
    ${info.sources.length ? `<ul class="sources">${info.sources.map((s) => `<li><span>${esc(s.unit.info.label)} #${s.unit.index + 1}</span><span>${fmt1(s.mean)} avg · ${fmt1(s.peak)} peak</span></li>`).join('')}</ul>` : ''}`;
}

function renderPlanners() {
  const host = $('#planner-list');
  const note = $('#planner-mode-note');
  const blurb = $('#planner-blurb');
  const mode = state.mode;
  const pips = (p) => `<span class="pips" aria-label="Considers ${[p.aware.terrain && 'terrain', p.aware.threat && 'threats', p.aware.timing && 'timing'].filter(Boolean).join(', ') || 'distance only'}">
      <span class="pip ${p.aware.terrain ? 'on' : ''}" title="Terrain costs">T</span><span class="pip ${p.aware.threat ? 'on' : ''}" title="Threat exposure">R</span><span class="pip ${p.aware.timing ? 'on' : ''}" title="Attack timing">⏱</span></span>`;
  if (mode === 'plan' || mode === 'compare') {
    const multi = mode === 'compare';
    note.textContent = multi ? `${state.compareSet.size} of 8 max` : '';
    host.setAttribute('role', multi ? 'group' : 'radiogroup');
    host.innerHTML = core.PLANNERS.map((p) => {
      const slot = state.compareSet.get(p.id);
      const checked = multi ? slot !== undefined : prefs.planner === p.id;
      const full = multi && !checked && state.compareSet.size >= 8;
      const sw = multi && checked ? `style="--swatch:${color(slot)}"` : '';
      return `<label class="planner ${multi ? 'checkbox' : ''}" ${sw}>
        <input type="${multi ? 'checkbox' : 'radio'}" name="planner" value="${p.id}" ${checked ? 'checked' : ''} ${full ? 'disabled' : ''}>
        <span class="dot"></span><span class="name">${esc(p.name)}</span>${pips(p)}</label>`;
    }).join('');
    host.hidden = false;
    host.querySelectorAll('input').forEach((inp) =>
      inp.addEventListener('change', () => {
        if (multi) {
          if (inp.checked) {
            const used = new Set(state.compareSet.values());
            let s = 0;
            while (used.has(s)) s++;
            state.compareSet.set(inp.value, s);
          } else state.compareSet.delete(inp.value);
          renderPlanners();
          run(false);
        } else {
          prefs.planner = inp.value;
          savePrefs();
          renderPlanners();
          run();
        }
      }),
    );
    const p = core.plannerById(prefs.planner);
    const key = '<span class="meta">Considers: T terrain cost · R threat risk · ⏱ attack timing</span>';
    blurb.innerHTML = multi
      ? `Tick up to eight planners. Each keeps its colour while it stays selected. Their agents face the same live threats at the same time.${key}`
      : `<strong>${esc(p.name)}</strong>${esc(p.blurb)}<span class="meta">${esc(p.family)} · guarantee: ${esc(p.optimal)}</span>${key}`;
  } else {
    host.hidden = true;
    note.textContent = '';
    blurb.innerHTML = {
      race: '<strong>All twelve planners</strong>Each panel replays one planner\'s search on this map. Uninformed searches flood the map, heuristics stay focused, and Jump Point Search only touches jump points.',
      pareto: '<strong>Threat-aware A* and Space-Time A*</strong>Both are re-run for a range of risk weights, from λ = 0 (speed only) to λ = 20 (safety first).',
      recon: '<strong>D* Lite in fog of war</strong>The scout starts blind to attackers and only learns about them on contact. D* Lite keeps its search tree and repairs it after each discovery.',
    }[mode];
  }
}

function renderTools() {
  const mk = (t) => `<button class="tool" type="button" data-tool="${t.id}" aria-pressed="${state.tool === t.id}" title="${t.label}">${svg(t.id === 'ground' ? 'ground' : t.id)}<span>${t.label}</span></button>`;
  $('#tools-terrain').innerHTML = TERRAIN_TOOLS.map(mk).join('');
  $('#tools-attack').innerHTML = ATTACK_TOOLS.map(mk).join('');
  $('#tools-attack').style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';
  document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
}

function setTool(id) {
  state.tool = id;
  document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
  $('#map').style.cursor = id === 'inspect' ? 'default' : 'crosshair';
}

function renderLegend() {
  const items = [
    `<span><i style="background:${theme.ink};border-radius:50%"></i>Start</span>`,
    `<span><i style="background:${theme.goodMark};transform:rotate(45deg) scale(.8)"></i>Goal</span>`,
    `<span><i style="background:${theme.wall}"></i>Wall</span>`,
    `<span><i style="background:${theme.brush};box-shadow:inset 0 0 0 1px ${theme.brushInk}"></i>Brush: slower, 65% less damage</span>`,
    `<span><i style="background:${theme.mud}"></i>Mud: 2.6× slower</span>`,
    `<span><i class="ramp"></i>Threat 0 → ${HEAT_SCALE}+ dps</span>`,
  ];
  if (prefs.overlays.zones) {
    items.push(
      `<span><i style="background:repeating-linear-gradient(45deg, ${theme.zoneCross} 0 2px, transparent 2px 5px)"></i>Crossfire</span>`,
      `<span><i style="background:repeating-linear-gradient(45deg, ${theme.zoneKill} 0 2px, transparent 2px 4px),repeating-linear-gradient(135deg, ${theme.zoneKill} 0 2px, transparent 2px 4px)"></i>Kill zone</span>`,
      `<span><i style="background:radial-gradient(circle, ${theme.zoneShadow} 0 2px, transparent 2.5px) 0 0/7px 7px"></i>Cover shadow</span>`,
    );
  }
  if (state.mode === 'plan' && prefs.overlays.search) {
    items.push(`<span><i style="background:rgba(${theme.traceRGB.join(',')},.35)"></i>Searched</span>`, `<span><i style="background:rgba(${theme.traceRGB.join(',')},.75)"></i>Frontier</span>`);
    if (prefs.planner === 'bidir') items.push(`<span><i style="background:rgba(${theme.traceBRGB.join(',')},.6)"></i>Backward search</span>`);
    if (['flow', 'dstar'].includes(prefs.planner)) items.push(`<span><i style="background:rgba(${theme.waveRGB.join(',')},.6)"></i>Wave from goal</span>`);
  }
  if (state.mode === 'compare') {
    for (const [id, slot] of state.compareSet) items.push(`<span><i style="background:${color(slot)};height:4px"></i>${esc(core.plannerById(id).name)}</span>`);
  }
  if (state.mode === 'recon') items.push(`<span><i style="border:1.5px dashed ${theme.muted};border-radius:50%;background:transparent"></i>Not yet recognised</span>`);
  $('#legend').innerHTML = items.join('');
}

function updateRunLabel() {
  $('#run').textContent = { plan: 'Plan route', compare: 'Compare', race: 'Start race', pareto: 'Sweep risk', recon: 'Launch recon' }[state.mode];
  $('#replay').hidden = state.mode === 'race';
}

function syncPlayButton() {
  const b = $('#play');
  b.textContent = state.clock.playing ? 'Pause' : 'Play';
  b.setAttribute('aria-label', state.clock.playing ? 'Pause threat clock' : 'Play threat clock');
}

/* ── Editing ───────────────────────────────────────────── */
let rebuildTimer = 0;
function scheduleRebuild(delay = 140) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildThreats();
    refresh();
  }, delay);
}

let refreshQueued = false;
function refresh() {
  if (state.mode === 'race') {
    if (!state.stale) {
      state.stale = true;
      renderResults();
    }
    return;
  }
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    run(false);
  });
}

function hitAttacker(pt) {
  let best = -1;
  let bestD = 1.1;
  state.model.units.forEach((u) => {
    const s = u.spec;
    const p = s.type === 'patrol' ? u.stateAt(state.clock.t) : { x: s.x + 0.5, y: s.y + 0.5 };
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d < bestD) {
      bestD = d;
      best = u.index;
    }
  });
  return best;
}

function paintLine(a, b, terrain) {
  const g = state.grid;
  let [x0, y0] = [a % g.width, (a / g.width) | 0];
  const [x1, y1] = [b % g.width, (b / g.width) | 0];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    const c = g.index(x0, y0);
    if (!(terrain === core.Terrain.WALL && (c === state.start || c === state.goal))) g.cells[c] = terrain;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  renderer.invalidate();
}

function anchorOf(spec) {
  return spec.type === 'patrol' ? spec.route[0] : [spec.x, spec.y];
}

function addAttacker(type, cell) {
  const g = state.grid;
  const x = cell % g.width;
  const y = (cell / g.width) | 0;
  const spec = { type, x, y };
  if (type === 'sniper') spec.facing = Math.round((Math.atan2(g.height / 2 - y, g.width / 2 - x) * 180) / Math.PI + 360) % 360;
  if (type === 'patrol') {
    const x2 = Math.min(g.width - 1, x + 8);
    const y2 = Math.min(g.height - 1, y + 5);
    spec.route = [[x, y], [x2, y], [x2, y2], [x, y2]];
    delete spec.x;
    delete spec.y;
  }
  state.attackers.push(spec);
  state.selected = state.attackers.length - 1;
  rebuildThreats();
  refresh();
}

function removeAttacker(i) {
  if (i < 0) return;
  state.attackers.splice(i, 1);
  state.selected = -1;
  rebuildThreats();
  refresh();
}

function moveAttacker(i, cell) {
  const spec = state.attackers[i];
  const g = state.grid;
  const x = cell % g.width;
  const y = (cell / g.width) | 0;
  const [ax, ay] = anchorOf(spec);
  if (ax === x && ay === y) return;
  if (spec.type === 'patrol') spec.route = spec.route.map(([px, py]) => [Math.max(0, Math.min(g.width - 1, px + x - ax)), Math.max(0, Math.min(g.height - 1, py + y - ay))]);
  else {
    spec.x = x;
    spec.y = y;
  }
  scheduleRebuild(60);
}

function setEndpoint(which, cell) {
  if (!state.grid.walkable(cell) || cell === (which === 'start' ? state.goal : state.start)) return false;
  if (state[which] === cell) return false;
  state[which] = cell;
  state.flow = null;
  renderIntel();
  refresh();
  return true;
}

/* ── Wiring ────────────────────────────────────────────── */
function setMode(m) {
  state.mode = m;
  document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  $('#map-wrap').hidden = m === 'race';
  $('#race').hidden = m !== 'race';
  if (m !== 'race') teardownRace();
  lastBadge = '';
  renderPlanners();
  updateRunLabel();
  run();
}

function initControls() {
  const sel = $('#scenario');
  sel.innerHTML = core.SCENARIOS.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  sel.value = core.SCENARIOS.some((s) => s.id === prefs.scenario) ? prefs.scenario : 'citadel';
  sel.addEventListener('change', () => {
    prefs.scenario = sel.value;
    savePrefs();
    loadScenario(sel.value);
    run();
  });
  $('#reseed').addEventListener('click', () => {
    state.seed = 1 + Math.floor(Math.random() * 9999);
    loadScenario('caves');
    run();
  });
  document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  const risk = $('#risk');
  risk.value = lambdaToSlider(prefs.riskWeight);
  $('#risk-out').textContent = prefs.riskWeight;
  risk.addEventListener('input', () => {
    prefs.riskWeight = sliderToLambda(Number(risk.value));
    $('#risk-out').textContent = prefs.riskWeight;
    state.flow = null;
    savePrefs();
    renderIntel();
    refresh();
  });
  const bindRange = (id, key, fmt, onChange) => {
    const inp = $(`#${id}`);
    inp.value = prefs[key];
    $(`#${id}-out`).textContent = fmt(prefs[key]);
    inp.addEventListener('input', () => {
      prefs[key] = Number(inp.value);
      $(`#${id}-out`).textContent = fmt(prefs[key]);
      savePrefs();
      onChange?.();
    });
  };
  bindRange('weight', 'weight', (v) => `w = ${v}`, () => (state.mode === 'compare' || prefs.planner === 'wastar') && refresh());
  bindRange('anim', 'anim', (v) => (v ? `${v} s` : 'instant'));
  bindRange('sensor', 'sensor', (v) => `${v} cells`, () => state.mode === 'recon' && refresh());
  const diag = $('#diagonal');
  diag.checked = prefs.diagonal;
  diag.addEventListener('change', () => {
    prefs.diagonal = diag.checked;
    state.flow = null;
    savePrefs();
    refresh();
  });
  const segment = (id, get, set) => {
    const host = $(`#${id}`);
    const sync = () => host.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === get())));
    host.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        set(b.dataset.v);
        sync();
        savePrefs();
      }),
    );
    sync();
  };
  segment('risk-mode', () => prefs.riskMode, (v) => {
    prefs.riskMode = v;
    state.flow = null;
    refresh();
  });
  segment('heat-mode', () => prefs.heat, (v) => (prefs.heat = v));
  document.querySelectorAll('#overlays .chip').forEach((b) => {
    b.setAttribute('aria-pressed', String(!!prefs.overlays[b.dataset.k]));
    b.addEventListener('click', () => {
      prefs.overlays[b.dataset.k] = !prefs.overlays[b.dataset.k];
      b.setAttribute('aria-pressed', String(prefs.overlays[b.dataset.k]));
      savePrefs();
      renderLegend();
    });
  });
  const speed = $('#speed');
  speed.value = String(prefs.speed);
  speed.addEventListener('change', () => {
    prefs.speed = Number(speed.value);
    savePrefs();
  });
  $('#play').addEventListener('click', () => {
    state.clock.playing = !state.clock.playing;
    syncPlayButton();
  });
  $('#run').addEventListener('click', () => run());
  $('#replay').addEventListener('click', () => {
    if (state.agents.length) deploy(state.agents);
    else run(false);
  });
  $('#clear-attackers').addEventListener('click', () => {
    state.attackers = [];
    state.selected = -1;
    rebuildThreats();
    refresh();
  });
  $('#reset-map').addEventListener('click', () => {
    loadScenario(state.scenario.id);
    run();
  });
  syncPlayButton();

  // Map pointer interaction.
  const canvas = $('#map');
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const cell = renderer.cellAt(e.clientX, e.clientY);
    if (cell < 0) return;
    canvas.setPointerCapture(e.pointerId);
    const tool = state.tool;
    if (tool === 'inspect') {
      const hit = hitAttacker(renderer.pointAt(e.clientX, e.clientY));
      if (hit >= 0) {
        state.selected = hit;
        drag = { kind: 'attacker', index: hit };
        renderInspector();
        renderIntel();
      } else if (cell === state.start) drag = { kind: 'start' };
      else if (cell === state.goal) drag = { kind: 'goal' };
      else {
        state.selected = -1;
        state.pinned = cell;
        renderInspector();
        renderIntel();
      }
    } else if (PAINT[tool] !== undefined) {
      drag = { kind: 'paint', last: cell, terrain: PAINT[tool] };
      paintLine(cell, cell, PAINT[tool]);
      scheduleRebuild(250);
    } else if (tool === 'erase') {
      drag = { kind: 'erase' };
      eraseAt(cell);
    } else if (tool === 'start' || tool === 'goal') {
      setEndpoint(tool, cell);
      drag = { kind: tool };
    } else if (core.ATTACK_TYPES[tool]) addAttacker(tool, cell);
  });
  canvas.addEventListener('pointermove', (e) => {
    const cell = renderer.cellAt(e.clientX, e.clientY);
    if (cell !== state.hover) {
      state.hover = cell;
      if (state.selected < 0) renderInspector();
    }
    if (!drag || cell < 0) return;
    if (drag.kind === 'paint') {
      if (cell !== drag.last) {
        paintLine(drag.last, cell, drag.terrain);
        drag.last = cell;
        scheduleRebuild(250);
      }
    } else if (drag.kind === 'erase') eraseAt(cell);
    else if (drag.kind === 'start' || drag.kind === 'goal') setEndpoint(drag.kind, cell);
    else if (drag.kind === 'attacker') moveAttacker(drag.index, cell);
  });
  const end = () => {
    if (drag?.kind === 'paint') scheduleRebuild(0);
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => {
    state.hover = -1;
    if (state.selected < 0) renderInspector();
  });

  function eraseAt(cell) {
    const g = state.grid;
    const x = cell % g.width;
    const y = (cell / g.width) | 0;
    const i = state.attackers.findIndex((s) => {
      const [ax, ay] = anchorOf(s);
      return ax === x && ay === y;
    });
    if (i >= 0) removeAttacker(i);
    else if (g.cells[cell] !== core.Terrain.OPEN) {
      g.cells[cell] = core.Terrain.OPEN;
      renderer.invalidate();
      scheduleRebuild(250);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && !e.target.closest?.('button')) {
      e.preventDefault();
      state.clock.playing = !state.clock.playing;
      syncPlayButton();
    } else if (e.key === 'r' || e.key === 'R') run();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected >= 0) removeAttacker(state.selected);
    else if (e.key === 'Escape') {
      state.selected = -1;
      setTool('inspect');
      renderInspector();
      renderIntel();
    }
  });
}

watchTheme(() => {
  theme = readTheme();
  renderer.setTheme(theme);
  state.race?.cells.forEach((c) => c.renderer.setTheme(theme));
  renderResults();
  renderIntel();
  renderPlanners();
  renderLegend();
});

/* ── Boot ──────────────────────────────────────────────── */
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (clockRunning()) state.clock.t += dt * prefs.speed;
  stepPlan(now);
  stepRace(now);
  if (state.mode === 'race') drawRace();
  else renderer.draw(view());
  updateHud();
  requestAnimationFrame(frame);
}

initControls();
renderTools();
setTool('inspect');
loadScenario($('#scenario').value);
renderPlanners();
updateRunLabel();
renderLegend();
run();
requestAnimationFrame(frame);
