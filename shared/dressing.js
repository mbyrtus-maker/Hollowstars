// Set dressing from the CC0 model packs (see client/assets/CREDITS.md): colony prefabs and parked
// rovers around each spaceport, loader mechs at the workshops, crates, barrels and comms dishes in
// the Concordance compounds, and specimen tanks in Cryo-Vault Sigma.
//
// Everything here is a `model` decor entry the client draws from the packs, plus a collision box for
// anything big enough to matter. Each placement is checked against the paths people walk (patrols,
// workers, traffic, roads) and the spots the game uses (doors, terminals, pads, POIs), and skipped if
// it would get in the way, so the dressing can never block a mission. The checks are deterministic,
// so the server and every client agree on what stands where.
import { box, terrainHeight, roadDistance, extendLayout, MAT } from './world.js';
import { distPointSegXZ, dist2 } from './math.js';
import { routeDist } from './districts.js';

// footprint of each model at scale 1 in its own frame: [minX, minZ, maxX, maxZ, height]
const FOOT = {
  SK_Base_Large: [-4.26, -4.26, 4.26, 4.26, 5],
  SK_GeodesicDome: [-4.26, -4.26, 4.26, 4.26, 5.3],
  SK_Building_L: [-2, -6, 5.8, 1.81, 4.3],
  SK_House_Cylinder: [-2.8, -2.8, 2.8, 2.8, 4.3],
  SK_House_Long: [-2, -6, 2, 1.81, 4.3],
  SK_House_Single: [-2, -2, 2, 1.81, 4.3],
  SK_House_Open: [-2, -1.81, 2, 1.81, 4.3],
  SK_SolarPanel_Structure: [-2, -2, 2, 2, 3.1],
  SK_SolarPanel_Ground: [-0.64, -0.78, 0.64, 0.89, 1.1],
  SK_Rover_1: [-2.29, -2.58, 2.29, 2.58, 4.7],
  SK_Rover_2: [-2.29, -3.98, 2.29, 2.58, 4.7],
  SK_Rover_Round: [-2.89, -1.85, 2.89, 1.85, 5],
  SK_Mech_FinnTheFrog: [-1.2, -0.83, 1.2, 1.31, 3],
  SK_Mech_BarbaraTheBee: [-1.1, -0.76, 1.1, 1.41, 2.9],
  SK_Rock_Large_1: [-3.85, -4.03, 3.82, 3.31, 3],
  SK_Rock_Large_3: [-2.77, -3.01, 2.54, 2.18, 7],
  Prop_SatelliteDish: [-0.92, -1.29, 0.92, 1.49, 5.8],
  Prop_Barrel1: [-0.36, -0.32, 0.36, 0.32, 1.1],
  Prop_Barrel2_Closed: [-0.27, -0.27, 0.27, 0.27, 0.8],
  Prop_Crate_Tarp: [-0.86, -0.86, 0.86, 0.86, 1.56],
  Prop_Crate_Tarp_Large: [-1.61, -0.86, 1.61, 0.86, 1.56],
  Prop_Crate_Large: [-1.73, -0.75, 1.73, 0.75, 1.5],
  Prop_Chest: [-0.92, -0.44, 0.92, 0.54, 0.95],
  Prop_Ammo_Closed: [-0.29, -0.36, 0.29, 0.36, 0.42],
  Prop_Locker: [-0.49, -0.23, 0.49, 0.27, 2.67],
  Prop_Shelves_WideTall: [-0.99, -0.27, 0.99, 0.27, 2.67],
  Prop_Shelves_ThinShort: [-0.69, -0.27, 0.69, 0.27, 1.21],
  MK_Prop_Barrel_Large: [-0.25, -0.27, 0.25, 0.27, 1.1],
  MK_Prop_Crate4: [-0.56, -0.56, 0.56, 0.56, 1.12],
  MK_Prop_Chest: [-0.75, -0.36, 0.75, 0.39, 0.73],
  MK_Prop_Computer: [-0.37, -0.22, 0.37, 0.35, 1.6],
  MK_Prop_PipeHolder: [-2.06, -0.58, 2.05, 0.58, 0.94],
  MK_Column_Pipes: [-0.44, -0.44, 0.44, 0.44, 5],
  specimen: [-0.8, -0.8, 0.8, 0.8, 2.8],
};

// the footprint turned by yaw (quarter turns), scaled and moved to (x, z)
function footprint(name, x, z, yaw, s) {
  const [a, b, c, d, h] = FOOT[name];
  const cs = Math.round(Math.cos(yaw)), sn = Math.round(Math.sin(yaw));
  const xs = [], zs = [];
  for (const [px, pz] of [[a, b], [c, b], [a, d], [c, d]]) { xs.push(x + (px * cs + pz * sn) * s); zs.push(z + (-px * sn + pz * cs) * s); }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), h: h * s };
}

// every line and spot the game needs kept clear, gathered once per world
function keepClear(W) {
  if (W._keep) return W._keep;
  const lines = [], spots = [];
  const poly = (pts, pad) => { for (let i = 0; i < pts.length - 1; i++) lines.push([pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z, pad]); if (pts.length === 1) spots.push([pts[0].x, pts[0].z, pad]); };
  for (const r of W.roster || []) if (r.tasks) { poly(r.tasks, 1.8); if (r.tasks.length > 2) lines.push([r.tasks.at(-1).x, r.tasks.at(-1).z, r.tasks[0].x, r.tasks[0].z, 1.8]); }
  for (const w of W.workers) { poly(w.tasks, 1.6); if (w.home) spots.push([w.home.x, w.home.z, 2]); }
  const spot = (o, pad) => { if (o && typeof o.x === 'number') spots.push([o.x, o.z, pad]); };
  for (const p of Object.values(W.pois)) Array.isArray(p) ? p.forEach((q) => spot(q, 3)) : spot(p, 3);
  for (const d of Object.values(W.doors)) spot(d, 3.5);
  for (const t of W.terminals) spot(t, 2.5);
  for (const n of W.npcs) spot(n, 2.5);
  for (const c of W.civSpots) spot(c, 1.8);
  for (const n of W.nodes) spot(n, 2.2);
  for (const l of W.lamps) spot(l, 0.9);
  for (const s of W.shops) { spot(s, 2); spot(s.door, 3); spot(s.front, 2); }
  for (const p of W.pads) spot(p, 12.5);
  for (const d of Object.values(W.destructibles)) spot(d, (d.radius || 1) + 1.5);
  return (W._keep = { lines, spots });
}

// true if a footprint at height y would stand in anyone's way or inside anything
function blocked(W, f, y) {
  const cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2, r = Math.hypot(f.maxX - f.minX, f.maxZ - f.minZ) / 2;
  const { lines, spots } = keepClear(W);
  for (const [ax, az, bx, bz, pad] of lines) if (distPointSegXZ(cx, cz, ax, az, bx, bz) < r + pad) return true;
  for (const [sx, sz, pad] of spots) if (dist2(cx, cz, sx, sz) < r + pad) return true;
  for (const t of W.traffic) if (routeDist(cx, cz, t.pts, t.loop) < r + 4) return true;
  if (roadDistance(cx, cz) < r + 5) return true;
  const top = y + Math.max(f.h, 0.6);
  for (const b of W.boxes) {
    if (!b.solid && !b.render) continue;
    if (b.maxY < y + 0.3 || b.minY > top) continue; // floors under it, roofs over it
    if (b.maxX < f.minX - 0.4 || b.minX > f.maxX + 0.4 || b.maxZ < f.minZ - 0.4 || b.minZ > f.maxZ + 0.4) continue;
    return true;
  }
  return false;
}

// Place one model. Outdoors (y undefined) it needs fairly level ground above any water.
// opts: { anim, solid (default: anything over 0.9 m), cover: extra models stacked at the same spot }
function place(W, name, x, z, yaw = 0, s = 1, y, opts = {}) {
  const f = footprint(name, x, z, yaw, s);
  let gy = y;
  if (gy == null) {
    const hs = [[f.minX, f.minZ], [f.maxX, f.minZ], [f.minX, f.maxZ], [f.maxX, f.maxZ], [x, z]].map(([px, pz]) => terrainHeight(px, pz));
    const lo = Math.min(...hs), hi = Math.max(...hs);
    if (hi - lo > Math.max(0.9, (f.maxX - f.minX) * 0.12)) return false;
    if (W.water != null && lo < W.water + 0.2) return false;
    gy = lo - 0.05;
  }
  if (blocked(W, f, gy)) return false;
  if (name === 'specimen') W.decor.push({ type: 'specimen', x, y: gy, z, yaw, alien: opts.alien });
  else W.decor.push({ type: 'model', name, x, y: gy, z, yaw, s, anim: opts.anim });
  for (const extra of opts.with || []) W.decor.push({ type: 'model', name: extra, x, y: gy, z, yaw, s });
  if (opts.solid ?? f.h > 0.9) {
    const w = f.maxX - f.minX, d = f.maxZ - f.minZ, inset = opts.inset ?? 0.1;
    box(W, (f.minX + f.maxX) / 2, gy, (f.minZ + f.maxZ) / 2, Math.max(0.3, w - inset * 2), f.h, Math.max(0.3, d - inset * 2), MAT.METAL_DARK, { render: false, tag: 'prop' });
  }
  return true;
}
const firstFit = (W, name, spots, s, y, opts) => spots.some(([x, z, yaw = 0]) => place(W, name, x, z, yaw, s, y, opts));
const hash = (x, z) => { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return h - Math.floor(h); };
const Q = Math.PI / 2;

// ------------------------------------------------------------------ colony prefabs at a spaceport

// `out` points away from town; the prefabs stand behind the pads in a loose arc
function colony(W, cx, cz, out, n, set) {
  const l = Math.hypot(out[0], out[1]) || 1, ux = out[0] / l, uz = out[1] / l;
  const px = -uz, pz = ux; // across
  const yawOut = Math.round(Math.atan2(ux, uz) / Q) * Q; // face the doors back toward the pads
  let placed = 0;
  for (let k = 0; k < 40 && placed < n; k++) {
    const ring = 26 + (k % 3) * 9, across = ((k * 7) % 11 - 5) * 7.5;
    const x = +(cx + ux * ring + px * across).toFixed(1), z = +(cz + uz * ring + pz * across).toFixed(1);
    const [name, extra] = set[placed % set.length];
    if (place(W, name, x, z, yawOut + Math.PI, 1, undefined, { with: extra ? [extra] : [] })) placed++;
  }
  // solar fields and parked rovers fill the gaps
  for (let k = 0, m = 0; k < 30 && m < 4; k++) {
    const x = cx + ux * (20 + (k % 4) * 6) + px * ((k % 7) - 3) * 9, z = cz + uz * (20 + (k % 4) * 6) + pz * ((k % 7) - 3) * 9;
    if (place(W, k % 2 ? 'SK_SolarPanel_Structure' : 'SK_SolarPanel_Ground', +x.toFixed(1), +z.toFixed(1), yawOut, k % 2 ? 1 : 1.4)) m++;
  }
  for (let k = 0, m = 0; k < 24 && m < 2; k++) {
    const x = cx + ux * (14 + (k % 3) * 5) + px * (((k * 5) % 9) - 4) * 6, z = cz + uz * (14 + (k % 3) * 5) + pz * (((k * 5) % 9) - 4) * 6;
    if (place(W, ['SK_Rover_1', 'SK_Rover_2', 'SK_Rover_Round'][m % 3], +x.toFixed(1), +z.toFixed(1), yawOut + Q * (k % 2), 0.55)) m++;
  }
}

// a loader mech standing idle beside a building
function mech(W, which, spots) {
  const name = which ? 'SK_Mech_BarbaraTheBee' : 'SK_Mech_FinnTheFrog';
  firstFit(W, name, spots, 1.05, undefined, { anim: name + '|Idle' });
}

// ------------------------------------------------------------------ Concordance compounds

const CLUTTER = [['Prop_Crate_Tarp', 1], ['Prop_Barrel1', 1, ['Prop_Barrel2_Closed']], ['MK_Prop_Barrel_Large', 1.4], ['Prop_Crate_Tarp_Large', 1], ['Prop_Chest', 1], ['MK_Prop_Crate4', 1.2], ['Prop_Crate_Large', 1]];

// stores and barrels against the inside of the walls, a dish by the mast, pipes along the yard
function compoundDressing(W, y, max = 14) {
  const g = W.regions.garrison;
  if (!g) return;
  const inset = 2.6, step = 6.5;
  const cand = [];
  for (let x = g.minX + 8; x < g.maxX - 8; x += step) cand.push([x, g.minZ + inset, 0], [x + step / 2, g.maxZ - inset, Math.PI]);
  for (let z = g.minZ + 8; z < g.maxZ - 8; z += step) cand.push([g.minX + inset, z, Q], [g.maxX - inset, z + step / 2, -Q]);
  let n = 0;
  cand.forEach(([x, z, yaw], i) => {
    if (n >= max) return;
    const [name, s] = CLUTTER[Math.floor(hash(x, z) * CLUTTER.length)];
    if (place(W, name, +x.toFixed(1), +z.toFixed(1), yaw, s, y)) n++;
    else if (i % 3 === 0 && place(W, 'Prop_Ammo_Closed', +x.toFixed(1), +z.toFixed(1), yaw, 1.6, y)) n++;
  });
  const mast = W.destructibles.mast;
  if (mast) firstFit(W, 'Prop_SatelliteDish', [[mast.x - 4, mast.z, Q], [mast.x + 4, mast.z, -Q], [mast.x, mast.z + 4.5, Math.PI], [mast.x, mast.z - 4.5, 0], [mast.x - 5, mast.z - 4, Q]], 1, y);
  // coolant pipe racks beside the tanks
  const tanks = Object.values(W.destructibles).filter((d) => d.kind === 'tank');
  if (tanks.length) {
    const t = tanks[0];
    firstFit(W, 'MK_Prop_PipeHolder', [[t.x, t.z - 4.6, 0], [t.x - 4.6, t.z, Q], [t.x, t.z + 4.6, 0], [t.x + 4.6, t.z, Q]], 1, y);
  }
}

// lockers, shelves and terminals for a room: spots are [x, z, yaw] against its walls
function furnish(W, y, items) { for (const [name, spots, s = 1] of items) firstFit(W, name, spots, s, y, { inset: 0.05 }); }

// ------------------------------------------------------------------ Dusk Varo

extendLayout('duskvaro', (W) => {
  colony(W, -250, 127, [-1, 0.9], 5, [['SK_Base_Large'], ['SK_House_Single', 'SK_Roof_Radar'], ['SK_House_Long', 'SK_Roof_Antenna'], ['SK_GeodesicDome'], ['SK_House_Cylinder']]);
  mech(W, 0, [[-208.5, 4, Math.PI], [-191.5, 4, Math.PI], [-210, 8, Math.PI]]);
  mech(W, 1, [[-272, 124, Q], [-248, 150, Math.PI], [-276, 104, Q]]);
  // Garrison Seven (its authored coordinates + DUSK_SHIFT)
  const gG = 10, dx = W.siteShift ? W.siteShift.dx : 190;
  compoundDressing(W, gG);
  furnish(W, gG, [
    ['Prop_Shelves_WideTall', [[176 + dx, -28.6, 0], [182 + dx, -28.6, 0]]],
    ['Prop_Shelves_WideTall', [[179 + dx, -28.6, 0], [185 + dx, -28.6, 0]]],
    ['MK_Prop_Computer', [[186.6 + dx, -27.2, -Q], [186.6 + dx, -25, -Q]]],
    ['Prop_Locker', [[140.9 + dx, 19, Q], [140.9 + dx, 21, Q]]],
    ['Prop_Locker', [[161.1 + dx, 19, -Q], [161.1 + dx, 21, -Q]]],
    ['Prop_Shelves_ThinShort', [[172.9 + dx, 22.6, Q], [172.9 + dx, 16, Q]]],
  ]);
  firstFit(W, 'Prop_Barrel1', [[196 + dx, 22.4], [195.6 + dx, 24], [210 + dx, 21]], 1.1, gG, { with: ['Prop_Barrel2_Closed'] });
});

// ------------------------------------------------------------------ Thessaly Mire

extendLayout('thessaly', (W) => {
  colony(W, -196, -77, [-0.9, -1], 4, [['SK_House_Single', 'SK_Roof_Antenna'], ['SK_House_Cylinder'], ['SK_House_Long', 'SK_Roof_VentL'], ['SK_Building_L']]);
  mech(W, 1, [[-167.5, 59, Q], [-167.5, 73, Q], [-166, 76, Q]]);
  compoundDressing(W, 5);
});

// ------------------------------------------------------------------ Korrun Deep

extendLayout('korrun', (W) => {
  colony(W, -224, 119, [-1, 1], 5, [['SK_GeodesicDome'], ['SK_Base_Large'], ['SK_House_Cylinder'], ['SK_House_Single', 'SK_Roof_Radar'], ['SK_GeodesicDome']]);
  mech(W, 0, [[-168, 121, 0], [-152, 121, 0], [-170, 118, 0]]);
  const gS = 13, dx = W.siteShift ? W.siteShift.dx : 180;
  compoundDressing(W, gS);
  // specimen tanks along the walls of the vault: what the Concordance keeps on ice
  const ALIENS = ['MK_Alien_Cyclop', 'MK_Alien_Oculichrysalis', 'MK_Alien_Scolitex'];
  const tanks = [[122.3, 21.6], [143.7, 29.2], [122.3, 25.6], [143.7, 21.6], [122.3, 29.4], [143.7, 25.4]];
  let n = 0;
  for (const [x, z] of tanks) if (n < 4 && place(W, 'specimen', x + dx, z, 0, 1, gS, { alien: ALIENS[n % 3] })) n++;
});
