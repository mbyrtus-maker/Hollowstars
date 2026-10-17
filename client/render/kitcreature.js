// Characters that bring their own skeleton and clips: the Sci-Fi Essentials security droids and
// the Ultimate Space Kit's suited colonists. They stand in for a Humanoid in entities.js, so they
// answer the same update(dt, state, t) calls.
import * as THREE from 'three';
import { Assets } from './assets.js';
import { kitModel } from './props.js';
import { clamp, lerp } from '../../shared/math.js';

const KINDS = {
  quadshell: { model: 'Enemy_QuadShell', size: 1.5, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', aim: 'Attack', dead: 'TurnOff', hit: 'Hit', look: 'Look' }, gait: { Walk: 1.4, Run: 4.2 } },
  trilobite: { model: 'Enemy_Trilobite', size: 1.7, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', aim: 'Attack', dead: 'TurnOff', hit: 'Hit', look: 'Look' }, gait: { Walk: 1.4, Run: 4.4 } },
  frog: { model: 'SK_Astronaut_FinnTheFrog', size: 1.65, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', dead: 'Death', talk: 'Wave', hit: 'HitReact', cower: 'Duck', yes: 'Yes' }, gait: { Walk: 1.6, Run: 4.6 } },
  panda: { model: 'SK_Astronaut_RaeTheRedPanda', size: 1.6, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', dead: 'Death', talk: 'Wave', hit: 'HitReact', cower: 'Duck', yes: 'Yes' }, gait: { Walk: 1.6, Run: 4.6 } },
  bee: { model: 'SK_Astronaut_BarbaraTheBee', size: 1.6, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', dead: 'Death', talk: 'Wave', hit: 'HitReact', cower: 'Duck', yes: 'Yes' }, gait: { Walk: 1.6, Run: 4.6 } },
  flamingo: { model: 'SK_Astronaut_FernandoTheFlamingo', size: 1.85, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', dead: 'Death', talk: 'Wave', hit: 'HitReact', cower: 'Duck', yes: 'Yes' }, gait: { Walk: 1.6, Run: 4.6 } },
};
export const COLONISTS = ['frog', 'panda', 'bee', 'flamingo'];
export const kitCreatureReady = (k) => Assets.ready && Assets.has(KINDS[k].model);

export class KitCreature {
  constructor(kind, opts = {}) {
    const K = KINDS[kind];
    this.kind = kind;
    this.K = K;
    this.type = opts.type || 'civilian';
    this.root = new THREE.Group();
    const g = kitModel(K.model, K.size, true);
    this.body = g;
    this.root.add(g);
    g.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
    this.meshes = [];
    g.traverse((m) => { if (m.isMesh) this.meshes.push(m); });
    this.mixer = new THREE.AnimationMixer(g.userData.model);
    this.cur = null; this.curName = '';
    this.phase = 0; this.swingT = 9; this.lastSwing = 0; this.parryT = 9;
    this.weaponKind = opts.weaponKind || null;
    this.drawn = true;
    this.play('idle');
  }

  clip(key) { const n = this.K.clips[key]; return n ? Assets.clip(this.K.model + '|' + n) || Assets.clip(this.K.model.replace(/^/, '') + '|' + n) : null; }

  play(key, opts = {}) {
    const name = this.K.clips[key];
    if (!name) return;
    if (this.curName === key && !opts.restart) { if (opts.ts != null) this.cur.timeScale = opts.ts; return; }
    const c = this.clip(key);
    if (!c) return;
    const a = this.mixer.clipAction(c);
    a.reset();
    a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = !!opts.once;
    a.timeScale = opts.ts ?? 1;
    a.play();
    if (this.cur) a.crossFadeFrom(this.cur, opts.fade ?? 0.25, false);
    this.cur = a; this.curName = key;
  }

  setDrawn(d) { this.drawn = d; }
  setShroud(on, opacity = 0.16) {
    if (on === this._sh) return;
    this._sh = on;
    for (const m of this.meshes) {
      if (!m.userData.orig) m.userData.orig = m.material;
      if (on) { m.material = m.userData.orig.clone(); m.material.transparent = true; m.material.opacity = opacity; m.material.depthWrite = false; }
      else m.material = m.userData.orig;
    }
  }
  bladeWorld() { return false; }
  muzzleWorld(out) {
    // droids fire from their sensor eye
    this.root.updateWorldMatrix(true, false);
    out.set(0, this.K.size * 0.62, -0.4).applyMatrix4(this.root.matrixWorld);
    return true;
  }

  update(dt, s, t) {
    const sp = s.speed || 0;
    if (sp > 0.3) this.phase += dt * sp / 0.9 * Math.PI;
    if (s.swing !== undefined && s.swing !== this.lastSwing) { this.lastSwing = s.swing; this.swingT = 0; }
    this.swingT += dt;
    if (s.dead) this.play('dead', { once: true, fade: 0.15 });
    else if (s.stagger) this.play('hit', { fade: 0.1 });
    else if (s.cower) this.play(this.K.clips.cower ? 'cower' : 'idle');
    else if (sp > 3.2) this.play('run', { ts: clamp(sp / this.K.gait.Run, 0.6, 1.6) });
    else if (sp > 0.3) this.play('walk', { ts: clamp(sp / this.K.gait.Walk, 0.6, 1.8) });
    else if (s.aim && this.K.clips.aim && !s.lowReady) this.play('aim');
    else if (s.talk && this.K.clips.talk) this.play('talk');
    else this.play('idle');
    this.mixer.update(dt);
    this.lean = lerp(this.lean || 0, clamp((s.turn || 0) * sp * 0.02, -0.2, 0.2), Math.min(1, dt * 5));
    this.body.rotation.z = -this.lean;
  }
}
