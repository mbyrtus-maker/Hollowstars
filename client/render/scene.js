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

export const MAT_COLORS = {
  [MAT.ADOBE]: 0xc99a6a, [MAT.ADOBE_DARK]: 0xa8774f, [MAT.METAL]: 0xb6b9c1, [MAT.METAL_DARK]: 0x4a4e5a, [MAT.CRATE]: 0x7d6a4e,
  [MAT.ROCK]: 0x8b5e48, [MAT.CLOTH]: 0xb8473a, [MAT.CONCRETE]: 0x8d8884, [MAT.RED]: 0xa3243a, [MAT.LAMP]: 0xffcf8a, [MAT.WOOD]: 0x6e4a30,
  [MAT.FUEL]: 0xd9a62e, [MAT.DOOR]: 0x5d6270, [MAT.FLOOR]: 0x5e4636, [MAT.HULL]: 0x9aa3ad, [MAT.SCREEN]: 0x6fe0ff, [MAT.BARS]: 0x3a3d45,
  [MAT.CLOTH2]: 0x3f7f8a, [MAT.CLOTH3]: 0xc98d2e,
};
const LAMP_COLORS = { warm: 0xffb060, cool: 0xa8d8ff, flood: 0xe8f2ff };

export function createScene(canvas, world) {
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
  // Image-based lighting captured from the dusk sky, so metal and armour pick up reflections
  {
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(sky.geometry, sky.material);
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 24), new THREE.MeshBasicMaterial({ color: 0x5a3426 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -40;
    envScene.add(ground);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0, 1, 3000).texture;
    scene.environmentIntensity = 0.55;
    pm.dispose();
  }

  // ---- terrain
  const terrain = makeTerrain(T);
  scene.add(terrain);
  scene.add(makeScatter(world, T));

  // ---- static boxes, merged per material
  const statics = buildStatics(world, T);
  scene.add(statics.group);

  // ---- doors & destructibles
  const doors = {};
  for (const d of Object.values(world.doors)) {
    const b = world.boxes[d.boxId];
    const w = b.maxX - b.minX, h = b.maxY - b.minY, dd = b.maxZ - b.minZ;
    const g = new THREE.Group();
    const isBars = d.id === 'cell';
    const dg = applyWorldUV(new THREE.BoxGeometry(w, h, dd), 3);
    const m = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ color: isBars ? MAT_COLORS[MAT.BARS] : d.id === 'gate' ? 0x6a6f7c : MAT_COLORS[MAT.DOOR], metalness: 0.5, roughness: 1, ...T.metal }));
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
    scene.add(g);
    doors[d.id] = { group: g, light, base: g.position.clone(), axis: d.axis, w, h, dd, open: d.open ? 1 : 0, target: d.open ? 1 : 0, gate: d.id === 'gate' };
  }
  const destructibles = {};
  for (const d of Object.values(world.destructibles)) {
    const g = new THREE.Group();
    g.position.set(d.x, d.y, d.z);
    if (d.kind === 'tank') {
      const tankTex = repeated(T.metal, 1.5);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 4.6, 24), new THREE.MeshStandardMaterial({ color: 0xd9a62e, metalness: 0.45, roughness: 1, ...tankTex }));
      tank.position.y = 2.5; tank.castShadow = true; tank.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.75, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xc4922a, { metal: 0.4 }));
      cap.position.y = 4.8; cap.castShadow = true;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.35, 14), mat(0xa3243a));
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
        leg.position.set(x * (1 - 0.0), 11, z); leg.castShadow = true; lat.add(leg);
      }
      for (let y = 1.5; y < 22; y += 2.5) {
        for (const r of [0, Math.PI / 2]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.1), m);
          brace.position.y = y; brace.rotation.y = r; brace.position.x = r ? 0 : 0; lat.add(brace);
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
    scene.add(g);
    destructibles[d.id] = { group: g, kind: d.kind, destroyed: false, fall: 0 };
  }

  // ---- lamps: emissive heads + a pool of real point lights near the camera
  const lampPool = [];
  for (let i = 0; i < 10; i++) {
    const l = new THREE.PointLight(0xffb060, 0, 16, 1.6);
    scene.add(l);
    lampPool.push(l);
  }
  const halos = makeLampHalos(world);
  scene.add(halos);

  // ---- decor
  scene.add(makeDecor(world));

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

  const alarmLights = [];
  for (const [x, z] of [[150, 0], [185, 0], [170, -25], [170, 25]]) {
    const l = new THREE.PointLight(0xff1a2a, 0, 40, 1.4);
    l.position.set(x, 18, z);
    scene.add(l);
    alarmLights.push(l);
  }

  let lampT = 0;
  const api = {
    renderer, scene, camera, composer, sun, doors, destructibles, alarm: false,
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
        const near = world.lamps.map((l) => [l, dist2(l.x, l.z, camera.position.x, camera.position.z)]).sort((a, b) => a[1] - b[1]).slice(0, lampPool.length);
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
      // doors slide
      for (const d of Object.values(doors)) {
        d.open += (d.target - d.open) * Math.min(1, dt * 4);
        if (d.gate) d.group.position.y = d.base.y + d.open * (d.h - 0.4);
        else if (d.axis === 'x') d.group.position.x = d.base.x + d.open * d.w * 0.95;
        else d.group.position.z = d.base.z + d.open * d.dd * 0.95;
        if (d.light) d.light.material.color.setHex(d.target ? 0x40ff70 : 0xff3344).multiplyScalar(3);
      }
      for (const d of Object.values(destructibles)) {
        if (d.kind === 'mast') {
          d.group.userData.beacon.visible = !d.destroyed && Math.sin(t * 4) > 0;
          if (d.destroyed && d.fall < 1) { d.fall = Math.min(1, d.fall + dt * 0.6); d.group.userData.lat.rotation.z = -d.fall * d.fall * 1.45; }
        }
      }
      alarmLights.forEach((l, i) => { l.intensity = api.alarm ? (Math.sin(t * 7 + i * 1.6) > 0 ? 120 : 10) : 0; });
    },
    render() { if (useBloom || gtao.enabled) composer.render(); else renderer.render(scene, camera); },
    setDoor(id, open) { if (doors[id]) doors[id].target = open ? 1 : 0; },
    setDestroyed(id, v) {
      const d = destructibles[id];
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
  // remember original tank materials for reset
  for (const d of Object.values(destructibles)) if (d.kind === 'tank') d.group.userData.parts.forEach((p) => { p.userData.orig = p.material; });
  return api;
}

// ------------------------------------------------------------------ sky

function makeSky() {
  const geo = new THREE.SphereGeometry(1500, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z) }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uSun; uniform float uTime;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float sunAmt = max(dot(d, normalize(uSun)), 0.0);
        vec3 zenith = vec3(0.035, 0.025, 0.11);
        vec3 mid = vec3(0.19, 0.09, 0.27);
        vec3 horizon = vec3(0.55, 0.27, 0.32);
        vec3 glowC = vec3(1.0, 0.52, 0.22);
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
          vec3 cloudC = mix(vec3(0.36, 0.22, 0.38), vec3(1.0, 0.6, 0.38), pow(sunAmt, 3.0) * 0.9 + 0.15);
          col = mix(col, cloudC, cloud * 0.7);
        }
        if (h < 0.0) col = mix(horizon * 0.9, vec3(0.3, 0.17, 0.2), smoothstep(0.0, -0.2, h));
        // stars
        vec3 sp = floor(d * 380.0);
        float s = hash(sp);
        float star = step(0.9965, s) * smoothstep(0.08, 0.45, h) * (0.6 + 0.4 * sin(uTime * 2.0 + s * 100.0));
        col += vec3(star);
        // twin moons
        vec3 m1 = normalize(vec3(0.45, 0.42, -0.79));
        float md = dot(d, m1);
        col = mix(col, vec3(0.92, 0.86, 0.8), smoothstep(0.99935, 0.99955, md));
        col += vec3(0.5, 0.45, 0.5) * pow(max(md, 0.0), 400.0) * 0.4;
        vec3 m2 = normalize(vec3(0.62, 0.3, -0.73));
        float md2 = dot(d, m2);
        col = mix(col, vec3(0.75, 0.62, 0.7), smoothstep(0.99985, 0.99992, md2));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------ terrain

function makeTerrain(T) {
  const hf = heightfield();
  const W = HF_N + 1;
  const pos = new Float32Array(W * W * 3);
  const col = new Float32Array(W * W * 3);
  const sandL = new THREE.Color(0xdcaa70), sandD = new THREE.Color(0xbf8550), rock = new THREE.Color(0xa06450), rockHi = new THREE.Color(0x7a5058);
  const road = new THREE.Color(0x9a7656), packed = new THREE.Color(0xc29468);
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
    const rd = roadDistance(x, z);
    c.lerp(road, (1 - smoothstep(2.5, 7, rd)) * 0.75);
    if (dist2(x, z, -160, 40) < 70 || dist2(x, z, 170, 0) < 72) c.lerp(packed, 0.35);
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

function makeScatter(world, T) {
  const group = new THREE.Group();
  const rng = mulberry32(4242);
  const rockG = new THREE.IcosahedronGeometry(0.5, 0);
  const shrubG = new THREE.IcosahedronGeometry(0.45, 0);
  const rocks = new THREE.InstancedMesh(rockG, new THREE.MeshStandardMaterial({ color: 0x9a6650, roughness: 1, flatShading: true, ...repeated(T.rock, 0.6) }), 700);
  const shrubs = new THREE.InstancedMesh(shrubG, mat(0x6b6a3a, { rough: 1 }), 450);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  let ri = 0, si = 0;
  for (let k = 0; k < 6000 && (ri < 700 || si < 450); k++) {
    const x = (rng() - 0.5) * 640, z = (rng() - 0.5) * 520;
    if (dist2(x, z, -160, 40) < 75 || dist2(x, z, 170, 0) < 78 || dist2(x, z, -228, 62) < 26 || roadDistance(x, z) < 6 || dist2(x, z, 78, 66) < 14) continue;
    const y = terrainHeight(x, z);
    e.set(rng() * 3, rng() * 3, rng() * 3);
    q.setFromEuler(e);
    if (rng() < 0.6 && ri < 700) {
      const sz = 0.3 + Math.pow(rng(), 3) * 2.2;
      s.set(sz * (0.8 + rng() * 0.6), sz * (0.5 + rng() * 0.5), sz * (0.8 + rng() * 0.6));
      p.set(x, y + sz * 0.15, z);
      rocks.setMatrixAt(ri++, m4.compose(p, q, s));
    } else if (si < 450 && y < 25) {
      const sz = 0.5 + rng() * 0.9;
      s.set(sz, sz * 0.6, sz);
      p.set(x, y + sz * 0.15, z);
      shrubs.setMatrixAt(si++, m4.compose(p, q, s));
    }
  }
  rocks.count = ri; shrubs.count = si;
  rocks.castShadow = true; rocks.receiveShadow = true; shrubs.receiveShadow = true;
  group.add(rocks, shrubs);
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

function buildStatics(world, T) {
  const group = new THREE.Group();
  const byClass = new Map();
  const glowBoxes = [];
  const c = new THREE.Color();
  for (const b of world.boxes) {
    if (!b.render) continue;
    if (b.tag === 'door' || b.tag === 'tank' || b.tag === 'mast' || b.mat === MAT.ROCK) continue;
    const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, cz = (b.minZ + b.maxZ) / 2;
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
function makeDecor(world) {
  const g = new THREE.Group();
  for (const d of world.decor) {
    if (d.type === 'rock') {
      const geo = new THREE.IcosahedronGeometry(0.62, 1);
      const p = geo.attributes.position;
      const rng = mulberry32(Math.floor(d.x * 13 + d.z * 7));
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + rng() * 0.4), p.getY(i) * (0.75 + rng() * 0.4), p.getZ(i) * (0.8 + rng() * 0.4));
      geo.computeVertexNormals();
      applyWorldUV(geo, 1.4);
      const m = new THREE.Mesh(geo, ROCK_MAT || (ROCK_MAT = new THREE.MeshStandardMaterial({ color: 0x9a6650, roughness: 1, flatShading: true, ...textures().rock })));
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
    } else if (d.type === 'shuttle') {
      // cockpit glow, engines and a crew stripe for the party's ship
      const cock = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.2), glowMat(0x7fe3ff, 0.9));
      cock.position.set(d.x, d.y + 3.4, d.z - 5.6);
      cock.rotation.x = -0.4;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3.4, 6), mat(0x9aa3ad, { metal: 0.4 }));
      nose.rotation.x = -Math.PI / 2; nose.position.set(d.x, d.y + 1.8, d.z - 7.2);
      nose.castShadow = true;
      g.add(cock, nose);
      for (const x of [-1.8, 1.8]) {
        const e = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 2.6, 10), mat(0x4a4e5a, { metal: 0.5 }));
        e.rotation.x = Math.PI / 2; e.position.set(d.x + x, d.y + 1.6, d.z + 6.4); e.castShadow = true;
        const glow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), glowMat(0x6ad8ff, 2.2));
        glow.position.set(d.x + x, d.y + 1.6, d.z + 7.75);
        g.add(e, glow);
      }
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(6.05, 0.3, 8), mat(0xff8a3d));
      stripe.position.set(d.x, d.y + 2.4, d.z + 1);
      g.add(stripe);
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
    }
  }
  // Concordance banners on the garrison walls
  const banner = mat(0xa3243a, { rough: 1 });
  for (const [x, z, ry] of [[124.3, -8, Math.PI / 2], [124.3, 8, Math.PI / 2], [170, -35.7, 0], [170, 35.7, 0]]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4), banner);
    b.material.side = THREE.DoubleSide;
    b.position.set(x, 13.2, z); b.rotation.y = ry;
    const sig = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.7, 6), mat(0xd9c9a0));
    sig.material.side = THREE.DoubleSide;
    sig.position.set(x + (ry ? -0.02 : 0), 14, z + (ry ? 0 : -0.02)); sig.rotation.y = ry;
    g.add(b, sig);
  }
  // string lights across the plaza
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 4), glowMat(0xffc070, 3), 57);
  const bm4 = new THREE.Matrix4();
  let bi = 0;
  for (const [[ax, az], [bx, bz]] of [[[-176, 46], [-150, 54]], [[-170, 30], [-140, 46]], [[-180, 38], [-132, 38]]]) {
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      bm4.makeTranslation(ax + (bx - ax) * t, 10.2 - Math.sin(t * Math.PI) * 1.4, az + (bz - az) * t);
      bulbs.setMatrixAt(bi++, bm4);
    }
  }
  g.add(bulbs);
  return g;
}
