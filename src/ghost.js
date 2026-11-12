import * as THREE from 'three';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

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

const FACE_GLSL = `
  if (uFace > 0.5) {
    vec3 dl = vBind - uEyeL, dr = vBind - uEyeR; vec3 de = dot(dl, dl) < dot(dr, dr) ? dl : dr;
    float so = length(de * vec3(1.0, 1.25, 0.6));
    float socket = smoothstep(0.013, 0.036, so);
    float tear = (1.0 - smoothstep(0.003, 0.0075, abs(de.x + sin(vBind.y * 140.0) * 0.0015))) * step(de.y, 0.0) * smoothstep(-0.075, -0.02, de.y);
    vec3 mid = (uEyeL + uEyeR) * 0.5; vec2 dm = (vBind.xy - (mid.xy + vec2(0.0, -0.066))) / vec2(0.03, 0.013);
    float mouth = smoothstep(0.7, 1.25, length(dm));
    float vein = smoothstep(0.42, 0.5, abs(sin(vBind.x * 95.0 + sin(vBind.y * 60.0) * 2.5) * sin(vBind.y * 80.0 + vBind.x * 30.0)));
    diffuseColor.rgb *= mix(0.03, 1.0, socket) * mix(0.08, 1.0, mouth) * (0.65 + 0.35 * vein);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.0, 0.0), tear * 0.85);
  }`;

/** Turns a regular PBR material into a pale, faintly luminous spectral one. */
function spectral(src, { glow = 0.3, rim = 0.9, tint = [0.78, 0.9, 1.0], sat = 0.12, opacity = 0.94, face = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: src.map || null, normalMap: src.normalMap || null, color: src.map ? 0xffffff : src.color, roughness: 0.85, metalness: 0, transparent: true, opacity });
  m.userData.u = { uGlow: { value: glow }, uRim: { value: rim }, uTint: { value: new THREE.Vector3(...tint) }, uSat: { value: sat }, uTime: { value: 0 }, uEyeL: { value: face ? face.l : new THREE.Vector3(9, 9, 9) }, uEyeR: { value: face ? face.r : new THREE.Vector3(9, 9, 9) }, uFace: { value: face ? 1 : 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBind;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vBind = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow, uRim, uSat, uTime, uFace; uniform vec3 uTint, uEyeL, uEyeR; varying vec3 vBind;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n float gL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(vec3(gL), diffuseColor.rgb, uSat) * uTint; ' + FACE_GLSL)
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
  present(dt, time) { this.tick(dt, time); }
  tick(dt, time) { this.mixer.update(dt); for (const m of this.mats) if (m.userData.u) m.userData.u.uTime.value = time; }
}

// ====================================================================== The Archivist (the hunter)
export class Archivist extends Figure {
  constructor(scene, gltf, clips, nav, audio, opts = {}) {
    super(gltf.scene, clips);
    this.nav = nav; this.audio = audio;
    this.kind = opts.kind || 'archivist';
    this.spd = opts.speed || 1; this.sight = opts.sight || 1; this.hear = opts.hear || 1; this.reach = opts.reach || 1.05;
    if (this.kind === 'crawler') this.#buildCrawler();
    else {
      this.root.scale.setScalar(1.09);
      const eye = {};
      this.root.traverse((o) => { if (o.isMesh && /^Eye/.test(o.name)) { o.geometry.computeBoundingBox(); eye[o.name] = o.geometry.boundingBox.getCenter(new THREE.Vector3()); } });
      const face = eye.EyeLeft && eye.EyeRight ? { l: eye.EyeLeft, r: eye.EyeRight } : null;
      this.morphs = [];
      this.root.traverse((o) => {
        if (!o.isMesh) return;
        if (o.morphTargetDictionary && 'mouthOpen' in o.morphTargetDictionary) this.morphs.push({ o, i: o.morphTargetDictionary.mouthOpen });
        if (/^Eye/.test(o.name)) { o.material = new THREE.MeshBasicMaterial({ color: 0xcfeaff, fog: false }); o.material.color.multiplyScalar(2.6); o.scale.multiplyScalar(0.55); this.eyeMat = o.material; return; }
        const skin = /Head|Body|Teeth/.test(o.name);
        const m = spectral(o.material, skin ? { glow: 0.4, rim: 0.7, sat: 0.04, tint: [0.4, 0.45, 0.5], face: /Head/.test(o.name) ? face : null } : { glow: 0.14, rim: 0.5, sat: 0.1, tint: [0.16, 0.19, 0.24] });
        m.userData.baseOpacity = m.opacity; o.material = m; this.mats.push(m);
      });
      this.head = this.root.getObjectByName('Head');
    }
    this.light = new THREE.PointLight(this.kind === 'crawler' ? 0xb04038 : 0x86b6dc, 0, 7, 1.8); this.light.position.set(0, this.kind === 'crawler' ? 0.6 : 1.4, 0.3); this.root.add(this.light);
    scene.add(this.root);
    this.path = []; this.lastKnown = new THREE.Vector3();
    this.reset();
  }

  // ---- the crawler: a human body dropped onto all fours, driven by a procedural pose
  #buildCrawler() {
    const root = this.root; root.updateMatrixWorld(true);
    const rest = new Map(); const q = new THREE.Quaternion();
    root.traverse((o) => { rest.set(o, o.getWorldQuaternion(q).clone()); });
    this.bones = {};
    for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']) {
      const b = root.getObjectByName('mixamorig' + n); if (b) this.bones[n] = { b, rest: rest.get(b), pInv: rest.get(b.parent).clone().invert() };
    }
    const inner = this.inner = new THREE.Group();
    for (const c of [...root.children]) inner.add(c);
    inner.rotation.x = Math.PI / 2; inner.position.set(0, 0.3, -0.8); root.add(inner); root.scale.setScalar(1.12);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = spectral(o.material, { glow: 0.03, rim: 0.3, sat: 0.0, tint: [0.2, 0.19, 0.19], opacity: 1 });
      m.userData.baseOpacity = 1; o.material = m; this.mats.push(m);
    });
    this.head = this.bones.Head.b; this.crawlPh = 0; this.twitch = 0; this.twitchV = 0;
    this.crawl(0, false, 0, 0);
  }
  #rot(name, x, y, z) {   // rotation given in the character's own rest axes: X left, Y up, Z front
    const e = this.bones[name]; if (!e) return;
    _q.setFromEuler(_e.set(x, y, z, 'ZXY'));
    e.b.quaternion.copy(e.pInv).multiply(_q).multiply(e.rest);
  }
  crawl(dt, moving, speed, time) {
    this.crawlPh += dt * (moving ? 2.2 + speed * 2.4 : 0.5);
    const p = this.crawlPh, s = Math.sin(p), c = Math.cos(p), amp = moving ? 1 : 0.15;
    if (Math.random() < dt * 1.3) this.twitchV = (Math.random() - 0.5) * 2;
    this.twitch += (this.twitchV - this.twitch) * Math.min(1, dt * 14);
    this.#rot('Hips', 0, 0.16 * s * amp, 0);
    this.#rot('Spine', -0.1, -0.1 * s * amp, 0);
    this.#rot('Spine2', -0.3, -0.12 * s * amp, 0);
    this.#rot('Neck', -0.55, 0, 0.3 * this.twitch);
    this.#rot('Head', -0.6, 0.25 * Math.sin(time * 0.7), 0.75 * this.twitch);
    // arms: elbows up and out like a spider, hands planted ahead
    this.#rot('LeftArm', 0, 0.35, 0.75 + 0.5 * s * amp);
    this.#rot('RightArm', 0, -0.35, -0.75 + 0.5 * s * amp);
    this.#rot('LeftForeArm', 0, -1.35 - 0.3 * c * amp, 0.25);
    this.#rot('RightForeArm', 0, 1.35 - 0.3 * c * amp, -0.25);
    this.#rot('LeftHand', 0, 0.5, 0); this.#rot('RightHand', 0, -0.5, 0);
    // legs: splayed and folded, pushing alternately
    this.#rot('LeftUpLeg', -0.35, 0, 1.0 - 0.3 * s * amp);
    this.#rot('RightUpLeg', -0.35, 0, -1.0 - 0.3 * s * amp);
    this.#rot('LeftLeg', 0.25, 0, -1.7 - 0.25 * c * amp);
    this.#rot('RightLeg', 0.25, 0, 1.7 - 0.25 * c * amp);
    this.inner.position.y = 0.3 + 0.03 * Math.sin(p * 2);
  }

  reset() {
    this.cool = 0; this.chaseT = 0; this.daze = 0; this.stared = false;
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
  startChase(pl) {
    if (this.state !== 'chase') {
      if (this.cool > 0 || (this.canHunt && !this.canHunt(this))) return;
      this.state = 'chase'; this.repath = 0; this.chaseT = 0; this.audio.sting(0.8); this.onAlert?.(this);
    }
    this.lastKnown.copy(pl.pos);
  }
  /** breaks off and wanders away; it will not hunt again for a while */
  giveUp(pl, cool = 12) {
    this.state = 'patrol'; this.cool = cool; this.seen = 0; this.wait = 0; this.sawHide = false;
    const p = this.nav.randomPoint(pl.pos, 14, 30); this.goTo(p.x, p.z); this.onGiveUp?.(this);
  }

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
    this.cool = Math.max(0, this.cool - dt);
    // being stared down: holding its gaze slows it, then leaves it transfixed
    if (this.stared && this.state !== 'dazed') this.daze = Math.min(1, this.daze + dt / 1.5); else this.daze = Math.max(0, this.daze - dt * 0.6);
    if (this.daze >= 1 && this.state !== 'dazed') { this.state = 'dazed'; this.wait = 5.5; this.path = []; this.seen = 0; this.onDazed?.(this); }
    const range = (pl.hidden ? 0 : pl.lightOn ? 17 : pl.crouch ? 4.5 : 8.5) * this.sight;
    const fwd = (Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz) / (dist || 1);
    const sees = this.sees = dist < range && (fwd > 0.15 || dist < 2.6) && this.nav.los(this.pos.x, this.pos.z, pl.pos.x, pl.pos.z);
    if (sees) { this.seen += dt * (dist < 5 ? 3 : 1); this.lostT = 0; this.lastKnown.copy(pl.pos); } else { this.seen = Math.max(0, this.seen - dt * 0.4); this.lostT += dt; }
    const hears = !pl.hidden && pl.noise * this.hear > dist;
    let speed = 0;
    const boost = 1 + this.anger * 0.07;

    switch (this.state) {
      case 'patrol': {
        if (this.seen > 0.45) { this.startChase(pl); break; }
        if (hears) { this.investigate(pl.pos.x, pl.pos.z); break; }
        if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) { const p = Math.random() < 0.7 ? this.nav.randomPoint(pl.pos, 6, 17) : this.nav.randomPoint(); this.goTo(p.x, p.z); } break; }
        speed = 1.25 * boost * this.spd;
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
        speed = (this.urgent ? 2.7 : 1.9) * boost * this.spd;
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
      case 'dazed': {     // transfixed by the player's stare
        this.face(pl.pos.x, pl.pos.z, dt, 2);
        this.wait -= dt;
        if (this.wait <= 0) { this.daze = 0; this.giveUp(pl, 16); }
        break;
      }
      case 'chase': {
        speed = 3.55 * boost * this.spd * (1 - this.daze * 0.85);
        this.chaseT += dt;
        if (this.chaseT > 11 + this.anger) { this.giveUp(pl, 10); break; }   // it never hunts forever
        if (pl.hidden) {
          if (this.sawHide && this.hideTarget) {
            const f = this.hideTarget.front;
            if (Math.hypot(f.x - this.pos.x, f.z - this.pos.z) < 0.9) return 'caught';
            if (this.chaseT > 8) this.chaseT = 8;
            this.repath -= dt; if (this.repath <= 0) { this.goTo(f.x, f.z); this.repath = 0.5; }
          } else if (this.lostT > 1.2) { this.seen = 0; this.cool = 3; this.investigate(this.lastKnown.x, this.lastKnown.z, true); break; }
        } else {
          this.sawHide = false;
          if (dist < this.reach && this.daze < 0.55) return 'caught';
          if (this.lostT > 2.8) { this.seen = 0; this.cool = 3; this.investigate(this.lastKnown.x, this.lastKnown.z, true); break; }
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
    if (this.kind === 'crawler') this.crawl(dt, moving, speed, time);
    else if (!moving) this.play(this.state === 'stare' || this.state === 'dazed' ? 'headShake' : 'idle', 0.35, this.state === 'stare' ? 0.5 : this.state === 'dazed' ? 0.25 : 1);
    else if (speed > 2.4) this.play('run', 0.2, speed / 3.9);
    else this.play('walk', 0.3, speed / 1.45);
    if (this.morphs) { const open = this.state === 'chase' ? 1 : this.state === 'dazed' ? 0.5 : 0.12; for (const m of this.morphs) m.o.morphTargetInfluences[m.i] += (open - m.o.morphTargetInfluences[m.i]) * Math.min(1, dt * 6); }
    if (moving) {
      this.stepPh += dt * (speed > 2.4 ? 5.4 : 3.2);
      if (this.stepPh > 1) { this.stepPh = 0; const pan = Math.sin(Math.atan2(-dx, -dz) - pl.yaw + Math.PI); if (this.kind === 'crawler') this.audio.crawlStep(Math.max(0, 1 - dist / 13), -pan); else this.audio.ghostStep(Math.max(0, 1 - dist / 15) * (speed > 2.4 ? 1 : 0.6), -pan); }
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

// ====================================================================== The Wraith (flies; drawn to light; passes through shelves)
export class Wraith {
  constructor(scene, audio) {
    this.audio = audio; this.kind = 'wraith';
    const root = this.root = new THREE.Group(); this.pos = root.position; this.yaw = 0;
    // --- tattered shroud
    const pts = [[0.001, 2.0], [0.1, 1.97], [0.17, 1.86], [0.185, 1.72], [0.16, 1.58], [0.2, 1.5], [0.33, 1.42], [0.36, 1.25], [0.33, 1.0], [0.36, 0.7], [0.45, 0.35], [0.56, 0.0], [0.6, -0.35]].map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(40), 40);
    this.cloth = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uTrail: { value: 0 }, uOpacity: { value: 1 }, uAnger: { value: 0 } }]),
      fog: true, transparent: true, side: THREE.DoubleSide,
      vertexShader: `uniform float uTime, uTrail; varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main(){ vUv = uv; vec3 p = position; float h = clamp((1.45 - p.y) / 1.8, 0.0, 1.0); float hh = h * h;
          p.z *= 0.72;
          p.x += sin(p.y * 5.0 + uTime * 2.3 + p.z * 4.0) * 0.07 * hh + sin(uTime * 1.1 + p.y * 2.0) * 0.05 * hh;
          p.z += cos(p.y * 4.0 + uTime * 1.9 + p.x * 5.0) * 0.07 * hh - (0.25 + uTrail) * hh * 1.1;
          p.xz *= 1.0 + 0.12 * sin(uTime * 1.3 + p.y * 3.0) * hh;
          vP = position; vN = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); vV = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime, uOpacity, uAnger; varying vec3 vP; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        #include <fog_pars_fragment>
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        void main(){
          // the hood's opening
          if (vP.z > 0.0 && pow(vP.x / 0.115, 2.0) + pow((vP.y - 1.71) / 0.16, 2.0) < 1.0) discard;
          float h = clamp((1.2 - vP.y) / 1.55, 0.0, 1.0);
          float n = noise(vec2(vUv.x * 46.0, vP.y * 5.0)) * 0.6 + noise(vec2(vUv.x * 140.0, vP.y * 16.0 - uTime * 0.15)) * 0.4;
          if (n < h * h * 1.15 - 0.08) discard;                       // rotted, ragged hem
          float fr = pow(1.0 - abs(dot(normalize(vV), normalize(vN))), 2.5);
          float weave = 0.75 + 0.25 * noise(vec2(vUv.x * 300.0, vP.y * 120.0));
          vec3 col = vec3(0.016, 0.019, 0.024) * weave + mix(vec3(0.12, 0.17, 0.24), vec3(0.3, 0.05, 0.04), uAnger) * fr * 0.4;
          gl_FragColor = vec4(col, uOpacity * (1.0 - h * 0.35));
          #include <fog_fragment>
        }`,
    });
    const robe = new THREE.Mesh(geo, this.cloth); robe.frustumCulled = false; root.add(robe);
    // --- what is inside the hood
    const dark = this.dark = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true });
    const bone = this.bone = new THREE.MeshStandardMaterial({ color: 0x262420, roughness: 1, emissive: 0x141a1e, emissiveIntensity: 0.6, transparent: true });
    const head = this.head = new THREE.Group(); head.position.set(0, 1.71, 0.02); root.add(head);
    const voidS = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), dark); voidS.scale.set(0.95, 1.1, 0.6); voidS.position.z = -0.05; head.add(voidS);
    const sg = new THREE.SphereGeometry(0.088, 28, 22), sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) {   // pinch the sphere into a skull: narrow jaw, hollow cheeks, heavy brow
      let x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      if (y < 0) x *= 1 + y / 0.088 * 0.42;
      if (z > 0) { const cheek = Math.exp(-((Math.abs(x) - 0.05) ** 2 + (y + 0.02) ** 2) / 0.0005); z -= cheek * 0.02; const brow = Math.exp(-((y - 0.03) ** 2) / 0.00012) * (Math.abs(x) < 0.07 ? 1 : 0); z += brow * 0.008; }
      sp.setXYZ(i, x, y, z);
    }
    sg.computeVertexNormals();
    const skull = new THREE.Mesh(sg, bone); skull.scale.set(0.82, 1.08, 0.8); skull.position.set(0, 0.03, 0.035); head.add(skull);
    const jaw = this.jaw = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), bone); jaw.scale.set(0.9, 1.0, 0.75); jaw.position.set(0, -0.075, 0.05); head.add(jaw);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe4ff).multiplyScalar(3), fog: false, transparent: true });
    for (const sx of [-1, 1]) {
      const so = new THREE.Mesh(new THREE.SphereGeometry(0.027, 12, 10), dark); so.scale.set(1.2, 0.95, 0.6); so.rotation.z = sx * 0.38; so.position.set(sx * 0.034, 0.043, 0.094); head.add(so);
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 8, 6), this.eyeMat); e.position.set(sx * 0.033, 0.041, 0.1); head.add(e);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.028, 6), dark); nose.position.set(0, 0.0, 0.104); head.add(nose);
    const mouth = this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), dark); mouth.scale.set(0.85, 1, 0.5); mouth.position.set(0, -0.07, 0.083); head.add(mouth);
    for (let i = -3; i <= 3; i++) { const tth = new THREE.Mesh(new THREE.BoxGeometry(0.0052, 0.012 - Math.abs(i) * 0.0012, 0.004), bone); tth.position.set(i * 0.0064, -0.047, 0.094 - Math.abs(i) * 0.0016); head.add(tth); }
    // --- long arms
    const sleeve = this.sleeve = new THREE.MeshBasicMaterial({ color: 0x040506, transparent: true, side: THREE.DoubleSide });
    this.arms = [-1, 1].map((sx) => {
      const sh = new THREE.Group(); sh.position.set(sx * 0.29, 1.4, 0.02); root.add(sh);
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.5, 10, 1, true), sleeve); up.position.y = -0.25; sh.add(up);
      const el = new THREE.Group(); el.position.y = -0.48; sh.add(el);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.019, 0.5, 6), bone); fore.position.y = -0.25; el.add(fore);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 10, 1, true), sleeve); cuff.position.y = -0.1; el.add(cuff);
      const hand = new THREE.Group(); hand.position.y = -0.5; el.add(hand);
      for (let f = 0; f < 5; f++) {
        const a = (f - 2) * 0.3;
        const fg = new THREE.Mesh(new THREE.ConeGeometry(0.008, f === 0 ? 0.11 : 0.19, 5), bone);
        fg.position.set(Math.sin(a) * 0.075, -0.085 - Math.cos(a) * 0.02, 0.01); fg.rotation.set(0.35, 0, Math.PI - a * 0.9); hand.add(fg);
      }
      return { sh, el, hand, sx };
    });
    this.light = new THREE.PointLight(0x7aa6d8, 0, 8, 1.8); this.light.position.set(0, 1.5, 0.5); root.add(this.light);
    this.target = new THREE.Vector3(); this.lastKnown = new THREE.Vector3(); this.vel = new THREE.Vector3();
    scene.add(root); this.reset();
  }

  reset() { this.state = 'dormant'; this.root.visible = false; this.light.intensity = 0; this.fade = 0; this.cool = 0; this.daze = 0; this.stared = false; this.t = 0; this.wailT = 6; this.reachK = 0; this.vel.set(0, 0, 0); }
  spawn(p) { this.pos.set(p.x, 6.2, p.z); this.state = 'drift'; this.fade = 0; this.root.visible = true; this.t = 0; this.cool = 8; this.#pick(); }
  get active() { return this.state !== 'dormant'; }
  get hunting() { return this.state === 'swoop' || this.state === 'notice'; }
  headPos(out) { return this.head.getWorldPosition(out); }
  setOpacity(o) { this.cloth.uniforms.uOpacity.value = o; for (const m of [this.dark, this.bone, this.sleeve, this.eyeMat]) m.opacity = o; this.root.visible = o > 0.01; }
  face(x, z, dt, rate = 4) {
    const t = Math.atan2(x - this.pos.x, z - this.pos.z); let d = t - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (dt === null ? 1 : 1 - Math.exp(-dt * rate)); this.root.rotation.y = this.yaw;
  }
  #pick() { this.target.set((Math.random() - 0.5) * 18, 4.6 + Math.random() * 2.6, (Math.random() - 0.5) * 34); }
  investigate() { /* it does not care about noise */ }

  present(dt, time, attack = 0) {
    const u = this.cloth.uniforms; u.uTime.value = time; u.uAnger.value += (attack - u.uAnger.value) * Math.min(1, dt * 4);
    this.reachK += (attack - this.reachK) * Math.min(1, dt * 3.5);
    const k = this.reachK;
    for (const a of this.arms) {
      a.sh.rotation.set(-0.25 - k * 1.25 + Math.sin(time * 1.3 + a.sx) * 0.08, 0, a.sx * (0.16 + k * 0.1));
      a.el.rotation.set(-0.35 - k * 0.5 + Math.sin(time * 1.7 + a.sx * 2) * 0.1, 0, -a.sx * k * 0.25);
      a.hand.rotation.set(-0.3 - k * 0.6, 0, 0);
    }
    const open = 0.5 + k * 1.6 + Math.sin(time * 9) * 0.08 * k;
    this.mouth.scale.set(0.85, open, 0.5); this.mouth.position.y = -0.07 - k * 0.02; this.jaw.position.y = -0.075 - k * 0.035;
    this.head.rotation.set(-0.12 + k * 0.3, Math.sin(time * 0.6) * 0.15 * (1 - k), Math.sin(time * 23) * 0.04 * k);
    this.root.rotation.x = 0.1 + this.vel.length() * 0.07;
  }

  /** returns 'caught' when it reaches the player */
  update(dt, pl, world, time) {
    if (this.state === 'dormant') return null;
    this.fade = Math.min(1, this.fade + dt * 0.5); this.t += dt; this.cool = Math.max(0, this.cool - dt);
    const eyeY = pl.eye ?? 1.6;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z, flat = Math.hypot(dx, dz);
    const lit = !pl.hidden && (pl.lightOn ? flat < 15 : (!pl.crouch && flat < 4.5));
    if (lit) this.lastKnown.set(pl.pos.x, eyeY - 1.6, pl.pos.z);
    if (this.stared && this.state !== 'dazed') this.daze = Math.min(1, this.daze + dt / 1.4); else this.daze = Math.max(0, this.daze - dt * 0.6);
    if (this.daze >= 1 && this.state !== 'dazed') { this.state = 'dazed'; this.t = 0; this.onDazed?.(this); }
    let speed = 1.5, attack = 0;
    switch (this.state) {
      case 'drift': {
        if (this.pos.distanceTo(this.target) < 1) this.#pick();
        this.wailT -= dt; if (this.wailT <= 0) { this.wailT = 14 + Math.random() * 16; this.audio.wail(Math.max(0.12, 1 - flat / 22) * 0.6, Math.max(-1, Math.min(1, dx / -8))); }
        if (lit && this.cool <= 0 && (!this.canHunt || this.canHunt(this))) { this.state = 'notice'; this.t = 0; this.audio.wail(1, 0); this.onAlert?.(this); }
        break;
      }
      case 'notice': {            // hangs in the air above, looking down — a warning
        speed = 0.6; attack = 0.5; this.target.set(this.pos.x, Math.min(this.pos.y, 4.6), this.pos.z); this.face(pl.pos.x, pl.pos.z, dt, 5);
        if (this.t > 1.7) { this.state = lit ? 'swoop' : 'drift'; this.t = 0; if (!lit) { this.cool = 6; this.#pick(); this.onGiveUp?.(this); } }
        break;
      }
      case 'swoop': {
        attack = 1; speed = 5.0 * (1 - this.daze * 0.9);
        this.target.copy(this.lastKnown);
        const hd = Math.hypot(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z);
        if (lit && flat < 0.95 && Math.abs(this.pos.y - (eyeY - 1.6)) < 0.9 && this.daze < 0.55) return 'caught';
        if (this.t > 9 || pl.hidden || (!lit && hd < 0.8)) { this.state = 'rise'; this.t = 0; this.cool = 14; this.onGiveUp?.(this); }
        break;
      }
      case 'rise': { speed = 2.6; this.target.set(this.pos.x + Math.sin(this.yaw) * 4, 6.2, this.pos.z + Math.cos(this.yaw) * 4); if (this.t > 3) { this.state = 'drift'; this.#pick(); } break; }
      case 'dazed': { speed = 0; attack = 0.25; this.face(pl.pos.x, pl.pos.z, dt, 3); if (this.t > 5) { this.daze = 0; this.state = 'rise'; this.t = 0; this.cool = 18; this.onGiveUp?.(this); } break; }
      default: break;
    }
    // steer
    _v.copy(this.target).sub(this.pos); const d = _v.length();
    if (d > 0.01) _v.multiplyScalar(Math.min(speed, d * 2.5) / d); else _v.set(0, 0, 0);
    this.vel.lerp(_v, 1 - Math.exp(-dt * 2.6)); this.pos.addScaledVector(this.vel, dt);
    this.pos.x = Math.max(-11.5, Math.min(11.5, this.pos.x)); this.pos.z = Math.max(-19.5, Math.min(19.5, this.pos.z));
    if (this.state !== 'notice' && this.state !== 'dazed' && this.vel.lengthSq() > 0.05) this.face(this.pos.x + this.vel.x, this.pos.z + this.vel.z, dt, 3);
    else if (this.state === 'swoop') this.face(pl.pos.x, pl.pos.z, dt, 6);
    this.cloth.uniforms.uTrail.value = Math.min(1, this.vel.length() / 5);
    const flick = 0.85 + 0.15 * Math.sin(time * 27) * Math.sin(time * 6.1);
    this.setOpacity(this.fade * (this.state === 'drift' || this.state === 'rise' ? 0.82 * flick : 1));
    this.light.intensity = this.fade * (attack > 0.4 ? 2.6 : 1.1) * flick;
    this.pos.y += Math.sin(time * 1.4) * 0.004;
    this.present(dt, time, attack);
    return null;
  }
}
