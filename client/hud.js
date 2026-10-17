// DOM HUD: vitals, loadout, compass, world markers, detection indicators, prompts,
// mission tracker, notes, chat, and the job board / merchant modals.
import * as THREE from 'three';
import { K, F, MISSIONS, ITEMS, MERCHANTS, PLAYER_COLORS, POWERS, CLASSES, ADVANCED, BRANCHES, BRANCH_RESET_COST, SLOTS, RANGED, LEVELS, effectiveClass, advancedFor, branchesFor, abilityPool } from '../shared/config.js';
import { clamp, wrapAngle, yawTo, dist2 } from '../shared/math.js';
import { PLANETS, PLANET_ORDER, SHIP } from '../shared/planets.js';
import { GOODS, GOOD_ORDER, RECIPES, UPGRADES, UPGRADE_ORDER, packCount } from '../shared/economy.js';

const $ = (id) => document.getElementById(id);
const v3 = new THREE.Vector3();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'vignette', 'dmg-dirs', 'markers', 'bubbles', 'compass-strip', 'compass-marks', 'party', 'alarm-banner', 'cam-banner', 'mission-box', 'crosshair', 'hitmark', 'detect', 'prompt', 'prompt-text', 'prompt-ring', 'notes', 'big-msg', 'bar-hp', 'bar-sh', 'num-hp', 'bar-fo', 'num-fo', 'stealth', 'vis-label', 'eye', 'num-cr', 'slot-main', 'bar-heat', 'wpn-name', 'cls-name', 'heat-wrap', 'blade-ic', 'lbl-gr', 'lbl-md', 'powers', 'row-focus', 'wanted', 'num-gr', 'num-md', 'chat-log', 'chat-in', 'downed', 'dn-timer', 'speedo', 'spd-num', 'modal', 'modal-body', 'num-pk', 'num-cap', 'heat-banner', 'lv-badge', 'bar-xp', 'career-btn', 'xp-pops']) this.el[id] = $(id);
    this.markerPool = [];
    this.bubblePool = [];
    this.detPool = [];
    this.pings = [];
    this.dmg = [];
    this.vig = 0;
    this.hitT = 0;
    this.lastMissionKey = '';
    this.lastPartyKey = '';
    this.modalOpen = null;
    this.buildCompass();
    this.el['prompt-ring'].querySelector('circle').style.strokeDasharray = '94.2';
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  setDrawn(drawn) {
    this.drawnState = drawn;
    const C = this.C || CLASSES.soldier;
    this.el['wpn-name'].textContent = drawn ? C.weaponName : `${C.weaponName} (holstered)`;
    this.el['slot-main'].classList.toggle('on', drawn);
    this.el.crosshair.classList.toggle('holstered', !drawn);
  }

  setClass(cls, adv, branch, slots) {
    const C = effectiveClass(cls, adv, branch, slots);
    this.cls = cls;
    this.adv = adv || null;
    this.branch = branch || null;
    this.C = C;
    this.el['cls-name'].textContent = C.name;
    this.el['wpn-name'].textContent = C.weaponName;
    const ranged = RANGED.includes(C.weapon);
    this.el['heat-wrap'].classList.toggle('hidden', !ranged);
    this.el['blade-ic'].classList.toggle('hidden', ranged);
    this.el['lbl-gr'].textContent = C.throwable || 'Charges';
    this.el['lbl-md'].textContent = C.consumable || 'Medpacks';
    this.el['row-focus'].classList.toggle('hidden', !C.focus);
    this.el.wanted.classList.toggle('hidden', !C.wanted);
    const tiles = Object.entries(C.abilities).map(([k, a]) => ({ k, a }));
    if (C.leap) tiles.push({ k: 'leap', a: { name: 'Leap' } });
    this.el.powers.style.gridTemplateColumns = `repeat(${tiles.length}, 1fr)`;
    this.el.powers.innerHTML = tiles.map(({ k, a }) => `<div class="pw" data-k="${k}"><kbd>${k === 'leap' ? '␣' : k.toUpperCase()}</kbd><span>${a.name}</span><b></b><i></i></div>`).join('');
    this.pwEls = [...this.el.powers.querySelectorAll('.pw')];
  }

  buildCompass() {
    const strip = this.el['compass-strip'];
    // 0..360 degrees mapped; we render ticks dynamically each frame instead
    this.compassItems = [];
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = 0; d < 360; d += 15) {
      const t = document.createElement('div');
      t.className = labels[d] ? 'cmp-l' : 'cmp-t';
      if (labels[d]) t.textContent = labels[d];
      strip.appendChild(t);
      this.compassItems.push({ el: t, deg: d });
    }
  }

  // Heading in degrees: north = -Z, east = +X
  headingDeg(yaw) { return ((-yaw * 180) / Math.PI + 360) % 360; }

  updateCompass(yaw, marks) {
    const w = this.el['compass-strip'].clientWidth || 500;
    const head = this.headingDeg(yaw);
    const span = 140; // degrees visible
    for (const it of this.compassItems) {
      let d = ((it.deg - head + 540) % 360) - 180;
      const x = w / 2 + (d / span) * w;
      it.el.style.left = x + 'px';
      it.el.style.display = Math.abs(d) < span / 2 + 10 ? '' : 'none';
    }
    const mk = this.el['compass-marks'];
    mk.innerHTML = '';
    for (const m of marks) {
      let d = ((m.deg - head + 540) % 360) - 180;
      d = clamp(d, -span / 2, span / 2);
      const e = document.createElement('div');
      e.className = 'cmp-m';
      e.style.left = (w / 2 + (d / span) * w) + 'px';
      e.style.color = m.color;
      e.textContent = m.icon;
      mk.appendChild(e);
    }
  }

  project(camera, x, y, z) {
    v3.set(x, y, z).project(camera);
    if (v3.z > 1) return null;
    return { x: (v3.x * 0.5 + 0.5) * window.innerWidth, y: (-v3.y * 0.5 + 0.5) * window.innerHeight, behind: false };
  }

  // ---------------------------------------------------------------- per-frame
  update(st) {
    const { pv, g, camera, lp, entities, myId, t, dt } = st;
    if (!pv) return;
    // vitals
    const hpMax = pv.mhp || 100;
    this.el['bar-hp'].style.width = clamp(pv.hp / hpMax, 0, 1) * 100 + '%';
    this.el['bar-sh'].style.width = pv.shm ? (pv.sh / pv.shm) * 100 + '%' : '0';
    this.el['num-hp'].textContent = Math.max(0, pv.hp);
    this.el['bar-fo'].style.width = pv.fo + '%';
    this.el['num-fo'].textContent = pv.fo;
    this.el['num-cr'].textContent = pv.cr.toLocaleString();
    if (pv.pk) { const n = Object.values(pv.pk).reduce((a, b) => a + b, 0); this.el['num-pk'].textContent = n; this.el['num-cap'].textContent = pv.cap; }
    this.el['num-gr'].textContent = pv.gr;
    this.el['num-md'].textContent = pv.md;
    this.el['bar-heat'].style.width = pv.ht * 100 + '%';
    this.el['slot-main'].classList.toggle('over', !!pv.oh);
    const att = pv.up.includes('attune') ? 0.75 : 1;
    const C = this.C || CLASSES.soldier;
    // level and experience
    if (pv.lv) {
      const lk = pv.lv + ':' + pv.xp + ':' + pv.adv + ':' + pv.br + ':' + this.cls;
      if (this._lk !== lk) {
        this._lk = lk;
        this.el['lv-badge'].textContent = 'Lv ' + pv.lv;
        this.el['bar-xp'].style.width = (pv.lv >= LEVELS.max ? 100 : clamp(pv.xp / (pv.xpn || 1), 0, 1) * 100) + '%';
        this.el['bar-xp'].parentElement.title = pv.lv >= LEVELS.max ? 'Top level' : `${pv.xp} / ${pv.xpn} XP to level ${pv.lv + 1}`;
        const ready = (pv.lv >= LEVELS.advancedAt && !pv.adv && advancedFor(this.cls).length > 0) || (pv.adv && !pv.br && pv.lv >= LEVELS.branchAt);
        this.el['career-btn'].classList.toggle('ready', !!ready);
        this.el['career-btn'].title = ready ? (pv.adv ? 'A branch is open (K)' : 'An advanced class is open (K)') : 'Career (K)';
      }
    }
    for (const e of this.pwEls || []) {
      const k = e.dataset.k;
      if (k === 'leap') { e.classList.toggle('na', pv.fo < POWERS.leap.cost * att); e.classList.toggle('on', lp.leapCharge > 0.16); continue; }
      const st = pv.ab && pv.ab[k];
      if (!st) continue;
      const [cd, max, actv, charges] = st;
      const A = C.abilities[k];
      if (!A) continue;
      const cost = POWERS[A.id] && POWERS[A.id].cost;
      e.classList.toggle('na', (cost && pv.fo < cost * att) || charges === 0);
      e.classList.toggle('on', actv > 0);
      e.querySelector('i').style.height = max ? clamp(cd / max, 0, 1) * 100 + '%' : '0';
      e.querySelector('b').textContent = charges >= 0 ? charges : actv > 0 ? Math.ceil(actv) : '';
    }
    // stealth meter
    const vis = pv.vis;
    const s = this.el.stealth;
    const C2 = this.C || CLASSES.soldier;
    const disguised = Object.entries(C2.abilities).some(([k, a]) => a.id === 'disguise' && pv.ab && pv.ab[k] && pv.ab[k][2] > 0);
    const label = lp.vehicle ? 'Loud' : disguised ? (vis < 0.2 ? 'Disguised' : 'Disguised — too close') : vis < 0.45 ? 'Hidden' : vis < 0.9 ? 'Low profile' : vis < 1.3 ? 'Visible' : 'Exposed';
    this.el['vis-label'].textContent = label;
    s.classList.toggle('hidden-s', vis < 0.45 && !lp.vehicle);
    s.classList.toggle('exposed-s', vis >= 1.3 || !!lp.vehicle);
    this.el.eye.querySelector('circle').setAttribute('r', String(2 + clamp(vis, 0, 1.6) * 3));
    // crosshair
    const ch = this.el.crosshair;
    ch.classList.toggle('blade', lp.weapon === 'blade');
    ch.classList.toggle('aim', lp.aiming);
    ch.classList.toggle('hot', !!pv.oh);
    ch.style.display = lp.vehicle ? 'none' : '';
    this.hitT -= dt;
    this.el.hitmark.style.opacity = this.hitT > 0 ? 1 : 0;
    // damage vignette
    this.vig = Math.max(0, this.vig - dt * 1.4);
    const low = pv.hp < 35 ? (0.35 + Math.sin(t * 5) * 0.1) * (1 - pv.hp / 35) : 0;
    this.el.vignette.style.opacity = Math.min(1, this.vig + low + (pv.dn ? 0.7 : 0));
    this.updateDmgDirs(lp, dt);
    // prompt
    if (pv.ia && !pv.dn) {
      this.el.prompt.classList.remove('hidden');
      this.el['prompt-text'].textContent = pv.ia[1];
      const ring = this.el['prompt-ring'];
      ring.style.display = pv.ia[2] > 0 ? '' : 'none';
      ring.querySelector('circle').style.strokeDashoffset = String(94.2 * (1 - (pv.ia[3] || 0)));
    } else this.el.prompt.classList.add('hidden');
    // downed / speedo
    this.el.downed.classList.toggle('hidden', !pv.dn);
    if (pv.dn) this.el['dn-timer'].textContent = `Bleeding out — ${Math.ceil(pv.bt)}s`;
    this.el.speedo.classList.toggle('hidden', !lp.vehicle);
    if (lp.vehicle) this.el['spd-num'].textContent = Math.round(lp.speed * 3.6);
    if (g) this.updateGlobal(g, myId);
    this.updateMarkers(st);
  }

  updateGlobal(g, myId) {
    this.el['alarm-banner'].classList.toggle('hidden', !g.al);
    this.el['cam-banner'].classList.toggle('hidden', !!g.cam);
    const hk = (g.ht || 0) + ':' + g.town;
    if (hk !== this._hk) {
      this._hk = hk;
      const h = g.ht || 0;
      this.el['heat-banner'].classList.toggle('hidden', !h);
      if (h) this.el['heat-banner'].innerHTML = `<b>Heat in ${esc(g.town || 'town')}: ${h}</b> — ${h >= 60 ? 'the militia is hunting you' : h >= 20 ? "the owner's friends are after you" : 'prices are up'}. Lie low, or pay the fine at the exchange.`;
    }
    // mission tracker
    const key = JSON.stringify([g.m, g.pl]);
    if (key !== this.lastMissionKey) {
      this.lastMissionKey = key;
      const m = g.m;
      const box = this.el['mission-box'];
      if (!m) box.innerHTML = `<div class="mb-name">No active job</div><div class="mb-hint">${g.pl && g.pl !== 'duskvaro' ? `Jobs come from Oru Dask on Dusk Varo. Board the ${SHIP.name} to fly back.` : 'Find the job board in the Khet plaza, or talk to Oru Dask in the cantina.'}</div>`;
      else {
        const info = MISSIONS[m.id];
        const steps = m.steps.map(([text, done], i) => `<div class="mb-step ${done ? 'done' : i === m.step ? 'cur' : ''}"><span class="bx"></span><span>${esc(text)}</span></div>`).join('');
        const status = m.status === 'complete' ? `<div class="mb-ghost">Complete — +${m.reward}cr each</div>` : m.status === 'failed' ? `<div class="mb-ghost lost">Failed: ${esc(m.reason || '')}</div>` : info.ghostBonus ? `<div class="mb-ghost ${m.ghost ? '' : 'lost'}">Ghost bonus +${info.ghostBonus}cr: no alarms</div>` : '';
        const where = m.home && m.home !== 'duskvaro' ? `<div class="mb-where">${esc(PLANETS[m.home].name)}${g.pl === m.home ? ' (you are here)' : ''}</div>` : '';
        box.innerHTML = `<div class="mb-name">${esc(info.name)}</div><div class="mb-type">${esc(info.type)}, from ${esc(info.giver)}, pays ${info.reward}cr</div>${where}${steps}${status}`;
      }
    }
    const pk = JSON.stringify(g.party);
    if (pk !== this.lastPartyKey) {
      this.lastPartyKey = pk;
      this.el.party.innerHTML = g.party.map(([id, name, color, hp, down, cr, cls, aboard, lv, adv, br]) => `<div class="pm ${down ? 'down' : ''}"><i style="background:${PLAYER_COLORS[color]}"></i><span>${lv ? `<span class="lv" title="${esc(effectiveClass(cls, adv, br).name)}">${lv}</span>` : ''}${esc(name)}${id === myId ? ' (you)' : ''}${aboard ? ' <em class="aboard">aboard</em>' : ''}</span><div class="b"><div style="width:${down ? 100 : clamp(hp, 0, 100)}%"></div></div></div>`).join('');
    }
  }

  // ---------------------------------------------------------------- markers
  updateMarkers(st) {
    const { camera, g, entities, myId, lp, t, dt } = st;
    const marks = [];
    const W = window.innerWidth, H = window.innerHeight;
    let mi = 0, bi = 0, di = 0;
    const marker = (cls, html, x, y) => {
      let e = this.markerPool[mi];
      if (!e) { e = document.createElement('div'); this.el.markers.appendChild(e); this.markerPool.push(e); }
      mi++;
      e.className = 'mk ' + cls;
      if (e._h !== html) { e.innerHTML = html; e._h = html; }
      e.style.left = x + 'px'; e.style.top = y + 'px';
      e.style.display = '';
    };
    const me = lp.body;
    const camYaw = lp.yaw;
    // objective waypoint
    if (g && g.m && g.m.wp && g.m.status === 'active') {
      const [x, y, z] = g.m.wp;
      const d = Math.hypot(x - me.x, z - me.z);
      const p = this.project(camera, x, y + 2.2, z);
      if (p && p.x > 0 && p.x < W && p.y > 0 && p.y < H) marker('obj', `<b></b>${Math.round(d)}m`, p.x, p.y);
      marks.push({ deg: this.headingDeg(yawTo(me.x, me.z, x, z)), icon: '◆', color: '#ff8a3d' });
    }
    // teammates, guards, bubbles
    for (const v of entities.views.values()) {
      if (v.kind === K.PLAYER && v.id !== myId) {
        const r = entities.roster.get(v.id);
        const p = this.project(camera, v.x, v.y + 2.15, v.z);
        const col = PLAYER_COLORS[r ? r.color : 0];
        if (p) marker('mate', `<span style="color:${col}">${esc(r ? r.name : '')}${v.flags & F.DOWNED ? ' — DOWN' : ''}</span>`, p.x, p.y);
        marks.push({ deg: this.headingDeg(yawTo(me.x, me.z, v.x, v.z)), icon: '●', color: col });
      }
      if ((v.kind === K.LANCER || v.kind === K.OFFICER || v.kind === K.CAMERA) && !(v.flags & F.DEAD)) {
        const sus = (v.a1 || 0) / 100;
        const combat = (v.kind !== K.CAMERA && v.a2 === 2) || (v.flags & F.ALERT);
        const d = Math.hypot(v.x - me.x, v.z - me.z);
        if ((sus > 0.02 || combat) && d < 70) {
          const p = this.project(camera, v.x, v.y + (v.kind === K.CAMERA ? 0.6 : 2.25), v.z);
          if (p) marker('alert ' + (combat ? 'c' : 's'), `${combat ? '!' : '?'}${combat ? '' : `<div class="meter"><div style="width:${sus * 100}%"></div></div>`}`, p.x, p.y);
          // detection arc around crosshair pointing toward the watcher
          if (!combat && sus < 1) {
            let e = this.detPool[di];
            if (!e) { e = document.createElement('div'); e.className = 'det'; e.innerHTML = '<svg viewBox="-23 -23 46 46"><path d="M -9 -19 A 21 21 0 0 1 9 -19" fill="none" stroke-width="4" stroke-linecap="round"/></svg>'; this.el.detect.appendChild(e); this.detPool.push(e); }
            di++;
            const rel = wrapAngle(yawTo(me.x, me.z, v.x, v.z) - camYaw);
            e.style.display = '';
            e.style.transform = `rotate(${-rel}rad) scale(${1.15 + sus * 0.35})`;
            const path = e.querySelector('path');
            path.setAttribute('stroke', combat ? '#e0384b' : sus > 0.35 ? '#ffd479' : '#f4ead8');
            path.setAttribute('stroke-opacity', String(0.4 + sus * 0.6));
          }
        }
      }
      if ((v.kind === K.LANCER || v.kind === K.OFFICER) && (v.flags & F.MARKED) && !(v.flags & F.DEAD)) {
        // recon and bounty marks show through walls
        const p = this.project(camera, v.x, v.y + 2.5, v.z);
        if (p) marker('marked', `<b></b>${Math.round(Math.hypot(v.x - me.x, v.z - me.z))}m`, p.x, p.y);
        marks.push({ deg: this.headingDeg(yawTo(me.x, me.z, v.x, v.z)), icon: '◇', color: '#ffd27a' });
      }
      if (v.kind === K.LANCER || v.kind === K.OFFICER) {
        if (v.flags & F.ALERT) marks.push({ deg: this.headingDeg(yawTo(me.x, me.z, v.x, v.z)), icon: '▾', color: '#e0384b' });
      }
      if (v.bubble && v.bubbleT > 0) {
        const d = Math.hypot(v.x - me.x, v.z - me.z);
        if (d < 32) {
          const p = this.project(camera, v.x, v.y + (v.kind === K.CAMERA ? 0.9 : 2.6), v.z);
          if (p) {
            let e = this.bubblePool[bi];
            if (!e) { e = document.createElement('div'); this.el.bubbles.appendChild(e); this.bubblePool.push(e); }
            bi++;
            e.className = 'bub ' + (v.kind === K.LANCER || v.kind === K.OFFICER || v.kind === K.CAMERA ? 'foe' : 'npc');
            if (e._t !== v.bubble) { e.textContent = v.bubble; e._t = v.bubble; }
            e.style.left = p.x + 'px'; e.style.top = (p.y - (v.kind === K.LANCER && (v.a1 > 2) ? 28 : 0)) + 'px';
            e.style.opacity = Math.min(1, v.bubbleT * 2) * clamp(1.4 - d / 30, 0.3, 1);
            e.style.display = '';
          }
        }
      }
    }
    // pings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const pg = this.pings[i];
      pg.t -= dt;
      if (pg.t <= 0) { this.pings.splice(i, 1); continue; }
      const p = this.project(camera, pg.x, pg.y + 1, pg.z);
      const d = Math.hypot(pg.x - me.x, pg.z - me.z);
      if (p) marker('ping', `<b style="border-color:${pg.color}"></b><span style="color:${pg.color}">${Math.round(d)}m</span>`, p.x, p.y);
      marks.push({ deg: this.headingDeg(yawTo(me.x, me.z, pg.x, pg.z)), icon: '✦', color: pg.color });
    }
    for (; mi < this.markerPool.length; mi++) this.markerPool[mi].style.display = 'none';
    for (; bi < this.bubblePool.length; bi++) this.bubblePool[bi].style.display = 'none';
    for (; di < this.detPool.length; di++) this.detPool[di].style.display = 'none';
    this.updateCompass(camYaw, marks);
  }

  addPing(x, y, z, color) { this.pings.push({ x, y, z, color, t: 6 }); }

  hurt(amount, sx, sz, lp) {
    this.vig = Math.min(0.8, this.vig + amount / 40);
    this.dmg.push({ x: sx, z: sz, t: 1.2 });
  }
  updateDmgDirs(lp, dt) {
    const root = this.el['dmg-dirs'];
    while (root.children.length < this.dmg.length) { const e = document.createElement('div'); e.className = 'dmg-dir'; root.appendChild(e); }
    for (let i = this.dmg.length - 1; i >= 0; i--) { this.dmg[i].t -= dt; if (this.dmg[i].t <= 0) this.dmg.splice(i, 1); }
    [...root.children].forEach((e, i) => {
      const d = this.dmg[i];
      if (!d) { e.style.display = 'none'; return; }
      e.style.display = '';
      const rel = wrapAngle(yawTo(lp.body.x, lp.body.z, d.x, d.z) - lp.yaw);
      e.style.transform = `rotate(${-rel}rad)`;
      e.style.opacity = Math.min(1, d.t);
    });
  }
  hit(kill) { this.hitT = 0.18; this.el.hitmark.classList.toggle('kill', !!kill); }

  note(text, style) {
    const e = document.createElement('div');
    e.className = 'note ' + (style || 'info');
    e.textContent = text;
    this.el.notes.appendChild(e);
    while (this.el.notes.children.length > 5) this.el.notes.firstChild.remove();
    setTimeout(() => e.remove(), style === 'objective' || style === 'complete' || style === 'alarm' ? 7000 : 4200);
  }
  big(title, sub) {
    const e = this.el['big-msg'];
    e.innerHTML = `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    e.classList.remove('hidden');
    clearTimeout(this._bigT);
    this._bigT = setTimeout(() => e.classList.add('hidden'), 4500);
  }
  chat(name, text, color) {
    const e = document.createElement('div');
    e.innerHTML = `<b style="color:${PLAYER_COLORS[color] || '#fff'}">${esc(name)}</b> ${esc(text)}`;
    this.el['chat-log'].appendChild(e);
    while (this.el['chat-log'].children.length > 7) this.el['chat-log'].firstChild.remove();
    setTimeout(() => { e.style.opacity = '0.35'; }, 12000);
  }

  // ---------------------------------------------------------------- modals
  openMissions(g, send, onClose) {
    const active = g && g.m && g.m.status === 'active' ? g.m.id : null;
    const html = `<h2>Jobs in Khet</h2><p class="sub">Oru Dask brokers work against the Concordance. Rewards are paid to everyone in the crew. Off-world jobs need the ${SHIP.name}.</p>
      <div class="jobs">${Object.entries(MISSIONS).map(([id, m]) => `
        <div class="job ${active === id ? 'active' : ''}"><div><h3>${esc(m.name)}</h3><div class="meta">${m.planet ? `<span class="offworld" style="--pc:${PLANETS[m.planet].color}">${esc(PLANETS[m.planet].name)}</span> ` : ''}${esc(m.type)}${m.ghostBonus ? `, ghost bonus ${m.ghostBonus}cr` : ''}</div></div>
        <div class="pay">${m.reward}cr</div><p>${esc(m.brief)}</p>
        ${active === id ? `<button data-abandon="1">Abandon job</button>` : `<button data-accept="${id}" ${active ? 'disabled' : ''}>Take this job</button>`}</div>`).join('')}</div>`;
    this.openModal(html, onClose);
    this.el['modal-body'].querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => { send({ t: 'accept', id: b.dataset.accept }); this.closeModal(); }));
    this.el['modal-body'].querySelectorAll('[data-abandon]').forEach((b) => b.addEventListener('click', () => { send({ t: 'abandon' }); this.closeModal(); }));
  }
  openShop(merchantId, getPv, send, onClose) {
    const M = MERCHANTS[merchantId];
    const render = () => {
      const pv = getPv();
      const html = `<h2>${esc(M.name)}</h2><p class="sub">${esc(M.title)}. You have ${pv.cr.toLocaleString()}cr.</p>
        <div class="wares">${M.stock.map((id) => {
          const it = ITEMS[id];
          const owned = it.kind === 'upgrade' && pv.up.includes(id);
          const count = id === 'grenade' ? pv.gr : id === 'medpack' ? pv.md : null;
          const full = count != null && count >= it.max;
          return `<div class="ware"><div><h3>${esc(it.name)}</h3><div class="meta">${it.kind === 'upgrade' ? 'Permanent upgrade' : `Carrying ${count} of ${it.max}`}</div></div>
            <div class="price">${it.price}cr</div><p>${esc(it.desc)}</p>
            ${owned ? '<span class="owned">Owned</span>' : `<button data-buy="${id}" ${pv.cr < it.price || full ? 'disabled' : ''}>${full ? 'Full' : 'Buy'}</button>`}</div>`;
        }).join('')}</div>`;
      this.el['modal-body'].innerHTML = html;
      this.el['modal-body'].querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => { send({ t: 'buy', item: b.dataset.buy }); setTimeout(render, 250); }));
    };
    this.openModal('', onClose);
    render();
  }
  // The Wayfarer's nav console: a star map of the Reach, who's aboard, and the launch control
  openNav(getG, myId, send, onClose) {
    let sel = null;
    let key = '';
    const render = (force) => {
      const g = getG();
      if (!g) return;
      const k = JSON.stringify([g.party, g.tr ? g.tr[0] : null, sel, g.pl, g.m && g.m.away]);
      if (!force && k === key) return;
      key = k;
      const here = g.pl;
      const away = g.m && g.m.status === 'active' ? g.m.away : null;
      if (!sel) sel = away && away !== here ? away : PLANET_ORDER.find((id) => id !== here);
      const crew = g.party.map(([id, name, color, hp, down, cr, cls, aboard]) => ({ id, name, color, aboard: !!aboard }));
      const missing = crew.filter((c) => !c.aboard);
      const P = PLANETS[sel], H = PLANETS[here];
      const W = 420, Hh = 300;
      const pt = (id) => [PLANETS[id].map[0] * W, PLANETS[id].map[1] * Hh];
      const [hx, hy] = pt(here), [sx, sy] = pt(sel);
      const stars = Array.from({ length: 70 }, (_, i) => { const a = Math.sin(i * 91.7) * 43758.5, b = Math.sin(i * 12.9) * 9631.1; return `<circle cx="${((a - Math.floor(a)) * W).toFixed(1)}" cy="${((b - Math.floor(b)) * Hh).toFixed(1)}" r="${i % 9 === 0 ? 1.3 : 0.7}" class="st"/>`; }).join('');
      const nodes = PLANET_ORDER.map((id) => {
        const [x, y] = pt(id);
        const p = PLANETS[id];
        return `<g class="pl ${id === sel ? 'sel' : ''} ${id === here ? 'here' : ''}" data-pl="${id}" tabindex="0" role="button" aria-label="${esc(p.name)}">
          <circle cx="${x}" cy="${y}" r="22" class="hit"/>
          <circle cx="${x}" cy="${y}" r="${id === here ? 11 : 9}" fill="${p.color}" class="orb"/>
          ${id === here ? `<circle cx="${x}" cy="${y}" r="17" class="ring"/>` : ''}
          ${id === away ? `<circle cx="${x}" cy="${y}" r="21" class="job"/>` : ''}
          <text x="${x}" y="${y + 34}" text-anchor="middle">${esc(p.name)}</text></g>`;
      }).join('');
      const html = `<h2>${esc(SHIP.name)}: nav console</h2><p class="sub">${esc(SHIP.model)}. Seats ${SHIP.seats}. Parked at ${esc(H.settlement)} on ${esc(H.name)}.</p>
        <div class="nav">
          <svg viewBox="0 0 ${W} ${Hh}" class="starmap" aria-label="Star map of the Hollow Reach">
            ${stars}
            <line x1="${hx}" y1="${hy}" x2="${sx}" y2="${sy}" class="route"/>
            ${nodes}
          </svg>
          <div class="nav-side">
            <div class="dest" style="--pc:${P.color}"><h3>${esc(P.name)}</h3><p>${esc(P.blurb)}</p>
              <dl><dt>Settlement</dt><dd>${esc(P.settlement)}</dd><dt>Concordance site</dt><dd>${esc(P.site)}</dd></dl>
              ${away === sel ? '<div class="jobtag">Your current job is here</div>' : ''}</div>
            <div class="crew"><b>Crew aboard ${crew.length - missing.length} of ${crew.length}</b>
              ${crew.map((c) => `<div class="cm ${c.aboard ? 'on' : ''}"><i style="background:${PLAYER_COLORS[c.color]}"></i>${esc(c.name)}${c.id === myId ? ' (you)' : ''}<span>${c.aboard ? 'aboard' : 'on the ground'}</span></div>`).join('')}</div>
            ${g.tr ? `<div class="launching">Jumping to ${esc(PLANETS[g.tr[0]].name)}…</div>` : `<button class="cta" data-launch ${missing.length || sel === here ? 'disabled' : ''}>${sel === here ? "You're here" : missing.length ? `Waiting for ${esc(missing.map((c) => c.name).join(', '))}` : `Launch for ${esc(P.name)}`}</button>`}
            <button class="ghost" data-disembark ${g.tr ? 'disabled' : ''}>Disembark</button>
          </div>
        </div>`;
      this.el['modal-body'].innerHTML = html;
      const body = this.el['modal-body'];
      body.querySelectorAll('[data-pl]').forEach((n) => {
        const pick = () => { if (n.dataset.pl !== here) { sel = n.dataset.pl; render(true); } };
        n.addEventListener('click', pick);
        n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') pick(); });
      });
      const L = body.querySelector('[data-launch]');
      if (L) L.addEventListener('click', () => { send({ t: 'travel', to: sel }); setTimeout(() => render(true), 150); });
      body.querySelector('[data-disembark]').addEventListener('click', () => { send({ t: 'disembark' }); this.closeModal(); });
    };
    this.openModal('', onClose);
    render(true);
    clearInterval(this._navT);
    this._navT = setInterval(() => { if (!this.modalOpen || !this.el['modal-body'].querySelector('.nav')) { clearInterval(this._navT); return; } render(); }, 700);
  }
  // ---------------------------------------------------------------- economy
  packLine(pv) {
    const pk = pv.pk || {};
    const items = GOOD_ORDER.filter((g) => pk[g]).map((g) => `<span>${esc(GOODS[g].name)} <b>${pk[g]}</b></span>`);
    return `<div class="pack-list">${items.length ? items.join('') : '<span>Your pack is empty.</span>'}</div>`;
  }
  // The exchange: buy and sell goods; prices move with the town's stock
  openMarket(merchantId, getG, getPv, send, onClose) {
    const M = MERCHANTS[merchantId];
    let key = '';
    const render = (force) => {
      const g = getG(), pv = getPv();
      if (!g || !g.mk || !pv) return;
      const k = JSON.stringify([g.mk, pv.pk, pv.cr, pv.cap, g.ht, pv.fq]);
      if (!force && k === key) return;
      key = k;
      const pk = pv.pk || {}, used = packCount(pk), room = pv.cap - used;
      const ship = g.ship != null && g.ship < 9000 ? (g.ship < 60 ? 'a trader landed just now' : `last trader landed ${Math.round(g.ship / 60)} min ago`) : 'no traders yet today';
      const heat = g.ht || 0, bm = 1 + heat / 200, sm = 1 - heat / 300;
      const row = ([id, stock, buy0, sell0, trend]) => {
        const buy = Math.round(buy0 * bm), sell = Math.round(sell0 * sm);
        const have = pk[id] || 0;
        const arrow = trend > 0 ? '<span class="up" title="Price rising">▲</span>' : trend < 0 ? '<span class="dn" title="Price falling">▼</span>' : '';
        return `<tr><td class="good"><b>${esc(GOODS[id].name)}</b><small>${esc(GOODS[id].desc)}</small></td>
          <td class="n">${stock}</td><td class="n">${buy}cr ${arrow}</td><td class="n">${sell}cr</td><td class="n">${have || '—'}</td>
          <td class="act"><button data-t="${id}" data-n="1" ${stock < 1 || pv.cr < buy || room < 1 ? 'disabled' : ''}>Buy 1</button><button data-t="${id}" data-n="5" ${stock < 5 || pv.cr < buy * 5 || room < 5 ? 'disabled' : ''}>Buy 5</button><button class="sell" data-t="${id}" data-n="-1" ${have ? '' : 'disabled'}>Sell 1</button><button class="sell" data-t="${id}" data-n="${-have}" ${have > 1 ? '' : 'disabled'}>Sell all</button></td></tr>`;
      };
      const raw = g.mk.rows.filter((r) => GOODS[r[0]].kind === 'raw'), parts = g.mk.rows.filter((r) => GOODS[r[0]].kind === 'part');
      this.el['modal-body'].innerHTML = `<h2>${esc(M.title)}</h2><p class="sub">${esc(M.name)} buys and sells for ${esc(g.mk.town)}. Prices rise when the town runs short and fall when it's flooded.</p>
        <div class="mk-head"><span>You have <b>${pv.cr.toLocaleString()}cr</b></span><span>Pack <b>${used}/${pv.cap}</b></span><span>${esc(ship)}</span></div>
        ${heat ? `<div class="mk-heat"><span>${esc(g.mk.town)} has heat ${heat} on your crew: buying costs ${Math.round((bm - 1) * 100)}% more and selling pays ${Math.round((1 - sm) * 100)}% less.</span><button data-fine ${pv.cr >= heat * 15 ? '' : 'disabled'}>Pay the fine (${(heat * 15).toLocaleString()}cr)</button></div>` : ''}
        ${pv.fq ? `<div class="mk-fence"><span>The back room will take the stolen speeder parked outside. No questions.</span><button data-fence>Sell it to the fence (${pv.fq}cr)</button></div>` : ''}
        <div class="mk-wrap"><table class="mkt"><thead><tr><th>Goods</th><th class="n">In town</th><th class="n">Buy</th><th class="n">Sell</th><th class="n">You carry</th><th></th></tr></thead>
        <tbody><tr class="sec"><td colspan="6">Raw goods</td></tr>${raw.map(row).join('')}<tr class="sec"><td colspan="6">Parts</td></tr>${parts.map(row).join('')}</tbody></table></div>`;
      this.el['modal-body'].querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { send({ t: 'trade', g: b.dataset.t, n: +b.dataset.n }); setTimeout(() => render(true), 200); }));
      this.el['modal-body'].querySelectorAll('[data-fine]').forEach((b) => b.addEventListener('click', () => { send({ t: 'fine' }); setTimeout(() => render(true), 250); }));
      this.el['modal-body'].querySelectorAll('[data-fence]').forEach((b) => b.addEventListener('click', () => { send({ t: 'fence' }); setTimeout(() => render(true), 250); }));
    };
    this.openModal('', onClose);
    render(true);
    clearInterval(this._mkT);
    this._mkT = setInterval(() => { if (!this.modalOpen || !this.el['modal-body'].querySelector('.mkt')) { clearInterval(this._mkT); return; } render(); }, 500);
  }
  // The workshop: make parts from goods, then fit upgrades to what you own
  openWorkshop(merchantId, getPv, send, onClose) {
    const M = MERCHANTS[merchantId];
    let key = '';
    const needList = (cost, pk) => Object.entries(cost).map(([g, n]) => `<span class="${(pk[g] || 0) >= n ? 'ok' : 'no'}">${esc(GOODS[g].name)} ${pk[g] || 0}/${n}</span>`).join('');
    const render = (force) => {
      const pv = getPv();
      if (!pv) return;
      const k = JSON.stringify([pv.pk, pv.cr, pv.gear]);
      if (!force && k === key) return;
      key = k;
      const pk = pv.pk || {}, gear = pv.gear || {};
      const recipes = Object.entries(RECIPES).map(([id, r]) => {
        const can = Math.min(...Object.entries(r.in).map(([g, n]) => Math.floor((pk[g] || 0) / n)), Math.floor(pv.cr / r.fee));
        return `<div class="wk-card ${can > 0 ? 'ready' : ''}"><h4>${esc(GOODS[id].name)}</h4><p>${esc(GOODS[id].desc)}</p>
          <div class="need">${needList(r.in, pk)}<span>Bench fee ${r.fee}cr</span></div>
          <div class="row"><span>You carry ${pk[id] || 0}</span><span><button data-r="${id}" data-n="1" ${can > 0 ? '' : 'disabled'}>Make 1</button><button data-r="${id}" data-n="${Math.max(1, can)}" ${can > 1 ? '' : 'disabled'}>Make ${Math.max(2, can)}</button></span></div></div>`;
      }).join('');
      const upgrades = UPGRADE_ORDER.map((id) => {
        const U = UPGRADES[id], t = gear[id] || 0, next = U.tiers[t];
        const pips = `<span class="pips" aria-label="Tier ${t} of ${U.tiers.length}">${U.tiers.map((_, i) => `<i class="${i < t ? 'on' : ''}"></i>`).join('')}</span>`;
        const now = t ? `<div class="fx">Fitted: ${esc(U.tiers[t - 1].fx)}</div>` : '';
        if (!next) return `<div class="wk-card"><h4>${esc(U.name)} ${pips}</h4><p>${esc(U.desc)}</p>${now}<div class="row"><span>Top tier reached</span></div></div>`;
        const ready = Object.entries(next.cost).every(([g, n]) => (pk[g] || 0) >= n) && pv.cr >= next.cr;
        return `<div class="wk-card ${ready ? 'ready' : ''}"><h4>${esc(U.name)} ${pips}</h4><p>${esc(U.desc)}</p>${now}
          <div class="need">${needList(next.cost, pk)}<span class="${pv.cr >= next.cr ? 'ok' : 'no'}">${next.cr}cr</span></div>
          <div class="row"><span class="fx">Tier ${t + 1}: ${esc(next.fx)}</span><button data-u="${id}" ${ready ? '' : 'disabled'}>Fit tier ${t + 1}</button></div></div>`;
      }).join('');
      this.el['modal-body'].innerHTML = `<h2>${esc(M.title)}</h2><p class="sub">${esc(M.name)} turns raw goods into parts, and parts into better gear. Buy what you're missing at the exchange.</p>
        <div class="mk-head"><span>You have <b>${pv.cr.toLocaleString()}cr</b></span><span>Pack <b>${packCount(pk)}/${pv.cap}</b></span></div>
        ${this.packLine(pv)}
        <div class="wk"><div><h3 class="sec">Make parts</h3><div class="wk-grid">${recipes}</div></div><div><h3 class="sec">Upgrade what you own</h3><div class="wk-grid">${upgrades}</div></div></div>`;
      this.el['modal-body'].querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { send({ t: 'craft', r: b.dataset.r, n: +b.dataset.n }); setTimeout(() => render(true), 200); }));
      this.el['modal-body'].querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', () => { send({ t: 'upg', k: b.dataset.u }); setTimeout(() => render(true), 200); }));
    };
    this.openModal('', onClose);
    render(true);
    clearInterval(this._wkT);
    this._wkT = setInterval(() => { if (!this.modalOpen || !this.el['modal-body'].querySelector('.wk')) { clearInterval(this._wkT); return; } render(); }, 500);
  }
  xpGain(n) {
    if (!n) return;
    const box = this.el['xp-pops'];
    // merge bursts that land together (a kill and its silent bonus) into one number
    const last = box.lastElementChild;
    if (last && performance.now() - last._t < 350) { last._n += n; last.textContent = `+${last._n} XP`; return; }
    const e = document.createElement('div');
    e.className = 'xp-pop';
    e._t = performance.now(); e._n = n;
    e.textContent = `+${n} XP`;
    box.appendChild(e);
    setTimeout(() => e.remove(), 1500);
    while (box.children.length > 4) box.firstElementChild.remove();
  }

  // Career: level, the advanced class (a one-way choice), its two branches, and which
  // unlocked abilities sit on Q, F, X and Z
  openCareer(getPv, getLp, send, onClose) {
    let key = '';
    let confirm = null; // { kind: 'adv' | 'reset', id }
    const abList = (abs) => abs.map((a) => `<span>${esc(a.name)}${a.lv > 1 ? ` <em>Lv ${a.lv}</em>` : ''}</span>`).join('');
    const render = (force) => {
      const pv = getPv(), lp = getLp();
      if (!pv || !lp) return;
      const k = JSON.stringify([pv.lv, pv.xp, pv.adv, pv.br, pv.cr >= BRANCH_RESET_COST, lp.cls, lp.slots, confirm]);
      if (!force && k === key) return;
      key = k;
      const cls = lp.cls, B = CLASSES[cls];
      const top = pv.lv >= LEVELS.max;
      let html = `<div class="career"><h2>Career</h2>
        <div class="lvline"><b>Level ${pv.lv}</b><span>${top ? 'Top level reached' : `${pv.xp.toLocaleString()} / ${pv.xpn.toLocaleString()} XP to level ${pv.lv + 1}`}</span></div>
        <div class="bigxp"><div style="width:${top ? 100 : clamp(pv.xp / (pv.xpn || 1), 0, 1) * 100}%"></div></div>
        <p class="sub">Every level adds ${LEVELS.hpPer} health and shortens cooldowns a little. Earn experience from jobs, takedowns (more if nobody saw), slicing, sabotage, revives, gathering and crafting.</p>`;
      // ---- class
      html += '<h3 class="sec">Class</h3><div class="adv-grid">';
      if (!pv.adv) {
        const open = pv.lv >= LEVELS.advancedAt;
        html += `<div class="adv-card on"><h3>${esc(B.name)}</h3><div class="role">${esc(B.role)}</div><p>${esc(B.desc || '')}</p><div class="ab">${abList(abilityPool(cls))}</div><div class="role">Your class now. Until you take an advanced class you can switch classes freely from the start screen.</div></div>`;
        for (const id of advancedFor(cls)) {
          const A = ADVANCED[id];
          const perks = [];
          if (A.hp) perks.push(`+${A.hp} health`);
          if (A.weaponName) perks.push(esc(A.weaponName));
          const asking = confirm && confirm.kind === 'adv' && confirm.id === id;
          html += `<div class="adv-card"><h3>${esc(A.name)}</h3><div class="role">${esc(A.role)}${perks.length ? ' — ' + perks.join(', ') : ''}</div><p>${esc(A.desc)}</p><div class="ab">${abList(Object.values(A.abilities).map((a) => ({ ...a, lv: LEVELS.advancedAt })))}</div>
            ${asking ? `<div class="warn-lock" role="alert"><b>This is permanent.</b> Becoming a ${esc(A.name)} locks this character in as a ${esc(B.name)}–${esc(A.name)} for good. You won't be able to switch classes again, and you can't go back to plain ${esc(B.name)}.</div>
              <div class="btn-row"><button data-adv="${id}">Lock in as ${esc(A.name)}</button><button class="ghosty" data-cancel>Cancel</button></div>`
            : `<button data-ask-adv="${id}" ${open ? '' : 'disabled'}>${open ? `Become a ${esc(A.name)}…` : `Opens at level ${LEVELS.advancedAt}`}</button>`}</div>`;
        }
      } else {
        const A = ADVANCED[pv.adv];
        html += `<div class="adv-card on"><h3>${esc(A.name)}</h3><div class="role">${esc(B.name)} — locked in for this character</div><p>${esc(A.desc)}</p></div>`;
      }
      html += '</div>';
      // ---- branches
      if (pv.adv) {
        const A = ADVANCED[pv.adv];
        const open = pv.lv >= LEVELS.branchAt;
        html += `<h3 class="sec">Path</h3><p class="sub">At level ${LEVELS.branchAt} a ${esc(A.name)} takes one of two paths, each with its own perk, look and two abilities. You can reset back to ${esc(A.name)} for ${BRANCH_RESET_COST.toLocaleString()}cr and take the other one.</p><div class="adv-grid">`;
        for (const id of branchesFor(pv.adv)) {
          const R = BRANCHES[id];
          const on = pv.br === id;
          let foot;
          if (on) {
            const asking = confirm && confirm.kind === 'reset';
            foot = asking ? `<div class="warn-lock" role="alert">Reset to ${esc(A.name)} for <b>${BRANCH_RESET_COST.toLocaleString()}cr</b>? You'll lose ${esc(R.name)}'s abilities until you pick a path again.</div><div class="btn-row"><button data-reset ${pv.cr >= BRANCH_RESET_COST ? '' : 'disabled'}>${pv.cr >= BRANCH_RESET_COST ? 'Pay and reset' : `You have ${pv.cr.toLocaleString()}cr`}</button><button class="ghosty" data-cancel>Cancel</button></div>`
              : `<div class="role">Your path now</div><button class="ghosty" data-ask-reset>Reset to ${esc(A.name)}…</button>`;
          } else if (pv.br) foot = '<div class="role">Reset your path to take this one</div>';
          else foot = `<button data-branch="${id}" ${open ? '' : 'disabled'}>${open ? `Become a ${esc(R.name)}` : `Opens at level ${LEVELS.branchAt}`}</button>`;
          html += `<div class="adv-card ${on ? 'on' : ''}"><h3>${esc(R.name)}</h3><div class="role">${esc(R.role)}${R.hp ? ` — +${R.hp} health` : ''}</div><p>${esc(R.desc)}</p><div class="ab">${abList(R.abilities)}</div>${foot}</div>`;
        }
        html += '</div>';
      }
      // ---- loadout
      const pool = abilityPool(cls, pv.adv, pv.br);
      const unlocked = pool.filter((a) => a.lv <= pv.lv);
      const slots = lp.slots || effectiveClass(cls, pv.adv, pv.br).abilities && Object.fromEntries(Object.entries(effectiveClass(cls, pv.adv, pv.br).abilities).map(([k2, a]) => [k2, a.id]));
      const keys = pv.adv ? SLOTS : SLOTS.slice(0, 3);
      html += `<h3 class="sec">Abilities</h3><p class="sub">Choose what sits on each key.${pv.adv ? '' : ` A fourth key, Z, opens with your advanced class.`}</p><div class="loadout">`;
      for (const k2 of keys) {
        html += `<label><kbd>${k2.toUpperCase()}</kbd><select data-slot="${k2}"><option value="">Empty</option>${unlocked.map((a) => `<option value="${a.id}" ${slots && slots[k2] === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`;
      }
      const later = pool.filter((a) => a.lv > pv.lv);
      html += '</div>';
      if (later.length) html += `<p class="sub">Still to unlock: ${later.map((a) => `${esc(a.name)} (level ${a.lv})`).join(', ')}.</p>`;
      html += '</div>';
      const body = this.el['modal-body'];
      body.innerHTML = html;
      body.querySelectorAll('[data-ask-adv]').forEach((b) => b.addEventListener('click', () => { confirm = { kind: 'adv', id: b.dataset.askAdv }; render(true); }));
      body.querySelectorAll('[data-adv]').forEach((b) => b.addEventListener('click', () => { confirm = null; send({ t: 'adv', id: b.dataset.adv }); setTimeout(() => render(true), 250); }));
      body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => { confirm = null; render(true); }));
      body.querySelectorAll('[data-branch]').forEach((b) => b.addEventListener('click', () => { send({ t: 'branch', id: b.dataset.branch }); setTimeout(() => render(true), 250); }));
      body.querySelectorAll('[data-ask-reset]').forEach((b) => b.addEventListener('click', () => { confirm = { kind: 'reset' }; render(true); }));
      body.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => { confirm = null; send({ t: 'branch', reset: 1 }); setTimeout(() => render(true), 250); }));
      body.querySelectorAll('[data-slot]').forEach((sel) => sel.addEventListener('change', () => {
        const next = { ...(slots || {}) };
        const k2 = sel.dataset.slot, id = sel.value || null;
        // picking an ability that's already on another key swaps the two
        const other = SLOTS.find((o) => o !== k2 && next[o] === id && id);
        if (other) next[other] = next[k2] || null;
        next[k2] = id;
        send({ t: 'slots', s: next });
        setTimeout(() => render(true), 250);
      }));
    };
    this.openModal('', onClose);
    render(true);
    clearInterval(this._cvT);
    this._cvT = setInterval(() => { if (!this.modalOpen || !this.el['modal-body'].querySelector('.career')) { clearInterval(this._cvT); return; } if (document.activeElement && document.activeElement.tagName === 'SELECT') return; render(); }, 400);
  }

  // The Wayfarer's ramp: restock, call your speeder, or go aboard
  openShipMenu(getPv, send, onClose) {
    let key = '';
    const render = (force) => {
      const pv = getPv();
      if (!pv) return;
      if (!pv.rq) { this.closeModal(); return; } // walked away from the ramp
      const k = JSON.stringify([pv.rq, pv.scd, pv.sp, pv.fs, pv.cr]);
      if (!force && k === key) return;
      key = k;
      const [gr, md, cost, other] = pv.rq;
      const C = this.C || CLASSES.soldier;
      const need = [gr && `${gr} ${C.throwable ? C.throwable.toLowerCase() : 'thermal charges'}`, md && `${md} ${C.consumable ? C.consumable.toLowerCase() : 'medpacks'}`, other && 'mines and knives'].filter(Boolean);
      const full = !gr && !md && !other;
      this.el['modal-body'].innerHTML = `<div class="ship-menu"><h2>${esc(SHIP.name)}</h2><p class="sub">The ${esc(SHIP.model)} is your crew's home base. Everything here is yours.</p>
        <div class="ship-grid">
          <div class="ship-card ${pv.fs ? 'fresh' : ''}"><h3>Call your speeder</h3>
            ${pv.fs ? '<div class="new">New: your own speeder bike rides in the hold.</div>' : ''}
            <p>${pv.scd ? `Your last one was wrecked. The crew chief needs ${pv.scd}s to patch up another.` : pv.sp ? "It's already out. Calling it again brings it back to the ramp." : 'Rolls down the ramp in your colours, with your speeder tune fitted. Town speeders belong to townsfolk — taking one is theft.'}</p>
            <button data-call ${pv.scd ? 'disabled' : ''}>${pv.sp ? 'Bring it back here' : 'Call the speeder'}</button></div>
          <div class="ship-card"><h3>Restock</h3>
            <p>${full ? "You're fully stocked." : `Top up ${need.join(', ')} from the ship's lockers.`} ${cost ? `Charges and meds are ${cost}cr in all; mines and knives are free.` : ''}</p>
            <button data-refill ${full || pv.cr < cost ? 'disabled' : ''}>${full ? 'Fully stocked' : cost ? `Restock (${cost}cr)` : 'Restock'}</button></div>
          <div class="ship-card"><h3>Go aboard</h3><p>Board to fly to another world. The whole crew has to be aboard before you can leave.</p><button data-board>Board the ${esc(SHIP.name)}</button></div>
        </div></div>`;
      const b = this.el['modal-body'];
      b.querySelector('[data-call]').addEventListener('click', () => { send({ t: 'callspeeder' }); this.closeModal(); });
      b.querySelector('[data-refill]').addEventListener('click', () => { send({ t: 'refill' }); setTimeout(() => render(true), 250); });
      b.querySelector('[data-board]').addEventListener('click', () => { send({ t: 'boardship' }); this.closeModal(); });
    };
    this.openModal('', onClose);
    render(true);
    clearInterval(this._shT);
    this._shT = setInterval(() => { if (!this.modalOpen || !this.el['modal-body'].querySelector('.ship-menu')) { clearInterval(this._shT); return; } render(); }, 400);
  }

  openModal(html, onClose) {
    this.el['modal-body'].innerHTML = html;
    this.el.modal.classList.remove('hidden');
    this.modalOpen = onClose || (() => {});
  }
  closeModal() {
    if (!this.modalOpen) return;
    this.el.modal.classList.add('hidden');
    const cb = this.modalOpen;
    this.modalOpen = null;
    cb();
  }
}
