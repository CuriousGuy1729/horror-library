// The Hollow Archive — cinematic trailer.
// Open the game with ?trailer in the address bar. Everything is rendered live by the game engine: scripted camera moves,
// the ghosts posed and animated directly (their AI is not running), captions, and the game's own synthesised audio.
import * as THREE from 'three';

const CSS = `
#trl { position: fixed; inset: 0; z-index: 60; pointer-events: none; font-family: 'Cormorant Garamond', Georgia, 'Times New Roman', serif; color: #e9e2d2; }
#trl .bar { position: fixed; left: 0; right: 0; height: calc(11vh + 4px); background: #000; }
#trl .bar.t { top: -4px; } #trl .bar.b { bottom: -4px; }
#trlCap { position: absolute; left: 0; right: 0; bottom: 15vh; text-align: center; font-size: clamp(16px, 2.3vw, 36px); letter-spacing: .14em; padding: 0 6vw; text-transform: uppercase;
  text-shadow: 0 0 18px #000, 0 2px 4px #000; opacity: 0; transition: opacity .7s ease; }
#trlCap.on { opacity: 1; }
#trlCard { position: absolute; inset: 0; background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; opacity: 0; transition: opacity .8s ease; }
#trlCard.on { opacity: 1; } #trlCard.cut { transition: none; }
#trlCard h2 { margin: 0; font-weight: 500; font-size: clamp(22px, 3.2vw, 46px); letter-spacing: .16em; text-transform: uppercase; max-width: 80vw; line-height: 1.5; }
#trlCard h1 { margin: 0; font-weight: 600; font-size: clamp(44px, 9vw, 150px); letter-spacing: .12em; line-height: 1.02; color: #f3ecdc; text-shadow: 0 0 60px rgba(160, 30, 20, .55); }
#trlCard p { margin: 2.2vh 0 0; font-size: clamp(14px, 1.6vw, 24px); letter-spacing: .3em; text-transform: uppercase; color: #a39a86; }
#trlCard .red { color: #b3261c; }
#trlRec { position: fixed; top: 12px; right: 14px; z-index: 70; font: 12px system-ui, sans-serif; color: #ff6b5e; letter-spacing: .1em; display: none; }
#trlMenu { margin-top: 18px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
#trlNote { margin-top: 14px; font-size: 13px; color: #a39a86; max-width: 520px; margin-left: auto; margin-right: auto; line-height: 1.5; }
`;

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => k * k * (3 - 2 * k);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * @param g  everything the trailer needs from the game: { camera, audio, world, player, ghosts: { archivist, crawler, wraith, nun, skeleton },
 *           hanged, bats, level, lightning(amp, delay), flash(strength, ms), scareEl, grade, setFear(f) }
 */
export function createTrailer(g) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'trl'; root.style.display = 'none';
  root.innerHTML = '<div class="bar t"></div><div class="bar b"></div><div id="trlCap"></div><div id="trlCard"></div>';
  document.body.appendChild(root);
  const rec = document.createElement('div'); rec.id = 'trlRec'; rec.textContent = '● REC'; document.body.appendChild(rec);
  const cap = root.querySelector('#trlCap'), card = root.querySelector('#trlCard');

  const { camera, audio, world, player, hanged, bats } = g;
  const { archivist, crawler, wraith, nun, skeleton } = g.ghosts;
  const all = [archivist, crawler, wraith, nun, skeleton];
  const look = V(0, 0, 0), tmp = V(0, 0, 0);
  let t = 0, shotI = -1, shotT = 0, fired = null, running = false, onEnd = null, torchPow = 0, time = 0;

  // ---- helpers used by the shots
  const caption = (text) => { if (!text) { cap.classList.remove('on'); return; } cap.textContent = text; cap.classList.add('on'); };
  const showCard = (html, cut = false) => { card.classList.toggle('cut', cut); card.innerHTML = html; void card.offsetWidth; card.classList.add('on'); };
  const hideCard = (cut = false) => { card.classList.toggle('cut', cut); void card.offsetWidth; card.classList.remove('on'); };
  const hideAll = () => { for (const o of all) o.reset(); hanged.hide(); if (player.body) player.body.visible = false; };
  const walker = (o, x, z, tx, tz, clip, ts, dt, glow = 1.4) => {     // pose a walking ghost by hand
    if (o.state === 'dormant') o.spawn({ x, z });
    o.pos.x = x; o.pos.z = z; o.face(tx, tz, null); o.play(clip, 0.25, ts); o.setOpacity(1); o.light.intensity = glow; o.tick(dt, time);
  };
  const cam = (p0, p1, l0, l1, k, fov = 50, shake = 0) => {
    camera.position.lerpVectors(p0, p1, k); look.lerpVectors(l0, l1, k);
    if (shake) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
    camera.lookAt(look);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  };
  const torch = (power, dx = 0.25, dy = -0.2) => { torchPow = power; tmp.set(dx, dy, 0).applyQuaternion(camera.quaternion); player.torch.position.copy(camera.position).add(tmp); player.torch.target.position.copy(look); };
  const once = (key, at, fn) => { if (shotT >= at && !fired.has(key)) { fired.add(key); fn(); } };
  const body = (x, z, yaw, clip, ts, dt) => {            // the player character, seen from outside
    const b = player.body; if (!b) return;
    b.visible = true; b.position.set(x, 0, z); b.rotation.y = yaw; b.scale.setScalar(player.bodyScale || 1);
    const next = player.acts[clip];
    if (next && next !== player.curAct) { next.enabled = true; next.setEffectiveWeight(1); next.time = 0; player.curAct.crossFadeTo(next, 0.15, false); player.curAct = next; }
    if (player.curAct) player.curAct.timeScale = ts;
    player.mixer.update(dt);
  };
  // the key shot needs a clear line of sight: pick the key, and the side of it, with the most open space around
  const blocked = (x, y, z) => world.colliders.some((c) => c.on !== false && x > c.min[0] - 0.12 && x < c.max[0] + 0.12 && z > c.min[2] - 0.12 && z < c.max[2] + 0.12 && y > c.min[1] - 0.05 && y < c.max[1] + 0.05);
  let keyShot = null;
  const findKeyShot = () => {
    let best = null;
    for (const it of world.items) {
      if (it.type !== 'key') continue;
      const p = it.pos, N = 24, free = [];
      for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; let ok = true; for (const r of [0.3, 0.55, 0.8, 1.05]) if (blocked(p.x + Math.sin(a) * r, p.y + 0.3, p.z + Math.cos(a) * r)) ok = false; free.push(ok); }
      for (let i = 0; i < N; i++) { let n = 0; while (n < N && free[(i + n) % N]) n++; if (!best || n > best.n) best = { n, p, a: (i + (n - 1) / 2) / N * Math.PI * 2, half: Math.min(0.6, Math.max(0, n - 3) / N * Math.PI) }; }
    }
    return best || { p: V(0, 1, 0), a: 0, half: 0.3 };
  };

  // ---- the cut. Each shot: [duration in seconds, update(k 0..1, dt), optional enter()]
  const SHOTS = [
    [5.2, () => { once('c', 0.3, () => showCard('<h2>Some libraries keep more<br>than books.</h2>')); once('h', 4.2, () => hideCard()); cam(V(0, 2.2, 15), V(0, 2.2, 15), V(0, 5, -20), V(0, 5, -20), 0); torch(0); },
      () => { showCard('', true); audio.bell(0.9); }],

    // the nave, empty, in moonlight
    [7.5, (k) => {
      cam(V(0, 1.9, 16), V(0, 3.1, 5), V(0, 4.6, -20), V(0, 5.4, -20), ease(k), 46); torch(0);
      once('cap', 1.2, () => caption('The Hollow Archive has been locked for sixty years'));
      once('l', 4.6, () => g.lightning(1, 0.5)); once('x', 6.6, () => caption(''));
    }, () => { hideCard(); audio.lament(0.5, -0.4); }],

    // torchlight down a side aisle
    [5.5, (k) => {
      cam(V(-5.8, 1.55, -9), V(-5.6, 1.5, -1.5), V(-6.6, 1.3, 0), V(-5.2, 1.4, 9), k, 58, 0.006); torch(0.75 + Math.sin(time * 9) * 0.03);
      once('cap', 0.6, () => caption('Tonight, someone left the door open')); once('w', 2.2, () => audio.whisper(0.7, 1)); once('x', 4.7, () => caption(''));
    }, () => { audio.creak(2, 0.5, 0.8); }],

    // a key
    [4.3, (k) => {
      keyShot ||= findKeyShot();
      const p = keyShot.p, a = keyShot.a + (k - 0.5) * 2 * keyShot.half;
      cam(V(p.x + Math.sin(a) * 0.95, p.y + 0.36, p.z + Math.cos(a) * 0.95), V(p.x + Math.sin(a) * 0.7, p.y + 0.28, p.z + Math.cos(a) * 0.7), p, p, k, 42); torch(0.5);
      once('cap', 0.4, () => caption('Three keys. One way out.')); once('k', 2.6, () => audio.key()); once('x', 3.6, () => caption(''));
    }],

    // the weeping sister
    [6.8, (k, dt) => {
      const z = lerp(-7.5, -2.6, k);
      walker(nun, 0.2, z, 0.4, 6, 'idle', 1, dt, 1.2);
      cam(V(1.5, 1.45, 2.4), V(0.7, 1.5, 0.2), V(0.2, 1.5, z), V(0.2, 1.56, z), ease(k), lerp(48, 34, k), 0.004); torch(lerp(0.28, 0.55, k));
      once('cry', 0.2, () => audio.cry(1.7, -0.1)); once('cap', 1.0, () => caption('You will hear her before you see her')); once('cry2', 3.6, () => audio.cry(1.9, 0)); once('x', 5.8, () => caption(''));
    }, () => { hideAll(); g.setFear(0.35); }],

    // the bone man
    [5.2, (k, dt) => {
      const z = lerp(-4, 1.7, k);
      walker(skeleton, 5.7, z, 5.7, 9, 'walk', 0.95, dt, 1.0);
      cam(V(5.2, 1.1, 4.6), V(5.5, 1.35, 4.2), V(5.7, 1.2, z), V(5.7, 1.5, z), k, 44, 0.004); torch(0.42);
      if (Math.floor(shotT * 2.6) !== Math.floor((shotT - dt) * 2.6)) audio.rattle(0.5 + k * 0.5, 0.2);
      once('cap', 0.7, () => caption('The dead still walk the stacks')); once('m', 2.4, () => audio.moan(0.9, 0.2)); once('x', 4.4, () => caption(''));
    }, () => { hideAll(); g.setFear(0.45); }],

    // the wraith, from above
    [4.6, (k, dt) => {
      if (wraith.state === 'dormant') wraith.spawn({ x: 0, z: -9 });
      wraith.pos.set(Math.sin(k * 2.2) * 1.4, lerp(6.4, 1.9, ease(k)), lerp(-9, 0.8, ease(k))); wraith.face(0, 4, null); wraith.setOpacity(1); wraith.light.intensity = 2; wraith.present(dt, time, k);
      cam(V(0.3, 0.9, 3.6), V(0.1, 1.1, 3.2), V(0, 5.6, -8), V(0, 2.9, 0.8), ease(k), 62, 0.006 + k * 0.012); torch(0.55);
      once('cap', 0.5, () => caption('Do not look up')); once('x', 3.6, () => caption(''));
    }, () => { hideAll(); audio.wail(1, 0); g.setFear(0.6); }],

    // the crawler, along the floor
    [3.9, (k, dt) => {
      if (crawler.state === 'dormant') { crawler.spawn({ x: -0.4, z: -2 }); crawler.inner.rotation.x = Math.PI / 2; crawler.inner.position.set(0, 0.3, -0.8); }
      crawler.pos.set(-0.4, 0, lerp(-2.5, 3.3, k)); crawler.face(-0.2, 9, null); crawler.setOpacity(1); crawler.light.intensity = 2.2; crawler.crawl(dt, true, 3, time); crawler.tick(dt, time);
      cam(V(0.5, 0.32, 5.2), V(0.3, 0.36, 5.0), V(-0.4, 0.5, 0), V(-0.4, 0.6, 2.5), k, 60, 0.008); torch(0.75);
      if (Math.floor(shotT * 5) !== Math.floor((shotT - dt) * 5)) audio.crawlStep(0.9, 0);
      once('cap', 0.4, () => caption('Do not look down')); once('x', 3.1, () => caption(''));
    }, () => { hideAll(); audio.growl(1, 0); g.setFear(0.7); }],

    // the chase: you, running, and the Archivist behind you
    [5.6, (k, dt) => {
      const z = lerp(12, -9, k), gap = lerp(5.5, 2.3, k);
      body(-0.55, z, Math.PI, 'Run', 1.05, dt);
      walker(archivist, 0.75, z + gap, -0.55, z, 'run', 1.25, dt, 3);
      const cz = z - lerp(3.4, 2.5, k);
      cam(V(0.2, 1.35, cz), V(-0.9, 1.5, cz), V(0.05, 1.25, z + 0.6), V(0.15, 1.4, z + 1.2), k, 52, 0.035); torch(0.55, 0.5, 0.3);
      if (Math.floor(shotT * 3.6) !== Math.floor((shotT - dt) * 3.6)) audio.step(0.9);
      once('cap', 0.5, () => caption('Run.')); once('x', 4.6, () => caption(''));
    }, () => { hideAll(); audio.sting(0.9); g.setFear(1); }],

    // black. Breathing.
    [1.5, () => { torch(0); }, () => { hideAll(); showCard('<h2 class="red">Hide.</h2>', true); audio.breath(1); g.setFear(0.5); }],

    // the hanged
    [2.2, (k, dt) => {
      cam(V(0, 1.6, 7.6), V(0, 1.6, 7.3), V(0, 1.75, 5), V(0, 1.85, 5), k, 58, 0.03 * (1 - k)); torch(0.6);
      once('d', 0.35, () => { hanged.drop(0, 5.2, 0); audio.rope(1); audio.sting(0.8); g.flash(0.3, 180); });
      hanged.update(dt, time);
    }, () => { hideCard(true); }],

    // bats
    [1.9, (k) => {
      cam(V(0, 1.6, 2), V(0, 1.6, 2), V(0, 2.3, -6), V(0, 2.3, -6), k, 62, 0.02); torch(0.6);
      once('l', 0.9, () => g.lightning(1, 0.1));
    }, () => { hideAll(); bats.burst(V(0, 4.6, -8), V(0, 1.7, 1.5), V(3, 5.5, 11), 40, 0.75, 10.5); audio.bats(1, 0); }],

    // her face, close
    [1.7, (k, dt) => {
      walker(nun, 0, lerp(1.2, 2.35, Math.min(1, k * 3)), 0, 9, 'idle', 1, dt, 2.4);
      cam(V(0.05, 1.58, 3.3), V(0, 1.58, 3.05), V(0, 1.6, 2), V(0, 1.6, 2), k, 40, 0.03); torch(Math.random() < 0.3 ? 0.08 : 0.55);
    }, () => { hideAll(); audio.shriek(1, 0); g.flash(0.5, 200); }],

    // the scare frame, then black
    [1.9, () => { torch(0); once('off', 0.24, () => { g.scareEl.classList.remove('peek'); showCard('', true); }); },
      () => { hideAll(); g.scareEl.classList.add('peek'); audio.scream(1); }],

    // title
    [8.5, () => {
      torch(0);
      once('t', 0.2, () => { showCard('<h1>THE HOLLOW<br>ARCHIVE</h1><p>Find the keys &nbsp;·&nbsp; Hide &nbsp;·&nbsp; Do not let them see you</p>'); audio.bell(1); audio.slam(0, 0.8); });
      once('w', 3.2, () => audio.whisper(0, 1)); once('c', 5.5, () => audio.cry(0.6, 0.5));
    }, () => { g.scareEl.classList.remove('peek'); g.setFear(0); }],
  ];
  const TOTAL = SHOTS.reduce((a, s) => a + s[0], 0);

  function start(done) {
    onEnd = done; keyShot = null; t = 0; time = 0; shotI = -1; shotT = 0; running = true; root.style.display = 'block'; caption(''); hideAll();
    camera.rotation.set(0, 0, 0); player.torch.castShadow = player.torch.castShadow && true;
  }
  function stop() {
    running = false; root.style.display = 'none'; caption(''); hideCard(true); hideAll(); g.scareEl.classList.remove('peek'); player.torch.intensity = 0;
    camera.fov = 68; camera.updateProjectionMatrix(); g.setFear(0);
    const f = onEnd; onEnd = null; f?.();
  }
  /** called once per frame by the game loop while the trailer is playing */
  function update(dt) {
    if (!running) return;
    t += dt; time += dt;
    let acc = 0, i = 0; while (i < SHOTS.length - 1 && t >= acc + SHOTS[i][0]) acc += SHOTS[i++][0];
    if (t >= TOTAL) { stop(); return; }
    if (i !== shotI) { shotI = i; fired = new Set(); shotT = 0; SHOTS[i][2]?.(); }
    shotT = t - acc;
    SHOTS[i][1](Math.min(1, shotT / SHOTS[i][0]), dt);
    player.torch.intensity = torchPow * 62;
    player.torchState.pos.copy(player.torch.position); player.torchState.dir.copy(look).sub(player.torch.position).normalize(); player.torchState.power = torchPow;
    camera.updateMatrixWorld();
  }

  // ---- recording: captures this browser tab (picture, captions and sound) and downloads a .webm when the trailer ends
  async function record() {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) throw new Error('This browser cannot record. Use a screen recorder instead.');
    const disp = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include' });
    const tracks = [...disp.getVideoTracks()];
    // take the sound straight from the game's audio graph, so it is recorded even if tab audio was not shared
    const dest = audio.ctx.createMediaStreamDestination(); audio.master.connect(dest); tracks.push(...dest.stream.getAudioTracks());
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const mr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 12e6 });
    const chunks = []; mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const finished = new Promise((res) => { mr.onstop = res; });
    rec.style.display = 'block'; mr.start(500);
    return async () => {
      await new Promise((r) => setTimeout(r, 400)); mr.stop(); await finished;
      rec.style.display = 'none'; disp.getTracks().forEach((x) => x.stop()); try { audio.master.disconnect(dest); } catch { /* */ }
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })); a.download = 'the-hollow-archive-trailer.webm'; a.click();
    };
  }

  return { start, stop, update, record, get running() { return running; }, total: TOTAL };
}
