// Scene construction: sky, terrain, merged static geometry, garrison props, lamps, post.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { heightfield, HF_N, HF_CELL, WORLD_HALF, MAT, SUN_DIR, terrainHeight, roadDistance } from '../../shared/world.js';
import { fbm, mulberry32, smoothstep, clamp, dist2 } from '../../shared/math.js';
import { mat, glowMat } from './models.js';
import { textures, applyWorldUV, repeated, setAnisotropy } from './textures.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { makeWayfarer, makeNpcShip } from './ship.js';
import { padState } from '../../shared/spaceport.js';
import { Assets } from './assets.js';
import { ModelBatch, animatedProp, pick, hash, kitAnimated } from './props.js';

export const MAT_COLORS = {
  [MAT.ADOBE]: 0xc99a6a, [MAT.ADOBE_DARK]: 0xa8774f, [MAT.METAL]: 0xb6b9c1, [MAT.METAL_DARK]: 0x4a4e5a, [MAT.CRATE]: 0x7d6a4e,
  [MAT.ROCK]: 0x8b5e48, [MAT.CLOTH]: 0xb8473a, [MAT.CONCRETE]: 0x8d8884, [MAT.RED]: 0xa3243a, [MAT.LAMP]: 0xffcf8a, [MAT.WOOD]: 0x6e4a30,
  [MAT.FUEL]: 0xd9a62e, [MAT.DOOR]: 0x5d6270, [MAT.FLOOR]: 0x5e4636, [MAT.HULL]: 0x9aa3ad, [MAT.SCREEN]: 0x6fe0ff, [MAT.BARS]: 0x3a3d45,
  [MAT.CLOTH2]: 0x3f7f8a, [MAT.CLOTH3]: 0xc98d2e,
};
const LAMP_COLORS = { warm: 0xffb060, cool: 0xa8d8ff, flood: 0xe8f2ff };

export function createScene(canvas, world, look) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  setAnisotropy(renderer.capabilities.getMaxAnisotropy());
  const T = textures();
  console.log(`[hollow-stars] textures generated in ${T.ms}ms`);
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0x7a4656);
  scene.fog = new THREE.FogExp2(fogColor, 0.0034);
  scene.background = fogColor;
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 2200);
  scene.add(camera);

  // ---- lights
  const hemi = new THREE.HemisphereLight(0x8a76c8, 0x6a3e2a, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffa25a, 2.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // ---- sky
  const sky = makeSky();
  scene.add(sky);

  // ---- lamps: a pool of real point lights near the camera
  const lampPool = [];
  for (let i = 0; i < 10; i++) {
    const l = new THREE.PointLight(0xffb060, 0, 16, 1.6);
    scene.add(l);
    lampPool.push(l);
  }
  const alarmLights = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xff1a2a, 0, 40, 1.4);
    scene.add(l);
    alarmLights.push(l);
  }
  const fireLight = new THREE.PointLight(0xff8a3a, 0, 14, 1.5);
  scene.add(fireLight);

  // ---- post
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Scrub NaN/Inf pixels (from grazing flat-shaded triangles) so bloom can't smear them across the frame
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        bool bad = any(isnan(c)) || any(isinf(c)) || !(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b);
        gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : min(c, vec4(48.0)); }`,
  }));
  const gtao = new GTAOPass(scene, camera, Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(gtao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.7, 0.55, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let useBloom = true;

  // ---- everything that belongs to one planet lives in worldGroup and is rebuilt on arrival
  let W = null, L = null, worldGroup = null, weather = null, envTex = null, water = null, fires = [], nodes = null, traders = [], propAnims = [];
  let lampT = 0;

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) if (!m.userData.cached) m.dispose();
    });
  }

  function applyLook(look) {
    L = look;
    fogColor.setHex(look.fog);
    scene.fog.color.copy(fogColor);
    scene.fog.density = look.fogDensity;
    hemi.color.setHex(look.hemi[0]); hemi.groundColor.setHex(look.hemi[1]); hemi.intensity = look.hemi[2];
    sun.color.setHex(look.sun[0]); sun.intensity = look.sun[1];
    renderer.toneMappingExposure = look.exposure;
    const u = sky.material.uniforms, k = look.sky;
    for (const n of ['zenith', 'mid', 'horizon', 'glow', 'cloud', 'cloudLit', 'below']) u['u' + n[0].toUpperCase() + n.slice(1)].value.set(...k[n]);
    u.uStars.value = k.stars; u.uMoons.value = k.moons; u.uCloudAmt.value = k.cloudAmt;
    // Image-based lighting captured from this world's sky, so metal and armour pick up its colours
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(sky.geometry, sky.material));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 24), new THREE.MeshBasicMaterial({ color: look.ground }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -40;
    envScene.add(ground);
    const pm = new THREE.PMREMGenerator(renderer);
    if (envTex) envTex.dispose();
    envTex = pm.fromScene(envScene, 0, 1, 3000).texture;
    scene.environment = envTex;
    scene.environmentIntensity = look.env;
    pm.dispose();
    ground.geometry.dispose(); ground.material.dispose();
  }

  function loadWorld(world, look) {
    if (worldGroup) { scene.remove(worldGroup); disposeGroup(worldGroup); }
    W = world;
    applyLook(look);
    worldGroup = new THREE.Group();
    worldGroup.add(makeTerrain(T, world, look));
    worldGroup.add(makeScatter(world, T, look));
    worldGroup.add(buildStatics(world, T).group);
    api.doors = makeDoors(world, T, worldGroup);
    api.destructibles = makeDestructibles(world, T, worldGroup);
    worldGroup.add(makeLampHalos(world));
    const decor = makeDecor(world, look);
    worldGroup.add(decor.group);
    api.ship = decor.ship;
    fires = decor.fires;
    propAnims = decor.anims || [];
    if (Assets.ready) worldGroup.add(makeSkyPlanets(world, look));
    nodes = makeNodes(world);
    worldGroup.add(nodes.group);
    traders = world.pads.map((pad, i) => {
      const g = new THREE.Group();
      const ships = {};
      // couriers and pilgrim landers fly Space Kit hulls when the models are loaded
      const KIT = { skiff: [['SK_Spaceship_FernandoTheFlamingo', 13], ['SK_Spaceship_RaeTheRedPanda', 11]], lander: [['SK_Spaceship_BarbaraTheBee', 15], ['SK_Spaceship_FinnTheFrog', 15]] };
      for (const type of ['hauler', 'skiff', 'lander']) {
        const k = KIT[type] && Assets.ready ? KIT[type][i % 2] : null;
        ships[type] = (k && makeKitShip(k[0], k[1])) || makeNpcShip(type);
        ships[type].group.visible = false; g.add(ships[type].group);
      }
      worldGroup.add(g);
      return { pad, ships };
    });
    water = null;
    if (world.water != null) {
      const wm = new THREE.MeshStandardMaterial({ color: 0x2c4636, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.86 });
      water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, 1, 1), wm);
      water.rotation.x = -Math.PI / 2; water.position.y = world.water;
      water.receiveShadow = true;
      worldGroup.add(water);
    }
    weather = look.weather ? makeWeather(look.weather) : null;
    if (weather) worldGroup.add(weather.points);
    const gr = world.regions.garrison;
    const spots = gr ? [[gr.minX + 10, (gr.minZ + gr.maxZ) / 2], [gr.maxX - 10, (gr.minZ + gr.maxZ) / 2], [(gr.minX + gr.maxX) / 2, gr.minZ + 10], [(gr.minX + gr.maxX) / 2, gr.maxZ - 10]] : [];
    alarmLights.forEach((l, i) => { const p = spots[i]; l.visible = !!p; if (p) l.position.set(p[0], terrainHeight(p[0], p[1]) + 8, p[1]); });
    scene.add(worldGroup);
    if (!renderer.shadowMap.enabled) api.setShadows(false);
    api.alarm = false;
    lampT = 0;
  }

  const api = {
    renderer, scene, camera, composer, sun, doors: {}, destructibles: {}, alarm: false, ship: null, loadWorld,
    setBloom(v) { useBloom = v; bloom.enabled = v; },
    setAO(v) { gtao.enabled = v; },
    setShadows(v) { renderer.shadowMap.enabled = v; sun.castShadow = v; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); },
    resize() {
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      composer.setSize(window.innerWidth, window.innerHeight);
      bloom.setSize(window.innerWidth / 2, window.innerHeight / 2);
      gtao.setSize(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    },
    update(dt, t, focus) {
      // Shadow frustum follows the player, snapped to texels to avoid shimmer
      const snap = 140 / 2048;
      const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
      sun.position.set(fx + SUN_DIR.x * 200, focus.y + SUN_DIR.y * 200, fz + SUN_DIR.z * 200);
      sun.target.position.set(fx, focus.y, fz);
      sky.position.copy(camera.position);
      sky.material.uniforms.uTime.value = t;
      // nearest lamps get real lights
      lampT -= dt;
      if (lampT <= 0) {
        lampT = 0.35;
        const near = W.lamps.map((l) => [l, dist2(l.x, l.z, camera.position.x, camera.position.z)]).sort((a, b) => a[1] - b[1]).slice(0, lampPool.length);
        lampPool.forEach((pl, i) => {
          const n = near[i];
          if (!n || n[1] > 90) { pl.intensity = 0; return; }
          const l = n[0];
          pl.color.setHex(LAMP_COLORS[l.color] || 0xffb060);
          pl.position.set(l.x, l.y - 0.4, l.z);
          pl.distance = l.r * 1.9;
          pl.intensity = l.inside ? 55 : l.color === 'flood' ? 34 : 24;
        });
      }
      // camp fires flicker; the nearest gets a real light
      let bestF = null, bd = 60;
      for (const f of fires) {
        const k = 0.85 + Math.sin(t * 11 + f.seed) * 0.08 + Math.sin(t * 23 + f.seed * 3) * 0.06;
        f.flames.forEach((m, i) => { m.scale.set(1, k * (1 - i * 0.15) + Math.sin(t * 9 + i) * 0.06, 1); m.rotation.y = t * (0.6 + i * 0.3); });
        const d = dist2(f.x, f.z, camera.position.x, camera.position.z);
        if (d < bd) { bd = d; bestF = [f, k]; }
      }
      if (bestF) { fireLight.position.set(bestF[0].x, bestF[0].y + 1.2, bestF[0].z); fireLight.intensity = 30 * bestF[1]; } else fireLight.intensity = 0;
      // doors slide
      for (const d of Object.values(api.doors)) {
        d.open += (d.target - d.open) * Math.min(1, dt * 4);
        if (d.gate) d.group.position.y = d.base.y + d.open * (d.h - 0.4);
        else if (d.axis === 'x') d.group.position.x = d.base.x + d.open * d.w * 0.95;
        else d.group.position.z = d.base.z + d.open * d.dd * 0.95;
        if (d.light) d.light.material.color.setHex(d.target ? 0x40ff70 : 0xff3344).multiplyScalar(3);
      }
      for (const d of Object.values(api.destructibles)) {
        if (d.kind === 'mast') {
          d.group.userData.beacon.visible = !d.destroyed && Math.sin(t * 4) > 0;
          if (d.destroyed && d.fall < 1) { d.fall = Math.min(1, d.fall + dt * 0.6); d.group.userData.lat.rotation.z = -d.fall * d.fall * 1.45; }
        }
      }
      alarmLights.forEach((l, i) => { l.intensity = api.alarm && l.visible ? (Math.sin(t * 7 + i * 1.6) > 0 ? 120 : 10) : 0; });
      if (weather) weather.update(dt, t, camera.position);
      if (api.serverTime != null) updateTraders(traders, api.serverTime, t);
      for (const m of propAnims) m.update(dt);
      if (nodes) nodes.update(t);
      if (water) water.material.opacity = 0.84 + Math.sin(t * 0.7) * 0.02;
    },
    render() { if (useBloom || gtao.enabled) composer.render(); else renderer.render(scene, camera); },
    setDoor(id, open) { if (api.doors[id]) api.doors[id].target = open ? 1 : 0; },
    setDepleted(ids) { if (nodes) nodes.setDepleted(ids); },
    serverTime: null,
    setDestroyed(id, v) {
      const d = api.destructibles[id];
      if (!d || d.destroyed === v) return;
      d.destroyed = v;
      if (d.kind === 'tank') {
        d.group.userData.parts.forEach((p) => { p.material = v ? mat(0x2a2220, { rough: 0.95 }) : p.userData.orig || p.material; });
        d.group.userData.parts[0].scale.y = v ? 0.45 : 1;
        d.group.userData.parts[0].position.y = v ? 1.2 : 2.5;
        d.group.userData.parts[1].visible = !v;
      }
      if (!v && d.kind === 'mast') { d.fall = 0; d.group.userData.lat.rotation.z = 0; }
    },
  };
  loadWorld(world, look);
  return api;
}

// ------------------------------------------------------------------ doors & destructibles

function makeDoors(world, T, parent) {
  const doors = {};
  for (const d of Object.values(world.doors)) {
    const b = world.boxes[d.boxId];
    const w = b.maxX - b.minX, h = b.maxY - b.minY, dd = b.maxZ - b.minZ;
    const g = new THREE.Group();
    const isBars = d.id === 'cell' || d.id === 'pen';
    const dg = applyWorldUV(new THREE.BoxGeometry(w, h, dd), 3);
    const m = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ color: isBars ? MAT_COLORS[MAT.BARS] : d.id === 'gate' ? 0x6a6f7c : d.id === 'vault' ? 0x8a96a4 : MAT_COLORS[MAT.DOOR], metalness: 0.5, roughness: 1, ...T.metal }));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    // status light
    const light = new THREE.Mesh(new THREE.BoxGeometry(d.axis === 'x' ? 0.3 : 0.08, 0.12, d.axis === 'x' ? 0.08 : 0.3), glowMat(0xff3344, 3));
    light.position.y = h / 2 - 0.25;
    if (d.axis === 'x') light.position.z = dd / 2 + 0.05; else light.position.x = dd > 0 ? -w / 2 - 0.05 : 0;
    if (d.req) g.add(light);
    if (d.id === 'gate') {
      for (let i = -2; i <= 2; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.25, 0.3), mat(0xa3243a)); s.position.set(0, i * 0.9, (i % 2) * 2); g.add(s); }
    }
    g.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    parent.add(g);
    doors[d.id] = { group: g, light, base: g.position.clone(), axis: d.axis, w, h, dd, open: d.open ? 1 : 0, target: d.open ? 1 : 0, gate: d.id === 'gate' };
  }
  return doors;
}

function makeDestructibles(world, T, parent) {
  const destructibles = {};
  for (const d of Object.values(world.destructibles)) {
    const g = new THREE.Group();
    g.position.set(d.x, d.y, d.z);
    if (d.kind === 'tank') {
      // fuel (Dusk), power cells (Thessaly) and cryo-coolant (Korrun) share a silhouette
      const tint = d.coolant ? [0xbfd8e8, 0x9ab8cc, 0x2a7aa8] : d.label === 'power cell' ? [0x58606a, 0x3a4048, 0x4ae08a] : [0xd9a62e, 0xc4922a, 0xa3243a];
      const tankTex = repeated(T.metal, 1.5);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 4.6, 24), new THREE.MeshStandardMaterial({ color: tint[0], metalness: 0.45, roughness: 1, ...tankTex }));
      tank.position.y = 2.5; tank.castShadow = true; tank.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.75, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(tint[1], { metal: 0.4 }));
      cap.position.y = 4.8; cap.castShadow = true;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.35, 14), d.label === 'power cell' ? glowMat(tint[2], 1.6) : mat(tint[2]));
      band.position.y = 3.3;
      const base = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.4, 3.8), mat(0x4a4e5a));
      base.position.y = 0.2;
      g.add(tank, cap, band, base);
      g.userData.parts = [tank, cap, band];
    } else {
      // comms mast: lattice + dish + beacon
      const lat = new THREE.Group();
      const m = mat(0x4a4e5a, { metal: 0.5 });
      for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 22, 0.18), m);
        leg.position.set(x, 11, z); leg.castShadow = true; lat.add(leg);
      }
      for (let y = 1.5; y < 22; y += 2.5) {
        for (const r of [0, Math.PI / 2]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.1), m);
          brace.position.y = y; brace.rotation.y = r; lat.add(brace);
          const brace2 = brace.clone(); brace2.position.z = r ? 0 : 0.9; brace2.position.x = r ? 0.9 : 0; lat.add(brace2);
        }
      }
      const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 6, 0, Math.PI * 2, 0, 1.0), mat(0xc9ccd3, { metal: 0.5 }));
      dish.material.side = THREE.DoubleSide;
      dish.position.set(0, 18, -1.2); dish.rotation.x = -1.2;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), glowMat(0xff2030, 4));
      beacon.position.y = 22.4;
      lat.add(dish, beacon);
      g.add(lat);
      g.userData.lat = lat;
      g.userData.beacon = beacon;
    }
    parent.add(g);
    destructibles[d.id] = { group: g, kind: d.kind, destroyed: false, fall: 0 };
  }
  // remember original tank materials for reset
  for (const d of Object.values(destructibles)) if (d.kind === 'tank') d.group.userData.parts.forEach((p) => { p.userData.orig = p.material; });
  return destructibles;
}

// ------------------------------------------------------------------ weather

function makeWeather(kind) {
  const snow = kind === 'snow';
  const N = snow ? 2600 : 700, R = 38, H = 26;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  const rng = mulberry32(kind.length * 77);
  for (let i = 0; i < N; i++) { pos[i * 3] = (rng() - 0.5) * R * 2; pos[i * 3 + 1] = rng() * H; pos[i * 3 + 2] = (rng() - 0.5) * R * 2; seed[i] = rng(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const x = cv.getContext('2d');
  const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  const m = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(cv), size: snow ? 0.16 : 0.12, transparent: true, depthWrite: false, opacity: snow ? 0.85 : 0.9,
    color: snow ? 0xffffff : new THREE.Color(0xc8ff9a).multiplyScalar(2.2), blending: snow ? THREE.NormalBlending : THREE.AdditiveBlending, toneMapped: !snow ? false : true,
  });
  const points = new THREE.Points(geo, m);
  points.frustumCulled = false;
  const centre = new THREE.Vector3();
  return {
    points,
    update(dt, t, cam) {
      // particles live in a box that wraps around the camera
      centre.copy(cam);
      for (let i = 0; i < N; i++) {
        const s = seed[i];
        let px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
        if (snow) { py -= (1.6 + s * 1.4) * dt; px += (Math.sin(t * 0.7 + s * 30) * 0.6 + 1.1) * dt; pz += Math.cos(t * 0.5 + s * 20) * 0.4 * dt; }
        else { py += Math.sin(t * 0.6 + s * 40) * 0.25 * dt + 0.08 * dt; px += Math.sin(t * 0.3 + s * 17) * 0.4 * dt; pz += Math.cos(t * 0.35 + s * 11) * 0.4 * dt; }
        // wrap relative to the camera
        const rx = px - centre.x, rz = pz - centre.z, ry = py - (centre.y - 6);
        if (rx > R) px -= R * 2; else if (rx < -R) px += R * 2;
        if (rz > R) pz -= R * 2; else if (rz < -R) pz += R * 2;
        if (ry < 0) py += H; else if (ry > H) py -= H;
        pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ sky

function makeSky() {
  const geo = new THREE.SphereGeometry(1500, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uSun: { value: new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z) }, uTime: { value: 0 },
      uZenith: { value: new THREE.Vector3(0.035, 0.025, 0.11) }, uMid: { value: new THREE.Vector3(0.19, 0.09, 0.27) }, uHorizon: { value: new THREE.Vector3(0.55, 0.27, 0.32) },
      uGlow: { value: new THREE.Vector3(1.0, 0.52, 0.22) }, uCloud: { value: new THREE.Vector3(0.36, 0.22, 0.38) }, uCloudLit: { value: new THREE.Vector3(1.0, 0.6, 0.38) },
      uBelow: { value: new THREE.Vector3(0.3, 0.17, 0.2) }, uStars: { value: 1 }, uMoons: { value: 1 }, uCloudAmt: { value: 0.7 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uSun; uniform float uTime;
      uniform vec3 uZenith, uMid, uHorizon, uGlow, uCloud, uCloudLit, uBelow; uniform float uStars, uMoons, uCloudAmt;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float sunAmt = max(dot(d, normalize(uSun)), 0.0);
        vec3 zenith = uZenith, mid = uMid, horizon = uHorizon, glowC = uGlow;
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, zenith, smoothstep(0.2, 0.75, h));
        col += glowC * pow(sunAmt, 6.0) * 0.9 * (1.0 - smoothstep(0.0, 0.5, h));
        col += glowC * pow(sunAmt, 2.0) * 0.25 * (1.0 - smoothstep(-0.1, 0.35, h));
        col += vec3(1.0, 0.8, 0.55) * smoothstep(0.9988, 0.9996, sunAmt) * 1.6;
        // high wispy clouds catching the last light
        if (h > 0.0) {
          vec2 cp = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, 0.0);
          float cn = 0.0, ca = 0.5;
          for (int i = 0; i < 5; i++) { vec3 q = vec3(cp * 1.7, 0.0); vec2 f = fract(cp); vec2 ip = floor(cp);
            float a = hash(vec3(ip, 1.0)), b = hash(vec3(ip + vec2(1.0, 0.0), 1.0)), c2 = hash(vec3(ip + vec2(0.0, 1.0), 1.0)), dd = hash(vec3(ip + 1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            cn += mix(mix(a, b, u.x), mix(c2, dd, u.x), u.y) * ca; ca *= 0.5; cp *= 2.03; }
          float cloud = smoothstep(0.52, 0.82, cn) * smoothstep(0.02, 0.18, h) * (1.0 - smoothstep(0.35, 0.8, h));
          vec3 cloudC = mix(uCloud, uCloudLit, pow(sunAmt, 3.0) * 0.9 + 0.15);
          col = mix(col, cloudC, cloud * uCloudAmt);
        }
        if (h < 0.0) col = mix(horizon * 0.9, uBelow, smoothstep(0.0, -0.2, h));
        // stars
        vec3 sp = floor(d * 380.0);
        float s = hash(sp);
        float star = step(0.9965, s) * smoothstep(0.08, 0.45, h) * (0.6 + 0.4 * sin(uTime * 2.0 + s * 100.0));
        col += vec3(star) * uStars;
        // twin moons
        vec3 m1 = normalize(vec3(0.45, 0.42, -0.79));
        float md = dot(d, m1);
        col = mix(col, vec3(0.92, 0.86, 0.8), smoothstep(0.99935, 0.99955, md) * uMoons);
        col += vec3(0.5, 0.45, 0.5) * pow(max(md, 0.0), 400.0) * 0.4 * uMoons;
        vec3 m2 = normalize(vec3(0.62, 0.3, -0.73));
        float md2 = dot(d, m2);
        col = mix(col, vec3(0.75, 0.62, 0.7), smoothstep(0.99985, 0.99992, md2) * uMoons);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------ terrain

function makeTerrain(T, world, look) {
  const P = look.terrain;
  const hf = heightfield();
  const W = HF_N + 1;
  const pos = new Float32Array(W * W * 3);
  const col = new Float32Array(W * W * 3);
  const sandL = new THREE.Color(P.hi), sandD = new THREE.Color(P.lo), rock = new THREE.Color(P.rock), rockHi = new THREE.Color(P.rockHi);
  const road = new THREE.Color(P.road), packed = new THREE.Color(P.packed), snow = new THREE.Color(0xf4f8fc), mud = new THREE.Color(0x2e3622), ice = new THREE.Color(0xa8d4ec);
  const zones = world.zones;
  const c = new THREE.Color();
  for (let iz = 0; iz < W; iz++) for (let ix = 0; ix < W; ix++) {
    const i = iz * W + ix;
    const x = -WORLD_HALF + ix * HF_CELL, z = -WORLD_HALF + iz * HF_CELL;
    const h = hf[i];
    pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
    const n = fbm(x / 25, z / 25, 3, 5) * 0.5 + 0.5;
    c.copy(sandD).lerp(sandL, n);
    const hx = terrainHeight(x + 2, z) - terrainHeight(x - 2, z), hz = terrainHeight(x, z + 2) - terrainHeight(x, z - 2);
    const slope = Math.hypot(hx, hz) / 4;
    c.lerp(rock, smoothstep(0.35, 0.8, slope));
    c.lerp(rockHi, smoothstep(30, 70, h) * 0.8);
    if (P.snowAbove) { c.lerp(snow, (1 - smoothstep(0.25, 0.6, slope)) * 0.7 * n + 0.15); if (h < 3.2) c.lerp(ice, (1 - smoothstep(2.2, 3.2, h)) * 0.85); }
    if (world.water != null) c.lerp(mud, 1 - smoothstep(world.water - 0.2, world.water + 0.9, h));
    const rd = roadDistance(x, z);
    c.lerp(road, (1 - smoothstep(2.5, 7, rd)) * 0.75);
    for (const zn of zones) if (dist2(x, z, zn.x, zn.z) < zn.r + 2) { c.lerp(packed, 0.35); break; }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const idx = [];
  for (let iz = 0; iz < HF_N; iz++) for (let ix = 0; ix < HF_N; ix++) {
    const a = iz * W + ix, b = iz * W + ix + 1, cc = (iz + 1) * W + ix, d = (iz + 1) * W + ix + 1;
    // (0,0)(0,1)(1,0) and (1,0)(0,1)(1,1) in (ix,iz) => a, c, b and b, c, d
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  // Sand on flats, triplanar rock on slopes, each with its own normal detail.
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tSand: { value: T.sand.map }, tSandN: { value: T.sand.normalMap }, tRock: { value: T.rock.map }, tRockN: { value: T.rock.normalMap } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform sampler2D tSand, tSandN, tRock, tRockN;
        float tRockAmt; vec3 tBW; vec2 tUvS;`)
      .replace('#include <map_fragment>', `
        vec3 nW = normalize(vWNrm);
        float slope = 1.0 - nW.y;
        tUvS = vWPos.xz / 3.2;
        vec3 sandA = texture2D(tSand, tUvS).rgb;
        float macro = texture2D(tSand, vWPos.xz / 47.0 + 0.37).r;
        sandA *= mix(0.84, 1.1, macro);
        tBW = pow(abs(nW), vec3(4.0)); tBW /= dot(tBW, vec3(1.0));
        vec3 rockA = texture2D(tRock, vWPos.zy / 7.0).rgb * tBW.x + texture2D(tRock, vWPos.xz / 7.0).rgb * tBW.y + texture2D(tRock, vWPos.xy / 7.0).rgb * tBW.z;
        tRockAmt = smoothstep(0.2, 0.42, slope + (macro - 0.5) * 0.12);
        diffuseColor.rgb *= mix(sandA, rockA, tRockAmt);
      `)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 sN = texture2D(tSandN, tUvS).xyz * 2.0 - 1.0;
          vec3 rX = texture2D(tRockN, vWPos.zy / 7.0).xyz * 2.0 - 1.0;
          vec3 rY = texture2D(tRockN, vWPos.xz / 7.0).xyz * 2.0 - 1.0;
          vec3 rZ = texture2D(tRockN, vWPos.xy / 7.0).xyz * 2.0 - 1.0;
          vec3 rockP = vec3(0.0, rX.y, rX.x) * tBW.x + vec3(rY.x, 0.0, rY.y) * tBW.y + vec3(rZ.x, rZ.y, 0.0) * tBW.z;
          vec3 pert = mix(vec3(sN.x, 0.0, sN.y) * 0.8, rockP * 1.1, tRockAmt);
          vec3 nw2 = normalize(normalize(vWNrm) + pert);
          normal = normalize((viewMatrix * vec4(nw2, 0.0)).xyz);
        }
      `);
  };
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}

function makeScatter(world, T, look) {
  const C = look.scatter;
  const group = new THREE.Group();
  const rng = mulberry32(4242 + world.planet.length * 31);
  const rockG = new THREE.IcosahedronGeometry(0.5, 0);
  const shrubG = new THREE.IcosahedronGeometry(0.45, 0);
  const NR = Math.round(C.rocks * 1.9), NS = Math.round(C.shrubs * 1.9), NE = Math.round((C.reeds || 0) * 1.6);
  const rocks = new THREE.InstancedMesh(rockG, new THREE.MeshStandardMaterial({ color: C.rock, roughness: 1, flatShading: true, ...repeated(T.rock, 0.6) }), Math.max(1, NR));
  const shrubs = new THREE.InstancedMesh(shrubG, mat(C.shrub, { rough: 1 }), Math.max(1, NS));
  const reedG = new THREE.ConeGeometry(0.05, 1.6, 3); reedG.translate(0, 0.8, 0);
  const reeds = new THREE.InstancedMesh(reedG, mat(0x7a8a48, { rough: 1 }), Math.max(1, NE));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  let ri = 0, si = 0, ei = 0;
  const clear = (x, z) => world.zones.some((zn) => dist2(x, z, zn.x, zn.z) < zn.r + 6) || roadDistance(x, z) < 6;
  for (let k = 0; k < 20000 && (ri < NR || si < NS || ei < NE); k++) {
    const x = (rng() - 0.5) * 1050, z = (rng() - 0.5) * 900;
    if (clear(x, z)) continue;
    const y = terrainHeight(x, z);
    const r = rng();
    if (NE && ei < NE && world.water != null && y < world.water + 0.6 && y > world.water - 1.2) {
      // a clump of reeds at the waterline
      for (let n = 0; n < 5 && ei < NE; n++) {
        e.set((rng() - 0.5) * 0.4, rng() * 6, (rng() - 0.5) * 0.4); q.setFromEuler(e);
        const sz = 0.6 + rng() * 0.8;
        s.set(sz, sz * (0.8 + rng() * 0.6), sz);
        p.set(x + (rng() - 0.5) * 1.6, Math.max(y, world.water - 0.6), z + (rng() - 0.5) * 1.6);
        reeds.setMatrixAt(ei++, m4.compose(p, q, s));
      }
      continue;
    }
    e.set(rng() * 3, rng() * 3, rng() * 3);
    q.setFromEuler(e);
    if (r < 0.6 && ri < NR) {
      const sz = 0.3 + Math.pow(rng(), 3) * 2.2;
      s.set(sz * (0.8 + rng() * 0.6), sz * (0.5 + rng() * 0.5), sz * (0.8 + rng() * 0.6));
      p.set(x, y + sz * 0.15, z);
      rocks.setMatrixAt(ri++, m4.compose(p, q, s));
    } else if (si < NS && y < 25) {
      const sz = 0.5 + rng() * 0.9;
      s.set(sz, sz * 0.6, sz);
      p.set(x, y + sz * 0.15, z);
      shrubs.setMatrixAt(si++, m4.compose(p, q, s));
    }
  }
  rocks.count = ri; shrubs.count = si; reeds.count = ei;
  rocks.castShadow = true; rocks.receiveShadow = true; shrubs.receiveShadow = true; shrubs.castShadow = true;
  group.add(rocks, shrubs, reeds);
  return group;
}

// ------------------------------------------------------------------ statics

// Texture class, tile size (m) and bevel radius for each world material
const TEX_CLASS = {
  [MAT.ADOBE]: ['adobe', 3.4, 0.16], [MAT.ADOBE_DARK]: ['adobe', 3.4, 0.16], [MAT.METAL]: ['metal', 4, 0.03], [MAT.METAL_DARK]: ['metal', 4, 0.03],
  [MAT.HULL]: ['metal', 5, 0.08], [MAT.BARS]: ['metal', 2, 0], [MAT.RED]: ['metal', 4, 0.02], [MAT.CONCRETE]: ['concrete', 4, 0.04],
  [MAT.FLOOR]: ['wood', 3, 0], [MAT.WOOD]: ['wood', 2.2, 0.025], [MAT.CRATE]: ['crate', 0, 0.035], [MAT.CLOTH]: ['cloth', 1.6, 0],
  [MAT.CLOTH2]: ['cloth', 1.6, 0], [MAT.CLOTH3]: ['cloth', 1.6, 0], [MAT.FUEL]: ['metal', 3, 0.05],
};

// houses built from boxes but drawn as pack models (shared/packs.js), if every model they need loaded
function packSkinsReady(world) {
  if (world._skinsReady === undefined) world._skinsReady = Assets.ready && world.decor.every((d) => !d.fit || Assets.has(d.name));
  return world._skinsReady;
}

function buildStatics(world, T) {
  const group = new THREE.Group();
  const byClass = new Map();
  const glowBoxes = [];
  const c = new THREE.Color();
  const batch = new ModelBatch();
  const CRATES = ['Prop_Crate', 'Prop_Crate_Large', 'Prop_Crate_Tarp', 'MK_Prop_Crate3', 'MK_Prop_Crate4', 'Prop_Crate_Tarp_Large'];
  const skinned = packSkinsReady(world);
  for (const b of world.boxes) {
    if (!b.render) continue;
    if (b.skin && skinned) continue; // drawn by its pack model (makeDecor)
    if (b.tag === 'door' || b.tag === 'tank' || b.tag === 'mast' || b.mat === MAT.ROCK) continue;
    const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, cz = (b.minZ + b.maxZ) / 2;
    // crates become the packs' cargo crates when the models are loaded
    if (b.mat === MAT.CRATE && Assets.ready && batch.fit(pick(CRATES, b.id * 7 + 3), cx, b.minY, cz, w, h, d, Math.floor(hash(cx, cz) * 4) * Math.PI / 2)) continue;
    if (b.mat === MAT.LAMP || b.mat === MAT.SCREEN) {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(cx, cy, cz);
      glowBoxes.push([g, b.mat]);
      continue;
    }
    const [cls, scale, bevel] = TEX_CLASS[b.mat] || ['concrete', 4, 0];
    const r = Math.min(bevel, Math.min(w, h, d) * 0.3);
    let g = r > 0.01 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
    if (cls === 'crate') { g = g.toNonIndexed(); g.translate(cx, cy, cz); } // crates keep per-face UVs
    else { g.translate(cx, cy, cz); applyWorldUV(g, scale); }
    if (g.index) g = g.toNonIndexed();
    // per-box tint variation so merged buildings don't look flat
    const v = 0.92 + ((b.id * 9301 + 49297) % 233280) / 233280 * 0.16;
    c.setHex(MAT_COLORS[b.mat] ?? 0x888888).multiplyScalar(v);
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(g);
  }
  const P = {
    adobe: { roughness: 1, metalness: 0 },
    metal: { roughness: 1, metalness: 0.55 },
    concrete: { roughness: 1, metalness: 0 },
    wood: { roughness: 1, metalness: 0 },
    crate: { roughness: 1, metalness: 0.05 },
    cloth: { roughness: 1, metalness: 0, side: THREE.DoubleSide },
  };
  for (const [cls, list] of byClass) {
    const merged = mergeGeometries(list, false);
    const m = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, ...P[cls], ...T[cls] }));
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  for (const [g, mt] of glowBoxes) {
    const m = new THREE.Mesh(g, glowMat(MAT_COLORS[mt], mt === MAT.LAMP ? 1.7 : 0.8));
    group.add(m);
  }
  group.add(batch.build());
  return { group };
}

function makeLampHalos(world) {
  const tex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const group = new THREE.Group();
  for (const l of world.lamps) {
    if (l.inside) continue;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: LAMP_COLORS[l.color], transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.set(l.x, l.y + 0.1, l.z);
    s.scale.setScalar(l.color === 'flood' ? 2.6 : 1.8);
    s.material.opacity = 0.35;
    group.add(s);
  }
  return group;
}

let ROCK_MAT = null;
function makeDecor(world, look) {
  const g = new THREE.Group();
  const fires = [];
  let ship = null;
  let trees = world.decor.filter((d) => d.type === 'tree');
  const spires = world.decor.filter((d) => d.type === 'spire');
  const batch = new ModelBatch();
  const anims = [];
  // the drowned forest gets a share of the Space Kit's alien trees
  if (Assets.ready && world.planet === 'thessaly') {
    const ALIEN = ['SK_Tree_Blob_1', 'SK_Tree_Blob_2', 'SK_Tree_Blob_3', 'SK_Tree_Spiral_1', 'SK_Tree_Spiral_2', 'SK_Tree_Swirl_1', 'SK_Tree_Floating_1'];
    const keep = [];
    for (const d of trees) {
      if (d.v < 0.42) { const n = pick(ALIEN, d.v * 997 + d.x); const h = Assets.bounds(n).getSize(new THREE.Vector3()).y || 1; batch.add(n, d.x, d.y - 0.2, d.z, d.v * 6, (7 + d.s * 3) / h); }
      else keep.push(d);
    }
    trees = keep;
  }
  if (trees.length) g.add(makeTrees(trees));
  if (spires.length) g.add(makeSpires(spires));
  const banner = mat(0xa3243a, { rough: 1 });
  const bulbRuns = [];
  for (const d of world.decor) {
    if (d.type === 'model') {
      // pack models placed by the world builder: static ones are batched, animated ones get a mixer
      if (!Assets.ready) continue;
      if (d.fit) { if (packSkinsReady(world)) batch.fitXZ(d.name, d.x, d.y, d.z, d.fit[0], d.fit[1], d.yaw || 0); continue; }
      if (d.anim) {
        const a = animatedProp(d.name, d.anim);
        if (a) { a.object.position.set(d.x, d.y, d.z); a.object.rotation.y = d.yaw || 0; a.object.scale.setScalar(d.s || 1); g.add(a.object); anims.push(a.mixer); }
      } else batch.add(d.name, d.x, d.y, d.z, d.yaw || 0, d.s || 1);
      continue;
    }
    if (d.type === 'specimen') {
      // a cryo tank: plinth, glass, cap, and something from the MegaKit drifting inside
      const t = new THREE.Group();
      t.position.set(d.x, d.y, d.z);
      const metal = mat(0x2a2e36, { rough: 0.5, metal: 0.7 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.82, 0.38, 20), metal);
      base.position.y = 0.19;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.7, 0.26, 20), metal);
      cap.position.y = 2.66;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.035, 6, 28), glowMat(0x58e0ff, 2.2));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.4;
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.16, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x8fe8ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, emissive: 0x0a3a4a }));
      glass.position.y = 1.46;
      t.add(base, cap, ring, glass);
      base.castShadow = cap.castShadow = true;
      if (Assets.ready && d.alien) {
        const a = kitAnimated(d.alien, 1.25, d.alien + '|Alien_Idle', true);
        if (a) { a.position.y = 0.62; a.rotation.y = d.yaw || 0; t.add(a); anims.push(a.userData.mixer); }
      }
      g.add(t);
      continue;
    }
    if (d.type === 'rock') {
      const geo = new THREE.IcosahedronGeometry(0.62, 1);
      const p = geo.attributes.position;
      const rng = mulberry32(Math.floor(d.x * 13 + d.z * 7));
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + rng() * 0.4), p.getY(i) * (0.75 + rng() * 0.4), p.getZ(i) * (0.8 + rng() * 0.4));
      geo.computeVertexNormals();
      applyWorldUV(geo, 1.4);
      const m = new THREE.Mesh(geo, ROCK_MAT || (ROCK_MAT = new THREE.MeshStandardMaterial({ color: 0x9a6650, roughness: 1, flatShading: true, ...textures().rock })));
      ROCK_MAT.userData.cached = true;
      m.scale.set(d.s * 1.05, d.s * 0.95, d.s * 1.15);
      m.position.set(d.x, d.y + d.s * 0.45, d.z);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    } else if (d.type === 'well') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.95, 12, 1, true), mat(0xa8774f));
      m.material.side = THREE.DoubleSide;
      m.position.set(d.x, d.y + 0.47, d.z);
      const water = new THREE.Mesh(new THREE.CircleGeometry(1.2, 12), new THREE.MeshStandardMaterial({ color: 0x2a5a6a, roughness: 0.1, metalness: 0.3 }));
      water.rotation.x = -Math.PI / 2; water.position.set(d.x, d.y + 0.6, d.z);
      g.add(m, water);
    } else if (d.type === 'ship') {
      const w = makeWayfarer();
      w.group.position.set(d.x, d.y, d.z);
      w.group.rotation.y = d.yaw || 0;
      g.add(w.group);
      ship = { ...w, base: w.group.position.clone(), yaw: d.yaw || 0 };
    } else if (d.type === 'dropship') {
      const cock = new THREE.Mesh(new THREE.BoxGeometry(3, 0.7, 0.2), glowMat(0xff4050, 1.2));
      cock.position.set(d.x, d.y + 2.3, d.z - 4.6);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 3), mat(0xa3243a));
      fin.position.set(d.x, d.y + 4, d.z + 3);
      g.add(cock, fin);
    } else if (d.type === 'culvert') {
      const grate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 2.2), new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 1, transparent: true, opacity: 0.6 }));
      grate.position.set(d.x + 0.9, d.y + 0.6, d.z);
      g.add(grate);
    } else if (d.type === 'banner') {
      // Concordance banners on the walls
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4), banner);
      b.material.side = THREE.DoubleSide;
      const out = d.ry ? [-0.02, 0] : [0, -0.02];
      b.position.set(d.x, d.y, d.z); b.rotation.y = d.ry || 0;
      const sig = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.7, 6), mat(0xd9c9a0));
      sig.material.side = THREE.DoubleSide;
      sig.position.set(d.x + out[0], d.y + 0.8, d.z + out[1]); sig.rotation.y = d.ry || 0;
      g.add(b, sig);
    } else if (d.type === 'stringlights') {
      bulbRuns.push(d);
    } else if (d.type === 'fire') {
      const f = new THREE.Group();
      f.position.set(d.x, d.y, d.z);
      const stone = mat(0x55524a, { rough: 1 });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), stone);
        st.position.set(Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.9); st.rotation.set(a, a * 2, 0);
        st.castShadow = true;
        f.add(st);
      }
      for (let i = 0; i < 4; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 6), mat(0x3a2a1c));
        log.rotation.set(Math.PI / 2 - 0.35, (i / 4) * Math.PI * 2, 0); log.position.y = 0.25;
        f.add(log);
      }
      const flames = [];
      for (const [r, h, c, k] of [[0.45, 1.2, 0xff6a1a, 2.4], [0.3, 1.5, 0xffa040, 2.8], [0.16, 1.1, 0xfff0a0, 3.2]]) {
        const fl = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        fl.geometry.translate(0, h / 2, 0);
        fl.position.y = 0.25;
        f.add(fl);
        flames.push(fl);
      }
      g.add(f);
      fires.push({ x: d.x, y: d.y, z: d.z, flames, seed: d.x * 0.37 });
    } else if (d.type === 'crops') {
      g.add(makeCrops(d));
    } else if (d.type === 'vaporator') {
      const m = mat(0xc8c2b6, { metal: 0.5, rough: 0.4 });
      for (const y of [1.2, 2.6, 4.0]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 12), m); r.position.set(d.x, d.y + y, d.z); r.castShadow = true; g.add(r); }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), m); top.position.set(d.x, d.y + 6.2, d.z); top.castShadow = true;
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), glowMat(0x7fe3ff, 2.5)); light.position.set(d.x, d.y + 6.8, d.z);
      g.add(top, light);
    } else if (d.type === 'headframe') {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 6, 20), mat(0x3a3d45, { metal: 0.6 }));
      wheel.position.set(d.x, d.y + 1.2, d.z); wheel.castShadow = true;
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, d.y - terrainHeight(d.x, d.z) + 1, 4), mat(0x1a1a1e));
      cable.position.set(d.x + 1.4, (d.y + terrainHeight(d.x, d.z)) / 2 + 0.6, d.z);
      const bucket = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), mat(0x6a5a40, { metal: 0.4 }));
      bucket.position.set(d.x + 1.4, terrainHeight(d.x, d.z) + 2.2, d.z); bucket.castShadow = true;
      g.add(wheel, cable, bucket);
    } else if (d.type === 'hiderack') {
      const hide = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.6), mat(0x7a5236, { rough: 1 }));
      hide.material.side = THREE.DoubleSide;
      hide.position.set(d.x + 0.12, d.y + 1.3, d.z - 0.6); hide.rotation.y = Math.PI / 2; hide.castShadow = true;
      const hide2 = hide.clone(); hide2.position.z = d.z + 0.9; hide2.scale.set(0.8, 0.85, 1);
      g.add(hide, hide2);
    } else if (d.type === 'resintree') {
      g.add(makeResinTree(d));
    } else if (d.type === 'sign') {
      g.add(makeSign(d));
    } else if (d.type === 'padring') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(6.2, 6.9, 40), new THREE.MeshStandardMaterial({ color: 0xd9b23a, roughness: 0.8 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(d.x, d.y + 0.02, d.z); ring.receiveShadow = true;
      const cross = new THREE.Mesh(new THREE.PlaneGeometry(1, 7), ring.material); cross.rotation.x = -Math.PI / 2; cross.position.set(d.x, d.y + 0.02, d.z);
      const cross2 = cross.clone(); cross2.rotation.z = Math.PI / 2;
      g.add(ring, cross, cross2);
    } else if (d.type === 'glassroof') {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.08, d.d), new THREE.MeshStandardMaterial({ color: 0xbfe6f0, transparent: true, opacity: 0.3, metalness: 0.6, roughness: 0.05, depthWrite: false }));
      glass.position.set(d.x, d.y, d.z);
      const frame = mat(0x4a4e5a, { metal: 0.5 });
      g.add(glass);
      for (let i = 0; i <= 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, d.d), frame); f.position.set(d.x - d.w / 2 + (i * d.w) / 4, d.y + 0.05, d.z); g.add(f); }
    } else if (d.type === 'forge') {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.6), glowMat(0xff7a2a, 2.2));
      f.position.set(d.x, d.y + 1.05, d.z);
      g.add(f);
      fires.push({ x: d.x, y: d.y, z: d.z, flames: [], seed: d.x });
    } else if (d.type === 'harvester') {
      // treads, the felling saw on its arm, and a lit cab over the collision hulk
      const h = new THREE.Group();
      h.position.set(d.x, d.y, d.z);
      const dark = mat(0x26282c, { metal: 0.5, rough: 0.7 });
      for (const z of [-3.9, 3.9]) {
        const tread = new THREE.Mesh(new RoundedBoxGeometry(16.6, 1.5, 1.9, 2, 0.6), dark);
        tread.position.set(0, 0.75, z); tread.castShadow = true;
        h.add(tread);
        for (let i = 0; i < 7; i++) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.0, 10), mat(0x45484e, { metal: 0.5 }));
          wheel.rotation.x = Math.PI / 2; wheel.position.set(-7 + i * 2.33, 0.75, z);
          h.add(wheel);
        }
      }
      const arm = new THREE.Mesh(new THREE.BoxGeometry(7, 0.8, 0.8), mat(0xc4922a, { metal: 0.4 }));
      arm.position.set(-10.5, 4.6, 0); arm.rotation.z = 0.35; arm.castShadow = true;
      const saw = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.15, 28), mat(0xb8bcc4, { metal: 0.8, rough: 0.3 }));
      saw.rotation.x = Math.PI / 2; saw.position.set(-14, 3.4, 0); saw.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10), dark);
      hub.rotation.x = Math.PI / 2; hub.position.copy(saw.position);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 3.2), glowMat(0xffd28a, 0.7));
      cab.position.set(6, 4.0, 0);
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 3, 8), dark);
      stack.position.set(3, 7.4, 2);
      h.add(arm, saw, hub, cab, stack);
      g.add(h);
    }
  }
  // string lights strung between posts
  const total = bulbRuns.reduce((n, d) => n + d.runs.length * 19, 0);
  if (total) {
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 4), glowMat(0xffc070, 3), total);
    const bm4 = new THREE.Matrix4();
    let bi = 0;
    for (const d of bulbRuns) for (const [[ax, az], [bx, bz]] of d.runs) {
      for (let i = 0; i <= 18; i++) {
        const t = i / 18;
        bm4.makeTranslation(ax + (bx - ax) * t, d.y - Math.sin(t * Math.PI) * 1.4, az + (bz - az) * t);
        bulbs.setMatrixAt(bi++, bm4);
      }
    }
    g.add(bulbs);
  }
  g.add(batch.build());
  return { group: g, ship, fires, anims };
}

// Drowned-forest trees: buttressed trunks with layered canopies, instanced
function makeTrees(list) {
  const g = new THREE.Group();
  const N = list.length;
  const trunkG = new THREE.CylinderGeometry(0.32, 0.55, 8, 7); trunkG.translate(0, 4, 0);
  const rootG = new THREE.ConeGeometry(1.2, 1.6, 7, 1, true); rootG.translate(0, 0.6, 0);
  const canG = new THREE.IcosahedronGeometry(2.6, 1);
  { const p = canG.attributes.position; const r = mulberry32(5); for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.85 + r() * 0.3), p.getY(i) * (0.55 + r() * 0.2), p.getZ(i) * (0.85 + r() * 0.3)); canG.computeVertexNormals(); }
  const T = textures();
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1, ...repeated(T.wood, 1) });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3f6a2c, roughness: 0.9, flatShading: true });
  const leaf2 = new THREE.MeshStandardMaterial({ color: 0x557a34, roughness: 0.9, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkG, bark, N), roots = new THREE.InstancedMesh(rootG, bark, N);
  const can1 = new THREE.InstancedMesh(canG, leaf, N), can2 = new THREE.InstancedMesh(canG, leaf2, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  list.forEach((d, i) => {
    e.set((d.v - 0.5) * 0.1, d.v * 6, 0); q.setFromEuler(e);
    s.set(d.s, d.s * (0.9 + d.v * 0.3), d.s); p.set(d.x, d.y - 0.3, d.z);
    trunks.setMatrixAt(i, m4.compose(p, q, s));
    roots.setMatrixAt(i, m4.compose(p, q, s));
    const top = d.y + 8 * s.y;
    s.set(d.s * 1.2, d.s, d.s * 1.2); p.set(d.x, top - 0.6, d.z);
    can1.setMatrixAt(i, m4.compose(p, q, s));
    s.set(d.s * 0.8, d.s * 0.8, d.s * 0.8); p.set(d.x + (d.v - 0.5) * 1.6, top + 1.1, d.z + (0.5 - d.v) * 1.2);
    can2.setMatrixAt(i, m4.compose(p, q, s));
  });
  for (const m of [trunks, roots, can1, can2]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return g;
}

// Korrun's ice spires: faceted, slightly translucent pillars
function makeSpires(list) {
  const geo = new THREE.CylinderGeometry(0.15, 1, 1, 5, 3);
  geo.translate(0, 0.5, 0);
  { const p = geo.attributes.position; const r = mulberry32(9); for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (0.8 + r() * 0.4)); p.setZ(i, p.getZ(i) * (0.8 + r() * 0.4) + y * 0.15); } geo.computeVertexNormals(); }
  const m = new THREE.MeshStandardMaterial({ color: 0xbfe2f4, roughness: 0.15, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92, emissive: 0x16384a, emissiveIntensity: 0.4 });
  const inst = new THREE.InstancedMesh(geo, m, list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  list.forEach((d, i) => {
    e.set((d.v - 0.5) * 0.25, d.v * 7, (0.5 - d.v) * 0.2); q.setFromEuler(e);
    s.set(1.3 * d.s, d.h + 1, 1.3 * d.s); p.set(d.x, d.y - 0.8, d.z);
    inst.setMatrixAt(i, m4.compose(p, q, s));
  });
  inst.castShadow = true; inst.receiveShadow = true;
  return inst;
}

// ------------------------------------------------------------------ district props

// Rows of crops in a field (golden grain on Dusk, leafy tubers under Korrun's glass)
function makeCrops(d) {
  const grain = d.crop === 'grain';
  const geo = grain ? new THREE.ConeGeometry(0.16, 1.1, 5) : new THREE.IcosahedronGeometry(0.3, 0);
  geo.translate(0, grain ? 0.55 : 0.2, 0);
  const m = new THREE.MeshStandardMaterial({ color: grain ? 0xc9a24a : 0x4f8a3a, roughness: 0.9, flatShading: true });
  const rows = Math.max(1, Math.floor((d.z1 - d.z0) / 1.3)), per = Math.max(1, Math.floor((d.x1 - d.x0) / 0.75));
  const inst = new THREE.InstancedMesh(geo, m, rows * per);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const rng = mulberry32(Math.floor(d.x0 * 7 + d.z0 * 13));
  let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < per; c++) {
    const x = d.x0 + (c + 0.5) * ((d.x1 - d.x0) / per) + (rng() - 0.5) * 0.2, z = d.z0 + (r + 0.5) * ((d.z1 - d.z0) / rows);
    e.set((rng() - 0.5) * 0.25, rng() * 6, (rng() - 0.5) * 0.25); q.setFromEuler(e);
    const k = 0.75 + rng() * 0.5;
    s.set(k, k * (grain ? 0.8 + rng() * 0.5 : 1), k);
    p.set(x, d.y, z);
    inst.setMatrixAt(i++, m4.compose(p, q, s));
  }
  inst.count = i;
  inst.castShadow = true; inst.receiveShadow = true;
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(d.x1 - d.x0, d.z1 - d.z0), new THREE.MeshStandardMaterial({ color: grain ? 0x6a4a30 : 0x3a2a20, roughness: 1 }));
  soil.rotation.x = -Math.PI / 2; soil.position.set((d.x0 + d.x1) / 2, d.y + 0.03, (d.z0 + d.z1) / 2); soil.receiveShadow = true;
  const g = new THREE.Group();
  g.add(soil, inst);
  return g;
}

// Thessaly's resin trees: twisted trunks with glowing amber pods
function makeResinTree(d) {
  const g = new THREE.Group();
  g.position.set(d.x, d.y, d.z);
  const bark = mat(0x4a3428, { rough: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.45, 4.4, 7), bark);
  trunk.position.y = 2.1; trunk.rotation.z = 0.12; trunk.castShadow = true;
  const can = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 1), new THREE.MeshStandardMaterial({ color: 0x4a7a2e, roughness: 0.9, flatShading: true }));
  can.scale.set(1.2 * d.s, 0.6 * d.s, 1.2 * d.s); can.position.y = 4.6; can.castShadow = true;
  g.add(trunk, can);
  const pod = glowMat(0xffa42a, 1.6);
  for (let i = 0; i < 4; i++) { const a = i * 1.7 + d.x; const p = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 4), pod); p.position.set(Math.cos(a) * 0.38, 1.1 + i * 0.55, Math.sin(a) * 0.38); g.add(p); }
  return g;
}

// A hanging trade sign over a market or workshop door
function makeSign(d) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
  const x = cv.getContext('2d');
  x.fillStyle = d.kind === 'exchange' ? '#3a2a1a' : '#1e2630'; x.fillRect(0, 0, 256, 96);
  x.strokeStyle = d.kind === 'exchange' ? '#d9a62e' : '#7fe3ff'; x.lineWidth = 6; x.strokeRect(5, 5, 246, 86);
  x.fillStyle = x.strokeStyle; x.font = '600 38px "Chakra Petch", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(d.kind === 'exchange' ? 'EXCHANGE' : 'WORKSHOP', 128, 50);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  // Two single-sided faces back to back, so the lettering reads correctly from the street and
  // from inside. d.yaw points out of the door; a plane's readable face is its +Z side.
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 });
  const board = new THREE.Group();
  const out = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.98), m);
  out.rotation.y = Math.PI; out.position.z = -0.02;
  const inn = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.98), m);
  inn.position.z = 0.02;
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.66, 1.04, 0.03), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.8 }));
  board.add(back, out, inn);
  board.position.set(d.x, d.y, d.z); board.rotation.y = d.yaw;
  return board;
}

// Gatherable resources: ore and ice crystal clusters, harvest sheaves, resin taps, cut logs
function makeNodes(world) {
  const g = new THREE.Group();
  const items = [];
  const looks = {
    ore: { color: 0xd9822e, glow: 0.5, geo: () => new THREE.OctahedronGeometry(0.45, 0), n: 5 },
    ice: { color: 0x9fe0ff, glow: 0.7, geo: () => new THREE.OctahedronGeometry(0.5, 0), n: 5 },
    resin: { color: 0xffa42a, glow: 1.1, geo: () => new THREE.SphereGeometry(0.28, 8, 6), n: 3 },
    grain: { color: 0xe0b84a, glow: 0, geo: () => new THREE.ConeGeometry(0.3, 1.3, 6), n: 3 },
    timber: { color: 0x8a6a48, glow: 0, geo: () => new THREE.CylinderGeometry(0.22, 0.22, 1.8, 8).rotateZ(Math.PI / 2), n: 3 },
  };
  for (const n of world.nodes) {
    const L = looks[n.kind];
    const grp = new THREE.Group();
    grp.position.set(n.x, n.y, n.z);
    const rng = mulberry32(n.id * 31 + 7);
    const m = new THREE.MeshStandardMaterial({ color: L.color, roughness: 0.35, metalness: 0.1, emissive: L.color, emissiveIntensity: L.glow, flatShading: true, transparent: n.kind === 'ice', opacity: n.kind === 'ice' ? 0.85 : 1 });
    const geo = L.geo();
    for (let i = 0; i < L.n; i++) {
      const c = new THREE.Mesh(geo, m);
      const a = (i / L.n) * Math.PI * 2 + rng();
      const r = n.kind === 'timber' ? 0 : 0.35 + rng() * 0.25;
      c.position.set(Math.cos(a) * r, n.kind === 'timber' ? 0.22 + i * 0.4 : 0.3 + rng() * 0.2, Math.sin(a) * r);
      if (n.kind === 'ore' || n.kind === 'ice') { c.scale.set(0.6 + rng() * 0.5, 1 + rng() * 1.2, 0.6 + rng() * 0.5); c.rotation.set(rng() * 0.6, rng() * 3, rng() * 0.6); }
      c.castShadow = true;
      grp.add(c);
    }
    if (n.kind === 'resin') { const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 5), mat(0x3a2a20)); stand.position.y = 0.55; grp.add(stand); grp.children.forEach((c, i) => { if (c !== stand) c.position.y = 0.8 + i * 0.2; }); }
    g.add(grp);
    items.push({ id: n.id, grp, m, base: L.glow });
  }
  let depleted = new Set();
  return {
    group: g,
    setDepleted(ids) { depleted = new Set(ids); for (const it of items) it.grp.visible = !depleted.has(it.id); },
    update(t) { for (const it of items) if (it.base) it.m.emissiveIntensity = it.base * (0.75 + Math.sin(t * 2 + it.id) * 0.25); },
  };
}

// ------------------------------------------------------------------ sky planets

// A couple of the Space Kit's planets hang in each sky, far beyond the fog
function makeSkyPlanets(world, look) {
  const g = new THREE.Group();
  const sets = { duskvaro: [['SK_Planet_1', -0.55, 0.32, 150], ['SK_Planet_9', 0.9, 0.18, 70]], thessaly: [['SK_Planet_6', 0.4, 0.38, 120]], korrun: [['SK_Planet_6', -1.2, 0.3, 170], ['SK_Planet_9', 1.6, 0.22, 60]] };
  for (const [name, az, el, size] of sets[world.planet] || []) {
    const o = Assets.instance(name);
    if (!o) continue;
    const b = new THREE.Box3().setFromObject(o), r = b.getSize(new THREE.Vector3()).length() / 2 || 1;
    o.scale.setScalar(size / r);
    const dist = 1500;
    o.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, -Math.cos(az) * Math.cos(el) * dist);
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = false; m.receiveShadow = false;
      m.material = m.material.clone();
      m.material.fog = false;
      m.material.emissive = new THREE.Color(0xffffff); m.material.emissiveMap = m.material.map; m.material.emissiveIntensity = 0.35;
    });
    o.userData.sky = true;
    g.add(o);
  }
  return g;
}

// ------------------------------------------------------------------ trader ships

// A Space Kit ship wrapped to behave like the procedural traders (faces -Z, engine glow)
function makeKitShip(name, length) {
  const o = Assets.instance(name);
  if (!o) return null;
  const g = new THREE.Group();
  const b = new THREE.Box3().setFromObject(o), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const sc = length / Math.max(size.x, size.z);
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI; // the kit's ships face +Z
  inner.scale.setScalar(sc);
  o.position.set(-c.x, -b.min.y, -c.z);
  inner.add(o);
  g.add(inner);
  o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const glows = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), glowMat(0x6ad8ff, 2));
    e.position.set(sx * size.x * sc * 0.18, size.y * sc * 0.4, size.z * sc * 0.5);
    g.add(e); glows.push(e);
  }
  return { group: g, setRamp() {}, setThrust(v) { for (const e of glows) { e.scale.setScalar(0.4 + v * 1.3); e.visible = v > 0.05; } }, height: size.y * sc };
}

const easeOut = (k) => 1 - (1 - k) * (1 - k);
function updateTraders(traders, time, t) {
  traders.forEach(({ pad, ships }, i) => {
    const st = padState(i, time);
    for (const [type, s] of Object.entries(ships)) s.group.visible = type === st.type && st.phase !== 'empty';
    if (st.phase === 'empty') return;
    const s = ships[st.type];
    const g = s.group;
    const inYaw = Math.atan2(pad.ax, pad.az); // flying in from (ax, az) toward the pad
    if (st.phase === 'landed') {
      g.position.set(pad.x, pad.y + Math.sin(t * 0.8 + i) * 0.02, pad.z);
      g.rotation.set(0, inYaw, 0);
      s.setThrust(0);
      return;
    }
    if (st.phase === 'arrive') {
      const k = easeOut(st.k), r = 1 - k;
      g.position.set(pad.x + pad.ax * r * r * 320, pad.y + Math.pow(r, 1.4) * 120, pad.z + pad.az * r * r * 320);
      g.rotation.set(-0.25 * r + (k > 0.85 ? (k - 0.85) * 0.8 : 0), inYaw, 0);
      s.setThrust(0.35 + (k > 0.7 ? 0.65 : 0));
      return;
    }
    // depart: lift straight up, turn, then accelerate out and away
    const k = st.k, lift = Math.min(1, k / 0.35), go = Math.max(0, (k - 0.3) / 0.7);
    const out = go * go * 420;
    g.position.set(pad.x + pad.ax * out, pad.y + lift * 18 + go * go * 140, pad.z + pad.az * out);
    g.rotation.set(go * 0.18, inYaw + Math.PI * Math.min(1, lift * 1.2), 0);
    s.setThrust(0.6 + go * 0.4);
  });
}
