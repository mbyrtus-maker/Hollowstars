// Hollow Stars client entry point.
import * as THREE from 'three';
import { createWorld, raycast, terrainHeight, groundAt } from '../shared/world.js';
import { K, F, INPUT_RATE, INTERP_DELAY, PLAYER_COLORS, MISSIONS, CLASSES, DEFAULT_CLASS } from '../shared/config.js';
import { dirFromYawPitch } from '../shared/math.js';
import { WsTransport, LocalTransport } from './net.js';
import { P2PHost, P2PClient, makeCrewCode, normalizeCode } from './p2p.js';
import { createScene } from './render/scene.js';
import { FX } from './render/fx.js';
import { Entities } from './entities.js';
import { LocalPlayer, ViewModel } from './localplayer.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Humanoid } from './render/humanoid.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const params = new URLSearchParams(location.search);
const settings = loadSettings();

const S = {
  transport: null, world: null, scene: null, fx: null, ents: null, lp: null, vm: null,
  hud: new HUD(), input: new Input(canvas), audio: new Audio(),
  myId: 0, pv: null, g: null, clockOffset: null, running: false, inputAcc: 0, cid: 1,
  lastT: performance.now() / 1000, t: 0, chatting: false, mode: 'online', boltOwners: new Map(), wasBlade: false,
};
window.__hs = S; // handy for debugging and automated tests
S.util = { Humanoid, ground: (x, z) => groundAt(S.world, x, z, terrainHeight(x, z) + 1.2) };

// ------------------------------------------------------------------ settings
function loadSettings() {
  const d = { sens: 1, fov: 75, vol: 0.7, bloom: true, shadows: true, ao: true, invert: false, name: '', cls: DEFAULT_CLASS };
  try { return { ...d, ...JSON.parse(localStorage.getItem('hollowstars.settings') || '{}') }; } catch { return d; }
}
function saveSettings() { try { localStorage.setItem('hollowstars.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ } }

// ------------------------------------------------------------------ menu
function initMenu() {
  $('m-name').value = params.get('name') || settings.name || '';
  $('m-room').value = params.get('room') || '';
  // Static hosts (GitHub Pages, a file) default to peer-to-peer; a Hollow Stars server answers /api/rooms.
  const maybeServer = location.protocol.startsWith('http') && !location.hostname.endsWith('claude.ai') && !location.hostname.endsWith('claudeusercontent.com') && !location.hostname.endsWith('github.io');
  $('m-server').value = params.get('server') || '';
  const inArtifact = location.hostname.endsWith('claude.ai') || location.hostname.endsWith('claudeusercontent.com');
  const setMode = (m) => {
    S.mode = m;
    for (const k of ['host', 'join', 'solo', 'online']) $('mode-' + k).classList.toggle('active', m === k);
    $('online-fields').classList.toggle('hidden', m !== 'online');
    $('join-fields').classList.toggle('hidden', m !== 'join');
    $('p2p-adv').classList.toggle('hidden', m !== 'host' && m !== 'join');
    $('m-play').textContent = { host: 'Host and make planetfall', join: 'Join the crew', solo: 'Make planetfall', online: 'Connect and make planetfall' }[m];
  };
  for (const k of ['host', 'join', 'solo', 'online']) $('mode-' + k).onclick = () => setMode(k);
  $('m-code').value = normalizeCode(params.get('join') || '');
  $('m-relay').value = params.get('relay') || settings.relay || '';
  if (inArtifact) { // peer-to-peer needs network access the embedded preview doesn't allow
    $('mode-host').disabled = true; $('mode-join').disabled = true;
    $('mode-host').querySelector('small').textContent = 'Available on the GitHub Pages build';
    $('mode-join').querySelector('small').textContent = 'Available on the GitHub Pages build';
  }
  const explicit = params.get('solo') || inArtifact || params.get('join') || params.get('mode');
  setMode(params.get('solo') || inArtifact ? 'solo' : params.get('join') ? 'join' : params.get('mode') === 'server' ? 'online' : 'host');
  if (maybeServer) {
    fetch('/api/rooms').then((r) => (r.ok ? r.json() : Promise.reject())).then((rooms) => {
      if (!$('m-server').value) $('m-server').value = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
      if (!explicit) setMode('online');
      if (!rooms.length) return;
      $('rooms').innerHTML = 'Crews online: ' + rooms.map((r) => `<button data-room="${r.name}" ${r.full ? 'disabled' : ''}>${r.name} (${r.players.length}/4)</button>`).join('');
      $('rooms').querySelectorAll('button').forEach((b) => b.onclick = () => { $('m-room').value = b.dataset.room; });
    }).catch(() => { /* static hosting: stay on peer-to-peer */ });
  }
  buildClassPicker();
  if (params.has('noao')) settings.ao = false;
  $('m-play').onclick = () => start();
  $('m-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
  // pause menu
  $('s-sens').value = settings.sens; $('s-fov').value = settings.fov; $('s-vol').value = settings.vol;
  $('s-bloom').checked = settings.bloom; $('s-shadows').checked = settings.shadows; $('s-ao').checked = settings.ao; $('s-invert').checked = settings.invert;
  const applySettings = () => {
    settings.sens = +$('s-sens').value; settings.fov = +$('s-fov').value; settings.vol = +$('s-vol').value;
    settings.bloom = $('s-bloom').checked; settings.invert = $('s-invert').checked; settings.ao = $('s-ao').checked;
    if (settings.shadows !== $('s-shadows').checked) { settings.shadows = $('s-shadows').checked; S.scene && S.scene.setShadows(settings.shadows); }
    S.input.sens = settings.sens; S.input.invertY = settings.invert;
    S.audio.setVolume(settings.vol);
    S.scene && S.scene.setBloom(settings.bloom);
    S.scene && S.scene.setAO(settings.ao);
    saveSettings();
  };
  for (const id of ['s-sens', 's-fov', 's-vol', 's-bloom', 's-shadows', 's-ao', 's-invert']) $(id).addEventListener('input', applySettings);
  applySettings();
  $('p-resume').onclick = () => { $('pause').classList.add('hidden'); S.input.lock(); };
  $('p-leave').onclick = () => leave();
  $('modal-x').onclick = () => S.hud.closeModal();
  canvas.addEventListener('click', () => { if (S.running && !S.hud.modalOpen && !S.chatting) { S.audio.init(); S.audio.resume(); S.input.lock(); } });
  $('clicktoplay').addEventListener('click', () => S.input.lock());
  S.input.onLockChange = (locked) => {
    $('clicktoplay').classList.add('hidden');
    if (!S.running) return;
    if (locked) { $('pause').classList.add('hidden'); return; }
    if (!S.hud.modalOpen && !S.chatting) $('pause').classList.remove('hidden');
  };
  window.addEventListener('resize', () => S.scene && S.scene.resize());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.hud.modalOpen) { S.hud.closeModal(); }
  });
}

function showError(msg) {
  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('m-error').textContent = msg;
}

async function start() {
  const name = ($('m-name').value || 'Drifter').trim().slice(0, 16);
  settings.name = name; saveSettings();
  S.audio.init(); S.audio.resume();
  $('m-error').textContent = '';
  $('menu').classList.add('hidden');
  $('loading').classList.remove('hidden');
  await new Promise((r) => setTimeout(r, 30));
  try {
    const relay = $('m-relay').value.trim();
    settings.relay = relay; saveSettings();
    S.crew = null;
    if (S.mode === 'solo') {
      S.transport = new LocalTransport(name, onMessage, settings.cls);
    } else if (S.mode === 'host') {
      const code = makeCrewCode();
      S.crew = { code, relay };
      $('load-text').textContent = 'Opening a channel for your crew…';
      S.transport = new P2PHost(name, code, onMessage, { cls: settings.cls, relay: relay || null, onStatus: (n) => S.hud && S.hud.note(n ? `Crew: ${n + 1} of 4 aboard` : 'Your crew is just you for now', 'info') });
    } else if (S.mode === 'join') {
      const code = normalizeCode($('m-code').value);
      if (code.length < 4) { showError('Enter the crew code your host shared (like K7QXM).'); return; }
      S.crew = { code, relay };
      $('load-text').textContent = `Looking for crew ${code}… this can take a few seconds.`;
      S.transport = new P2PClient(name, code, onMessage, (why) => { if (S.running) leave(why); else showError(why); }, { cls: settings.cls, relay: relay || null });
    } else {
      let url = $('m-server').value.trim() || `ws://${location.host || 'localhost:8080'}`;
      if (!/^wss?:\/\//.test(url)) url = 'ws://' + url;
      const room = ($('m-room').value || 'public').trim();
      const u = new URL(url);
      u.searchParams.set('room', room);
      u.searchParams.set('name', name);
      u.searchParams.set('cls', settings.cls);
      S.transport = new WsTransport(u.toString(), onMessage, (why) => { if (S.running) leave(why); else showError(why); });
    }
  } catch (e) {
    console.error(e);
    showError('Could not start: ' + e.message);
  }
}

function leave(why) {
  S.running = false;
  $('crew-chip').classList.add('hidden');
  try { S.transport && S.transport.close(); } catch { /* ignore */ }
  S.transport = null;
  S.input.unlock();
  S.hud.show(false);
  $('pause').classList.add('hidden');
  $('menu').classList.remove('hidden');
  if (why) $('m-error').textContent = why;
  if (S.ents) S.ents.clear();
  S.fx && S.fx.clearBolts();
  S.audio.alarm(false, 0, 0); S.audio.hum(false, 0); S.audio.engine(false, 0);
  S.myId = 0; S.pv = null; S.g = null; S.clockOffset = null;
}

// ------------------------------------------------------------------ world bootstrap
function ensureWorld() {
  if (S.world) return;
  S.world = createWorld();
  S.scene = createScene(canvas, S.world);
  S.scene.setBloom(settings.bloom);
  S.scene.setAO(settings.ao);
  if (!settings.shadows) S.scene.setShadows(false);
  S.fx = new FX(S.scene.scene, S.world);
  S.fx.setRaycaster((x, y, z, dx, dy, dz) => raycast(S.world, x, y, z, dx, dy, dz, 1.5));
  S.ents = new Entities(S.scene.scene, S.fx, S.audio);
}

// ------------------------------------------------------------------ networking
function onMessage(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  switch (m.t) {
    case 'welcome': {
      ensureWorld();
      S.myId = m.id;
      S.ents.myId = m.id;
      S.lp = new LocalPlayer(S.world, m.id, m.pos, m.yaw, m.color, m.cls);
      S.lp.tp = m.tp;
      if (S.vm) S.scene.camera.remove(S.vm.group);
      S.vm = new ViewModel(S.scene.camera, m.color, S.lp.weapon);
      S.hud.setClass(S.lp.cls);
      S.hud.setDrawn(false);
      S.running = true;
      $('loading').classList.add('hidden');
      S.hud.show(true);
      $('pause-room').textContent = m.solo ? 'Solo game. Progress is saved in this browser.' : S.crew ? (S.mode === 'host' ? 'You are hosting. Keep this tab open while your crew plays.' : `Crew ${S.crew.code}. Your host's browser runs the game.`) : `Crew room “${m.room}”. Friends join with the same server and room name.`;
      setupInvite();
      $('clicktoplay').classList.remove('hidden');
      S.hud.note(m.solo ? 'Welcome to Dusk Varo. The job board is in the Khet plaza, just east of your shuttle.' : 'Welcome to Dusk Varo. Gather your crew at the job board in the Khet plaza.', 'objective');
      requestAnimationFrame(frame);
      break;
    }
    case 'error': if (S.running) leave(m.msg); else { try { S.transport && S.transport.close(); } catch { /* ignore */ } showError(m.msg); } break;
    case 's': onSnapshot(m); break;
    case 'tp': S.lp && S.lp.teleport(m.p, m.s); break;
    case 'imp': S.lp && S.lp.impulse(m.v); break;
    case 'veh': S.lp && S.lp.enterVehicle(m.id, m.s); break;
    case 'ui': {
      S.input.unlock();
      const relock = () => { $('clicktoplay').classList.remove('hidden'); };
      if (m.ui === 'missions') S.hud.openMissions(S.g, (x) => S.transport.send(x), relock);
      else if (m.ui === 'shop') S.hud.openShop(m.merchant, () => S.pv, (x) => S.transport.send(x), relock);
      S.audio.ui('click');
      break;
    }
  }
}

function onSnapshot(m) {
  if (!S.running) return;
  const now = performance.now() / 1000;
  const off = m.tm - now;
  if (S.clockOffset == null) S.clockOffset = off;
  else S.clockOffset = off > S.clockOffset ? S.clockOffset + (off - S.clockOffset) * 0.3 : S.clockOffset + (off - S.clockOffset) * 0.02;
  if (m.g) applyGlobal(m.g);
  S.pv = m.pv;
  S.ents.onSnapshot(m.tm, m.e);
  for (const ev of m.ev) handleEvent(ev);
  for (const ev of m.pv.ev) handleEvent(ev, true);
}

function applyGlobal(g) {
  const prev = S.g;
  S.g = g;
  S.ents.setRoster(g.party);
  for (const [id, open] of Object.entries(g.doors)) S.scene.setDoor(id, open);
  for (const [id, [hp, dead]] of Object.entries(g.des)) {
    const was = S.scene.destructibles[id]?.destroyed;
    S.scene.setDestroyed(id, !!dead);
    if (dead && !was && id.startsWith('tank')) { const d = S.world.destructibles[id]; S.fx.burn(d.x, d.y + 1.5, d.z, 60); }
  }
  S.scene.alarm = !!g.al;
  if (prev && prev.m && g.m && prev.m.step !== g.m.step && g.m.status === 'active') S.audio.ui('good');
}

const meOwned = (id) => S.boltOwners.get(id) === S.myId;

function handleEvent(ev, priv) {
  const fx = S.fx, au = S.audio;
  switch (ev[0]) {
    case 'bolt': {
      const [, id, x, y, z, vx, vy, vz, team, owner, cid] = ev;
      S.boltOwners.set(id, owner);
      if (S.boltOwners.size > 400) S.boltOwners.delete(S.boltOwners.keys().next().value);
      const ov = S.ents.get(owner);
      const kind = team === 2 ? 'knife' : team ? (ov && ov.flags & F.DRIVING ? 'speeder' : 'player') : 'enemy';
      if (owner === S.myId && cid && fx.bolts.has('c' + cid)) fx.rekeyBolt('c' + cid, id);
      else { fx.spawnBolt(id, x, y, z, vx, vy, vz, kind); if (kind === 'knife') au.whoosh(false); else au.blaster(x, y, z, !team, kind === 'speeder'); }
      break;
    }
    case 'bend': {
      const [, id, x, y, z, surf] = ev;
      fx.endBolt(id, x, y, z, surf);
      au.impact(x, y, z);
      if (surf && meOwned(id)) S.hud.hit(false);
      break;
    }
    case 'defl': {
      const [, id, x, y, z, vx, vy, vz, pid, perfect] = ev;
      S.boltOwners.set(id, pid);
      fx.redirectBolt(id, x, y, z, vx, vy, vz, 'player');
      au.deflect(x, y, z);
      if (pid === S.myId && perfect) S.hud.note('Perfect deflect', 'stealth');
      break;
    }
    case 'boom': {
      const [, x, y, z, r] = ev;
      fx.explosion(x, y, z, r);
      au.explosion(x, y, z, r > 8 ? 1.4 : 1);
      if (S.lp) { const d = Math.hypot(x - S.lp.body.x, z - S.lp.body.z); fx.shake = Math.max(fx.shake, Math.max(0, 1.4 - d / 30)); }
      break;
    }
    case 'slash': { const [, x, y, z, pid, td] = ev; fx.sparks(x, y, z, 18, [1, 0.8, 0.5], 5); au.slash(x, y, z); if (pid === S.myId) S.hud.hit(!!td); break; }
    case 'push': { const [, pid, x, y, z, yaw] = ev; fx.pushWave(x, y, z, yaw); au.whoosh(true); break; }
    case 'pull': {
      const [, pid, tid] = ev;
      const a = S.ents.get(pid), b = S.ents.get(tid);
      if (a && b) fx.pullLine(a.x, a.y + 1.4, a.z, b.x, b.y + 1, b.z);
      au.whoosh(false);
      break;
    }
    case 'shroud': if (ev[1] === S.myId) { au.whoosh(false); S.hud.note('Cloaked. Attacking breaks it.', 'stealth'); } break;
    case 'say': S.ents.say(ev[1], ev[2]); break;
    case 'note': {
      const [, text, style] = ev;
      S.hud.note(text, style);
      if (style === 'credits') au.ui('cash'); else if (style === 'fail' || style === 'alarm') au.ui('bad'); else if (style === 'objective') au.ui('good');
      break;
    }
    case 'mdone': { const [, id, reward, bonus] = ev; S.hud.big('Job complete', `${MISSIONS[id].name}: +${reward + bonus}cr each${bonus ? ' (ghost bonus)' : ''}`); au.ui('cash'); break; }
    case 'chat': S.hud.chat(ev[1], ev[2], ev[3]); au.ui('click'); break;
    case 'ping': {
      const [, pid, x, y, z] = ev;
      const r = S.ents.roster.get(pid);
      S.hud.addPing(x, y, z, PLAYER_COLORS[r ? r.color : 0]);
      fx.ping(x, y, z);
      au.ui('click');
      break;
    }
    case 'alarm': S.scene.alarm = !!ev[1]; break;
    case 'door': S.scene.setDoor(ev[1], ev[2]); break;
    case 'destroy': {
      const d = S.world.destructibles[ev[1]];
      if (d) S.scene.setDestroyed(ev[1], true);
      break;
    }
    case 'dhit': { const d = S.world.destructibles[ev[1]]; if (d) fx.sparks(d.x, d.y + 2.5, d.z, 6, [1, 0.8, 0.4], 4); break; }
    case 'die': {
      const v = S.ents.get(ev[1]);
      if (v && v.kind === K.CAMERA) fx.sparks(v.x, v.y, v.z, 20, [1, 0.9, 0.5], 4);
      break;
    }
    case 'hurt': {
      const [, amt, sx, sz] = ev;
      S.hud.hurt(amt, sx, sz, S.lp);
      au.hurt();
      fx.shake = Math.max(fx.shake, Math.min(0.6, amt / 40));
      break;
    }
    case 'reset': fx.clearBolts(); break;
    case 'roll': { const v = S.ents.get(ev[1]); if (v) fx.dust(v.x, v.y, v.z, 8, 1.2); break; }
    case 'bulwark': { const v = S.ents.get(ev[1]); if (v) { fx.ring(v.x, v.y, v.z, 0xffb04a, 3, 0.4); au.whoosh(true); } break; }
    case 'burst': { const [, pid, x, y, z] = ev; fx.ring(x, y, z, 0x4ae0a0, 10, 0.7); fx.heal(x, y, z, 30); au.ui('good'); break; }
    case 'dart': {
      const a = S.ents.get(ev[1]), b = S.ents.get(ev[2]);
      if (a && b) { if (a !== b) fx.beam(a.x, a.y + 1.4, a.z, b.x, b.y + 1.1, b.z, 0x4ae0a0); fx.heal(b.x, b.y, b.z); }
      if (ev[2] === S.myId) au.ui('good');
      break;
    }
    case 'exec': {
      const [, pid, tid, ox, oz, kill] = ev;
      const t = S.ents.get(tid);
      fx.dust(ox, S.world ? terrainHeight(ox, oz) : 0, oz, 10, 1.2);
      if (t) { fx.sparks(t.x, t.y + 1.2, t.z, 22, [0.7, 1, 1], 5); au.slash(t.x, t.y + 1, t.z); }
      if (pid === S.myId) { S.hud.hit(!!kill); if (kill) S.hud.note('Executed', 'stealth'); }
      break;
    }
    case 'suggest': {
      const a = S.ents.get(ev[1]), b = S.ents.get(ev[2]);
      if (a && b) fx.beam(a.x, a.y + 1.6, a.z, b.x, b.y + 1.7, b.z, 0xb08aff);
      au.whoosh(false);
      break;
    }
    case 'noisy': { const [, x, y, z] = ev; fx.sparks(x, y + 0.2, z, 10, [1, 0.9, 0.3], 3); au.ui('click'); setTimeout(() => au.ui('click'), 160); setTimeout(() => au.ui('click'), 320); break; }
  }
}

// ------------------------------------------------------------------ main loop
const tmpM = new THREE.Vector3();
function frame() {
  if (!S.running) return;
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - S.lastT);
  S.lastT = now;
  S.t += dt;
  const { input, lp, scene, fx, ents, hud, audio } = S;
  const camera = scene.camera;

  // chat
  if (input.hit('Enter') && !S.chatting && !hud.modalOpen) {
    S.chatting = true;
    input.enabled = false;
    const ci = $('chat-in');
    ci.classList.remove('hidden');
    ci.value = '';
    setTimeout(() => ci.focus(), 0);
    input.unlock();
  }
  if (input.hit('Tab')) $('tracker').classList.toggle('hidden');

  const act = {};
  const controlling = input.locked && !hud.modalOpen && !S.chatting;
  if (!controlling) { input.mouse.dx = input.mouse.dy = 0; }
  const frozenInput = controlling ? input : FROZEN;
  lp.update(dt, frozenInput, S.pv, act);

  // interact (press & hold)
  if (controlling && input.hit('KeyE') && S.pv && S.pv.ia) S.transport.send({ t: 'use', id: S.pv.ia[0], down: true });
  if (input.up('KeyE')) S.transport.send({ t: 'use', down: false });

  // camera before aiming so the crosshair ray matches this frame
  lp.updateCamera(camera, dt, settings.fov, fx.shake);
  if (act.fire || act.vfire || act.ping || act.grenade) {
    const aim = lp.aimPoint(camera, ents);
    if (act.fire) fireBlaster(aim);
    if (act.vfire) fireSpeeder(aim);
    if (act.ping) S.transport.send({ t: 'ping', p: [aim.x, aim.y, aim.z] });
    if (act.grenade) {
      const d = dirFromYawPitch(lp.yaw, lp.pitch + 0.12);
      S.transport.send({ t: 'gren', o: [lp.body.x, lp.body.y + 1.6, lp.body.z], d: [d.x, d.y, d.z] });
    }
  }
  if (act.melee) S.transport.send({ t: 'mel' });
  if (act.draw) { if (lp.weapon !== 'blade') audio.ui('click'); S.hud.setDrawn(lp.drawn); }
  if (act.needDraw && S.t - (S.drawHintT || -9) > 4) { S.drawHintT = S.t; S.hud.note('Your weapon is holstered. Press R to draw it.', 'info'); }
  if (act.ab) useAbility(act.ab, lp, camera);
  if (act.med) S.transport.send({ t: 'med' });
  if (act.leap) { S.transport.send({ t: 'leap' }); audio.whoosh(true); fx.dust(lp.body.x, lp.body.y, lp.body.z, 10, 1.5); }

  // landing dust
  if (lp.body.landSpeed > 11) { fx.dust(lp.body.x, lp.body.y, lp.body.z, 14, 2); fx.shake = Math.max(fx.shake, 0.25); }
  lp.body.landSpeed = 0;

  // send input at a fixed rate
  S.inputAcc += dt;
  if (S.inputAcc >= 1 / INPUT_RATE) { S.inputAcc = 0; S.transport.send(lp.inputMsg()); }

  // weapon sounds
  const blade = lp.weapon === 'blade' && lp.drawn && !lp.vehicle && !lp.downed;
  if (blade !== S.wasBlade) { audio.ignite(blade); S.wasBlade = blade; }
  const myView = ents.get(S.myId);
  const swingI = myView && myView.human && myView.human.swingT < 0.42 ? 1 : 0;
  audio.hum(blade, swingI);
  audio.engine(!!lp.vehicle, lp.speed);
  if (S.g) audio.alarm(!!S.g.al, 170, 0);
  audio.listener = { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: lp.yaw };

  // world update & render
  const rt = now + (S.clockOffset ?? 0) - INTERP_DELAY;
  ents.update(rt, dt, S.t, lp, camera);
  S.vm && S.vm.update(dt, lp, S.t);
  fx.update(dt);
  scene.update(dt, S.t, lp.body);
  scene.render();
  hud.update({ pv: S.pv, g: S.g, camera, lp, entities: ents, myId: S.myId, t: S.t, dt });
  input.endFrame();
}

const FROZEN = { sens: 0, invertY: false, mouse: { dx: 0, dy: 0, l: false, r: false, lPressed: false, rPressed: false, mPressed: false, wheel: 0 }, down: () => false, hit: () => false, up: () => false };

function muzzle(left) {
  const lp = S.lp, cam = S.scene.camera;
  if (lp.firstPerson) {
    const d = dirFromYawPitch(lp.yaw, lp.pitch);
    const rx = Math.cos(lp.yaw), rz = -Math.sin(lp.yaw);
    return new THREE.Vector3(cam.position.x + d.x * 0.6 + rx * 0.2, cam.position.y + d.y * 0.6 - 0.18, cam.position.z + d.z * 0.6 + rz * 0.2);
  }
  const v = S.ents.get(S.myId);
  if (v && v.human && v.human.muzzleWorld(tmpM, left)) return tmpM.clone();
  return new THREE.Vector3(lp.body.x, lp.body.y + 1.4, lp.body.z);
}

function useAbility(k, lp, camera) {
  const A = lp.C.abilities[k];
  const msg = { t: 'ab', k, yaw: lp.yaw, pitch: lp.pitch };
  if (A.id === 'fan' || A.id === 'knife') {
    const aim = lp.aimPoint(camera, S.ents);
    const o = A.id === 'knife' ? handPos() : muzzle();
    const d = [aim.x - o.x, aim.y - o.y, aim.z - o.z];
    const l = Math.hypot(...d) || 1;
    msg.d = d.map((v) => v / l);
    msg.o = [o.x, o.y, o.z];
    if (A.id === 'knife' && S.pv && S.pv.ab.f && S.pv.ab.f[3] > 0) {
      msg.c = S.cid++;
      S.fx.spawnBolt('c' + msg.c, o.x, o.y, o.z, msg.d[0] * 48, msg.d[1] * 48, msg.d[2] * 48, 'knife');
      S.audio.whoosh(false);
    }
  }
  S.transport.send(msg);
}
function handPos() {
  const lp = S.lp;
  const d = dirFromYawPitch(lp.yaw, lp.pitch);
  const rx = Math.cos(lp.yaw), rz = -Math.sin(lp.yaw);
  return new THREE.Vector3(lp.body.x + d.x * 0.5 + rx * 0.25, lp.body.y + 1.45, lp.body.z + d.z * 0.5 + rz * 0.25);
}

function fireBlaster(aim) {
  const lp = S.lp;
  lp.shotSide = lp.weapon === 'pistols' ? -lp.shotSide : 1;
  const o = muzzle(lp.shotSide < 0);
  let dx = aim.x - o.x, dy = aim.y - o.y, dz = aim.z - o.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  const spread = lp.aiming ? 0.002 : lp.speed > 1 ? 0.012 : 0.006;
  dx += (Math.random() - 0.5) * spread * 2; dy += (Math.random() - 0.5) * spread * 2; dz += (Math.random() - 0.5) * spread * 2;
  const n = Math.hypot(dx, dy, dz);
  dx /= n; dy /= n; dz /= n;
  const cid = S.cid++;
  S.transport.send({ t: 'fire', o: [o.x, o.y, o.z], d: [dx, dy, dz], c: cid });
  const sp = lp.weapon === 'pistols' ? 100 : 95;
  S.fx.spawnBolt('c' + cid, o.x, o.y, o.z, dx * sp, dy * sp, dz * sp, 'player');
  const damp = S.pv && S.pv.up.includes('damper');
  S.audio.blaster(o.x, o.y, o.z, false, false);
  if (damp) { /* quieter for others only */ }
}

let speederSide = 1;
function fireSpeeder(aim) {
  const s = S.lp.vehicle;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const rx = -fz, rz = fx;
  speederSide = -speederSide;
  const o = { x: s.x + fx * 1.8 + rx * 0.55 * speederSide, y: s.y + 0.1, z: s.z + fz * 1.8 + rz * 0.55 * speederSide };
  let dx = aim.x - o.x, dy = aim.y - o.y, dz = aim.z - o.z;
  // don't let cannons fire backwards
  const fwd = dx * fx + dz * fz;
  if (fwd < 0) { dx = fx; dz = fz; dy = 0; }
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  const cid = S.cid++;
  S.transport.send({ t: 'vfire', o: [o.x, o.y, o.z], d: [dx, dy, dz], c: cid });
  S.fx.spawnBolt('c' + cid, o.x, o.y, o.z, dx * 140, dy * 140, dz * 140, 'speeder');
  S.audio.blaster(o.x, o.y, o.z, false, true);
}

// class picker
function buildClassPicker() {
  const grid = $('class-grid');
  if (!CLASSES[settings.cls]) settings.cls = DEFAULT_CLASS;
  grid.innerHTML = Object.entries(CLASSES).map(([id, c]) => `<button class="cls" data-cls="${id}" id="cls-${id}"><b>${c.name}</b><small>${c.role}</small></button>`).join('');
  const show = (id) => {
    settings.cls = id; saveSettings();
    grid.querySelectorAll('.cls').forEach((b) => b.classList.toggle('active', b.dataset.cls === id));
    const c = CLASSES[id];
    const ab = Object.entries(c.abilities).map(([k, a]) => `<span><kbd>${k.toUpperCase()}</kbd> ${a.name}</span>`).join('') + (c.leap ? '<span><kbd>Space</kbd> Leap (hold)</span>' : '');
    $('class-info').innerHTML = `<div class="ci-top"><b>${c.weaponName}</b>${c.wanted ? '<em>Wanted by the Concordance</em>' : ''}</div><p>${c.desc}</p><div class="ci-ab">${ab}<span><kbd>G</kbd> ${c.throwable || 'Thermal charges'} ×${c.grenades}</span><span><kbd>H</kbd> ${c.consumable || 'Medpacks'} ×${c.medpacks}</span></div>`;
  };
  grid.querySelectorAll('.cls').forEach((b) => b.addEventListener('click', () => show(b.dataset.cls)));
  show(params.get('cls') && CLASSES[params.get('cls')] ? params.get('cls') : settings.cls);
}

// crew invite (peer-to-peer modes)
function inviteLink() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', S.crew.code);
  if (S.crew.relay) u.searchParams.set('relay', S.crew.relay);
  return u.toString();
}
function setupInvite() {
  const show = !!S.crew;
  $('invite').classList.toggle('hidden', !show);
  $('crew-chip').classList.toggle('hidden', !show);
  if (!show) return;
  $('invite-code').textContent = S.crew.code;
  $('invite-link').value = inviteLink();
  $('crew-chip').innerHTML = `Crew code <b>${S.crew.code}</b>`;
  if (S.mode === 'host') S.hud.note(`Your crew code is ${S.crew.code}. Friends open this page, choose Join a crew, and enter it.`, 'objective');
}
async function copyInvite() {
  const link = inviteLink();
  try { await navigator.clipboard.writeText(link); S.hud.note('Invite link copied', 'info'); }
  catch { $('invite-link').select(); S.hud.note('Copy the link from the pause menu', 'warn'); }
}
$('crew-chip').addEventListener('click', (e) => { e.stopPropagation(); copyInvite(); });
$('invite-copy').addEventListener('click', copyInvite);

// chat input
$('chat-in').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (v && S.transport) S.transport.send({ t: 'chat', m: v });
    closeChat();
  } else if (e.key === 'Escape') closeChat();
  e.stopPropagation();
});
function closeChat() {
  S.chatting = false;
  S.input.enabled = true;
  $('chat-in').classList.add('hidden');
  $('chat-in').blur();
  S.input.lock();
}

initMenu();
