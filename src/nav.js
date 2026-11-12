// Grid navigation + line-of-sight built from the colliders exported by Blender.
const CELL = 0.4;

export class Nav {
  constructor(level) {
    const b = level.bounds;
    this.minX = b.minX; this.minZ = -20; // playable hall only (the porch is handled separately)
    this.w = Math.round((b.maxX - b.minX) / CELL);
    this.h = Math.round(40 / CELL);
    this.walk = new Uint8Array(this.w * this.h);   // 1 = blocked for a body of radius ~0.34
    this.sight = new Uint8Array(this.w * this.h);  // 1 = blocks vision (tall things only)
    for (const c of level.colliders) {
      this.#stamp(this.walk, c, 0.34);
      if (c.max[1] >= 1.5 && c.tag !== 'exitdoor') this.#stamp(this.sight, c, 0);
    }
    this.freeCells = [];
    for (let i = 0; i < this.walk.length; i++) if (!this.walk[i]) this.freeCells.push(i);
  }

  #stamp(grid, c, r) {
    const x0 = Math.max(0, Math.floor((c.min[0] - r - this.minX) / CELL));
    const x1 = Math.min(this.w - 1, Math.floor((c.max[0] + r - this.minX) / CELL));
    const z0 = Math.max(0, Math.floor((c.min[2] - r - this.minZ) / CELL));
    const z1 = Math.min(this.h - 1, Math.floor((c.max[2] + r - this.minZ) / CELL));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const cx = this.minX + (x + 0.5) * CELL, cz = this.minZ + (z + 0.5) * CELL;
      if (cx > c.min[0] - r && cx < c.max[0] + r && cz > c.min[2] - r && cz < c.max[2] + r) grid[z * this.w + x] = 1;
    }
  }

  cx(x) { return Math.floor((x - this.minX) / CELL); }
  cz(z) { return Math.floor((z - this.minZ) / CELL); }
  center(i) { return { x: this.minX + ((i % this.w) + 0.5) * CELL, z: this.minZ + (Math.floor(i / this.w) + 0.5) * CELL }; }
  blocked(grid, x, z) {
    const ix = this.cx(x), iz = this.cz(z);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return true;
    return grid[iz * this.w + ix] === 1;
  }
  free(x, z) { return !this.blocked(this.walk, x, z); }

  #ray(grid, ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / (CELL * 0.45));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.blocked(grid, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }
  los(ax, az, bx, bz) { return this.#ray(this.sight, ax, az, bx, bz); }
  walkLos(ax, az, bx, bz) { return this.#ray(this.walk, ax, az, bx, bz); }

  nearestFree(x, z) {
    let ix = Math.min(this.w - 1, Math.max(0, this.cx(x))), iz = Math.min(this.h - 1, Math.max(0, this.cz(z)));
    if (!this.walk[iz * this.w + ix]) return iz * this.w + ix;
    for (let r = 1; r < 12; r++) {
      let best = -1, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const X = ix + dx, Z = iz + dz;
        if (X < 0 || Z < 0 || X >= this.w || Z >= this.h || this.walk[Z * this.w + X]) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = Z * this.w + X; }
      }
      if (best >= 0) return best;
    }
    return this.freeCells[0];
  }

  randomPoint(near, minD = 0, maxD = 1e9) {
    for (let k = 0; k < 60; k++) {
      const p = this.center(this.freeCells[(Math.random() * this.freeCells.length) | 0]);
      if (!near) return p;
      const d = Math.hypot(p.x - near.x, p.z - near.z);
      if (d >= minD && d <= maxD) return p;
    }
    return this.center(this.freeCells[(Math.random() * this.freeCells.length) | 0]);
  }

  /** A* on the grid, then string-pulled. Returns [{x,z}, ...] (without the start point). */
  path(ax, az, bx, bz) {
    const W = this.w, H = this.h, walk = this.walk;
    const start = this.nearestFree(ax, az), goal = this.nearestFree(bx, bz);
    if (start === goal) return [{ x: bx, z: bz }];
    const gs = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
    const gx = goal % W, gz = (goal / W) | 0;
    const hfn = (i) => { const dx = Math.abs((i % W) - gx), dz = Math.abs(((i / W) | 0) - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const heap = [[hfn(start), start]];
    gs[start] = 0;
    const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let p = 0; for (;;) { let l = p * 2 + 1, r = l + 1, m = p; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === p) break; [heap[p], heap[m]] = [heap[m], heap[p]]; p = m; } } return top; };
    let found = false;
    while (heap.length) {
      const [, cur] = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goal) { found = true; break; }
      const x = cur % W, z = (cur / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const X = x + dx, Z = z + dz;
        if (X < 0 || Z < 0 || X >= W || Z >= H) continue;
        const n = Z * W + X;
        if (walk[n] || closed[n]) continue;
        if (dx && dz && (walk[z * W + X] || walk[Z * W + x])) continue; // no corner cutting
        const g = gs[cur] + (dx && dz ? 1.414 : 1);
        if (g < gs[n]) { gs[n] = g; from[n] = cur; push(g + hfn(n), n); }
      }
    }
    if (!found) return [];
    const cells = [];
    for (let c = goal; c !== -1 && c !== start; c = from[c]) cells.push(this.center(c));
    cells.reverse();
    // string pulling
    const out = [];
    let ax0 = ax, az0 = az, i = 0;
    if (!this.free(ax, az)) { const s = this.center(start); ax0 = s.x; az0 = s.z; out.push(s); }
    while (i < cells.length) {
      let j = Math.min(cells.length - 1, i + 40);
      while (j > i && !this.walkLos(ax0, az0, cells[j].x, cells[j].z)) j--;
      out.push(cells[j]);
      ax0 = cells[j].x; az0 = cells[j].z;
      i = j + 1;
    }
    return out;
  }
}
