// All sound is synthesized with WebAudio — no asset files.
export class Audio {
  constructor() {
    this.ctx = null;
    this.vol = 0.7;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // positional helper: returns [gainNode] chain end connected to master with pan & attenuation
  spatial(x, y, z, ref = 8, maxD = 140) {
    const c = this.ctx;
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z, dy = y - L.y;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxD) return null;
    const g = c.createGain();
    g.gain.value = Math.min(1, ref / Math.max(ref, d)) * (1 - d / maxD * 0.6);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) {
      // listener right vector
      const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
      pan.pan.value = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / (d + 1) * 0.9));
      g.connect(pan).connect(this.master);
    } else g.connect(this.master);
    return g;
  }
  noise(dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }
  env(g, t, a, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  blaster(x, y, z, enemy, big) {
    if (!this.ctx) return;
    const out = this.spatial(x, y, z, 6, 160);
    if (!out) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f0 = enemy ? 900 : big ? 700 : 1500;
    o.frequency.setValueAtTime(f0 * (0.95 + Math.random() * 0.1), t);
    o.frequency.exponentialRampToValueAtTime(enemy ? 120 : 160, t + 0.18);
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = enemy ? 1100 : 1800; f.Q.value = 1.2;
    const g = c.createGain();
    this.env(g, t, 0.003, 0.35, 0.2);
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + 0.25);
    const n = this.noise(), ng = c.createGain(), nf = c.createBiquadFilter();
    nf.type = 'highpass'; nf.frequency.value = 2500;
    this.env(ng, t, 0.002, 0.15, 0.06);
    n.connect(nf).connect(ng).connect(out);
    n.start(t); n.stop(t + 0.1);
  }
  // Soft footstep: a hushed crunch on sand, a quiet clack on the garrison's hard floors
  footstep(x, y, z, hard, loud) {
    if (!this.ctx) return;
    const out = this.spatial(x, y, z, 3, 26);
    if (!out) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = hard ? 'bandpass' : 'lowpass';
    f.frequency.value = (hard ? 1700 : 650) * (0.85 + Math.random() * 0.3);
    f.Q.value = hard ? 2.5 : 0.7;
    const v = 0.035 + loud * 0.07;
    this.env(g, t, 0.004, v, hard ? 0.05 : 0.09);
    n.connect(f).connect(g).connect(out);
    n.start(t); n.stop(t + 0.14);
    if (hard) {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(140 + Math.random() * 40, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.05);
      this.env(og, t, 0.002, v * 0.6, 0.05);
      o.connect(og).connect(out);
      o.start(t); o.stop(t + 0.08);
    }
  }
  impact(x, y, z) {
    if (!this.ctx) return;
    const out = this.spatial(x, y, z, 4, 60);
    if (!out) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 0.8;
    this.env(g, t, 0.002, 0.25, 0.08);
    n.connect(f).connect(g).connect(out);
    n.start(t); n.stop(t + 0.12);
  }
  explosion(x, y, z, size = 1) {
    if (!this.ctx) return;
    const out = this.spatial(x, y, z, 20, 400);
    if (!out) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.4);
    this.env(g, t, 0.005, 1.2 * size, 1.6);
    n.connect(f).connect(g).connect(out);
    n.start(t); n.stop(t + 2);
    const o = c.createOscillator(), og = c.createGain();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    this.env(og, t, 0.005, 0.9 * size, 0.7);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.8);
  }
  deflect(x, y, z) {
    if (!this.ctx) return;
    const out = this.spatial(x, y, z, 6, 80);
    if (!out) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(2400, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.12);
    this.env(g, t, 0.002, 0.18, 0.15);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.2);
    this.impact(x, y, z);
  }
  // A two-tone repulsor horn; bikes beep higher, haulers blare lower
  honk(x, y, z, kind = 2) {
    if (!this.ctx) return;
    const out = this.spatial(x, y, z, 10, 90);
    if (!out) return;
    const c = this.ctx, t = c.currentTime;
    const base = kind === 1 ? 520 : kind === 3 ? 180 : 330;
    for (const [f, d] of [[base, 0], [base * 1.26, 0]]) {
      const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f;
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.07, t + d + 0.02);
      g.gain.setValueAtTime(0.07, t + d + 0.22);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
      o.connect(lp).connect(g).connect(out);
      o.start(t + d); o.stop(t + d + 0.32);
    }
  }
  swing(x, y, z) {
    if (!this.ctx) return;
    const out = this.spatial(x, y, z, 5, 50);
    if (!out) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.12); f.frequency.exponentialRampToValueAtTime(250, t + 0.32);
    this.env(g, t, 0.04, 0.5, 0.3);
    n.connect(f).connect(g).connect(out);
    n.start(t); n.stop(t + 0.4);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t); o.frequency.linearRampToValueAtTime(170, t + 0.12); o.frequency.linearRampToValueAtTime(100, t + 0.3);
    this.env(og, t, 0.03, 0.12, 0.3);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.36);
  }
  slash(x, y, z) {
    if (!this.ctx) return;
    const out = this.spatial(x, y, z, 5, 50);
    if (!out) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    this.env(g, t, 0.003, 0.6, 0.18);
    n.connect(f).connect(g).connect(out);
    n.start(t); n.stop(t + 0.25);
  }
  ignite(on) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(on ? 60 : 180, t); o.frequency.exponentialRampToValueAtTime(on ? 180 : 50, t + 0.35);
    this.env(g, t, 0.02, 0.15, 0.35);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    o.connect(f).connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.45);
  }
  // continuous blade hum: call each frame with on/off and swing intensity
  hum(on, intensity) {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.humNodes) {
      const g = c.createGain(); g.gain.value = 0;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 4;
      const o1 = c.createOscillator(), o2 = c.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'sawtooth';
      o1.frequency.value = 88; o2.frequency.value = 90.5;
      o1.connect(f); o2.connect(f); f.connect(g).connect(this.master);
      o1.start(); o2.start();
      this.humNodes = { g, f, o1, o2 };
    }
    const h = this.humNodes, t = c.currentTime;
    h.g.gain.setTargetAtTime(on ? 0.05 + intensity * 0.12 : 0, t, 0.05);
    h.f.frequency.setTargetAtTime(380 + intensity * 900, t, 0.04);
    h.o1.frequency.setTargetAtTime(88 + intensity * 30, t, 0.05);
  }
  engine(on, speed) {
    if (!this.ctx) return;
    const c = this.ctx;
    if (!this.engNodes) {
      const g = c.createGain(); g.gain.value = 0;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 50;
      const n = this.noise(), ng = c.createGain(); ng.gain.value = 0.3;
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900;
      o.connect(f); n.connect(nf).connect(ng).connect(f); f.connect(g).connect(this.master);
      o.start(); n.start();
      this.engNodes = { g, f, o, nf };
    }
    const e = this.engNodes, t = c.currentTime;
    e.g.gain.setTargetAtTime(on ? 0.07 + speed / 50 * 0.08 : 0, t, 0.1);
    e.o.frequency.setTargetAtTime(45 + speed * 2.2, t, 0.1);
    e.f.frequency.setTargetAtTime(400 + speed * 30, t, 0.1);
    e.nf.frequency.setTargetAtTime(600 + speed * 40, t, 0.1);
  }
  whoosh(up) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(up ? 200 : 1600, t); f.frequency.exponentialRampToValueAtTime(up ? 1600 : 180, t + 0.4);
    this.env(g, t, 0.05, 0.6, 0.45);
    n.connect(f).connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.55);
    const o = c.createOscillator(), og = c.createGain();
    o.frequency.setValueAtTime(up ? 70 : 140, t); o.frequency.exponentialRampToValueAtTime(up ? 140 : 50, t + 0.4);
    this.env(og, t, 0.03, 0.35, 0.4);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.5);
  }
  ui(kind = 'click') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    const f = { click: 900, good: 660, bad: 220, cash: 1320 }[kind] || 900;
    o.frequency.setValueAtTime(f, t);
    if (kind === 'good' || kind === 'cash') o.frequency.setValueAtTime(f * 1.5, t + 0.08);
    this.env(g, t, 0.005, 0.12, kind === 'click' ? 0.06 : 0.22);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }
  hurt() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.15);
    this.env(g, t, 0.005, 0.4, 0.15);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
  }
  alarm(on, x, z) {
    if (!this.ctx) return;
    const c = this.ctx;
    if (on && !this.alarmNodes) {
      const g = c.createGain(); g.gain.value = 0;
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 520;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
      const lfo = c.createOscillator(); lfo.frequency.value = 1.6; lfo.type = 'square';
      const lg = c.createGain(); lg.gain.value = 160;
      lfo.connect(lg).connect(o.frequency);
      o.connect(f).connect(g).connect(this.master);
      o.start(); lfo.start();
      this.alarmNodes = { g, o, lfo };
    }
    if (this.alarmNodes) {
      const d = Math.hypot(x - this.listener.x, z - this.listener.z);
      const v = on ? Math.max(0.015, 0.09 * (1 - Math.min(1, d / 260))) : 0;
      this.alarmNodes.g.gain.setTargetAtTime(v, c.currentTime, 0.2);
      if (!on && this.alarmNodes) {
        const n = this.alarmNodes; this.alarmNodes = null;
        setTimeout(() => { try { n.o.stop(); n.lfo.stop(); } catch { /* already stopped */ } }, 800);
      }
    }
  }
  startAmbience() {
    const c = this.ctx;
    const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.value = 380;
    g.gain.value = 0.05;
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 0.03;
    lfo.connect(lg).connect(g.gain);
    n.connect(f).connect(g).connect(this.master);
    n.start(); lfo.start();
    // low drone for atmosphere
    const d1 = c.createOscillator(), d2 = c.createOscillator(), dg = c.createGain(), df = c.createBiquadFilter();
    d1.frequency.value = 55; d2.frequency.value = 82.6; d1.type = d2.type = 'triangle';
    df.type = 'lowpass'; df.frequency.value = 220;
    dg.gain.value = 0.018;
    d1.connect(df); d2.connect(df); df.connect(dg).connect(this.master);
    d1.start(); d2.start();
  }
}
