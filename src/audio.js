// Fully procedural sound design (Web Audio) - no audio files needed.
const SAMPLE_GAIN = {"cat-yowl": 1, "crows-cawing-3": 1, "owl-hoot": 1, "rats-squeaking": 1, "children-laughing-3": 1, "creepy-music-box": 1, "creepy-nursery-rhyme": 1, "banshee-wail": 1, "creepy-baby-crying-2": 1, "creepy-baby-crying": 1, "girl-mommy-i-m-scared": 1, "little-girl-crying": 1, "creepy-whispers-2": 1, "creepy-whispers": 1, "ghost-moan-2": 1, "ghost-whoosh-2": 1, "ghostly-choir": 1, "poltergeist": 1, "gasp-3": 1, "chains-rattling-2": 1, "coffin-lid": 1, "creaky-door-3": 1, "creepy-footsteps": 1, "door-slam-2": 1, "floorboard-creaks": 1, "knocking-on-door-2": 1, "knocking-on-door": 1, "window-tapping": 1, "radio-static-2": 1, "creepy-child-giggle-2": 1, "creepy-child-giggle": 1, "maniacal-laugh": 1, "creature-breathing": 1, "creature-snarl": 1, "demon-choking-dying": 1, "blood-curdling-scream": 1, "girl-screaming": 1, "man-screaming-2": 1, "woman-screaming-2": 1, "braam-2": 1, "creepy-organ-chord-2": 1, "jump-scare-hit-2": 1, "get-out-2-2": 1, "i-m-coming-to-get-you": 1, "i-see-you-2": 1, "church-bell-toll-4": 1, "thunder-crack-2": 1, "zombie-horde-2": 1, "zombie-horde": 1, "atmo": 1};

export class GameAudio {
  constructor() { this.ready = false; this.volume = 0.8; this.beatT = 0; this.eventT = 8; }

  init() {
    if (this.ready) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);
    // noise buffer
    const nb = this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // hall reverb (generated impulse response)
    const len = ctx.sampleRate * 3.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1); }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.5; this.reverb.connect(wet).connect(this.master);
    this.fx = ctx.createGain(); this.fx.connect(this.master); this.fx.connect(this.reverb);
    this.dry = ctx.createGain(); this.dry.connect(this.master);

    // --- ambience: sub drone + wind
    const droneF = ctx.createBiquadFilter(); droneF.type = 'lowpass'; droneF.frequency.value = 150;
    this.droneG = ctx.createGain(); this.droneG.gain.value = 0.0;
    for (const [type, f] of [['sawtooth', 41.2], ['sawtooth', 41.55], ['sine', 61.7], ['sine', 27.5]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(droneF); o.start();
    }
    droneF.connect(this.droneG).connect(this.fx);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 60; lfo.connect(lg).connect(droneF.frequency); lfo.start();
    const wind = this.#loopNoise(); const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 320; wf.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0.0; wind.connect(wf).connect(this.windG).connect(this.fx);
    const wl = ctx.createOscillator(); wl.frequency.value = 0.11; const wlg = ctx.createGain(); wlg.gain.value = 170; wl.connect(wlg).connect(wf.frequency); wl.start();

    // --- ghost presence (glassy cluster) and chase layer, panned towards the ghost
    this.ghostPan = ctx.createStereoPanner(); this.ghostPan.connect(this.fx);
    this.presG = ctx.createGain(); this.presG.gain.value = 0; this.presG.connect(this.ghostPan);
    for (const f of [466.2, 493.9, 698.5, 739.9, 233.1]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const v = ctx.createOscillator(); v.frequency.value = 3 + Math.random() * 3; const vg = ctx.createGain(); vg.gain.value = f * 0.006; v.connect(vg).connect(o.frequency); v.start();
      const g = ctx.createGain(); g.gain.value = 0.2; o.connect(g).connect(this.presG); o.start();
    }
    this.chaseG = ctx.createGain(); this.chaseG.gain.value = 0;
    const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 700; cf.Q.value = 1.2;
    for (const f of [110, 116.5, 164.8, 174.6, 55]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(cf); o.start(); }
    const trem = ctx.createGain(); trem.gain.value = 0.6; const tl = ctx.createOscillator(); tl.type = 'square'; tl.frequency.value = 9; const tg = ctx.createGain(); tg.gain.value = 0.35; tl.connect(tg).connect(trem.gain); tl.start();
    cf.connect(trem).connect(this.chaseG).connect(this.fx);
    this.#initMusic();
    this.ready = true;
  }

  // ---------------------------------------------------------------- recorded samples (public/assets/sfx, all CC0)
  /** fetches and decodes the recordings; safe to call before any user gesture. Synthesised sounds are used until (or if never) they arrive. */
  async loadSamples(base = '/assets/sfx/') {
    this.buf = {}; this.cuts = {};
    const oc = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
    await Promise.all(Object.keys(SAMPLE_GAIN).map(async (n) => {
      try { const ab = await (await fetch(base + n + '.mp3')).arrayBuffer(); this.buf[n] = await new Promise((res, rej) => oc.decodeAudioData(ab, res, rej)); } catch { /* keep the synth fallback */ }
    }));
  }
  has(n) { return this.ready && !!this.buf?.[n]; }
  /** plays a recording. Returns the source node, or null when it is not available (callers then fall back to the synth). */
  smp(n, { vol = 1, pan = 0, rate = 1, offset = 0, dur = 0, dest = this.fx, delay = 0, loop = false, fade = 0.03 } = {}) {
    if (Array.isArray(n)) n = n[(Math.random() * n.length) | 0];
    if (!this.has(n) || vol < 0.004) return null;
    const ctx = this.ctx, t = ctx.currentTime + delay, b = this.buf[n];
    const src = ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = rate; src.loop = loop;
    const g = ctx.createGain(), v = vol * (SAMPLE_GAIN[n] || 1);
    const len = loop ? 0 : Math.min(dur || 1e9, (b.duration - offset) / rate);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + fade);
    if (!loop) { g.gain.setValueAtTime(v, t + Math.max(fade, len - 0.08)); g.gain.linearRampToValueAtTime(0, t + len); }
    const pn = ctx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(pn).connect(dest); src.start(t, offset); if (!loop) src.stop(t + len + 0.05);
    src.gainNode = g;
    return src;
  }
  /** a random stretch of a long recording */
  part(n, len, o = {}) { if (Array.isArray(n)) n = n[(Math.random() * n.length) | 0]; const b = this.buf?.[n]; if (!b) return null; return this.smp(n, { ...o, offset: Math.random() * Math.max(0, b.duration - len - 0.1), dur: len, fade: 0.25 }); }
  /** one of the separate hits inside a recording (a single footstep, a single creak), found by its loudness envelope */
  hit(n, o = {}) {
    const b = this.buf?.[n]; if (!b) return null;
    if (!this.cuts[n]) {
      const d = b.getChannelData(0), w = Math.floor(b.sampleRate * 0.012), env = []; let mx = 0;
      for (let i = 0; i + w < d.length; i += w) { let e = 0; for (let j = 0; j < w; j++) e += d[i + j] * d[i + j]; e = Math.sqrt(e / w); env.push(e); if (e > mx) mx = e; }
      const cuts = []; let last = -99;
      for (let i = 1; i < env.length; i++) if (env[i] > mx * 0.3 && env[i - 1] <= mx * 0.3 && i - last > 20) { cuts.push(Math.max(0, i * 0.012 - 0.03)); last = i; }
      if (!cuts.length) cuts.push(0);
      this.cuts[n] = cuts.map((c, i) => [c, Math.min((cuts[i + 1] ?? b.duration) - c, o.max || 0.9)]);
    }
    const c = this.cuts[n][(Math.random() * this.cuts[n].length) | 0];
    return this.smp(n, { ...o, offset: c[0], dur: c[1], fade: 0.008 });
  }
  /** the EMF meter's buzz: pitch and rattle climb with the reading (1–5) */
  emf(level) { if (!this.ready || level < 2) return; const f = [0, 0, 620, 780, 980, 1240][level]; this.#tone('square', f, f * 0.99, 0.05, 0.018 + level * 0.006, { dest: this.dry, attack: 0.002 }); if (level >= 4) this.#noise(0.04, 'bandpass', 2600, 3, 0.03, { dest: this.dry }); }
  gasp(vol = 0.6) { this.smp('gasp-3', { vol, dest: this.dry }); }
  /** a voice out of the radio speaker */
  radioSay(n) { return this.radioOn ? this.smp(n, { vol: 1.3, dest: this.radioIn }) : null; }
  /** a bed of real room tone under everything, and real static inside the radio */
  #beds() {
    if (this.bedsOn) return; this.bedsOn = true;
    this.atmoG = this.ctx.createGain(); this.atmoG.gain.value = 0; this.atmoG.connect(this.fx);
    this.smp('atmo', { vol: 1, loop: true, dest: this.atmoG, fade: 3 });
    this.smp('radio-static-2', { vol: 0.5, loop: true, dest: this.radioIn });
  }

  setVolume(v) { this.volume = v; if (this.ready) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  suspend() { if (this.ready) this.ctx.suspend(); }
  resume() { if (this.ready) this.ctx.resume(); }
  startAmbience() { if (!this.ready) return; const t = this.ctx.currentTime; this.droneG.gain.setTargetAtTime(0.16, t, 2); this.windG.gain.setTargetAtTime(0.05, t, 3); }

  #loopNoise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(); return s; }

  #noise(dur, type, freq, Q, gain, { pan = 0, dest = this.fx, attack = 0.004, freqTo = null, delay = 0 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = Q;
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  #tone(type, f0, f1, dur, gain, { pan = 0, dest = this.fx, attack = 0.005, delay = 0 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  // ---------------------------------------------------------------- one shots
  step(loud = 0.5) {
    if (!this.ready) return;
    const pan = (Math.random() - 0.5) * 0.3;
    if (this.has('creepy-footsteps')) {      // real shoes on real boards, and every few steps a board complains
      this.hit('creepy-footsteps', { vol: 0.25 + loud * 0.75, pan, rate: 0.92 + Math.random() * 0.16, dest: this.dry, max: 0.45 });
      this.creakT = (this.creakT || 0) - 1;
      if (this.creakT <= 0 && Math.random() < 0.3 + loud * 0.3) { this.creakT = 2 + Math.random() * 3; this.hit('floorboard-creaks', { vol: 0.3 + loud * 0.6, pan: -pan * 2, rate: 0.85 + Math.random() * 0.3, max: 1.4 }); }
      return;
    }
    this.#tone('sine', 95 + Math.random() * 25, 45, 0.11, 0.22 * loud, { pan });
    this.#noise(0.07 + Math.random() * 0.03, 'lowpass', 900 + Math.random() * 600, 0.8, 0.16 * loud, { pan });
    if (Math.random() < 0.18) this.#noise(0.25, 'bandpass', 500 + Math.random() * 500, 14, 0.05 * loud, { pan, attack: 0.05 }); // floorboard
  }
  ghostStep(vol, pan) { if (this.has('creepy-footsteps') && vol > 0.01) { this.hit('creepy-footsteps', { vol: vol * 0.9, pan, rate: 0.7 + Math.random() * 0.1, max: 0.5 }); if (Math.random() < 0.25) this.hit('floorboard-creaks', { vol: vol * 0.7, pan, rate: 0.7, max: 1.4 }); return; } if (this.ready && vol > 0.01) { this.#tone('sine', 70, 38, 0.16, 0.3 * vol, { pan }); this.#noise(0.09, 'lowpass', 500, 1, 0.12 * vol, { pan }); } }
  click() { if (this.ready) { this.#noise(0.025, 'highpass', 2500, 1, 0.25, { dest: this.dry }); this.#tone('square', 1900, 900, 0.02, 0.06, { dest: this.dry }); } }
  key() { if (!this.ready) return; [2093, 2794, 3520, 4186, 3136].forEach((f, i) => this.#tone('sine', f * (1 + Math.random() * 0.01), null, 0.5, 0.07, { delay: i * 0.055 + Math.random() * 0.02 })); }
  battery() { if (this.ready) { this.#tone('square', 660, null, 0.07, 0.05, { dest: this.dry }); this.#tone('square', 990, null, 0.12, 0.05, { dest: this.dry, delay: 0.08 }); } }
  paper() { if (this.ready) this.#noise(0.35, 'bandpass', 3200, 0.8, 0.12, { attack: 0.08, freqTo: 1800 }); }
  clunk(delay = 0) { if (this.ready) { this.#tone('sine', 140, 50, 0.3, 0.5, { delay }); this.#noise(0.12, 'bandpass', 1800, 3, 0.3, { delay }); this.#tone('triangle', 820, 780, 0.25, 0.08, { delay }); } }
  slam(pan = 0, vol = 1) { if (this.smp('door-slam-2', { vol: vol * 1.2, pan })) { this.#tone('sine', 70, 28, 0.7, 0.4 * vol, { pan }); return; } if (this.ready) { this.#tone('sine', 80, 28, 0.9, 0.7 * vol, { pan }); this.#noise(0.5, 'lowpass', 400, 0.7, 0.5 * vol, { pan }); } }
  knock(pan = 0) { if (this.smp(['knocking-on-door-2', 'knocking-on-door', 'window-tapping'], { vol: 0.9, pan })) return; if (this.ready) for (let i = 0; i < 3; i++) { this.#tone('sine', 150, 70, 0.12, 0.16, { pan, delay: i * 0.21 }); this.#noise(0.05, 'lowpass', 700, 1, 0.1, { pan, delay: i * 0.21 }); } }
  blowOut() { if (this.ready) this.#noise(0.9, 'bandpass', 900, 0.6, 0.35, { attack: 0.25, freqTo: 250 }); }
  whoosh(pan = 0) { if (this.ready) this.#noise(0.7, 'bandpass', 300, 1.2, 0.6, { attack: 0.3, freqTo: 2400, pan }); }
  creak(dur = 1.6, pan = 0, vol = 1) { if (Math.random() < 0.6 && this.smp(Math.random() < 0.5 ? 'creaky-door-3' : 'floorboard-creaks', { vol: vol * 1.2, pan, rate: 0.75 + Math.random() * 0.4, dur })) return;
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const steps = Math.ceil(dur / 0.08); let f = 70 + Math.random() * 30;
    for (let i = 0; i < steps; i++) { f = Math.max(50, Math.min(150, f + (Math.random() - 0.45) * 22)); o.frequency.linearRampToValueAtTime(f, t + i * 0.08); }
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 750 + Math.random() * 300; bp.Q.value = 7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * vol, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(bp).connect(g).connect(p).connect(this.fx); o.start(t); o.stop(t + dur + 0.1);
  }
  whisper(pan = 0, vol = 1) { if (this.part(['creepy-whispers', 'creepy-whispers-2'], 2.2 + Math.random() * 1.6, { vol: vol * 1.1, pan })) return;
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.1 + Math.random() * 0.9;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 5; const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    for (let x = 0; x < dur; x += 0.085) { f.frequency.linearRampToValueAtTime(1300 + Math.random() * 2400, t + x); g.gain.linearRampToValueAtTime(Math.random() < 0.3 ? 0.005 : (0.05 + Math.random() * 0.12) * vol, t + x); }
    g.gain.linearRampToValueAtTime(0, t + dur + 0.1);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(this.fx); s.start(t, Math.random()); s.stop(t + dur + 0.2);
  }
  sting(vol = 1) { if (this.smp(vol > 0.7 ? 'jump-scare-hit-2' : 'braam-2', { vol: vol * 1.1, dest: this.master, dur: 3.5 })) { this.#tone('sine', 62, 30, 1.4, 0.6 * vol); return; }
    if (!this.ready) return;
    [622, 659, 932, 988, 1397, 1480, 311].forEach((f) => this.#tone('sawtooth', f * (1 + (Math.random() - 0.5) * 0.02), f * 0.97, 1.6, 0.075 * vol, { attack: 0.01, pan: Math.random() - 0.5 }));
    this.#tone('sine', 62, 30, 1.4, 0.8 * vol); this.#noise(0.35, 'highpass', 1500, 0.7, 0.3 * vol);
  }
  scream(vol = 1) { this.smp('blood-curdling-scream', { vol: 1.2 * vol, dest: this.master }); this.smp('jump-scare-hit-2', { vol: 1.1 * vol, dest: this.master });
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.7;
    const shaper = ctx.createWaveShaper(); const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); } shaper.curve = curve;
    const pre = ctx.createGain(); pre.gain.value = 0.5;
    for (const r of [1, 1.012, 1.498, 2.02, 2.97, 0.5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(300 * r, t); o.frequency.exponentialRampToValueAtTime(940 * r, t + 0.09);
      o.frequency.linearRampToValueAtTime(760 * r, t + 0.7); o.frequency.exponentialRampToValueAtTime(210 * r, t + dur);
      const v = ctx.createOscillator(); v.frequency.value = 11 + Math.random() * 6; const vg = ctx.createGain(); vg.gain.value = 45 * r; v.connect(vg).connect(o.frequency); v.start(t); v.stop(t + dur);
      o.connect(pre); o.start(t); o.stop(t + dur + 0.1);
    }
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; const ng = ctx.createGain(); ng.gain.value = 0.5; n.connect(ng).connect(pre); n.start(t); n.stop(t + dur);
    pre.connect(shaper);
    const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.95 * vol, t + 0.015); out.gain.setValueAtTime(0.9 * vol, t + 0.9); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [f, q] of [[850, 3], [1350, 4], [2700, 5], [3900, 6]]) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; shaper.connect(b).connect(out); }
    out.connect(this.master); out.connect(this.reverb);
    this.#tone('sine', 90, 25, 1.5, 1.0 * vol, { dest: this.master });
  }
  win() { if (this.ready) [196, 246.9, 293.7, 392, 493.9].forEach((f, i) => this.#tone('sine', f, null, 5, 0.09, { attack: 1.2, delay: i * 0.25 })); }

  // ---------------------------------------------------------------- score, storm, radio
  #initMusic() {
    const ctx = this.ctx;
    this.musicG = ctx.createGain(); this.musicG.gain.value = 0; this.musicG.connect(this.fx);
    // string pad: a D-minor cluster with a tritone that swells in as tension rises
    const padF = this.padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 420; padF.Q.value = 0.8;
    const padG = ctx.createGain(); padG.gain.value = 0.11; padF.connect(padG).connect(this.musicG);
    for (const f of [73.42, 110, 146.83, 174.61, 220]) for (const det of [-5, 6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + (Math.random() - 0.5) * 4;
      const g = ctx.createGain(); g.gain.value = 0.16; const l = ctx.createOscillator(); l.frequency.value = 0.05 + Math.random() * 0.12; const lg = ctx.createGain(); lg.gain.value = 0.1; l.connect(lg).connect(g.gain); l.start();
      o.connect(g).connect(padF); o.start();
    }
    this.tensG = ctx.createGain(); this.tensG.gain.value = 0;
    const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1700; tf.Q.value = 0.9;
    for (const f of [207.65, 415.3, 440, 622.25, 659.25, 880]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 30; const v = ctx.createOscillator(); v.frequency.value = 5 + Math.random() * 2; const vg = ctx.createGain(); vg.gain.value = f * 0.008; v.connect(vg).connect(o.frequency); v.start(); o.connect(tf); o.start(); }
    const tt = ctx.createGain(); tt.gain.value = 0.55; const tl = ctx.createOscillator(); tl.frequency.value = 11; const tg = ctx.createGain(); tg.gain.value = 0.4; tl.connect(tg).connect(tt.gain); tl.start();
    tf.connect(tt).connect(this.tensG).connect(this.musicG);
    // rain on the roof and windows
    this.rainG = ctx.createGain(); this.rainG.gain.value = 0;
    const r1 = this.#loopNoise(), rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 2600; const rg = ctx.createGain(); rg.gain.value = 0.5; r1.connect(rf).connect(rg).connect(this.rainG);
    const r2 = this.#loopNoise(), rf2 = ctx.createBiquadFilter(); rf2.type = 'lowpass'; rf2.frequency.value = 380; r2.playbackRate.value = 0.7; r2.connect(rf2).connect(this.rainG);
    this.rainG.connect(this.fx);
    // hand radio: everything through a small, nasal speaker
    this.radioG = ctx.createGain(); this.radioG.gain.value = 0;
    const sp1 = ctx.createBiquadFilter(); sp1.type = 'bandpass'; sp1.frequency.value = 1500; sp1.Q.value = 0.9;
    const sh = ctx.createWaveShaper(); const cv = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 3); } sh.curve = cv;
    this.radioIn = ctx.createGain(); this.radioIn.connect(sh).connect(sp1).connect(this.radioG).connect(this.dry);
    this.staticG = ctx.createGain(); this.staticG.gain.value = 0.05; const st = this.#loopNoise(); st.playbackRate.value = 1.3; st.connect(this.staticG).connect(this.radioIn);
    this.radioTune = ctx.createGain(); this.radioTune.gain.value = 0.5; this.radioTune.connect(this.radioIn);
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 100; const hg = ctx.createGain(); hg.gain.value = 0.012; hum.connect(hg).connect(this.radioIn); hum.start();
    this.noteT = 3; this.bar = 0; this.radioT = 0; this.radioStep = 0; this.radioOn = false; this.hitT = 20; this.breathT = 0;
  }
  startScore() { if (!this.ready) return; this.#beds(); const t = this.ctx.currentTime; this.atmoG.gain.setTargetAtTime(0.22, t, 5); this.musicG.gain.setTargetAtTime(0.55, t, 4); this.rainG.gain.setTargetAtTime(0.035, t, 3); }
  setRadio(on) { this.radioOn = on; if (!this.ready) return; this.#noise(0.12, 'bandpass', 2400, 2, 0.3, { dest: this.dry }); this.#tone('square', on ? 500 : 900, on ? 1800 : 300, 0.18, 0.05, { dest: this.dry }); this.radioG.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.06); }
  thunder(vol = 1, delay = 0) { this.smp('thunder-crack-2', { vol: vol * 0.9, delay, dur: 9, pan: Math.random() - 0.5 });
    if (!this.ready) return;
    this.#noise(0.25, 'highpass', 1200, 0.5, 0.5 * vol, { delay, attack: 0.002 });                       // crack
    this.#noise(4.5, 'lowpass', 160, 0.6, 1.1 * vol, { delay: delay + 0.05, attack: 0.08, freqTo: 55 }); // roll
    this.#noise(3.2, 'lowpass', 320, 0.8, 0.5 * vol, { delay: delay + 0.6, attack: 0.5, freqTo: 80, pan: Math.random() - 0.5 });
    this.#tone('sine', 48, 26, 3.0, 0.7 * vol, { delay: delay + 0.05 });
  }
  /**
   * A synthetic human voice: a buzzing glottal source pushed through three vowel formants.
   * segs = [[startOffset, duration, pitchFrom, pitchTo, loudness], ...]; `vowel` = three formant frequencies.
   */
  #voice(segs, { vowel = [800, 1200, 2700], vol = 1, pan = 0, vib = 6, vibDepth = 0.02, rough = 0, breath = 0.25, delay = 0, dest = this.fx } = {}) {
    if (!this.ready || vol < 0.01) return;
    const ctx = this.ctx, t0 = ctx.currentTime + delay, end = Math.max(...segs.map((x) => x[0] + x[1])) + 0.15;
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    const sub = ctx.createOscillator(); sub.type = 'square'; const subG = ctx.createGain(); subG.gain.value = 0.25;
    const amp = ctx.createGain(); amp.gain.setValueAtTime(0, t0);
    const air = ctx.createBufferSource(); air.buffer = this.noiseBuf; air.loop = true; const airG = ctx.createGain(); airG.gain.value = breath;
    const lfo = ctx.createOscillator(); lfo.frequency.value = vib; const lg = ctx.createGain(); lfo.connect(lg); lg.connect(src.frequency); lg.connect(sub.frequency);
    src.frequency.setValueAtTime(segs[0][2], t0); sub.frequency.setValueAtTime(segs[0][2] * 0.5, t0); lg.gain.setValueAtTime(segs[0][2] * vibDepth, t0);
    for (const [o, d, f0, f1, l = 1] of segs) {
      const a = t0 + o, at = Math.min(0.05, d * 0.3);
      src.frequency.setValueAtTime(f0, a); src.frequency.exponentialRampToValueAtTime(f1, a + d);
      sub.frequency.setValueAtTime(f0 * 0.5, a); sub.frequency.exponentialRampToValueAtTime(f1 * 0.5, a + d);
      lg.gain.setValueAtTime(f0 * vibDepth, a);
      amp.gain.setValueAtTime(0.0001, a); amp.gain.linearRampToValueAtTime(l, a + at); amp.gain.setValueAtTime(l, a + d * 0.6); amp.gain.exponentialRampToValueAtTime(0.0001, a + d);
    }
    src.connect(amp); sub.connect(subG).connect(amp); air.connect(airG).connect(amp);
    let node = amp;
    if (rough > 0) {          // a torn, ragged throat: fast amplitude flutter
      const r = ctx.createGain(); r.gain.value = 1 - rough * 0.5; const ro = ctx.createOscillator(); ro.type = 'sawtooth'; ro.frequency.value = 58 + Math.random() * 30; const rg = ctx.createGain(); rg.gain.value = rough * 0.5;
      ro.connect(rg).connect(r.gain); ro.start(t0); ro.stop(t0 + end); amp.connect(r); node = r;
    }
    const out = ctx.createGain(); out.gain.value = vol; const pn = ctx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, pan));
    vowel.forEach((f, i) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = [7, 9, 10][i]; const g = ctx.createGain(); g.gain.value = [1, 0.6, 0.3][i]; node.connect(b).connect(g).connect(out); });
    out.connect(pn).connect(dest);
    for (const n of [src, sub, lfo]) { n.start(t0); n.stop(t0 + end); }
    air.start(t0, Math.random()); air.stop(t0 + end);
  }
  /** a woman weeping: hitching sobs that fall in pitch, then a long shaking breath out */
  cry(vol = 1, pan = 0) { if (this.part(['little-girl-crying', 'creepy-baby-crying-2', 'girl-mommy-i-m-scared'], 4 + Math.random() * 2, { vol: Math.min(1.5, vol), pan })) return;
    if (!this.ready) return;
    const segs = []; let t = 0; const base = 400 + Math.random() * 90;
    const n = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) { const d = 0.16 + Math.random() * 0.1; segs.push([t, d, base * (1.18 - i * 0.05), base * (0.9 - i * 0.05), 0.9 - i * 0.08]); t += d + 0.07 + Math.random() * 0.06; }
    segs.push([t + 0.1, 1.1 + Math.random() * 0.6, base * 1.05, base * 0.62, 0.8]);
    this.#voice(segs, { vowel: [620, 1250, 2800], vol: 0.36 * vol, pan, vib: 7.5, vibDepth: 0.045, breath: 0.4 });
    this.#noise(0.35, 'bandpass', 2200, 1.5, 0.05 * vol, { pan, attack: 0.1, delay: t + 1.6 });   // the sniff afterwards
  }
  /** a long, wailing lament */
  lament(vol = 1, pan = 0) { if (this.smp(['ghost-moan-2', 'banshee-wail'], { vol, pan, dur: 6 })) return;
    const b = 330 + Math.random() * 60;
    this.#voice([[0, 1.5, b, b * 1.5, 0.8], [1.5, 1.9, b * 1.5, b * 1.12, 1], [3.5, 2.2, b * 1.2, b * 0.7, 0.7]], { vowel: [500, 950, 2700], vol: 0.3 * vol, pan, vib: 5.5, vibDepth: 0.05, breath: 0.3 });
  }
  /** a woman's shriek, close and ragged */
  shriek(vol = 1, pan = 0) { if (this.smp(['woman-screaming-2', 'girl-screaming'], { vol: vol * 1.15, pan })) return;
    if (!this.ready) return;
    const b = 720 + Math.random() * 160;
    this.#voice([[0, 0.14, b * 0.6, b, 0.8], [0.14, 1.25, b * 1.05, b * 1.22, 1], [1.39, 0.55, b * 1.2, b * 0.55, 0.7]], { vowel: [1050, 1750, 3300], vol: 0.6 * vol, pan, vib: 9, vibDepth: 0.03, rough: 0.9, breath: 0.5 });
    this.#noise(1.6, 'bandpass', 3200, 1.2, 0.14 * vol, { pan, attack: 0.05 });
  }
  /** a man shouting somewhere in the building — sometimes cut short */
  shout(vol = 1, pan = 0) { if (this.smp('man-screaming-2', { vol, pan })) return;
    if (!this.ready) return;
    const b = 150 + Math.random() * 50, cut = Math.random() < 0.4;
    const segs = [[0, 0.5, b, b * 1.5, 1], [0.62, cut ? 0.35 : 1.3, b * 1.6, cut ? b * 1.7 : b * 0.85, 1]];
    this.#voice(segs, { vowel: [730, 1150, 2500], vol: 0.5 * vol, pan, vib: 5, vibDepth: 0.02, rough: 0.7, breath: 0.35 });
    if (cut) { this.#tone('sine', 90, 40, 0.3, 0.4 * vol, { pan, delay: 0.98 }); this.#noise(0.2, 'lowpass', 500, 1, 0.3 * vol, { pan, delay: 0.98 }); }
  }
  /** a low groan of pain */
  moan(vol = 1, pan = 0) { if (this.smp(['zombie-horde', 'demon-choking-dying'], { vol, pan, dur: 4.5 })) return; const b = 95 + Math.random() * 30; this.#voice([[0, 2.4, b * 1.15, b * 0.8, 1]], { vowel: [450, 800, 2400], vol: 0.45 * vol, pan, vib: 4, vibDepth: 0.03, rough: 0.5, breath: 0.5 }); }
  /** a child laughing, where there is no child */
  giggle(vol = 1, pan = 0) { if (this.smp(['creepy-child-giggle', 'creepy-child-giggle-2'], { vol, pan })) return;
    const segs = []; let t = 0; const b = 560 + Math.random() * 120, n = 5 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) { segs.push([t, 0.09, b * (1.25 - i * 0.04), b * (1.0 - i * 0.04), 1 - i * 0.07]); t += 0.135 + i * 0.006; }
    this.#voice(segs, { vowel: [900, 1900, 3200], vol: 0.3 * vol, pan, vib: 0, vibDepth: 0, breath: 0.5 });
  }
  /** a few sung notes of a hymn, slightly out of tune */
  hymn(vol = 1, pan = 0) { if (this.part(['creepy-nursery-rhyme', 'ghostly-choir'], 6, { vol: vol * 1.2, pan })) return;
    const notes = [0, 3, 2, 0, -2, 0], b = 392; let t = 0; const segs = [];
    for (const n of notes) { const f = b * 2 ** (n / 12) * (1 + (Math.random() - 0.5) * 0.02); segs.push([t, 0.95, f, f * 0.995, 0.8]); t += 0.9; }
    this.#voice(segs, { vowel: [400, 800, 2600], vol: 0.22 * vol, pan, vib: 5.5, vibDepth: 0.012, breath: 0.2 });
  }
  /** dry bones knocking together */
  rattle(vol = 1, pan = 0) {
    if (!this.ready || vol < 0.01) return;
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) { const d = i * (0.035 + Math.random() * 0.04), f = 900 + Math.random() * 1500; this.#tone('triangle', f, f * 0.8, 0.045, 0.16 * vol, { pan, delay: d, attack: 0.001 }); this.#noise(0.02, 'bandpass', f * 1.8, 4, 0.12 * vol, { pan, delay: d, attack: 0.001 }); }
  }
  /** a rope snapping taut under a weight */
  rope(vol = 1) { if (!this.ready) return; this.#tone('sine', 120, 40, 0.5, 0.7 * vol); this.#noise(0.1, 'bandpass', 1400, 2, 0.4 * vol); this.creak(2.2, 0, 0.9 * vol); this.#tone('sawtooth', 62, 58, 2.5, 0.08 * vol, { attack: 0.02 }); }
  /** something dragged along the floorboards */
  drag(vol = 1, pan = 0) { if (this.part('coffin-lid', 4, { vol, pan })) return; if (this.ready) for (let i = 0; i < 3; i++) this.#noise(0.9, 'bandpass', 260 + Math.random() * 120, 1.2, 0.22 * vol, { pan, attack: 0.3, delay: i * 1.25, freqTo: 180 }); }
  /** a distant bell */
  bell(vol = 1) { if (this.smp('church-bell-toll-4', { vol: vol * 0.9 })) return; if (this.ready) [[196, 1], [392.5, 0.5], [466, 0.35], [588, 0.25], [785, 0.18], [1050, 0.08]].forEach(([f, g]) => this.#tone('sine', f, f * 0.998, 5.5, 0.13 * g * vol, { attack: 0.004 })); }
  /** fingernails on glass or wood */
  scratch(vol = 1, pan = 0) { if (this.ready) for (let i = 0; i < 4; i++) this.#noise(0.22 + Math.random() * 0.15, 'bandpass', 3000 + Math.random() * 1500, 6, 0.1 * vol, { pan, attack: 0.05, delay: i * 0.33 + Math.random() * 0.08, freqTo: 4200 }); }

  wail(vol = 1, pan = 0) { if (this.smp('banshee-wail', { vol, pan })) return;
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 3.2;
    const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.22 * vol, t + 0.9); out.gain.linearRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2.5; const pn = ctx.createStereoPanner(); pn.pan.value = pan;
    for (const r of [1, 1.006, 1.5, 2.01]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(330 * r, t); o.frequency.linearRampToValueAtTime(590 * r, t + 1.1); o.frequency.linearRampToValueAtTime(520 * r, t + 1.9); o.frequency.exponentialRampToValueAtTime(250 * r, t + dur);
      const v = ctx.createOscillator(); v.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = 12 * r; v.connect(vg).connect(o.frequency); v.start(t); v.stop(t + dur);
      o.connect(f); o.start(t); o.stop(t + dur + 0.1);
    }
    f.connect(out).connect(pn).connect(this.fx);
    this.#noise(dur, 'bandpass', 900, 3, 0.12 * vol, { attack: 1, pan, freqTo: 1500 });
  }
  growl(vol = 1, pan = 0) { if (this.smp('creature-snarl', { vol, pan, dur: 3.5 })) return;
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.6;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(62, t); o.frequency.linearRampToValueAtTime(48, t + dur);
    const am = ctx.createGain(); am.gain.value = 0.5; const l = ctx.createOscillator(); l.type = 'square'; l.frequency.setValueAtTime(23, t); l.frequency.linearRampToValueAtTime(15, t + dur); const lg = ctx.createGain(); lg.gain.value = 0.5; l.connect(lg).connect(am.gain); l.start(t); l.stop(t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 1.4; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7 * vol, t + 0.25); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const pn = ctx.createStereoPanner(); pn.pan.value = pan; o.connect(am).connect(f).connect(g).connect(pn).connect(this.fx); o.start(t); o.stop(t + dur + 0.1);
  }
  crawlStep(vol, pan) {
    if (!this.ready || vol < 0.02) return;
    for (let i = 0; i < 3; i++) this.#noise(0.018, 'bandpass', 2600 + Math.random() * 2600, 9, 0.5 * vol, { pan, delay: i * 0.035 + Math.random() * 0.02, attack: 0.001 });   // knuckles and nails on wood
    this.#tone('sine', 110, 60, 0.07, 0.3 * vol, { pan });
    if (Math.random() < 0.2) this.#noise(0.12, 'bandpass', 700, 6, 0.35 * vol, { pan, attack: 0.002, freqTo: 240 });   // a joint cracking
  }
  bats(vol = 1, pan = 0) {
    if (!this.ready) return;
    for (let i = 0; i < 34; i++) { const d = Math.random() * 1.8, p = Math.max(-1, Math.min(1, pan + (d - 0.9) * 0.9));
      this.#noise(0.05, 'bandpass', 500 + Math.random() * 700, 1.5, 0.3 * vol, { delay: d, pan: p, attack: 0.01 });
      if (i % 2) this.#tone('sine', 5200 + Math.random() * 3200, 4200 + Math.random() * 2000, 0.05, 0.045 * vol, { delay: d + 0.02, pan: p, attack: 0.002 }); }
  }
  ping(strength = 0.5) { if (this.ready) { this.#tone('sine', 1320, 1300, 0.09, 0.05 + 0.07 * strength, { dest: this.dry, attack: 0.002 }); if (strength > 0.6) this.#tone('sine', 1760, 1740, 0.07, 0.05, { dest: this.dry, delay: 0.1 }); } }
  breath(vol = 0.5) { if (this.ready) { this.#noise(0.55, 'bandpass', 1500, 1.2, 0.08 * vol, { dest: this.dry, attack: 0.22, freqTo: 2300 }); this.#noise(0.7, 'bandpass', 900, 1.2, 0.09 * vol, { dest: this.dry, attack: 0.2, freqTo: 500, delay: 0.62 }); } }
  radioVoice() { if (this.radioOn && Math.random() < 0.35 && this.radioSay(['get-out-2-2', 'i-see-you-2', 'i-m-coming-to-get-you'])) return; if (this.ready && this.radioOn) for (let i = 0; i < 7; i++) this.#tone('sawtooth', 110 + Math.random() * 70, 90 + Math.random() * 60, 0.13, 0.25, { dest: this.radioIn, delay: i * 0.16 + Math.random() * 0.05 }); }
  #score(dt, s) {
    const t = this.ctx.currentTime, tension = s.tension || 0;
    this.padF.frequency.setTargetAtTime(380 + tension * 900, t, 1.5);
    this.tensG.gain.setTargetAtTime(tension * tension * 0.2, t, 0.8);
    // a slow music box figure in D minor that keeps reaching for the wrong note
    this.noteT -= dt;
    if (this.noteT <= 0) {
      const motifs = [[587.3, 698.5, 880, 932.3, 880, 698.5], [587.3, 554.4, 587.3, 698.5, 659.3], [880, 830.6, 698.5, 587.3, 554.4, 440], [1174.7, 932.3, 880, 698.5]];
      const m = motifs[this.bar++ % motifs.length], sour = Math.random() < 0.3 + tension * 0.3;
      m.forEach((f, i) => { const ff = (sour && i === m.length - 1 ? f * 1.059 : f) * (s.chase ? 0.5 : 1);
        this.#tone('sine', ff, null, 2.6, 0.05, { delay: i * 0.52, attack: 0.004, pan: (i % 2 ? 0.25 : -0.25), dest: this.musicG });
        this.#tone('triangle', ff * 2.005, null, 1.2, 0.012, { delay: i * 0.52, attack: 0.003, dest: this.musicG }); });
      this.noteT = m.length * 0.52 + 7 + Math.random() * 9 - tension * 5;
    }
    this.hitT -= dt;
    if (this.hitT <= 0) { this.hitT = 16 + Math.random() * 22 - tension * 9; this.#tone('sine', 55, 36.7, 3.5, 0.5, { attack: 0.01, dest: this.musicG }); this.#tone('sawtooth', 73.4, 69.3, 2.5, 0.07, { attack: 0.02, dest: this.musicG }); if (tension > 0.4) this.#noise(2.2, 'bandpass', 2400, 6, 0.05, { attack: 1.9, freqTo: 3800, dest: this.musicG }); }
    // the radio: a warped waltz under static; the static swells when something is near
    if (this.radioOn) {
      const near = s.staticLevel || 0;
      this.staticG.gain.setTargetAtTime(0.035 + near * near * 0.75 + (Math.random() < 0.02 ? 0.3 : 0), t, 0.05);
      this.radioTune.gain.setTargetAtTime(0.5 * (1 - near * 0.85), t, 0.2);
      this.radioT -= dt;
      if (this.radioT <= 0) {
        const tune = [293.7, 349.2, 440, 0, 466.2, 440, 349.2, 0, 329.6, 349.2, 392, 0, 277.2, 329.6, 293.7, 0, 587.3, 554.4, 466.2, 0, 440, 349.2, 329.6, 0, 293.7, 277.2, 220, 0, 293.7, 0, 0, 0];
        const f = tune[this.radioStep++ % tune.length], wow = 1 + Math.sin(t * 2.1) * 0.012;
        if (f) { this.#tone('triangle', f * wow, f * wow * 0.996, 0.5, 0.3, { dest: this.radioTune, attack: 0.02 }); this.#tone('sine', f * wow * 2, null, 0.3, 0.1, { dest: this.radioTune, attack: 0.02 }); if (this.radioStep % 4 === 1) this.#tone('triangle', f * wow / 2, null, 0.9, 0.3, { dest: this.radioTune, attack: 0.03 }); }
        this.radioT = 0.36;
      }
    }
    // the player's own breathing when frightened or winded
    this.breathT -= dt;
    const pant = Math.max(s.fear > 0.5 ? s.fear : 0, s.winded || 0);
    if (pant > 0.3 && this.breathT <= 0) { this.breath(pant); this.breathT = 1.9 - pant * 0.75; }
  }

  // ---------------------------------------------------------------- continuous
  update(dt, s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.#score(dt, s);
    const prox = Math.max(0, 1 - s.ghostDist / 16);
    this.presG.gain.setTargetAtTime(s.ghostActive ? 0.02 + prox * prox * 0.16 : 0, t, 0.25);
    this.chaseG.gain.setTargetAtTime(s.chase ? 0.13 : 0, t, s.chase ? 0.15 : 1.2);
    this.ghostPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, s.ghostPan)), t, 0.1);
    // heartbeat scales with fear
    if (s.fear > 0.12) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        const v = Math.min(1, s.fear * 1.2);
        this.#tone('sine', 62, 36, 0.14, 0.55 * v, { dest: this.dry });
        this.#tone('sine', 54, 32, 0.16, 0.4 * v, { dest: this.dry, delay: 0.17 });
        this.beatT = 1.05 - s.fear * 0.62;
      }
    }
    // sparse random ambience: creaks, knocks, whispers from somewhere in the hall
    this.eventT -= dt;
    if (this.eventT <= 0 && s.ambient) {
      this.eventT = 5 + Math.random() * 11;
      const pan = Math.random() * 2 - 1, far = 0.3 + Math.random() * 0.35;
      // never the same thing twice in a row: the building is full of people who are not there
      const pool = ['creak', 'creak', 'knock', 'whisper', 'whisper', 'slam', 'cry', 'cry', 'shout', 'moan', 'giggle', 'bell', 'scratch', 'drag', 'lament', 'hymn', 'shriek', '~owl-hoot', '~cat-yowl', '~rats-squeaking', '~crows-cawing-3', '~creepy-music-box', '~poltergeist', '~creepy-organ-chord-2', '~children-laughing-3', '~chains-rattling-2', '~creature-breathing', '~ghost-whoosh-2'];
      let k; do k = pool[(Math.random() * pool.length) | 0]; while (k === this.lastEvent); this.lastEvent = k;
      if (k[0] === '~') this.smp(k.slice(1), { vol: far * 1.1, pan, dur: 7 });
      else if (k === 'creak') this.creak(0.8 + Math.random() * 1.6, pan, 0.25);
      else if (k === 'knock') this.knock(pan);
      else if (k === 'whisper') this.whisper(pan, 0.5);
      else if (k === 'slam') this.slam(pan, 0.25);
      else if (k === 'shriek') this.shriek(0.22, pan);
      else if (k === 'bell') this.bell(0.6);
      else this[k](far, pan);
    }
  }
}
