/**
 * Priority queues keyed by (k1, k2) pairs, compared lexicographically.
 * The secondary key is used for tie-breaking (A* prefers lower h on equal f)
 * and for D* Lite's two-part keys.
 */

const less = (a1, a2, b1, b2) => a1 < b1 || (a1 === b1 && a2 < b2);

/**
 * Lazy-deletion binary heap over integer payloads. Callers skip stale entries
 * themselves. Used where the node space is unbounded (space-time states).
 */
export class PairHeap {
  constructor(capacity = 256) {
    this.k1 = new Float64Array(capacity);
    this.k2 = new Float64Array(capacity);
    this.val = new Int32Array(capacity);
    this.size = 0;
  }

  _grow() {
    const cap = this.k1.length * 2;
    const k1 = new Float64Array(cap);
    const k2 = new Float64Array(cap);
    const val = new Int32Array(cap);
    k1.set(this.k1);
    k2.set(this.k2);
    val.set(this.val);
    this.k1 = k1;
    this.k2 = k2;
    this.val = val;
  }

  push(value, key1, key2 = 0) {
    if (this.size === this.k1.length) this._grow();
    const { k1, k2, val } = this;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(key1, key2, k1[p], k2[p])) break;
      k1[i] = k1[p];
      k2[i] = k2[p];
      val[i] = val[p];
      i = p;
    }
    k1[i] = key1;
    k2[i] = key2;
    val[i] = value;
  }

  get topK1() {
    return this.k1[0];
  }

  get topK2() {
    return this.k2[0];
  }

  pop() {
    const { k1, k2, val } = this;
    const top = val[0];
    const n = --this.size;
    if (n > 0) {
      const a1 = k1[n];
      const a2 = k2[n];
      const av = val[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && less(k1[c + 1], k2[c + 1], k1[c], k2[c])) c++;
        if (!less(k1[c], k2[c], a1, a2)) break;
        k1[i] = k1[c];
        k2[i] = k2[c];
        val[i] = val[c];
        i = c;
      }
      k1[i] = a1;
      k2[i] = a2;
      val[i] = av;
    }
    return top;
  }
}

/**
 * Indexed binary heap over node ids in [0, capacity). Supports insert,
 * decrease/increase key (`update`) and arbitrary removal in O(log n).
 */
export class IndexedHeap {
  constructor(capacity) {
    this.heap = new Int32Array(capacity);
    this.pos = new Int32Array(capacity).fill(-1);
    this.k1 = new Float64Array(capacity);
    this.k2 = new Float64Array(capacity);
    this.size = 0;
  }

  has(node) {
    return this.pos[node] !== -1;
  }

  get top() {
    return this.heap[0];
  }

  get topK1() {
    return this.size ? this.k1[this.heap[0]] : Infinity;
  }

  get topK2() {
    return this.size ? this.k2[this.heap[0]] : Infinity;
  }

  _less(a, b) {
    return less(this.k1[a], this.k2[a], this.k1[b], this.k2[b]);
  }

  _up(i) {
    const { heap, pos } = this;
    const node = heap[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pn = heap[p];
      if (!this._less(node, pn)) break;
      heap[i] = pn;
      pos[pn] = i;
      i = p;
    }
    heap[i] = node;
    pos[node] = i;
  }

  _down(i) {
    const { heap, pos } = this;
    const n = this.size;
    const node = heap[i];
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && this._less(heap[c + 1], heap[c])) c++;
      if (!this._less(heap[c], node)) break;
      heap[i] = heap[c];
      pos[heap[c]] = i;
      i = c;
    }
    heap[i] = node;
    pos[node] = i;
  }

  /** Inserts the node or changes its key if already queued. */
  update(node, key1, key2 = 0) {
    const i = this.pos[node];
    this.k1[node] = key1;
    this.k2[node] = key2;
    if (i === -1) {
      const j = this.size++;
      this.heap[j] = node;
      this.pos[node] = j;
      this._up(j);
    } else {
      this._up(i);
      this._down(this.pos[node]);
    }
  }

  pop() {
    const { heap, pos } = this;
    const top = heap[0];
    pos[top] = -1;
    const n = --this.size;
    if (n > 0) {
      heap[0] = heap[n];
      pos[heap[0]] = 0;
      this._down(0);
    }
    return top;
  }

  remove(node) {
    const i = this.pos[node];
    if (i === -1) return;
    const { heap, pos } = this;
    pos[node] = -1;
    const n = --this.size;
    if (i === n) return;
    heap[i] = heap[n];
    pos[heap[i]] = i;
    this._up(i);
    this._down(pos[heap[i]]);
  }

  clear() {
    for (let i = 0; i < this.size; i++) this.pos[this.heap[i]] = -1;
    this.size = 0;
  }
}
