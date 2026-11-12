import * as THREE from 'three';

const R = 0.3, EYE = 1.66, EYE_CROUCH = 1.02;
const WALK = 2.25, RUN = 4.5, SNEAK = 1.15;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3();

function torchCookie() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, '#fff'); grd.addColorStop(0.28, '#e9e4d6'); grd.addColorStop(0.36, '#a9a59a'); grd.addColorStop(0.42, '#cfcabd');
  grd.addColorStop(0.62, '#5d5a52'); grd.addColorStop(0.8, '#2b2a26'); grd.addColorStop(1, '#000');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  g.globalAlpha = 0.07; g.strokeStyle = '#000';
  for (let i = 0; i < 5; i++) { g.lineWidth = 2 + Math.random() * 4; g.beginPath(); g.arc(128 + (Math.random() - 0.5) * 30, 128 + (Math.random() - 0.5) * 30, 30 + Math.random() * 80, 0, 7); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Player {
  constructor(camera, scene, world, audio, quality) {
    this.cam = camera; this.world = world; this.audio = audio;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.keys = {}; this.sens = 1; this.bodyFlip = Math.PI;
    const sp = this.torch = new THREE.SpotLight(0xfff0d8, 0, 36, 0.56, 0.6, 0.92);
    sp.castShadow = quality !== 'low';
    sp.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    sp.shadow.camera.near = 0.25; sp.shadow.camera.far = 34; sp.shadow.bias = -0.0008; sp.shadow.normalBias = 0.02;
    if (sp.castShadow) sp.map = torchCookie();
    scene.add(sp, sp.target);
    this.torchDir = new THREE.Vector3(0, 0, 1);
    this.torchState = { pos: new THREE.Vector3(), dir: this.torchDir, power: 0 };
    this.view = 'first'; this.camDist = 0; this.body = null; this.nerve = 1;
    this.reset({ x: 0, z: 0 });
  }

  /** a visible body for the third-person camera */
  setBody(gltf) {
    const b = this.body = gltf.scene; b.visible = false;
    b.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material) { o.material.metalness = Math.min(o.material.metalness ?? 0, 0.3); o.material.roughness = Math.max(o.material.roughness ?? 1, 0.7); o.material.color?.multiplyScalar(0.75); } } });
    this.mixer = new THREE.AnimationMixer(b); this.acts = {};
    for (const c of gltf.animations) { const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(c.name === 'Idle' ? 1 : 0); this.acts[c.name] = a; }
    this.curAct = this.acts.Idle; b.scale.setScalar(0.94);
    this.cam.parent.add(b);
  }
  toggleView() { this.view = this.view === 'first' ? 'third' : 'first'; return this.view; }
  #camBlocked(x, y, z) {
    const b = this.world.level.bounds;
    if (x < b.minX + 0.2 || x > b.maxX - 0.2 || z < b.minZ + 0.2 || z > b.maxZ - 0.2 || y > 7.5) return true;
    for (const c of this.world.colliders) {
      if (!c.on || y < c.min[1] - 0.1 || y > c.max[1] + 0.12) continue;
      if (x > c.min[0] - 0.14 && x < c.max[0] + 0.14 && z > c.min[2] - 0.14 && z < c.max[2] + 0.14) return true;
    }
    return false;
  }

  reset(spawn, yaw = Math.PI) {
    this.pos.set(spawn.x, 0, spawn.z); this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0; this.eye = EYE; this.bob = 0; this.stepPh = 0;
    this.stamina = 1; this.exhausted = false; this.battery = 100; this.torchOn = true; this.flick = 1;
    this.keysHeld = 0; this.mode = 'free'; this.hide = null; this.hideT = 0; this.noise = 0; this.crouch = false; this.running = false;
    this.nerve = 1; this.camDist = 0; this.radio = false;
    this.shake = 0; this.dead = false; this.lookLock = null; this.fovKick = 0;
    this.cam.rotation.set(0, 0, 0);
  }

  look(dx, dy) {
    if (this.dead || this.lookLock) return;
    const s = 0.0022 * this.sens;
    this.yaw -= dx * s; this.pitch -= dy * s;
    const lim = this.mode === 'hidden' ? 0.45 : 1.45;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    if (this.mode === 'hidden') {
      let d = this.yaw - this.hide.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw = this.hide.yaw + Math.max(-0.55, Math.min(0.55, d));
    }
  }

  toggleTorch() {
    if (this.mode !== 'free' || this.dead) return;
    if (this.battery <= 0) { this.audio.click(); return 'dead'; }
    this.torchOn = !this.torchOn; this.audio.click();
  }

  get hidden() { return this.mode === 'hidden' || (this.mode === 'entering' && this.hideT > 0.5); }
  get lightOn() { return this.torchOn && this.battery > 0 && this.mode === 'free'; }

  enterHide(h) {
    this.mode = 'entering'; this.hide = h; this.hideT = 0; h.target = 1.35;
    this.from = this.pos.clone(); this.fromYaw = this.yaw; this.vel.set(0, 0, 0);
    this.audio.creak(0.7, 0, 0.5);
  }
  exitHide() {
    if (this.mode !== 'hidden') return;
    this.mode = 'exiting'; this.hideT = 0; this.hide.target = 1.35; this.audio.creak(0.6, 0, 0.5);
  }

  #collide(p) {
    for (let it = 0; it < 3; it++) {
      for (const c of this.world.colliders) {
        if (!c.on || c.min[1] > 1.6) continue;
        const cx = Math.max(c.min[0], Math.min(p.x, c.max[0])), cz = Math.max(c.min[2], Math.min(p.z, c.max[2]));
        let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (R - d) / d; p.x += dx * k; p.z += dz * k; }
        else { // centre is inside the box: leave by the nearest face
          const l = p.x - c.min[0], r = c.max[0] - p.x, n = p.z - c.min[2], f = c.max[2] - p.z, m = Math.min(l, r, n, f);
          if (m === l) p.x = c.min[0] - R; else if (m === r) p.x = c.max[0] + R; else if (m === n) p.z = c.min[2] - R; else p.z = c.max[2] + R;
        }
      }
    }
  }

  update(dt, fear) {
    const k = this.keys, cam = this.cam;
    let targetEye = EYE;
    this.noise = 0;
    if (this.mode === 'free' && !this.dead) {
      this.crouch = !!(k.KeyC || k.ControlLeft || k.ControlRight);
      let ix = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), iz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      const moving = ix || iz;
      const wantRun = (k.ShiftLeft || k.ShiftRight) && moving && !this.crouch && iz > 0;
      if (this.stamina <= 0) this.exhausted = true; if (this.stamina > 0.35) this.exhausted = false;
      this.running = wantRun && !this.exhausted;
      this.stamina = Math.max(0, Math.min(1, this.stamina + (this.running ? -dt / 6.5 : dt / (moving ? 9 : 5))));
      const speed = this.crouch ? SNEAK : this.running ? RUN : WALK;
      const l = Math.hypot(ix, iz) || 1; ix /= l; iz /= l;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // forward = (-sin, -cos); right = (cos, -sin)
      const tx = (-sin * iz + cos * ix) * speed, tz = (-cos * iz - sin * ix) * speed;
      const acc = 1 - Math.exp(-dt * (moving ? 9 : 12));
      this.vel.x += (tx - this.vel.x) * acc; this.vel.z += (tz - this.vel.z) * acc;
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      this.#collide(this.pos);
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0.4) {
        this.stepPh += dt * (this.running ? 3.1 : this.crouch ? 1.5 : 2.05) * Math.PI;
        if (this.stepPh > Math.PI) { this.stepPh -= Math.PI; this.audio.step(this.running ? 1 : this.crouch ? 0.18 : 0.5); }
        this.noise = this.running ? 15 : this.crouch ? 1.2 : 4.5;
      }
      this.bob += (Math.min(1, sp / WALK) - this.bob) * (1 - Math.exp(-dt * 8));
      if (this.crouch) targetEye = EYE_CROUCH;
    } else if (this.mode === 'entering' || this.mode === 'exiting') {
      this.hideT += dt / 0.75;
      const h = this.hide, t = Math.min(1, this.hideT), e = t * t * (3 - 2 * t);
      if (this.mode === 'entering') {
        this.pos.lerpVectors(this.from, h.pos, e);
        let d = h.yaw - this.fromYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw = this.fromYaw + d * e; this.pitch *= 1 - e;
        if (t >= 1) { this.mode = 'hidden'; h.target = 0.2; this.audio.creak(0.5, 0, 0.35); }
      } else {
        this.pos.lerpVectors(h.pos, h.front, e);
        if (t >= 1) { this.mode = 'free'; h.target = 0; this.hide = null; }
      }
      this.bob *= 0.9;
    } else { this.bob *= 0.9; this.vel.set(0, 0, 0); if (this.mode === 'hidden') targetEye = 1.5; }

    this.eye += (targetEye - this.eye) * (1 - Math.exp(-dt * 9));
    // ---- camera
    const by = Math.sin(this.stepPh * 2) * 0.028 * this.bob, bx = Math.cos(this.stepPh) * 0.018 * this.bob;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake;
    cam.position.set(this.pos.x + Math.cos(this.yaw) * bx, this.eye + by + Math.sin(this.world.time * 0.9) * 0.004, this.pos.z - Math.sin(this.yaw) * bx);
    if (this.lookLock) {
      _v.copy(this.lookLock).sub(cam.position);
      const ty = Math.atan2(-_v.x, -_v.z), tp = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
      let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const a = 1 - Math.exp(-dt * 16); this.yaw += d * a; this.pitch += (tp - this.pitch) * a;
    }
    cam.rotation.set(this.pitch + (Math.random() - 0.5) * sh * 0.09, this.yaw + (Math.random() - 0.5) * sh * 0.09, bx * 0.25 + (Math.random() - 0.5) * sh * 0.12, 'YXZ');
    const fov = 68 + (this.running ? 7 : 0) + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 6)); cam.updateProjectionMatrix(); }

    // ---- torch: follows the view with a little lag, sits low-right like a hand-held light
    const cp = Math.cos(this.pitch);
    _f.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp); _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); _u.crossVectors(_r, _f);
    // ---- third-person: pull the camera back over the shoulder, stopping at walls and shelves
    const third = this.view === 'third' && this.mode === 'free' && !this.dead && !this.lookLock;
    let want = third ? 2.5 : 0;
    if (third) {
      const hx = this.pos.x + _r.x * 0.42, hy = this.eye + 0.22, hz = this.pos.z + _r.z * 0.42;
      for (let d = 0.3; d <= want + 0.01; d += 0.22) if (this.#camBlocked(hx - _f.x * d, Math.max(0.25, hy - _f.y * d), hz - _f.z * d)) { want = Math.max(0, d - 0.3); break; }
      if (this.#camBlocked(hx, hy, hz)) want = 0;
    }
    this.camDist += (want - this.camDist) * (1 - Math.exp(-dt * (want < this.camDist ? 20 : 5)));
    const tp3 = this.camDist > 0.35;
    if (tp3) {
      const k = Math.min(1, this.camDist / 1.2);
      cam.position.set(this.pos.x + _r.x * 0.42 * k - _f.x * this.camDist, Math.max(0.25, this.eye + 0.22 * k - _f.y * this.camDist), this.pos.z + _r.z * 0.42 * k - _f.z * this.camDist);
    }
    if (this.body) {
      const b = this.body, sp = Math.hypot(this.vel.x, this.vel.z);
      b.visible = tp3;
      if (tp3) {
        b.position.set(this.pos.x, 0, this.pos.z); b.rotation.y = this.yaw + this.bodyFlip;
        b.scale.set(0.94, 0.94 * (this.eye / EYE) ** 0.8, 0.94);
        const next = this.acts[sp > 3.2 ? 'Run' : sp > 0.35 ? 'Walk' : 'Idle'];
        if (next && next !== this.curAct) { next.enabled = true; next.setEffectiveWeight(1); next.time = 0; this.curAct.crossFadeTo(next, 0.25, false); this.curAct = next; }
        if (this.curAct) this.curAct.timeScale = this.curAct === this.acts.Walk ? Math.max(0.5, sp / 1.9) : this.curAct === this.acts.Run ? sp / 4.2 : 1;
        this.mixer.update(dt);
      }
    }
    if (this.camDist <= 0.35) this.torchDir.lerp(_f, 1 - Math.exp(-dt * 13)).normalize();
    const tp = this.torch.position;
    if (tp3) {   // held at the chest, aimed at what the camera is looking at
      tp.set(this.pos.x + _r.x * 0.22 + _f.x * 0.35, this.eye - 0.32, this.pos.z + _r.z * 0.22 + _f.z * 0.35);
      _v.copy(cam.position).addScaledVector(_f, 14).sub(tp).normalize();
      this.torchDir.lerp(_v, 1 - Math.exp(-dt * 13)).normalize();
    } else tp.copy(cam.position).addScaledVector(_r, 0.17).addScaledVector(_u, -0.14).addScaledVector(_f, 0.05);
    this.torch.target.position.copy(tp).add(this.torchDir);
    if (this.lightOn) {
      this.battery = Math.max(0, this.battery - dt * (100 / 320));
      if (this.battery <= 0) { this.torchOn = false; this.audio.click(); }
    }
    // flicker: weak battery or a nearby presence makes the bulb stutter
    const trouble = Math.max(this.battery < 18 ? 0.35 + (18 - this.battery) / 40 : 0, fear > 0.45 ? (fear - 0.45) * 1.5 : 0);
    if (Math.random() < trouble * dt * 22) this.flick = 0.1 + Math.random() * 0.5;
    this.flick += (1 - this.flick) * (1 - Math.exp(-dt * 14));
    const power = this.lightOn ? this.flick * (0.55 + 0.45 * Math.min(1, this.battery / 25)) : 0;
    this.torch.intensity = power * 62;
    this.torchState.pos.copy(tp); this.torchState.power = power;
  }
}
