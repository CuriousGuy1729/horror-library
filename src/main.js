import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLOWS } from './ghost.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Nav } from './nav.js';
import { Player } from './player.js';
import { GameAudio } from './audio.js';
import { createTrailer } from './trailer.js';
import { Gear } from './gear.js';
import { Hanged, Archivist, Hollow, Wraith, retargetClips } from './ghost.js';
import { Bats, Posters, Radar } from './extras.js';

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), objective: $('objective'), keys: [...document.querySelectorAll('#keys .key')], crosshair: $('crosshair'),
  prompt: $('prompt'), message: $('message'), battery: $('battery'), batteryFill: $('batteryFill'), stamina: $('stamina'),
  staminaFill: $('staminaFill'), hideHint: $('hideHint'), hideMask: $('hideMask'), flash: $('flash'), scare: $('scare'),
  fade: $('fade'), note: $('note'), noteText: $('noteText'), menu: $('menu'), loading: $('loading'), loadFill: $('loadFill'),
  loadText: $('loadText'), start: $('start'), pause: $('pause'), dead: $('dead'), deadText: $('deadText'), won: $('won'), wonText: $('wonText'),
  quality: $('quality'), sens: $('sens'), vol: $('vol'),
  radar: $('radar'), radarBox: $('radarBox'), radarText: $('radarText'), radioBox: $('radioBox'), radioMsg: $('radioMsg'), nerve: $('nerve'), nerveFill: $('nerveFill'),
};
const canvas = $('game');
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
ui.quality.value = store.get('ha.q', 'medium'); ui.sens.value = store.get('ha.s', '1'); ui.vol.value = store.get('ha.v', '0.8');

// ---------------------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.06, 90);
scene.add(camera);
const audio = new GameAudio();

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFear: { value: 0 }, uHurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uFear, uHurt; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 3.7) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      float ab = (0.0015 + uFear * 0.006 + uHurt * 0.02) * r2 * 4.0;
      vec2 wob = c * (uHurt * 0.04 * sin(uTime * 40.0));
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * ab + wob).r, texture2D(tDiffuse, vUv + wob).g, texture2D(tDiffuse, vUv - c * ab + wob).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * vec3(0.92, 1.0, 1.1), 0.18 + uFear * 0.3);          // cold, slightly drained grade
      col *= 1.0 - smoothstep(0.14, 0.75, r2) * (0.5 + uFear * 0.35);            // vignette closes in with fear
      col += (hash(gl_FragCoord.xy) - 0.5) * (0.035 + uFear * 0.03);              // film grain
      col = mix(col, vec3(col.r * 1.2 + 0.05, col.g * 0.25, col.b * 0.25), uHurt * 0.6);
      gl_FragColor = vec4(max(col, 0.0), 1.0); }`,
};
let composer, grade, bloom, quality = 'medium', resScale = 1;
const fixedPr = +(new URLSearchParams(location.search).get('pr') || 0);   // ?pr=0.6 pins the resolution (testing, trailer capture)
function setupPost() {
  const pr = (quality === 'low' ? Math.min(devicePixelRatio, 1) * 0.8 : quality === 'medium' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 2)) * resScale;
  const dbg = fixedPr;
  if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); if (bloom) bloom.dispose(); bloom = null; }
  renderer.setPixelRatio(dbg ? +dbg : pr); renderer.setSize(innerWidth, innerHeight, false);
  const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (quality !== 'low') { bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.42, 0.7, 0.82); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader); composer.addPass(grade);
}
// ---- frame-rate guard: if the machine cannot hold ~45 fps, render fewer pixels (then drop torch shadows) instead of stuttering
const perf = { ms: 16, t: 0, last: 0, warm: 4, stage: 0 };
function guardFps() {
  const now = performance.now(), d = now - perf.last; perf.last = now;
  if (fixedPr || d > 250 || d <= 0) return;                       // tab was hidden, or a one-off hitch
  if (perf.warm > 0) { perf.warm -= d / 1000; return; }
  perf.ms += (d - perf.ms) * 0.05; perf.t += d / 1000;
  if (perf.t < 2) return;
  perf.t = 0;
  if (perf.ms < 22) return;
  if (resScale > 0.56) { resScale = Math.max(0.55, resScale * 0.82); setupPost(); perf.ms = 16; perf.warm = 1; }
  else if (perf.stage === 0 && player) { perf.stage = 1; player.torch.castShadow = false; perf.ms = 16; perf.warm = 2; }
}
// ---- the pool of real lights the ghosts' glows are routed through
const glowPool = [0, 1].map(() => { const l = new THREE.PointLight(0xffffff, 0, 7, 1.8); scene.add(l); return l; });
const _gv = new THREE.Vector3(), _gl = [];
function updateGlows() {
  _gl.length = 0;
  for (const g of GLOWS) {
    if (g.intensity < 0.02) continue;
    let vis = true; for (let o = g.parent; o; o = o.parent) if (!o.visible) { vis = false; break; }
    if (!vis) continue;
    g.getWorldPosition(_gv); g._d = _gv.distanceToSquared(camera.position); g._score = g.intensity / (1 + g._d * 0.02); _gl.push(g);
  }
  _gl.sort((a, b) => b._score - a._score);
  for (let i = 0; i < glowPool.length; i++) {
    const l = glowPool[i], g = _gl[i];
    if (!g) { l.intensity = 0; continue; }
    g.getWorldPosition(l.position); l.color.copy(g.color); l.intensity = g.intensity; l.distance = g.distance; l.decay = g.decay;
  }
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false); composer?.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------- loading
const assets = {};
async function load() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const files = [['lib', 'library.glb', 0.5], ['arch', 'archivist.glb', 0.12], ['hol', 'hollow.glb', 0.16], ['crawl', 'crawler.glb', 0.04], ['man', 'human_m.glb', 0.03], ['woman', 'human_f.glb', 0.03],
    ['aIdle', 'anim/m_idle.glb', 0.02], ['aWalk', 'anim/m_walk.glb', 0.02], ['aRun', 'anim/m_run.glb', 0.02], ['aCrouch', 'anim/m_crouch.glb', 0.02], ['fIdle', 'anim/f_idle.glb', 0.02]];
  const prog = files.map(() => 0);
  const upd = () => { ui.loadFill.style.width = Math.round(prog.reduce((a, p, i) => a + p * files[i][2], 0) * 100) + '%'; };
  const get = (url, i) => loader.loadAsync(url, (e) => { prog[i] = e.total ? e.loaded / e.total : Math.min(0.95, e.loaded / 6e6); upd(); }).then((g) => { prog[i] = 1; upd(); return g; });
  ui.loadText.textContent = 'Lighting the candles… tuning the radio…';
  const samples = audio.loadSamples().catch(() => {});
  const [level, ...glbs] = await Promise.all([fetch('/assets/level.json').then((r) => r.json()), ...files.map((f, i) => get('/assets/' + f[1], i))]);
  assets.level = level; files.forEach((f, i) => { assets[f[0]] = glbs[i]; });
  await samples;
  ui.loading.classList.add('hidden'); ui.start.classList.remove('hidden');
}
load().catch((e) => { console.error(e); ui.loadText.textContent = 'Could not load the library — ' + e.message; });

// ---------------------------------------------------------------------------- game state
let child, shadow, gear;
let world, nav, player, archivist, crawler, wraith, nun, skeleton, hanged, ghosts = [], hollow, level, bats, posters, radar, hemi;
let state = 'menu';            // menu | playing | paused | dying | dead | won
let noLock = false, dragging = false;
let G = null;                  // per-run state
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** takes the single clip out of an animation-only GLB, renames it and pins the hips in place (no root motion) */
function named(gltf, name) {
  const c = gltf.animations[0]; c.name = name;
  for (const t of c.tracks) if (/Hips\.position$/.test(t.name)) for (let i = 3; i < t.values.length; i += 3) { t.values[i] = t.values[0]; t.values[i + 2] = t.values[2]; }
  c.tracks = c.tracks.filter((t) => !/\.scale$/.test(t.name) && (!/\.position$/.test(t.name) || /Hips\.position$/.test(t.name)));
  return c;
}

function build() {
  quality = ui.quality.value; level = assets.level;
  setupPost();
  world = new World(scene, renderer, assets.lib, level, quality);
  nav = new Nav(level);
  player = new Player(camera, scene, world, audio, quality);
  // the hunter borrows the mannequin's motion clips
  const want = ['idle', 'walk', 'run', 'headShake'];
  const clips = assets.hol.animations.filter((c) => want.includes(c.name));
  assets.hol.scene.updateMatrixWorld(true); assets.arch.scene.updateMatrixWorld(true);
  const archClips = retargetClips(clips, assets.hol.scene, assets.arch.scene);
  archivist = new Archivist(scene, assets.arch, archClips, nav, audio);
  crawler = new Archivist(scene, assets.crawl, [], nav, audio, { kind: 'crawler', speed: 1.1, sight: 0.6, hear: 1.9, reach: 1.15 });
  wraith = new Wraith(scene, audio);
  // the weeping sister glides (idle only: her skirt hides the legs); the bone man walks on the mannequin's clips
  assets.woman.userData.idle = named(assets.fIdle, 'idle');
  const childRig = cloneRig(assets.woman.scene);   // cloned before the Sister's habit is built onto the original
  nun = new Archivist(scene, assets.woman, [assets.woman.userData.idle], nav, audio, { kind: 'nun', speed: 0.82, sight: 0.6, hear: 0.75, reach: 1.0, linger: 3 });
  skeleton = new Archivist(scene, { scene: cloneRig(assets.hol.scene) }, clips, nav, audio, { kind: 'skeleton', speed: 0.93, sight: 0.85, hear: 1.1, reach: 1.05 });
  hanged = new Hanged(scene, cloneRig(assets.hol.scene), assets.hol.animations);
  // the lost child (a second, smaller spirit) and the shadow (a silhouette that only moves when unobserved)
  child = new Archivist(scene, { scene: childRig }, [assets.woman.userData.idle], nav, audio, { kind: 'child', speed: 1.0, sight: 0.7, hear: 1.2, reach: 0.9, linger: 2 });
  shadow = new Archivist(scene, { scene: cloneRig(assets.hol.scene) }, clips, nav, audio, { kind: 'shadow', speed: 1, sight: 1, hear: 0, reach: 0.95 });
  gear = new Gear(camera);
  ghosts = [archivist, crawler, wraith, nun, skeleton, child, shadow];
  hollow = new Hollow(scene, assets.hol.scene, assets.hol.animations);
  player.setBody(assets.man, [named(assets.aIdle, 'Idle'), named(assets.aWalk, 'Walk'), named(assets.aRun, 'Run'), named(assets.aCrouch, 'Crouch')]);
  bats = new Bats(scene, 40); posters = new Posters(scene, renderer); radar = new Radar(ui.radar, ui.radarText);
  scene.traverse((o) => { if (o.isHemisphereLight) hemi = o; });
  const alertLine = { archivist: 'RUN.', crawler: 'IT IS UNDER THE TABLES. RUN.', wraith: 'ABOVE YOU. KILL THE LIGHT.', nun: 'SHE HAS STOPPED CRYING. RUN.', skeleton: 'THE BONES ARE COMING. RUN.', child: 'SHE WANTS TO PLAY. RUN.', shadow: 'DO NOT LOOK AWAY.' };
  for (const g of ghosts) {
    g.canHunt = (me) => G.huntCool <= 0 && !ghosts.some((o) => o !== me && o.hunting);   // only one of them hunts at a time
    g.onAlert = (me) => { say(alertLine[me.kind], 1.8); player.shake = Math.max(player.shake, 0.5); const pan = panTo(me.pos.x, me.pos.z); if (me.kind === 'crawler') audio.growl(1, pan); else if (me.kind === 'nun') audio.shriek(0.9, pan); else if (me.kind === 'child') { audio.giggle(1.4, pan); audio.smp('children-laughing-3', { vol: 0.9, pan }); } else if (me.kind === 'skeleton') { for (let i = 0; i < 6; i++) setTimeout(() => audio.rattle(1, pan), i * 90); audio.moan(1, pan); } };
    g.onSuspect = (me) => { if (state === 'playing' && !anyHunting()) { say('Something has turned towards you. Break its line of sight.', 3); audio.whisper(panTo(me.pos.x, me.pos.z), 0.9); G.fear = Math.max(G.fear, 0.6); } };
    g.onHeardInside = () => { say('IT HEARD YOU IN THERE.', 2.5); };
    g.onGiveUp = () => { G.huntCool = 10 + Math.random() * 8; if (state === 'playing') say('It has lost interest… for now.', 3); };
    g.onDazed = (me) => { G.huntCool = 8; me.dazeImmune = 30; G.stares++; say('It cannot look away. Go — quietly.', 3.5); audio.whisper(panTo(me.pos.x, me.pos.z), 1); };
  }
  archivist.onStare = () => { audio.knock(0); setTimeout(() => audio.whisper(0, 0.9), 900); };
  // compile every shader up front (hidden ghosts included) so nothing hitches the first time it appears
  const hid = []; scene.traverse((o) => { if (!o.visible) { hid.push(o); o.visible = true; } });
  try { renderer.compile(scene, camera); } catch { /* not fatal */ }
  for (const o of hid) o.visible = false;
}

function newRun() {
  world.reset(); for (const g of ghosts) g.reset(); hollow.hide(); hanged.hide(); posters.reset(); if (G) for (const b of G.books) scene.remove(b.m);
  crawler.inner.rotation.x = Math.PI / 2; crawler.inner.position.set(0, 0.3, -0.8);
  player.reset({ x: level.playerSpawn[0], z: level.playerSpawn[2] });
  player.sens = +ui.sens.value;
  const hints = world.spawnItems();
  // two of the dead are already walking the hall before anything is touched
  const sp = { x: level.playerSpawn[0], z: level.playerSpawn[2] };
  nun.spawn({ x: level.ghostSpawn[0], z: level.ghostSpawn[2] });
  skeleton.spawn(nav.randomPoint(sp, 20, 34));
  G = {
    emfOn: false, emfLv: 0, emfSpike: 0, emfT: 0, emfJit: 0, voiceCool: 0, replyCool: 0, talkT: 0, quietT: 0, radioWord: '', radioWordT: 0, bookT: 0, books: [],
    cryT: 5, introT: 7, time: 0, hints, noteRead: false, noteOpen: false, awake: false, awakeT: -1, exit: 'locked', exitT: 0, fear: 0, hurt: 0,
    scareT: 14 + Math.random() * 14, lastScare: '', ev: null, dieT: 0, hides: 0, scares: 0, target: null, msgT: 0, peekT: 0, batteriesWarned: false,
    huntCool: 18, awakeAt: 0, stares: 0, nerveBroken: false, staring: false, flashT: 0, flashDur: 1, stormT: 14 + Math.random() * 12, pingT: 0, radioT: 12, killer: null, staredHint: false, tipT: 9,
  };
  ui.noteText.innerHTML = '<p><i>The doors are sealed with three locks. I have hidden the keys where no reader would think to look:</i></p><ul>' +
    hints.map((h) => `<li>One lies ${h}.</li>`).join('') + '</ul><p><i>Should you take one, I will know. Put out your light when you hear me. Stand inside the cabinets and do not breathe.</i></p>';
  ui.keys.forEach((k) => k.classList.remove('got'));
  ui.fade.classList.remove('on', 'white'); ui.scare.classList.remove('on', 'peek'); ui.hideMask.classList.remove('on'); ui.hideHint.classList.add('hidden');
  if (player.radio) { player.radio = false; }
  audio.setRadio(false); ui.radioBox.classList.remove('on'); ui.radioMsg.textContent = '';
  objective('Read the <b>ledger</b> on the desk');
  say('The doors have locked behind you.', 4.5);
}

function objective(html) { ui.objective.innerHTML = html; }
function say(text, dur = 3.5) { ui.message.textContent = text; ui.message.classList.add('show'); G.msgT = dur; }
function flash(strength = 0.8, ms = 500) {
  ui.flash.style.transition = 'none'; ui.flash.style.opacity = strength; void ui.flash.offsetWidth;
  ui.flash.style.transition = `opacity ${ms}ms ease-out`; ui.flash.style.opacity = 0;
}
function panTo(x, z) { // -1 (left) .. 1 (right) relative to where the player looks
  const dx = x - player.pos.x, dz = z - player.pos.z, d = Math.hypot(dx, dz) || 1;
  return (Math.cos(player.yaw) * dx - Math.sin(player.yaw) * dz) / d;
}

// ---------------------------------------------------------------------------- flow
function lock() { if (!noLock && document.pointerLockElement !== canvas) { try { const p = canvas.requestPointerLock(); p?.catch?.(() => { noLock = true; }); } catch { noLock = true; } } }
function startGame() {
  audio.init(); audio.setVolume(+ui.vol.value); audio.resume();
  if (!world) {
    ui.start.textContent = 'Opening…';
    try { build(); } catch (e) { console.error(e); ui.start.textContent = 'Failed: ' + e.message; return; }
  }
  newRun();
  for (const o of [ui.menu, ui.dead, ui.won, ui.pause, ui.note]) o.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  audio.startAmbience(); audio.startScore();
  state = 'playing'; lock();
}
function pause() { if (state !== 'playing') return; state = 'paused'; ui.pause.classList.remove('hidden'); audio.suspend(); player.keys = {}; if (document.pointerLockElement) document.exitPointerLock(); }
function resume() { if (state !== 'paused') return; state = 'playing'; ui.pause.classList.add('hidden'); audio.resume(); lock(); }

// ---------------------------------------------------------------------------- trailer (open the page with ?trailer)
let trailer = null;
const TRAILER = new URLSearchParams(location.search).has('trailer');
async function startTrailer(withRecording) {
  audio.init(); audio.setVolume(+ui.vol.value); audio.resume();
  let finish = null;
  if (!world) { try { build(); } catch (e) { console.error(e); ui.start.textContent = 'Failed: ' + e.message; return; } }
  trailer ||= createTrailer({
    camera, audio, world, player, hanged, bats, level, ghosts: { archivist, crawler, wraith, nun, skeleton },
    lightning, flash, scareEl: ui.scare, setFear: (f) => { G.fear = f; },
  });
  if (withRecording) { try { finish = await trailer.record(); } catch (e) { $('trlNote').textContent = 'Recording was not started: ' + e.message; return; } }
  newRun(); for (const g of ghosts) g.reset();
  G.stormT = 1e9; G.fear = 0;
  for (const o of [ui.menu, ui.dead, ui.won, ui.pause, ui.note, ui.hud]) o.classList.add('hidden');
  ui.fade.classList.remove('on', 'white');
  audio.startAmbience(); audio.startScore();
  state = 'trailer';
  trailer.start(async () => { state = 'menu'; ui.menu.classList.remove('hidden'); audio.update(0.016, { ghostDist: 99, ghostActive: false, chase: false, ghostPan: 0, fear: 0, ambient: false, tension: 0, staticLevel: 0, winded: 0 }); await finish?.(); });
}
function updateTrailer(dt) {
  G.time += dt; gear.emf.visible = gear.radio.visible = false;
  trailer.update(dt);
  if (state !== 'trailer') return;
  updateStorm(dt);
  world.update(dt, camera, player.torchState); bats.update(dt, G.time);
  audio.update(dt, { ghostDist: 99, ghostActive: G.fear > 0.3, chase: G.fear > 0.95, ghostPan: 0, fear: G.fear * 0.8, ambient: false, tension: Math.max(0.3, G.fear), staticLevel: 0, winded: 0 });
}
if (!TRAILER) { const l = document.createElement('a'); l.href = '?trailer'; l.textContent = 'Watch the trailer'; l.style.cssText = 'display:block;margin-top:14px;color:#a39a86;font-size:13px;letter-spacing:.25em;text-transform:uppercase;text-decoration:none'; document.querySelector('.settings')?.after(l); }
if (TRAILER) {
  document.querySelector('.controls')?.classList.add('hidden'); document.querySelector('.settings')?.classList.add('hidden');
  ui.start.textContent = 'Play the trailer';
  const box = document.createElement('div'); box.id = 'trlMenu';
  box.innerHTML = '<button id="trlRecBtn" class="hidden">Record the trailer</button><button id="trlPlayBtn" class="hidden">Play the game</button>';
  const note = document.createElement('p'); note.id = 'trlNote'; note.textContent = 'Best in fullscreen (F11). “Record” asks to share this tab, then saves a .webm video when the trailer ends.';
  ui.start.after(box, note);
  new MutationObserver(() => { const on = !ui.start.classList.contains('hidden'); $('trlRecBtn').classList.toggle('hidden', !on); $('trlPlayBtn').classList.toggle('hidden', !on); }).observe(ui.start, { attributes: true, attributeFilter: ['class'] });
  $('trlRecBtn').onclick = () => startTrailer(true); $('trlPlayBtn').onclick = () => { location.search = ''; };
}
ui.start.onclick = TRAILER ? () => startTrailer(false) : startGame; $('retry').onclick = startGame; $('again').onclick = startGame; $('resume').onclick = resume;
ui.quality.onchange = () => { store.set('ha.q', ui.quality.value); if (world) location.reload(); };
ui.sens.oninput = () => { store.set('ha.s', ui.sens.value); if (player) player.sens = +ui.sens.value; };
ui.vol.oninput = () => { store.set('ha.v', ui.vol.value); audio.setVolume(+ui.vol.value); };
document.addEventListener('pointerlockerror', () => { noLock = true; });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && state === 'playing' && !noLock) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

addEventListener('keydown', (e) => {
  if (state === 'trailer') { if (e.code === 'Escape') trailer.stop(); return; }
  if (state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) { resume(); return; }
  if (state !== 'playing') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  player.keys[e.code] = true;
  if (e.code === 'KeyF') { if (player.toggleTorch() === 'dead') say('The torch is dead. Find batteries.', 2.5); }
  else if (e.code === 'KeyE') interact();
  else if (e.code === 'KeyV') say(player.toggleView() === 'third' ? 'Third-person view' : 'First-person view', 1.6);
  else if (e.code === 'KeyR') toggleRadio();
  else if (e.code === 'KeyT') { G.emfOn = !G.emfOn; audio.click(); if (G.emfOn && !G.emfTold) { G.emfTold = true; say('EMF meter. One light is nothing. Five lights: it is standing next to you.', 5); } }
  else if (e.code === 'KeyM') toggleMic();
  else if (e.code === 'KeyG') throwBook();
  else if (e.code === 'KeyQ') { radar.on = !radar.on; ui.radarBox.classList.toggle('off', !radar.on); audio.click(); }
  else if (e.code === 'Escape' || e.code === 'KeyP') pause();
});
addEventListener('keyup', (e) => { if (player) player.keys[e.code] = false; });
addEventListener('blur', () => { if (player) player.keys = {}; });
canvas.addEventListener('mousedown', (e) => {
  if (state !== 'playing') return;
  if (!noLock && document.pointerLockElement !== canvas) { lock(); return; }
  if (noLock) dragging = true; else if (e.button === 0) interact();
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (state !== 'playing' || G.noteOpen) return;
  if (document.pointerLockElement === canvas || (noLock && dragging)) player.look(e.movementX, e.movementY);
});
ui.note.addEventListener('click', () => closeNote());

// ---------------------------------------------------------------------------- interaction
function findTarget() {
  if (player.mode === 'hidden') return { type: 'unhide', label: 'E — step out' };
  if (player.mode !== 'free') return null;
  camera.getWorldDirection(_a);
  const eye = camera.position;
  let best = null, bs = 0;
  const consider = (pos, reach, cone, t) => {
    _b.copy(pos).sub(eye); const d = _b.length(); if (d > reach) return;
    const dot = _b.dot(_a) / (d || 1); if (dot < cone) return;
    const s = dot - d * 0.05; if (!best || s > bs) { best = t; bs = s; }
  };
  for (const it of world.items) consider(it.pos, 2.3, 0.93, { type: it.type, it, label: it.type === 'key' ? 'E — take the key' : 'E — take the battery' });
  for (const c of world.candles) if (c.kind !== 'chandelier' && c.pos.y < 2.3) consider(c.pos, 2.1, 0.95, { type: 'candle', c, label: c.lit ? 'E — pinch out the candle' : 'E — light the candle' });
  const n = level.noteSpots[0]; consider(_c.set(...n.pos), 2.4, 0.88, { type: 'note', label: 'E — read the ledger' });
  for (const h of world.hides) { _c.copy(h.pos).setY(1.3); if (Math.hypot(h.front.x - player.pos.x, h.front.z - player.pos.z) < 1.7) consider(_c, 3, 0.8, { type: 'hide', h, label: 'E — hide in the cabinet' }); }
  if (G.exit !== 'open') consider(_c.set(level.exit.door[0], 1.4, level.exit.door[2]), 2.9, 0.8, { type: 'exit', label: player.keysHeld >= 3 ? 'E — unlock the doors' : `E — the doors  (${player.keysHeld} / 3 keys)` });
  return best;
}

function closeNote() { if (!G?.noteOpen) return; G.noteOpen = false; ui.note.classList.add('hidden'); audio.paper(); if (state === 'playing') lock(); }

function interact() {
  if (G.noteOpen) { closeNote(); return; }
  const t = G.target; if (!t) return;
  switch (t.type) {
    case 'key': {
      world.removeItem(t.it); player.keysHeld++; audio.key();
      ui.keys[player.keysHeld - 1]?.classList.add('got');
      archivist.anger = player.keysHeld;
      if (!G.awake && G.awakeT < 0) { G.awakeT = 2.2; say('A key. Cold as a tooth.', 2.2); }
      else if (player.keysHeld < 3) { say(`${3 - player.keysHeld} more.`, 2.5); for (const g of ghosts) if (g.active) g.investigate(player.pos.x, player.pos.z, true); G.scareT = Math.min(G.scareT, 6); }
      if (player.keysHeld >= 3) { say('All three. The doors — south end of the hall.', 4.5); objective('Unlock the <b>great doors</b> and escape'); for (const g of ghosts) if (g.active) g.investigate(player.pos.x, player.pos.z, true); }
      else objective(`Find the hidden <b>keys</b> — ${player.keysHeld} of 3`);
      break;
    }
    case 'candle': {        // light is safety from the Shadow and a beacon for the Wraith
      world.setLit(t.c, !t.c.lit); if (t.c.lit) { audio.click(); audio.whoosh(0); } else audio.blowOut();
      if (!G.candleTold) { G.candleTold = true; say('Candles can be lit and put out. The dark hides you. It hides them too.', 4.5); }
      break;
    }
    case 'battery': world.removeItem(t.it); player.battery = Math.min(100, player.battery + 55); audio.battery(); say('Batteries.', 1.6); break;
    case 'note':
      G.noteOpen = true; ui.note.classList.remove('hidden'); audio.paper(); player.keys = {};
      if (!G.noteRead) { G.noteRead = true; if (player.keysHeld < 3) objective(`Find the hidden <b>keys</b> — ${player.keysHeld} of 3`); }
      break;
    case 'hide':
      player.enterHide(t.h); archivist.onPlayerHide(t.h, player); crawler.onPlayerHide(t.h, player); G.hides++;
      break;
    case 'unhide': {
      const stared = archivist.state === 'stare' || crawler.state === 'stare';
      player.exitHide();
      if (!stared && archivist.active && G.hides > 1 && Math.random() < 0.3 && !ghosts.some((g) => g.hunting)) G.peekT = 0.55;
      break;
    }
    case 'exit':
      if (player.keysHeld < 3) { audio.clunk(); player.shake = Math.max(player.shake, 0.2); say(player.keysHeld ? `Three locks. You hold ${player.keysHeld} key${player.keysHeld > 1 ? 's' : ''}.` : 'Three heavy locks. No keys.', 3); }
      else if (G.exit === 'locked') {
        G.exit = 'opening'; G.exitT = 0;
        world.locks.forEach((l, i) => { audio.clunk(i * 0.45); setTimeout(() => { l.falling = true; }, i * 450 + 150); });
        say('The locks fall away…', 3);
        if (!archivist.active) { archivist.spawn(nav.randomPoint(player.pos, 14, 22)); G.awake = true; G.awakeAt = G.time; }
        archivist.anger = 5; archivist.investigate(player.pos.x, player.pos.z - 3, true);
      }
      break;
    default: break;
  }
}

// ---------------------------------------------------------------------------- microphone: the house can hear the player
const mic = { on: false, level: 0, floor: 0.01, an: null, data: null, stream: null, node: null };
async function toggleMic() {
  if (mic.on) { mic.on = false; mic.stream?.getTracks().forEach((t) => t.stop()); try { mic.node?.disconnect(); } catch { /* */ } mic.level = 0; player.voice = 0; $('micBox').classList.remove('on'); say('Microphone off.', 2); return; }
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    mic.node = audio.ctx.createMediaStreamSource(mic.stream); mic.an = audio.ctx.createAnalyser(); mic.an.fftSize = 1024; mic.data = new Float32Array(1024);
    mic.node.connect(mic.an);          // analysed only — never played back
    mic.on = true; mic.floor = 0.02; $('micBox').classList.add('on');
    say('Microphone on. They can hear you now. Whisper — or ask the radio a question.', 5.5);
  } catch { say('The microphone is not available (permission denied or no device).', 4); }
}
function updateMic(dt) {
  if (!mic.on) { player.voice = 0; return; }
  mic.an.getFloatTimeDomainData(mic.data); let e = 0; for (let i = 0; i < mic.data.length; i++) e += mic.data[i] * mic.data[i];
  const rms = Math.sqrt(e / mic.data.length);
  mic.floor += (rms - mic.floor) * (rms < mic.floor ? 0.2 : 0.002);          // follows the room's own hiss, slowly
  const lv = Math.max(0, Math.min(1, (rms - mic.floor * 1.8 - 0.012) / 0.16));
  mic.level += (lv - mic.level) * Math.min(1, dt * (lv > mic.level ? 18 : 5));
  $('micFill').style.width = (mic.level * 100).toFixed(0) + '%';
  const L = mic.level;
  player.voice = L > 0.1 ? 3 + L * 17 : 0;                                    // how far (m) your real voice carries
  G.voiceCool -= dt; G.replyCool -= dt;
  if (L > 0.1) { G.talkT += dt; G.quietT = 0; G.emfSpike = Math.max(G.emfSpike, 0.4); } else G.quietT += dt;
  if (L > 0.55 && G.voiceCool <= 0) {                                         // a shout
    G.voiceCool = 9; say(player.hidden ? 'Be quiet. BE QUIET.' : 'They heard that.', 2.5); G.fear = Math.max(G.fear, 0.7); G.emfSpike = 1.5;
    const near = ghosts.filter((g) => g.active && !g.hunting && g.kind !== 'wraith' && g.kind !== 'shadow').sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos))[0];
    if (near) near.investigate(player.pos.x, player.pos.z, true);
  }
  if (G.quietT > 0.7 && G.talkT > 0.45) {                                     // you said something and stopped: something answers
    const spoke = G.talkT; G.talkT = 0;
    if (player.radio && G.replyCool <= 0) {
      G.replyCool = 5 + Math.random() * 3;
      const near = ghosts.filter((g) => g.active).sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos))[0];
      const d = near ? near.pos.distanceTo(player.pos) : 99;
      const pool = d < 7 ? [['BEHIND YOU', null], ['I SEE YOU', 'i-see-you-2'], ['HERE', null], ['GET OUT', 'get-out-2-2']] : spoke > 2.2 ? [['GET OUT', 'get-out-2-2'], ['COMING', 'i-m-coming-to-get-you'], ['LEAVE', null], ['WHY', null]] : [['YES', null], ['NO', null], ['COLD', null], ['CLOSE', null], ['I SEE YOU', 'i-see-you-2'], ['HUSH', null]];
      const [word, smp] = pool[(Math.random() * pool.length) | 0];
      setTimeout(() => { if (state !== 'playing' || !player.radio) return; G.radioWord = word; G.radioWordT = 2.6; ui.radioMsg.textContent = `…kssh… ${word}…`; G.emfSpike = 1.6; if (!(smp && audio.radioSay(smp))) { audio.radioVoice(); speak(word.toLowerCase()); } G.fear = Math.max(G.fear, 0.65); }, 500 + Math.random() * 700);
    } else if (!player.radio && Math.random() < 0.35 && G.replyCool <= 0) { G.replyCool = 8; setTimeout(() => state === 'playing' && audio.whisper(Math.random() * 2 - 1, 1), 600); }
  }
  if (G.quietT > 1.5) G.talkT = 0;
}

// ---------------------------------------------------------------------------- EMF meter and the things in the player's hands
function updateGear(dt, nearDist) {
  G.emfSpike = Math.max(0, G.emfSpike - dt); G.radioWordT -= dt; if (G.radioWordT <= 0) G.radioWord = '';
  let lv = 0;
  if (G.emfOn) {
    let d = nearDist; if (G.ev && hollow.mode !== 'off') d = Math.min(d, hollow.pos.distanceTo(player.pos) * 0.8); if (hanged.active) d = Math.min(d, 2.5);
    lv = d < 3.2 ? 5 : d < 6 ? 4 : d < 10 ? 3 : d < 15.5 ? 2 : 1;
    G.emfJit -= dt; if (G.emfJit <= 0) { G.emfJit = 0.12 + Math.random() * 0.5; G.emfWob = Math.random() < 0.22 ? (Math.random() < 0.5 ? -1 : 1) : 0; }
    lv = Math.max(1, Math.min(5, lv + (lv > 1 ? G.emfWob || 0 : 0)));
    if (G.emfSpike > 0) lv = Math.max(lv, G.emfSpike > 1 ? 5 : 3);
    G.emfT -= dt; if (G.emfT <= 0) { G.emfT = [9, 9, 0.5, 0.3, 0.17, 0.09][lv]; audio.emf(lv); }
    if (lv >= 4 && !G.emfWarned) { G.emfWarned = true; say('The meter is screaming. It is very close.', 3); }
  }
  G.emfLv = lv;
  gear.update(dt, { visible: player.camDist < 0.3 && player.mode === 'free' && !G.noteOpen, emfOn: G.emfOn, radioOn: player.radio, level: lv, staticLevel: Math.max(0, 1 - nearDist / 14), speed: Math.hypot(player.vel.x, player.vel.z), word: G.radioWord, light: player.torchState.power });
}

// ---------------------------------------------------------------------------- throwing a book: a noise somewhere that is not you
const bookGeo = new THREE.BoxGeometry(0.16, 0.045, 0.22), bookMat = new THREE.MeshStandardMaterial({ color: 0x4a1f17, roughness: 0.8 });
function throwBook() {
  if (player.mode !== 'free' || G.bookT > 0) { if (G.bookT > 0) say('You need a moment to find another book.', 1.6); return; }
  G.bookT = 7; camera.getWorldDirection(_a);
  const m = new THREE.Mesh(bookGeo, bookMat); m.castShadow = true; m.position.copy(camera.position).addScaledVector(_a, 0.4); m.position.y -= 0.15; scene.add(m);
  G.books.push({ m, v: new THREE.Vector3(_a.x * 9.5, _a.y * 9.5 + 2.6, _a.z * 9.5), live: true, t: 0 }); audio.whoosh(0);
  if (!G.bookTold) { G.bookTold = true; say('A thrown book makes a noise somewhere else. They will go and look.', 4.5); }
}
function updateBooks(dt) {
  G.bookT = Math.max(0, G.bookT - dt);
  for (const b of G.books) {
    b.t += dt; if (!b.live) { if (b.t > 40) { scene.remove(b.m); b.dead = true; } continue; }
    b.v.y -= 16 * dt; b.m.position.addScaledVector(b.v, dt); b.m.rotation.x += dt * 9; b.m.rotation.z += dt * 6;
    const p = b.m.position, wall = !nav.free(p.x, p.z) && p.y < 2.4;
    if (p.y <= 0.03 || wall || b.t > 4) {
      if (wall) p.addScaledVector(b.v, -dt); p.y = Math.max(0.03, wall ? p.y : 0.03); b.live = false; b.t = 0; b.m.rotation.set(0, Math.random() * 6, wall ? 0.4 : 0);
      audio.slam(panTo(p.x, p.z), Math.max(0.3, 1 - p.distanceTo(player.pos) / 22));
      for (const g of ghosts) if (g.active && !g.hunting && g.kind !== 'wraith' && g.kind !== 'shadow' && g.state !== 'dazed' && g.pos.distanceTo(p) < 17) g.investigate(p.x, p.z, false);
    }
  }
  G.books = G.books.filter((b) => !b.dead);
}

// ---------------------------------------------------------------------------- storm, radio, staring
const anyHunting = () => ghosts.some((g) => g.hunting);
function lightning(amp = 1, thunderDelay = 0.3 + Math.random() * 1.3) { G.flashT = G.flashDur = 0.75; G.flashAmp = amp; audio.thunder(0.5 + amp * 0.5, thunderDelay); }
function updateStorm(dt) {
  G.stormT -= dt;
  if (G.stormT <= 0) { G.stormT = 22 + Math.random() * 40; lightning(0.5 + Math.random() * 0.5); }
  let f = 0;
  if (G.flashT > 0) {
    G.flashT -= dt; const u = 1 - G.flashT / G.flashDur;
    f = G.flashAmp * (u < 0.1 ? 1 : u < 0.2 ? 0.12 : u < 0.36 ? 0.85 : u < 0.5 ? 0.08 : Math.max(0, 1 - u) * 1.1);
  }
  world.moon.intensity = 1.5 * (1 + 7 * f); if (world.glass) world.glass.emissiveIntensity = 1.15 * (1 + 4 * f);
  if (hemi) hemi.intensity = 0.24 * (1 + 7 * f); world.shaftMat.uniforms.uOpacity.value = 0.02 * (1 + 3 * f);
}

function speak(text) {   // a low synthetic whisper through the radio, where the browser offers one
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.rate = 0.62; u.pitch = 0.15; u.volume = Math.min(1, +ui.vol.value * 0.75);
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* no voice available */ }
}
function toggleRadio() {
  player.radio = !player.radio; audio.setRadio(player.radio); ui.radioBox.classList.toggle('on', player.radio);
  ui.radioMsg.textContent = player.radio ? '…tuning…' : ''; G.radioT = 6 + Math.random() * 5;
  if (player.radio && !G.radioTold) { G.radioTold = true; say('The radio picks up… something. Static means it is close. They can hear it too.', 5); }
}
function updateRadio(dt) {
  if (!player.radio) return;
  G.radioT -= dt;
  if (G.radioT > 0) return;
  G.radioT = 16 + Math.random() * 14;
  const near = ghosts.filter((g) => g.active).sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos))[0];
  const key = world.items.filter((i) => i.type === 'key').sort((a, b) => a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos))[0];
  const opts = [];
  if (key) { const ns = key.pos.z < -7 ? 'north end, by the window' : key.pos.z > 7 ? 'south end, by the doors' : 'middle of the hall'; const ew = key.pos.x < -4.5 ? 'west' : key.pos.x > 4.5 ? 'east' : 'centre'; opts.push([`…kssh… a key… ${ew} side… ${ns}…`, `a key. ${ew} side. ${ns}.`], [`…it is ${key.hint}… kssh…`, `it is ${key.hint}`]); }
  if (near) {
    const d = near.pos.distanceTo(player.pos), side = panTo(near.pos.x, near.pos.z);
    const where = d < 6 ? 'right beside you' : side < -0.4 ? 'to your left' : side > 0.4 ? 'to your right' : 'close';
    opts.push([`…${near.kind === 'wraith' ? 'above' : near.kind === 'crawler' ? 'on the floor' : near.kind === 'nun' ? 'weeping' : near.kind === 'skeleton' ? 'bones' : near.kind === 'child' ? 'small. laughing' : near.kind === 'shadow' ? 'do not look away' : 'walking'}… ${where}… ${d.toFixed(0)} metres…`, where], ['…look it in the eyes… it cannot bear to be seen…', 'look it in the eyes'], ['…we were readers too… kssh… do not run…', 'we were readers too']);
  } else opts.push(['…is someone there?… kssh… put the key back…', 'is someone there'], ['…he is still reading… do not wake him…', 'do not wake him']);
  const [txt, voice] = opts[(Math.random() * opts.length) | 0];
  ui.radioMsg.textContent = txt; audio.radioVoice(); speak(voice);
}

function updateStare(dt) {
  camera.getWorldDirection(_a);
  let any = false, close = null;
  const can = player.mode === 'free' && !G.nerveBroken;
  for (const g of ghosts) {
    g.stared = false; g.dazeImmune = Math.max(0, (g.dazeImmune || 0) - dt);
    // a stare only stops a ghost that is already coming for you, and the same ghost will not fall for it twice in a row
    if (!g.active || !can || g.state === 'dazed' || g.dazeImmune > 0 || !(g.hunting || g.kind === 'shadow')) continue;
    g.headPos(_b); _c.copy(_b).sub(camera.position); const d = _c.length();
    if (d > (g.kind === 'shadow' ? 26 : 7) || _c.dot(_a) / d < 0.972) continue;
    if (g.kind !== 'wraith' && !nav.los(player.pos.x, player.pos.z, g.pos.x, g.pos.z)) continue;
    g.stared = true; any = true; close = g;
  }
  G.staring = any;
  player.nerve = Math.max(0, Math.min(1, player.nerve + (any ? -dt / 6.5 : dt / 15)));
  if (player.nerve <= 0 && !G.nerveBroken) { G.nerveBroken = true; say('You cannot bear to look any longer.', 2.5); }
  if (G.nerveBroken && player.nerve > 0.4) G.nerveBroken = false;
  if (any && !G.staredHint && close.daze > 0.25) { G.staredHint = true; say('Hold its gaze…', 2); }
  ui.nerve.classList.toggle('show', any || player.nerve < 0.98); ui.nerve.classList.toggle('broken', G.nerveBroken); ui.nerve.classList.toggle('active', any);
  ui.nerveFill.style.width = (player.nerve * 100).toFixed(0) + '%';
}

// ---------------------------------------------------------------------------- the haunting (escalating, non-lethal scares)
function endEvent(vanishSound = true) {
  if (!G.ev) return;
  if (vanishSound && hollow.mode !== 'off') audio.whisper(panTo(hollow.pos.x, hollow.pos.z), 0.6);
  hollow.hide(); G.ev = null;
}
function lookingAt(p, cone) { camera.getWorldDirection(_a); _b.copy(p).sub(camera.position).normalize(); return _a.dot(_b) > cone; }
function tier() { return Math.min(3, player.keysHeld + Math.floor(G.time / 110)); }
const POOLS = [
  ['slam', 'bats', 'lightning', 'watcher', 'poster', 'shriek', 'sob', 'giggle', 'hanged', 'aisle', 'shout'],
  ['slam', 'bats', 'silhouette', 'watcher', 'poster', 'aisle', 'dash', 'blowout', 'shriek', 'hanged', 'giggle', 'sob', 'shout', 'lunge'],
  ['bats', 'silhouette', 'poster', 'aisle', 'dash', 'blowout', 'behind', 'radar', 'aisle', 'shriek', 'hanged', 'sob', 'face', 'lunge'],
  ['bats', 'silhouette', 'poster', 'aisle', 'dash', 'blowout', 'behind', 'behind', 'radar', 'face', 'shriek', 'hanged', 'giggle', 'lunge', 'lunge'],
];

function startScare(force) {
  const p = player.pos, fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const opts = POOLS[tier()].filter((k) => k !== G.lastScare && (k !== 'dash' || (Math.abs(p.x) < 3.2 && Math.abs(fz) > 0.75 && Math.abs(p.z + Math.sign(fz) * 5.5) < 18)));
  const kind = force || opts[(Math.random() * opts.length) | 0];
  G.lastScare = kind;
  const ahead = (minD, maxD, needLos = true) => {
    for (let k = 0; k < 30; k++) {
      const q = nav.randomPoint(p, minD, maxD);
      if ((q.x - p.x) * fx + (q.z - p.z) * fz < minD * 0.5) continue;
      if (needLos && !nav.walkLos(p.x, p.z, q.x, q.z)) continue;
      if (ghosts.some((g) => g.active && Math.hypot(q.x - g.pos.x, q.z - g.pos.z) < 5)) continue;
      return q;
    }
    return null;
  };
  switch (kind) {
    case 'watcher': {      // a figure at the gallery rail, looking down
      const spots = level.gallery.map((g) => g.pos).filter((g) => { const d = Math.hypot(g[0] - p.x, g[2] - p.z); return d > 6 && d < 22 && (g[0] - p.x) * fx + (g[2] - p.z) * fz > 0; });
      if (!spots.length) return false;
      const g = spots[(Math.random() * spots.length) | 0];
      hollow.show(g[0], g[1], g[2], 'watcher'); hollow.play('sad_pose', 0); hollow.face(p.x, p.z, null);
      G.ev = { kind, t: 0, seen: 0 };
      return true;
    }
    case 'aisle': {        // something standing very still at the edge of the light
      const q = ahead(6.5, 11); if (!q) return false;
      hollow.show(q.x, 0, q.z, 'aisle'); hollow.play('sneak_pose', 0); hollow.face(p.x, p.z, null);
      G.ev = { kind, t: 0, seen: 0, lunge: -1 };
      return true;
    }
    case 'silhouette': case 'lightning': {   // lightning — and for the length of the flash, someone is standing there
      lightning(1, 0.25);
      if (kind === 'lightning') return true;
      const q = ahead(5, 10); if (!q) return true;
      hollow.show(q.x, 0, q.z, 'silhouette'); hollow.play('idle', 0); hollow.face(p.x, p.z, null);
      G.ev = { kind: 'silhouette', t: 0 }; G.scares++;
      return true;
    }
    case 'behind': {       // it is standing right behind you. It waits for you to turn around.
      const bx = p.x - fx * 1.7, bz = p.z - fz * 1.7;
      if (!nav.free(bx, bz) || !nav.walkLos(p.x, p.z, bx, bz)) return false;
      hollow.show(bx, 0, bz, 'behind'); hollow.play('sad_pose', 0); hollow.face(p.x, p.z, null);
      audio.whisper(0, 1.2); audio.breath(0.9);
      G.ev = { kind, t: 0 };
      return true;
    }
    case 'dash': {         // a shape sprints across the nave just ahead
      const z = p.z + Math.sign(fz) * 5.5, side = Math.random() < 0.5 ? -1 : 1;
      hollow.show(-side * 4.6, 0, z, 'dash'); hollow.play('run', 0, 1.5); hollow.face(side * 5, z, null);
      audio.whoosh(-side * 0.8); G.ev = { kind, t: 0, side, z }; G.scares++;
      return true;
    }
    case 'bats': {         // a colony bursts out of the dark straight at your face
      const eye = camera.position;
      _a.set(p.x + fx * 10, 4.6, p.z + fz * 10); _b.set(eye.x + fx * 0.5, eye.y + 0.1, eye.z + fz * 0.5); _c.set(p.x - fx * 9 + fz * 3, 5.5, p.z - fz * 9 - fx * 3);
      bats.burst(_a, _b, _c, 40, 0.75, 9.5); audio.bats(1, 0);
      setTimeout(() => { if (state === 'playing') { player.shake = Math.max(player.shake, 0.55); player.flick = 0.15; G.fear = Math.max(G.fear, 0.75); } }, 800);
      G.scares++; return true;
    }
    case 'poster': {       // the writing on the wall changes when you are not looking
      const lines = ['BEHIND\nYOU', 'WE SEE\nYOU', 'RUN', 'DONT\nTURN\nAROUND', 'YOU ARE\nOVERDUE', 'IT KNOWS\nYOUR NAME'];
      const po = posters.rewrite(lines[(Math.random() * lines.length) | 0], camera, p);
      if (!po) return false;
      audio.paper(); audio.whisper(panTo(po.pos.x, po.pos.z), 0.9); return true;
    }
    case 'radar': {        // the radar fills with contacts, all of them on top of you
      if (!radar.on) return false;
      radar.glitch = 2.6; for (let i = 0; i < 7; i++) setTimeout(() => state === 'playing' && audio.ping(1), i * 150);
      G.fear = Math.max(G.fear, 0.7); G.scares++; return true;
    }
    case 'hanged': {       // a body drops out of the dark on a rope, right in front of you
      let q = null;
      for (const d of [2.4, 1.9, 3.0]) { const x = p.x + fx * d, z = p.z + fz * d; if (nav.free(x, z) && nav.walkLos(p.x, p.z, x, z)) { q = { x, z }; break; } }
      if (!q) return false;
      hanged.drop(q.x, q.z, Math.atan2(p.x - q.x, p.z - q.z));
      audio.rope(1); audio.sting(0.8); setTimeout(() => { if (state === 'playing') { audio.moan(0.9, 0); audio.gasp(0.8); } }, 500); G.emfSpike = 2;
      player.shake = Math.max(player.shake, 0.75); G.fear = 1; G.scares++; flash(0.3, 180);
      return true;
    }
    case 'shriek': {       // a woman screams, right at your shoulder
      const pan = Math.random() < 0.5 ? -0.85 : 0.85;
      audio.shriek(1, pan); player.shake = Math.max(player.shake, 0.6); player.flick = 0.1; G.fear = Math.max(G.fear, 0.9); G.scares++;
      return true;
    }
    case 'sob': {          // someone is crying very close by. There is nobody there.
      const pan = Math.random() * 1.6 - 0.8;
      audio.cry(1.5, pan); setTimeout(() => state === 'playing' && audio.whisper(-pan, 1), 2600); G.fear = Math.max(G.fear, 0.5);
      return true;
    }
    case 'giggle': {       // a child laughs and runs past in the dark
      const pan = Math.random() < 0.5 ? -1 : 1;
      audio.giggle(1.3, pan); for (let i = 0; i < 7; i++) setTimeout(() => state === 'playing' && audio.ghostStep(0.9 - i * 0.1, pan * (1 - i * 0.3)), 500 + i * 140);
      G.fear = Math.max(G.fear, 0.55); return true;
    }
    case 'shout': {        // a man shouts from the far end of the hall — and is cut off
      const pan = Math.random() * 2 - 1;
      audio.shout(1, pan); G.fear = Math.max(G.fear, 0.5);
      for (const g of [nun, skeleton, archivist]) if (g.active && !g.hunting && Math.random() < 0.3) g.investigate(p.x + pan * 8, p.z);
      return true;
    }
    case 'lunge': {        // it is suddenly IN your face, screaming — and then it is gone
      ui.scare.classList.remove('peek'); ui.scare.classList.add('on'); audio.sting(1); audio.shriek(1, 0); flash(0.6, 200);
      player.shake = Math.max(player.shake, 0.9); G.fear = 1; G.hurt = 0.5; G.scares++; G.emfSpike = 2;
      setTimeout(() => { if (state === 'playing') { ui.scare.classList.remove('on'); audio.gasp(0.9); } }, 620);
      return true;
    }
    case 'face': {         // a face, for a single frame
      player.flick = 0.02; G.peekT = 0.12; return true;
    }
    case 'blowout': {
      if (!world.blowOut(p, 8)) return false;
      audio.blowOut(); player.flick = 0.05; G.fear = Math.max(G.fear, 0.6);
      setTimeout(() => state === 'playing' && audio.whisper(Math.random() * 2 - 1, 1), 700);
      return true;
    }
    default: {             // books thrown from a shelf somewhere behind
      const pan = -Math.sign(Math.random() - 0.5) * 0.9;
      audio.slam(pan, 0.9); player.shake = Math.max(player.shake, 0.35); G.fear = Math.max(G.fear, 0.55);
      for (const g of [archivist, crawler]) if (g.active && !g.hunting && Math.random() < 0.4) g.investigate(p.x, p.z);
      return true;
    }
  }
}

function updateHaunting(dt) {
  const ev = G.ev, p = player.pos;
  if (!ev) {
    if (anyHunting() || player.mode !== 'free') return;
    G.scareT -= dt;
    if (G.scareT <= 0) {
      if (!startScare()) G.scareT = 3;
      else { const t = tier(); G.scareT = (Math.random() < 0.18 ? 4 : 11 - t * 2) + Math.random() * (30 - t * 5); if (G.ev) hollow.setOpacity(0); }   // irregular on purpose: sometimes two come back to back
    }
    return;
  }
  ev.t += dt;
  const d = Math.hypot(hollow.pos.x - p.x, hollow.pos.z - p.z);
  _c.copy(hollow.pos); _c.y += 1.4;
  let alpha = Math.min(1, ev.t * 1.5);
  if (ev.kind === 'watcher') {
    hollow.face(p.x, p.z, dt, 2);
    if (lookingAt(_c, 0.95)) ev.seen += dt;
    if (ev.seen > 0.9 || ev.t > 30 || d < 4.5) { if (ev.seen > 0.2) { player.flick = 0.1; G.fear = Math.max(G.fear, 0.5); G.scares++; } endEvent(); return; }
    alpha *= 0.85;
  } else if (ev.kind === 'silhouette') {
    alpha = G.flashT > 0 ? 1 : 0;
    if (ev.t > 0.2 && G.flashT <= 0) { endEvent(false); return; }
  } else if (ev.kind === 'behind') {
    alpha = 1;
    if (lookingAt(_c, 0.45)) {            // you turned around
      G.ev = { kind: 'aisle', t: 1, seen: 1, lunge: 0 }; audio.sting(0.95); audio.growl(0.8, 0); hollow.play('run', 0.05, 1.8);
      player.shake = Math.max(player.shake, 0.8); G.fear = 1; G.scares++; flash(0.35, 220);
    } else if (d > 6.5 || ev.t > 16) { endEvent(false); return; }
  } else if (ev.kind === 'aisle') {
    if (ev.lunge < 0) {
      hollow.face(p.x, p.z, dt, 3);
      if (lookingAt(_c, 0.9) && player.lightOn && nav.los(p.x, p.z, hollow.pos.x, hollow.pos.z)) ev.seen += dt;
      if (ev.seen > 0.35 || d < 3.4) {       // it has been noticed: it comes
        ev.lunge = 0; audio.sting(0.75); hollow.play('run', 0.05, 1.8); player.shake = Math.max(player.shake, 0.6); G.fear = 1; G.scares++;
      } else if (ev.t > 35 || anyHunting()) { endEvent(false); return; }
    } else {
      ev.lunge += dt;
      const k = Math.min(d - 0.7, 13 * dt);
      if (d > 0.01) { hollow.pos.x += (p.x - hollow.pos.x) / d * k; hollow.pos.z += (p.z - hollow.pos.z) / d * k; }
      hollow.face(p.x, p.z, null);
      if (d < 1.1 || ev.lunge > 1.1) { player.flick = 0.02; flash(0.25, 300); audio.whoosh(0); G.hurt = 0.6; endEvent(false); return; }
    }
  } else if (ev.kind === 'dash') {
    hollow.pos.x += ev.side * 8.2 * dt;
    alpha = Math.min(1, ev.t * 6) * (1 - Math.max(0, (ev.t - 0.85) * 4));
    if (ev.t > 0.3 && !ev.hit && lookingAt(_c, 0.7)) { ev.hit = true; G.fear = Math.max(G.fear, 0.8); player.shake = Math.max(player.shake, 0.3); player.flick = 0.2; }
    if (ev.t > 1.12) { endEvent(false); return; }
  }
  hollow.setOpacity(alpha * (0.85 + 0.15 * Math.sin(G.time * 37)));
  hollow.tick(dt, G.time);
}

// ---------------------------------------------------------------------------- death / victory
function die(killer = archivist) {
  state = 'dying'; G.dieT = 0; G.killer = killer; player.dead = true; player.keys = {};
  endEvent(false); closeNote();
  // put it right in the player's face
  const f = player.hide ? player.hide.front : null;
  let ax, az;
  if (f) { ax = f.x; az = f.z; player.hide.target = 1.35; }
  else {
    const dx = killer.pos.x - player.pos.x, dz = killer.pos.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
    ax = player.pos.x + dx / d * 0.85; az = player.pos.z + dz / d * 0.85;
  }
  killer.pos.x = ax; killer.pos.z = az; killer.face(player.pos.x, player.pos.z, null);
  if (killer.kind === 'wraith') { killer.pos.y = player.eye - 1.66; killer.vel.set(0, 0, 0); }
  else if (killer.kind === 'crawler') { killer.inner.rotation.x = 0.35; killer.inner.position.set(0, 0.25, -0.15); }   // it rears up off the floor
  else killer.play('headShake', 0.05, 2.4);
  hanged.hide(); gear.update(0.5, { visible: false, emfOn: false, radioOn: false, level: 0, staticLevel: 0, speed: 0, word: '' }); gear.update(0.5, { visible: false, emfOn: false, radioOn: false, level: 0, staticLevel: 0, speed: 0, word: '' });
  killer.setOpacity(1); killer.light.intensity = 5;
  player.lookLock = new THREE.Vector3(); player.shake = 1.2; player.fovKick = -16; player.mode = player.mode === 'free' ? 'caught' : player.mode;
  ui.hideMask.classList.remove('on'); ui.hideHint.classList.add('hidden'); ui.prompt.classList.remove('show'); ui.nerve.classList.remove('show');
  audio.scream(1); if (killer.kind === 'crawler') audio.growl(1, 0); if (killer.kind === 'nun') audio.shriek(1, 0); if (killer.kind === 'skeleton') for (let i = 0; i < 10; i++) setTimeout(() => audio.rattle(1, 0), i * 80); flash(0.9, 260);
}
function updateDying(dt) {
  const k = G.killer || archivist;
  G.dieT += dt; G.time += dt;
  k.headPos(player.lookLock);
  if (k.kind === 'crawler') { k.crawl(dt, true, 4, G.time); k.inner.position.set(0, 0.25, -0.15); k.tick(dt, G.time); } else k.present(dt, G.time, 1);
  player.shake = Math.max(player.shake, 0.7);
  player.update(dt, 1); world.update(dt, camera, player.torchState); bats.update(dt, G.time);
  player.torch.intensity = 45 * (Math.random() < 0.25 ? 0.15 : 1);          // stuttering light full on its face
  G.fear = 1; G.hurt = Math.min(1, G.dieT * 2);
  if (G.dieT > 0.55 && !G.scared) { G.scared = true; ui.scare.classList.remove('peek'); ui.scare.classList.add('on'); flash(0.7, 200); }
  if (G.dieT > 1.8 && state === 'dying') {
    state = 'dead'; ui.fade.classList.add('on');
    ui.scare.classList.remove('on'); ui.hud.classList.add('hidden');
    const lines = {
      archivist: ['The Archivist adds another volume to his collection.', 'You are catalogued. You are shelved. You are quiet now.', 'Overdue. Forever.', 'He closes the book. You are inside it.'],
      crawler: ['It drags you under the tables. There is room for one more.', 'You never heard it until its fingers closed around your ankle.'],
      child: ['She only wanted someone to play with. Now she has you, for ever.', 'Ring a ring o\' roses. You all fall down.'],
      shadow: ['You looked away.', 'It was never across the room. It was waiting for you to blink.'],
      nun: ['She was not weeping for herself. She was weeping for you.', 'Sister Agnes folds your hands for you. She has had practice.', 'You hear her crying again. From inside your own chest.'],
      skeleton: ['He only wanted his skin back. Yours fits well enough.', 'The bones are quiet now. There are more of them than before.'],
      wraith: ['The light went out. Then it was wearing your face.', 'You should not have looked up.'],
    }[k.kind];
    ui.deadText.textContent = `${lines[(Math.random() * lines.length) | 0]}  —  ${player.keysHeld} of 3 keys found.`;
    ui.dead.classList.remove('hidden'); audio.setRadio(false);
    try { speechSynthesis?.cancel(); } catch { /* */ }
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
function win() {
  state = 'won'; ui.fade.classList.add('white', 'on'); audio.setRadio(false); audio.win(); audio.update(0.016, { ghostDist: 99, ghostActive: false, chase: false, ghostPan: 0, fear: 0, ambient: false });
  const m = Math.floor(G.time / 60), s = Math.floor(G.time % 60);
  ui.wonText.textContent = `You ran out into the rain after ${m}:${String(s).padStart(2, '0')}. You hid ${G.hides} time${G.hides === 1 ? '' : 's'}, stared down the dead ${G.stares} time${G.stares === 1 ? '' : 's'}, and the library found ${G.scares} other way${G.scares === 1 ? '' : 's'} to look at you. Behind you, the doors swing shut on their own.`;
  setTimeout(() => { if (state !== 'won') return; ui.hud.classList.add('hidden'); ui.won.classList.remove('hidden'); if (document.pointerLockElement) document.exitPointerLock(); }, 1800);
}

// ---------------------------------------------------------------------------- per-frame
function updatePlaying(dt) {
  G.time += dt; G.huntCool = Math.max(0, G.huntCool - dt);
  // awakening, a beat after the first key is lifted
  if (G.awakeT > 0) {
    G.awakeT -= dt;
    if (G.awakeT <= 0) {
      G.awake = true; G.awakeAt = G.time;
      const far = [level.ghostSpawn, [0, 0, -13]].sort((a, b) => Math.hypot(b[0] - player.pos.x, b[2] - player.pos.z) - Math.hypot(a[0] - player.pos.x, a[2] - player.pos.z))[0];
      archivist.spawn({ x: far[0], z: far[2] }); archivist.anger = player.keysHeld;
      world.blowOut(player.pos, 9); audio.blowOut(); audio.sting(0.55); player.flick = 0.05; player.shake = Math.max(player.shake, 0.45); lightning(1, 0.4);
      say('Something has noticed you.', 4);
      setTimeout(() => state === 'playing' && say('Hide in the cabinets (E), kill your torch (F) — or, when it is almost on you, look it dead in the eyes.', 6.5), 4600);
    }
  }
  if (G.introT > 0) { G.introT -= dt; if (G.introT <= 0) say('You are not alone. Someone is weeping in the dark — and something dry is walking.', 5.5); }
  // the sister weeps as she wanders; follow the sound, or stay away from it
  G.cryT -= dt;
  if (G.cryT <= 0 && nun.active) {
    G.cryT = 5 + Math.random() * 7;
    if (child.active && !child.hunting && Math.random() < 0.45) { const d = child.pos.distanceTo(player.pos), v = Math.max(0, 1 - d / 22), pan = panTo(child.pos.x, child.pos.z); if (Math.random() < 0.3) audio.hymn(v * 1.2, pan); else audio.giggle(v * 1.3 + 0.03, pan); }
    if (!nun.hunting && nun.state !== 'dazed') { const d = nun.pos.distanceTo(player.pos), v = Math.max(0, 1 - d / 26), pan = panTo(nun.pos.x, nun.pos.z); if (Math.random() < 0.2) audio.hymn(v * 1.4, pan); else audio.cry(v * v * 1.6 + 0.04, pan); }
  }
  hanged.update(dt, G.time);
  // the others arrive as the night goes on
  if (G.awake) {
    const el = G.time - G.awakeAt;
    if (!wraith.active && (player.keysHeld >= 2 || el > 110)) {
      wraith.spawn({ x: (Math.random() - 0.5) * 10, z: player.pos.z > 0 ? -14 : 14 }); lightning(1, 0.3); audio.wail(0.9, 0);
      say('Something is circling above the shelves. It follows the light.', 5.5);
    }
    if (!child.active && ((player.keysHeld >= 1 && el > 45) || player.keysHeld >= 2 || el > 150)) {
      child.spawn(nav.randomPoint(player.pos, 16, 28)); audio.giggle(1, 0);
      say('A child is laughing somewhere among the shelves. There are no children here.', 5.5);
    }
    if (!shadow.active && (player.keysHeld >= 3 || el > 280)) {
      shadow.spawn(nav.randomPoint(player.pos, 14, 24)); shadow.cool = 6;
      say('A shadow is standing where there was none. It only moves when you look away.', 6.5);
    }
    if (!crawler.active && (player.keysHeld >= 3 || el > 220)) {
      crawler.spawn(nav.randomPoint(player.pos, 13, 24)); crawler.anger = player.keysHeld; audio.growl(0.8, 0);
      say('Scratching. Low. Something is crawling under the tables.', 5.5);
    }
  }
  // the exit
  if (G.exit === 'opening') {
    G.exitT += dt;
    if (G.exitT > 1.7) { G.exit = 'open'; world.exitTarget = 1.75; world.exitCollider.on = false; audio.creak(2.6, 0, 1); audio.slam(0, 0.5); say('RUN.', 2.5); objective('<b>Get out.</b>'); lightning(1, 0.2); G.huntCool = 0; archivist.cool = 0; if (!anyHunting()) archivist.startChase(player); }
  }
  if (G.exit === 'open' && player.pos.z > level.exit.win[2]) { win(); return; }
  if (G.tipT > 0) { G.tipT -= dt; if (G.tipT <= 0) say('T — EMF meter  ·  R — radio  ·  Q — radar  ·  M — microphone  ·  G — throw a book', 7); }

  // nearest threat
  let near = null, ad = 99;
  for (const g of ghosts) if (g.active) { const d = g.pos.distanceTo(_a.set(player.pos.x, g.kind === 'wraith' ? 1.2 : 0, player.pos.z)); if (d < ad) { ad = d; near = g; } }
  const hunting = anyHunting();
  // fear: proximity, pursuit, being stared at through the cabinet slats
  let fearT = near ? Math.max(0, 1 - ad / 13) * 0.75 : 0;
  if (hunting) fearT = Math.max(fearT, 0.7 + Math.max(0, 1 - ad / 8) * 0.3);
  if (archivist.state === 'stare' || crawler.state === 'stare') fearT = Math.max(fearT, 0.9);
  if (!player.lightOn && player.mode === 'free') fearT = Math.max(fearT, 0.2);
  if (G.staring) fearT = Math.max(fearT, 0.8);
  G.fear += (fearT - G.fear) * (1 - Math.exp(-dt * (fearT > G.fear ? 3 : 0.5)));
  G.hurt = Math.max(0, G.hurt - dt * 1.5);

  if (!G.noteOpen) player.update(dt, G.fear); else { const k = player.keys; player.keys = {}; player.update(dt, G.fear); player.keys = k; }
  if (player.radio && player.mode === 'free') player.noise = Math.max(player.noise, 7);
  camera.updateMatrixWorld();
  updateStare(dt); updateMic(dt); updateBooks(dt);
  if (shadow.active) { shadow.headPos(_b); _c.copy(_b).sub(camera.position); const sd = _c.length(); camera.getWorldDirection(_a); shadow.watched = sd < 26 && _c.dot(_a) / sd > 0.78 && nav.los(player.pos.x, player.pos.z, shadow.pos.x, shadow.pos.z) && (player.lightOn || sd < 5); }
  for (const g of ghosts) { if (g.update(dt, player, world, G.time) === 'caught') { die(g); return; } }
  updateHaunting(dt);
  updateStorm(dt); updateRadio(dt);
  world.update(dt, camera, player.torchState);
  bats.update(dt, G.time);

  // a face in the dark
  if (G.peekT > 0) {
    G.peekT -= dt;
    if (G.peekT <= 0) { ui.scare.classList.add('peek'); audio.sting(0.45); player.shake = Math.max(player.shake, 0.5); G.fear = 1; G.scares++; setTimeout(() => ui.scare.classList.remove('peek'), 170); }
  }

  updateGear(dt, near ? ad : 99);
  const prox = near ? Math.max(0, 1 - ad / 14) : 0;
  audio.update(dt, { ghostDist: ad, ghostActive: !!near, chase: hunting, ghostPan: near ? panTo(near.pos.x, near.pos.z) : 0, fear: G.fear, ambient: !hunting,
    tension: Math.max(G.fear, tier() * 0.14), staticLevel: prox, winded: player.exhausted ? 0.9 : player.stamina < 0.4 ? 0.6 : 0 });

  // ---- radar
  const contacts = ghosts.filter((g) => g.active).map((g) => ({ x: g.pos.x, z: g.pos.z, kind: g.kind }));
  if (G.ev && hollow.mode !== 'off' && G.ev.kind !== 'watcher') contacts.push({ x: hollow.pos.x, z: hollow.pos.z, kind: 'archivist' });
  let kd = 1e9, key = null; for (const it of world.items) if (it.type === 'key') { const d = it.pos.distanceTo(player.pos); if (d < kd) { kd = d; key = it; } }
  if (key) contacts.push({ x: key.pos.x, z: key.pos.z, key: true });
  const ping = radar.update(dt, player.pos.x, player.pos.z, player.yaw, contacts, Math.max(0, 1 - ad / 8));
  G.pingT -= dt; if (ping > 0 && radar.on && G.pingT <= 0) { audio.ping(ping); G.pingT = 0.25; }

  // ---- HUD
  G.target = G.noteOpen ? null : findTarget();
  ui.prompt.textContent = G.target ? G.target.label : ''; ui.prompt.classList.toggle('show', !!G.target && player.mode === 'free');
  ui.crosshair.classList.toggle('active', !!G.target && player.mode === 'free');
  ui.crosshair.style.opacity = player.mode === 'free' ? 1 : 0;
  ui.batteryFill.style.width = player.battery.toFixed(1) + '%'; ui.battery.classList.toggle('low', player.battery < 20);
  if (player.battery < 20 && !G.batteriesWarned) { G.batteriesWarned = true; say('The torch is fading. Look for batteries.', 3.5); }
  if (player.battery > 30) G.batteriesWarned = false;
  ui.staminaFill.style.width = (player.stamina * 100).toFixed(0) + '%'; ui.stamina.classList.toggle('show', player.stamina < 0.98);
  const hid = player.mode === 'hidden';
  ui.hideMask.classList.toggle('on', hid || (player.mode === 'entering' && player.hideT > 0.6)); ui.hideHint.classList.toggle('hidden', !hid);
  if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) ui.message.classList.remove('show'); }
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (!world) return;
  if (state === 'playing') updatePlaying(dt);
  else if (state === 'dying') updateDying(dt);
  else if (state === 'trailer') updateTrailer(dt);
  else if (state === 'won') { world.update(dt, camera, player.torchState); }
  else if (state === 'paused') return;
  grade.uniforms.uTime.value = performance.now() / 1000 % 100;
  grade.uniforms.uFear.value = G ? G.fear : 0; grade.uniforms.uHurt.value = G ? G.hurt : 0;
  updateGlows(); guardFps();
  composer.render(dt);
}
frame();

if (import.meta.env.DEV) window.__ha = { startTrailer, updateTrailer, get trailer() { return trailer; }, get s() { return { state, G, world, nav, player, archivist, crawler, wraith, nun, skeleton, child, shadow, gear, mic, hanged, ghosts, hollow, level, camera, renderer, bats, posters, radar }; }, die, interact, startScare, updatePlaying, updateDying, findTarget, lightning, toggleRadio };
