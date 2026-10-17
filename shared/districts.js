// The working parts of each settlement: outer neighbourhoods, ring streets, farms, mines,
// hunting lodges, markets, workshops and spaceports. Everything here feeds the economy
// (shared/economy.js) or the traffic and ship schedules.
import { box, addBox, building, lamp, crate, terrainHeight, extendLayout, MAT } from './world.js';
import { mulberry32, dist2, distPointSegXZ } from './math.js';

const T = (x, z, act = 'look', wait = [1.5, 3.5], face, give) => ({ x, z, act, wait, face, give });
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
const faceSide = (cx, cz, hx, hz) => { const dx = cx - hx, dz = cz - hz; return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n'); };
const sideOffset = (side, d = 1.4) => [side === 'e' ? d : side === 'w' ? -d : 0, side === 's' ? d : side === 'n' ? -d : 0];

// ------------------------------------------------------------------ geometry helpers

function rectClear(W, x0, z0, x1, z1, m) {
  for (const b of W.boxes) {
    if (!b.solid && !b.render) continue;
    if (b.maxX < x0 - m || b.minX > x1 + m || b.maxZ < z0 - m || b.minZ > z1 + m) continue;
    return false;
  }
  return true;
}
export function routeDist(x, z, pts, loop) {
  let best = 1e9;
  const n = pts.length;
  for (let i = 0; i < (loop ? n : n - 1); i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
    best = Math.min(best, distPointSegXZ(x, z, ax, az, bx, bz));
  }
  return best;
}
function ring(cx, cz, rFn, n = 16) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, r = rFn(a); pts.push([+(cx + Math.cos(a) * r).toFixed(2), +(cz + Math.sin(a) * r).toFixed(2)]); }
  return pts;
}
function streetLamps(W, pts, y, every = 2, out = 4, cx, cz) {
  pts.forEach(([x, z], i) => {
    if (i % every) return;
    const d = dist2(x, z, cx, cz) || 1;
    const lx = x + ((x - cx) / d) * out, lz = z + ((z - cz) / d) * out;
    lamp(W, lx, lz, y ?? terrainHeight(lx, lz), 4.2, 9, 'warm');
  });
}
function traffic(W, pts, opts) { W.traffic.push({ pts, loop: !!opts.loop, kinds: opts.kinds, n: opts.n, pause: opts.pause || 0 }); }
// Haul roads are cut through the woods: drop scattered trees/spires that stand on them
function clearRoutes(W, r = 4) {
  const hit = (x, z) => W.traffic.some((t) => routeDist(x, z, t.pts, t.loop) < r);
  for (const b of W.boxes) if ((b.tag === 'tree' || b.tag === 'spire') && hit((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)) b.solid = false;
  W.decor = W.decor.filter((d) => !((d.type === 'tree' || d.type === 'spire') && hit(d.x, d.z)));
}
function node(W, kind, x, z, y) { W.nodes.push({ id: W.nodes.length, kind, x, z, y: y ?? terrainHeight(x, z) }); }

// ------------------------------------------------------------------ houses

function house(W, style, hx, hz, w, d, y, side, i) {
  if (style === 'adobe') {
    const door = building(W, hx - w / 2, hz - d / 2, hx + w / 2, hz + d / 2, y, 3.6 + (i % 3) * 0.8, i % 2 ? MAT.ADOBE : MAT.ADOBE_DARK, side, { doorW: 2, doorH: 2.4, roofMat: MAT.ADOBE_DARK });
    const [ox, oz] = sideOffset(side, 1.4);
    if (i % 2 === 0) box(W, door.x + ox * 1.1, y + 2.8, door.z + oz * 1.1, side === 'e' || side === 'w' ? 3 : 3.4, 0.15, side === 'e' || side === 'w' ? 3.4 : 3, [MAT.CLOTH, MAT.CLOTH2, MAT.CLOTH3][i % 3], { solid: false });
    if (i % 3 === 1) box(W, hx, y + 3.6 + (i % 3) * 0.8, hz, 1.2, 1.4, 1.2, MAT.ADOBE_DARK); // rooftop cistern
    return door;
  }
  if (style === 'stilt') {
    box(W, hx, y, hz, w + 1.4, 0.5, d + 1.4, MAT.WOOD);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(W, hx + ox * (w / 2 + 0.5), y - 1.2, hz + oz * (d / 2 + 0.5), 0.35, 1.3, 0.35, MAT.WOOD, { solid: false });
    const door = building(W, hx - w / 2, hz - d / 2, hx + w / 2, hz + d / 2, y + 0.5, 3.1 + (i % 2) * 0.5, MAT.WOOD, side, { doorW: 2, doorH: 2.3, roofMat: i % 3 ? MAT.CLOTH3 : MAT.CLOTH2 });
    return door;
  }
  // prefab (Korrun): insulated walls, a warm lamp at every door
  const door = building(W, hx - w / 2, hz - d / 2, hx + w / 2, hz + d / 2, y, 3.8 + (i % 2) * 0.6, i % 2 ? MAT.METAL : MAT.CONCRETE, side, { doorW: 2, doorH: 2.5, roofMat: MAT.METAL_DARK });
  const [ox, oz] = sideOffset(side, 1.6);
  lamp(W, door.x + ox * 1.6 + (side === 'n' || side === 's' ? 2 : 0), door.z + oz * 1.6 + (side === 'e' || side === 'w' ? 2 : 0), y, 3, 6, 'warm');
  return door;
}

// Ring of new neighbourhoods around a town, clear of streets and reserved plots
function growTown(W, o) {
  const rng = mulberry32(o.seed);
  let placed = 0;
  for (let k = 0; k < o.n * 60 && placed < o.n; k++) {
    const a = rng() * Math.PI * 2, r = o.r0 + rng() * (o.r1 - o.r0);
    const hx = Math.round(o.cx + Math.cos(a) * r), hz = Math.round(o.cz + Math.sin(a) * r);
    const w = 7 + Math.floor(rng() * 4), d = 6 + Math.floor(rng() * 3);
    const half = Math.hypot(w, d) / 2;
    if (o.keep.some((c) => dist2(hx, hz, c.x, c.z) < c.r + half)) continue;
    if (o.streets.some((s) => routeDist(hx, hz, s.pts, s.loop) < half + 4.5)) continue;
    if (!rectClear(W, hx - w / 2, hz - d / 2, hx + w / 2, hz + d / 2, 3)) continue;
    const side = faceSide(o.cx, o.cz, hx, hz);
    const door = house(W, o.style, hx, hz, w, d, o.y, side, placed);
    const [ox, oz] = sideOffset(side, 1.6);
    W.civSpots.push({ x: door.x + ox, z: door.z + oz, act: rng() < 0.3 ? 'talk' : 'idle', home: true });
    placed++;
  }
  return placed;
}

// ------------------------------------------------------------------ economy buildings

// A trading hall with a broker behind the counter. kind: 'exchange' or 'workshop'.
function hall(W, id, kind, x, z, w, d, y, side, mat, roof) {
  const door = building(W, x - w / 2, z - d / 2, x + w / 2, z + d / 2, y, 5, mat, side, { doorW: 3.2, doorH: 3, roofMat: roof });
  // counter across the back half, the broker behind it facing the door
  const [ox, oz] = sideOffset(side, 1);
  const bx = x - ox * (w / 2 - 2.2) * (side === 'e' || side === 'w' ? 1 : 0), bz = z - oz * (d / 2 - 2.2) * (side === 'n' || side === 's' ? 1 : 0);
  const cx = x - ox * (w / 2 - 3.6) * (side === 'e' || side === 'w' ? 1 : 0), cz = z - oz * (d / 2 - 3.6) * (side === 'n' || side === 's' ? 1 : 0);
  if (side === 'n' || side === 's') box(W, cx, y, cz, w - 5, 1.05, 0.9, MAT.WOOD); else box(W, cx, y, cz, 0.9, 1.05, d - 5, MAT.WOOD);
  const yaw = yawTo(bx, bz, door.x, door.z);
  W.npcs.push({ kind: 'merchant', merchant: id, x: bx, z: bz, yaw });
  const fl = dist2(bx, bz, door.x, door.z) || 1;
  W.shops.push({ id, kind, x: bx, z: bz, door: { x: door.x + ox * 2, z: door.z + oz * 2 }, front: { x: bx + ((door.x - bx) / fl) * 2.7, z: bz + ((door.z - bz) / fl) * 2.7 } });
  W.lamps.push({ x, z, y: y + 4.4, r: 9, color: kind === 'workshop' ? 'cool' : 'warm', inside: true });
  // goods stacked inside along the side walls
  for (let i = 0; i < 3; i++) {
    const t = (i - 1) * 2.6;
    if (side === 'n' || side === 's') { crate(W, x - w / 2 + 1.4, z + t * 0.6, y, 1.1, 1); crate(W, x + w / 2 - 1.4, z - t * 0.6, y, 1.1, 1); }
    else { crate(W, x + t * 0.6, z - d / 2 + 1.4, y, 1.1, 1); crate(W, x - t * 0.6, z + d / 2 - 1.4, y, 1.1, 1); }
  }
  W.decor.push({ type: 'sign', x: door.x + ox * 0.4, z: door.z + oz * 0.4, y: y + 3.6, yaw: yawTo(door.x, door.z, door.x + ox, door.z + oz), kind });
  return { door, bx, bz, cx, cz };
}

// Makers at the workshop benches turn raw goods into parts (see economy.js)
function workshopCrew(W, ws, n, home, x, z, y, side) {
  // two workbenches inside along the walls opposite the counter
  const benches = side === 'n' || side === 's' ? [[x - 3, z], [x + 3, z]] : [[x, z - 3], [x, z + 3]];
  benches.forEach(([bx, bz]) => box(W, bx, y, bz, 1.8, 0.95, 1.1, MAT.METAL_DARK));
  W.decor.push({ type: 'forge', x: benches[0][0], z: benches[0][1], y });
  for (let i = 0; i < n; i++) {
    const [bx, bz] = benches[i % 2];
    const [ox, oz] = sideOffset(side, 1.2);
    W.workers.push({ role: 'maker', town: home, tasks: [T(bx + ox, bz + oz, 'work', [6, 10], yawTo(bx + ox, bz + oz, bx, bz), { make: 1 }), T(bx + ox * 2.5 + 1, bz + oz * 2.5, 'idle', [2, 4])] });
  }
}

function spaceport(W, pads, y, tower) {
  for (const p of pads) {
    box(W, p.x, y - 0.4, p.z, 20, 0.7, 20, MAT.CONCRETE);
    for (const [ox, oz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) box(W, p.x + ox, y + 0.3, p.z + oz, 0.5, 0.25, 0.5, MAT.LAMP, { solid: false });
    const l = Math.hypot(p.ax, p.az) || 1;
    W.pads.push({ x: p.x, y: y + 0.3, z: p.z, yaw: p.yaw ?? 0, ax: p.ax / l, az: p.az / l, name: p.name });
    W.decor.push({ type: 'padring', x: p.x, z: p.z, y: y + 0.31 });
  }
  if (tower) {
    box(W, tower.x, y, tower.z, 3, 9, 3, MAT.CONCRETE);
    box(W, tower.x, y + 9, tower.z, 5, 2.2, 5, MAT.METAL_DARK);
    box(W, tower.x, y + 9.6, tower.z, 5.2, 1.0, 5.2, MAT.SCREEN, { solid: false });
    lamp(W, tower.x + 4, tower.z, y, 4, 10, 'cool');
  }
}

// Cultivated plots: crop rows (client draws them), a store, and the people who work them
function farmPlots(W, o) {
  const { y, plots, store, crop, nWorkers, home, good } = o;
  for (const [px, pz, w, d] of plots) {
    W.decor.push({ type: 'crops', x0: px - w / 2, z0: pz - d / 2, x1: px + w / 2, z1: pz + d / 2, y, crop });
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(W, px + ox * (w / 2 + 0.3), y, pz + oz * (d / 2 + 0.3), 0.2, 1.1, 0.2, MAT.WOOD);
  }
  const sd = building(W, store.x - store.w / 2, store.z - store.d / 2, store.x + store.w / 2, store.z + store.d / 2, y, 4.4, store.mat, store.side, { doorW: 3, doorH: 2.8, roofMat: store.roof });
  const [ox, oz] = sideOffset(store.side, 2.2);
  const drop = { x: sd.x + ox, z: sd.z + oz };
  for (let i = 0; i < nWorkers; i++) {
    const [px, pz, w, d] = plots[i % plots.length];
    const rows = [-0.3, 0.05, 0.35].map((f) => [px + (i % 2 ? 1 : -1) * w * 0.22, pz + f * d]);
    W.workers.push({ role: 'farmer', town: home, tasks: [...rows.map(([rx, rz]) => T(rx, rz, 'work', [5, 9])), T(drop.x, drop.z, 'work', [2.5, 4], yawTo(drop.x, drop.z, sd.x, sd.z), { [good]: 2 })] });
  }
  return drop;
}

// ------------------------------------------------------------------ Dusk Varo: Khet

extendLayout('duskvaro', (W) => {
  const y = 6, CX = -160, CZ = 40;
  W.regions.town = { x: CX, z: CZ, r: 104 };
  // ring street around the old town, bulging out past the Wayfarer's pad
  const RING = ring(CX, CZ, (a) => (a >= Math.PI * 0.74 && a <= Math.PI * 1.13 ? 96 : 78));
  streetLamps(W, RING, y, 2, -4.2, CX, CZ);
  traffic(W, RING, { loop: true, kinds: ['bike', 'car', 'bike', 'car', 'bike'], n: 5 });
  const HIGHWAY = [[-82, 40], [-46, 36], [10, 26], [70, 18], [130, 13], [196, 8]];
  traffic(W, HIGHWAY, { kinds: ['car', 'bike'], n: 2, pause: 6 });

  // Khet Exchange: commodities, east of the plaza
  hall(W, 'khetExchange', 'exchange', -124, 0, 16, 12, y, 's', MAT.ADOBE, MAT.ADOBE_DARK);
  // Vosk Fabrication: parts and upgrades, south-west of the plaza
  const ws = hall(W, 'voskWorks', 'workshop', -200, -6, 14, 12, y, 's', MAT.METAL, MAT.METAL_DARK);
  workshopCrew(W, ws, 2, 'khet', -200, -6, y, 's');

  // Spaceport: two pads for traders north-west of town
  spaceport(W, [{ x: -262, z: 116, ax: -1, az: 0.4, name: 'Pad 2' }, { x: -238, z: 138, ax: -0.5, az: 1, name: 'Pad 3' }], y, { x: -270, z: 141 });

  // Outer neighbourhoods
  const FARM_RD = [[-160, -38], [-157, -60], [-147, -75]];
  const MINE_RD = [[-104.8, -15.2], [-82, -62], [-64, -108]];
  const LODGE_RD = [[-160, 118], [-148, 140], [-126, 166]];
  const keep = [{ x: -228, z: 62, r: 16 }, { x: -250, z: 126, r: 30 }, { x: -124, z: 0, r: 12 }, { x: -200, z: -6, r: 11 }];
  const streets = [{ pts: RING, loop: true }, { pts: HIGHWAY }, { pts: FARM_RD }, { pts: MINE_RD }, { pts: LODGE_RD }];
  growTown(W, { cx: CX, cz: CZ, r0: 60, r1: 70, n: 7, seed: 31, style: 'adobe', y, keep, streets });
  growTown(W, { cx: CX, cz: CZ, r0: 86, r1: 108, n: 18, seed: 37, style: 'adobe', y, keep, streets });

  // Moisture farms south of town: grain under the vaporators
  const drop = farmPlots(W, {
    y: 6.4, crop: 'grain', good: 'grain', nWorkers: 4, home: 'khet',
    plots: [[-162, -104, 18, 14], [-138, -104, 18, 14], [-162, -124, 18, 14], [-138, -124, 18, 14]],
    store: { x: -150, z: -86, w: 10, d: 8, side: 's', mat: MAT.ADOBE, roof: MAT.ADOBE_DARK },
  });
  for (const [x, z] of [[-174, -92], [-126, -92], [-174, -136], [-126, -136]]) { box(W, x, 6.4, z, 0.9, 6, 0.9, MAT.METAL); W.decor.push({ type: 'vaporator', x, z, y: 6.4 }); }
  for (const [x, z] of [[-150, -104], [-150, -124], [-162, -114], [-138, -114]]) node(W, 'grain', x, z, 6.4);
  traffic(W, FARM_RD, { kinds: ['hauler'], n: 1, pause: 8 });
  lamp(W, -144, -80, 6.4, 4, 9, 'warm');

  // Ochre Cut: an ore quarry under the mesa's cliff
  const mY = 8;
  box(W, -52, mY, -128, 0.5, 9, 0.5, MAT.METAL_DARK); box(W, -46, mY, -128, 0.5, 9, 0.5, MAT.METAL_DARK);
  box(W, -49, mY + 9, -128, 7, 0.6, 1, MAT.METAL_DARK);
  W.decor.push({ type: 'headframe', x: -49, z: -128, y: mY + 9 });
  const shed = building(W, -70, -144, -62, -138, mY, 3.6, MAT.WOOD, 's', { doorW: 2.4, doorH: 2.6, roofMat: MAT.METAL_DARK });
  for (const [x, z] of [[-60, -116], [-58.4, -116.2], [-66, -118]]) crate(W, x, z, mY, 1.2, 1);
  for (const a of [2.6, 3.2, 3.8, 4.4, 5.0]) { const x = -58 + Math.cos(a) * 17, z = -128 + Math.sin(a) * 17; const ry = terrainHeight(x, z) - 0.4; box(W, x, ry, z, 3.2, 2.8, 3.4, MAT.ROCK); W.decor.push({ type: 'rock', x, y: ry, z, s: 3.2 }); }
  const oreSpots = [[-41, -136], [-40, -128], [-41, -120], [-45, -143], [-45, -113], [-52, -146]];
  oreSpots.forEach(([x, z]) => node(W, 'ore', x, z));
  for (let i = 0; i < 4; i++) {
    const a = oreSpots[i], b = oreSpots[(i + 2) % oreSpots.length];
    W.workers.push({ role: 'miner', town: 'khet', tasks: [T(a[0] - 2, a[1], 'work', [6, 10], -Math.PI / 2), T(b[0] - 2, b[1], 'work', [6, 10], -Math.PI / 2), T(shed.x, shed.z + 2.2, 'work', [2.5, 4], 0, { ore: 2 })] });
  }
  for (const [x, z] of [[-56, -120], [-56, -138]]) lamp(W, x, z, mY, 4.5, 10, 'flood');
  traffic(W, MINE_RD, { kinds: ['hauler'], n: 1, pause: 8 });

  // Skitter Lodge: hunters work the herds north of town
  const lY = 7;
  const lodge = building(W, -124.5, 178.5, -115.5, 185.5, lY, 3.4, MAT.WOOD, 'n', { doorW: 2.2, doorH: 2.4, roofMat: MAT.CLOTH3 });
  for (const x of [-129, -111]) { box(W, x, lY, 174, 0.15, 2.2, 3.4, MAT.WOOD); box(W, x, lY + 2.2, 174, 0.5, 0.1, 3.6, MAT.CLOTH3, { solid: false }); }
  W.decor.push({ type: 'hiderack', x: -129, z: 174, y: lY }, { type: 'hiderack', x: -111, z: 174, y: lY });
  for (let i = 0; i < 2; i++) W.workers.push({ role: 'hunter', town: 'khet', home: { x: lodge.x, z: lodge.z - 2.4 }, tasks: [T(lodge.x + (i ? 2 : -2), lodge.z - 2.6, 'work', [4, 7])] });
  lamp(W, -120, 171, lY, 3.4, 8, 'warm');
  traffic(W, LODGE_RD, { kinds: ['bike'], n: 1, pause: 10 });

  W.civCount = 16;
});

// ------------------------------------------------------------------ Thessaly Mire: Lowmarsh

extendLayout('thessaly', (W) => {
  const y = 3.6, CX = -120, CZ = 30;
  W.regions.town = { x: CX, z: CZ, r: 84 };
  const RING = ring(CX, CZ, () => 52);
  streetLamps(W, RING, y, 2, -4, CX, CZ);
  traffic(W, RING, { loop: true, kinds: ['bike', 'car', 'bike'], n: 3 });
  const HIGHWAY = [[-68, 30], [-36, 22], [20, 12], [100, 4], [180, -4], [230, -7]];
  traffic(W, HIGHWAY, { kinds: ['car'], n: 1, pause: 6 });

  hall(W, 'lowmarshPost', 'exchange', -60, 10, 14, 12, y, 'w', MAT.WOOD, MAT.CLOTH3);
  const ws = hall(W, 'reedwright', 'workshop', -176, 66, 14, 12, y, 'e', MAT.WOOD, MAT.CLOTH2);
  workshopCrew(W, ws, 2, 'lowmarsh', -176, 66, y, 'e');
  spaceport(W, [{ x: -208, z: -70, ax: -1, az: -0.6, name: 'Pad 2' }, { x: -184, z: -84, ax: 0.2, az: -1, name: 'Pad 3' }], 4.2, { x: -214, z: -92 });

  const GROVE_RD = [[-120, -22], [-84, -48], [-46, -64]];
  const YARD_RD = [[-120, 82], [-132, 106], [-146, 124]];
  const keep = [{ x: -180, z: -25, r: 16 }, { x: -196, z: -76, r: 28 }, { x: -60, z: 10, r: 11 }, { x: -176, z: 66, r: 11 }];
  const streets = [{ pts: RING, loop: true }, { pts: HIGHWAY }, { pts: GROVE_RD }, { pts: YARD_RD }];
  growTown(W, { cx: CX, cz: CZ, r0: 60, r1: 82, n: 14, seed: 53, style: 'stilt', y, keep, streets });

  // Resin groves to the south-east: tapped trees and a drying shed
  const gY = 3.4;
  const shed = building(W, -44, -76, -36, -70, gY, 3.4, MAT.WOOD, 's', { doorW: 2.4, doorH: 2.5, roofMat: MAT.CLOTH3 });
  const groves = [[-52, -88], [-40, -96], [-28, -88], [-46, -104], [-32, -106], [-56, -100], [-22, -98], [-38, -84]];
  groves.forEach(([x, z], i) => { box(W, x, gY - 1, z, 0.8, 5, 0.8, MAT.WOOD, { render: false, tag: 'tree' }); W.decor.push({ type: 'resintree', x, z, y: gY, s: 0.8 + (i % 3) * 0.15 }); });
  groves.slice(0, 5).forEach(([x, z]) => node(W, 'resin', x + 1.4, z, gY));
  for (let i = 0; i < 3; i++) {
    const a = groves[i * 2], b = groves[i * 2 + 1];
    W.workers.push({ role: 'farmer', town: 'lowmarsh', tasks: [T(a[0] + 1.2, a[1], 'work', [6, 9], Math.PI / 2), T(b[0] + 1.2, b[1], 'work', [6, 9], Math.PI / 2), T(shed.x, shed.z + 2.2, 'work', [2.5, 4], 0, { resin: 1 })] });
  }
  traffic(W, GROVE_RD, { kinds: ['hauler'], n: 1, pause: 8 });

  // Deadfall Yard: loggers cut fallen giants, hunters camp here too
  const yY = 4.2;
  const mill = building(W, -156, 134, -144, 142, yY, 4.2, MAT.WOOD, 'n', { doorW: 3, doorH: 2.8, roofMat: MAT.CLOTH2 });
  const logs = [[-166, 150], [-160, 158], [-140, 154], [-134, 146]];
  logs.forEach(([x, z]) => { box(W, x, yY, z, 7, 1.2, 1.3, MAT.WOOD); node(W, 'timber', x, z + 1.6, yY); });
  for (let i = 0; i < 3; i++) {
    const a = logs[i], b = logs[(i + 1) % logs.length];
    W.workers.push({ role: 'logger', town: 'lowmarsh', tasks: [T(a[0], a[1] + 1.8, 'work', [6, 10], Math.PI), T(b[0], b[1] + 1.8, 'work', [6, 10], Math.PI), T(mill.x, mill.z - 2.2, 'work', [2.5, 4], Math.PI, { timber: 2 })] });
  }
  for (let i = 0; i < 2; i++) W.workers.push({ role: 'hunter', town: 'lowmarsh', home: { x: mill.x + (i ? 3 : -3), z: mill.z - 3 }, tasks: [T(mill.x + (i ? 3 : -3), mill.z - 3, 'work', [4, 7])] });
  lamp(W, -150, 130, yY, 3.6, 9, 'warm');
  traffic(W, YARD_RD, { kinds: ['hauler', 'bike'], n: 2, pause: 8 });
  clearRoutes(W);

  W.pois.speeders = [{ x: -76, z: 40, yaw: -Math.PI / 2 }, { x: -76, z: 44, yaw: -Math.PI / 2 }, { x: -76, z: 48, yaw: -Math.PI / 2 }];
  W.herds = [{ x: -40, z: -150 }, { x: 60, z: 90 }, { x: -260, z: 110 }, { x: 140, z: 60 }, { x: -250, z: -150 }];
  W.critterBounds = [-290, 230, -200, 200];
  W.civCount = 13;
});

// ------------------------------------------------------------------ Korrun Deep: Rime Hold

extendLayout('korrun', (W) => {
  const y = 11, CX = -130, CZ = 70;
  W.regions.town = { x: CX, z: CZ, r: 80 };
  const RING = ring(CX, CZ, () => 50);
  streetLamps(W, RING, y, 2, -4, CX, CZ);
  traffic(W, RING, { loop: true, kinds: ['car', 'bike', 'car'], n: 3 });
  const HIGHWAY = [[-80, 70], [-48, 62], [40, 54], [140, 46], [236, 42]];
  traffic(W, HIGHWAY, { kinds: ['car'], n: 1, pause: 6 });

  hall(W, 'rimeExchange', 'exchange', -72, 44, 14, 12, y, 'w', MAT.CONCRETE, MAT.METAL_DARK);
  const ws = hall(W, 'coldforge', 'workshop', -160, 130, 14, 12, y, 'n', MAT.METAL, MAT.METAL_DARK);
  workshopCrew(W, ws, 2, 'rime', -160, 130, y, 'n');
  spaceport(W, [{ x: -236, z: 108, ax: -1, az: 0.2, name: 'Pad 2' }, { x: -212, z: 130, ax: -0.4, az: 1, name: 'Pad 3' }], y, { x: -240, z: 132 });

  // A greenhouse: grain grown under heat lamps
  const gx = -78, gz = 122;
  const gh = building(W, gx - 8, gz - 5, gx + 8, gz + 5, y, 3.6, MAT.METAL, 'w', { doorW: 2.6, doorH: 2.6, roof: false });
  W.decor.push({ type: 'glassroof', x: gx, z: gz, y: y + 3.6, w: 16, d: 10 });
  W.decor.push({ type: 'crops', x0: gx - 6.5, z0: gz - 3.5, x1: gx + 6.5, z1: gz + 3.5, y, crop: 'tuber' });
  W.lamps.push({ x: gx, z: gz, y: y + 3.2, r: 9, color: 'warm', inside: true });
  for (let i = 0; i < 2; i++) W.workers.push({ role: 'farmer', town: 'rime', tasks: [T(gx - 4 + i * 6, gz - 1, 'work', [6, 10]), T(gx + 2 - i * 6, gz + 1.5, 'work', [6, 9]), T(gh.x - 2.2, gh.z, 'work', [2.5, 4], -Math.PI / 2, { grain: 1 })] });
  node(W, 'grain', gx + 5, gz - 3, y);

  const QUARRY_RD = [[-130, 20], [-100, -2], [-66, -6]];
  const LODGE_RD = [[-130, 120], [-126, 150], [-122, 174]];
  const keep = [{ x: -190, z: 25, r: 16 }, { x: -226, z: 118, r: 30 }, { x: -72, z: 44, r: 11 }, { x: -160, z: 130, r: 11 }, { x: gx, z: gz, r: 12 }];
  const streets = [{ pts: RING, loop: true }, { pts: HIGHWAY }, { pts: QUARRY_RD }, { pts: LODGE_RD }];
  growTown(W, { cx: CX, cz: CZ, r0: 58, r1: 78, n: 12, seed: 71, style: 'prefab', y, keep, streets });

  // Glassfall Quarry: coolant ice cut from the frozen sea
  const qY = 2.6;
  const shed = building(W, -64, -18, -56, -12, qY, 3.6, MAT.METAL, 's', { doorW: 2.4, doorH: 2.6, roofMat: MAT.METAL_DARK });
  box(W, -60, qY, -42, 0.5, 8, 0.5, MAT.METAL_DARK); box(W, -54, qY, -42, 0.5, 8, 0.5, MAT.METAL_DARK);
  box(W, -57, qY + 8, -42, 7, 0.6, 1, MAT.METAL_DARK);
  W.decor.push({ type: 'headframe', x: -57, z: -42, y: qY + 8 });
  const ice = [[-72, -40], [-66, -50], [-52, -52], [-44, -40], [-76, -28], [-46, -26]];
  ice.forEach(([x, z]) => node(W, 'ice', x, z, qY));
  for (let i = 0; i < 4; i++) {
    const a = ice[i], b = ice[(i + 3) % ice.length];
    W.workers.push({ role: 'miner', town: 'rime', tasks: [T(a[0] + 1.5, a[1] + 1.5, 'work', [6, 10]), T(b[0] + 1.5, b[1] + 1.5, 'work', [6, 10]), T(shed.x, shed.z + 2.2, 'work', [2.5, 4], 0, { ice: 2 })] });
  }
  for (const [x, z] of [[-66, -32], [-50, -34]]) lamp(W, x, z, qY, 4.5, 10, 'flood');
  traffic(W, QUARRY_RD, { kinds: ['hauler'], n: 1, pause: 8 });

  // Hunters' Rest
  const lY = 12;
  const lodge = building(W, -124.5, 186.5, -115.5, 193.5, lY, 3.4, MAT.METAL, 'n', { doorW: 2.2, doorH: 2.4, roofMat: MAT.METAL_DARK });
  for (const x of [-129, -111]) { box(W, x, lY, 182, 0.15, 2.2, 3.4, MAT.WOOD); W.decor.push({ type: 'hiderack', x, z: 182, y: lY }); }
  for (let i = 0; i < 3; i++) W.workers.push({ role: 'hunter', town: 'rime', home: { x: lodge.x + (i - 1) * 2, z: lodge.z - 2.6 }, tasks: [T(lodge.x + (i - 1) * 2, lodge.z - 2.6, 'work', [4, 7])] });
  lamp(W, -120, 179, lY, 3.4, 8, 'warm');
  traffic(W, LODGE_RD, { kinds: ['bike'], n: 1, pause: 10 });
  clearRoutes(W);

  W.herds = [{ x: -40, z: 160 }, { x: 60, z: 130 }, { x: 40, z: -90 }, { x: -260, z: 190 }, { x: 150, z: 110 }];
  W.critterBounds = [-290, 240, -200, 210];
  W.civCount = 11;
});
