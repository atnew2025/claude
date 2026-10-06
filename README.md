# Aegis Pathfinder

Attack-aware pathfinding: an agent crosses ground held by turrets, snipers, rotating lasers, mortar batteries and patrols. Aegis **recognises** those attacks (where they reach, how hard they hit and *when*) and plans routes with **twelve pathfinding methods** that you can watch, compare, race and stress-test in an interactive visualizer.

* Dependency-free ES modules. The same core runs in the browser and in Node ≥ 18.
* Every route is replayed against the true, continuous-time threat model, so planners are compared on what actually happens to the agent, not on their own cost estimates.

```
npm start          # visualizer at http://localhost:5173
npm run demo       # terminal demo: map, routes and a comparison table
npm test           # 26 tests, including cross-checks against a reference Dijkstra
npm run test:ui    # Chromium smoke test across all views, both themes, desktop + phone
```

`index.html` is a static page, so any static host (GitHub Pages included) can serve the repository root as is.

## What it does

### 1. Threat model

| Attacker | Pattern | Mechanics |
|---|---|---|
| Turret | constant | Radial fire with linear falloff, blocked by walls |
| Sniper nest | constant | Long, narrow cone (facing + field of view), blocked by walls |
| Laser sweeper | periodic | 1–4 rotating beams, lethal on contact, blocked by walls |
| Mortar strike | periodic | Timed area bombardment with a telegraphed warning, ignores walls |
| Patrol | moving | Walks a loop and fires at short range with line of sight |

Terrain matters too. Walls block movement and sight. **Brush** is slower (×1.6) but cuts incoming damage by 65%. **Mud** is ×2.6 slower. Every attacker is compiled into a sparse, time-dependent field of *effective* damage per second (`ThreatModel.rateAt(cell, t)`), plus a time-averaged and a worst-case field.

### 2. Attack recognition (`src/core/recognition.js`)

* **Zone classification** for every cell: safe, *cover shadow* (in range but out of sight), exposed, crossfire (two or more attackers) and kill zone.
* **Temporal signatures.** The dynamic field at each cell is observed as a black-box signal. Autocorrelation recovers its period, and the signal yields the duty cycle and the longest safe window per cycle. This is the planner's view of "the laser comes past every 3.5 s and the gap is 3.1 s".
* **Attribution.** For any cell: which attackers reach it, with mean and peak damage.
* **Adaptive planning.** It probes the corridor and dispatches Space-Time A* when timed attacks cross the best static route. It picks threat-aware A* for constant fire, Jump Point Search for open uniform ground, and explains the choice.

### 3. One objective, twelve planners

A route's score is **travel time + λ · damage**, where λ is the risk aversion. Per cell this becomes a cost density `move · (1 + λ · rate)`. Grid steps and any-angle segments are both priced as exact line integrals of that density, so all planners agree on what a path costs.

| Planner | Considers | Guarantee | Notes |
|---|---|---|---|
| **Adaptive** | terrain, risk, timing | inherits | Meta-planner driven by the recognition layer |
| **Space-Time A\*** | terrain, risk, timing | optimal in (cell, time)* | Continuous time, a hold action, wait-dominance pruning, and an exact heuristic from a backward Dijkstra over static fire |
| **Threat-aware A\*** | terrain, risk | optimal | Octile heuristic scaled by the minimum density |
| **Theta\*** | terrain, risk | near-optimal | Any-angle, with shortcuts priced by exact Amanatides–Woo line integrals |
| **Bidirectional A\*** | terrain, risk | optimal | Symmetric stopping rule (Goldberg & Harrelson) |
| **Weighted A\*** | terrain, risk | ≤ w × optimal | Inflated heuristic, far fewer expansions |
| **D\* Lite** | terrain, risk | optimal | Incremental replanning (Koenig & Likhachev), used by Recon |
| **Dijkstra** | terrain, risk | optimal | Uniform-cost baseline |
| **Flow Field** | terrain, risk | optimal for every cell | One wave from the goal steers any number of agents |
| **Jump Point Search** | distance | shortest distance | Variant without corner cutting. Blind to terrain and threats |
| **Greedy Best-First** | distance | none | Fast and short-sighted |
| **Breadth-First** | steps | fewest steps | Ignores time and risk |

\* Up to the time-bucket resolution and the pruning approximations documented in `spacetime.js`. Its plans are conservative: replaying one against the true model never costs more than the planner predicted.

### 4. Measured results (λ = 1, `npm run demo -- --map <id>`)

| Map | Space-Time A\* | Threat-aware A\* | Jump Point Search |
|---|---|---|---|
| Laser Gallery | 118.5 s, **0 damage** | 128.7 s, 78.7 damage | destroyed at 35 s |
| Mortar Marsh | **63.5 s**, 0 damage (times the strikes on the causeway) | 103.2 s, 0 damage (detours through mud) | destroyed at 47 s |
| Citadel | score **110.2** (98.5 s, 11.7 damage) | score 122.3 (94.7 s, 27.6 damage) | destroyed at 39 s |
| Crossfire Plaza | 86.7 s, 0 damage | 86.7 s, 0 damage (no timed threats, so Adaptive picks A\*) | destroyed at 28 s |

## The visualizer

* **Plan**: watch one planner's search grow (frontier, expanded set, backward search, jump points or goal waves), then deploy an agent against the live threats with an HP ring and a damage-over-time chart.
* **Compare**: up to eight planners. Each keeps a fixed colour, and their agents face the same lasers at the same time.
* **Race**: small multiples of all twelve searches, replayed at the same number of steps per second.
* **Risk sweep**: the time-vs-damage Pareto front across λ, for both static and time-aware planning. Click a point to replay that route.
* **Recon**: fog of war. The scout recognises attackers on contact, and D\* Lite repairs the plan. The panel reports the repair work next to what a fresh A\* would have needed.

Overlays: live, average or worst-case threat heat; recognised zones; attacker ranges; search trace; flow-field arrows. The map is editable. Paint walls, brush and mud, drag start and goal, and place, drag and tune attackers. Every edit re-runs the recognition and the current view. The cell inspector shows each cell's pattern, period, duty cycle, longest safe gap and the attackers that reach it.

## Library use

```js
import { loadScenario, ThreatModel, analyzeThreats, makeProblem, runPlanner } from './src/core/index.js';

const sc = loadScenario('gallery');
const model = new ThreatModel(sc.grid, sc.attackers);
const analysis = analyzeThreats(sc.grid, model);
const problem = makeProblem({
  grid: sc.grid, model, analysis,
  start: sc.grid.index(...sc.start), goal: sc.grid.index(...sc.goal),
  riskWeight: 1,
});

const { res, metrics } = runPlanner('auto', problem);
console.log(res.extra.decision.reason);
console.log(metrics.time, metrics.damage, metrics.survived);
```

Every planner returns `{ path, waypoints, cost, expanded, trace, extra }`. Time-aware plans add `extra.timeline` and `extra.waits`. `evaluate()` replays any result against the true threat model.

## Layout

```
index.html              visualizer shell
web/                    renderer (canvas), charts (SVG), app controller, styles
src/core/
  grid.js geometry.js   grid, neighbourhoods, exact grid traversal and line integrals
  threats.js            attacker models → time-dependent damage fields
  recognition.js        zones, temporal signatures, attribution, planner choice
  cost.js               the shared time + λ·damage cost model
  algorithms/           BFS, Dijkstra, Greedy, A*, WA*, bidirectional A*, JPS, Theta*,
                        Space-Time A*, D* Lite, flow fields
  planners.js           registry, metrics, risk sweeps
  simulate.js recon.js  continuous-time replay, fog-of-war reconnaissance
  maps.js               scenarios and the seeded cave generator
test/                   node:test suites
scripts/                demo, static server, browser smoke test
```
