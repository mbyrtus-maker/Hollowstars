// World definition for the planet Dusk Varo: terrain heightfield, static layout,
// collision, raycasting, and a navigation grid. Deterministic so the server and
// every client build the identical world from the same code.

import { clamp, lerp, smoothstep, fbm, distPointSegXZ, dist2 } from './math.js';
import { GRAVITY } from './config.js';

export const WORLD_HALF = 640;
export const HF_N = 256; // heightfield cells per side
export const HF_CELL = (WORLD_HALF * 2) / HF_N; // 5 m

// Materials (client maps these to colors)
export const MAT = {
  ADOBE: 0, ADOBE_DARK: 1, METAL: 2, METAL_DARK: 3, CRATE: 4, ROCK: 5, CLOTH: 6, CONCRETE: 7,
  RED: 8, LAMP: 9, WOOD: 10, FUEL: 11, DOOR: 12, FLOOR: 13, HULL: 14, SCREEN: 15, BARS: 16, CLOTH2: 17, CLOTH3: 18,
};

export const SUN_DIR = (() => {
  const v = { x: -0.82, y: 0.36, z: 0.44 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

// ---------------------------------------------------------------- terrain

// Garrison Seven sits this far east of where it was first built: a proper ride from Khet
export const DUSK_SHIFT = 190;
const ZONES_DUSK = [
  { name: 'Khet', x: -160, z: 40, r: 112, f: 30, h: 6 },
  { name: 'Khet Landing', x: -228, z: 62, r: 22, f: 16, h: 6 },
  { name: 'Khet Farms', x: -150, z: -112, r: 44, f: 22, h: 6.4 },
  { name: 'Ochre Cut', x: -58, z: -128, r: 20, f: 16, h: 8 },
  { name: 'Skitter Lodge', x: -120, z: 178, r: 16, f: 14, h: 7 },
  { name: 'Khet Spaceport', x: -250, z: 126, r: 32, f: 18, h: 6 },
  { name: 'Garrison Seven', x: 170 + DUSK_SHIFT, z: 0, r: 92, f: 22, h: 10 },
  { name: 'Ridge LZ', x: 238, z: 66, r: 14, f: 14, h: 11 },
];
const ROAD_DUSK = [[-46, 36], [10, 26], [70, 18], [130, 13], [190, 8], [250, 4], [284, 1], [297, 0]];

function rawDusk(x, z) {
  let h = 7 + fbm(x / 140, z / 140, 4, 3) * 9;
  h += fbm(x / 38, z / 38, 3, 11) * 2.2; // dunes
  // Mountain ring bounding the play space
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(440, 610, edge) * (70 + fbm(x / 50, z / 50, 3, 21) * 30);
  // The Spine: a ridge between Khet and the garrison, with a pass for the road
  const ridgeX = 150 + fbm(z / 90, 3, 2, 31) * 14;
  const across = (x - ridgeX) / 17;
  let ridge = 30 * Math.exp(-across * across) * (0.75 + 0.25 * fbm(z / 30, x / 30, 2, 41));
  const pass = 1 - smoothstep(10, 30, Math.abs(z - 12));
  ridge *= 1 - pass * 0.93;
  ridge *= smoothstep(-300, -170, z) * (1 - smoothstep(170, 300, z)) * 0.6 + 0.4 * (1 - pass);
  h += ridge;
  // Mesas scattered in the open desert
  const mesas = [[-30, -128, 22, 18], [-40, 178, 26, 22], [90, -150, 20, 16], [-340, -60, 30, 24], [60, 170, 18, 15], [250, -170, 24, 20], [300, 150, 22, 18]];
  for (const [mx, mz, r, mh] of mesas) {
    const d = dist2(x, z, mx, mz);
    h += (1 - smoothstep(r * 0.75, r, d)) * mh;
  }
  return h;
}

// Thessaly Mire: low, waterlogged jungle with forested hills around the edge
function rawThessaly(x, z) {
  let h = 3.2 + fbm(x / 80, z / 80, 4, 301) * 5 + fbm(x / 22, z / 22, 3, 311) * 1.2;
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(430, 610, edge) * (45 + fbm(x / 45, z / 45, 3, 321) * 25);
  const hills = [[60, 140, 40, 16], [10, -150, 36, 14], [230, 130, 30, 12], [-300, 150, 34, 18], [150, -150, 30, 10], [-330, -140, 36, 16]];
  for (const [mx, mz, r, mh] of hills) h += (1 - smoothstep(r * 0.4, r, dist2(x, z, mx, mz))) * mh * (0.8 + 0.4 * fbm(x / 15, z / 15, 2, 331));
  return h;
}
export const SITE_SHIFT = 180; // the off-world Concordance sites, pushed out from their towns
const ZONES_THESSALY = [
  { name: 'Lowmarsh', x: -120, z: 30, r: 84, f: 24, h: 3.6 },
  { name: 'Lowmarsh Landing', x: -180, z: -25, r: 20, f: 14, h: 4.2 },
  { name: 'Resin Groves', x: -40, z: -92, r: 30, f: 18, h: 3.4 },
  { name: 'Deadfall Yard', x: -150, z: 150, r: 22, f: 16, h: 4.2 },
  { name: 'Lowmarsh Spaceport', x: -196, z: -76, r: 30, f: 16, h: 4.2 },
  { name: 'Harvester Station Kappa', x: 120 + SITE_SHIFT, z: -10, r: 58, f: 22, h: 5 },
];
const ROAD_THESSALY = [[-36, 22], [20, 12], [100, 4], [180, -4], [240, -8], [262, -10]];

// Korrun Deep: an ice shelf with pressure ridges, a frozen sea to the south
function rawKorrun(x, z) {
  let h = 9 + fbm(x / 120, z / 120, 4, 401) * 9;
  const r = 1 - Math.abs(fbm(x / 45, z / 45, 3, 411) * 2);
  h += Math.pow(Math.max(0, r), 4) * 7; // pressure ridges
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(430, 610, edge) * (80 + fbm(x / 50, z / 50, 3, 421) * 30);
  // frozen sea
  const sea = 1 - smoothstep(-40, 30, z);
  h = lerp(h, 2 + fbm(x / 30, z / 30, 2, 431) * 0.4, sea * 0.9);
  return h;
}
const ZONES_KORRUN = [
  { name: 'Rime Hold', x: -130, z: 70, r: 80, f: 24, h: 11 },
  { name: 'Rime Landing', x: -190, z: 25, r: 20, f: 14, h: 11 },
  { name: 'Hunters\' Rest', x: -120, z: 190, r: 16, f: 14, h: 12 },
  { name: 'Rime Spaceport', x: -226, z: 118, r: 30, f: 16, h: 11 },
  { name: 'Glassfall Quarry', x: -60, z: -34, r: 26, f: 16, h: 2.6 },
  { name: 'Cryo-Vault Sigma', x: 130 + SITE_SHIFT, z: 40, r: 58, f: 22, h: 13 },
];
const ROAD_KORRUN = [[-48, 62], [40, 54], [140, 46], [240, 42], [272, 40]];

const TERRAIN = {
  duskvaro: { raw: rawDusk, zones: ZONES_DUSK, road: ROAD_DUSK, roadH: [6, 10] },
  thessaly: { raw: rawThessaly, zones: ZONES_THESSALY, road: ROAD_THESSALY, roadH: [3.8, 5], water: 2.6 },
  korrun: { raw: rawKorrun, zones: ZONES_KORRUN, road: ROAD_KORRUN, roadH: [11, 13] },
};
export const ROAD = ROAD_DUSK;

function shapedHeight(T, x, z) {
  let h = T.raw(x, z);
  // Road flattening
  let best = 1e9, bestT = 0;
  for (let i = 0; i < T.road.length - 1; i++) {
    const [ax, az] = T.road[i], [bx, bz] = T.road[i + 1];
    const d = distPointSegXZ(x, z, ax, az, bx, bz);
    if (d < best) { best = d; bestT = (i + clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2), 0, 1)) / (T.road.length - 1); }
  }
  const roadH = lerp(T.roadH[0], T.roadH[1], smoothstep(0.1, 1, bestT)) + Math.sin(bestT * Math.PI) * 1.5;
  const rw = 1 - smoothstep(4, 12, best);
  h = lerp(h, roadH, rw);
  for (const zn of T.zones) {
    const d = dist2(x, z, zn.x, zn.z);
    const w = 1 - smoothstep(zn.r, zn.r + zn.f, d);
    h = lerp(h, zn.h, w);
  }
  return h;
}

const HF_CACHE = new Map();
function buildHeightfield(planet) {
  if (HF_CACHE.has(planet)) return HF_CACHE.get(planet);
  const T = TERRAIN[planet];
  const hf = new Float32Array((HF_N + 1) * (HF_N + 1));
  for (let iz = 0; iz <= HF_N; iz++) for (let ix = 0; ix <= HF_N; ix++) {
    hf[iz * (HF_N + 1) + ix] = shapedHeight(T, -WORLD_HALF + ix * HF_CELL, -WORLD_HALF + iz * HF_CELL);
  }
  HF_CACHE.set(planet, hf);
  return hf;
}

// One world is active at a time per thread (the server switches before each room's tick)
let ACTIVE = null;
export function useWorld(W) { ACTIVE = W; }
export function activeWorld() { return ACTIVE; }
export function heightfield() { return ACTIVE.hf; }

// Exact height of the rendered triangle mesh at (x, z).
// Cell triangulation: (0,0)(0,1)(1,0) and (1,0)(0,1)(1,1) in (ix, iz) order.
export function terrainHeight(x, z) {
  const hf = ACTIVE.hf;
  const gx = clamp((x + WORLD_HALF) / HF_CELL, 0, HF_N - 1e-4);
  const gz = clamp((z + WORLD_HALF) / HF_CELL, 0, HF_N - 1e-4);
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const W = HF_N + 1;
  const h00 = hf[iz * W + ix], h10 = hf[iz * W + ix + 1];
  const h01 = hf[(iz + 1) * W + ix], h11 = hf[(iz + 1) * W + ix + 1];
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

export function roadDistance(x, z) {
  const road = ACTIVE.road;
  let best = 1e9;
  for (let i = 0; i < road.length - 1; i++) {
    const [ax, az] = road[i], [bx, bz] = road[i + 1];
    best = Math.min(best, distPointSegXZ(x, z, ax, az, bx, bz));
  }
  return best;
}

// ---------------------------------------------------------------- layout

const LAYOUTS = { duskvaro: (W) => buildLayout(W) };
const EXTRAS = {};
export function registerLayout(planet, fn) { LAYOUTS[planet] = fn; }
// Districts added on top of a planet's core layout (farms, mines, markets, spaceports, traffic)
export function extendLayout(planet, fn) { (EXTRAS[planet] ||= []).push(fn); }

export function createWorld(planet = 'duskvaro', opts = {}) {
  if (!TERRAIN[planet]) planet = 'duskvaro';
  const T = TERRAIN[planet];
  const W = {
    planet,
    hf: buildHeightfield(planet),
    road: T.road,
    water: T.water ?? null,
    boxes: [],
    grid: new Map(),
    gridCell: 8,
    doors: {},
    destructibles: {},
    lamps: [],
    cameras: [],
    pois: {},
    civSpots: [],
    guardPosts: [],
    zones: T.zones,
    regions: {},
    decor: [],
    npcs: [],
    herds: [],
    terminals: [],
    towers: [],
    nodes: [],
    workers: [],
    traffic: [],
    pads: [],
    shops: [],
    stamp: 1,
  };
  useWorld(W);
  LAYOUTS[planet](W);
  for (const fn of EXTRAS[planet] || []) fn(W);
  for (const b of W.boxes) indexBox(W, b);
  if (opts.nav !== false) buildNav(W);
  return W;
}

// Move everything a layout section created since mark() by (dx, dz). Lets a whole site be
// authored in its own coordinates and placed anywhere on the map.
export function markWorld(W) {
  return {
    boxes: W.boxes.length, lamps: W.lamps.length, cameras: W.cameras.length, decor: W.decor.length, npcs: W.npcs.length,
    terminals: W.terminals.length, towers: W.towers.length, civSpots: W.civSpots.length, roster: (W.roster || []).length,
    doors: new Set(Object.keys(W.doors)), des: new Set(Object.keys(W.destructibles)), pois: new Set(Object.keys(W.pois)), regions: new Set(Object.keys(W.regions)),
    cams: W.cameras, tow: W.towers, ros: W.roster,
  };
}
export function shiftWorld(W, m, dx, dz) {
  const pt = (o) => { if (o && typeof o.x === 'number') { o.x += dx; o.z += dz; } };
  for (let i = m.boxes; i < W.boxes.length; i++) { const b = W.boxes[i]; b.minX += dx; b.maxX += dx; b.minZ += dz; b.maxZ += dz; }
  for (let i = m.lamps; i < W.lamps.length; i++) pt(W.lamps[i]);
  for (let i = W.cameras === m.cams ? m.cameras : 0; i < W.cameras.length; i++) pt(W.cameras[i]);
  for (let i = m.decor; i < W.decor.length; i++) { const d = W.decor[i]; pt(d); if (d.runs) d.runs = d.runs.map((r) => r.map(([x, z]) => [x + dx, z + dz])); }
  for (let i = m.npcs; i < W.npcs.length; i++) pt(W.npcs[i]); // homes stay where they are
  for (let i = m.terminals; i < W.terminals.length; i++) pt(W.terminals[i]);
  for (let i = W.towers === m.tow ? m.towers : 0; i < W.towers.length; i++) pt(W.towers[i]);
  for (let i = m.civSpots; i < W.civSpots.length; i++) pt(W.civSpots[i]);
  if (W.roster) for (let i = W.roster === m.ros ? m.roster : 0; i < W.roster.length; i++) for (const t of W.roster[i].tasks) pt(t);
  for (const [k, d] of Object.entries(W.doors)) if (!m.doors.has(k)) pt(d);
  for (const [k, d] of Object.entries(W.destructibles)) if (!m.des.has(k)) pt(d);
  for (const [k, p] of Object.entries(W.pois)) if (!m.pois.has(k)) { if (Array.isArray(p)) p.forEach(pt); else pt(p); }
  for (const [k, r] of Object.entries(W.regions)) if (!m.regions.has(k)) {
    if (typeof r.minX === 'number') { r.minX += dx; r.maxX += dx; r.minZ += dz; r.maxZ += dz; } else pt(r);
  }
}

// The crew's ship, the Wayfarer: collision hull plus a decor marker the client renders.
// Faces -Z with the boarding ramp at the rear (+Z) when yaw = 0; yaw may be 0 or PI.
export function placeShip(W, x, y, z, yaw = 0) {
  const s = Math.abs(yaw) > 1 ? -1 : 1;
  box(W, x, y, z, 4.4, 3.0, 11, MAT.HULL, { render: false, tag: 'ship' });
  for (const side of [-1, 1]) {
    box(W, x + side * 3.6, y + 0.9, z + s * 1.5, 3.2, 0.5, 4.2, MAT.HULL, { render: false, tag: 'ship' });
    box(W, x + side * 3.0, y + 0.4, z + s * 3.6, 1.7, 1.7, 4.6, MAT.HULL, { render: false, tag: 'ship' });
  }
  W.decor.push({ type: 'ship', x, y, z, yaw });
  W.pois.ship = { x, z: z + s * 7.2, y };
  W.pois.shipBody = { x, y, z, yaw };
}

export function addBox(W, minX, minY, minZ, maxX, maxY, maxZ, mat, opts = {}) {
  const b = {
    id: W.boxes.length, minX, minY, minZ, maxX, maxY, maxZ, mat,
    solid: opts.solid !== false, render: opts.render !== false, tag: opts.tag || null,
  };
  W.boxes.push(b);
  return b;
}
// Box from centre, base height, and size
export function box(W, cx, y0, cz, w, h, d, mat, opts) {
  return addBox(W, cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, mat, opts);
}

function indexBox(W, b) {
  const c = W.gridCell;
  const x0 = Math.floor(b.minX / c), x1 = Math.floor(b.maxX / c);
  const z0 = Math.floor(b.minZ / c), z1 = Math.floor(b.maxZ / c);
  for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
    const k = gx * 100003 + gz;
    let arr = W.grid.get(k);
    if (!arr) W.grid.set(k, (arr = []));
    arr.push(b);
  }
}

export function queryBoxes(W, minX, minZ, maxX, maxZ, cb) {
  const c = W.gridCell;
  const stamp = ++W.stamp;
  const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
  const z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
  for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
    const arr = W.grid.get(gx * 100003 + gz);
    if (!arr) continue;
    for (const b of arr) {
      if (b._s === stamp) continue;
      b._s = stamp;
      if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
      cb(b);
    }
  }
}

// A rectangular building with walls, a door gap and a roof. Sides: n (-z), s (+z), w (-x), e (+x)
export function building(W, x0, z0, x1, z1, y0, h, mat, doorSide, opts = {}) {
  const t = opts.wall || 0.6;
  const dw = opts.doorW || 2.6, dh = opts.doorH || 2.7;
  const doorOff = opts.doorOff || 0;
  const roof = opts.roof !== false;
  const sides = {
    n: [x0, z0, x1, z0 + t, 'x'],
    s: [x0, z1 - t, x1, z1, 'x'],
    w: [x0, z0, x0 + t, z1, 'z'],
    e: [x1 - t, z0, x1, z1, 'z'],
  };
  let door = null;
  for (const [side, [ax, az, bx, bz, axis]] of Object.entries(sides)) {
    const gaps = [];
    if (side === doorSide) gaps.push(doorOff);
    if (opts.extraDoors) for (const ed of opts.extraDoors) if (ed.side === side) gaps.push(ed.off);
    if (!gaps.length) { addBox(W, ax, y0, az, bx, y0 + h, bz, mat); continue; }
    // Wall with gaps, along axis
    const len0 = axis === 'x' ? ax : az, len1 = axis === 'x' ? bx : bz;
    const mid = (len0 + len1) / 2;
    const gapRanges = gaps.map((o) => [mid + o - dw / 2, mid + o + dw / 2]).sort((a, b) => a[0] - b[0]);
    let cur = len0;
    for (const [g0, g1] of gapRanges) {
      if (g0 > cur) {
        if (axis === 'x') addBox(W, cur, y0, az, g0, y0 + h, bz, mat); else addBox(W, ax, y0, cur, bx, y0 + h, g0, mat);
      }
      // lintel
      if (axis === 'x') addBox(W, g0, y0 + dh, az, g1, y0 + h, bz, mat); else addBox(W, ax, y0 + dh, g0, bx, y0 + h, g1, mat);
      if (!door) {
        door = axis === 'x'
          ? { x: (g0 + g1) / 2, z: (az + bz) / 2, minX: g0, maxX: g1, minZ: az, maxZ: bz, axis, y0, dh }
          : { x: (ax + bx) / 2, z: (g0 + g1) / 2, minX: ax, maxX: bx, minZ: g0, maxZ: g1, axis, y0, dh };
      }
      cur = g1;
    }
    if (cur < len1) {
      if (axis === 'x') addBox(W, cur, y0, az, len1, y0 + h, bz, mat); else addBox(W, ax, y0, cur, bx, y0 + h, len1, mat);
    }
  }
  if (roof) addBox(W, x0 - 0.3, y0 + h, z0 - 0.3, x1 + 0.3, y0 + h + 0.45, z1 + 0.3, opts.roofMat ?? mat);
  if (opts.floor) addBox(W, x0 + t, y0 - 0.2, z0 + t, x1 - t, y0 + 0.02, z1 - t, opts.floor, { solid: true });
  return door;
}

export function addDoor(W, id, d, req, label, opts = {}) {
  const b = addBox(W, d.minX, d.y0, d.minZ, d.maxX, d.y0 + d.dh, d.maxZ, MAT.DOOR, { tag: 'door' });
  W.doors[id] = { id, boxId: b.id, open: !!opts.open, locked: !!req, req, label, x: d.x, z: d.z, y: d.y0, axis: d.axis, startOpen: !!opts.open };
  b.solid = !opts.open;
  return W.doors[id];
}

export function lamp(W, x, z, y0, h = 4.5, r = 9, color = 'warm') {
  box(W, x, y0, z, 0.25, h, 0.25, MAT.METAL_DARK);
  box(W, x, y0 + h, z, 0.7, 0.35, 0.7, MAT.LAMP, { solid: false });
  W.lamps.push({ x, z, y: y0 + h, r, color });
}

export function crate(W, x, z, y0, s = 1.4, h = 1.2) {
  box(W, x, y0, z, s, h, s, MAT.CRATE);
}

const T = (x, z, act = 'look', wait = [1.5, 3.5], face) => ({ x, z, act, wait, face });
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));

function buildLayout(W) {
  const gT = 6; // town ground
  // ---------- Khet Landing (spawn) with the party's shuttle
  const PX = -228, PZ = 62;
  box(W, PX, gT - 0.4, PZ, 22, 0.7, 22, MAT.CONCRETE);
  placeShip(W, PX - 3, gT + 0.3, PZ - 1, 0);
  W.pois.spawn = { x: PX - 3, z: PZ + 8, y: gT + 0.3 };
  lamp(W, PX + 10, PZ - 10, gT + 0.3, 4, 8, 'cool');
  lamp(W, PX - 10, PZ - 10, gT + 0.3, 4, 8, 'cool');

  // ---------- Khet township
  const TX = -160, TZ = 40;
  W.regions.town = { x: TX, z: TZ, r: 72 };
  // Well in the plaza
  box(W, TX, gT, TZ, 2.4, 0.9, 2.4, MAT.ADOBE_DARK);
  W.decor.push({ type: 'well', x: TX, y: gT, z: TZ });
  // Cantina (west side of plaza), door on east facing the plaza
  const cx0 = -198, cz0 = 22, cx1 = -176, cz1 = 40;
  const cd = building(W, cx0, cz0, cx1, cz1, gT, 5.2, MAT.ADOBE, 'e', { doorW: 3, doorH: 3, roofMat: MAT.ADOBE_DARK, floor: MAT.FLOOR });
  W.pois.cantinaDoor = { x: cd.x + 1.5, z: cd.z };
  // bar counter
  box(W, -195, gT, 31, 1.2, 1.1, 10, MAT.WOOD);
  W.pois.bartender = { x: -196.8, z: 31, yaw: -Math.PI / 2 };
  box(W, -197.6, gT + 1.4, 31, 0.4, 0.12, 9, MAT.LAMP, { solid: false });
  box(W, -197.6, gT + 2.2, 31, 0.4, 0.12, 9, MAT.SCREEN, { solid: false });
  W.lamps.push({ x: -184, z: 26, y: gT + 4, r: 8, color: 'warm', inside: true });
  // tables
  const tables = [[-187, 26], [-183, 34], [-189, 36], [-181, 26]];
  for (const [x, z] of tables) { box(W, x, gT, z, 1.6, 0.85, 1.6, MAT.WOOD); }
  W.pois.informant = { x: -189, z: 24.2, yaw: Math.PI };
  W.civSpots.push({ x: -183, z: 32.6, act: 'talk', inside: true }, { x: -185, z: 36.2, act: 'idle', inside: true }, { x: -192, z: 33, act: 'idle', inside: true });
  W.lamps.push({ x: -187, z: 31, y: gT + 4, r: 9, color: 'warm', inside: true });

  // Houses around the plaza
  const houses = [
    [-176, 50, 10, 9, 'e'], [-170, 64, 9, 8, 's'], [-150, 66, 10, 8, 's'], [-132, 58, 9, 9, 'w'],
    [-126, 34, 9, 10, 'w'], [-140, 14, 10, 8, 'n'], [-160, 8, 9, 8, 'n'], [-176, 3, 9, 8, 'n'],
    [-118, 74, 8, 8, 's'], [-205, 58, 9, 9, 'e'],
  ];
  // door faces the plaza: compute from relative position
  houses.forEach(([hx, hz, w, d], i) => {
    const dx = TX - hx, dz = TZ - hz;
    const side = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n');
    const h = 3.6 + (i % 3) * 0.8;
    const door = building(W, hx - w / 2, hz - d / 2, hx + w / 2, hz + d / 2, gT, h, i % 2 ? MAT.ADOBE : MAT.ADOBE_DARK, side, { doorW: 2, doorH: 2.4, roofMat: MAT.ADOBE_DARK });
    // Spot just outside the door
    const ox = side === 'e' ? 1.4 : side === 'w' ? -1.4 : 0, oz = side === 's' ? 1.4 : side === 'n' ? -1.4 : 0;
    W.civSpots.push({ x: door.x + ox, z: door.z + oz, act: 'idle', home: true });
    // Awning over some doors
    if (i % 2 === 0) {
      const aw = side === 'e' || side === 'w' ? [3, 0.15, 3.4] : [3.4, 0.15, 3];
      box(W, door.x + ox * 1.1, gT + 2.8, door.z + oz * 1.1, aw[0], aw[1], aw[2], i % 4 ? MAT.CLOTH : MAT.CLOTH2, { solid: false });
    }
  });

  // Market stalls
  const stall = (x, z, mat, faceYaw) => {
    for (const [ox, oz] of [[-1.6, -1.1], [1.6, -1.1], [-1.6, 1.1], [1.6, 1.1]]) box(W, x + ox, gT, z + oz, 0.18, 2.8, 0.18, MAT.WOOD);
    box(W, x, gT + 2.8, z, 4, 0.12, 3, mat, { solid: false });
    box(W, x, gT, z + 0.6, 3.4, 1.05, 0.8, MAT.WOOD);
  };
  stall(-150, 50, MAT.CLOTH, 0); // Teska
  W.pois.teska = { x: -150, z: 49.2, yaw: Math.PI, faceZ: 52 };
  stall(-168, 54, MAT.CLOTH2, 0); // Bram
  W.pois.bram = { x: -168, z: 53.2, yaw: Math.PI };
  stall(-146, 28, MAT.CLOTH3, 0);
  W.civSpots.push({ x: -150, z: 52.4, act: 'idle' }, { x: -168, z: 56.4, act: 'idle' }, { x: -146, z: 30.4, act: 'idle' }, { x: -146, z: 26.4, act: 'work' });
  // Mission board
  box(W, -164, gT, 30, 2.6, 2.4, 0.4, MAT.METAL_DARK);
  box(W, -164, gT + 0.9, 30.25, 2.2, 1.3, 0.1, MAT.SCREEN, { solid: false });
  W.pois.board = { x: -164, z: 31.4 };
  // Benches & plaza clutter
  for (const [x, z] of [[-156, 36], [-164, 46], [-152, 42]]) box(W, x, gT, z, 2.2, 0.5, 0.6, MAT.WOOD);
  W.civSpots.push({ x: -156, z: 36.8, act: 'sit' }, { x: -164, z: 46.8, act: 'sit' }, { x: -158, z: 42, act: 'talk' }, { x: -160, z: 44, act: 'talk' }, { x: -161, z: 37.6, act: 'idle' });
  for (const [x, z] of [[-136, 46], [-137, 47.6], [-180, 46]]) crate(W, x, z, gT, 1.1, 1);
  for (const [x, z] of [[-160, 28], [-170, 44], [-150, 38], [-140, 50], [-120, 40], [-104, 36]]) lamp(W, x, z, gT, 4, 9, 'warm');
  // Speeder rack at the east edge of town
  W.pois.speeders = [
    { x: -106, z: 31, yaw: -Math.PI / 2 }, { x: -106, z: 34, yaw: -Math.PI / 2 },
    { x: -106, z: 41, yaw: -Math.PI / 2 }, { x: -106, z: 44, yaw: -Math.PI / 2 },
  ];
  box(W, -108.5, gT, 37.5, 0.5, 1.2, 16, MAT.METAL_DARK);

  // ---------- Garrison Seven (authored around x 170, z 0, then shifted east by DUSK_SHIFT)
  // A big compound: the core buildings stand apart with floodlit yards between them, and the ring
  // between them and the walls holds container rows, a motor pool and unlit corners, so a careful
  // crew has routes in that no guard or camera covers.
  const gMark = markWorld(W);
  const gG = 10;
  const X0 = 110, X1 = 230, Z0 = -55, Z1 = 55, WH = 6.2, WT = 1.2;
  // The core was first laid out inside a 90 x 70 m wall. Each building keeps its own shape and is
  // carried out with the walls (mp), so the gaps between them grow with the compound.
  const KX = (X1 - X0) / 90, KZ = (Z1 - Z0) / 70;
  const M = (x, z) => [170 + (x - 170) * KX, z * KZ];
  const UNITS = { cmd: [174, 198, -30, -12], cel: [140, 162, -30, -14], bar: [140, 162, 16, 30], sec: [172, 184, 14, 24], depot: [193, 208, 1, 20], mast: [202, 206, -8, -4], pad: [151.5, 164.5, -3.5, 9.5], mess: [170.4, 178.6, 3.3, 4.7] };
  const delta = {};
  for (const [k, [a, b, c, d]] of Object.entries(UNITS)) { const [mx, mz] = M((a + b) / 2, (c + d) / 2); delta[k] = [mx - (a + b) / 2, mz - (c + d) / 2]; }
  const unitAt = (x, z) => {
    let best = null, bd = 4;
    for (const [k, [a, b, c, d]] of Object.entries(UNITS)) { const dd = Math.hypot(Math.max(a - x, 0, x - b), Math.max(c - z, 0, z - d)); if (dd <= bd) { bd = dd; best = k; } }
    return best;
  };
  const mp = (x, z) => { const u = unitAt(x, z); return u ? [x + delta[u][0], z + delta[u][1]] : M(x, z); };
  const unit = (k, build) => { const m = markWorld(W); build(); shiftWorld(W, m, delta[k][0], delta[k][1]); };
  W.regions.garrison = { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1 };
  // floor slab
  box(W, (X0 + X1) / 2, gG - 0.5, 0, X1 - X0, 0.52, Z1 - Z0, MAT.CONCRETE, { solid: true });
  // north & south walls
  addBox(W, X0, gG, Z0, X1, gG + WH, Z0 + WT, MAT.METAL);
  addBox(W, X0, gG, Z1 - WT, X1, gG + WH, Z1, MAT.METAL);
  // west wall with main gate (z in [-3.5, 3.5])
  addBox(W, X0, gG, Z0, X0 + WT, gG + WH, -3.5, MAT.METAL);
  addBox(W, X0, gG, 3.5, X0 + WT, gG + WH, Z1, MAT.METAL);
  addBox(W, X0 - 0.3, gG + 5, -3.5, X0 + WT + 0.3, gG + WH + 1.2, 3.5, MAT.RED);
  addDoor(W, 'gate', { minX: X0 + 0.2, maxX: X0 + WT - 0.2, minZ: -3.5, maxZ: 3.5, x: X0 + 0.6, z: 0, y0: gG, dh: 5, axis: 'z' }, null, 'Main Gate', { open: true });
  W.pois.gate = { x: X0 - 3, z: 0 };
  // east wall with a drainage culvert (height 1.25) — crouch to pass
  const ductZ = Math.round(-20 * KZ * 10) / 10;
  addBox(W, X1 - WT, gG, Z0, X1, gG + WH, ductZ - 1.1, MAT.METAL);
  addBox(W, X1 - WT, gG + 1.25, ductZ - 1.1, X1, gG + WH, ductZ + 1.1, MAT.METAL);
  addBox(W, X1 - WT, gG, ductZ + 1.1, X1, gG + WH, Z1, MAT.METAL);
  W.pois.culvert = { x: X1 + 2, z: ductZ };
  W.decor.push({ type: 'culvert', x: X1 - WT / 2, y: gG, z: ductZ });
  // watchtowers
  W.towers = [];
  for (const [tx, tz] of [[X0 + 3, Z0 + 3], [X1 - 3, Z0 + 3], [X0 + 3, Z1 - 3], [X1 - 3, Z1 - 3]]) {
    box(W, tx, gG, tz, 2.6, 8, 2.6, MAT.METAL_DARK);
    box(W, tx, gG + 8, tz, 5, 0.4, 5, MAT.METAL);
    for (const [ox, oz, w, d] of [[0, -2.4, 5, 0.2], [0, 2.4, 5, 0.2], [-2.4, 0, 0.2, 5], [2.4, 0, 0.2, 5]]) box(W, tx + ox, gG + 8.4, tz + oz, w, 1.0, d, MAT.METAL_DARK);
    box(W, tx, gG + 10.6, tz, 5.2, 0.3, 5.2, MAT.RED, { solid: false });
    W.towers.push({ x: tx, z: tz, y: gG + 8.4 });
  }
  // Command building (keycard), door on west facing courtyard
  unit('cmd', () => {
    const cmd = building(W, 174, -30, 198, -12, gG, 7, MAT.METAL, 'w', { doorW: 2.6, doorH: 3, roofMat: MAT.METAL_DARK, wall: 0.7 });
    addDoor(W, 'command', cmd, 'keycard', 'Command Center');
    // interior dividing wall with vault door
    addBox(W, 189, gG, -29.3, 189.6, gG + 7, -22.4, MAT.METAL_DARK);
    addBox(W, 189, gG, -19.6, 189.6, gG + 7, -12.7, MAT.METAL_DARK);
    addBox(W, 189, gG + 3, -22.4, 189.6, gG + 7, -19.6, MAT.METAL_DARK);
    box(W, 194, gG, -21, 1.4, 1.3, 3, MAT.METAL_DARK); // vault console
    box(W, 194.8, gG + 1.3, -21, 0.2, 1, 2.6, MAT.SCREEN, { solid: false });
    W.pois.vault = { x: 192.6, z: -21 };
    box(W, 180, gG, -26, 3, 0.9, 1.4, MAT.METAL_DARK); // desk
    box(W, 184, gG, -16, 1.2, 2.2, 3, MAT.METAL_DARK); // locker
    W.pois.cmdInside = { x: 180, z: -21 };
    W.lamps.push({ x: 182, z: -21, y: gG + 6, r: 8, color: 'cool', inside: true });
    W.regions.command = { minX: 174.5, maxX: 197.5, minZ: -29.5, maxZ: -12.5 };
  });
  // Cell block (code door) — door on the south side (+z) facing courtyard
  unit('cel', () => {
    const cel = building(W, 140, -30, 162, -14, gG, 5, MAT.METAL, 's', { doorW: 2.6, doorH: 2.8, roofMat: MAT.METAL_DARK });
    addDoor(W, 'cellblock', cel, 'cellcode', 'Detention Block');
    // three cells along the north wall
    for (let i = 0; i < 3; i++) {
      const x0 = 141 + i * 6.6, x1 = x0 + 6.0;
      addBox(W, x1, gG, -29.4, x1 + 0.4, gG + 5, -24, MAT.METAL_DARK);
      addBox(W, x0 + 0.2, gG, -24.2, x0 + 2.2, gG + 3, -23.8, MAT.BARS);
      addBox(W, x0 + 4.2, gG, -24.2, x1, gG + 3, -23.8, MAT.BARS);
      if (i === 1) addDoor(W, 'cell', { minX: x0 + 2.2, maxX: x0 + 4.2, minZ: -24.2, maxZ: -23.8, x: x0 + 3.2, z: -24, y0: gG, dh: 3, axis: 'x' }, 'hold', 'Cell 2');
      else addBox(W, x0 + 2.2, gG, -24.2, x0 + 4.2, gG + 3, -23.8, MAT.BARS);
    }
    W.pois.prisoner = { x: 151.2, z: -27 };
    W.pois.cellInside = { x: 151, z: -19 };
    W.lamps.push({ x: 151, z: -20, y: gG + 4.5, r: 7, color: 'cool', inside: true });
  });
  // Barracks (open door, reinforcement spawn)
  unit('bar', () => {
    const bar = building(W, 140, 16, 162, 30, gG, 5, MAT.METAL, 'n', { doorW: 3, doorH: 3, roofMat: MAT.METAL_DARK });
    W.pois.barracks = { x: 151, z: 23 };
    W.pois.barracksDoor = { x: bar.x, z: bar.z - 2 };
    for (let i = 0; i < 4; i++) box(W, 143.5 + i * 4.5, gG, 27.5, 2.2, 0.6, 3.2, MAT.METAL_DARK);
  });
  // Security office (open door), alarm/camera terminal inside
  unit('sec', () => {
    const sec = building(W, 172, 14, 184, 24, gG, 4.2, MAT.METAL, 'w', { doorW: 2.4, doorH: 2.8, roofMat: MAT.METAL_DARK });
    box(W, 181.8, gG, 19, 1.0, 1.2, 4, MAT.METAL_DARK);
    box(W, 182.4, gG + 1.2, 19, 0.15, 1.2, 3.4, MAT.SCREEN, { solid: false });
    W.pois.security = { x: 180.2, z: 19 };
    W.pois.secDoor = { x: sec.x - 2, z: sec.z };
    W.lamps.push({ x: 178, z: 19, y: gG + 3.8, r: 6, color: 'cool', inside: true });
  });
  // Fuel depot with four tanks + low blast walls
  W.tanks = [];
  unit('depot', () => {
    const tankPos = [[198, 6], [206, 6], [198, 15], [206, 15]];
    tankPos.forEach(([x, z], i) => {
      const b = box(W, x, gG, z, 3.6, 5, 3.6, MAT.FUEL, { tag: 'tank' });
      W.destructibles['tank' + i] = { id: 'tank' + i, kind: 'tank', x, z, y: gG, hp: 90, maxHp: 90, boxId: b.id, radius: 2.2, height: 5, destroyed: false };
    });
    addBox(W, 193, gG, 1, 193.6, gG + 1.4, 20, MAT.CONCRETE);
    W.pois.depot = { x: 202, z: 10.5 };
  });
  // Comms mast
  unit('mast', () => {
    const b = box(W, 204, gG, -6, 2.4, 22, 2.4, MAT.METAL_DARK, { tag: 'mast' });
    W.destructibles.mast = { id: 'mast', kind: 'mast', x: 204, z: -6, y: gG, hp: 320, maxHp: 320, boxId: b.id, radius: 1.6, height: 22, destroyed: false };
    W.pois.mast = { x: 204, z: -6 };
  });
  // Dropship pad in the courtyard (cover)
  unit('pad', () => {
    box(W, 158, gG, 3, 13, 0.25, 13, MAT.CONCRETE);
    box(W, 158, gG + 0.25, 3, 5, 3, 9, MAT.HULL);
    box(W, 158, gG + 1.6, 3, 13, 0.5, 3, MAT.HULL);
    W.decor.push({ type: 'dropship', x: 158, y: gG + 0.25, z: 3 });
  });
  // Mess tables
  unit('mess', () => {
    for (const [x, z] of [[172, 4], [177, 4]]) box(W, x, gG, z, 3.2, 0.85, 1.4, MAT.METAL_DARK);
    W.pois.mess = { x: 174.5, z: 6 };
  });
  // Crates for cover
  const crates = [[136, -6], [137.6, -6], [136.8, -6, 2.4], [140, 9], [166, -8], [167.5, -8.3], [189, 0], [189, 1.5], [189, 3], [210, -12], [210, -14.5], [208.5, -13], [132, 24], [133.6, 25], [186, 28], [187.6, 28], [200, -26], [201.4, -27.5], [168, 28], [145, -9]];
  for (const c of crates) {
    const [x, z] = mp(c[0], c[1]);
    if (c[2]) box(W, x, gG + 1.2, z, 1.3, 1.1, 1.3, MAT.CRATE);
    else crate(W, x, z, gG);
  }

  // ---- the outer ring: cover and shadow between the core and the walls
  // shipping containers, 2.6 m tall (stacked ones twice that), in rows that leave alleys between them
  const container = (x, z, len, alongX, stack = 1, mat = MAT.METAL_DARK) => {
    for (let k = 0; k < stack; k++) box(W, x, gG + k * 2.6, z, alongX ? len : 2.5, 2.6, alongX ? 2.5 : len, k % 2 ? MAT.HULL : mat);
  };
  container(213, -42, 10, true, 2);           // north-east yard, behind the command block
  container(213, -30, 8, true, 1, MAT.HULL);
  container(222, -36, 5, false, 1);
  container(165, -38, 8, false, 2);           // between the cell block and the command block
  container(122, -31, 8, false, 1);           // west yard, either side of the gate road
  container(122, 31, 8, false, 2, MAT.HULL);
  container(165, 44, 10, true, 1);            // south yard, between the barracks and the security office
  container(173, 48.5, 6, true, 1, MAT.HULL);
  // motor pool: an open shed over two parked haulers in the south-east corner
  for (const [x, z] of [[194, 36], [212, 36], [194, 46], [212, 46]]) box(W, x, gG, z, 0.4, 4.4, 0.4, MAT.METAL_DARK);
  box(W, 203, gG + 4.4, 41, 19.4, 0.35, 11.4, MAT.METAL);
  for (const x of [199, 207]) { box(W, x, gG, 41, 2.4, 1.2, 6.4, MAT.METAL_DARK); box(W, x, gG + 1.2, 39, 2.3, 1.3, 2, MAT.HULL); }
  // sandbag lines across the open yards: crouch-high cover
  for (const [x, z, len, alongX] of [[132, -10, 5, false], [134, 12, 5, false], [172, -14, 6, true], [192, 2, 5, false], [188, -50, 6, true], [142, 50, 6, true]]) box(W, x, gG, z, alongX ? len : 0.9, 1.05, alongX ? 0.9 : len, MAT.CLOTH3);
  // Floodlights over the core and its yards; the outer ring is left dark
  for (const [x, z] of [[130, -12], [130, 12], [165, -10], [165, 12], [196, 26], [196, -4], [210, -24], [150, 32], [145, -12]]) { const [lx, lz] = mp(x, z); lamp(W, lx, lz, gG, 5.5, 10, 'flood'); }
  lamp(W, 140, -4, gG, 5.5, 10, 'flood'); // over the courtyard inside the gate
  W.pois.courtyard = { x: 141, z: 0 };
  lamp(W, X0 - 4, -6, gG, 5, 10, 'flood');
  lamp(W, X0 - 4, 6, gG, 5, 10, 'flood');
  // Security cameras {x,y,z,yaw,sweep}: the five inside moved out with their buildings
  const cam = (id, x, z, y, yaw, sweep, speed) => { const [cx, cz] = mp(x, z); return { id, x: cx, y, z: cz, yaw, sweep, speed }; };
  const c4 = M(202, -33.6);
  W.cameras = [
    { id: 'c0', x: X0 + 1.4, y: gG + 5.2, z: -4.2, yaw: Math.PI / 2 + 0.2, sweep: 0.75, speed: 0.4 }, // gate, looking west
    cam('c1', 173.4, -11.4, gG + 5.4, Math.PI * 0.5 + 0.55, 0.9, 0.33), // courtyard from command corner
    cam('c2', 154, -13.6, gG + 4.4, Math.PI, 0.8, 0.38), // cell block door
    cam('c3', 194, 21, gG + 4.2, -Math.PI / 2 - 0.5, 0.7, 0.3), // depot
    { id: 'c4', x: c4[0], y: gG + 5, z: c4[1], yaw: yawTo(c4[0], c4[1], X1 - 3, ductZ) - 0.2, sweep: 0.6, speed: 0.35 }, // culvert corner, looking toward the culvert
    cam('c5', 189.8, -13.4, gG + 5.5, -Math.PI / 2 - 0.3, 0.6, 0.4), // vault room
  ];

  W.pois.gatePanel = { x: X0 + 2.6, z: 5 };
  for (const [x, z, ry] of [[X0 - 0.7, -8, Math.PI / 2], [X0 - 0.7, 8, Math.PI / 2], [170, Z0 - 0.7, 0], [170, Z1 + 0.7, 0]]) W.decor.push({ type: 'banner', x, y: 13.2, z, ry });
  W.roster = duskRoster(W, mp);
  shiftWorld(W, gMark, DUSK_SHIFT, 0);
  W.siteShift = { dx: DUSK_SHIFT, dz: 0 };
  // Road patrol between the Spine pass and the gate
  W.roster.push({ name: 'road-a', road: true, tasks: [T(284, 3, 'scan', [4, 7]), T(214, 8.4, 'look', [4, 7])] });
  W.roster.push({ name: 'road-b', road: true, offset: 1.4, tasks: [T(284, 4.6, 'idle', [4, 7]), T(214, 10, 'scan', [4, 7])] });

  // Ridge LZ (extraction)
  box(W, 238, 11 - 0.3, 66, 12, 0.5, 12, MAT.CONCRETE);
  W.pois.lz = { x: 238, z: 66 };
  lamp(W, 232, 60, 11.2, 3.5, 7, 'cool');
  lamp(W, 244, 72, 11.2, 3.5, 7, 'cool');

  // Rock scatter for cover/flavour along the road and desert
  const rocks = [[-30, 6, 3], [20, 48, 2.4], [60, -4, 3.2], [95, 34, 2.6], [200, -12, 3], [205, 30, 2.2], [20, -40, 4], [40, -80, 3.5], [110, -70, 3], [-10, 100, 2.8], [80, 100, 3.2], [-20, 130, 2.4], [240, 30, 2.8], [280, 40, 3.5], [270, -40, 3], [260, -80, 3.6], [190, 80, 2.6], [-330, 20, 3.4]];
  for (const [x, z, s] of rocks) {
    const y = terrainHeight(x, z) - 0.5;
    box(W, x, y, z, s, s * 0.9, s * 1.1, MAT.ROCK);
    W.decor.push({ type: 'rock', x, y, z, s });
  }
  // Guard posts for road patrol
  W.pois.roadA = { x: 284, z: 3 };
  W.pois.roadB = { x: 214, z: 8.4 };
  // Data the simulation spawns from
  W.npcs.push(
    { kind: 'merchant', merchant: 'teska', ...W.pois.teska },
    { kind: 'merchant', merchant: 'bram', ...W.pois.bram },
    { kind: 'informant', contact: 'oru', ...W.pois.informant },
    { kind: 'bartender', ...W.pois.bartender, spots: [{ x: -196.8, z: 27.5 }, { x: -196.8, z: 31 }, { x: -196.8, z: 34.5 }] },
  );
  W.herds = [{ x: 10, z: -60 }, { x: 30, z: 110 }, { x: 120, z: -90 }, { x: -40, z: 150 }];
  W.critterBounds = [-60, 260, -180, 180];
  W.civCount = 11;
  W.terminals.push({ id: 'security', kind: 'security', x: W.pois.security.x, z: W.pois.security.z }, { id: 'vault', kind: 'vault', x: W.pois.vault.x, z: W.pois.vault.z });
  W.officerName = 'Commander Rhal';
  W.decor.push({ type: 'stringlights', y: 10.2, runs: [[[-176, 46], [-150, 54]], [[-170, 30], [-140, 46]], [[-180, 38], [-132, 38]]] });
}

// patrols as first authored for the 90 x 70 compound; mp carries each stop out with the building it
// belongs to, or with the walls
function duskRoster(W, mp) {
  const towerYaw = (tx, tz) => yawTo(170, 0, tx, tz);
  const roster = [
    { name: 'gate-l', post: true, tasks: [T(121.6, -4.6, 'scan', [5, 9], Math.PI / 2)] },
    { name: 'gate-r', post: true, tasks: [T(121.6, 4.6, 'scan', [5, 9], Math.PI / 2)] },
    { name: 'court', tasks: [T(135, -12), T(135, 11), T(166, 13.5, 'look', [2, 4]), T(168, -11), T(150, -11, 'scan', [2, 4])] },
    { name: 'inner', tasks: [T(132, -31.6, 'look', [1, 2]), T(170, -31.8, 'look', [1, 2]), T(207.5, -31.6, 'scan', [2, 3]), T(211, -10), T(211, 24, 'look', [1, 2]), T(207, 31.6), T(132, 31.6, 'scan', [2, 3]), T(130.5, 12)] },
    { name: 'outer', tasks: [T(119, -40, 'scan', [2, 4]), T(170, -41), T(221, -40, 'look', [2, 3]), T(221, -20, 'look', [1, 2]), T(221, 40, 'scan', [2, 3]), T(170, 41), T(119, 40)] },
    { name: 'cell', tasks: [T(145, -18.5, 'look', [3, 6]), T(157, -18.5, 'look', [3, 6])] },
    { name: 'mess-a', tasks: [T(171.2, 6, 'talk', [10, 16], Math.PI * 0.5 * -1), T(151, 12.5, 'idle', [3, 5]), T(171.2, 6, 'talk', [10, 16])] },
    { name: 'mess-b', tasks: [T(174.4, 6.3, 'talk', [12, 18], Math.PI / 2), T(166, 18, 'look', [2, 4])] },
    { name: 'depot', tasks: [T(196.5, 10.5, 'work', [3, 6], -Math.PI / 2), T(202, 10.5, 'work', [3, 5]), T(210.5, 10, 'work', [3, 5], Math.PI / 2), T(202, 1.5, 'look', [2, 4])] },
    { name: 'sec', tasks: [T(180.2, 17.8, 'work', [8, 14], -Math.PI / 2), T(175, 19, 'look', [2, 4])] },
    { name: 'courier', tasks: [T(171.2, -21, 'look', [2, 4]), T(151, 12.5, 'idle', [2, 4]), T(168, 8.5, 'look', [1, 2]), T(186, 9, 'work', [3, 5])] },
  ];
  roster.push({
    name: 'rhal', officer: true,
    tasks: [T(171.5, -19, 'look', [4, 6]), T(190.5, 8.5, 'look', [3, 4]), T(174.6, 8, 'talk', [5, 8]), T(151, -11.4, 'look', [3, 4]), T(130, 0, 'scan', [4, 6]), T(140, 12, 'look', [2, 3])],
  });
  for (const r of roster) for (const t of r.tasks) [t.x, t.z] = mp(t.x, t.z);
  // the outer patrol walks the new, longer wall line
  W.towers.forEach((t, i) => roster.push({ name: 'tower' + i, post: true, tower: t, tasks: [T(t.x, t.z, 'scan', [4, 8], towerYaw(t.x, t.z) + Math.PI)] }));
  return roster;
}

// ---------------------------------------------------------------- doors & destructibles

export function setDoorOpen(W, id, open) {
  const d = W.doors[id];
  if (!d) return;
  d.open = open;
  W.boxes[d.boxId].solid = !open;
  if (W.nav) updateNavForBox(W, W.boxes[d.boxId]);
}

// ---------------------------------------------------------------- physics

export const SLOPE_MAX = 1.25;
const STEP = 0.55;

export function groundAt(W, x, z, maxY, r = 0.3) {
  let h = terrainHeight(x, z);
  queryBoxes(W, x - r, z - r, x + r, z + r, (b) => {
    if (!b.solid) return;
    if (b.maxY <= maxY + 1e-3 && b.maxY > h) h = b.maxY;
  });
  return h;
}

// Kinematic character body vs boxes + terrain.
// body: {x,y,z,vx,vy,vz,r,h,onGround}
export function moveBody(W, b, dt, opts = {}) {
  const r = b.r, gravity = opts.gravity ?? GRAVITY;
  if (!opts.noGravity) b.vy -= gravity * dt;
  b.hitWall = false;
  let nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
  // Steep terrain blocks uphill movement
  const hd = Math.hypot(nx - b.x, nz - b.z);
  if (hd > 1e-5) {
    const hOld = terrainHeight(b.x, b.z), hNew = terrainHeight(nx, nz);
    if (hNew > b.y + 0.25 && (hNew - hOld) / hd > SLOPE_MAX) {
      // try sliding along each axis
      const hX = terrainHeight(nx, b.z), hZ = terrainHeight(b.x, nz);
      if (!(hX > b.y + 0.25 && (hX - hOld) / Math.abs(nx - b.x + 1e-6) > SLOPE_MAX)) { nz = b.z; b.vz = 0; }
      else if (!(hZ > b.y + 0.25 && (hZ - hOld) / Math.abs(nz - b.z + 1e-6) > SLOPE_MAX)) { nx = b.x; b.vx = 0; }
      else { nx = b.x; nz = b.z; b.vx = 0; b.vz = 0; }
      b.hitWall = true;
    }
  }
  let stepTo = -Infinity;
  const y = b.y;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    queryBoxes(W, nx - r, nz - r, nx + r, nz + r, (bx) => {
      if (!bx.solid) return;
      if (bx.maxY <= y + 0.02 || bx.minY >= y + b.h - 0.02) return;
      const px = clamp(nx, bx.minX, bx.maxX), pz = clamp(nz, bx.minZ, bx.maxZ);
      const dx = nx - px, dz = nz - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return;
      // Step up onto low boxes if there is headroom
      if (bx.maxY - y <= STEP && (b.onGround || opts.canStep) && !headBlocked(W, nx, nz, bx.maxY, b.h, r)) {
        stepTo = Math.max(stepTo, bx.maxY);
        return;
      }
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        const ux = dx / d, uz = dz / d;
        nx = px + ux * r; nz = pz + uz * r;
        const vn = b.vx * ux + b.vz * uz;
        if (vn < 0) { b.vx -= vn * ux; b.vz -= vn * uz; }
      } else {
        // Centre inside the box: push out along the shallowest axis
        const pen = [nx - bx.minX + r, bx.maxX - nx + r, nz - bx.minZ + r, bx.maxZ - nz + r];
        const m = Math.min(...pen);
        if (m === pen[0]) { nx = bx.minX - r; b.vx = Math.min(0, b.vx); }
        else if (m === pen[1]) { nx = bx.maxX + r; b.vx = Math.max(0, b.vx); }
        else if (m === pen[2]) { nz = bx.minZ - r; b.vz = Math.min(0, b.vz); }
        else { nz = bx.maxZ + r; b.vz = Math.max(0, b.vz); }
      }
      b.hitWall = true;
      moved = true;
    });
    if (!moved) break;
  }
  nx = clamp(nx, -WORLD_HALF + 2, WORLD_HALF - 2);
  nz = clamp(nz, -WORLD_HALF + 2, WORLD_HALF - 2);
  b.x = nx; b.z = nz;
  // Vertical
  let ny = b.y + b.vy * dt;
  if (stepTo > ny) ny = stepTo;
  const ground = groundAt(W, nx, nz, Math.max(b.y, ny) + 0.05, r * 0.85);
  const wasGround = b.onGround;
  if (ny <= ground) {
    ny = ground;
    if (b.vy < 0) { b.landSpeed = -b.vy; b.vy = 0; }
    b.onGround = true;
  } else if (wasGround && b.vy <= 0 && ny - ground < 0.65 && !opts.noSnap) {
    ny = ground; b.vy = 0; b.onGround = true; // stick to slopes and stairs going down
  } else {
    b.onGround = false;
  }
  // Ceiling
  if (ny > b.y || b.vy > 0) {
    queryBoxes(W, nx - r * 0.8, nz - r * 0.8, nx + r * 0.8, nz + r * 0.8, (bx) => {
      if (!bx.solid) return;
      if (bx.minY >= b.y + b.h - 0.08 && bx.minY < ny + b.h) {
        ny = Math.min(ny, bx.minY - b.h);
        if (b.vy > 0) b.vy = 0;
      }
    });
  }
  b.y = ny;
  return b;
}

function headBlocked(W, x, z, y, h, r) {
  let blocked = false;
  queryBoxes(W, x - r, z - r, x + r, z + r, (bx) => {
    if (bx.solid && bx.minY < y + h && bx.maxY > y + 0.02 && bx.minY > y - 0.01) {
      const px = clamp(x, bx.minX, bx.maxX), pz = clamp(z, bx.minZ, bx.maxZ);
      if ((x - px) ** 2 + (z - pz) ** 2 < r * r) blocked = true;
    }
  });
  return blocked;
}

// Can a body stand up here (for uncrouching)?
export function canStand(W, x, y, z, r, h) {
  let ok = true;
  queryBoxes(W, x - r, z - r, x + r, z + r, (bx) => {
    if (!bx.solid || !ok) return;
    if (bx.minY < y + h && bx.maxY > y + 0.6) {
      const px = clamp(x, bx.minX, bx.maxX), pz = clamp(z, bx.minZ, bx.maxZ);
      if ((x - px) ** 2 + (z - pz) ** 2 < r * r * 0.9) ok = false;
    }
  });
  return ok;
}

// ---------------------------------------------------------------- raycasting

function rayBox(ox, oy, oz, idx, idy, idz, b) {
  let t1 = (b.minX - ox) * idx, t2 = (b.maxX - ox) * idx;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  let ax = 0;
  t1 = (b.minY - oy) * idy; t2 = (b.maxY - oy) * idy;
  const ymin = Math.min(t1, t2), ymax = Math.max(t1, t2);
  if (ymin > tmin) { tmin = ymin; ax = 1; }
  tmax = Math.min(tmax, ymax);
  t1 = (b.minZ - oz) * idz; t2 = (b.maxZ - oz) * idz;
  const zmin = Math.min(t1, t2), zmax = Math.max(t1, t2);
  if (zmin > tmin) { tmin = zmin; ax = 2; }
  tmax = Math.min(tmax, zmax);
  if (tmax < Math.max(tmin, 0)) return null;
  return { t: tmin < 0 ? 0 : tmin, axis: ax };
}

// Returns {t, x,y,z, nx,ny,nz, box} or null. dir must be normalized.
export function raycast(W, ox, oy, oz, dx, dy, dz, maxDist, opts = {}) {
  let best = maxDist, hitBox = null, hitAxis = 0;
  const idx = 1 / (dx || 1e-12), idy = 1 / (dy || 1e-12), idz = 1 / (dz || 1e-12);
  if (opts.boxes !== false) {
    // Walk the broadphase grid along the ray in XZ
    const c = W.gridCell;
    let gx = Math.floor(ox / c), gz = Math.floor(oz / c);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const hdx = Math.abs(dx) < 1e-9 ? 1e-9 : dx, hdz = Math.abs(dz) < 1e-9 ? 1e-9 : dz;
    let tMaxX = ((gx + (stepX > 0 ? 1 : 0)) * c - ox) / hdx;
    let tMaxZ = ((gz + (stepZ > 0 ? 1 : 0)) * c - oz) / hdz;
    const tDX = Math.abs(c / hdx), tDZ = Math.abs(c / hdz);
    const stamp = ++W.stamp;
    let tCell = 0;
    for (let i = 0; i < 400 && tCell <= best; i++) {
      const arr = W.grid.get(gx * 100003 + gz);
      if (arr) for (const b of arr) {
        if (b._s === stamp) continue;
        b._s = stamp;
        if (!b.solid && !opts.includeNonSolid) continue;
        if (opts.ignore && opts.ignore(b)) continue;
        const h = rayBox(ox, oy, oz, idx, idy, idz, b);
        if (h && h.t < best) { best = h.t; hitBox = b; hitAxis = h.axis; }
      }
      if (tMaxX < tMaxZ) { tCell = tMaxX; tMaxX += tDX; gx += stepX; } else { tCell = tMaxZ; tMaxZ += tDZ; gz += stepZ; }
    }
  }
  let terrainHit = false;
  if (opts.terrain !== false) {
    const stepLen = opts.terrainStep || 1.0;
    let prevT = 0;
    let prevAbove = oy - terrainHeight(ox, oz);
    if (prevAbove < 0) { /* origin under ground */ }
    else {
      for (let t = stepLen; t <= best + stepLen; t += stepLen) {
        const tt = Math.min(t, best);
        const above = oy + dy * tt - terrainHeight(ox + dx * tt, oz + dz * tt);
        if (above < 0) {
          let lo = prevT, hi = tt;
          for (let k = 0; k < 7; k++) {
            const m = (lo + hi) / 2;
            if (oy + dy * m - terrainHeight(ox + dx * m, oz + dz * m) < 0) hi = m; else lo = m;
          }
          if (hi < best) { best = hi; terrainHit = true; hitBox = null; }
          break;
        }
        prevT = tt;
        prevAbove = above;
        if (tt >= best) break;
      }
    }
  }
  if (!hitBox && !terrainHit) return null;
  const x = ox + dx * best, y = oy + dy * best, z = oz + dz * best;
  let nx = 0, ny = 1, nz = 0;
  if (hitBox) {
    nx = 0; ny = 0; nz = 0;
    if (hitAxis === 0) nx = dx > 0 ? -1 : 1; else if (hitAxis === 1) ny = dy > 0 ? -1 : 1; else nz = dz > 0 ? -1 : 1;
  } else {
    const e = 0.5;
    const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
    const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    nx = -hx / l; ny = (2 * e) / l; nz = -hz / l;
  }
  return { t: best, x, y, z, nx, ny, nz, box: hitBox, terrain: terrainHit };
}

export function lineOfSight(W, ax, ay, az, bx, by, bz, opts) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) return true;
  const hit = raycast(W, ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, opts);
  return !hit;
}

// Is the point shaded from the low sun by a building?
export function inShadow(W, x, y, z) {
  return !!raycast(W, x, y, z, SUN_DIR.x, SUN_DIR.y, SUN_DIR.z, 60, { terrain: true, terrainStep: 2 });
}

export function lampLight(W, x, z) {
  let best = 0;
  for (const l of W.lamps) {
    const d = dist2(x, z, l.x, l.z);
    if (d < l.r) best = Math.max(best, 1 - d / l.r);
  }
  return best;
}

// ---------------------------------------------------------------- navigation grid

export const NAV = { minX: -310, maxX: 430, minZ: -215, maxZ: 215, cell: 1.0 };

function buildNav(W) {
  const nw = Math.round((NAV.maxX - NAV.minX) / NAV.cell);
  const nh = Math.round((NAV.maxZ - NAV.minZ) / NAV.cell);
  const blocked = new Uint8Array(nw * nh);
  const ground = new Float32Array(nw * nh);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
    const x = NAV.minX + (i + 0.5) * NAV.cell, z = NAV.minZ + (j + 0.5) * NAV.cell;
    const h = terrainHeight(x, z);
    ground[j * nw + i] = h;
    const s = Math.max(
      Math.abs(terrainHeight(x + 0.8, z) - terrainHeight(x - 0.8, z)),
      Math.abs(terrainHeight(x, z + 0.8) - terrainHeight(x, z - 0.8)),
    ) / 1.6;
    if (s > 0.85) blocked[j * nw + i] = 1;
  }
  W.nav = { nw, nh, blocked, ground, base: null, gen: new Int32Array(nw * nh), g: new Float32Array(nw * nh), from: new Int32Array(nw * nh), genId: 0 };
  // Box pass: platforms raise ground; obstacles block
  for (const b of W.boxes) rasterBox(W, b, true);
  W.nav.base = blocked.slice();
  // Doors: closed doors block
  for (const d of Object.values(W.doors)) updateNavForBox(W, W.boxes[d.boxId]);
}

function boxCells(W, b, pad) {
  const n = W.nav;
  const i0 = Math.max(0, Math.floor((b.minX - pad - NAV.minX) / NAV.cell));
  const i1 = Math.min(n.nw - 1, Math.floor((b.maxX + pad - NAV.minX) / NAV.cell));
  const j0 = Math.max(0, Math.floor((b.minZ - pad - NAV.minZ) / NAV.cell));
  const j1 = Math.min(n.nh - 1, Math.floor((b.maxZ + pad - NAV.minZ) / NAV.cell));
  return [i0, i1, j0, j1];
}

function rasterBox(W, b, initial) {
  if (!b.solid && initial && b.tag !== 'door') return;
  const n = W.nav, pad = 0.38;
  const [i0, i1, j0, j1] = boxCells(W, b, pad);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = NAV.minX + (i + 0.5) * NAV.cell, z = NAV.minZ + (j + 0.5) * NAV.cell;
    if (x < b.minX - pad || x > b.maxX + pad || z < b.minZ - pad || z > b.maxZ + pad) continue;
    const k = j * n.nw + i;
    const g = n.ground[k];
    if (b.tag === 'door') continue; // doors handled separately
    if (b.maxY <= g + 0.6 && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
      n.ground[k] = Math.max(g, b.maxY); // walkable platform
      continue;
    }
    if (b.maxY > g + 0.35 && b.minY < g + 1.8) n.blocked[k] = 1;
  }
}

function updateNavForBox(W, b) {
  const n = W.nav, pad = 0.38;
  const [i0, i1, j0, j1] = boxCells(W, b, pad);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = NAV.minX + (i + 0.5) * NAV.cell, z = NAV.minZ + (j + 0.5) * NAV.cell;
    if (x < b.minX - pad || x > b.maxX + pad || z < b.minZ - pad || z > b.maxZ + pad) continue;
    const k = j * n.nw + i;
    n.blocked[k] = b.solid ? 1 : n.base[k];
  }
}

export function navCell(x, z) {
  return [Math.floor((x - NAV.minX) / NAV.cell), Math.floor((z - NAV.minZ) / NAV.cell)];
}
export function navWalkable(W, x, z) {
  const n = W.nav;
  const [i, j] = navCell(x, z);
  if (i < 0 || j < 0 || i >= n.nw || j >= n.nh) return false;
  return !n.blocked[j * n.nw + i];
}

function nearestWalkable(W, i, j) {
  const n = W.nav;
  for (let r = 0; r < 6; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n.nw || b >= n.nh) continue;
      if (!n.blocked[b * n.nw + a]) return [a, b];
    }
  }
  return null;
}

// Grid line walk check
function walkLine(W, ax, az, bx, bz) {
  const d = dist2(ax, az, bx, bz);
  const steps = Math.ceil(d / 0.45);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (!navWalkable(W, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

// A* on the nav grid. Returns array of {x,z} waypoints (excluding start) or null.
export function findPath(W, sx, sz, tx, tz, maxNodes = 9000) {
  const n = W.nav;
  let [si, sj] = navCell(sx, sz), [ti, tj] = navCell(tx, tz);
  if (si < 0 || sj < 0 || si >= n.nw || sj >= n.nh || ti < 0 || tj < 0 || ti >= n.nw || tj >= n.nh) return null;
  if (n.blocked[sj * n.nw + si]) { const s = nearestWalkable(W, si, sj); if (!s) return null; [si, sj] = s; }
  if (n.blocked[tj * n.nw + ti]) { const t = nearestWalkable(W, ti, tj); if (!t) return null; [ti, tj] = t; }
  if (walkLine(W, sx, sz, tx, tz)) return [{ x: tx, z: tz }];
  const gen = ++n.genId;
  const start = sj * n.nw + si, goal = tj * n.nw + ti;
  const heap = new MinHeap();
  n.gen[start] = gen; n.g[start] = 0; n.from[start] = -1;
  const h = (k) => {
    const i = k % n.nw, j = (k / n.nw) | 0;
    const dx = Math.abs(i - ti), dz = Math.abs(j - tj);
    return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  heap.push(start, h(start));
  const closedGen = -gen;
  let expanded = 0, found = false;
  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.size) {
    const k = heap.pop();
    if (n.gen[k] === closedGen) continue;
    if (k === goal) { found = true; break; }
    n.gen[k] = closedGen;
    if (++expanded > maxNodes) break;
    const i = k % n.nw, j = (k / n.nw) | 0;
    const gk = n.g[k];
    for (const [di, dj, c] of dirs) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n.nw || b >= n.nh) continue;
      const nk = b * n.nw + a;
      if (n.blocked[nk]) continue;
      if (di && dj && (n.blocked[j * n.nw + a] || n.blocked[b * n.nw + i])) continue; // no corner cutting
      if (Math.abs(n.ground[nk] - n.ground[k]) > 0.7) continue;
      if (n.gen[nk] === closedGen) continue;
      const ng = gk + c;
      if (n.gen[nk] !== gen || ng < n.g[nk]) {
        n.gen[nk] = gen; n.g[nk] = ng; n.from[nk] = k;
        heap.push(nk, ng + h(nk) * 1.05);
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = goal; k !== -1 && k !== start; k = n.from[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => ({ x: NAV.minX + ((k % n.nw) + 0.5) * NAV.cell, z: NAV.minZ + (((k / n.nw) | 0) + 0.5) * NAV.cell }));
  pts[pts.length - 1] = { x: tx, z: tz };
  // String-pull smoothing
  const out = [];
  let ax = sx, az = sz, idx = 0;
  while (idx < pts.length) {
    let far = idx;
    for (let m = pts.length - 1; m > idx; m--) {
      if (walkLine(W, ax, az, pts[m].x, pts[m].z)) { far = m; break; }
    }
    out.push(pts[far]);
    ax = pts[far].x; az = pts[far].z;
    idx = far + 1;
  }
  return out;
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    let i = k.length;
    k.push(key); p.push(pri);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= pri) break;
      k[i] = k[par]; p[i] = p[par]; i = par;
    }
    k[i] = key; p[i] = pri;
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let l = i * 2 + 1, r = l + 1, m = i;
        let mp = lp;
        if (l < n && p[l] < mp) { m = l; mp = p[l]; }
        if (r < n && p[r] < mp) { m = r; mp = p[r]; }
        if (m === i) break;
        k[i] = k[m]; p[i] = p[m]; i = m;
      }
      k[i] = lk; p[i] = lp;
    }
    return top;
  }
}
