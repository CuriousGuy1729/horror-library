import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MOON_DIR = new THREE.Vector3(0.12, -0.62, 1).normalize(); // direction the moonlight travels (north -> south)
const yAxis = new THREE.Vector3(0, 1, 0);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class World {
  constructor(scene, renderer, gltf, level, quality) {
    this.scene = scene; this.level = level; this.time = 0;
    this.root = gltf.scene;
    scene.add(this.root);
    scene.fog = new THREE.FogExp2(0x030508, 0.036);
    scene.background = new THREE.Color(0x010203);

    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.07;

    this.#materials(renderer);
    this.q = quality;
    this.#lights(quality);
    this.#candles();
    this.#shafts();
    this.#dust();

    // ---- interactive nodes
    const n = (name) => this.root.getObjectByName(name);
    this.keyProto = n('Key'); this.batteryProto = n('Battery');
    this.keyProto.visible = false; this.batteryProto.visible = false;
    this.exitDoors = [n('ExitDoorL'), n('ExitDoorR')].map((o, i) => ({ node: o, base: o.quaternion.clone(), sign: i ? 1 : -1 }));
    this.locks = [0, 1, 2].map((i) => { const o = n('Lock' + i); return { node: o, home: o.position.clone(), baseQ: o.quaternion.clone(), v: 0, falling: false }; });
    this.exitOpen = 0; this.exitTarget = 0;
    this.hides = level.hides.map((h) => {
      const L = n('HideDoorL_' + h.id), Rr = n('HideDoorR_' + h.id);
      const pos = new THREE.Vector3(...h.pos), front = new THREE.Vector3(...h.front);
      return { id: h.id, pos, front, yaw: Math.atan2(pos.x - front.x, pos.z - front.z), doors: [{ node: L, base: L.quaternion.clone(), sign: 1 }, { node: Rr, base: Rr.quaternion.clone(), sign: -1 }], open: 0, target: 0 };
    });
    this.colliders = level.colliders.map((c) => ({ ...c, on: true }));
    this.exitCollider = this.colliders.find((c) => c.tag === 'exitdoor');
    this.items = [];
  }

  // ------------------------------------------------------------------ materials
  #materials(renderer) {
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      o.castShadow = true; o.receiveShadow = true;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = aniso;
      switch (m.name) {
        case 'web': m.transparent = true; m.depthWrite = false; m.side = THREE.DoubleSide; m.opacity = 0.9; o.castShadow = false; o.receiveShadow = false; break;
        case 'glass': m.emissiveIntensity = 1.15; o.castShadow = false; o.receiveShadow = false; this.glass = m; break;
        case 'outside': m.fog = false; m.emissiveIntensity = 2.2; o.castShadow = false; break;
        case 'floor': m.normalScale.set(1.1, 1.1); m.envMapIntensity = 3; break;
        case 'wood': m.normalScale.set(0.9, 0.9); break;
        case 'books': m.normalScale.set(1.3, 1.3); break;
        case 'brass': case 'keymetal': m.envMapIntensity = 14; break;
        case 'iron': m.envMapIntensity = 6; break;
        case 'wax': m.emissiveIntensity = 0.12; break;
        case 'carpet': m.normalScale.set(0.6, 0.6); break;
        default: break;
      }
    });
  }

  // ------------------------------------------------------------------ lights
  #lights(q) {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x8fa8d8, 0x1a1410, 0.24));
    const moon = this.moon = new THREE.DirectionalLight(0x9fbcff, 1.5);
    const tgt = new THREE.Vector3(0, 0, 0);
    moon.position.copy(tgt).addScaledVector(MOON_DIR, -45);
    moon.target.position.copy(tgt);
    moon.castShadow = true;
    const size = q === 'low' ? 2048 : 4096;
    moon.shadow.mapSize.set(size, size);
    const c = moon.shadow.camera; c.left = -14; c.right = 14; c.top = 24; c.bottom = -24; c.near = 5; c.far = 90;
    moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.03;
    moon.shadow.autoUpdate = false; moon.shadow.needsUpdate = true;   // the moon never moves: bake once
    s.add(moon, moon.target);
  }

  // ------------------------------------------------------------------ candles
  #candles() {
    const flameTex = canvasTex(64, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h * 0.68, 1, w / 2, h * 0.6, h * 0.42);
      grd.addColorStop(0, 'rgba(255,255,235,1)'); grd.addColorStop(0.25, 'rgba(255,214,120,1)'); grd.addColorStop(0.6, 'rgba(255,120,20,.55)'); grd.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = grd; g.beginPath(); g.moveTo(w / 2, h * 0.04); g.bezierCurveTo(w * 0.95, h * 0.55, w * 0.85, h * 0.95, w / 2, h * 0.95); g.bezierCurveTo(w * 0.15, h * 0.95, w * 0.05, h * 0.55, w / 2, h * 0.04); g.fill();
      const b = g.createRadialGradient(w / 2, h * 0.86, 0, w / 2, h * 0.86, w * 0.3); b.addColorStop(0, 'rgba(90,140,255,.9)'); b.addColorStop(1, 'rgba(60,90,255,0)'); g.fillStyle = b; g.fillRect(0, h * 0.7, w, h * 0.3);
    });
    const glowTex = canvasTex(128, 128, (g, w) => {
      const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,190,110,.9)'); grd.addColorStop(0.2, 'rgba(255,150,70,.35)'); grd.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, w);
    });
    this.glowTex = glowTex;
    const flameMat = new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true });
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.28 });
    this.candles = this.level.candles.map((c) => {
      const pos = new THREE.Vector3(...c.pos);
      const flames = c.flames.map((f) => {
        const sp = new THREE.Sprite(flameMat); sp.position.set(f[0], f[1] + 0.012, f[2]); sp.scale.set(0.03, 0.075, 1);
        sp.center.set(0.5, 0.2); sp.visible = c.lit; sp.userData.ph = Math.random() * 10; this.scene.add(sp);
        const gl = new THREE.Sprite(glowMat); gl.position.copy(sp.position); gl.scale.setScalar(0.38); gl.visible = c.lit; this.scene.add(gl);
        return { sp, gl };
      });
      return { pos, flames, lit: c.lit, kind: c.kind, power: (c.kind === 'chandelier' ? 14 : c.kind === 'floor' ? 5 : 2.6), ph: Math.random() * 100 };
    });
    this.pool = [];
    for (let i = 0; i < (this.q === 'high' ? 5 : this.q === 'medium' ? 4 : 3); i++) {
      const l = new THREE.PointLight(0xff8f3a, 0, 11, 1.9);
      this.scene.add(l); this.pool.push({ l, c: null, k: 0 });
    }
    this.poolT = 0;
  }

  setLit(c, lit) { c.lit = lit; for (const f of c.flames) { f.sp.visible = lit; f.gl.visible = lit; } }
  blowOut(pos, radius) { let n = 0; for (const c of this.candles) if (c.lit && c.pos.distanceTo(pos) < radius) { this.setLit(c, false); n++; } return n; }

  // ------------------------------------------------------------------ moonlight shafts
  #shafts() {
    const tex = canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      // window opening: x -2.5..2.5 -> 0..w, y 2.4..10.85 -> h..0
      const X = (x) => (x + 2.5) / 5 * w, Y = (y) => h - (y - 2.4) / 8.45 * h;
      g.fillStyle = '#fff';
      const lancet = (cx, half, y0, ys, ya) => { g.beginPath(); g.moveTo(X(cx - half), Y(y0)); g.lineTo(X(cx - half), Y(ys)); g.quadraticCurveTo(X(cx - half), Y(ya - 0.3), X(cx), Y(ya)); g.quadraticCurveTo(X(cx + half), Y(ya - 0.3), X(cx + half), Y(ys)); g.lineTo(X(cx + half), Y(y0)); g.fill(); };
      for (const c of [-1.83, -0.67, 0.67, 1.83]) lancet(c, 0.47, 2.4, 6.1, 6.9);
      g.beginPath(); g.arc(X(0), Y(9.35), (0.8 / 5) * w, 0, 7); g.fill();
      g.fillStyle = '#000';
      for (const y of [3.45, 4.5, 5.55]) g.fillRect(0, Y(y) - 2, w, 4);
      g.filter = 'blur(2px)'; g.drawImage(g.canvas, 0, 0);
    });
    tex.colorSpace = THREE.NoColorSpace;
    const N = 46, step = 0.46, pos = [], uv = [], aT = [], idx = [];
    for (let i = 0; i < N; i++) {
      const o = MOON_DIR.clone().multiplyScalar(0.4 + i * step);
      const z = -19.75;
      const q = [[-2.5, 2.4, 0, 0], [2.5, 2.4, 1, 0], [2.5, 10.85, 1, 1], [-2.5, 10.85, 0, 1]];
      for (const [x, y, u, v] of q) { pos.push(x + o.x, y + o.y, z + o.z); uv.push(u, v); aT.push(i / N); }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
    geo.setIndex(idx);
    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uTime: { value: 0 }, uOpacity: { value: 0.02 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute float aT; varying vec2 vUv; varying float vT; varying vec3 vW; varying float vDepth;
        void main(){ vUv = uv; vT = aT; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform float uTime, uOpacity; varying vec2 vUv; varying float vT; varying vec3 vW; varying float vDepth;
        void main(){ if (vW.y < 0.02) discard;
          float m = texture2D(map, vUv).r;
          float n = 0.65 + 0.35 * sin(vW.x * 1.7 + vW.y * 1.1 + uTime * 0.25) * sin(vW.z * 0.9 - vW.y * 1.3 - uTime * 0.17);
          float a = m * uOpacity * n * (1.0 - vT * 0.55) * smoothstep(0.3, 2.0, vDepth);
          gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * a, 1.0); }`,
    });
    const mesh = new THREE.Mesh(geo, this.shaftMat); mesh.frustumCulled = false; mesh.renderOrder = 5;
    this.scene.add(mesh);
  }

  // ------------------------------------------------------------------ dust motes
  #dust() {
    const N = 700, p = new Float32Array(N * 3), s = new Float32Array(N);
    for (let i = 0; i < N; i++) { p[i * 3] = Math.random() * 12; p[i * 3 + 1] = Math.random() * 6; p[i * 3 + 2] = Math.random() * 12; s[i] = Math.random(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uLightPos: { value: new THREE.Vector3() }, uLightDir: { value: new THREE.Vector3(0, 0, -1) }, uLight: { value: 1 }, uScale: { value: 600 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime, uLight, uScale; uniform vec3 uCam, uLightPos, uLightDir; attribute float aSeed; varying float vA;
        void main(){
          vec3 p = position + vec3(sin(uTime*0.11 + aSeed*40.0)*0.5, uTime*0.02*(0.5+aSeed) + sin(uTime*0.2+aSeed*9.0)*0.2, cos(uTime*0.09 + aSeed*30.0)*0.5);
          p.xz = mod(p.xz - uCam.xz + 6.0, 12.0) - 6.0 + uCam.xz; p.y = mod(p.y, 6.0);
          vec3 toP = p - uLightPos; float d = length(toP); float c = dot(toP / d, uLightDir);
          float cone = smoothstep(0.88, 0.97, c) * uLight / (1.0 + d * d * 0.12);
          float moon = (1.0 - smoothstep(1.5, 3.2, abs(p.x))) * step(p.z, -2.0) * 0.06;
          vA = clamp(cone * 0.9 + moon, 0.0, 1.0) * (0.3 + 0.5 * aSeed);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp((0.010 + aSeed * 0.010) * uScale / -mv.z, 1.0, 3.5);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, r) * vA; if (a < 0.004) discard; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, 1.0); }`,
    });
    const pts = new THREE.Points(geo, this.dustMat); pts.frustumCulled = false; pts.renderOrder = 6;
    this.scene.add(pts);
  }

  // ------------------------------------------------------------------ pickups
  spawnItems() {
    for (const it of this.items) this.scene.remove(it.mesh);
    this.items = [];
    const pick = (spots, n, minD, spawn) => {
      const pool = spots.map((s) => ({ ...s, v: new THREE.Vector3(...s.pos) })).filter((s) => !spawn || s.v.distanceTo(spawn) > 2);
      for (let tries = 0; tries < 200; tries++) {
        const sel = [...pool].sort(() => Math.random() - 0.5).slice(0, n);
        let ok = true;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (sel[i].v.distanceTo(sel[j].v) < minD) ok = false;
        if (ok || tries === 199) return sel;
      }
    };
    const glintMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xfff2c0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.0, depthTest: true });
    const add = (type, s, proto, scale) => {
      // the prototypes carry de-quantisation transforms, so wrap them instead of overwriting their scale
      const inner = proto.clone(true); inner.visible = true;
      const mesh = new THREE.Group(); mesh.add(inner); mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(inner), c = box.getCenter(new THREE.Vector3());
      inner.position.x -= c.x; inner.position.z -= c.z; inner.position.y -= box.min.y;
      mesh.position.copy(s.v); mesh.rotation.set(0, Math.random() * 6.28, 0); mesh.scale.setScalar(scale);
      mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      const glint = new THREE.Sprite(glintMat.clone()); glint.position.set(0, 0.03 / scale, 0); glint.scale.setScalar(0.16 / scale); mesh.add(glint);
      this.scene.add(mesh);
      this.items.push({ type, pos: s.v.clone(), mesh, glint, hint: s.hint, ph: Math.random() * 6 });
    };
    for (const s of pick(this.level.keySpots, 3, 11)) add('key', s, this.keyProto, 1.5);
    for (const s of pick(this.level.batterySpots, 4, 5)) add('battery', s, this.batteryProto, 1.6);
    return this.items.filter((i) => i.type === 'key').map((i) => i.hint);
  }
  removeItem(it) { this.scene.remove(it.mesh); this.items.splice(this.items.indexOf(it), 1); }

  reset() {
    for (const c of this.candles) this.setLit(c, this.level.candles[this.candles.indexOf(c)].lit);
    for (const h of this.hides) { h.target = 0; }
    this.exitTarget = 0; this.exitOpen = 0; this.exitCollider.on = true;
    for (const k of this.locks) { k.node.visible = true; k.node.position.copy(k.home); k.node.quaternion.copy(k.baseQ); k.falling = false; k.v = 0; }
  }

  // ------------------------------------------------------------------ per-frame
  update(dt, cam, torch) {
    const t = (this.time += dt);
    this.shaftMat.uniforms.uTime.value = t;
    const du = this.dustMat.uniforms;
    du.uTime.value = t; du.uCam.value.copy(cam.position); du.uLightPos.value.copy(torch.pos); du.uLightDir.value.copy(torch.dir); du.uLight.value = torch.power;

    // flames flicker
    for (const c of this.candles) {
      if (!c.lit) continue;
      if (c.pos.distanceToSquared(cam.position) > 900) continue;
      for (const f of c.flames) {
        const ph = f.sp.userData.ph, n = Math.sin(t * 11 + ph) * 0.5 + Math.sin(t * 23.7 + ph * 2.1) * 0.3 + Math.sin(t * 5.3 + ph) * 0.2;
        f.sp.scale.set(0.03 * (1 + n * 0.08), 0.075 * (1 + n * 0.22), 1);
      }
    }
    // a small pool of real lights follows the candles nearest to the player
    this.poolT -= dt;
    if (this.poolT <= 0) {
      this.poolT = 0.3;
      const near = this.candles.filter((c) => c.lit).map((c) => ({ c, d: c.pos.distanceToSquared(cam.position) / (c.kind === 'chandelier' ? 3 : 1) })).sort((a, b) => a.d - b.d).slice(0, this.pool.length).map((e) => e.c);
      for (const s of this.pool) if (s.c && !near.includes(s.c)) s.want = null; else s.want = s.c;
      for (const c of near) if (!this.pool.some((s) => s.want === c)) { const free = this.pool.find((s) => !s.want); if (free) free.want = c; }
    }
    for (const s of this.pool) {
      if (s.want !== s.c) { s.k = Math.max(0, s.k - dt * 2.5); if (s.k === 0) { s.c = s.want; if (s.c) s.l.position.copy(s.c.pos); } }
      else if (s.c) s.k = s.c.lit ? Math.min(1, s.k + dt * 2) : Math.max(0, s.k - dt * 6);
      if (s.c) {
        const fl = 0.86 + 0.09 * Math.sin(t * 9.1 + s.c.ph) + 0.05 * Math.sin(t * 21.3 + s.c.ph * 1.7);
        s.l.intensity = s.c.power * s.k * fl; s.l.distance = s.c.kind === 'chandelier' ? 17 : 10;
      } else s.l.intensity = 0;
    }

    // doors
    for (const h of this.hides) {
      if (h.open !== h.target) {
        h.open += Math.sign(h.target - h.open) * Math.min(Math.abs(h.target - h.open), dt * 3.2);
        for (const d of h.doors) d.node.quaternion.copy(d.base).multiply(_q.setFromAxisAngle(yAxis, d.sign * h.open));
      }
    }
    if (this.exitOpen !== this.exitTarget) {
      this.exitOpen += Math.min(this.exitTarget - this.exitOpen, dt * 0.55);
      const a = (1 - Math.pow(1 - this.exitOpen / 1.75, 2)) * 1.75;
      for (const d of this.exitDoors) d.node.quaternion.copy(d.base).multiply(_q.setFromAxisAngle(yAxis, d.sign * a));
    }
    for (const k of this.locks) if (k.falling && k.node.visible) {
      k.v += 9.8 * dt; k.node.position.y -= k.v * dt; k.node.rotateZ(dt * 5);
      if (k.node.position.y < 0.05) k.node.visible = false;
    }
    // key glints: a faint sparkle when the torch is near
    for (const it of this.items) {
      const d = it.pos.distanceTo(cam.position);
      const tw = Math.max(0, Math.sin(t * 2.2 + it.ph)) ** 6;
      it.glint.material.opacity = (d < 9 ? (1 - d / 9) : 0) * (0.1 + tw * 0.7) * (it.type === 'key' ? 1 : 0.5);
    }
  }
}
const _q = new THREE.Quaternion();
export { MOON_DIR };
