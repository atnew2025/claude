/**
 * Aegis Pathfinder — attack-aware pathfinding toolkit.
 * Pure ES modules with no dependencies; runs in browsers and Node ≥ 18.
 */
export { Grid, Terrain, TERRAIN_INFO, DIRS, SQRT2 } from './grid.js';
export { PairHeap, IndexedHeap } from './heap.js';
export { traverse, hasLineOfSight, segmentIntegral, walkableLine, angleDiff } from './geometry.js';
export { ThreatModel, ATTACK_TYPES, DEFAULTS as ATTACK_DEFAULTS, normalizeAttacker } from './threats.js';
export { buildDensity, timeDensity, edgeCost, minDensity, pathCost, RiskMode } from './cost.js';
export { analyzeThreats, describeCell, recommendPlanner, estimatePeriod, Zone, ZONE_INFO, Pattern, PATTERN_LABEL } from './recognition.js';
export { TraceKind, Trace, decodeEvent } from './algorithms/common.js';
export { bfs, dijkstra, greedy, astar, weightedAstar, bidirectionalAstar, bestFirst } from './algorithms/bestfirst.js';
export { jps } from './algorithms/jps.js';
export { thetaStar } from './algorithms/thetastar.js';
export { spaceTimeAStar } from './algorithms/spacetime.js';
export { DStarLite } from './algorithms/dstarlite.js';
export { flowField, buildFlowField } from './algorithms/flowfield.js';
export { PLANNERS, plannerById, makeProblem, runPlanner, evaluate, riskSweep } from './planners.js';
export { simulate, sampleTrajectory, keyframesFromWaypoints, keyframesFromTimeline, trajectoryOf, polylineLength } from './simulate.js';
export { reconRun } from './recon.js';
export { SCENARIOS, loadScenario, caves, mulberry32, MAP_W, MAP_H } from './maps.js';
