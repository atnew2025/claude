/** Reads the CSS design tokens so canvas drawing follows the active light/dark theme. */

const NAMES = [
  'bg', 'surface', 'raised', 'ground', 'grid-line', 'grid-major', 'ink', 'ink-2', 'muted', 'line', 'line-strong',
  'wall', 'wall-top', 'brush', 'brush-ink', 'mud', 'mud-ink', 'accent', 'accent-ink', 'heat', 'good', 'good-mark',
  'critical', 'warn', 'zone-shadow', 'zone-cross', 'zone-kill', 'trace', 'trace-b', 'wave', 'casing', 'theme-name',
  's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8',
];

const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Parses "r, g, b" token triples. */
const triple = (s) => s.split(',').map((v) => Number(v.trim()));

export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const t = {};
  for (const n of NAMES) t[camel(n)] = cs.getPropertyValue(`--${n}`).trim();
  t.dark = t.themeName === 'dark';
  t.heatRGB = triple(t.heat);
  t.traceRGB = triple(t.trace);
  t.traceBRGB = triple(t.traceB);
  t.waveRGB = triple(t.wave);
  t.series = [t.s1, t.s2, t.s3, t.s4, t.s5, t.s6, t.s7, t.s8];
  t.fontMono = cs.getPropertyValue('--font-mono').trim();
  t.fontDisplay = cs.getPropertyValue('--font-display').trim();
  return t;
}

/** Calls `cb` whenever the OS scheme or the viewer's explicit theme changes. */
export function watchTheme(cb) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', cb);
  new MutationObserver(cb).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/** Hex "#rrggbb" → rgba() string with alpha. */
export function alpha(hex, a) {
  if (!hex.startsWith('#')) return hex;
  const v = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  const n = parseInt(v, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Threat heat intensity in [0, 1] for an effective dps value (shared by map and legend). */
export const HEAT_SCALE = 45;
export const heatLevel = (dps) => (dps <= 0 ? 0 : Math.min(1, Math.sqrt(dps / HEAT_SCALE)));
