// Hand-held instruments seen in first person: a K-II style EMF meter (left hand) and a spirit-box radio (right hand).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const LED = [0x35ff4a, 0x9dff3a, 0xffe23a, 0xff8a2a, 0xff2a1a];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// The instruments sit inside the torch beam at arm's length, where real lights would bleach them white. They are shaded with a
// matcap instead (a baked studio-light sphere) and dimmed by hand to match the scene.
const MATS = [];
let matcap = null;
function M({ color = 0xffffff, map = null }) {
  matcap ||= canvasTex(256, 256, (c) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, 256, 256);
    let g = c.createRadialGradient(128, 128, 10, 128, 128, 128); g.addColorStop(0, '#8a8a8a'); g.addColorStop(0.7, '#4c4c4c'); g.addColorStop(1, '#161616'); c.fillStyle = g; c.beginPath(); c.arc(128, 128, 128, 0, 7); c.fill();
    g = c.createRadialGradient(92, 78, 2, 92, 78, 80); g.addColorStop(0, 'rgba(255,255,255,.85)'); g.addColorStop(0.35, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(128, 128, 128, 0, 7); c.fill();
  });
  const m = new THREE.MeshMatcapMaterial({ color, map, matcap, fog: false }); m.userData.base = new THREE.Color(color); MATS.push(m); return m;
}

/** a hand gripping something about `w` wide: forearm in a sleeve, palm behind the device, four fingers wrapped round one edge, thumb on the other */
function makeHand(w, side) {
  const g = new THREE.Group();
  const skin = M({ color: 0xb88a6e, roughness: 0.72, emissive: 0x120a07 });
  const cloth = M({ color: 0x14161a, roughness: 0.95 });
  const cap = (r, l, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), mat);
  const arm = cap(0.034, 0.3, cloth); arm.position.set(side * 0.03, -0.3, 0.035); arm.rotation.set(0.25, 0, side * -0.18); g.add(arm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.039, 0.03, 14), cloth); cuff.position.set(side * 0.012, -0.135, 0.02); cuff.rotation.set(0.25, 0, side * -0.18); g.add(cuff);
  const wrist = cap(0.026, 0.05, skin); wrist.position.set(side * 0.006, -0.1, 0.012); wrist.rotation.set(0.2, 0, side * -0.12); g.add(wrist);
  const palm = new THREE.Mesh(new RoundedBoxGeometry(w * 0.95, 0.085, 0.024, 3, 0.011), skin); palm.position.set(0, -0.035, -0.026); g.add(palm);
  for (let i = 0; i < 4; i++) {            // fingers come round the far edge and rest on the face
    const y = -0.066 + i * 0.021, len = 0.03 - Math.abs(i - 1.3) * 0.004;
    const a = cap(0.0085, 0.03, skin); a.rotation.x = Math.PI / 2; a.position.set(-side * (w / 2 + 0.006), y, -0.004); g.add(a);
    const b = cap(0.008, len, skin); b.rotation.z = Math.PI / 2; b.position.set(-side * (w / 2 - len / 2 - 0.002), y, 0.02); g.add(b);
    const nail = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 8, 6), M({ color: 0xc9a797, roughness: 0.4 })); nail.scale.set(1.1, 0.9, 0.35); nail.position.set(-side * (w / 2 - len - 0.006), y, 0.027); g.add(nail);
  }
  const t1 = cap(0.0105, 0.035, skin); t1.rotation.set(Math.PI / 2, 0, 0); t1.position.set(side * (w / 2 + 0.007), -0.05, -0.002); g.add(t1);
  const t2 = cap(0.0098, 0.03, skin); t2.rotation.z = side * 1.2; t2.position.set(side * (w / 2 - 0.012), -0.036, 0.021); g.add(t2);
  return g;
}

export class Gear {
  constructor(camera) {
    this.root = new THREE.Group(); camera.add(this.root);
    this.t = 0; this.emfOn = false; this.radioOn = false; this.level = 0; this.shown = 0; this.emfK = 0; this.radioK = 0; this.freq = 87.5; this.sweepT = 0;
    this.#emf(); this.#radio();
    this.emf.visible = false; this.radio.visible = false;
  }

  #emf() {
    const g = this.emf = new THREE.Group();
    const shell = M({ color: 0x1b1c1f, roughness: 0.55, metalness: 0.1 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.066, 0.165, 0.03, 4, 0.012), shell); g.add(body);
    const grip = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.07, 0.033, 3, 0.012), M({ color: 0x0c0c0d, roughness: 0.95 })); grip.position.y = -0.05; g.add(grip);
    const face = canvasTex(256, 640, (c, w, h) => {
      c.fillStyle = '#101113'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#5a5d63'; c.lineWidth = 3; c.strokeRect(10, 10, w - 20, h - 20);
      c.fillStyle = '#d8d8d2'; c.textAlign = 'center'; c.font = 'bold 44px Arial'; c.fillText('K-II', w / 2, 300);
      c.font = 'bold 24px Arial'; c.fillStyle = '#b9b9b2'; c.fillText('EMF METER', w / 2, 336);
      c.font = '15px Arial'; c.fillStyle = '#8d8d86'; c.fillText('milliGauss  ·  50–20,000 Hz', w / 2, 366);
      const lab = ['0–1.5', '1.5–2.5', '2.5–10', '10–20', '20+'], col = ['#35ff4a', '#9dff3a', '#ffe23a', '#ff8a2a', '#ff2a1a'];
      for (let i = 0; i < 5; i++) { const a = Math.PI * (1 - (i + 0.5) / 5), x = w / 2 + Math.cos(a) * 88, y = 205 - Math.sin(a) * 105; c.fillStyle = col[i]; c.font = 'bold 15px Arial'; c.fillText(lab[i], x, y + 44); }
      c.fillStyle = '#6d6d68'; c.font = '13px Arial'; c.fillText('SAFE RANGE', 62, 252); c.fillText('DANGER', 204, 252);
      c.fillStyle = '#2a2b2e'; c.beginPath(); c.arc(w / 2, 470, 34, 0, 7); c.fill(); c.strokeStyle = '#77797e'; c.stroke();
      c.fillStyle = '#a7a7a0'; c.font = 'bold 14px Arial'; c.fillText('ON / OFF', w / 2, 530);
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 30, 1); }   // scuffs
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.152), M({ map: face, roughness: 0.5, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.1 })); plate.position.z = 0.0153; g.add(plate);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0072, 0.004, 16), M({ color: 0x2c2d31, roughness: 0.4 })); btn.rotation.x = Math.PI / 2; btn.position.set(0, -0.0355, 0.017); g.add(btn);
    this.leds = [];
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (1 - (i + 0.5) / 5), m = new THREE.MeshBasicMaterial({ color: 0x111111, fog: false });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 12, 8), m); led.scale.z = 0.6; led.position.set(Math.cos(a) * 0.02, 0.0275 + Math.sin(a) * 0.025, 0.0162); g.add(led);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0054, 0.0009, 6, 16), M({ color: 0x55575c, metalness: 0.8, roughness: 0.3 })); ring.position.copy(led.position); g.add(ring);
      this.leds.push(m);
    }
    g.add(makeHand(0.066, -1));
    g.position.set(-0.19, -0.42, -0.4); g.rotation.set(-0.42, 0.34, 0.06);
    this.root.add(g);
  }

  #radio() {
    const g = this.radio = new THREE.Group();
    const shell = M({ color: 0x23211e, roughness: 0.6, metalness: 0.15 });
    g.add(new THREE.Mesh(new RoundedBoxGeometry(0.082, 0.15, 0.034, 4, 0.01), shell));
    const face = canvasTex(256, 480, (c, w, h) => {
      c.fillStyle = '#1a1917'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#0b0b0a'; c.fillRect(22, 190, w - 44, 262);               // speaker grille
      for (let y = 0; y < 16; y++) for (let x = 0; x < 13; x++) { c.fillStyle = '#2f2d29'; c.beginPath(); c.arc(38 + x * 15 + (y % 2) * 7, 204 + y * 15.5, 4.2, 0, 7); c.fill(); }
      c.strokeStyle = '#6b665c'; c.lineWidth = 3; c.strokeRect(22, 190, w - 44, 262);
      c.fillStyle = '#b3aa98'; c.font = 'bold 17px Arial'; c.textAlign = 'left'; c.fillText('SB-7  SPIRIT BOX', 24, 30);
      c.font = '12px Arial'; c.fillStyle = '#7d766a'; c.fillText('FM  SWEEP  ·  100 ms', 24, 176);
      c.fillStyle = '#050505'; c.fillRect(22, 44, w - 44, 108);                  // the display well; the live display sits on top
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.074, 0.139), M({ map: face, roughness: 0.55, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.08 })); plate.position.z = 0.0173; g.add(plate);
    // live LCD
    const dc = this.dispCanvas = document.createElement('canvas'); dc.width = 212; dc.height = 108; this.dctx = dc.getContext('2d');
    this.dispTex = new THREE.CanvasTexture(dc); this.dispTex.colorSpace = THREE.SRGBColorSpace;
    this.dispMat = new THREE.MeshBasicMaterial({ map: this.dispTex, fog: false });
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.0615, 0.0313), this.dispMat); disp.position.set(0, 0.0411, 0.0176); g.add(disp);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0019, 0.2, 8), M({ color: 0xa9adb3, metalness: 0.9, roughness: 0.25 })); ant.position.set(0.03, 0.17, -0.006); ant.rotation.z = -0.1; g.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.003, 8, 6), ant.material); tip.position.set(0.04, 0.27, -0.006); g.add(tip);
    for (const [x, y] of [[-0.045, 0.045], [-0.045, 0.015]]) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 18), M({ color: 0x0d0d0d, roughness: 0.5 })); k.rotation.z = Math.PI / 2; k.position.set(x, y, 0); g.add(k); }
    this.rxMat = new THREE.MeshBasicMaterial({ color: 0x220000, fog: false });
    const rx = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 8, 6), this.rxMat); rx.position.set(0.03, 0.0665, 0.0176); g.add(rx);
    g.add(makeHand(0.082, 1));
    g.position.set(0.2, -0.42, -0.4); g.rotation.set(-0.42, -0.34, -0.06);
    this.root.add(g);
  }

  /**
   * @param s { visible, emfOn, radioOn, level 0..5, staticLevel 0..1, speed (m/s), word (text on the radio display or '') }
   */
  update(dt, s) {
    this.t += dt;
    const show = s.visible ? 1 : 0;
    // brightness follows the torch, with a little glow from the instruments' own lights
    const br = 0.6 + 0.95 * (s.light || 0) + (s.emfOn ? s.level * 0.035 : 0) + (s.radioOn ? 0.06 : 0);
    this.br = (this.br ?? br) + (br - (this.br ?? br)) * Math.min(1, dt * 8);
    for (const m of MATS) m.color.copy(m.userData.base).multiplyScalar(this.br);
    this.emfK += ((s.emfOn ? show : 0) - this.emfK) * Math.min(1, dt * 7);
    this.radioK += ((s.radioOn ? show : 0) - this.radioK) * Math.min(1, dt * 7);
    this.emf.visible = this.emfK > 0.01; this.radio.visible = this.radioK > 0.01;
    const sway = Math.min(1, s.speed / 4), bx = Math.sin(this.t * (5 + sway * 5)) * 0.004 * (0.3 + sway * 2), by = Math.abs(Math.cos(this.t * (5 + sway * 5))) * 0.006 * (0.3 + sway * 2);
    // raised into view when switched on, dropped out of frame when off
    this.emf.position.set(-0.235 + bx, -0.44 + this.emfK * 0.33 + by, -0.4);
    this.radio.position.set(0.245 + bx, -0.44 + this.radioK * 0.33 - by + 0.006, -0.4);
    if (this.emf.visible) {
      const lv = s.level, shake = lv >= 4 ? (lv - 3) * 0.0016 : 0;
      this.emf.position.x += (Math.random() - 0.5) * shake; this.emf.position.y += (Math.random() - 0.5) * shake;
      for (let i = 0; i < 5; i++) { const on = i < lv; this.leds[i].color.setHex(on ? LED[i] : 0x121212); if (on) this.leds[i].color.multiplyScalar(2.2 + (i === lv - 1 ? Math.sin(this.t * 40) * 0.6 : 0)); }
    }
    if (this.radio.visible) {
      this.sweepT -= dt;
      if (this.sweepT <= 0) {
        this.sweepT = 0.1; this.freq += 0.2; if (this.freq > 108) this.freq = 87.5;
        const c = this.dctx, w = 212, h = 108, st = s.staticLevel;
        c.fillStyle = '#1c0d02'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#ff9a3a'; c.textAlign = 'left'; c.font = 'bold 15px monospace'; c.fillText('FM', 8, 20); c.fillText('SWEEP ▶', 132, 20);
        if (s.word) { c.font = 'bold 26px monospace'; c.textAlign = 'center'; c.fillText(s.word.slice(0, 12).toUpperCase(), w / 2, 62); }
        else { c.font = 'bold 44px monospace'; c.textAlign = 'right'; c.fillText(this.freq.toFixed(1), 158, 66); c.font = 'bold 15px monospace'; c.fillText('MHz', 202, 66); }
        for (let i = 0; i < 20; i++) { const v = Math.random() * (0.15 + st * 0.85); c.fillStyle = i > 14 ? '#ff4a2a' : '#ff9a3a'; if (i / 20 < v + 0.08) c.fillRect(8 + i * 10, 80, 7, 18); else { c.globalAlpha = 0.18; c.fillRect(8 + i * 10, 80, 7, 18); c.globalAlpha = 1; } }
        this.dispTex.needsUpdate = true;
        this.rxMat.color.setHex(Math.random() < 0.1 + st * 0.8 || s.word ? 0xff3020 : 0x220000); if (this.rxMat.color.r > 0.5) this.rxMat.color.multiplyScalar(2.5);
      }
    }
  }
}
