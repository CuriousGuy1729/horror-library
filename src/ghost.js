import * as THREE from 'three';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

/**
 * Retargets Mixamo clips (source skeleton with world-aligned rest bones, e.g. Xbot) onto another humanoid
 * that shares the bone names but has different rest orientations (Ready Player Me). Works in world space:
 * dstWorld(t) = srcWorld(t) * dstWorldRest, then converted back to local rotations.
 */
export function retargetClips(clips, srcRoot, dstRoot, prefix = 'mixamorig') {
  const dstBones = [];
  dstRoot.traverse((o) => { if (o.isBone) dstBones.push(o); });
  const srcHips = srcRoot.getObjectByName(prefix + 'Hips'), dstHips = dstRoot.getObjectByName('Hips');
  const srcScale = srcHips.parent.scale.y;
  const ratio = dstHips.position.y / (srcHips.position.y * srcScale);
  const restWorld = new Map();
  for (const b of dstBones) restWorld.set(b, b.parent.isBone ? restWorld.get(b.parent).clone().multiply(b.quaternion) : b.quaternion.clone());

  return clips.map((clip) => {
    const tracks = new Map();
    for (const t of clip.tracks) tracks.set(t.name, t);
    const times = tracks.get(prefix + 'Hips.quaternion').times, n = times.length;
    const srcWorld = new Map();
    const getSrc = (bone) => {              // Float32Array(n*4) of world rotations for a source bone
      if (!bone || !bone.isBone) return null;
      if (srcWorld.has(bone)) return srcWorld.get(bone);
      const tr = tracks.get(bone.name + '.quaternion'), par = getSrc(bone.parent), out = new Float32Array(n * 4);
      const a = new THREE.Quaternion(), p = new THREE.Quaternion();
      for (let i = 0; i < n; i++) {
        if (tr && tr.times.length === n) a.fromArray(tr.values, i * 4); else a.copy(bone.quaternion);
        if (par) { p.fromArray(par, i * 4); a.premultiply(p); }
        a.toArray(out, i * 4);
      }
      srcWorld.set(bone, out); return out;
    };
    const dstWorld = new Map(), outTracks = [];
    const sw = new THREE.Quaternion(), dw = new THREE.Quaternion(), pw = new THREE.Quaternion(), loc = new THREE.Quaternion(), prev = new THREE.Quaternion();
    for (const b of dstBones) {
      const src = getSrc(srcRoot.getObjectByName(prefix + b.name));
      const par = b.parent.isBone ? dstWorld.get(b.parent) : null;
      const world = new Float32Array(n * 4), local = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        if (src) { sw.fromArray(src, i * 4); dw.copy(sw).multiply(restWorld.get(b)); }
        else { dw.copy(b.quaternion); if (par) dw.premultiply(pw.fromArray(par, i * 4)); }
        dw.toArray(world, i * 4);
        loc.copy(dw); if (par) loc.premultiply(pw.fromArray(par, i * 4).invert());
        if (i && loc.dot(prev) < 0) loc.set(-loc.x, -loc.y, -loc.z, -loc.w);
        prev.copy(loc); loc.toArray(local, i * 4);
      }
      dstWorld.set(b, world);
      if (src) outTracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, local));
    }
    const hp = tracks.get(prefix + 'Hips.position');
    if (hp) outTracks.push(new THREE.VectorKeyframeTrack('Hips.position', hp.times, Float32Array.from(hp.values, (v) => v * srcScale * ratio)));
    return new THREE.AnimationClip(clip.name, clip.duration, outTracks);
  });
}

/** Turns a regular PBR material into a pale, faintly luminous spectral one. */
function spectral(src, { glow = 0.3, rim = 0.9, tint = [0.78, 0.9, 1.0], sat = 0.12, opacity = 0.94 } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: src.map || null, normalMap: src.normalMap || null, color: src.map ? 0xffffff : src.color, roughness: 0.85, metalness: 0, transparent: true, opacity });
  m.userData.u = { uGlow: { value: glow }, uRim: { value: rim }, uTint: { value: new THREE.Vector3(...tint) }, uSat: { value: sat }, uTime: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow, uRim, uSat, uTime; uniform vec3 uTint;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n float gL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(vec3(gL), diffuseColor.rgb, uSat) * uTint;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fr = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.2);
        float fl = 0.85 + 0.15 * sin(uTime * 17.0 + vViewPosition.y * 9.0);
        totalEmissiveRadiance += diffuseColor.rgb * uGlow * fl + uTint * fr * uRim * 0.5;`);
  };
  return m;
}

class Figure {
  constructor(root, clips) {
    this.root = root; this.mats = [];
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    for (const c of clips) { const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); this.actions[c.name] = a; }
    this.cur = null; this.pos = root.position; this.yaw = 0;
    root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
  }
  play(name, fade = 0.25, timeScale = 1) {
    const a = this.actions[name]; if (!a) return;
    a.timeScale = timeScale;
    if (this.cur === a) return;
    a.enabled = true; a.setEffectiveWeight(1);
    if (this.cur) this.cur.crossFadeTo(a, fade, false); else a.fadeIn(fade);
    this.cur = a;
  }
  setOpacity(o) { for (const m of this.mats) { m.opacity = m.userData.baseOpacity * o; } this.root.visible = o > 0.01; }
  face(x, z, dt, rate = 8) {
    const t = Math.atan2(x - this.pos.x, z - this.pos.z); let d = t - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (dt === null ? 1 : 1 - Math.exp(-dt * rate)); this.root.rotation.y = this.yaw;
  }
  tick(dt, time) { this.mixer.update(dt); for (const m of this.mats) if (m.userData.u) m.userData.u.uTime.value = time; }
}

// ====================================================================== The Archivist (the hunter)
export class Archivist extends Figure {
  constructor(scene, gltf, clips, nav, audio) {
    super(gltf.scene, clips);
    this.nav = nav; this.audio = audio;
    this.root.scale.setScalar(1.09);
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (/Eye/.test(o.name)) { o.material = new THREE.MeshBasicMaterial({ color: 0xcfeaff, fog: false }); o.material.color.multiplyScalar(2.2); this.eyeMat = o.material; return; }
      const skin = /Head|Body|Teeth/.test(o.name);
      const m = spectral(o.material, skin ? { glow: 0.28, rim: 0.9, sat: 0.05, tint: [0.8, 0.9, 1.0] } : { glow: 0.12, rim: 0.7, sat: 0.2, tint: [0.62, 0.72, 0.85] });
      m.userData.baseOpacity = m.opacity; o.material = m; this.mats.push(m);
    });
    this.head = this.root.getObjectByName('Head');
    this.light = new THREE.PointLight(0x86b6dc, 0, 7, 1.8); this.light.position.set(0, 1.4, 0.3); this.root.add(this.light);
    scene.add(this.root);
    this.path = []; this.lastKnown = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.state = 'dormant'; this.root.visible = false; this.light.intensity = 0; this.path = [];
    this.seen = 0; this.lostT = 99; this.wait = 0; this.repath = 0; this.sawHide = false; this.hideTarget = null; this.stepPh = 0;
    this.anger = 0; this.fade = 0; this.searchLeft = 0; this.sees = false;
  }

  spawn(p) { this.pos.set(p.x, 0, p.z); this.state = 'patrol'; this.fade = 0; this.root.visible = true; this.wait = 4; this.path = []; this.play('idle', 0); }
  headPos(out) { return this.head.getWorldPosition(out); }
  get active() { return this.state !== 'dormant'; }
  get hunting() { return this.state === 'chase'; }

  goTo(x, z) { this.path = this.nav.path(this.pos.x, this.pos.z, x, z); }
  investigate(x, z, urgent = false) { if (this.state === 'dormant') return; this.state = 'investigate'; this.urgent = urgent; this.goTo(x, z); this.searchLeft = 2; }
  startChase(pl) { if (this.state !== 'chase') { this.state = 'chase'; this.repath = 0; this.audio.sting(0.8); this.onAlert?.(); } this.lastKnown.copy(pl.pos); }

  onPlayerHide(h, pl) {
    if (this.state !== 'chase') return;
    const d = this.pos.distanceTo(pl.pos);
    if (this.lostT < 0.8 && d < 11) { this.sawHide = true; this.hideTarget = h; }
    else { this.state = 'investigate'; this.urgent = true; this.goTo(h.front.x, h.front.z); this.stareAt = Math.random() < 0.7 ? h : null; this.searchLeft = 1; }
  }

  #follow(dt, speed) {
    if (!this.path.length) return true;
    let budget = speed * dt;
    while (budget > 0 && this.path.length) {
      const p = this.path[0], dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d <= budget) { this.pos.x = p.x; this.pos.z = p.z; budget -= d; this.path.shift(); }
      else { this.pos.x += dx / d * budget; this.pos.z += dz / d * budget; this.face(p.x, p.z, dt, speed > 3 ? 10 : 6); budget = 0; }
    }
    return this.path.length === 0;
  }

  /** returns 'caught' when it gets the player */
  update(dt, pl, world, time) {
    if (this.state === 'dormant') return null;
    this.fade = Math.min(1, this.fade + dt * 0.7);
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    // ---- senses
    const range = pl.hidden ? 0 : pl.lightOn ? 17 : pl.crouch ? 4.5 : 8.5;
    const fwd = (Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz) / (dist || 1);
    const sees = this.sees = dist < range && (fwd > 0.15 || dist < 2.6) && this.nav.los(this.pos.x, this.pos.z, pl.pos.x, pl.pos.z);
    if (sees) { this.seen += dt * (dist < 5 ? 3 : 1); this.lostT = 0; this.lastKnown.copy(pl.pos); } else { this.seen = Math.max(0, this.seen - dt * 0.4); this.lostT += dt; }
    const hears = !pl.hidden && pl.noise > dist;
    let speed = 0;
    const boost = 1 + this.anger * 0.07;

    switch (this.state) {
      case 'patrol': {
        if (this.seen > 0.45) { this.startChase(pl); break; }
        if (hears) { this.investigate(pl.pos.x, pl.pos.z); break; }
        if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) { const p = Math.random() < 0.7 ? this.nav.randomPoint(pl.pos, 6, 17) : this.nav.randomPoint(); this.goTo(p.x, p.z); } break; }
        speed = 1.25 * boost;
        if (this.#follow(dt, speed)) this.wait = 1 + Math.random() * 2.5;
        break;
      }
      case 'investigate': {
        if (this.seen > 0.3) { this.startChase(pl); break; }
        if (hears && Math.random() < dt * 2) this.goTo(pl.pos.x, pl.pos.z);
        if (this.wait > 0) {
          this.wait -= dt;
          if (this.wait <= 0) {
            if (this.searchLeft-- > 0) { const p = this.nav.randomPoint(this.pos, 2, 6); this.goTo(p.x, p.z); }
            else { this.state = 'patrol'; const p = this.nav.randomPoint(pl.pos, 14, 30); this.goTo(p.x, p.z); this.wait = 0; }
          }
          break;
        }
        speed = (this.urgent ? 2.7 : 1.9) * boost;
        if (this.#follow(dt, speed)) {
          if (this.stareAt && pl.hide === this.stareAt) { this.state = 'stare'; this.wait = 3.5 + Math.random() * 3; this.onStare?.(); }
          else this.wait = 1.6 + Math.random() * 1.5;
          this.stareAt = null;
        }
        break;
      }
      case 'stare': {     // standing right outside the cabinet the player is hiding in
        const h = pl.hide;
        if (h) this.face(h.pos.x, h.pos.z, dt, 3);
        this.wait -= dt;
        if (!pl.hidden && this.seen > 0.1) { this.startChase(pl); break; }
        if (this.wait <= 0) { this.state = 'patrol'; const p = this.nav.randomPoint(pl.pos, 15, 30); this.goTo(p.x, p.z); this.wait = 0; }
        break;
      }
      case 'chase': {
        speed = (3.55 + Math.min(1, this.lostT) * 0) * boost;
        if (pl.hidden) {
          if (this.sawHide && this.hideTarget) {
            const f = this.hideTarget.front;
            if (Math.hypot(f.x - this.pos.x, f.z - this.pos.z) < 0.9) return 'caught';
            this.repath -= dt; if (this.repath <= 0) { this.goTo(f.x, f.z); this.repath = 0.5; }
          } else if (this.lostT > 1.2) { this.investigate(this.lastKnown.x, this.lastKnown.z, true); break; }
        } else {
          this.sawHide = false;
          if (dist < 1.05 && Math.abs(pl.pos.y) < 1) return 'caught';
          if (this.lostT > 4) { this.investigate(this.lastKnown.x, this.lastKnown.z, true); break; }
          this.repath -= dt;
          if (this.repath <= 0) {
            this.repath = 0.3;
            const tgt = this.lostT < 1.5 ? pl.pos : this.lastKnown;
            if (this.nav.walkLos(this.pos.x, this.pos.z, tgt.x, tgt.z)) this.path = [{ x: tgt.x, z: tgt.z }]; else this.goTo(tgt.x, tgt.z);
          }
        }
        this.#follow(dt, speed);
        break;
      }
      default: break;
    }

    // ---- animation + presentation
    const moving = speed > 0 && this.path.length > 0;
    if (!moving) this.play(this.state === 'stare' ? 'headShake' : 'idle', 0.35, this.state === 'stare' ? 0.5 : 1);
    else if (speed > 2.4) this.play('run', 0.2, speed / 3.9);
    else this.play('walk', 0.3, speed / 1.45);
    if (moving) {
      this.stepPh += dt * (speed > 2.4 ? 5.4 : 3.2);
      if (this.stepPh > 1) { this.stepPh = 0; const pan = Math.sin(Math.atan2(-dx, -dz) - pl.yaw + Math.PI); this.audio.ghostStep(Math.max(0, 1 - dist / 15) * (speed > 2.4 ? 1 : 0.6), -pan); }
    }
    const flick = 0.82 + 0.18 * Math.sin(time * 31) * Math.sin(time * 7.3);
    this.setOpacity(this.fade * (this.state === 'chase' ? 1 : flick));
    this.light.intensity = this.fade * (this.state === 'chase' ? 2.4 : 1.3) * flick;
    this.root.position.y = Math.sin(time * 1.7) * 0.012;
    this.tick(dt, time);
    return null;
  }
}

// ====================================================================== The Hollow (faceless apparitions)
export class Hollow extends Figure {
  constructor(scene, root, clips) {
    super(root, clips);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = spectral({ color: new THREE.Color(o.name.includes('Joints') ? 0x2a2a2c : 0x8d8d88) }, { glow: 0.035, rim: 0.5, sat: 0, tint: [0.85, 0.88, 0.95], opacity: 1 });
      m.userData.baseOpacity = 1; m.roughness = 0.6; o.material = m; this.mats.push(m);
    });
    scene.add(root); root.visible = false; this.mode = 'off'; this.t = 0; this.alpha = 0;
  }
  show(x, y, z, mode) { this.pos.set(x, y, z); this.mode = mode; this.t = 0; this.alpha = 0; this.root.visible = true; this.play(mode === 'dash' ? 'idle' : 'idle', 0); this.dashing = false; }
  hide() { this.mode = 'off'; this.root.visible = false; }
}
