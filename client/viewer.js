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
  if (set === 'heads') {
    // headgear audit: every class, advanced class, branch and townsperson, as a man and a woman, in
    // pages of eight head-and-shoulders portraits. window.__heads.show(page, angle) re-poses the row.
    const looks = [];
    for (const cls of ['warden', 'gunslinger', 'soldier', 'medic', 'spy', 'sniper']) looks.push(['player', { cls }, cls]);
    const ADV = { warden: 'guardian', gunslinger: 'bounty', soldier: 'commando', medic: 'surgeon', spy: 'agent', sniper: 'phantom' };
    const BR = { guardian: ['sentinel', 'duelist'], bounty: ['manhunter', 'gunfighter'], commando: ['vanguard', 'heavy'], surgeon: ['lifeline', 'toxin'], agent: ['infiltrator', 'saboteur'], phantom: ['wraith', 'longshot'] };
    for (const [cls, adv] of Object.entries(ADV)) { looks.push(['player', { cls, adv }, adv]); for (const b of BR[adv]) looks.push(['player', { cls, adv, branch: b }, b]); }
    for (const t of ['lancer', 'officer', 'merchant', 'prisoner', 'informant']) looks.push([t, {}, t]);
    for (let role = 0; role <= 5; role++) for (const k of [0, 1]) looks.push(['civilian', { role, salt: k }, `civ${role}${k ? 'b' : ''}`]);
    // a man and a woman of each: search variants until the pack body comes out that sex
    const cast = [];
    for (const [type, o, label] of looks) for (const sex of ['m', 'f']) {
      for (let v = 1 + (o.salt || 0) * 50; v < 400; v++) { const h = new AssetHumanoid(type, { variant: v, color: '#3fb6ff', colorIdx: 0, ...o }); if (h.sex === sex) { cast.push({ h, label: label + ' ' + sex }); break; } }
    }
    const cam = new THREE.PerspectiveCamera(13, innerWidth / innerHeight, 0.1, 100);
    let shown = [];
    const PER = 4;
    // left to right on screen in cast order (the camera looks along +Z, so screen-right is -X)
    const show = (page, ang = 0) => {
      for (const c of shown) scene.remove(c.h.root);
      shown = cast.slice(page * PER, page * PER + PER);
      shown.forEach((c, i) => { c.h.root.position.set(((PER - 1) / 2 - i) * 0.75, 0, 0); c.h.root.rotation.y = ang; scene.add(c.h.root); });
      cam.position.set(0, 1.6, -3.4); cam.lookAt(0, 1.53, 0);
      return shown.map((c) => c.label);
    };
    window.__heads = { show, pages: Math.ceil(cast.length / PER), labels: cast.map((c) => c.label) };
    show(0);
    window.__viewer = { scene, Assets };
    let last = performance.now();
    const loop = () => { requestAnimationFrame(loop); const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now; for (const c of shown) c.h.update(dt, { speed: 0 }, now / 1000); renderer.render(scene, cam); };
    loop();
    return;
  }
  if (set === 'bike') {
    // speeder bikes in a few paints, one with a rider: &ang=0.8&dist=6
    const { makeSpeeder } = await import('./render/models.js');
    const paints = [[0x3fb6ff, 0x2a2c32], [0xb8a27e, 0xa04a3a], [0x7a8e9a, 0xc98d2e], [0xd8d2c4, 0x3a4a6a]];
    const hover = +(params.get('hover') || 0.62);
    let rider = null;
    paints.forEach(([c, v], i) => {
      const b = makeSpeeder(c, v);
      b.position.set((i - 1.5) * 2.2, hover, 0);
      b.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(b);
      if (i === 1) {
        rider = new AssetHumanoid('player', { variant: 5, color: '#ff7a3a', colorIdx: 1, cls: 'soldier' });
        rider.root.position.set(b.position.x, hover + 0.18, 0);
        scene.add(rider.root);
      }
    });
    const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
    const a = +(params.get('ang') || 0.8), r = +(params.get('dist') || 7.5), fx = +(params.get('fx') || 0);
    cam.position.set(fx + Math.sin(a) * r, +(params.get('h') || 2.2), -Math.cos(a) * r); cam.lookAt(fx, 0.7, 0);
    window.__viewer = { scene, Assets };
    let last = performance.now();
    const loop = () => { requestAnimationFrame(loop); const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now; rider.update(dt, { driving: true }, now / 1000); renderer.render(scene, cam); };
    loop();
    return;
  }
  if (set === 'one') {
    // one model at a set length, orbited: &name=...&len=12&ang=0.8&h=4
    const m = Assets.instance(params.get('name'));
    const box = new THREE.Box3().setFromObject(m), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const len = +(params.get('len') || 12), k = len / Math.max(sz.x, sz.z);
    const g = new THREE.Group(); g.add(m); m.position.set(-c.x, -box.min.y, -c.z); g.scale.setScalar(k); scene.add(g);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
    const a = +(params.get('ang') || 0.8), r = len * 1.35;
    cam.position.set(Math.sin(a) * r, +(params.get('h') || len * 0.35), -Math.cos(a) * r); cam.lookAt(0, sz.y * k * 0.4, 0);
    window.__viewer = { scene, Assets };
    const loop = () => { requestAnimationFrame(loop); renderer.render(scene, cam); };
    loop();
    return;
  }
  if (set === 'models') {
    // every named model from one pack prefix, laid out on a grid with its bounds
    const pre = params.get('pre') || 'Gun';
    const only = params.get('only');
    const names = only ? only.split(',') : [...Assets.models.keys()].filter((n) => n.startsWith(pre));
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
    if (params.get('ang') != null) {
      // orbit the grid from a three-quarter view
      const a = +params.get('ang'), r = cols * cell * 1.3 + 1, h = +(params.get('h') || cols * cell * 0.6);
      cam.position.set(Math.sin(a) * r, h, -Math.cos(a) * r); cam.lookAt(0, cell * 0.4, 0);
    }
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
    const ang = +(params.get('ang') || 0.5), dist = +(params.get('dist') || 3.6), ly = +(params.get('ly') || 1.0);
    cam.position.set(x + Math.sin(ang) * dist, ly + 0.35, -Math.cos(ang) * dist);
    cam.lookAt(x, ly, 0);
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
