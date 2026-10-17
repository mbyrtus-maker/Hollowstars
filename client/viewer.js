// Model viewer for checking the character assets: open the game with ?viewer=1
// (optionally &state=aim|walk|run|crouch|swing|drive|dead&cam=front|side|back|close)
import * as THREE from 'three';
import { Assets } from './render/assets.js';
import { AssetHumanoid } from './render/assethumanoid.js';
import { PLAYER_COLORS, BLADE_COLORS } from '../shared/config.js';

export async function runViewer(canvas, params) {
  document.querySelectorAll('.screen').forEach((e) => e.classList.add('hidden'));
  await Assets.load();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a3046);
  scene.add(new THREE.HemisphereLight(0xc8c0ff, 0x6a4a3a, 1.2));
  const sun = new THREE.DirectionalLight(0xffe0c0, 2.6); sun.position.set(-4, 8, -6); sun.castShadow = true;
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -2;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: 0x8a6448, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const set = (params.get('set') || 'crew');
  if (set === 'models') {
    // every named model from one pack prefix, laid out on a grid with its bounds
    const pre = params.get('pre') || 'Gun';
    const names = [...Assets.models.keys()].filter((n) => n.startsWith(pre));
    const cols = Math.ceil(Math.sqrt(names.length * 2));
    const cell = +(params.get('cell') || 1.2);
    names.forEach((n, i) => {
      const m = Assets.instance(n);
      const g = new THREE.Group(); g.add(m);
      const box = new THREE.Box3().setFromObject(m);
      const sz = box.getSize(new THREE.Vector3());
      const fit = cell * 0.85 / Math.max(sz.x, sz.y, sz.z, 0.01);
      g.scale.setScalar(+(params.get('raw') || 0) ? 1 : fit);
      g.position.set((i % cols - cols / 2) * cell, 0.2 + Math.floor(i / cols) * cell * 0.9, 0);
      scene.add(g);
      g.add(new THREE.AxesHelper(0.5 / fit));
      console.log(n, sz.toArray().map((v) => v.toFixed(2)).join(' '));
    });
    const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
    cam.position.set(0, cols * cell * 0.45, -cols * cell * 1.1); cam.lookAt(0, cols * cell * 0.35, 0);
    window.__viewer = { scene, Assets };
    const loop = () => { requestAnimationFrame(loop); renderer.render(scene, cam); };
    loop();
    return;
  }
  const lineup = {
    crew: [['player', { cls: 'warden' }], ['player', { cls: 'gunslinger' }], ['player', { cls: 'soldier' }], ['player', { cls: 'medic' }], ['player', { cls: 'spy' }], ['player', { cls: 'sniper' }]],
    adv: [['player', { cls: 'warden', adv: 'guardian', branch: 'sentinel' }], ['player', { cls: 'gunslinger', adv: 'bounty', branch: 'gunfighter' }], ['player', { cls: 'soldier', adv: 'commando', branch: 'heavy' }], ['player', { cls: 'medic', adv: 'surgeon', branch: 'toxin' }], ['player', { cls: 'spy', adv: 'agent', branch: 'infiltrator' }], ['player', { cls: 'sniper', adv: 'phantom', branch: 'wraith' }]],
    town: [['lancer', {}], ['officer', {}], ['civilian', { role: 1 }], ['civilian', { role: 2 }], ['civilian', { role: 3 }], ['merchant', {}], ['civilian', {}], ['prisoner', {}]],
  }[set];
  const state = params.get('state') || 'idle';
  const people = lineup.map(([type, o], i) => {
    const h = new AssetHumanoid(type, { variant: 11 + i * 7, color: PLAYER_COLORS[i % 4], bladeColor: BLADE_COLORS[i % 4], colorIdx: i % 4, ...o });
    h.root.position.set((i - (lineup.length - 1) / 2) * 1.4, 0, 0);
    scene.add(h.root);
    return h;
  });
  const cam = new THREE.PerspectiveCamera(+(params.get('fov') || 35), innerWidth / innerHeight, 0.1, 100);
  const view = params.get('cam') || 'front';
  const span = lineup.length * 1.4;
  if (view === 'front') cam.position.set(0, 1.4, -span * 1.15 - 2);
  else if (view === 'back') cam.position.set(0, 1.4, span * 1.15 + 2);
  else if (view === 'side') cam.position.set(span + 3, 1.4, -2);
  else cam.position.set(-span / 2 + 0.7, 1.6, -3.2);
  cam.lookAt(view === 'close' ? -span / 2 + 0.7 : 0, view === 'close' ? 1.3 : 0.95, 0);
  if (params.get('focus') != null) {
    // close-up on two neighbours from three quarters
    const i = +params.get('focus'), x = (i - (lineup.length - 1) / 2) * 1.4 + 0.7;
    const ang = +(params.get('ang') || 0.5);
    cam.position.set(x + Math.sin(ang) * 3.6, 1.35, -Math.cos(ang) * 3.6);
    cam.lookAt(x, 1.0, 0);
  }
  const swingEvery = 0.8;
  let t = 0, last = performance.now(), swing = 0, st = 0;
  window.__viewer = { people, scene };
  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt; st += dt;
    if (st > swingEvery) { st = 0; swing++; }
    for (const h of people) {
      const s = { speed: 0, pitch: 0, drawn: state !== 'idle' && state !== 'walk' && state !== 'run', weapon: h.weaponKind };
      if (state === 'walk') s.speed = 1.4;
      if (state === 'run') s.speed = 6;
      if (state === 'crouch') { s.crouch = true; s.speed = 1.2; }
      if (state === 'aim') { s.aim = true; s.pitch = +(params.get('pitch') || 0); }
      if (state === 'swing') s.swing = swing;
      if (state === 'drive') s.driving = true;
      if (state === 'dead') s.dead = true;
      if (state === 'downed') s.downed = true;
      if (h.type === 'lancer' || h.type === 'officer') { s.weapon = 'blaster'; s.drawn = true; s.lowReady = state !== 'aim'; }
      if (params.get('clip')) { h.both(params.get('clip'), 0); h.mixer.update(dt); } else h.update(dt, s, t);
    }
    renderer.render(scene, cam);
  };
  loop();
}
