// Plays each mission end-to-end against the authoritative simulation (no rendering).
// Run: node tools/missions-test.js
import { Game } from '../shared/sim/game.js';
import { K, TICK_DT } from '../shared/config.js';
import { groundAt, DUSK_SHIFT as S } from '../shared/world.js';

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

function setup() {
  const g = new Game({ send: () => {}, solo: true });
  g.addPlayer('p1', { name: 'Tester' });
  const p = g.playerOf('p1');
  // Invulnerable tester so missions can be validated without dodging bolts
  const dmg = g.damage.bind(g);
  g.damage = (e, a, s, i) => dmg(e, e.kind === K.PLAYER ? 0 : a, s, i);
  return { g, p };
}
function place(g, p, x, z, yaw = 0) {
  p.tpSeq++; // keep the input path in sync with the server's teleport counter
  p.x = x; p.z = z; p.y = groundAt(g.world, x, z, 60) + 0.02; p.yaw = yaw;
}
function run(g, seconds) { for (let i = 0; i < seconds / TICK_DT; i++) g.tick(TICK_DT); }
function face(p, x, z) { p.yaw = Math.atan2(-(x - p.x), -(z - p.z)); }
function use(g, p, holdSeconds = 0) {
  g.rebuildSpatial();
  const c = g.pickInteract(p);
  g.handle('p1', { t: 'use', id: c && c.id, down: true });
  if (holdSeconds) run(g, holdSeconds + 0.3);
  g.handle('p1', { t: 'use', down: false });
  return c;
}

// ---------------------------------------------------------------- rescue
{
  const { g, p } = setup();
  const W = g.world;
  place(g, p, W.pois.board.x, W.pois.board.z + 1.2); face(p, W.pois.board.x, W.pois.board.z);
  g.handle('p1', { t: 'accept', id: 'rescue' });
  check(g.mission && g.mission.id === 'rescue', 'rescue: accepted at the job board');
  place(g, p, W.pois.informant.x, W.pois.informant.z + 1.6); face(p, W.pois.informant.x, W.pois.informant.z);
  const c = use(g, p);
  run(g, 0.2);
  check(g.party.items.cellcode, `rescue: Oru hands over the cell code (${c && c.id})`);
  place(g, p, 150 + S, -11); run(g, 0.3);
  check(g.mission.done[1], 'rescue: infiltrating the garrison completes step 2');
  place(g, p, W.doors.cellblock.x, W.doors.cellblock.z + 1.4); face(p, W.doors.cellblock.x, W.doors.cellblock.z);
  use(g, p); run(g, 0.2);
  check(W.doors.cellblock.open, 'rescue: cell code opens the detention block');
  place(g, p, W.doors.cell.x, W.doors.cell.z + 1.3); face(p, W.doors.cell.x, W.doors.cell.z);
  use(g, p, 2.5); run(g, 0.2);
  const pr = g.ents.get(g.prisonerId);
  check(W.doors.cell.open && pr.ai.state === 'follow', 'rescue: cutting the lock frees Ilsa, who follows');
  // Walk toward the LZ in steps; she should keep up
  const path = [[151 + S, -11], [145 + S, -4], [135 + S, 0], [121 + S, 0], [292, 14], [272, 34], [254, 52], [240, 62], [238, 64]];
  let status = 'active';
  let sawHint = false;
  for (const [x, z] of path) {
    if (!W.doors.gate.open && x < 140 + S) {
      const view = g.globalState().m.steps[g.mission.step][0];
      sawHint = sawHint || /sealed/.test(view);
      place(g, p, W.pois.gatePanel.x + 1, W.pois.gatePanel.z); face(p, W.pois.gatePanel.x, W.pois.gatePanel.z); use(g, p, 1.5); run(g, 0.2);
    }
    place(g, p, x, z);
    for (let i = 0; i < 6 / TICK_DT && status === 'active'; i++) { g.tick(TICK_DT); status = g.mission ? g.mission.status : status; }
    if (status !== 'active') break;
  }
  check(sawHint || W.doors.gate.open, 'rescue: sealed gate is signposted and the override opens it');
  const d = Math.hypot(pr.x - W.pois.lz.x, pr.z - W.pois.lz.z);
  if (status === 'failed') console.log('  reason:', g.mission.reason);
  check(status === 'complete', `rescue: mission completes when Ilsa reaches the LZ (she is ${d.toFixed(1)}m away)`);
  check(p.credits >= 1800, `rescue: reward paid (credits ${p.credits})`);
  check(p.xp >= 300, `rescue: the job pays experience too (${p.xp} xp)`);
}

// ---------------------------------------------------------------- heist
{
  const { g, p } = setup();
  const W = g.world;
  place(g, p, W.pois.board.x, W.pois.board.z + 1.2);
  g.handle('p1', { t: 'accept', id: 'heist' });
  check(g.mission && g.mission.id === 'heist', 'heist: accepted');
  const o = g.ents.get(g.officerId);
  // sneak up behind Rhal and lift the keycard
  run(g, 1);
  const bx = o.x + Math.sin(o.yaw) * 1.3, bz = o.z + Math.cos(o.yaw) * 1.3;
  place(g, p, bx, bz); face(p, o.x, o.z); p.crouch = true;
  g.camerasOn = false; g.camOffUntil = g.time + 999; // keep this a pickpocket test, not a camera test
  o.ai.sus = 0; o.ai.state = 'routine'; o.ai.wait = 30;
  g.rebuildSpatial();
  const c = g.pickInteract(p);
  check(c && c.id.startsWith('pocket'), `heist: pickpocket prompt from behind (${c && c.label})`);
  g.handle('p1', { t: 'use', id: c && c.id, down: true });
  for (let i = 0; i < 40; i++) { o.ai.sus = 0; o.ai.wait = 30; place(g, p, o.x + Math.sin(o.yaw) * 1.3, o.z + Math.cos(o.yaw) * 1.3); face(p, o.x, o.z); g.tick(TICK_DT); }
  check(g.party.items.keycard, 'heist: keycard lifted');
  place(g, p, W.doors.command.x - 1.4, W.doors.command.z, -Math.PI / 2); face(p, W.doors.command.x, W.doors.command.z);
  use(g, p); run(g, 0.2);
  check(W.doors.command.open, 'heist: keycard opens the command center');
  place(g, p, W.pois.vault.x - 1.0, W.pois.vault.z); face(p, W.pois.vault.x + 2, W.pois.vault.z);
  run(g, 0.3);
  use(g, p, 6);
  check(g.party.items.datacore, 'heist: vault sliced, data core acquired');
  place(g, p, W.pois.lz.x, W.pois.lz.z); run(g, 0.5);
  check(g.mission.status === 'complete', `heist: complete at the LZ (ghost=${g.mission.ghost})`);
}

// ---------------------------------------------------------------- sabotage
{
  const { g, p } = setup();
  const W = g.world;
  place(g, p, W.pois.board.x, W.pois.board.z + 1.2);
  g.handle('p1', { t: 'accept', id: 'sabotage' });
  check(g.mission && g.mission.id === 'sabotage', 'sabotage: accepted');
  p.grenades = 6;
  // Throw a charge at the mast
  place(g, p, 196 + S, -6); face(p, 204 + S, -6);
  g.handle('p1', { t: 'gren', o: [p.x, p.y + 1.5, p.z], d: [1, 0.05, 0] });
  run(g, 3);
  g.damageDestructible(W.destructibles.mast, 999, p);
  run(g, 0.5);
  check(W.destructibles.mast.destroyed, 'sabotage: comms mast toppled');
  place(g, p, 190 + S, 10); face(p, 202 + S, 10);
  g.handle('p1', { t: 'gren', o: [p.x, p.y + 1.5, p.z], d: [0.97, 0.15, 0] });
  run(g, 3.5);
  const tanks = [0, 1, 2, 3].filter((i) => W.destructibles['tank' + i].destroyed).length;
  check(tanks >= 2, `sabotage: one charge plus chain reaction burned ${tanks}/4 tanks`);
  for (let i = 0; i < 4; i++) g.damageDestructible(W.destructibles['tank' + i], 999, p);
  run(g, 1);
  const o = g.ents.get(g.officerId);
  g.damage(o, 999, p, { kind: 'bolt' });
  run(g, 0.5);
  check(g.mission.done.slice(0, 3).every(Boolean), 'sabotage: mast, tanks and Rhal all done');
  check(g.alarm.active && g.world.destructibles.mast.destroyed, 'sabotage: alarm raised but reinforcements cut off');
  place(g, p, W.pois.lz.x, W.pois.lz.z); run(g, 0.5);
  check(g.mission.status === 'complete', 'sabotage: complete at the LZ');
}

// ---------------------------------------------------------------- stealth sanity
{
  const { g, p } = setup();
  place(g, p, 224 + S, -22); p.crouch = true;
  run(g, 5);
  check(!g.alarm.active, `stealth: crouching in the shadows outside the culvert stays unseen (vis ${p.visibility.toFixed(2)})`);
  place(g, p, 140 + S, 0); p.crouch = false;
  run(g, 8);
  check(g.alarm.active, 'stealth: standing in the floodlit courtyard gets you spotted and the alarm raised');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll mission checks passed');
process.exit(failures ? 1 : 0);
