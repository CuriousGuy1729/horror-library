// Fully procedural sound design (Web Audio) - no audio files needed.
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
    this.ready = true;
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
    this.#tone('sine', 95 + Math.random() * 25, 45, 0.11, 0.22 * loud, { pan });
    this.#noise(0.07 + Math.random() * 0.03, 'lowpass', 900 + Math.random() * 600, 0.8, 0.16 * loud, { pan });
    if (Math.random() < 0.18) this.#noise(0.25, 'bandpass', 500 + Math.random() * 500, 14, 0.05 * loud, { pan, attack: 0.05 }); // floorboard
  }
  ghostStep(vol, pan) { if (this.ready && vol > 0.01) { this.#tone('sine', 70, 38, 0.16, 0.3 * vol, { pan }); this.#noise(0.09, 'lowpass', 500, 1, 0.12 * vol, { pan }); } }
  click() { if (this.ready) { this.#noise(0.025, 'highpass', 2500, 1, 0.25, { dest: this.dry }); this.#tone('square', 1900, 900, 0.02, 0.06, { dest: this.dry }); } }
  key() { if (!this.ready) return; [2093, 2794, 3520, 4186, 3136].forEach((f, i) => this.#tone('sine', f * (1 + Math.random() * 0.01), null, 0.5, 0.07, { delay: i * 0.055 + Math.random() * 0.02 })); }
  battery() { if (this.ready) { this.#tone('square', 660, null, 0.07, 0.05, { dest: this.dry }); this.#tone('square', 990, null, 0.12, 0.05, { dest: this.dry, delay: 0.08 }); } }
  paper() { if (this.ready) this.#noise(0.35, 'bandpass', 3200, 0.8, 0.12, { attack: 0.08, freqTo: 1800 }); }
  clunk(delay = 0) { if (this.ready) { this.#tone('sine', 140, 50, 0.3, 0.5, { delay }); this.#noise(0.12, 'bandpass', 1800, 3, 0.3, { delay }); this.#tone('triangle', 820, 780, 0.25, 0.08, { delay }); } }
  slam(pan = 0, vol = 1) { if (this.ready) { this.#tone('sine', 80, 28, 0.9, 0.7 * vol, { pan }); this.#noise(0.5, 'lowpass', 400, 0.7, 0.5 * vol, { pan }); } }
  knock(pan = 0) { if (this.ready) for (let i = 0; i < 3; i++) { this.#tone('sine', 150, 70, 0.12, 0.16, { pan, delay: i * 0.21 }); this.#noise(0.05, 'lowpass', 700, 1, 0.1, { pan, delay: i * 0.21 }); } }
  blowOut() { if (this.ready) this.#noise(0.9, 'bandpass', 900, 0.6, 0.35, { attack: 0.25, freqTo: 250 }); }
  whoosh(pan = 0) { if (this.ready) this.#noise(0.7, 'bandpass', 300, 1.2, 0.6, { attack: 0.3, freqTo: 2400, pan }); }
  creak(dur = 1.6, pan = 0, vol = 1) {
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
  whisper(pan = 0, vol = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.1 + Math.random() * 0.9;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 5; const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    for (let x = 0; x < dur; x += 0.085) { f.frequency.linearRampToValueAtTime(1300 + Math.random() * 2400, t + x); g.gain.linearRampToValueAtTime(Math.random() < 0.3 ? 0.005 : (0.05 + Math.random() * 0.12) * vol, t + x); }
    g.gain.linearRampToValueAtTime(0, t + dur + 0.1);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(this.fx); s.start(t, Math.random()); s.stop(t + dur + 0.2);
  }
  sting(vol = 1) {
    if (!this.ready) return;
    [622, 659, 932, 988, 1397, 1480, 311].forEach((f) => this.#tone('sawtooth', f * (1 + (Math.random() - 0.5) * 0.02), f * 0.97, 1.6, 0.075 * vol, { attack: 0.01, pan: Math.random() - 0.5 }));
    this.#tone('sine', 62, 30, 1.4, 0.8 * vol); this.#noise(0.35, 'highpass', 1500, 0.7, 0.3 * vol);
  }
  scream(vol = 1) {
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

  // ---------------------------------------------------------------- continuous
  update(dt, s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
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
      this.eventT = 7 + Math.random() * 16;
      const pan = Math.random() * 2 - 1, r = Math.random();
      if (r < 0.4) this.creak(0.8 + Math.random() * 1.6, pan, 0.25);
      else if (r < 0.6) this.knock(pan);
      else if (r < 0.85) this.whisper(pan, 0.5);
      else this.slam(pan, 0.25);
    }
  }
}
