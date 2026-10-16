// Multi-part missions. Each mission is a list of steps with completion checks.

import { MISSIONS, K } from '../config.js';
import { dist2 } from '../math.js';

const inGarrison = (g, p) => { const r = g.world.regions.garrison; return p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ; };
const inCommand = (p) => p.x > 174.5 && p.x < 197.5 && p.z > -29.5 && p.z < -12.5;
const anyPlayer = (g, fn) => g.players().some((p) => !p.downed && !p.dead && fn(p));
const atLZ = (g, e) => dist2(e.x, e.z, g.world.pois.lz.x, g.world.pois.lz.z) < 8;
const officer = (g) => g.ents.get(g.officerId);
const poi = (g, k) => g.world.pois[k];
const door = (g, k) => g.world.doors[k];

const DEFS = {
  rescue: {
    ordered: true,
    steps: [
      { text: 'Get the cell code from Oru Dask in the Khet cantina', wp: (g) => poi(g, 'informant'), done: (g) => g.party.items.cellcode },
      { text: 'Infiltrate Garrison Seven', wp: (g) => poi(g, 'gate'), done: (g) => anyPlayer(g, (p) => inGarrison(g, p)) },
      { text: 'Open the Detention Block with the cell code', wp: (g) => door(g, 'cellblock'), done: (g) => door(g, 'cellblock').open },
      { text: 'Cut Ilsa Varn out of her cell', wp: (g) => door(g, 'cell'), done: (g) => door(g, 'cell').open },
      { text: 'Escort Ilsa to the Ridge LZ', alt: (g) => (!door(g, 'gate').open ? 'Escort Ilsa out — the gate is sealed, override its lock from inside' : null), wp: (g) => (!door(g, 'gate').open ? { x: 127.6, y: 10, z: 5 } : poi(g, 'lz')), done: (g) => { const p = g.ents.get(g.prisonerId); return p && !p.dead && atLZ(g, p); } },
    ],
    fail: (g) => { const p = g.ents.get(g.prisonerId); return !p || p.dead ? 'Ilsa Varn was killed.' : null; },
  },
  heist: {
    ordered: true,
    steps: [
      { text: 'Lift the vault keycard from Commander Rhal (pickpocket, pull, or worse)', wp: (g) => { const o = officer(g); return o && !o.dead && o.hasKeycard ? o : g.pickupPos('keycard') || poi(g, 'gate'); }, done: (g) => g.party.items.keycard },
      { text: 'Get inside the Command Center', wp: (g) => door(g, 'command'), done: (g) => anyPlayer(g, inCommand) },
      { text: 'Slice the vault console', wp: (g) => poi(g, 'vault'), done: (g) => g.party.items.datacore },
      { text: 'Get the data core to the Ridge LZ', wp: (g) => poi(g, 'lz'), done: (g) => g.party.items.datacore && anyPlayer(g, (p) => atLZ(g, p)) },
    ],
  },
  sabotage: {
    ordered: false,
    steps: [
      { text: 'Topple the comms mast', wp: (g) => poi(g, 'mast'), done: (g) => g.world.destructibles.mast.destroyed },
      { text: 'Burn the fuel tanks', count: (g) => [0, 1, 2, 3].filter((i) => g.world.destructibles['tank' + i].destroyed).length, of: 4, wp: (g) => poi(g, 'depot'), done: (g) => [0, 1, 2, 3].every((i) => g.world.destructibles['tank' + i].destroyed) },
      { text: 'Eliminate Commander Rhal', wp: (g) => officer(g), done: (g) => { const o = officer(g); return !o || o.dead; } },
      { text: 'Regroup at the Ridge LZ', final: true, wp: (g) => poi(g, 'lz'), done: (g) => anyPlayer(g, (p) => atLZ(g, p)) },
    ],
  },
};

export function startMission(g, id) {
  const def = DEFS[id];
  if (!def) return false;
  g.mission = { id, step: 0, done: def.steps.map(() => false), status: 'active', ghost: true, startedAt: g.time, endAt: 0 };
  g.resetGarrison(id);
  g.note(`Mission accepted: ${MISSIONS[id].name}`, 'mission');
  return true;
}

export function missionTick(g) {
  const m = g.mission;
  if (!m) return;
  if (m.status !== 'active') {
    if (g.time > m.endAt) { g.mission = null; g.globalDirty = true; }
    return;
  }
  const def = DEFS[m.id];
  if (def.fail) {
    const why = def.fail(g);
    if (why) { m.status = 'failed'; m.endAt = g.time + 8; m.reason = why; g.note(`Mission failed — ${why}`, 'fail'); g.globalDirty = true; return; }
  }
  if (def.ordered) {
    while (m.step < def.steps.length && def.steps[m.step].done(g)) {
      m.done[m.step] = true;
      m.step++;
      g.globalDirty = true;
      if (m.step < def.steps.length) g.note(def.steps[m.step].text, 'objective');
    }
    if (m.step >= def.steps.length) complete(g);
  } else {
    let allButFinal = true;
    def.steps.forEach((s, i) => {
      if (s.final) return;
      const d = !!s.done(g);
      if (d && !m.done[i]) { m.done[i] = true; g.globalDirty = true; g.note(`Done: ${s.text}`, 'objective'); }
      if (!d) allButFinal = false;
    });
    const fi = def.steps.findIndex((s) => s.final);
    m.step = def.steps.findIndex((s, i) => !m.done[i] && !s.final);
    if (allButFinal) {
      m.step = fi;
      if (def.steps[fi].done(g)) { m.done[fi] = true; complete(g); }
    }
  }
}

function complete(g) {
  const m = g.mission;
  const info = MISSIONS[m.id];
  const bonus = m.ghost && info.ghostBonus ? info.ghostBonus : 0;
  m.status = 'complete';
  m.endAt = g.time + 10;
  m.reward = info.reward + bonus;
  for (const p of g.players()) g.addCredits(p, info.reward + bonus);
  g.note(`Mission complete: ${info.name}  +${info.reward}cr${bonus ? `  Ghost bonus +${bonus}cr` : ''}`, 'complete');
  g.event(['mdone', m.id, info.reward, bonus]);
  g.globalDirty = true;
  if (m.id === 'rescue') {
    const pr = g.ents.get(g.prisonerId);
    if (pr) g.bark(pr, 'I owe you my life. The Reach won\'t forget this.');
  }
}

export function abandonMission(g) {
  if (!g.mission || g.mission.status !== 'active') return;
  g.note(`Mission abandoned: ${MISSIONS[g.mission.id].name}`, 'fail');
  g.mission = null;
  g.globalDirty = true;
}

export function missionView(g) {
  const m = g.mission;
  if (!m) return null;
  const def = DEFS[m.id];
  const steps = def.steps.map((s, i) => {
    let text = (m.status === 'active' && i === m.step && s.alt && s.alt(g)) || s.text;
    if (s.count) text += ` (${s.count(g)}/${s.of})`;
    return [text, m.done[i] ? 1 : 0];
  });
  let wp = null;
  if (m.status === 'active' && m.step >= 0 && m.step < def.steps.length) {
    const w = def.steps[m.step].wp(g);
    if (w) wp = [+w.x.toFixed(1), +(w.y ?? 10).toFixed(1), +w.z.toFixed(1)];
  }
  return { id: m.id, step: m.step, steps, status: m.status, ghost: m.ghost, wp, reason: m.reason || null, reward: m.reward || 0 };
}
