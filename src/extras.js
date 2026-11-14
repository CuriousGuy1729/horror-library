import * as THREE from 'three';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3();

// ====================================================================== Bats
export class Bats {
  constructor(scene, n = 40) {
    this.n = n;
    // one bat: body + two scalloped wings lying in the XZ plane, nose towards +Z
    const v = [], tri = (...a) => v.push(...a);
    tri(0, 0, 0.07, 0.022, 0, -0.03, -0.022, 0, -0.03); tri(0, 0.02, 0.0, 0.022, 0, -0.03, -0.022, 0, -0.03);       // body
    tri(0.012, 0.012, 0.085, 0.004, 0, 0.06, 0.02, 0, 0.06); tri(-0.012, 0.012, 0.085, -0.004, 0, 0.06, -0.02, 0, 0.06);   // ears
    for (const s of [-1, 1]) {
      tri(s * 0.02, 0, 0.04, s * 0.11, 0, 0.065, s * 0.075, 0, -0.01);
      tri(s * 0.02, 0, 0.04, s * 0.075, 0, -0.01, s * 0.02, 0, -0.035);
      tri(s * 0.11, 0, 0.065, s * 0.2, 0, 0.02, s * 0.14, 0, -0.02);
      tri(s * 0.11, 0, 0.065, s * 0.14, 0, -0.02, s * 0.075, 0, -0.01);
      tri(s * 0.075, 0, -0.01, s * 0.14, 0, -0.02, s * 0.1, 0, -0.055);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0x4a3a34, emissive: 0x030202, side: THREE.DoubleSide });
    this.uTime = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 7.0 + instanceMatrix[3].z * 3.0; float fl = sin(uTime * 34.0 + ph);
          float w = abs(position.x); transformed.y += w * fl * 0.95 - w * 0.2; transformed.x *= 1.0 - 0.28 * abs(fl);`);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, n); this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this.bats = Array.from({ length: n }, () => ({ on: false, u: 0, dur: 1, off: new THREE.Vector3(), ph: Math.random() * 10, a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), size: 1 }));
    _m.makeScale(0, 0, 0); for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, _m);
    scene.add(this.mesh); this.live = 0;
  }
  /** send `count` bats from a → (via) → c */
  burst(a, via, c, count = this.n, spread = 0.8, speed = 9) {
    let k = 0;
    const len = a.distanceTo(via) + via.distanceTo(c);
    for (const b of this.bats) {
      if (b.on) continue; if (k++ >= count) break;
      b.on = true; b.u = -Math.random() * 0.35; b.dur = len / (speed * (0.8 + Math.random() * 0.45));
      b.a.copy(a); b.b.copy(via); b.c.copy(c); b.size = 1.3 + Math.random() * 1.0;
      b.off.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 2).multiplyScalar(spread);
    }
  }
  update(dt, time) {
    this.uTime.value = time; let live = 0;
    for (let i = 0; i < this.n; i++) {
      const b = this.bats[i];
      if (!b.on) continue;
      b.u += dt / b.dur;
      if (b.u >= 1) { b.on = false; _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); continue; }
      live++;
      const u = Math.max(0, b.u), w = 1 - u;
      const at = (uu, out) => { const ww = 1 - uu; return out.set(0, 0, 0).addScaledVector(b.a, ww * ww).addScaledVector(b.b, 2 * ww * uu).addScaledVector(b.c, uu * uu); };
      at(u, _p); at(Math.min(1, u + 0.02), _t);
      const wob = 0.55 + 0.45 * Math.sin(u * 3.14159);
      _p.x += b.off.x * wob + Math.sin(time * 5 + b.ph) * 0.18; _p.y += b.off.y * wob + Math.sin(time * 7 + b.ph * 2) * 0.14; _p.z += b.off.z * wob + Math.cos(time * 6 + b.ph) * 0.18;
      _t.x += b.off.x * wob; _t.y += b.off.y * wob; _t.z += b.off.z * wob;
      _z.copy(_t).sub(_p); if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1);
      _m.lookAt(_t, _p, _up); _q.setFromRotationMatrix(_m);       // +Z of the bat looks along its travel
      const sc = b.size * Math.min(1, (b.u + 0.35) * 6) * Math.min(1, w * 8);
      _m.compose(_p, _q, _s.setScalar(Math.max(0.001, sc))); this.mesh.setMatrixAt(i, _m);
    }
    if (live || this.live) this.mesh.instanceMatrix.needsUpdate = true;
    this.live = live;
  }
}

// ====================================================================== Posters
const SCRAWL = '"Chiller", "Rock Salt", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
function drawPoster(g, w, h, spec, seed) {
  let s = seed * 9301 + 49297; const R = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  // aged paper
  const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#b9ab8a'); grd.addColorStop(0.5, '#a8987a'); grd.addColorStop(1, '#8c7d62');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${40 + R() * 40},${28 + R() * 30},${10 + R() * 20},${R() * 0.09})`; const r = 1 + R() * 14; g.beginPath(); g.ellipse(R() * w, R() * h, r, r * (0.4 + R()), R() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 5; i++) { const x = R() * w, y = R() * h, r = 40 + R() * 110; const st = g.createRadialGradient(x, y, r * 0.5, x, y, r); st.addColorStop(0, 'rgba(60,40,15,0)'); st.addColorStop(0.85, 'rgba(60,40,15,.16)'); st.addColorStop(1, 'rgba(60,40,15,0)'); g.fillStyle = st; g.fillRect(0, 0, w, h); }
  const edge = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.72); edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(25,14,4,.7)'); g.fillStyle = edge; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(40,25,10,.25)'; g.lineWidth = 1; for (let i = 0; i < 3; i++) { g.beginPath(); const y = h * (0.25 + i * 0.25) + R() * 20; g.moveTo(0, y); g.lineTo(w, y + R() * 8 - 4); g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // printed notice
  if (spec.print) {
    g.fillStyle = 'rgba(28,20,12,.82)'; g.strokeStyle = 'rgba(28,20,12,.7)'; g.lineWidth = 3; g.strokeRect(22, 22, w - 44, h - 44); g.lineWidth = 1; g.strokeRect(30, 30, w - 60, h - 60);
    g.font = '600 22px Georgia, serif'; g.fillText('S T .  A L D R I C  L I B R A R Y', w / 2, 62);
    g.font = `700 ${spec.print.length > 9 ? 54 : 78}px Georgia, serif`; g.fillText(spec.print, w / 2, 150);
    g.font = 'italic 21px Georgia, serif';
    (spec.small || []).forEach((l, i) => g.fillText(l, w / 2, 232 + i * 31));
  }
  if (spec.missing) {
    g.fillStyle = 'rgba(25,18,10,.85)'; g.font = '700 84px Georgia, serif'; g.fillText('MISSING', w / 2, 86);
    g.fillStyle = '#2b251c'; g.fillRect(w / 2 - 105, 140, 210, 250);
    const f = g.createRadialGradient(w / 2, 245, 10, w / 2, 255, 120); f.addColorStop(0, '#8d8473'); f.addColorStop(0.55, '#4f483c'); f.addColorStop(1, '#1d1912'); g.fillStyle = f;
    g.beginPath(); g.ellipse(w / 2, 245, 62, 82, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(w / 2, 400, 120, 70, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#0c0a07'; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(w / 2 + sx * 24, 232, 15, 11, 0, 0, 7); g.fill(); } g.beginPath(); g.ellipse(w / 2, 290, 16, spec.scream ? 26 : 5, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(25,18,10,.85)'; g.font = '600 26px Georgia, serif'; g.fillText(spec.name || 'LAST SEEN IN THE STACKS', w / 2, 425);
    g.font = 'italic 20px Georgia, serif'; g.fillText(spec.sub || 'Went in for one book. 14 Nov.', w / 2, 458);
  }
  // scrawled over it in something dark red
  if (spec.scrawl) {
    const lines = spec.scrawl.split('\n'), size = spec.size || (lines.some((l) => l.length > 11) ? 66 : 92);
    const y0 = (spec.y ?? (spec.print ? 0.66 : spec.missing ? 0.85 : 0.5)) * h - (lines.length - 1) * size * 0.52;
    lines.forEach((line, li) => {
      g.font = `700 ${size}px ${SCRAWL}`;
      const tw = Math.min(w - 50, g.measureText(line).width), y = y0 + li * size * 1.04;
      let x = w / 2 - tw / 2; const k = tw / g.measureText(line).width;
      for (const ch of line) {
        const cw = g.measureText(ch).width * k;
        g.save(); g.translate(x + cw / 2, y + (R() - 0.5) * 12); g.rotate((R() - 0.5) * 0.22); g.scale(k * (0.92 + R() * 0.2), 0.9 + R() * 0.3);
        g.fillStyle = `rgba(${78 + R() * 40},${4 + R() * 8},${4 + R() * 6},${0.78 + R() * 0.2})`; g.fillText(ch, 0, 0);
        g.restore();
        if (ch !== ' ' && R() < 0.3) { const dx = x + cw * (0.3 + R() * 0.4), len = 20 + R() * 110; const dg = g.createLinearGradient(0, y, 0, y + len); dg.addColorStop(0, 'rgba(92,6,6,.85)'); dg.addColorStop(1, 'rgba(92,6,6,0)'); g.fillStyle = dg; g.fillRect(dx, y + size * 0.2, 2.5 + R() * 3.5, len); }
        x += cw;
      }
    });
    if (spec.hand) { g.fillStyle = 'rgba(90,6,6,.6)'; const hx = w * (0.25 + R() * 0.5), hy = h * 0.86; g.beginPath(); g.ellipse(hx, hy, 34, 40, 0, 0, 7); g.fill(); for (let f = 0; f < 5; f++) { const a = -1.1 + f * 0.5; g.save(); g.translate(hx + Math.sin(a) * 36, hy - Math.cos(a) * 42); g.rotate(a); g.beginPath(); g.ellipse(0, -24, 9, 30, 0, 0, 7); g.fill(); g.restore(); } }
  }
}

export class Posters {
  constructor(scene, renderer) {
    const specs = [
      // [x, y, z, facing (-1 = looks north / -Z, 1 = looks south), spec]
      [-4, 1.75, -10, 1, { print: 'SILENCE', small: ['Patrons are reminded that', 'the Archivist is always listening.'], scrawl: 'IT HEARS\nYOU RUN', size: 70, y: 0.74 }],
      [4, 1.7, -10, 1, { scrawl: 'LOOK INTO\nITS EYES', hand: true }],
      [-4, 1.72, -5, 1, { missing: true, scrawl: 'STILL HERE', size: 64 }],
      [4, 1.74, 0, 1, { scrawl: 'IT FOLLOWS\nTHE LIGHT', size: 76 }],
      [-4, 1.7, 5, 1, { print: 'DO NOT RUN', small: ['Return all volumes before dusk.', 'Do not remain after the bell.'], scrawl: 'DONT\nLOOK UP', size: 78, y: 0.74 }],
      [4, 1.72, 10, 1, { scrawl: 'THEY CRAWL\nUNDER THE\nTABLES', size: 62, hand: true }],
      [-4, 1.74, 15, 1, { scrawl: 'NO ONE\nLEAVES' }],
      [4, 1.7, -5, -1, { missing: true, name: 'HAVE YOU SEEN HER?', sub: 'She only wanted to finish the chapter.', scream: true, scrawl: 'SHELVED', size: 70 }],
      [-4, 1.72, 0, -1, { scrawl: 'HE IS\nSTILL\nREADING', size: 80 }],
      [4, 1.74, 5, -1, { print: 'OVERDUE', small: ['Borrower: YOU', 'Fine: everything'], scrawl: 'HIDE', size: 110, y: 0.75 }],
      [-4, 1.7, 10, -1, { scrawl: 'STAY IN\nTHE CABINET', size: 66, hand: true }],
      [4, 1.72, 15, -1, { scrawl: 'TURN OFF\nTHE TORCH', size: 70 }],
      [-2.45, 1.8, 19.975, -1, { scrawl: 'THREE KEYS\nTHREE\nGRAVES', size: 64, wall: true }],
      [2.45, 1.8, 19.975, -1, { print: 'EXIT', small: ['These doors are locked at dusk.', 'No exceptions. No survivors.'], scrawl: 'GET OUT', size: 86, y: 0.76, wall: true }],
    ];
    const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const geo = new THREE.PlaneGeometry(0.56, 0.78);
    this.list = specs.map(([x, y, z, dir, spec], i) => {
      const c = document.createElement('canvas'); c.width = 420; c.height = 585;
      drawPoster(c.getContext('2d'), c.width, c.height, spec, i + 3);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }));
      mesh.position.set(x, y, spec.wall ? z : z + dir * 0.458); mesh.rotation.set(0, dir > 0 ? 0 : Math.PI, (((i * 37) % 9) - 4) * 0.012);
      mesh.receiveShadow = true; scene.add(mesh);
      return { mesh, canvas: c, tex, spec, seed: i + 3, changed: false, pos: mesh.position };
    });
  }
  /** rewrites a poster the player is not looking at; returns it (or null) */
  rewrite(text, camera, near) {
    camera.getWorldDirection(_t);
    const c = this.list.filter((p) => !p.changed && p.pos.distanceTo(near) < 16 && p.pos.distanceTo(near) > 3 && _p.copy(p.pos).sub(camera.position).normalize().dot(_t) < 0.2);
    if (!c.length) return null;
    const p = c[(Math.random() * c.length) | 0];
    p.changed = true; drawPoster(p.canvas.getContext('2d'), p.canvas.width, p.canvas.height, { scrawl: text, hand: true }, p.seed + 50); p.tex.needsUpdate = true;
    return p;
  }
  reset() { for (const p of this.list) if (p.changed) { p.changed = false; drawPoster(p.canvas.getContext('2d'), p.canvas.width, p.canvas.height, p.spec, p.seed); p.tex.needsUpdate = true; } }
}

// ====================================================================== Ghost radar (HUD)
export class Radar {
  constructor(canvas, readout) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.readout = readout;
    this.range = 22; this.sweep = 0; this.blips = []; this.glitch = 0; this.on = true; this.pingT = 0;
  }
  /** contacts: [{ x, z, kind, key }], returns the strength (0..1) of a ghost ping swept this frame, else 0 */
  update(dt, px, pz, yaw, contacts, interference) {
    const g = this.g, W = this.c.width, R = W / 2 - 6, cx = W / 2, cy = W / 2;
    const prev = this.sweep; this.sweep = (this.sweep + dt * 2.6) % (Math.PI * 2);
    this.glitch = Math.max(0, this.glitch - dt);
    let ping = 0;
    // which contacts did the sweep arm just pass?
    const list = [...contacts];
    if (this.glitch > 0) for (let i = 0; i < 9; i++) list.push({ x: px + Math.sin(i * 0.7 + this.glitch * 3) * (2 + (i % 3) * 2), z: pz + Math.cos(i * 0.7 + this.glitch * 3) * (2 + (i % 3) * 2), kind: 'fake' });
    for (const c of list) {
      const dx = c.x - px, dz = c.z - pz, d = Math.hypot(dx, dz);
      if (d > this.range) continue;
      // screen angle: 0 = straight ahead (up), clockwise positive
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const ang = (Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) + Math.PI * 2) % (Math.PI * 2);
      const passed = prev <= this.sweep ? (ang >= prev && ang < this.sweep) : (ang >= prev || ang < this.sweep);
      if (!passed) continue;
      const jit = c.key ? 0 : interference * 1.5;
      this.blips.push({ a: ang + (Math.random() - 0.5) * jit * 0.2, r: Math.min(1, d / this.range + (Math.random() - 0.5) * jit * 0.06), life: 1, kind: c.kind, key: c.key });
      if (!c.key) ping = Math.max(ping, 1 - d / this.range);
    }
    this.nearest = null;
    for (const c of contacts) { if (c.key) continue; const d = Math.hypot(c.x - px, c.z - pz); if (!this.nearest || d < this.nearest.d) this.nearest = { d, kind: c.kind }; }
    if (!this.on) return 0;
    // ---- draw
    g.clearRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
    const bg = g.createRadialGradient(cx, cy, 4, cx, cy, R); bg.addColorStop(0, 'rgba(18,44,26,.92)'); bg.addColorStop(1, 'rgba(3,12,7,.94)'); g.fillStyle = bg; g.fillRect(0, 0, W, W);
    g.strokeStyle = 'rgba(90,210,130,.22)'; g.lineWidth = 1;
    for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, R * k - 0.5, 0, 7); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    // sweep arm with a fading tail
    for (let i = 0; i < 26; i++) {
      const a = this.sweep - i * 0.035 - Math.PI / 2;
      g.strokeStyle = `rgba(120,255,160,${0.5 * (1 - i / 26) ** 2})`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
    }
    for (const b of this.blips) {
      b.life -= dt * (b.key ? 0.55 : 0.42);
      if (b.life <= 0) continue;
      const a = b.a - Math.PI / 2, x = cx + Math.cos(a) * b.r * R, y = cy + Math.sin(a) * b.r * R;
      const col = b.key ? '230,190,90' : b.kind === 'fake' ? '255,255,255' : b.kind === 'wraith' ? '150,200,255' : b.kind === 'crawler' ? '255,140,60' : b.kind === 'nun' ? '200,140,255' : b.kind === 'child' ? '150,230,255' : b.kind === 'shadow' ? '120,20,20' : b.kind === 'skeleton' ? '235,228,200' : '255,60,50';
      const glow = g.createRadialGradient(x, y, 0, x, y, b.key ? 7 : 11); glow.addColorStop(0, `rgba(${col},${b.life})`); glow.addColorStop(0.35, `rgba(${col},${b.life * 0.45})`); glow.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = glow; g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill();
    }
    this.blips = this.blips.filter((b) => b.life > 0);
    // the player
    g.fillStyle = 'rgba(190,255,210,.95)'; g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx + 4.5, cy + 5); g.lineTo(cx, cy + 2.5); g.lineTo(cx - 4.5, cy + 5); g.fill();
    // static when something is close
    if (interference > 0.05) { g.fillStyle = `rgba(160,255,190,${0.1 + interference * 0.25})`; for (let i = 0; i < interference * 70; i++) g.fillRect(Math.random() * W, Math.random() * W, 1 + Math.random() * 18, 1); }
    g.restore();
    g.strokeStyle = 'rgba(110,160,125,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R + 1, 0, 7); g.stroke();
    if (this.readout) {
      const n = this.nearest;
      const txt = !n || n.d > this.range ? 'NO CONTACT' : `${n.kind === 'wraith' ? 'AIRBORNE' : n.kind === 'crawler' ? 'LOW · FAST' : n.kind === 'nun' ? 'WEEPING' : n.kind === 'child' ? 'SMALL' : n.kind === 'shadow' ? 'DO NOT BLINK' : n.kind === 'skeleton' ? 'BONES' : 'CONTACT'}  ${n.d.toFixed(0)} m`;
      if (txt !== this.lastTxt) { this.readout.textContent = txt; this.lastTxt = txt; this.readout.classList.toggle('hot', !!n && n.d < 8); }
    }
    return ping;
  }
}
