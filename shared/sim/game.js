// Authoritative game room. Runs identically on the Node server (multiplayer) and in
// the browser (solo/offline). Transport-agnostic: give it a send(clientId, string).

import { K, F, PLAYER, WEAPONS, POWERS, STEALTH, ITEMS, MERCHANTS, MAX_PLAYERS, START_CREDITS, TICK_DT, MISSIONS, CLASSES } from '../config.js';
import { mulberry32, clamp, dist2, angleDiff, yawTo, lerp } from '../math.js';
import { createWorld, terrainHeight, setDoorOpen, inShadow, lampLight, groundAt, useWorld } from '../world.js';
import '../layouts.js';
import { stepSpeeder, SPEEDER } from '../vehicles.js';
import { spawnGuard, garrisonRoster, spawnTown, spawnWildlife, spawnPrisoner, spawnCaptives, updateNPC, updateHerds, guardHearNoise, civilianScare, guardOnDamaged, alertGuardTo, isUnaware, pick } from './ai.js';
import { stepBolts, stepGrenades, explode, bladeSwing, powerPush, powerPull } from './combat.js';
import { spawnWorkers } from './ai.js';
import { spawnTraffic, spawnVehicle, updateTraffic } from './traffic.js';
import { padState } from '../spaceport.js';
import { GOODS, RECIPES, UPGRADES, TOWNS, newMarket, marketTick, makerWork, shipTrade, marketView, priceTable, quoteBuy, quoteSell, packCount, canAfford, spend, gearBonus } from '../economy.js';
import { startMission, missionTick, missionView, abandonMission, contactTalk, contactLabel, terminalUse, missionHome, missionLeftPlanet } from './missions.js';
import { PLANETS, SHIP } from '../planets.js';
import { applyLoadout, useAbility, weaponStats, active, breakCloak, tickClass, absorbDamage, cooldownView, updateHunters, classOf, camoFactor, levelOfPlayer } from './classes.js';
import { RANGED, LEVELS, levelOf, XP, ADVANCED, effectiveClass } from '../config.js';

const r2 = (v) => Math.round(v * 100) / 100;
const VIEW_IN = 240, VIEW_OUT = 275; // snapshot interest radius
const WEAPON_KINDS = new Set(['bolt', 'blade', 'knife', 'execute']);
const NODE_LABEL = { grain: 'Help with the harvest', ore: 'Dig out the ore seam', ice: 'Cut coolant ice', resin: 'Tap the resin', timber: 'Saw timber from the log' };
const NODE_YIELD = { grain: 2, ore: 2, ice: 2, resin: 1, timber: 2 };
const REQ_NAMES = { cellcode: 'cell code', keycard: 'vault keycard', vaultcode: 'vault code' };
const CONTACT_IDLE = {
  vessa: ['The harvester eats a grove a day. Lowmarsh will drown in its own mud.', 'Keep your voice down. Kade has ears in the reeds.', 'If you came to help, help. If not, keep walking.'],
  tobin: ['Cold enough to crack a blaster coil out there.', 'Ishen keeps the whole vault sealed. Nobody goes in without the code.', 'Drink something hot before you go anywhere.'],
};

export class Game {
  constructor(opts = {}) {
    this.send = opts.send || (() => {});
    this.solo = !!opts.solo;
    this.saveProfile = opts.saveProfile || (() => {});
    this.loadProfile = opts.loadProfile || (() => null);
    this.roomName = opts.room || 'default';
    this.planet = PLANETS[opts.planet] ? opts.planet : 'duskvaro';
    this.world = createWorld(this.planet);
    this.travel = null;
    this.rng = mulberry32(opts.seed || 90210);
    this.time = 0;
    this.tickN = 0;
    this.nextId = 1;
    this.ents = new Map();
    this.bolts = [];
    this.events = [];
    this.priv = new Map();
    this.clients = new Map(); // clientId -> player id
    this.alarm = { active: false, lastContact: 0, reinforceAt: 0, cause: '', lkp: null };
    this.camerasOn = true;
    this.camOffUntil = 0;
    this.party = { items: {} };
    this.mission = null;
    this.corpses = [];
    this.barkT = new Map();
    this.globalDirty = true;
    this.lastGlobal = '';
    this.spatial = new Map();
    this._players = [];
    this.speederSpawns = this.world.pois.speeders || [];
    this.respawnQueue = [];
    this.markets = {};
    this.mkT = 0;
    this.padSeen = [];
    this.nodeUntil = new Map();
    spawnTown(this);
    spawnWorkers(this);
    spawnWildlife(this);
    spawnTraffic(this);
    this.speederSpawns.forEach((s, i) => this.spawnSpeeder(i));
    this.resetGarrison(null);
    this.mkView = marketView(this.market());
    this.rebuildSpatial();
  }

  // ---------------------------------------------------------------- entities

  spawn(obj) {
    const e = Object.assign({ id: this.nextId++, flags: 0, a1: 0, a2: 0, stagger: 0, vx: 0, vy: 0, vz: 0, yaw: 0, hp: 1, maxHp: 1, r: 0.4, h: 1.8 }, obj);
    this.ents.set(e.id, e);
    return e;
  }
  removeEnt(e) { this.ents.delete(e.id); }
  players() { return this._players; }
  playerOf(cid) { const id = this.clients.get(cid); return id ? this.ents.get(id) : null; }

  rebuildSpatial() {
    this.spatial.clear();
    this._players = [];
    for (const e of this.ents.values()) {
      if (e.kind === K.PLAYER) this._players.push(e);
      const k = Math.floor(e.x / 8) * 100003 + Math.floor(e.z / 8);
      let a = this.spatial.get(k);
      if (!a) this.spatial.set(k, (a = []));
      a.push(e);
    }
  }
  nearby(x, z, r) {
    const out = [];
    const x0 = Math.floor((x - r) / 8), x1 = Math.floor((x + r) / 8);
    const z0 = Math.floor((z - r) / 8), z1 = Math.floor((z + r) / 8);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const a = this.spatial.get(gx * 100003 + gz);
      if (a) for (const e of a) if (this.ents.has(e.id) && dist2(x, z, e.x, e.z) <= r) out.push(e);
    }
    return out;
  }

  spawnSpeeder(i) {
    const s = this.speederSpawns[i];
    const y = groundAt(this.world, s.x, s.z, 50) + SPEEDER.hover;
    return this.spawn({ kind: K.SPEEDER, x: s.x, y, z: s.z, yaw: s.yaw, hp: SPEEDER.hp, maxHp: SPEEDER.hp, r: SPEEDER.r, h: SPEEDER.h, driver: null, slot: i, onGround: false });
  }

  spawnPickup(item, x, y, z, vx = 0, vy = 3, vz = 0) {
    const codes = { keycard: 1, datacore: 2 };
    return this.spawn({ kind: K.PICKUP, item, x, y, z, vx, vy, vz, a1: codes[item] || 0, hp: 1, maxHp: 1, garrison: true, r: 0.2, h: 0.3 });
  }
  pickupPos(item) {
    for (const e of this.ents.values()) if (e.kind === K.PICKUP && e.item === item) return e;
    return null;
  }

  resetGarrison(missionId) {
    for (const e of [...this.ents.values()]) if (e.garrison || e.hostile || e.kind === K.CAMERA || e.kind === K.PRISONER || e.kind === K.PICKUP || e.kind === K.GRENADE) this.removeEnt(e);
    this.corpses = [];
    this.bolts.length = 0;
    for (const d of Object.values(this.world.doors)) { setDoorOpen(this.world, d.id, d.startOpen); d.locked = !!d.req; }
    for (const d of Object.values(this.world.destructibles)) { d.hp = d.maxHp; d.destroyed = false; this.world.boxes[d.boxId].solid = true; }
    this.alarm.active = false;
    this.camerasOn = true;
    this.camOffUntil = 0;
    for (const def of garrisonRoster(this.world)) {
      const g = spawnGuard(this, def);
      g.garrison = true;
      if (def.officer) this.officerId = g.id;
    }
    for (const c of this.world.cameras) {
      this.spawn({ kind: K.CAMERA, x: c.x, y: c.y, z: c.z, yaw: c.yaw, hp: 25, maxHp: 25, garrison: true, hostile: true, r: 0.3, h: 0.5, lookYaw: c.yaw, ai: { baseYaw: c.yaw, sweep: c.sweep, speed: c.speed, phase: this.rng() * 6, sus: 0, alert: 0, state: 'cam' } });
    }
    this.prisonerId = null;
    spawnCaptives(this);
    if (missionId === 'rescue' && this.planet === 'duskvaro') { const p = spawnPrisoner(this); p.garrison = true; this.prisonerId = p.id; }
    this.event(['reset']);
    this.globalDirty = true;
  }

  // ---------------------------------------------------------------- players

  addPlayer(cid, info = {}) {
    useWorld(this.world);
    if (this.players().length >= MAX_PLAYERS || [...this.ents.values()].filter((e) => e.kind === K.PLAYER).length >= MAX_PLAYERS) return { error: 'This crew is full (4 players).' };
    const name = String(info.name || 'Drifter').replace(/[^\w \-'.]/g, '').slice(0, 16) || 'Drifter';
    const used = new Set([...this.ents.values()].filter((e) => e.kind === K.PLAYER).map((p) => p.color));
    let color = 0;
    while (used.has(color)) color++;
    const prof = this.loadProfile(name) || {};
    const sp = this.world.pois.spawn;
    const ang = color * 1.6;
    const p = this.spawn({
      kind: K.PLAYER, cid, name, color,
      x: sp.x + Math.cos(ang) * 2.5, y: sp.y + 0.2, z: sp.z + Math.sin(ang) * 2.5, yaw: -Math.PI / 2,
      pitch: 0, r: PLAYER.radius, h: PLAYER.height, onGround: true,
      hp: PLAYER.maxHp, maxHp: PLAYER.maxHp, shield: 0, focus: PLAYER.maxFocus, heat: 0, overheated: false,
      credits: prof.credits ?? START_CREDITS, grenades: prof.grenades ?? 3, medpacks: prof.medpacks ?? 2,
      upgrades: prof.upgrades || {}, weapon: 'blaster', crouch: false, sprint: false, blocking: false, blockStart: -9,
      downed: false, bleed: 0, vehicle: null, tpSeq: 1, lastInputT: 0, lastShot: -9, lastSwing: -9, lastGren: -9,
      swingCount: 0, cd: { push: 0, pull: 0, shroud: 0 }, shroudUntil: 0, focusUsedAt: -9, lastHurt: -9,
      healT: 0, use: null, interact: null, visibility: 1, impulseT: -9, kills: 0, stats: { shots: 0 },
      pack: { ...(prof.pack || {}) }, gear: { weapon: 0, armor: 0, speeder: 0, ship: 0, ...(prof.gear || {}) },
      xp: prof.xp || 0, advs: { ...(prof.advs || {}) },
    });
    applyLoadout(p, info.cls, { ...prof, advs: p.advs });
    this.applyGear(p, true);
    this.clients.set(cid, p.id);
    this.rebuildSpatial();
    this.lastGlobal = '';
    this.note(`${p.name} joined the crew.`, 'info');
    this.globalDirty = true;
    this.sendTo(cid, { t: 'welcome', id: p.id, room: this.roomName, solo: this.solo, pos: [r2(p.x), r2(p.y), r2(p.z)], yaw: p.yaw, tp: p.tpSeq, color: p.color, cls: p.cls, adv: p.adv, planet: this.planet });
    if (classOf(p).wanted) this.note(`${p.name} is a Warden. The Concordance pays well for Wardens — expect hunters.`, 'warn');
    return { player: p };
  }

  removePlayer(cid) {
    useWorld(this.world);
    const p = this.playerOf(cid);
    this.clients.delete(cid);
    if (!p) return;
    if (p.vehicle) { const v = this.ents.get(p.vehicle); if (v) v.driver = null; }
    if (this.interest) this.interest.delete(cid);
    this.persist(p);
    this.removeEnt(p);
    this.rebuildSpatial();
    this.note(`${p.name} left.`, 'info');
    this.globalDirty = true;
  }

  persist(p) {
    this.saveProfile(p.name, { credits: p.credits, grenades: p.grenades, medpacks: p.medpacks, upgrades: p.upgrades, cls: p.cls, pack: p.pack, gear: p.gear, xp: p.xp, advs: p.advs });
  }

  // ---------------------------------------------------------------- economy

  market(planet = this.planet) { return (this.markets[planet] ||= newMarket(planet)); }
  cargoCap(p) { return gearBonus.cargo(p.gear.ship); }
  // ---------------------------------------------------------------- experience

  addXp(p, n, quiet) {
    if (!p || p.kind !== K.PLAYER || n <= 0) return;
    const before = levelOf(p.xp).lv;
    p.xp += Math.round(n);
    const after = levelOf(p.xp).lv;
    if (!quiet) this.pevent(p, ['xp', Math.round(n)]);
    if (after > before) {
      this.applyGear(p, false);
      p.hp = p.maxHp;
      this.event(['lvl', p.id, after]);
      this.note(`${p.name} reached level ${after}.`, 'objective');
      if (before < LEVELS.advancedAt && after >= LEVELS.advancedAt) this.pnote(p, 'You can take an advanced class now. Press K to open your career.', 'objective');
      this.globalDirty = true;
    }
    this.persist(p);
  }
  // Take (or drop) the advanced class for the class you're playing
  onSpecialize(p, id) {
    if (p.downed) return;
    if (this.alarm.active) { this.pnote(p, 'Not while the garrison is hunting you.', 'warn'); return; }
    if (id) {
      const A = ADVANCED[id];
      if (!A || A.base !== p.cls) return;
      if (levelOf(p.xp).lv < LEVELS.advancedAt) { this.pnote(p, `Advanced classes open at level ${LEVELS.advancedAt}.`, 'warn'); return; }
    }
    p.adv = id || null;
    p.advs[p.cls] = p.adv;
    const C = classOf(p);
    p.weapon = C.weapon;
    p.cdk = { q: 0, f: 0, x: 0 };
    p.act = {};
    p.grenades = Math.min(p.grenades, C.maxGrenades);
    this.applyGear(p, false);
    this.persist(p);
    this.sendTo(p.cid, { t: 'cls', cls: p.cls, adv: p.adv });
    this.note(p.adv ? `${p.name} is now a ${C.name}.` : `${p.name} went back to being a ${C.name}.`, 'objective');
    this.globalDirty = true;
  }

  applyGear(p, heal) {
    const max = PLAYER.maxHp + gearBonus.hp(p.gear.armor) + LEVELS.hpPer * (levelOf(p.xp || 0).lv - 1) + (classOf(p).hp || 0);
    if (heal) p.hp = max; else p.hp = Math.min(max, p.hp + Math.max(0, max - p.maxHp));
    p.maxHp = max;
  }
  // Add goods to a player's pack, as much as fits. Returns how many went in.
  give(p, good, n, quiet) {
    const room = this.cargoCap(p) - packCount(p.pack);
    const k = Math.max(0, Math.min(n, room));
    if (k > 0) { p.pack[good] = (p.pack[good] || 0) + k; this.persist(p); }
    if (!quiet) this.pnote(p, k > 0 ? `+${k} ${GOODS[good].name}${k < n ? ' (pack full)' : ''}` : 'Your pack is full.', k > 0 ? 'loot' : 'warn');
    return k;
  }
  // A worker finished a job: their output lands in the town market
  econDeliver(e, give) {
    const m = this.market();
    if (give.make) { if (this.rng() < 0.45) makerWork(m); return; }
    for (const [g, n] of Object.entries(give)) m.stock[g] = (m.stock[g] || 0) + n;
  }
  nearShop(p, kind) {
    const T = TOWNS[this.planet];
    const id = kind === 'exchange' ? T.exchange : T.workshop;
    return this.nearby(p.x, p.z, 7).find((e) => e.kind === K.MERCHANT && !e.dead && e.merchant === id);
  }
  onTrade(p, g, n) {
    if (!GOODS[g] || !Number.isInteger(n) || n === 0 || Math.abs(n) > 50) return;
    if (!this.nearShop(p, 'exchange')) { this.pnote(p, 'Trade at the exchange.', 'warn'); return; }
    const m = this.market();
    if (n > 0) {
      n = Math.min(n, Math.floor(m.stock[g]), this.cargoCap(p) - packCount(p.pack));
      if (n <= 0) { this.pnote(p, m.stock[g] < 1 ? 'Sold out.' : 'Your pack is full.', 'warn'); return; }
      const cost = quoteBuy(m, g, n);
      if (cost > p.credits) { this.pnote(p, 'Not enough credits.', 'warn'); return; }
      m.stock[g] -= n;
      p.pack[g] = (p.pack[g] || 0) + n;
      this.addCredits(p, -cost);
    } else {
      n = Math.min(-n, p.pack[g] || 0);
      if (n <= 0) return;
      const got = quoteSell(m, g, n);
      m.stock[g] += n;
      p.pack[g] -= n;
      if (!p.pack[g]) delete p.pack[g];
      this.addCredits(p, got);
    }
    this.mkView = marketView(m);
    this.globalDirty = true;
  }
  onCraft(p, r, n) {
    const R = RECIPES[r];
    if (!R || !Number.isInteger(n) || n < 1 || n > 20) return;
    if (!this.nearShop(p, 'workshop')) { this.pnote(p, 'Make parts at a workshop.', 'warn'); return; }
    let made = 0;
    for (let i = 0; i < n; i++) {
      if (!canAfford(p.pack, R.in) || p.credits < R.fee) break;
      spend(p.pack, R.in);
      p.pack[r] = (p.pack[r] || 0) + 1;
      p.credits -= R.fee;
      made++;
    }
    if (!made) { this.pnote(p, p.credits < R.fee ? 'Not enough credits for the bench fee.' : 'You are missing materials.', 'warn'); return; }
    this.persist(p);
    this.addXp(p, XP.craft * made);
    this.pnote(p, `Made ${made} ${GOODS[r].name} (-${R.fee * made} cr)`, 'loot');
  }
  onUpgrade(p, k) {
    const U = UPGRADES[k];
    if (!U) return;
    if (!this.nearShop(p, 'workshop')) { this.pnote(p, 'Upgrades are fitted at a workshop.', 'warn'); return; }
    const t = p.gear[k] || 0;
    const tier = U.tiers[t];
    if (!tier) { this.pnote(p, 'Already at the top tier.', 'warn'); return; }
    if (!canAfford(p.pack, tier.cost)) { this.pnote(p, 'You are missing parts.', 'warn'); return; }
    if (p.credits < tier.cr) { this.pnote(p, 'Not enough credits.', 'warn'); return; }
    spend(p.pack, tier.cost);
    p.gear[k] = t + 1;
    if (k === 'armor') this.applyGear(p, false);
    this.addCredits(p, -tier.cr);
    this.addXp(p, XP.upgrade);
    this.pnote(p, `${U.name} upgraded to tier ${t + 1}: ${tier.fx}`, 'objective');
    this.globalDirty = true;
  }
  economyTick(dt) {
    this.mkT += dt;
    if (this.mkT < 1) return;
    const step = this.mkT;
    this.mkT = 0;
    const m = this.market();
    marketTick(m, step, this.rng);
    // trader ships landing at the spaceport bring and take goods
    this.world.pads.forEach((pad, i) => {
      const st = padState(i, this.time);
      if (st.phase === 'landed' && this.padSeen[i] !== st.n) {
        this.padSeen[i] = st.n;
        if (this.time > 5) { shipTrade(m, this.rng); m.lastShip = this.time; }
      }
    });
    if (this.tickN % 60 < 2) { this.mkView = marketView(m); this.globalDirty = true; }
    if (this.time - (m.refAt || 0) > 120) { m.ref = priceTable(m); m.refAt = this.time; }
  }
  addCredits(p, n) {
    p.credits = Math.max(0, Math.round(p.credits + n));
    this.pnote(p, `${n >= 0 ? '+' : ''}${n} cr`, 'credits');
    this.persist(p);
  }

  teleport(p, x, y, z) {
    p.x = x; p.y = y; p.z = z; p.vx = p.vy = p.vz = 0;
    p.tpSeq++;
    this.sendTo(p.cid, { t: 'tp', s: p.tpSeq, p: [r2(x), r2(y), r2(z)] });
  }
  impulse(p, vx, vy, vz) {
    p.impulseT = this.time;
    this.sendTo(p.cid, { t: 'imp', v: [r2(vx), r2(vy), r2(vz)] });
  }

  // ---------------------------------------------------------------- messages

  handle(cid, msg) {
    useWorld(this.world);
    const p = this.playerOf(cid);
    if (!p || !msg || typeof msg.t !== 'string') return;
    const alive = !p.downed && !p.dead;
    switch (msg.t) {
      case 'in': this.onInput(p, msg); break;
      case 'fire': if (alive) this.onFire(p, msg); break;
      case 'vfire': if (alive) this.onVehicleFire(p, msg); break;
      case 'mel': if (alive && p.drawn && (p.weapon === 'blade' || p.weapon === 'knives') && !p.vehicle) { bladeSwing(this, p); breakCloak(this, p); } break;
      case 'ab': if (alive && !p.vehicle && (msg.k === 'q' || msg.k === 'f' || msg.k === 'x')) useAbility(this, p, msg.k, msg); break;
      case 'gren': if (alive && !p.vehicle) this.onGrenade(p, msg); break;
      case 'leap': {
        const c = POWERS.leap.cost * (p.upgrades.attune ? 0.75 : 1);
        if (alive && classOf(p).leap && p.focus >= c) { p.focus -= c; p.focusUsedAt = this.time; p.impulseT = this.time; }
        break;
      }
      case 'med': if (alive && p.medpacks > 0 && p.hp < p.maxHp && p.healT <= 0) { p.medpacks--; p.healT = 2 * (1 + (classOf(p).healBonus || 0)); this.persist(p); this.pnote(p, 'Medpack applied', 'info'); } break;
      case 'use': this.onUse(p, msg); break;
      case 'buy': this.onBuy(p, msg.item); break;
      case 'accept': this.onAccept(p, msg.id); break;
      case 'abandon': abandonMission(this); break;
      case 'travel': this.startTravel(p, String(msg.to || '')); break;
      case 'trade': if (alive) this.onTrade(p, String(msg.g || ''), msg.n | 0); break;
      case 'craft': if (alive) this.onCraft(p, String(msg.r || ''), msg.n | 0); break;
      case 'upg': if (alive) this.onUpgrade(p, String(msg.k || '')); break;
      case 'adv': this.onSpecialize(p, msg.id ? String(msg.id) : null); break;
      case 'disembark': if (p.aboard && !this.travel && !this.landing) this.disembark(p); break;
      case 'chat': {
        const m = String(msg.m || '').slice(0, 140).trim();
        if (m) this.event(['chat', p.name, m, p.color]);
        break;
      }
      case 'ping': if (Array.isArray(msg.p)) this.event(['ping', p.id, r2(+msg.p[0] || 0), r2(+msg.p[1] || 0), r2(+msg.p[2] || 0)]); break;
    }
  }

  onInput(p, m) {
    if (m.tp !== p.tpSeq) return; // waiting for the client to accept a teleport
    const now = this.time;
    const dtIn = Math.max(0.033, now - p.lastInputT);
    p.lastInputT = now;
    p.yaw = +m.yw || 0;
    if (p.aboard) return;
    p.pitch = clamp(+m.pt || 0, -1.5, 1.5);
    const fl = m.f | 0;
    const wasBlocking = p.blocking;
    p.crouch = !!(fl & 1);
    p.sprint = !!(fl & 2);
    p.blocking = !!(fl & 4) && p.weapon === 'blade';
    p.onGround = !!(fl & 8);
    p.drawn = !!(fl & 16) && !p.vehicle;
    p.weapon = classOf(p).weapon;
    p.blocking = !!(fl & 4) && p.weapon === 'blade' && p.drawn;
    if (p.blocking && !wasBlocking) p.blockStart = now;
    if (!Array.isArray(m.p) || m.p.length !== 3) return;
    let [x, y, z] = m.p.map(Number);
    if (![x, y, z].every(Number.isFinite)) return;
    if (p.downed) { // can only crawl
      const d = dist2(p.x, p.z, x, z);
      if (d > 1.5 * dtIn + 0.3) return;
    }
    if (p.vehicle) {
      const v = this.ents.get(p.vehicle);
      if (v && Array.isArray(m.vh)) {
        const [vx, vy, vz, vyaw, vvx, vvz] = m.vh.map(Number);
        if ([vx, vy, vz, vyaw, vvx, vvz].every(Number.isFinite) && dist2(v.x, v.z, vx, vz) < 70 * dtIn + 3) {
          v.x = vx; v.y = vy; v.z = vz; v.yaw = vyaw; v.vx = vvx; v.vz = vvz;
        }
        p.x = v.x; p.y = v.y; p.z = v.z; p.vx = v.vx; p.vz = v.vz;
        return;
      }
    }
    const maxSpd = now - p.impulseT < 2 ? 42 : 24;
    const d = dist2(p.x, p.z, x, z);
    if (d > maxSpd * dtIn + 1.5 || y < terrainHeight(x, z) - 3) {
      this.teleport(p, p.x, p.y, p.z);
      return;
    }
    p.x = x; p.y = y; p.z = z;
    if (Array.isArray(m.v)) { p.vx = +m.v[0] || 0; p.vy = +m.v[1] || 0; p.vz = +m.v[2] || 0; }
  }

  onFire(p, m) {
    if (p.vehicle || !p.drawn || !RANGED.includes(p.weapon) || p.overheated) return;
    const W = weaponStats(p);
    const cyc = !!p.upgrades.cyclic;
    const sup = active(this, p, 'suppress');
    const interval = W.fireInterval * (cyc ? 0.65 : 1) * (sup ? 0.55 : 1);
    if (this.time - p.lastShot < interval * 0.7) return;
    p.lastShot = this.time;
    // a Phantom's first shot from phase cloak doesn't reveal them
    let mult = 1, pierce = 0;
    if (p.phaseShot && active(this, p, 'cloak')) { p.phaseShot = false; mult *= 1.5; } else breakCloak(this, p);
    if (active(this, p, 'overcharge')) { const ph = p.adv === 'phantom'; mult *= ph ? 2.6 : 2.2; pierce = ph ? 8 : 2; p.act.overcharge = 0; }
    if (!sup) p.heat = Math.min(1, p.heat + W.heatPerShot * (cyc ? 0.8 : 1));
    if (p.heat >= 1) { p.overheated = true; p.overheatT = this.time; }
    const o = this.validOrigin(p, m.o, 3);
    const d = this.validDir(m.d);
    if (!d) return;
    p.stats.shots++;
    const b = this.spawnBolt(p, o[0], o[1], o[2], d[0], d[1], d[2], W.boltSpeed, W.damage * mult * (p.upgrades.coil ? 1.4 : 1) * (active(this, p, 'deadeye') ? 1.8 : 1), 'player', p.upgrades.damper ? Math.min(12, W.noise) : W.noise, m.c | 0, p.weapon === 'longlas' ? 5 : undefined);
    b.pierce = pierce;
  }
  onVehicleFire(p, m) {
    const v = p.vehicle && this.ents.get(p.vehicle);
    if (!v) return;
    const W = WEAPONS.speederCannon;
    if (this.time - (v.lastShot || 0) < W.fireInterval * 0.7) return;
    v.lastShot = this.time;
    const o = Array.isArray(m.o) && dist2(v.x, v.z, +m.o[0], +m.o[2]) < 5 ? m.o.map(Number) : [v.x, v.y + 0.4, v.z];
    const d = this.validDir(m.d);
    if (!d) return;
    this.spawnBolt(p, o[0], o[1], o[2], d[0], d[1], d[2], W.boltSpeed, W.damage * gearBonus.cannon(p.gear.speeder), 'player', W.noise, m.c | 0);
  }
  validOrigin(p, o, maxD) {
    if (Array.isArray(o) && o.length === 3 && o.every((v) => Number.isFinite(+v))) {
      const [x, y, z] = o.map(Number);
      if (Math.hypot(x - p.x, y - (p.y + 1.4), z - p.z) < maxD) return [x, y, z];
    }
    return [p.x, p.y + 1.4, p.z];
  }
  validDir(d) {
    if (!Array.isArray(d) || d.length !== 3) return null;
    const v = d.map(Number);
    const l = Math.hypot(v[0], v[1], v[2]);
    if (!Number.isFinite(l) || l < 1e-6) return null;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  onGrenade(p, m) {
    if (p.grenades <= 0 || this.time - p.lastGren < 0.8) return;
    const d = this.validDir(m.d);
    if (!d) return;
    p.lastGren = this.time;
    p.grenades--;
    this.persist(p);
    const o = this.validOrigin(p, m.o, 2.5);
    const s = WEAPONS.grenade.throwSpeed;
    const noisy = p.cls === 'spy';
    this.spawn({ kind: K.GRENADE, x: o[0], y: o[1], z: o[2], vx: d[0] * s + p.vx * 0.4, vy: d[1] * s + WEAPONS.grenade.throwLift, vz: d[2] * s + p.vz * 0.4, fuse: noisy ? WEAPONS.grenade.noiseFuse : WEAPONS.grenade.fuse, owner: p.id, hp: 1, maxHp: 1, r: 0.15, h: 0.2, noisemaker: noisy, a1: noisy ? 1 : 0 });
    this.event(['throw', p.id]);
  }

  onShroud(p) {
    const P = POWERS.shroud;
    if (p.focus < P.cost || this.time < p.cd.shroud) return;
    p.focus -= P.cost; p.focusUsedAt = this.time;
    p.cd.shroud = this.time + P.duration + P.cooldown;
    p.shroudUntil = this.time + P.duration;
    this.event(['shroud', p.id, P.duration]);
  }

  spawnBolt(owner, x, y, z, dx, dy, dz, speed, dmg, team, noise, cid = 0, kindCode) {
    const b = { id: this.nextId++, x, y, z, vx: dx * speed, vy: dy * speed, vz: dz * speed, dmg, team, owner: owner.id, life: 2.2 };
    this.bolts.push(b);
    this.event(['bolt', b.id, r2(x), r2(y), r2(z), r2(b.vx), r2(b.vy), r2(b.vz), kindCode ?? (team === 'player' ? 1 : 0), owner.id, cid]);
    if (noise) this.noise(x, y, z, noise, owner.kind === K.PLAYER ? owner : null, true);
    return b;
  }

  // ---------------------------------------------------------------- noise, barks, notes

  noise(x, y, z, radius, src, loud) {
    for (const e of this.nearby(x, z, radius)) {
      if (e.dead) continue;
      if (e.hostile && e.kind !== K.CAMERA) { if (src) guardHearNoise(this, e, x, y, z, radius, loud, src); }
      else if (e.kind === K.CIVILIAN && loud && radius > 20) civilianScare(this, e, x, z);
      else if (e.kind === K.CRITTER) { e.ai.fleeUntil = this.time + 4; e.ai.fx = e.x - x; e.ai.fz = e.z - z; }
    }
  }
  bark(e, text) {
    const last = this.barkT.get(e.id) || -9;
    if (this.time - last < 2.2) return;
    this.barkT.set(e.id, this.time);
    this.event(['say', e.id, text]);
  }
  merchantGreet(e) { return MERCHANTS[e.merchant]?.greet || 'Welcome.'; }
  event(ev) { this.events.push(ev); }
  pevent(p, ev) { let a = this.priv.get(p.id); if (!a) this.priv.set(p.id, (a = [])); a.push(ev); }
  note(text, style = 'info') { this.event(['note', text, style]); }
  pnote(p, text, style = 'info') { this.pevent(p, ['note', text, style]); }
  sendTo(cid, obj) { this.send(cid, JSON.stringify(obj)); }

  // ---------------------------------------------------------------- damage

  damage(e, amt, src, info = {}) {
    if (e.dead || amt <= 0) return;
    if (src && src.kind === K.PLAYER && src.gear && WEAPON_KINDS.has(info.kind) && !info.deflected) amt *= gearBonus.damage(src.gear.weapon);
    if (src && src.kind === K.PLAYER) {
      if (src.act && (src.act.adrenal || 0) > this.time) amt *= 1.25;
      if ((e.bountyUntil || 0) > this.time) amt *= 1.5;
    }
    if (e.kind === K.PLAYER) {
      if (e.downed || e.aboard) return;
      amt = absorbDamage(this, e, amt);
      if (amt <= 0) return;
      if (e.shield > 0) { const s = Math.min(e.shield, amt); e.shield -= s; amt -= s; }
      e.hp -= amt;
      e.lastHurt = this.time;
      const sx = src ? src.x : info.x ?? e.x, sz = src ? src.z : info.z ?? e.z;
      this.pevent(e, ['hurt', Math.round(amt), r2(sx), r2(sz)]);
      if (e.hp <= 0) this.downPlayer(e);
      return;
    }
    if (e.kind === K.SPEEDER) {
      e.hp -= amt;
      if (e.hp <= 0) this.destroySpeeder(e, src);
      return;
    }
    if (e.kind === K.TRAFFIC) {
      e.hp -= amt;
      for (const o of this.nearby(e.x, e.z, 25)) if (o.kind === K.CIVILIAN) civilianScare(this, o, e.x, e.z);
      if (e.hp <= 0) this.destroyTraffic(e, src);
      return;
    }
    e.hp -= amt;
    if (e.kind === K.CAMERA) {
      if (e.hp <= 0) { e.dead = true; e.flags = F.DEAD | F.OFF; this.event(['die', e.id, 'spark']); this.globalDirty = true; if (src && src.kind === K.PLAYER) this.addXp(src, XP.camera); }
      return;
    }
    if (e.hp <= 0) { this.kill(e, src, info); return; }
    if (e.hostile) guardOnDamaged(this, e, src);
    else if (e.kind === K.CIVILIAN) civilianScare(this, e, src ? src.x : e.x, src ? src.z : e.z);
    else if (e.kind === K.CRITTER) { e.ai.fleeUntil = this.time + 5; if (src) { e.ai.fx = e.x - src.x; e.ai.fz = e.z - src.z; } }
  }

  kill(e, src, info) {
    e.dead = true;
    e.hp = 0;
    e.flags = F.DEAD;
    e.deadAt = this.time;
    e.vx *= 0.3; e.vz *= 0.3;
    this.event(['die', e.id, info.kind || 'bolt', info.silent ? 1 : 0]);
    const killer = src && src.kind === K.PLAYER ? src : null;
    if (e.hostile) {
      this.corpses.push(e);
      if (killer) {
        killer.kills++;
        this.addCredits(killer, Math.round((e.kind === K.OFFICER ? 150 : 25) * (1 + (classOf(killer).creditBonus || 0))));
        this.addXp(killer, (e.kind === K.OFFICER ? XP.officer : XP.lancer) + (info.silent ? XP.silent : 0));
        if ((e.bountyUntil || 0) > this.time) {
          const hunter = this.ents.get(e.bountyBy);
          if (hunter && hunter.kind === K.PLAYER) { this.addCredits(hunter, 100); this.addXp(hunter, XP.bounty); this.pnote(hunter, 'Bounty collected.', 'credits'); }
        }
        if (e.kind !== K.CAMERA && this.rng() < (e.kind === K.OFFICER ? 1 : 0.45)) this.give(killer, 'scrap', e.kind === K.OFFICER ? 3 : 1);
        if (info.silent) this.pnote(killer, 'Silent takedown', 'stealth');
      }
      if (e.hasKeycard) { e.hasKeycard = false; this.spawnPickup('keycard', e.x, e.y + 1, e.z, 0, 3, 0); }
      // A loud kill near other guards is noticed
      if (!info.silent) this.noise(e.x, e.y, e.z, 9, killer, false);
    } else if (e.kind === K.CIVILIAN || e.kind === K.MERCHANT || e.kind === K.BARTENDER || e.kind === K.INFORMANT) {
      for (const o of this.ents.values()) if (o.kind === K.CIVILIAN) civilianScare(this, o, e.x, e.z);
      if (killer) { this.addCredits(killer, -200); this.pnote(killer, 'Khet will remember that.', 'fail'); }
      // townsfolk come back after a while
      this.respawnQueue.push({ at: this.time + 60, kind: e.kind, snapshot: { ...e, ai: { ...e.ai, fleeUntil: 0, path: null, wait: 2 } } });
    } else if (e.kind === K.CRITTER) {
      this.respawnQueue.push({ at: this.time + 45, kind: e.kind, snapshot: { ...e, claimed: 0, ai: { ...e.ai, fleeUntil: 0 } } });
      if (killer) { this.addXp(killer, XP.critter, true); this.give(killer, 'meat', 1, true); this.give(killer, 'hide', 1, true); this.pnote(killer, '+1 Game meat, +1 Hides', 'loot'); e.claimed = -1; this.later(4, () => this.removeEnt(e)); }
    }
    this.globalDirty = true;
  }

  damageDestructible(d, amt, src) {
    if (d.destroyed) return;
    d.hp -= amt;
    this.globalDirty = true;
    if (d.hp > 0) { this.event(['dhit', d.id]); return; }
    d.destroyed = true;
    this.event(['destroy', d.id]);
    if (src && src.kind === K.PLAYER) { this.give(src, 'scrap', 2); this.addXp(src, XP.sabotage); }
    if (d.kind === 'tank') {
      setTimeout0(this, 0.15, () => explode(this, d.x, d.y + 2.5, d.z, 9.5, 160, src, 'tank'));
    } else if (d.kind === 'mast') {
      this.world.boxes[d.boxId].solid = false;
      explode(this, d.x, d.y + 3, d.z, 7, 120, src, 'mast');
      this.note('Comms mast down — the garrison cannot call reinforcements.', 'objective');
    }
    if (!this.alarm.active) this.triggerAlarm('sabotage');
  }

  destroyTraffic(v, src) {
    v.dead = true;
    explode(this, v.x, v.y + 0.5, v.z, v.vk === 'bike' ? 5 : 7, 80, src, 'speeder');
    this.removeEnt(v);
    if (src && src.kind === K.PLAYER) { this.addCredits(src, -150); this.pnote(src, 'That was somebody\'s ride. And somebody.', 'fail'); }
    this.respawnQueue.push({ at: this.time + 40, kind: K.TRAFFIC, route: v.route, slot: v.slot });
  }

  destroySpeeder(v, src) {
    v.dead = true;
    if (v.driver) {
      const p = this.ents.get(v.driver);
      if (p) this.exitVehicle(p, true);
    }
    explode(this, v.x, v.y + 0.5, v.z, 6, 90, src, 'speeder');
    this.removeEnt(v);
    this.respawnQueue.push({ at: this.time + 25, kind: K.SPEEDER, slot: v.slot });
  }

  downPlayer(p) {
    p.hp = 0;
    p.downed = true;
    if (p.vehicle) this.exitVehicle(p, true);
    const others = this.players().filter((o) => o !== p && !o.downed).length;
    p.bleed = this.solo || others === 0 ? PLAYER.soloBleedout : PLAYER.bleedout;
    this.note(`${p.name} is down!${others ? ' Get to them!' : ''}`, 'fail');
    this.globalDirty = true;
  }
  revive(p, by) {
    if (by && by !== p) this.addXp(by, XP.revive);
    p.downed = false;
    p.hp = 45;
    p.lastHurt = this.time;
    this.note(`${by ? by.name : 'Someone'} revived ${p.name}.`, 'info');
    this.globalDirty = true;
  }
  respawn(p) {
    p.downed = false;
    p.hp = p.maxHp;
    p.focus = PLAYER.maxFocus;
    p.heat = 0; p.overheated = false;
    const sp = this.world.pois.spawn;
    this.teleport(p, sp.x + (this.rng() - 0.5) * 3, sp.y + 0.3, sp.z + (this.rng() - 0.5) * 3);
    this.pnote(p, 'You come to aboard your shuttle.', 'info');
    this.globalDirty = true;
  }

  // ---------------------------------------------------------------- alarm

  triggerAlarm(cause) {
    if (this.alarm.active) return;
    this.alarm.active = true;
    this.alarm.cause = cause;
    this.alarm.lastContact = this.time;
    this.alarm.reinforceAt = this.time + 8;
    if (!this.alarm.lkp) { const np = this.players().find((p) => !p.downed && !p.cloaked); if (np) this.alarm.lkp = { x: np.x, y: np.y, z: np.z }; }
    this.alarm.startedAt = this.time;
    if (this.mission && this.mission.status === 'active' && this.mission.ghost && missionHome(this.mission.id) === this.planet) {
      this.mission.ghost = false;
      if (MISSIONS[this.mission.id].ghostBonus) this.note('Alarm raised — ghost bonus lost.', 'warn');
    }
    if (this.world.doors.gate.open) { setDoorOpen(this.world, 'gate', false); this.event(['door', 'gate', 0]); }
    this.event(['alarm', 1]);
    this.note('GARRISON ALARM — lockdown in effect.', 'alarm');
    // Guards converge on where the intruder was last seen, not on where everyone is now
    const L = this.alarm.lkp;
    if (L) for (const e of this.ents.values()) {
      if (!e.hostile || !e.garrison || e.dead || e.kind === K.CAMERA || e.ai.state === 'combat') continue;
      if (e.ai.post) continue;
      e.ai.state = 'search'; e.ai.alert = 2;
      e.ai.search = { x: L.x + (this.rng() - 0.5) * 16, z: L.z + (this.rng() - 0.5) * 16, until: this.time + 18 };
    }
    this.globalDirty = true;
  }
  // A real sighting (by a guard or camera) keeps the alarm alive and updates where to hunt
  noteDetection(p) {
    this.alarm.lkp = { x: p.x, y: p.y, z: p.z };
    if (this.alarm.active) this.alarm.lastContact = this.time;
  }
  broadcastAlert(p) {
    for (const e of this.ents.values()) if (e.hostile && e.garrison && !e.dead && e.kind !== K.CAMERA) alertGuardTo(this, e, p);
  }
  endAlarm(reason) {
    if (!this.alarm.active) return;
    this.alarm.active = false;
    this.alarm.lkp = null;
    this.event(['alarm', 0]);
    this.note(reason || 'The garrison stands down... for now.', 'info');
    setDoorOpen(this.world, 'gate', true);
    this.event(['door', 'gate', 1]);
    for (const e of this.ents.values()) {
      if (!e.hostile || e.dead || e.kind === K.CAMERA) continue;
      if (e.ai.state === 'combat') { e.ai.state = 'search'; e.ai.search = { x: e.x, z: e.z, until: this.time + 8 }; }
      e.ai.alarmAt = null;
    }
    this.globalDirty = true;
  }

  // ---------------------------------------------------------------- interactions

  interactables(p) {
    const W = this.world, out = [];
    const add = (id, x, z, label, hold = 0, range = 2.4, y) => out.push({ id, x, z, label, hold, range, y });
    if (p.vehicle) { out.push({ id: 'veh:' + p.vehicle, x: p.x, z: p.z, label: 'Dismount', hold: 0, range: 99, force: true }); return out; }
    if (p.aboard) { if (!this.travel && !this.landing) out.push({ id: 'nav', x: p.x, z: p.z, label: `Open the ${SHIP.name}'s nav console`, hold: 0, range: 99, force: true }); return out; }
    if (p.downed) return out;
    if (W.pois.board) add('board', W.pois.board.x, W.pois.board.z, 'Browse the job board');
    for (const n of W.nodes) {
      if (dist2(p.x, p.z, n.x, n.z) > 3) continue;
      if ((this.nodeUntil.get(n.id) || 0) > this.time) continue;
      add('node:' + n.id, n.x, n.z, NODE_LABEL[n.kind], 2.2, 2.6);
    }
    if (W.pois.ship && !this.travel && !this.landing) add('ship', W.pois.ship.x, W.pois.ship.z, `Board the ${SHIP.name}`, 0, 4.2);
    for (const t of W.terminals) {
      if (dist2(p.x, p.z, t.x, t.z) > 4) continue;
      const sl = classOf(p).sliceSpeed || 1;
      if (t.kind === 'security') add('term:' + t.id, t.x, t.z, this.alarm.active ? 'Slice security: kill the alarm' : 'Slice security: loop the cameras', 4 / sl);
      else if (t.kind === 'vault') add('term:' + t.id, t.x, t.z, 'Slice the vault console', 6 / sl);
      else if (t.kind === 'cryo') add('term:' + t.id, t.x, t.z, 'Slice the cryo-archive console', 6 / sl);
    }
    if (W.doors.gate && !W.doors.gate.open && W.pois.gatePanel) add('gatepanel', W.pois.gatePanel.x, W.pois.gatePanel.z, 'Override the gate lock', 1.5, 2.6);
    for (const d of Object.values(W.doors)) {
      if (d.open || !d.req) continue;
      if (dist2(p.x, p.z, d.x, d.z) > 3.2) continue;
      if (d.req === 'hold') add('door:' + d.id, d.x, d.z, d.id === 'pen' ? "Cut the pen's lock" : 'Cut the cell lock', 2.5, 2.8);
      else {
        const have = this.party.items[d.req];
        const need = REQ_NAMES[d.req] || d.req;
        add('door:' + d.id, d.x, d.z, have ? `Open ${d.label} (${need})` : `${d.label} — locked, needs ${need}`, 0, 3.0);
      }
    }
    for (const e of this.nearby(p.x, p.z, 4)) {
      if (e === p) continue;
      if (e.kind === K.SPEEDER && !e.driver && !e.dead) add('veh:' + e.id, e.x, e.z, 'Ride speeder', 0, 3.8);
      else if (e.kind === K.PLAYER && e.downed) add('revive:' + e.id, e.x, e.z, `Revive ${e.name}`, p.cls === 'medic' ? 1 : PLAYER.reviveTime, 2.4);
      else if (e.kind === K.PICKUP) add('pick:' + e.id, e.x, e.z, e.item === 'keycard' ? 'Take the vault keycard' : 'Take the data core', 0, 2.2);
      else if (e.dead) continue;
      else if (e.kind === K.MERCHANT) { const M = MERCHANTS[e.merchant]; add('npc:' + e.id, e.x, e.z, M.type === 'exchange' ? `Trade goods with ${M.name}` : M.type === 'workshop' ? `Use ${M.name}'s workshop` : `Trade with ${M.name}`, 0, M.type ? 4.2 : 3.2); }
      else if (e.kind === K.INFORMANT) add('npc:' + e.id, e.x, e.z, contactLabel(this, e.contact), 0, 2.8);
      else if (e.kind === K.BARTENDER) add('npc:' + e.id, e.x, e.z, 'Order a drink (5cr)', 0, 3.0);
      else if (e.kind === K.CIVILIAN) add('npc:' + e.id, e.x, e.z, 'Talk', 0, 2.2);
      else if (e.kind === K.OFFICER && e.hasKeycard && isUnaware(e) && !e.stagger) {
        const behind = Math.abs(angleDiff(e.yaw, yawTo(e.x, e.z, p.x, p.z))) > 1.9;
        if (behind) add('pocket:' + e.id, e.x, e.z, 'Lift the keycard', 1.3, 1.9);
      }
    }
    return out;
  }

  pickInteract(p) {
    let best = null, bs = 1e9;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (const c of this.interactables(p)) {
      if (c.force) return c;
      const d = dist2(p.x, p.z, c.x, c.z);
      if (d > c.range) continue;
      const dot = d > 0.01 ? ((c.x - p.x) * fx + (c.z - p.z) * fz) / d : 1;
      if (dot < 0.15 && d > 1.3) continue;
      const s = d - dot * 0.9;
      if (s < bs) { bs = s; best = c; }
    }
    return best;
  }

  onUse(p, m) {
    if (!m.down) { p.use = null; return; }
    const c = this.pickInteract(p);
    if (!c || (m.id && m.id !== c.id)) return;
    if (c.hold > 0) { p.use = { id: c.id, prog: 0, need: c.hold }; return; }
    this.doInteract(p, c.id);
  }

  doInteract(p, id) {
    const [kind, ref] = id.split(':');
    const W = this.world;
    const ent = ref ? this.ents.get(+ref) : null;
    switch (kind) {
      case 'board': this.sendTo(p.cid, { t: 'ui', ui: 'missions' }); break;
      case 'npc': {
        if (!ent) return;
        if (ent.kind === K.MERCHANT) { const ty = MERCHANTS[ent.merchant].type; this.sendTo(p.cid, { t: 'ui', ui: ty === 'exchange' ? 'market' : ty === 'workshop' ? 'workshop' : 'shop', merchant: ent.merchant }); }
        else if (ent.kind === K.INFORMANT) {
          if (!contactTalk(this, p, ent)) {
            if (ent.contact === 'oru') this.sendTo(p.cid, { t: 'ui', ui: 'missions' });
            else this.bark(ent, pick(CONTACT_IDLE[ent.contact] || ['...'], this.rng));
          }
        } else if (ent.kind === K.BARTENDER) {
          if (p.credits >= 5) { this.addCredits(p, -5); p.focus = Math.min(PLAYER.maxFocus, p.focus + 30); this.bark(ent, pick(['One dune-fire, coming up.', 'Drink fast. Troopers drink here too.', 'On the house — no, wait, five credits.'], this.rng)); }
          else this.bark(ent, 'Come back with credits.');
        } else if (ent.kind === K.CIVILIAN) this.bark(ent, pick(['Leave me be, offworlder.', 'The tithe takes everything. Everything.', 'You\'re not from the Concordance, are you?', 'Watch the troopers on the road.', 'Ilsa Varn used to run water to the farms. Now look.'], this.rng));
        break;
      }
      case 'door': {
        const d = W.doors[ref];
        if (!d || d.open) return;
        if (d.req === 'hold' || this.party.items[d.req]) {
          setDoorOpen(W, ref, true);
          d.locked = false;
          this.event(['door', ref, 1]);
          if (ref === 'cell' && this.prisonerId) {
            const pr = this.ents.get(this.prisonerId);
            if (pr) { pr.ai.state = 'follow'; this.bark(pr, 'Finally! Let\'s go — I\'ll stay close.'); }
          }
          this.noise(d.x, d.y, d.z, 5, p, false);
          this.globalDirty = true;
        } else this.pnote(p, `Locked. You need the ${REQ_NAMES[d.req] || d.req}.`, 'warn');
        break;
      }
      case 'gatepanel': setDoorOpen(W, 'gate', true); this.event(['door', 'gate', 1]); this.globalDirty = true; break;
      case 'ship': this.board(p); break;
      case 'node': {
        const n = W.nodes[+ref];
        if (!n || (this.nodeUntil.get(n.id) || 0) > this.time) return;
        if (this.give(p, n.kind, NODE_YIELD[n.kind]) > 0) { this.addXp(p, XP.gather, true); this.nodeUntil.set(n.id, this.time + 75); this.noise(n.x, n.y, n.z, 6, p, false); this.globalDirty = true; }
        break;
      }
      case 'nav': this.sendTo(p.cid, { t: 'ui', ui: 'nav' }); break;
      case 'term': {
        const term = W.terminals.find((t) => t.id === ref);
        if (term && terminalUse(this, p, term)) break;
        if (term && term.kind === 'cryo') { this.pnote(p, 'The archive holds nothing but frozen test subjects. Grim.', 'warn'); break; }
        if (ref === 'security') {
          if (this.alarm.active) this.endAlarm('Alarm silenced — the garrison is confused.');
          this.camerasOn = false;
          this.camOffUntil = this.time + 120;
          this.note('Cameras looped for two minutes.', 'stealth');
          this.globalDirty = true;
        } else if (ref === 'vault') {
          if (this.mission?.id === 'heist' && this.mission.status === 'active') {
            this.party.items.datacore = true;
            this.note('Data core acquired. Get it to the Ridge LZ.', 'objective');
            this.globalDirty = true;
          } else {
            if (!this.party.items.vaultLooted) { this.party.items.vaultLooted = true; for (const q of this.players()) this.addCredits(q, 150); this.note('You skim the payroll account. +150cr each.', 'credits'); }
            else this.pnote(p, 'The vault account is already drained.', 'warn');
          }
        }
        break;
      }
      case 'veh': {
        if (!ent) return;
        if (p.vehicle === ent.id) this.exitVehicle(p, false);
        else if (!ent.driver) {
          ent.driver = p.id;
          p.vehicle = ent.id;
          p.crouch = false; p.blocking = false;
          this.sendTo(p.cid, { t: 'veh', id: ent.id, s: [r2(ent.x), r2(ent.y), r2(ent.z), r2(ent.yaw), r2(ent.vx || 0), r2(ent.vz || 0)] });
        }
        break;
      }
      case 'revive': if (ent && ent.downed) this.revive(ent, p); break;
      case 'pick': {
        if (!ent) return;
        this.party.items[ent.item] = true;
        this.note(ent.item === 'keycard' ? `${p.name} grabbed the vault keycard.` : `${p.name} grabbed the data core.`, 'objective');
        this.removeEnt(ent);
        this.globalDirty = true;
        break;
      }
      case 'pocket': {
        if (!ent || !ent.hasKeycard || !isUnaware(ent)) { this.pnote(p, 'He noticed you!', 'warn'); return; }
        ent.hasKeycard = false;
        this.party.items.keycard = true;
        this.note(`${p.name} lifted the vault keycard. Smooth.`, 'stealth');
        this.globalDirty = true;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- the Wayfarer

  board(p) {
    const W = this.world;
    if (p.aboard || !W.pois.shipBody) return;
    if (p.vehicle) this.exitVehicle(p, false);
    p.aboard = true;
    p.use = null;
    const s = W.pois.shipBody;
    this.teleport(p, s.x, s.y + 3.05, s.z); // rides on the hull; hidden and untouchable while aboard
    const aboard = this.players().filter((q) => q.aboard).length;
    this.note(`${p.name} boarded the ${SHIP.name} (${aboard}/${this.players().length} aboard).`, 'info');
    this.globalDirty = true;
  }
  disembark(p) {
    const W = this.world;
    p.aboard = false;
    const r = W.pois.ship, i = this.players().indexOf(p);
    const x = r.x + (i - 1.5) * 1.3, z = r.z + 1;
    this.teleport(p, x, groundAt(W, x, z, r.y + 3) + 0.05, z);
    this.globalDirty = true;
  }
  startTravel(p, to) {
    if (!p.aboard || this.travel || this.landing) return;
    if (!PLANETS[to]) return;
    if (to === this.planet) { this.pnote(p, `You're already on ${PLANETS[to].name}.`, 'warn'); return; }
    const missing = this.players().filter((q) => !q.aboard);
    if (missing.length) { this.pnote(p, `Waiting for ${missing.map((q) => q.name).join(', ')} to board.`, 'warn'); return; }
    const tier = Math.max(0, ...this.players().map((q) => q.gear.ship || 0));
    this.travel = { from: this.planet, to, at: this.time + gearBonus.jump(tier) };
    this.event(['travel', this.planet, to]);
    this.note(`The ${SHIP.name} lifts off for ${PLANETS[to].name}.`, 'objective');
    this.globalDirty = true;
  }
  switchPlanet(to) {
    this.travel = null;
    missionLeftPlanet(this, this.planet);
    for (const e of [...this.ents.values()]) if (e.kind !== K.PLAYER) this.removeEnt(e);
    this.bolts.length = 0;
    this.corpses = [];
    this.respawnQueue = [];
    this._timers = [];
    this.alarm = { active: false, lastContact: 0, reinforceAt: 0, cause: '', lkp: null };
    this.planet = to;
    this.world = createWorld(to);
    useWorld(this.world);
    this.speederSpawns = this.world.pois.speeders || [];
    this.padSeen = [];
    this.nodeUntil = new Map();
    spawnTown(this);
    spawnWorkers(this);
    spawnWildlife(this);
    spawnTraffic(this);
    this.speederSpawns.forEach((s, i) => this.spawnSpeeder(i));
    this.mkView = marketView(this.market());
    this.resetGarrison(this.mission && this.mission.status === 'active' && missionHome(this.mission.id) === to ? this.mission.id : null);
    for (const [cid] of this.clients) this.sendTo(cid, { t: 'planet', id: to });
    // The crew stays aboard while the Wayfarer sets down; they walk off once the ramp is open
    const s = this.world.pois.shipBody;
    this.players().forEach((p) => {
      p.aboard = true; p.vehicle = null; p.use = null;
      this.teleport(p, s.x, s.y + 3.05, s.z);
    });
    this.landing = { at: this.time + SHIP.landTime, to };
    this.lastGlobal = '';
    this.globalDirty = true;
    this.rebuildSpatial();
  }
  // Touchdown: the ramp is down, everyone steps off
  finishLanding() {
    const to = this.landing.to;
    this.landing = null;
    for (const p of this.players()) if (p.aboard) this.disembark(p);
    this.note(`Arrived on ${PLANETS[to].name}. ${PLANETS[to].arrival}`, 'objective');
  }

  exitVehicle(p, forced) {
    const v = this.ents.get(p.vehicle);
    p.vehicle = null;
    if (v) {
      v.driver = null;
      const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
      let x = v.x + rx * 1.8, z = v.z + rz * 1.8;
      const y = groundAt(this.world, x, z, v.y + 2) + 0.05;
      this.teleport(p, x, y, z);
      if (forced) { v.vx *= 0.5; v.vz *= 0.5; }
    }
    this.sendTo(p.cid, { t: 'veh', id: null });
  }

  onBuy(p, item) {
    const it = ITEMS[item];
    if (!it) return;
    const merch = this.nearby(p.x, p.z, 7).find((e) => e.kind === K.MERCHANT && !e.dead && MERCHANTS[e.merchant].stock.includes(item));
    if (!merch) { this.pnote(p, 'No merchant here sells that.', 'warn'); return; }
    if (p.credits < it.price) { this.pnote(p, 'Not enough credits.', 'warn'); return; }
    if (it.kind === 'upgrade') {
      if (p.upgrades[item]) { this.pnote(p, 'You already own that.', 'warn'); return; }
      p.upgrades[item] = 1;
    } else {
      const key = item === 'grenade' ? 'grenades' : 'medpacks';
      if (p[key] >= it.max) { this.pnote(p, 'You cannot carry more.', 'warn'); return; }
      p[key]++;
    }
    this.addCredits(p, -it.price);
    this.pnote(p, `Bought ${it.name}`, 'credits');
    this.bark(merch, pick(['Pleasure doing business.', 'Use it well.', 'No refunds.', 'Tell your friends. Quietly.'], this.rng));
    this.persist(p);
  }

  onAccept(p, id) {
    if (!MISSIONS[id]) return;
    const W = this.world;
    if (!W.pois.board) { this.pnote(p, 'Jobs come from the board in Khet, on Dusk Varo.', 'warn'); return; }
    const nearBoard = dist2(p.x, p.z, W.pois.board.x, W.pois.board.z) < 5 || dist2(p.x, p.z, W.pois.informant.x, W.pois.informant.z) < 5;
    if (!nearBoard) { this.pnote(p, 'Accept jobs at the board or from Oru.', 'warn'); return; }
    if (this.mission && this.mission.status === 'active') { this.pnote(p, 'Finish or abandon the current job first.', 'warn'); return; }
    startMission(this, id);
  }

  // ---------------------------------------------------------------- tick

  tick(dt = TICK_DT) {
    useWorld(this.world);
    if (this.travel && this.time >= this.travel.at) this.switchPlanet(this.travel.to);
    if (this.landing && this.time >= this.landing.at) this.finishLanding();
    this.time += dt;
    this.tickN++;
    this.rebuildSpatial();
    // timers
    if (this._timers) {
      for (let i = this._timers.length - 1; i >= 0; i--) if (this.time >= this._timers[i].at) { const t = this._timers.splice(i, 1)[0]; t.fn(); }
    }
    if (!this.camerasOn && this.time > this.camOffUntil) { this.camerasOn = true; this.note('Security cameras are back online.', 'warn'); this.globalDirty = true; }
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      if (this.time < r.at) continue;
      this.respawnQueue.splice(i, 1);
      if (r.kind === K.SPEEDER) this.spawnSpeeder(r.slot);
      else if (r.kind === K.TRAFFIC) spawnVehicle(this, r.route, r.slot, true);
      else { const s = r.snapshot; delete s.id; this.spawn({ ...s, dead: false, hp: s.maxHp, flags: 0, stagger: 0 }); }
    }
    this.updatePlayers(dt);
    for (const e of [...this.ents.values()]) {
      if (e.kind === K.PLAYER || e.kind === K.GRENADE) continue;
      if (e.kind === K.SPEEDER) { this.updateSpeeder(e, dt); continue; }
      if (e.kind === K.TRAFFIC) { updateTraffic(this, e, dt); continue; }
      if (e.kind === K.MINE) { this.updateMine(e); continue; }
      if (e.kind === K.DECOY) { this.updateDecoy(e); continue; }
      if (e.kind === K.PICKUP) { this.updatePickup(e, dt); continue; }
      if (e.dead) {
        if (e.kind !== K.CAMERA) {
          e.vy -= 22 * dt;
          e.y = Math.max(groundAt(this.world, e.x, e.z, e.y + 0.5), e.y + e.vy * dt);
          if (this.time - e.deadAt > 120) { this.removeEnt(e); this.corpses = this.corpses.filter((c) => c !== e); }
        }
        continue;
      }
      updateNPC(this, e, dt);
    }
    updateHerds(this, dt);
    updateHunters(this, dt);
    stepBolts(this, dt);
    stepGrenades(this, dt);
    this.updateAlarm(dt);
    this.economyTick(dt);
    missionTick(this);
    this.broadcastSnapshot();
  }

  updateMine(e) {
    if (e.dead) return;
    const armed = this.time >= e.armAt;
    e.flags = armed ? F.ALERT : 0;
    if (!armed) return;
    for (const o of this.nearby(e.x, e.z, WEAPONS.mine.trigger)) {
      if (!o.hostile || o.dead || o.kind === K.CAMERA) continue;
      e.dead = true;
      this.removeEnt(e);
      explode(this, e.x, e.y + 0.4, e.z, WEAPONS.mine.radius, WEAPONS.mine.damage, this.ents.get(e.owner) || null, 'mine');
      return;
    }
  }
  updateDecoy(e) {
    if (this.time > e.until) { this.removeEnt(e); this.event(['decoyend', e.id]); return; }
    if (this.time >= e.nextNoise) { e.nextNoise = this.time + 1.6; this.noise(e.x, e.y, e.z, 30, e, false); }
  }

  updatePickup(e, dt) {
    e.vy -= 20 * dt;
    e.x += e.vx * dt; e.z += e.vz * dt; e.y += e.vy * dt;
    const g = groundAt(this.world, e.x, e.z, e.y + 0.4);
    if (e.y < g + 0.15) { e.y = g + 0.15; e.vy = 0; e.vx *= 0.6; e.vz *= 0.6; }
    e.yaw += dt * 2;
  }

  updateSpeeder(v, dt) {
    if (v.driver) {
      const p = this.ents.get(v.driver);
      if (!p || p.vehicle !== v.id) v.driver = null;
      v.a1 = v.driver || 0;
      v.a2 = Math.round((v.hp / v.maxHp) * 100);
      return;
    }
    v.a1 = 0;
    stepSpeeder(this.world, v, { throttle: 0 }, dt);
  }

  updatePlayers(dt) {
    for (const p of this.players()) {
      // Visibility for stealth
      let vis = 1;
      const spd = Math.hypot(p.vx, p.vz);
      if (p.crouch) vis *= p.upgrades.weave ? 0.42 : 0.55;
      if (p.crouch && spd < 0.6) vis *= 0.8;
      if (p.sprint && spd > 6) vis *= 1.35;
      const shade = inShadow(this.world, p.x, p.y + (p.crouch ? 0.7 : 1.2), p.z);
      const lamp = lampLight(this.world, p.x, p.z);
      let light = shade ? 0.6 : 1;
      light = lerp(light, 1.45, lamp);
      vis *= light;
      p.cloaked = active(this, p, 'cloak');
      if (this.time < p.shroudUntil) vis *= p.cloaked ? POWERS.cloak.visibility : POWERS.shroud.visibility;
      tickClass(this, p, dt);
      if (!p.drawn && !p.vehicle) vis *= 0.85; // holstered: you could be anyone
      vis *= camoFactor(p);
      if (p.vehicle) vis = 1.6;
      p.visibility = clamp(vis, 0.05, 2);
      p.lit = light;
      // Walking/sprinting makes a little noise
      if (!p.crouch && spd > 7.5 && this.tickN % 6 === 0) this.noise(p.x, p.y, p.z, 7, p, false);
      // Regeneration
      if (!p.downed) {
        if (this.time - p.focusUsedAt > PLAYER.focusRegenDelay) p.focus = Math.min(PLAYER.maxFocus, p.focus + PLAYER.focusRegen * (p.upgrades.attune ? 1.5 : 1) * dt);
        const shMax = p.upgrades.shield ? 50 : 0;
        if (shMax && this.time - p.lastHurt > 4) p.shield = Math.min(shMax, p.shield + 14 * dt);
        if (p.healT > 0) { p.healT -= dt; p.hp = Math.min(p.maxHp, p.hp + 30 * dt); }
        else if (this.time - p.lastHurt > 8 && p.hp < 40) p.hp = Math.min(40, p.hp + 3 * dt); // slow regen to 40
      }
      // Blaster heat
      const W = WEAPONS.blaster;
      if (p.overheated) { p.heat = Math.max(0, p.heat - dt / W.overheatCooldown); if (p.heat <= 0) p.overheated = false; }
      else if (this.time - p.lastShot > 0.25) p.heat = Math.max(0, p.heat - W.coolRate * dt * (p.upgrades.cyclic ? 1.25 : 1));
      // Downed bleed-out
      if (p.downed) {
        const helping = this.players().some((o) => o.use && o.use.id === 'revive:' + p.id);
        if (!helping) p.bleed -= dt;
        if (p.bleed <= 0) this.respawn(p);
      }
      // Interaction prompt & holds
      const c = this.pickInteract(p);
      p.interact = c ? { id: c.id, label: c.label, hold: c.hold } : null;
      if (p.use) {
        if (!c || c.id !== p.use.id) p.use = null;
        else {
          p.use.prog += dt;
          if (p.use.prog >= p.use.need) { const id = p.use.id; p.use = null; this.doInteract(p, id); }
        }
      }
    }
  }

  updateAlarm(dt) {
    if (!this.alarm.active) return;
    // Any guard actively seeing a player keeps the alarm going
    // The alarm stands down after 30 seconds without anyone actually being seen
    if (this.time - this.alarm.lastContact > STEALTH.alarmQuiet) { this.endAlarm('No sign of the intruders for 30 seconds. The garrison stands down.'); return; }
    const mast = this.world.destructibles.mast;
    const mastUp = !mast || !mast.destroyed;
    if (mastUp && this.time >= this.alarm.reinforceAt) {
      this.alarm.reinforceAt = this.time + STEALTH.reinforceInterval;
      const alive = [...this.ents.values()].filter((e) => (e.kind === K.LANCER || e.kind === K.OFFICER) && !e.dead).length;
      if (alive < STEALTH.maxGuards) {
        const b = this.world.pois.barracks;
        const L = this.alarm.lkp;
        const target = L ? { id: null, ...L } : null;
        for (let i = 0; i < 2; i++) {
          const g = spawnGuard(this, { name: 'reinforcement', tasks: [{ x: b.x + (i - 0.5) * 3, z: b.z, act: 'look', wait: [2, 4] }, { x: (this.world.pois.gate || b).x + 8, z: (this.world.pois.gate || b).z, act: 'scan', wait: [3, 5] }] }, { x: b.x + (i - 0.5) * 2.5, z: b.z, alerted: true, lkp: target ? { x: target.x, y: target.y, z: target.z } : null });
          g.garrison = true;
          g.ai.target = target ? target.id : null;
          g.ai.lastSeen = this.time - 2;
          g.ai.combatStart = this.time;
        }
        this.note('Reinforcements are pouring out of the barracks!', 'alarm');
      }
    }
  }

  // ---------------------------------------------------------------- snapshot

  globalState() {
    const doors = {};
    for (const d of Object.values(this.world.doors)) doors[d.id] = d.open ? 1 : 0;
    const des = {};
    for (const d of Object.values(this.world.destructibles)) des[d.id] = [Math.max(0, Math.round((d.hp / d.maxHp) * 100)), d.destroyed ? 1 : 0];
    return {
      al: this.alarm.active ? 1 : 0,
      cam: this.camerasOn ? 1 : 0,
      m: missionView(this),
      doors, des,
      it: Object.keys(this.party.items).filter((k) => this.party.items[k]),
      party: this.players().map((p) => [p.id, p.name, p.color, Math.round(p.hp), p.downed ? 1 : 0, Math.round(p.credits), p.cls, p.aboard ? 1 : 0, levelOf(p.xp).lv, p.adv || '']),
      pl: this.planet,
      tr: this.travel ? [this.travel.to, Math.max(0, Math.round((this.travel.at - this.time) * 10) / 10)] : null,
      mk: this.mkView,
      ship: Math.round(this.time - this.market().lastShip),
      nd: [...this.nodeUntil].filter(([, t]) => t > this.time).map(([id]) => id),
    };
  }

  encodeEnt(e) {
    let flags = e.flags | 0;
    let a1 = e.a1 | 0, a2 = e.a2 | 0, hp = Math.round((Math.max(0, e.hp) / (e.maxHp || 1)) * 100);
    if (e.kind === K.PLAYER) {
      flags = 0;
      if (e.crouch) flags |= F.CROUCH;
      if (e.blocking) flags |= F.BLOCK;
      if (e.weapon === 'blade' || e.weapon === 'knives') flags |= F.BLADE;
      if (active(this, e, 'bulwark')) flags |= F.SHIELD;
      if (e.drawn) flags |= F.DRAWN;
      if (e.downed) flags |= F.DOWNED;
      if (e.vehicle) flags |= F.DRIVING;
      if (e.aboard) flags |= F.ABOARD;
      if (e.sprint) flags |= F.SPRINT;
      if (this.time < e.shroudUntil) flags |= F.SHROUD;
      if (!e.onGround) flags |= F.AIR;
      a1 = e.swingCount;
      a2 = Math.round(e.pitch * 100);
    } else if (e.kind === K.CIVILIAN || e.kind === K.MERCHANT || e.kind === K.INFORMANT || e.kind === K.BARTENDER || e.kind === K.PRISONER || e.kind === K.CRITTER) {
      a1 = e.variant | 0;
      if (e.kind === K.CIVILIAN) a2 = e.roleCode | 0;
    }
    if (e.dead) flags |= F.DEAD;
    if (e.stagger > 0) flags |= F.STAGGER;
    if ((e.markedUntil || 0) > this.time && !e.dead) flags |= F.MARKED;
    return [e.id, e.kind, r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), flags, hp, a1, a2];
  }

  broadcastSnapshot() {
    // Each client hears about what's near them (with hysteresis so things don't flicker at the edge)
    const enc = [];
    for (const e of this.ents.values()) enc.push([e, JSON.stringify(this.encodeEnt(e))]);
    this.interest ||= new Map();
    const evJSON = JSON.stringify(this.events);
    let gJSON = null;
    if (this.globalDirty || this.tickN % 10 === 0) {
      const g = JSON.stringify(this.globalState());
      if (g !== this.lastGlobal || this.tickN % 40 === 0) { gJSON = g; this.lastGlobal = g; }
      this.globalDirty = false;
    }
    for (const [cid, pid] of this.clients) {
      const p = this.ents.get(pid);
      const prev = this.interest.get(cid) || new Set(), now = new Set(), parts = [];
      const vx = p ? p.x : 0, vz = p ? p.z : 0;
      for (const [e, s] of enc) {
        const d = Math.hypot(e.x - vx, e.z - vz);
        if (e.kind === K.PLAYER || d < VIEW_IN || (d < VIEW_OUT && prev.has(e.id))) { now.add(e.id); parts.push(s); }
      }
      this.interest.set(cid, now);
      const eJSON = `[${parts.join(',')}]`;
      if (!p) continue;
      const lvl = levelOf(p.xp || 0);
      const pv = {
        hp: Math.round(p.hp), sh: Math.round(p.shield), shm: p.upgrades.shield ? 50 : 0, fo: Math.round(p.focus), ht: r2(p.heat), oh: p.overheated ? 1 : 0,
        gr: p.grenades, md: p.medpacks, cr: p.credits, up: Object.keys(p.upgrades), dn: p.downed ? 1 : 0, bt: r2(p.bleed), vis: r2(p.visibility),
        ia: p.interact ? [p.interact.id, p.interact.label, p.interact.hold, p.use && p.use.id === p.interact.id ? r2(p.use.prog / p.use.need) : 0] : null,
        veh: p.vehicle || 0, ab0: p.aboard ? 1 : 0, shr: this.time < p.shroudUntil ? r2(p.shroudUntil - this.time) : 0,
        cd: [r2(Math.max(0, p.cd.push - this.time)), r2(Math.max(0, p.cd.pull - this.time)), r2(Math.max(0, p.cd.shroud - this.time))],
        ev: this.priv.get(p.id) || [],
        ab: cooldownView(this, p), os: Math.round(p.overshield || 0), cls: p.cls,
        pk: p.pack, gear: p.gear, cap: this.cargoCap(p), mhp: p.maxHp,
        lv: lvl.lv, xp: lvl.into, xpn: lvl.need, adv: p.adv,
      };
      const msg = `{"t":"s","tm":${r2(this.time)},"e":${eJSON},"ev":${evJSON},"pv":${JSON.stringify(pv)}${gJSON ? `,"g":${gJSON}` : ''}}`;
      this.send(cid, msg);
    }
    this.events = [];
    this.priv.clear();
  }
}

Game.prototype.later = function (delay, fn) { setTimeout0(this, delay, fn); };

function setTimeout0(game, delay, fn) {
  if (!game._timers) game._timers = [];
  game._timers.push({ at: game.time + delay, fn });
}
