// Buildings clothed in pack models (client/assets/kits.glb, CC0, see client/assets/CREDITS.md).
//
// The world still builds every house from boxes, so collision, navigation and line of sight are
// unchanged and the server needs no model files. The boxes are marked `skin`; once the client has
// loaded the model it hides them and draws the model stretched over the same footprint. If the
// models can't load, the boxes are drawn as before.
import { building, addBox, MAT } from './world.js';

// model sizes at scale 1 (x, body height, z); every one has its front door on its +Z face
export const PACK_SIZE = {
  UBA_1Story: [2.15, 1.67, 2.17],
  UBA_1Story_RoundRoof: [2.09, 1.9, 2.13],
  UBA_2Story: [2.16, 2.75, 2.53],
  UBA_2Story_Columns: [2.16, 2.77, 2.49],
  UBA_2Story_Stairs: [2.16, 2.75, 2.53],
  KK_basemodule_A: [2.25, 1, 2.18],
  KK_basemodule_B: [2.08, 1, 2.32],
  KK_basemodule_C: [2, 1, 2.21],
  KK_basemodule_D: [2.44, 1, 2.14],
  KK_basemodule_E: [2.22, 1, 2.28],
  KK_basemodule_garage: [2, 1, 2.37],
};
const SIDE_YAW = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

// how the model is stretched over a w x d footprint, and how tall that makes it
export function packFit(name, w, d, side) {
  const [mx, my, mz] = PACK_SIZE[name];
  const turned = side === 'e' || side === 'w';
  const sx = (turned ? d : w) / mx, sz = (turned ? w : d) / mz;
  return { yaw: SIDE_YAW[side], h: my * (sx + sz) / 2 };
}

// A house whose walls and roof come from a pack model. Same arguments as building(), plus the
// model name; the height comes from the model. The door is shut: these houses aren't entered.
export function packBuilding(W, name, x0, z0, x1, z1, y0, side, opts = {}) {
  const w = x1 - x0, d = z1 - z0;
  const { yaw, h } = packFit(name, w, d, side);
  const from = W.boxes.length;
  const door = building(W, x0, z0, x1, z1, y0, h, opts.mat ?? MAT.CONCRETE, side, { doorW: 2, doorH: 2.4, roofMat: opts.roofMat ?? opts.mat ?? MAT.CONCRETE });
  addBox(W, door.minX, door.y0, door.minZ, door.maxX, door.y0 + door.dh, door.maxZ, MAT.DOOR);
  for (let i = from; i < W.boxes.length; i++) W.boxes[i].skin = true;
  W.decor.push({ type: 'model', name, x: (x0 + x1) / 2, y: y0, z: (z0 + z1) / 2, yaw, fit: [w, d] });
  return door;
}
