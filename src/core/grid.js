/**
 * Grid world: terrain, walkability and 8-connected neighbourhoods.
 *
 * Coordinates: cell (x, y) covers the unit square [x, x+1) × [y, y+1); its
 * centre is (x + 0.5, y + 0.5). Cells are addressed by a flat index
 * `i = y * width + x` everywhere in the library.
 */

export const Terrain = Object.freeze({ OPEN: 0, WALL: 1, BRUSH: 2, MUD: 3 });

/**
 * move     — travel-time multiplier (seconds per cell of distance). Always ≥ 1
 *            so that plain octile/euclidean distance stays an admissible heuristic.
 * exposure — fraction of incoming fire that lands (brush gives concealment).
 */
export const TERRAIN_INFO = Object.freeze([
  { id: 0, key: 'open', name: 'Open ground', move: 1, exposure: 1, walkable: true, blocksSight: false },
  { id: 1, key: 'wall', name: 'Wall', move: Infinity, exposure: 0, walkable: false, blocksSight: true },
  { id: 2, key: 'brush', name: 'Brush (cover)', move: 1.6, exposure: 0.35, walkable: true, blocksSight: false },
  { id: 3, key: 'mud', name: 'Mud', move: 2.6, exposure: 1, walkable: true, blocksSight: false },
]);

export const SQRT2 = Math.SQRT2;

/** Cardinal directions first, then diagonals. */
export const DIRS = Object.freeze([
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]);

export class Grid {
  /**
   * @param {number} width
   * @param {number} height
   * @param {Uint8Array} [cells]
   */
  constructor(width, height, cells) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cells = cells ? new Uint8Array(cells) : new Uint8Array(this.size);
  }

  index(x, y) {
    return y * this.width + x;
  }

  xOf(i) {
    return i % this.width;
  }

  yOf(i) {
    return (i / this.width) | 0;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x, y) {
    return this.cells[y * this.width + x];
  }

  set(x, y, terrain) {
    if (this.inBounds(x, y)) this.cells[y * this.width + x] = terrain;
  }

  walkable(i) {
    return this.cells[i] !== Terrain.WALL;
  }

  /** Bounds-checked walkability by coordinates. */
  open(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.cells[y * this.width + x] !== Terrain.WALL;
  }

  blocksSight(x, y) {
    return !this.inBounds(x, y) || this.cells[y * this.width + x] === Terrain.WALL;
  }

  moveCost(i) {
    return TERRAIN_INFO[this.cells[i]].move;
  }

  exposure(i) {
    return TERRAIN_INFO[this.cells[i]].exposure;
  }

  /**
   * Writes the walkable neighbours of cell `i` into `out` and returns how many
   * there are. Diagonal steps are only allowed when both orthogonal cells are
   * open, so paths never squeeze between two walls touching at a corner.
   */
  neighbors(i, diagonal, out) {
    const w = this.width;
    const x = i % w;
    const y = (i / w) | 0;
    let n = 0;
    const e = this.open(x + 1, y);
    const wv = this.open(x - 1, y);
    const s = this.open(x, y + 1);
    const nn = this.open(x, y - 1);
    if (e) out[n++] = i + 1;
    if (wv) out[n++] = i - 1;
    if (s) out[n++] = i + w;
    if (nn) out[n++] = i - w;
    if (diagonal) {
      if (e && s && this.open(x + 1, y + 1)) out[n++] = i + w + 1;
      if (e && nn && this.open(x + 1, y - 1)) out[n++] = i - w + 1;
      if (wv && s && this.open(x - 1, y + 1)) out[n++] = i + w - 1;
      if (wv && nn && this.open(x - 1, y - 1)) out[n++] = i - w - 1;
    }
    return n;
  }

  /** Euclidean length of a single step between adjacent cells. */
  stepLength(a, b) {
    const w = this.width;
    return a % w !== b % w && ((a / w) | 0) !== ((b / w) | 0) ? SQRT2 : 1;
  }

  /** Octile distance between two cells (exact shortest 8-connected distance on an empty grid). */
  octile(a, b) {
    const w = this.width;
    const dx = Math.abs((a % w) - (b % w));
    const dy = Math.abs(((a / w) | 0) - ((b / w) | 0));
    return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
  }

  manhattan(a, b) {
    const w = this.width;
    return Math.abs((a % w) - (b % w)) + Math.abs(((a / w) | 0) - ((b / w) | 0));
  }

  euclidean(a, b) {
    const w = this.width;
    return Math.hypot((a % w) - (b % w), ((a / w) | 0) - ((b / w) | 0));
  }

  clone() {
    return new Grid(this.width, this.height, this.cells);
  }

  /** True when every walkable cell has the same movement multiplier. */
  isUniform() {
    let first = -1;
    for (let i = 0; i < this.size; i++) {
      const t = this.cells[i];
      if (t === Terrain.WALL) continue;
      if (first === -1) first = t;
      else if (TERRAIN_INFO[t].move !== TERRAIN_INFO[first].move) return false;
    }
    return true;
  }

  /**
   * Builds a grid from text rows. Default legend:
   * `.` open, `#` wall, `"` brush, `~` mud. Unknown characters are open.
   */
  static fromRows(rows, legend = { '.': 0, '#': 1, '"': 2, '~': 3 }) {
    const height = rows.length;
    const width = Math.max(...rows.map((r) => r.length));
    const grid = new Grid(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = legend[rows[y][x]];
        grid.cells[y * width + x] = t === undefined ? Terrain.OPEN : t;
      }
    }
    return grid;
  }

  toRows(legend = ['.', '#', '"', '~']) {
    const rows = [];
    for (let y = 0; y < this.height; y++) {
      let row = '';
      for (let x = 0; x < this.width; x++) row += legend[this.cells[y * this.width + x]];
      rows.push(row);
    }
    return rows;
  }
}
