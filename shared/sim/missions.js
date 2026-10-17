// Multi-part missions. Each mission is a list of steps with completion checks.

import { MISSIONS, K } from '../config.js';
import { dist2 } from '../math.js';
import { PLANETS, SHIP } from '../planets.js';

const inGarrison = (g, p) => { const r = g.world.regions.garrison; return p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ; };
const inCommand = (g, p) => { const r = g.world.regions.command; return p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ; };
const anyPlayer = (g, fn) => g.players().some((p) => !p.downed && !p.dead && fn(p));
const atLZ = (g, e) => dist2(e.x, e.z, g.world.pois.lz.x, g.world.pois.lz.z) < 8;
const officer = (g) => g.ents.get(g.officerId);
const poi = (g, k) => g.world.pois[k];
const door = (g, k) => g.world.doors[k];
const item = (g, k) => !!g.party.items[k];
const contact = (g, id) => { for (const e of g.ents.values()) if (e.kind === K.INFORMANT && e.contact === id) return e; return null; };
const destroyed = (g, ids) => ids.filter((id) => g.world.destructibles[id]?.destroyed).length;

const DEFS = {
  rescue: {
    ordered: true,
    steps: [
      { text: 'Get the cell code from Oru Dask in the Khet cantina', wp: (g) => poi(g, 'informant'), done: (g) => g.party.items.cellcode },
      { text: 'Infiltrate Garrison Seven', wp: (g) => poi(g, 'gate'), done: (g) => anyPlayer(g, (p) => inGarrison(g, p)) },
      { text: 'Open the Detention Block with the cell code', wp: (g) => door(g, 'cellblock'), done: (g) => door(g, 'cellblock').open },
      { text: 'Cut Ilsa Varn out of her cell', wp: (g) => door(g, 'cell'), done: (g) => door(g, 'cell').open },
      { text: 'Escort Ilsa to the Ridge LZ', alt: (g) => (!door(g, 'gate').open ? 'Escort Ilsa out — the gate is sealed, override its lock from inside' : null), wp: (g) => (!door(g, 'gate').open ? { ...poi(g, 'gatePanel'), y: 10 } : poi(g, 'lz')), done: (g) => { const p = g.ents.get(g.prisonerId); return p && !p.dead && atLZ(g, p); } },
    ],
    fail: (g) => { const p = g.ents.get(g.prisonerId); return !p || p.dead ? 'Ilsa Varn was killed.' : null; },
  },
  heist: {
    ordered: true,
    steps: [
      { text: 'Lift the vault keycard from Commander Rhal (pickpocket, pull, or worse)', wp: (g) => { const o = officer(g); return o && !o.dead && o.hasKeycard ? o : g.pickupPos('keycard') || poi(g, 'gate'); }, done: (g) => g.party.items.keycard },
      { text: 'Get inside the Command Center', wp: (g) => door(g, 'command'), done: (g) => anyPlayer(g, (p) => inCommand(g, p)) },
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
  mire: {
    ordered: true,
    home: 'thessaly',
    steps: [
      { text: 'Meet Vessa Moor in Lowmarsh', wp: (g) => contact(g, 'vessa'), done: (g) => item(g, 'vessa') },
      { text: "Destroy the harvester's power cells", count: (g) => destroyed(g, ['gen0', 'gen1', 'gen2']), of: 3, wp: (g) => { const d = ['gen0', 'gen1', 'gen2'].map((k) => g.world.destructibles[k]).find((d) => d && !d.destroyed); return d || poi(g, 'gate'); }, done: (g) => destroyed(g, ['gen0', 'gen1', 'gen2']) === 3 },
      { text: "Cut the woodcutters out of the cutters' pen", wp: (g) => door(g, 'pen'), done: (g) => door(g, 'pen').open },
      { text: 'Report to Oru Dask in the Khet cantina', planet: 'duskvaro', wp: (g) => contact(g, 'oru'), done: (g) => item(g, 'reported') },
    ],
  },
  cold: {
    ordered: true,
    home: 'korrun',
    steps: [
      { text: 'Get the vault code from Tobin Vale in Rime Hold', wp: (g) => contact(g, 'tobin'), done: (g) => item(g, 'vaultcode') },
      { text: 'Get inside Cryo-Vault Sigma', wp: (g) => poi(g, 'gate'), done: (g) => anyPlayer(g, (p) => inGarrison(g, p)) },
      { text: 'Open the vault with the code', wp: (g) => door(g, 'vault'), done: (g) => door(g, 'vault').open },
      { text: 'Slice the cryo-archive for the Ashfall Codex', wp: (g) => g.world.terminals.find((t) => t.id === 'cryo'), done: (g) => item(g, 'codex') },
      { text: 'Bring the codex to Oru Dask on Dusk Varo', planet: 'duskvaro', wp: (g) => contact(g, 'oru'), done: (g) => item(g, 'delivered') },
    ],
  },
};

const homeOf = (def) => def.home || 'duskvaro';
const stepPlanet = (def, s) => s.planet || homeOf(def);
export const missionHome = (id) => (DEFS[id] ? homeOf(DEFS[id]) : 'duskvaro');
// True when every step happens on one world (leaving it mid-job abandons the job)
const singleWorld = (def) => def.steps.every((s) => stepPlanet(def, s) === homeOf(def));

// Conversations with contacts that move a mission along. Returns true if the contact had something to say.
export function contactTalk(g, p, ent) {
  const m = g.mission;
  const live = m && m.status === 'active';
  const at = (id, step) => live && m.id === id && m.step === step;
  const give = (k, line, note) => { g.party.items[k] = true; g.bark(ent, line); if (note) g.note(note, 'objective'); g.globalDirty = true; return true; };
  switch (ent.contact) {
    case 'oru':
      if (live && m.id === 'rescue' && !item(g, 'cellcode')) return give('cellcode', "Cell code is 7-7-Aurek-9. Ilsa's in the detention block, south side. Don't get her killed.", 'Acquired: detention block cell code');
      if (at('mire', 3)) return give('reported', 'Kappa is dark and the cutters are home? Vessa owes you. So do I.');
      if (at('cold', 4) && item(g, 'codex')) return give('delivered', 'The Ashfall Codex. Do you know how many people died for this? Fewer, now.');
      return false;
    case 'vessa':
      if (at('mire', 0)) return give('vessa', "Kappa runs on three power cells inside the walls. Kill them and the harvester starves. Kade keeps our cutters penned on the south side, so get them out.", 'Vessa: three power cells, and the cutters are penned on the south side');
      return false;
    case 'tobin':
      if (at('cold', 0)) return give('vaultcode', "Vault code's Cresh-4-4-Dorn. Ishen changes it every tithe day, so you've got until then. Mind the coolant tanks: they go up like a sun.", 'Acquired: Cryo-Vault Sigma code');
      return false;
  }
  return false;
}

export function contactLabel(g, id) {
  const m = g.mission;
  const at = (mid, step) => m && m.status === 'active' && m.id === mid && m.step === step;
  switch (id) {
    case 'oru': return m?.id === 'rescue' && !item(g, 'cellcode') ? 'Ask Oru for the cell code' : at('mire', 3) ? 'Report to Oru Dask' : at('cold', 4) ? 'Hand Oru the codex' : 'Talk to Oru Dask (jobs)';
    case 'vessa': return at('mire', 0) ? 'Meet Vessa Moor' : 'Talk to Vessa Moor';
    case 'tobin': return at('cold', 0) ? 'Ask Tobin for the vault code' : 'Talk to Tobin Vale';
  }
  return 'Talk';
}

// Mission-specific terminals. Returns true if handled.
export function terminalUse(g, p, term) {
  if (term.kind !== 'cryo') return false;
  const m = g.mission;
  if (m && m.status === 'active' && m.id === 'cold') {
    if (item(g, 'codex')) { g.pnote(p, 'The codex is already in your pack.', 'warn'); return true; }
    g.party.items.codex = true;
    g.note(`${p.name} pulled the Ashfall Codex from the archive. Get it home to Oru.`, 'objective');
    g.globalDirty = true;
    return true;
  }
  return false;
}

// Called when the ship leaves a world mid-mission
export function missionLeftPlanet(g, from) {
  const m = g.mission;
  if (!m || m.status !== 'active') return;
  const def = DEFS[m.id];
  if (singleWorld(def) && homeOf(def) === from) {
    g.note(`Mission abandoned: ${MISSIONS[m.id].name}. You left ${PLANETS[from].name}.`, 'fail');
    g.mission = null;
    g.globalDirty = true;
  }
}

export function startMission(g, id) {
  const def = DEFS[id];
  if (!def) return false;
  g.party.items = {};
  g.mission = { id, step: 0, done: def.steps.map(() => false), status: 'active', ghost: true, startedAt: g.time, endAt: 0 };
  if (homeOf(def) === g.planet) g.resetGarrison(id);
  g.note(`Mission accepted: ${MISSIONS[id].name}`, 'mission');
  if (homeOf(def) !== g.planet) g.note(`Board the ${SHIP.name} at the landing pad and set course for ${PLANETS[homeOf(def)].name}.`, 'objective');
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
  if (def.fail && homeOf(def) === g.planet) {
    const why = def.fail(g);
    if (why) { m.status = 'failed'; m.endAt = g.time + 8; m.reason = why; g.note(`Mission failed — ${why}`, 'fail'); g.globalDirty = true; return; }
  }
  if (def.ordered) {
    while (m.step < def.steps.length && stepPlanet(def, def.steps[m.step]) === g.planet && def.steps[m.step].done(g)) {
      m.done[m.step] = true;
      m.step++;
      g.globalDirty = true;
      if (m.step < def.steps.length) g.note(def.steps[m.step].text, 'objective');
    }
    if (m.step >= def.steps.length) complete(g);
  } else {
    if (homeOf(def) !== g.planet) return;
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
  const cur = def.steps[m.step];
  const away = m.status === 'active' && cur && stepPlanet(def, cur) !== g.planet ? stepPlanet(def, cur) : null;
  const steps = def.steps.map((s, i) => {
    let text = (m.status === 'active' && i === m.step && (away ? `Fly to ${PLANETS[away].name}: board the ${SHIP.name}` : s.alt && s.alt(g))) || s.text;
    if (s.count) text += ` (${s.count(g)}/${s.of})`;
    return [text, m.done[i] ? 1 : 0];
  });
  let wp = null;
  if (m.status === 'active' && m.step >= 0 && m.step < def.steps.length) {
    const w = away ? g.world.pois.ship : def.steps[m.step].wp(g);
    if (w) wp = [+w.x.toFixed(1), +(w.y ?? 10).toFixed(1), +w.z.toFixed(1)];
  }
  return { id: m.id, step: m.step, steps, status: m.status, ghost: m.ghost, wp, reason: m.reason || null, reward: m.reward || 0, away, home: homeOf(def) };
}
