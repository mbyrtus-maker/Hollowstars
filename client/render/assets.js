// Loads the CC0 Quaternius models (client/assets/*.glb, built by tools/assets/build_assets.py)
// and hands out per-use copies. If anything fails to load, `Assets.ready` stays false and the
// game falls back to its procedural models, so the assets are an upgrade, never a dependency.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const FILES = ['people', 'anims', 'weapons', 'props', 'megakit', 'space'];

// Bones that belong to the upper body; clips are split so legs and torso can play different animations
const UPPER = new Set(['spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r']);
const isUpper = (bone) => UPPER.has(bone) || /_0[1-4](_leaf)?_[lr]$/.test(bone);

export const Assets = {
  ready: false,
  failed: false,
  models: new Map(),
  clips: new Map(),
  split: new Map(),
  textures: new Map(),
  bytes: 0,
  _promise: null,

  base() {
    // assets/ sits next to the page in every build (dev server, GitHub Pages, published artifact)
    return 'assets/';
  },

  load(onProgress) {
    if (this._promise) return this._promise;
    this._promise = (async () => {
      if (typeof fetch !== 'function' || /^file:/.test(location.protocol)) { this.failed = true; return false; }
      const loader = new GLTFLoader();
      let done = 0;
      try {
        await Promise.all(FILES.map(async (f) => {
          const res = await fetch(this.base() + f + '.glb');
          if (!res.ok) throw new Error(`${f}.glb: HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          this.bytes += buf.byteLength;
          const gltf = await loader.parseAsync(buf, this.base());
          // the loader makes repeated node names unique (pelvis, pelvis_1...); several skeletons share
          // one file, and the animation tracks need the original bone names back
          const json = gltf.parser.json, renamed = new Map();
          gltf.scene.traverse((o) => {
            const a = gltf.parser.associations.get(o);
            if (!a || a.nodes === undefined || !json.nodes[a.nodes].name) return;
            const orig = THREE.PropertyBinding.sanitizeNodeName(json.nodes[a.nodes].name);
            if (o.name !== orig) { renamed.set(o.name, orig); o.name = orig; }
          });
          // ...and the clips were bound to the made-up names, so point their tracks back too
          for (const clip of gltf.animations) for (const t of clip.tracks) {
            const dot = t.name.indexOf('.'), n = t.name.slice(0, dot);
            if (renamed.has(n)) t.name = renamed.get(n) + t.name.slice(dot);
          }
          for (const node of gltf.scene.children) {
            node.updateMatrixWorld(true);
            this.models.set(node.name, node);
          }
          for (const clip of gltf.animations) this.clips.set(clip.name, clip);
          done++;
          if (onProgress) onProgress(done / FILES.length);
        }));
        const tl = new THREE.TextureLoader();
        await Promise.all(['skin_male_light', 'skin_female_light'].map((n) => new Promise((res, rej) => tl.load(this.base() + n + '.webp', (t) => {
          t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; this.textures.set(n, t); res();
        }, undefined, rej))));
        this.prepare();
        this.ready = true;
        return true;
      } catch (e) {
        console.warn('[assets] falling back to procedural models:', e.message || e);
        this.failed = true;
        return false;
      }
    })();
    return this._promise;
  },

  prepare() {
    for (const node of this.models.values()) {
      node.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (m.map) m.map.anisotropy = 4;
          // the packs were authored for engines with stronger ambient light; lift them a touch
          if (m.metalness > 0.6 && !m.metalnessMap) m.metalness = 0.6;
        }
      });
    }
  },

  has(name) { return this.ready && this.models.has(name); },

  // A fresh copy of a named model. Skinned models get their own skeleton.
  instance(name) {
    const src = this.models.get(name);
    if (!src) return null;
    let skinned = false;
    src.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
    const c = skinned ? cloneSkinned(src) : src.clone(true);
    c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1);
    return c;
  },

  clip(name) { return this.clips.get(name) || null; },

  // Upper- and lower-body halves of a humanoid clip, so a character can run while aiming
  half(name, upper) {
    const key = name + (upper ? '^U' : '^L');
    if (this.split.has(key)) return this.split.get(key);
    const c = this.clips.get(name);
    if (!c) return null;
    const tracks = c.tracks.filter((t) => isUpper(t.name.split('.')[0]) === upper);
    const out = new THREE.AnimationClip(key, c.duration, tracks);
    this.split.set(key, out);
    return out;
  },

  // Bounding box of a model in its own space (for fitting props to collision boxes)
  bounds(name) {
    const m = this.models.get(name);
    if (!m) return null;
    if (!m.userData.box) { const b = new THREE.Box3().setFromObject(m); m.userData.box = b; }
    return m.userData.box;
  },
};
