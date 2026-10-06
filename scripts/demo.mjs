#!/usr/bin/env node
/**
 * Terminal demo: renders a scenario with its threat field and the routes of
 * several planners, then prints a comparison table.
 *
 *   node scripts/demo.mjs [--map citadel] [--risk 1] [--planners spacetime,astar,jps] [--seed 3]
 */
import {
  ThreatModel, analyzeThreats, makeProblem, runPlanner, plannerById, loadScenario, SCENARIOS, Terrain, ZONE_INFO,
} from '../src/core/index.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const mapId = args.map ?? 'citadel';
const risk = Number(args.risk ?? 1);
const ids = (args.planners ?? 'auto,spacetime,astar,theta,jps,bfs').split(',');
const color = process.stdout.isTTY && !process.env.NO_COLOR;

if (!SCENARIOS.some((s) => s.id === mapId)) {
  console.error(`Unknown map "${mapId}". Choose one of: ${SCENARIOS.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

const sc = loadScenario(mapId, Number(args.seed ?? 3));
const { grid } = sc;
const model = new ThreatModel(grid, sc.attackers);
const analysis = analyzeThreats(grid, model);
const start = grid.index(...sc.start);
const goal = grid.index(...sc.goal);
const problem = makeProblem({ grid, model, analysis, start, goal, riskWeight: risk, trace: false });
const runs = ids.map((id) => runPlanner(id, problem));

const esc = (code) => (color ? `\x1b[${code}m` : '');
const reset = esc(0);
const heat = (r) => {
  if (r <= 0) return '';
  const k = Math.min(1, r / 30);
  return esc(`48;2;${Math.round(60 + 170 * k)};${Math.round(40 + 30 * (1 - k))};${Math.round(40 + 20 * (1 - k))}`);
};
const marks = ['@', '*', '+', 'o', 'x', '%', '&', '='];
const fg = ['38;5;45', '38;5;226', '38;5;201', '38;5;118', '38;5;208', '38;5;51', '38;5;141', '38;5;231'];
const onPath = new Map();
runs.forEach((r, k) => r.res.path?.forEach((c) => onPath.has(c) || onPath.set(c, k)));
const attackerAt = new Map(model.units.map((u) => [u.spec.type === 'patrol' ? grid.index(...u.spec.route[0]) : grid.index(u.spec.x, u.spec.y), u.type[0].toUpperCase()]));

console.log(`\n${esc(1)}${sc.name}${reset}: ${sc.blurb}`);
console.log(`Risk aversion λ = ${risk}. Score = travel time + λ × damage.\n`);
for (let y = 0; y < grid.height; y++) {
  let line = '';
  for (let x = 0; x < grid.width; x++) {
    const c = grid.index(x, y);
    const t = grid.cells[c];
    let ch = t === Terrain.WALL ? '█' : t === Terrain.BRUSH ? '"' : t === Terrain.MUD ? '~' : '·';
    let style = t === Terrain.WALL ? esc('38;5;240') : esc('38;5;244');
    if (onPath.has(c)) {
      const k = onPath.get(c);
      ch = marks[k % marks.length];
      style = esc(fg[k % fg.length]) + esc(1);
    }
    if (attackerAt.has(c)) {
      ch = attackerAt.get(c);
      style = esc('38;5;196') + esc(1);
    }
    if (c === start) [ch, style] = ['S', esc('38;5;46') + esc(1)];
    if (c === goal) [ch, style] = ['G', esc('38;5;46') + esc(1)];
    line += heat(model.mean[c]) + style + ch + reset;
  }
  console.log(line);
}
console.log(`\nLegend: █ wall  " brush (cover)  ~ mud  S start  G goal  T/S/L/M/P attackers (turret, sniper, laser, mortar, patrol)`);
console.log(`Routes: ${runs.map((r, k) => `${esc(fg[k % fg.length])}${marks[k % marks.length]} ${r.planner.name}${reset}`).join('   ')}\n`);

const zoneLine = ZONE_INFO.map((z, i) => `${z.label}: ${analysis.counts[i]}`).join(' · ');
console.log(`Recognised zones: ${zoneLine}`);
for (const u of analysis.intel) {
  const period = u.period ? `, cycle ${u.period.toFixed(1)} s` : '';
  console.log(`  ${u.label.padEnd(14)} covers ${String(u.coverage).padStart(4)} cells, peak ${u.peak.toFixed(0).padStart(3)} dps${period}`);
}

const pad = (s, n) => String(s).padStart(n);
console.log(`\n${'Planner'.padEnd(20)}${pad('Time s', 9)}${pad('Damage', 9)}${pad('Score', 9)}${pad('Expanded', 10)}${pad('ms', 8)}  Outcome`);
for (const r of runs) {
  const m = r.metrics;
  if (!m.found) {
    console.log(`${r.planner.name.padEnd(20)}  no route (${m.reason ?? 'unreachable'})`);
    continue;
  }
  const outcome = m.survived ? 'arrives' : `destroyed at ${m.deathTime.toFixed(1)} s`;
  const via = r.res.extra?.decision ? ` → ${plannerById(r.res.extra.decision.id).name}` : '';
  console.log(
    `${(r.planner.name + via).padEnd(20).slice(0, 20)}${pad(m.time.toFixed(1), 9)}${pad(m.damage.toFixed(1), 9)}${pad(m.objective.toFixed(1), 9)}${pad(m.expanded, 10)}${pad(m.ms.toFixed(1), 8)}  ${outcome}`,
  );
}
const auto = runs.find((r) => r.res.extra?.decision);
if (auto) console.log(`\nAdaptive planner: ${auto.res.extra.decision.reason}`);
console.log('');
