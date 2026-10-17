// Layouts for the off-world planets. Built with the same kit as Dusk Varo.
import { box, addBox, building, addDoor, lamp, crate, placeShip, registerLayout, terrainHeight, roadDistance, markWorld, shiftWorld, SITE_SHIFT, MAT } from './world.js';
import { mulberry32, dist2 } from './math.js';
import { prefabSkin } from './districts.js';
import { packBuilding } from './packs.js';
import './dressing.js';

// Scatter solid props (trees, ice spires) across open ground, clear of settlements, sites and roads.
function scatterProps(W, type, seed, count, span, clear, mk) {
  const rng = mulberry32(seed);
  let n = 0;
  for (let k = 0; k < count * 12 && n < count; k++) {
    const x = (rng() - 0.5) * span[0], z = (rng() - 0.5) * span[1];
    if (W.zones.some((zn) => dist2(x, z, zn.x, zn.z) < zn.r + clear)) continue;
    if (roadDistance(x, z) < 7) continue;
    const y = terrainHeight(x, z);
    if (W.water != null && y < W.water - 0.5 && type === 'tree' && rng() < 0.7) continue;
    if (W.decor.some((d) => d.type === type && dist2(x, z, d.x, d.z) < 4.5)) continue;
    const s = 0.75 + rng() * 0.6;
    mk(x, y, z, s, rng);
    n++;
  }
}

const T = (x, z, act = 'look', wait = [1.5, 3.5], face) => ({ x, z, act, wait, face });
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));

function stall(W, x, z, y, mat) {
  for (const [ox, oz] of [[-1.6, -1.1], [1.6, -1.1], [-1.6, 1.1], [1.6, 1.1]]) box(W, x + ox, y, z + oz, 0.18, 2.8, 0.18, MAT.WOOD);
  box(W, x, y + 2.8, z, 4, 0.12, 3, mat, { solid: false });
  box(W, x, y, z + 0.6, 3.4, 1.05, 0.8, MAT.WOOD);
}
const faceSide = (cx, cz, hx, hz) => { const dx = cx - hx, dz = cz - hz; return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n'); };
const sideOffset = (side, d = 1.4) => [side === 'e' ? d : side === 'w' ? -d : 0, side === 's' ? d : side === 'n' ? -d : 0];

// A walled Concordance compound: walls, a gate on the west side, a crawl duct in the east wall, two towers.
function compound(W, X0, X1, Z0, Z1, g, gateZ, ductZ, wallMat = MAT.METAL) {
  const WH = 6.2, WT = 1.2;
  W.regions.garrison = { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1 };
  box(W, (X0 + X1) / 2, g - 0.5, (Z0 + Z1) / 2, X1 - X0, 0.52, Z1 - Z0, MAT.CONCRETE);
  addBox(W, X0, g, Z0, X1, g + WH, Z0 + WT, wallMat);
  addBox(W, X0, g, Z1 - WT, X1, g + WH, Z1, wallMat);
  addBox(W, X0, g, Z0, X0 + WT, g + WH, gateZ - 3.5, wallMat);
  addBox(W, X0, g, gateZ + 3.5, X0 + WT, g + WH, Z1, wallMat);
  addBox(W, X0 - 0.3, g + 5, gateZ - 3.5, X0 + WT + 0.3, g + WH + 1.2, gateZ + 3.5, MAT.RED);
  addDoor(W, 'gate', { minX: X0 + 0.2, maxX: X0 + WT - 0.2, minZ: gateZ - 3.5, maxZ: gateZ + 3.5, x: X0 + 0.6, z: gateZ, y0: g, dh: 5, axis: 'z' }, null, 'Main Gate', { open: true });
  W.pois.gate = { x: X0 - 3, z: gateZ };
  W.pois.gatePanel = { x: X0 + 2.6, z: gateZ + 5 };
  addBox(W, X1 - WT, g, Z0, X1, g + WH, ductZ - 1.1, wallMat);
  addBox(W, X1 - WT, g + 1.25, ductZ - 1.1, X1, g + WH, ductZ + 1.1, wallMat);
  addBox(W, X1 - WT, g, ductZ + 1.1, X1, g + WH, Z1, wallMat);
  W.pois.culvert = { x: X1 + 2, z: ductZ };
  W.decor.push({ type: 'culvert', x: X1 - WT / 2, y: g, z: ductZ });
  W.towers = [];
  for (const [tx, tz] of [[X0 + 3, Z0 + 3], [X1 - 3, Z1 - 3]]) {
    box(W, tx, g, tz, 2.6, 8, 2.6, MAT.METAL_DARK);
    box(W, tx, g + 8, tz, 5, 0.4, 5, MAT.METAL);
    for (const [ox, oz, w, d] of [[0, -2.4, 5, 0.2], [0, 2.4, 5, 0.2], [-2.4, 0, 0.2, 5], [2.4, 0, 0.2, 5]]) box(W, tx + ox, g + 8.4, tz + oz, w, 1.0, d, MAT.METAL_DARK);
    box(W, tx, g + 10.6, tz, 5.2, 0.3, 5.2, MAT.RED, { solid: false });
    W.towers.push({ x: tx, z: tz, y: g + 8.4 });
  }
  lamp(W, X0 - 4, gateZ - 6, g, 5, 10, 'flood');
  lamp(W, X0 - 4, gateZ + 6, g, 5, 10, 'flood');
  for (const [x, z, ry] of [[X0 - 0.7, gateZ - 8, Math.PI / 2], [X0 - 0.7, gateZ + 8, Math.PI / 2]]) W.decor.push({ type: 'banner', x, y: g + 3.2, z, ry });
}

// ------------------------------------------------------------------ Thessaly Mire

registerLayout('thessaly', (W) => {
  const gV = 3.6, gP = 4.2, gS = 5;
  // Landing pad and the Wayfarer
  const PX = -180, PZ = -25;
  box(W, PX, gP - 0.4, PZ, 20, 0.7, 20, MAT.CONCRETE);
  placeShip(W, PX, gP + 0.3, PZ - 2, 0);
  W.pois.spawn = { x: PX, z: PZ + 7, y: gP + 0.3 };
  lamp(W, PX + 9, PZ + 9, gP + 0.3, 4, 8, 'cool');
  lamp(W, PX - 9, PZ + 9, gP + 0.3, 4, 8, 'cool');
  // boardwalk from the pad to the village
  for (let i = 0; i < 9; i++) {
    const t = i / 8, x = -170 + t * 34, z = -14 + t * 28;
    box(W, x, terrainHeight(x, z) - 0.2, z, 4.2, 0.45, 4.2, MAT.WOOD);
  }
  // Lowmarsh: stilt huts around a fire pit
  const VX = -120, VZ = 30;
  W.regions.town = { x: VX, z: VZ, r: 48 };
  box(W, VX, gV, VZ, 1.8, 0.4, 1.8, MAT.ROCK, { render: true });
  W.decor.push({ type: 'fire', x: VX, y: gV + 0.4, z: VZ });
  W.lamps.push({ x: VX, z: VZ, y: gV + 1.2, r: 10, color: 'warm' });
  const huts = [[-142, 16, 9, 8], [-143, 42, 8, 8], [-124, 56, 9, 7], [-100, 50, 8, 8], [-96, 24, 9, 8], [-110, 4, 8, 7], [-138, 62, 7, 7]];
  huts.forEach(([hx, hz, w, d], i) => {
    const side = faceSide(VX, VZ, hx, hz);
    box(W, hx, gV, hz, w + 1.4, 0.5, d + 1.4, MAT.WOOD); // stilt platform
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(W, hx + ox * (w / 2 + 0.5), gV - 1.2, hz + oz * (d / 2 + 0.5), 0.35, 1.3, 0.35, MAT.WOOD, { solid: false });
    const door = building(W, hx - w / 2, hz - d / 2, hx + w / 2, hz + d / 2, gV + 0.5, 3.1 + (i % 2) * 0.5, MAT.WOOD, side, { doorW: 2, doorH: 2.3, roofMat: MAT.CLOTH3 });
    const [ox, oz] = sideOffset(side, 1.6);
    W.civSpots.push({ x: door.x + ox, z: door.z + oz, act: 'idle', home: true });
    box(W, door.x + ox * 0.9, gV + 2.9, door.z + oz * 0.9, side === 'e' || side === 'w' ? 2.4 : 3, 0.15, side === 'e' || side === 'w' ? 3 : 2.4, MAT.CLOTH3, { solid: false });
  });
  // merchant stall, drying racks, lanterns
  stall(W, -106, 38, gV, MAT.CLOTH2);
  W.npcs.push({ kind: 'merchant', merchant: 'grell', x: -106, z: 37.2, yaw: Math.PI });
  W.npcs.push({ kind: 'informant', contact: 'vessa', x: -124.5, z: 33.5, yaw: yawTo(-124.5, 33.5, VX, VZ) });
  for (const [x, z] of [[-128, 24], [-114, 22]]) { box(W, x, gV, z, 3.2, 0.5, 0.6, MAT.WOOD); }
  for (const [x, z] of [[-90, 36], [-92, 40]]) { box(W, x, gV, z, 0.15, 2.2, 3.5, MAT.WOOD); box(W, x, gV + 2.2, z, 0.6, 0.1, 3.6, MAT.CLOTH, { solid: false }); }
  W.civSpots.push({ x: -128, z: 24.8, act: 'sit' }, { x: -114, z: 22.8, act: 'sit' }, { x: -118, z: 34, act: 'talk' }, { x: -116, z: 32.5, act: 'talk' }, { x: -91, z: 38, act: 'work' }, { x: -106, z: 39.6, act: 'idle' }, { x: -122, z: 27, act: 'idle' });
  for (const [x, z] of [[-132, 30], [-108, 30], [-120, 44], [-120, 14], [-150, 2], [-96, 12]]) lamp(W, x, z, gV, 3.4, 8, 'warm');
  W.pois.speeders = [{ x: -84, z: 18, yaw: -Math.PI / 2 }, { x: -84, z: 22, yaw: -Math.PI / 2 }];
  W.herds = [{ x: -40, z: -70 }, { x: 30, z: 80 }, { x: -210, z: 90 }];
  W.critterBounds = [-240, 70, -130, 130];
  W.civCount = 8;
  // drowned forest: solid trunks you can hide behind
  scatterProps(W, 'tree', 911, 210, [500, 380], 6, (x, y, z, s, rng) => {
    box(W, x, y - 1, z, 0.9 * s, 8 * s + 1, 0.9 * s, MAT.WOOD, { render: false, tag: 'tree' });
    W.decor.push({ type: 'tree', x, y, z, s, v: rng() });
  });

  // Harvester Station Kappa (authored near x 85..155, shifted east by SITE_SHIFT)
  const siteMark = markWorld(W);
  const X0 = 85, X1 = 155, Z0 = -40, Z1 = 20, gateZ = -10;
  compound(W, X0, X1, Z0, Z1, gS, gateZ, 0, MAT.METAL_DARK);
  // the harvester: a tracked logging machine parked in the yard (big cover)
  box(W, 125, gS + 1.4, -12, 16, 4.2, 6, MAT.METAL_DARK);
  box(W, 125, gS, -15.8, 16, 1.4, 1.6, MAT.RED);
  box(W, 125, gS, -8.2, 16, 1.4, 1.6, MAT.RED);
  box(W, 131, gS + 5.6, -12, 4, 2.6, 4, MAT.METAL);
  box(W, 116, gS + 3, -12, 3, 1.2, 8, MAT.FUEL);
  W.decor.push({ type: 'harvester', x: 125, y: gS, z: -12 });
  // power cells (mission targets)
  [[112, -24], [138, -24], [141, 3]].forEach(([x, z], i) => {
    const b = box(W, x, gS, z, 3.6, 5, 3.6, MAT.FUEL, { tag: 'tank' });
    W.destructibles['gen' + i] = { id: 'gen' + i, kind: 'tank', x, z, y: gS, hp: 90, maxHp: 90, boxId: b.id, radius: 2.2, height: 5, destroyed: false, label: 'power cell' };
  });
  // log piles
  for (const [x, z] of [[96, 4], [99, 4], [102, 4], [96, 7], [99, 7]]) box(W, x, gS, z, 2.6, 1.2, 1.2, MAT.WOOD);
  box(W, 97.5, gS + 1.2, 5.5, 4.5, 1.1, 1.2, MAT.WOOD);
  // the cutters' pen against the north wall
  const PX0 = 92, PX1 = 104, PZ0 = -38.8, PZ1 = -30;
  addBox(W, PX0, gS, PZ0, PX0 + 0.3, gS + 2.6, PZ1, MAT.BARS);
  addBox(W, PX1 - 0.3, gS, PZ0, PX1, gS + 2.6, PZ1, MAT.BARS);
  addBox(W, PX0, gS, PZ1 - 0.3, 97, gS + 2.6, PZ1, MAT.BARS);
  addBox(W, 99, gS, PZ1 - 0.3, PX1, gS + 2.6, PZ1, MAT.BARS);
  addDoor(W, 'pen', { minX: 97, maxX: 99, minZ: PZ1 - 0.3, maxZ: PZ1, x: 98, z: PZ1 - 0.15, y0: gS, dh: 2.6, axis: 'x' }, 'hold', "Cutters' pen");
  W.npcs.push(...[[95, -35], [98, -36], [101, -34.5], [96.5, -33]].map(([x, z]) => ({ kind: 'civilian', captive: true, x, z, yaw: 0, home: { x: -118, z: 30 } })));
  W.pois.pen = { x: 98, z: -28 };
  // barracks and the overseer's office (security terminal)
  building(W, 134, 6, 148, 18, gS, 4.6, MAT.METAL, 'w', { doorW: 3, doorH: 3, roofMat: MAT.METAL_DARK });
  W.pois.barracks = { x: 141, z: 12 };
  building(W, 108, 8, 120, 18, gS, 4.2, MAT.METAL, 'n', { doorW: 2.4, doorH: 2.8, roofMat: MAT.METAL_DARK });
  box(W, 114, gS, 16.2, 4, 1.2, 1.0, MAT.METAL_DARK);
  box(W, 114, gS + 1.2, 16.6, 3.4, 1.2, 0.15, MAT.SCREEN, { solid: false });
  W.terminals.push({ id: 'security', kind: 'security', x: 114, z: 15 });
  W.lamps.push({ x: 114, z: 13, y: gS + 3.8, r: 6, color: 'cool', inside: true });
  for (const [x, z] of [[92, -14], [108, -26], [140, -26], [146, 0], [110, 2], [128, 4]]) lamp(W, x, z, gS, 5.5, 10, 'flood');
  for (const [x, z] of [[118, -28], [119.5, -28.3], [133, 0], [134.5, 0.3], [150, -30], [150, -32]]) crate(W, x, z, gS);
  W.cameras = [
    { id: 'c0', x: X0 + 1.4, y: gS + 5.2, z: gateZ - 4.2, yaw: Math.PI / 2 + 0.2, sweep: 0.7, speed: 0.4 },
    { id: 'c1', x: 131, y: gS + 7.2, z: -14.2, yaw: Math.PI * 0.75, sweep: 0.8, speed: 0.3 },
    { id: 'c2', x: 120.3, y: gS + 3.6, z: 7.6, yaw: Math.PI, sweep: 0.7, speed: 0.35 },
    { id: 'c3', x: 152, y: gS + 5, z: -6, yaw: Math.PI / 2, sweep: 0.6, speed: 0.4 },
  ];
  W.roster = [
    { name: 'gate-l', post: true, tasks: [T(X0 - 3.4, gateZ - 4.6, 'scan', [5, 9], Math.PI / 2)] },
    { name: 'gate-r', post: true, tasks: [T(X0 - 3.4, gateZ + 4.6, 'scan', [5, 9], Math.PI / 2)] },
    { name: 'yard', tasks: [T(107, -19), T(144, -20, 'look', [2, 4]), T(144, -4), T(112, -1, 'scan', [2, 4])] },
    { name: 'pen', tasks: [T(96, -27.5, 'look', [4, 7], 0), T(102, -27.5, 'look', [3, 6], 0)] },
    { name: 'logs', tasks: [T(100, 2.3, 'work', [4, 7]), T(94, 9, 'work', [3, 5]), T(104, 9, 'look', [2, 3])] },
    { name: 'office', tasks: [T(114, 14.8, 'work', [8, 12], 0), T(114, 6, 'look', [2, 4])] },
    { name: 'bunk-a', tasks: [T(138, 9.5, 'talk', [10, 16], -Math.PI / 2), T(128, 2, 'look', [2, 4])] },
    { name: 'bunk-b', tasks: [T(138, 14.5, 'talk', [12, 18], -Math.PI / 2)] },
    { name: 'inner', tasks: [T(107, -37), T(150, -36.5, 'scan', [2, 3]), T(152.5, -2), T(124, 3, 'scan', [2, 3])] },
    { name: 'outer', tasks: [T(80, -45, 'scan', [2, 4]), T(160, -45), T(160, 25, 'look', [2, 3]), T(80, 25)] },
    { name: 'mechanic', tasks: [T(115, -18.6, 'work', [5, 8], 0), T(135, -18.6, 'work', [5, 8], 0)] },
  ];
  W.towers.forEach((t, i) => W.roster.push({ name: 'tower' + i, post: true, tower: t, tasks: [T(t.x, t.z, 'scan', [4, 8], yawTo(120, -10, t.x, t.z) + Math.PI)] }));
  W.roster.push({ name: 'kade', officer: true, tasks: [T(107, -24, 'look', [3, 5]), T(146, 0, 'look', [3, 4]), T(98, -27, 'talk', [4, 6]), T(90, -10, 'scan', [3, 5])] });
  W.officerName = 'Overseer Kade';
  shiftWorld(W, siteMark, SITE_SHIFT, 0);
  W.siteShift = { dx: SITE_SHIFT, dz: 0 };
});

// ------------------------------------------------------------------ Korrun Deep

registerLayout('korrun', (W) => {
  const gV = 11, gP = 11, gS = 13;
  const PX = -190, PZ = 25;
  box(W, PX, gP - 0.4, PZ, 20, 0.7, 20, MAT.CONCRETE);
  placeShip(W, PX, gP + 0.3, PZ - 2, 0);
  W.pois.spawn = { x: PX, z: PZ + 7, y: gP + 0.3 };
  lamp(W, PX + 9, PZ + 9, gP + 0.3, 4, 8, 'cool');
  lamp(W, PX - 9, PZ + 9, gP + 0.3, 4, 8, 'cool');
  // Rime Hold: insulated prefab huts around a heat beacon
  const VX = -130, VZ = 70;
  W.regions.town = { x: VX, z: VZ, r: 46 };
  box(W, VX, gV, VZ, 1.6, 4.5, 1.6, MAT.METAL_DARK);
  box(W, VX, gV + 4.5, VZ, 2.2, 0.8, 2.2, MAT.LAMP, { solid: false });
  W.lamps.push({ x: VX, z: VZ, y: gV + 4.8, r: 12, color: 'warm' });
  const huts = [[-152, 56, 10, 8], [-150, 84, 9, 9], [-128, 96, 10, 8], [-104, 84, 9, 8], [-104, 56, 10, 8], [-128, 46, 9, 7]];
  let thaw = null;
  huts.forEach(([hx, hz, w, d], i) => {
    const side = faceSide(VX, VZ, hx, hz);
    // the Thaw (i = 0) is entered, so it stays a procedural hut; the rest are KayKit base modules
    const door = i === 0
      ? building(W, hx - w / 2, hz - d / 2, hx + w / 2, hz + d / 2, gV, 3.8 + (i % 2) * 0.6, i % 2 ? MAT.METAL : MAT.CONCRETE, side, { doorW: i === 0 ? 2.8 : 2, doorH: 2.5, roofMat: MAT.METAL_DARK })
      : packBuilding(W, prefabSkin(i + 2), hx - w / 2, hz - d / 2, hx + w / 2, hz + d / 2, gV, side, { mat: i % 2 ? MAT.METAL : MAT.CONCRETE, roofMat: MAT.METAL_DARK });
    const [ox, oz] = sideOffset(side, 1.6);
    W.civSpots.push({ x: door.x + ox, z: door.z + oz, act: 'idle', home: true });
    lamp(W, door.x + ox * 1.6 + (side === 'n' || side === 's' ? 2 : 0), door.z + oz * 1.6 + (side === 'e' || side === 'w' ? 2 : 0), gV, 3, 6, 'warm');
    if (i === 0) thaw = { x: hx, z: hz, side };
  });
  // "The Thaw" — a warm hut where Tobin Vale waits
  W.npcs.push({ kind: 'informant', contact: 'tobin', x: thaw.x - 2.5, z: thaw.z - 1.5, yaw: Math.PI / 2 });
  box(W, thaw.x - 1, gV, thaw.z - 1.5, 1.6, 0.85, 1.6, MAT.WOOD);
  W.lamps.push({ x: thaw.x, z: thaw.z, y: gV + 3, r: 7, color: 'warm', inside: true });
  W.civSpots.push({ x: thaw.x + 1, z: thaw.z + 1.5, act: 'talk', inside: true }, { x: thaw.x + 2.2, z: thaw.z + 1, act: 'talk', inside: true });
  stall(W, -118, 74, gV, MAT.CLOTH2);
  W.npcs.push({ kind: 'merchant', merchant: 'sava', x: -118, z: 73.2, yaw: Math.PI });
  W.civSpots.push({ x: -118, z: 75.6, act: 'idle' }, { x: -133, z: 66, act: 'talk' }, { x: -131.5, z: 64.5, act: 'talk' }, { x: -126, z: 72, act: 'idle' }, { x: -136, z: 74, act: 'work' });
  for (const [x, z] of [[-140, 60], [-115, 60], [-140, 80]]) crate(W, x, z, gV);
  W.pois.speeders = [{ x: -92, z: 62, yaw: -Math.PI / 2 }, { x: -92, z: 66, yaw: -Math.PI / 2 }];
  W.herds = [{ x: -40, z: 100 }, { x: 40, z: 110 }, { x: -60, z: -40 }];
  W.critterBounds = [-200, 80, -120, 140];
  W.civCount = 8;
  // wind-carved ice spires
  scatterProps(W, 'spire', 977, 70, [480, 360], 8, (x, y, z, s, rng) => {
    const h = (5 + rng() * 9) * s;
    box(W, x, y - 1, z, 1.6 * s, h + 1, 1.6 * s, MAT.ROCK, { render: false, tag: 'spire' });
    W.decor.push({ type: 'spire', x, y, z, s, h, v: rng() });
  });

  // Cryo-Vault Sigma (authored near x 95..165, shifted east by SITE_SHIFT)
  const siteMark = markWorld(W);
  const X0 = 95, X1 = 165, Z0 = 10, Z1 = 70, gateZ = 40;
  compound(W, X0, X1, Z0, Z1, gS, gateZ, 55, MAT.METAL);
  // the vault (keyed with the code Tobin sells)
  const vd = building(W, 120, 14, 146, 32, gS, 7, MAT.CONCRETE, 's', { doorW: 2.8, doorH: 3, roofMat: MAT.METAL_DARK, wall: 0.8 });
  addDoor(W, 'vault', vd, 'vaultcode', 'Cryo-Vault');
  for (let i = 0; i < 5; i++) { box(W, 123.5 + i * 4.2, gS, 16.6, 2, 3.4, 1.6, MAT.METAL_DARK); box(W, 123.5 + i * 4.2, gS + 0.6, 17.5, 1.4, 2.2, 0.1, MAT.SCREEN, { solid: false }); }
  box(W, 140, gS, 24, 2.6, 1.3, 1.4, MAT.METAL_DARK);
  box(W, 140, gS + 1.3, 23.4, 2.2, 1.1, 0.15, MAT.SCREEN, { solid: false });
  W.terminals.push({ id: 'cryo', kind: 'cryo', x: 140, z: 25.6 });
  W.lamps.push({ x: 132, z: 24, y: gS + 6, r: 9, color: 'cool', inside: true });
  W.pois.vaultInside = { x: 132, z: 24 };
  // lab with the security terminal
  building(W, 100, 50, 114, 64, gS, 4.4, MAT.METAL, 'e', { doorW: 2.4, doorH: 2.8, roofMat: MAT.METAL_DARK });
  box(W, 102.4, gS, 57, 1.0, 1.2, 4, MAT.METAL_DARK);
  box(W, 101.9, gS + 1.2, 57, 0.15, 1.2, 3.4, MAT.SCREEN, { solid: false });
  W.terminals.push({ id: 'security', kind: 'security', x: 104, z: 57 });
  W.lamps.push({ x: 107, z: 57, y: gS + 4, r: 6, color: 'cool', inside: true });
  // barracks
  building(W, 148, 44, 162, 60, gS, 4.6, MAT.METAL, 'w', { doorW: 3, doorH: 3, roofMat: MAT.METAL_DARK });
  W.pois.barracks = { x: 155, z: 52 };
  // cryo-coolant tanks and the comms mast
  [[150, 20], [156, 20], [150, 27]].forEach(([x, z], i) => {
    const b = box(W, x, gS, z, 3.6, 5, 3.6, MAT.FUEL, { tag: 'tank' });
    W.destructibles['tank' + i] = { id: 'tank' + i, kind: 'tank', x, z, y: gS, hp: 90, maxHp: 90, boxId: b.id, radius: 2.2, height: 5, destroyed: false, coolant: true };
  });
  { const b = box(W, 160, gS, 66, 2.4, 22, 2.4, MAT.METAL_DARK, { tag: 'mast' }); W.destructibles.mast = { id: 'mast', kind: 'mast', x: 160, z: 66, y: gS, hp: 320, maxHp: 320, boxId: b.id, radius: 1.6, height: 22, destroyed: false }; }
  for (const [x, z] of [[110, 40], [111.5, 40.3], [126, 44], [127.5, 44], [126, 45.6], [140, 50], [141.4, 50.6], [118, 64], [132, 62]]) crate(W, x, z, gS);
  for (const [x, z] of [[102, 30], [118, 38], [146, 38], [130, 52], [150, 66], [114, 46]]) lamp(W, x, z, gS, 5.5, 10, 'flood');
  W.cameras = [
    { id: 'c0', x: X0 + 1.4, y: gS + 5.2, z: gateZ - 4.2, yaw: Math.PI / 2 + 0.2, sweep: 0.7, speed: 0.4 },
    { id: 'c1', x: 128, y: gS + 5.4, z: 32.6, yaw: Math.PI, sweep: 0.8, speed: 0.33 },
    { id: 'c2', x: 114.6, y: gS + 4, z: 52, yaw: -Math.PI / 2 - 0.4, sweep: 0.6, speed: 0.35 },
    { id: 'c3', x: 160, y: gS + 5, z: 68.6, yaw: -Math.PI * 0.8, sweep: 0.6, speed: 0.35 },
    { id: 'c4', x: 133, y: gS + 6, z: 17.2, yaw: Math.PI, sweep: 0.9, speed: 0.4 },
  ];
  W.roster = [
    { name: 'gate-l', post: true, tasks: [T(X0 - 3.4, gateZ - 4.6, 'scan', [5, 9], Math.PI / 2)] },
    { name: 'gate-r', post: true, tasks: [T(X0 - 3.4, gateZ + 4.6, 'scan', [5, 9], Math.PI / 2)] },
    { name: 'vault-door', post: true, tasks: [T(128.8, 34.6, 'scan', [6, 10], Math.PI)] },
    { name: 'yard', tasks: [T(104, 36), T(146, 36, 'look', [2, 4]), T(146, 42), T(104, 44, 'scan', [2, 4])] },
    { name: 'vault-in', tasks: [T(126, 22, 'look', [3, 6]), T(138, 28, 'work', [4, 6])] },
    { name: 'lab', tasks: [T(104.2, 57, 'work', [8, 12], Math.PI / 2), T(110, 54, 'look', [2, 4])] },
    { name: 'tanks', tasks: [T(153, 24, 'work', [4, 6]), T(146, 18, 'look', [2, 4])] },
    { name: 'bunk-a', tasks: [T(145, 51, 'talk', [10, 16], Math.PI / 2), T(136, 58, 'look', [2, 4])] },
    { name: 'bunk-b', tasks: [T(145, 53.5, 'talk', [12, 18], Math.PI / 2)] },
    { name: 'inner', tasks: [T(102, 12.4), T(161.5, 12.4, 'scan', [2, 3]), T(161.5, 40), T(118, 66.5, 'scan', [2, 3]), T(99, 66.5)] },
    { name: 'outer', tasks: [T(90, 5, 'scan', [2, 4]), T(170, 5), T(170, 75, 'look', [2, 3]), T(90, 75)] },
  ];
  W.towers.forEach((t, i) => W.roster.push({ name: 'tower' + i, post: true, tower: t, tasks: [T(t.x, t.z, 'scan', [4, 8], yawTo(130, 40, t.x, t.z) + Math.PI)] }));
  W.roster.push({ name: 'ishen', officer: true, tasks: [T(131, 36, 'look', [3, 5]), T(110, 45, 'look', [3, 4]), T(150, 34, 'talk', [4, 6]), T(138, 36, 'scan', [3, 5])] });
  W.officerName = 'Doctor-Commander Ishen';
  shiftWorld(W, siteMark, SITE_SHIFT, 0);
  W.siteShift = { dx: SITE_SHIFT, dz: 0 };
});
