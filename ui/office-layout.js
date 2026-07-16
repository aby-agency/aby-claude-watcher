// ui/office-layout.js — logique pure de la vue office : slots de bureaux,
// dimensionnement de la pièce, acteurs (diff sessions), machine d'activité,
// chemins. Aucune dépendance DOM/canvas → testable en node (pattern ring-gauge).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfficeLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const ROOM_COLS = 16;
  const DESKS_PER_ROW = 3;
  const MAX_DESKS = 16;
  const DESK_CELL_W = 4, DESK_CELL_H = 3;
  const FIRST_DESK = { tx: 1, ty: 2 };

  function createOfficeState() {
    return {
      slots: new Map(),     // sessionId → slotIndex (interactif)
      bgSlots: new Map(),   // sessionId → slotIndex (back-office)
      actors: new Map(),    // actorId → actor
    };
  }

  function charIndexFor(projectName) {
    let h = 0;
    const s = String(projectName || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 10;
  }

  function activityFor(stateName) {
    switch (stateName) {
      case 'thinking': return 'think';
      case 'running': return 'work';
      case 'waiting': return 'coffee';
      case 'pending': return 'call';
      case 'error': return 'down';
      default: return 'work';
    }
  }

  // Attribue le plus petit slot libre ; les slots vivants ne bougent jamais.
  function assignSlots(slotMap, ids, max) {
    for (const id of [...slotMap.keys()]) if (!ids.includes(id)) slotMap.delete(id);
    const used = new Set(slotMap.values());
    let overflow = 0;
    for (const id of ids) {
      if (slotMap.has(id)) continue;
      let s = 0;
      while (used.has(s)) s++;
      if (s >= max) { overflow++; continue; }
      slotMap.set(id, s);
      used.add(s);
    }
    return overflow;
  }

  function deskPos(slot, baseTy) {
    return { tx: FIRST_DESK.tx + (slot % DESKS_PER_ROW) * DESK_CELL_W,
             ty: baseTy + Math.floor(slot / DESKS_PER_ROW) * DESK_CELL_H };
  }

  // Les workflows vivent sur chaque session (s.workflows, cf. renderer.js), pas
  // au niveau du snapshot : on les agrège depuis les sessions interactives ET
  // background (les sessions headless en portent aussi). Un même run peut
  // apparaître sur plusieurs sources (session + top-level rétro-compat) →
  // dédup par runId, première occurrence gagne, pour ne pas doubler `running`.
  function collectWorkflows(snapshot) {
    const byRunId = new Map();
    const add = (w) => {
      const key = w && w.runId != null ? w.runId : w; // sans runId : pas de dédup possible
      if (!byRunId.has(key)) byRunId.set(key, w);
    };
    for (const s of snapshot.interactive || []) for (const w of s.workflows || []) add(w);
    for (const s of snapshot.background || []) for (const w of s.workflows || []) add(w);
    for (const w of snapshot.workflows || []) add(w); // rétro-compat si fourni au snapshot
    return [...byRunId.values()].filter(w => w.running > 0);
  }

  function layoutRoom(state, snapshot) {
    const interactive = snapshot.interactive || [];
    const background = snapshot.background || [];
    const workflows = collectWorkflows(snapshot);

    const overflowCount = assignSlots(state.slots, interactive.map(s => s.sessionId), MAX_DESKS);
    const deskCount = state.slots.size;
    const deskRows = Math.max(1, Math.ceil(deskCount / DESKS_PER_ROW)) * DESK_CELL_H;

    const meetingRows = workflows.length > 0 ? 4 : 0;
    const meetingTy = FIRST_DESK.ty + deskRows;

    const bgCount = background.length + overflowCount;
    assignSlots(state.bgSlots, background.map(s => s.sessionId), 99);
    const bgRows = bgCount > 0 ? Math.ceil(Math.max(1, state.bgSlots.size) / DESKS_PER_ROW) * DESK_CELL_H : 0;
    const bgTy = meetingTy + meetingRows;

    const rows = Math.max(8, bgTy + bgRows + 1);

    const zones = {
      door: { tx: 1, ty: 1 },
      coffee: { tx: 13, ty: 3 },
      desks: new Map(),
      backDesks: new Map(),
      meeting: [],
      sideDesks: new Map(),
      overflow: overflowCount,
      meetingTable: workflows.length > 0 ? { tx: 6, ty: meetingTy + 1 } : null,
    };
    for (const [id, slot] of state.slots) zones.desks.set(id, deskPos(slot, FIRST_DESK.ty));
    for (const [id, slot] of state.bgSlots) zones.backDesks.set(id, deskPos(slot, bgTy));
    for (const [id, d] of zones.desks) {
      zones.sideDesks.set(id, [{ tx: d.tx + 3, ty: d.ty }, { tx: d.tx + 3, ty: d.ty + 1 }]);
    }
    if (workflows.length > 0) {
      const t = zones.meetingTable;
      // 6 sièges : 3 au-dessus, 3 en dessous de la table (table 2 tiles de large)
      zones.meeting = [
        { tx: t.tx - 1, ty: t.ty - 1 }, { tx: t.tx, ty: t.ty - 1 }, { tx: t.tx + 1, ty: t.ty - 1 },
        { tx: t.tx - 1, ty: t.ty + 1 }, { tx: t.tx, ty: t.ty + 1 }, { tx: t.tx + 1, ty: t.ty + 1 },
      ];
    }

    // Tiles statiques : murs rangée 0, sols par zone, meubles.
    const statics = [];
    for (let x = 0; x < ROOM_COLS; x++) statics.push({ frame: 'wall', tx: x, ty: 0 });
    for (let y = 1; y < rows; y++) {
      for (let x = 0; x < ROOM_COLS; x++) {
        let frame = 'floor';
        if (y >= bgTy && bgCount > 0) frame = 'floorDark';
        else if (x >= 12 && y <= 4) frame = 'floorWood';
        statics.push({ frame, tx: x, ty: y });
      }
    }
    statics.push({ frame: 'coffeeMachine', tx: 13, ty: 1 }); // rendu animé par office.js
    statics.push({ frame: 'waterCooler', tx: 14, ty: 1 });
    statics.push({ frame: 'plant', tx: 15, ty: 1 });
    statics.push({ frame: 'poster', tx: 4, ty: 0 });
    for (const [id, d] of zones.desks) {
      statics.push({ frame: 'desk', tx: d.tx, ty: d.ty + 1 });
      statics.push({ frame: 'deskSetup', tx: d.tx, ty: d.ty + 1, screen: id }); // screen → lueur d'état
    }
    for (const [, d] of zones.backDesks) statics.push({ frame: 'desk', tx: d.tx, ty: d.ty + 1 });
    if (zones.meetingTable) statics.push({ frame: 'meetingTable', tx: zones.meetingTable.tx, ty: zones.meetingTable.ty });
    statics.push({ frame: 'vending', tx: ROOM_COLS - 1, ty: rows - 1 });

    return { cols: ROOM_COLS, rows, statics, zones };
  }

  // Chemin en L : horizontal d'abord, puis vertical.
  function pathTo(from, to) {
    const path = [];
    let { tx, ty } = from;
    while (tx !== to.tx) { tx += Math.sign(to.tx - tx); path.push({ tx, ty }); }
    while (ty !== to.ty) { ty += Math.sign(to.ty - ty); path.push({ tx, ty }); }
    return path;
  }

  function charPosForDesk(d) { return { tx: d.tx + 1, ty: d.ty }; }

  function targetFor(activity, sessionId, zones) {
    const desk = zones.desks.get(sessionId);
    if (!desk) return null;
    if (activity === 'coffee') return zones.coffee;
    if (activity === 'leave') return zones.door;
    return charPosForDesk(desk);
  }

  function retarget(actor, target) {
    if (!target) return;
    const last = actor.path.length ? actor.path[actor.path.length - 1] : { tx: actor.tx, ty: actor.ty };
    if (last.tx === target.tx && last.ty === target.ty) return; // déjà en route
    actor.path = pathTo({ tx: actor.tx, ty: actor.ty }, target);
  }

  function syncActors(state, snapshot) {
    const zones = layoutRoom(state, snapshot).zones;
    const seen = new Set();

    for (const s of snapshot.interactive || []) {
      if (!zones.desks.has(s.sessionId)) continue; // overflow → pas d'acteur
      seen.add(s.sessionId);
      let actor = state.actors.get(s.sessionId);
      const activity = activityFor(s.state.name);
      if (!actor) {
        actor = { id: s.sessionId, sessionId: s.sessionId, kind: 'session',
                  charIdx: charIndexFor(s.projectName), activity,
                  tx: zones.door.tx, ty: zones.door.ty, path: [], dir: 'down',
                  animFrame: 0, done: false };
        state.actors.set(s.sessionId, actor);
        retarget(actor, targetFor(activity, s.sessionId, zones));
      } else if (actor.activity !== activity) {
        actor.activity = activity;
        actor.animFrame = 0;
        retarget(actor, targetFor(activity, s.sessionId, zones));
      } else if (actor.path.length === 0 && activity !== 'down') {
        // Immobile mais coordonnées périmées (ex : flip background→interactif,
        // ou changement de bureau) → repart marcher vers la bonne case.
        const target = targetFor(activity, s.sessionId, zones);
        if (target && (target.tx !== actor.tx || target.ty !== actor.ty)) retarget(actor, target);
      }
      // Subagents : max 2 acteurs aux side-desks
      const sides = zones.sideDesks.get(s.sessionId) || [];
      const subs = (s.subagents || []).slice(0, 2);
      subs.forEach((sub, i) => {
        const aid = `${s.sessionId}:sub:${sub.agentId}`;
        seen.add(aid);
        if (!state.actors.has(aid) && sides[i]) {
          state.actors.set(aid, { id: aid, sessionId: s.sessionId, kind: 'subagent',
            charIdx: charIndexFor(sub.agentId), activity: 'work',
            tx: sides[i].tx, ty: sides[i].ty, path: [], dir: 'down', animFrame: 0, done: false });
        }
      });
    }

    // Back-office : acteurs statiques au bureau, pas de walk (spawn direct)
    for (const s of snapshot.background || []) {
      const d = zones.backDesks.get(s.sessionId);
      if (!d) continue;
      seen.add(s.sessionId);
      if (!state.actors.has(s.sessionId)) {
        state.actors.set(s.sessionId, { id: s.sessionId, sessionId: s.sessionId, kind: 'session',
          charIdx: charIndexFor(s.projectName), activity: activityFor(s.state.name),
          tx: d.tx + 1, ty: d.ty, path: [], dir: 'down', animFrame: 0, done: false });
      } else {
        const actor = state.actors.get(s.sessionId);
        actor.activity = activityFor(s.state.name);
        if (actor.tx !== d.tx + 1 || actor.ty !== d.ty) {
          // Flip interactif→background : pas de marche en back-office, snap direct.
          actor.tx = d.tx + 1; actor.ty = d.ty; actor.path = [];
        }
      }
    }

    // Réunion : min(total running, 6) acteurs autour de la table
    const running = collectWorkflows(snapshot).reduce((n, w) => n + (w.running || 0), 0);
    const nSeats = Math.min(running, zones.meeting.length);
    for (let i = 0; i < nSeats; i++) {
      const aid = `meeting:${i}`;
      seen.add(aid);
      if (!state.actors.has(aid)) {
        state.actors.set(aid, { id: aid, sessionId: null, kind: 'meeting',
          charIdx: i % 10, activity: 'work',
          tx: zones.meeting[i].tx, ty: zones.meeting[i].ty, path: [], dir: i < 3 ? 'down' : 'up',
          animFrame: 0, done: false });
      }
    }

    // Disparus → leave (sessions) ou suppression immédiate (subs/meeting)
    for (const [id, actor] of state.actors) {
      if (seen.has(id)) continue;
      if (actor.kind === 'session' && actor.activity !== 'leave') {
        actor.activity = 'leave';
        retarget(actor, zones.door);
      } else if (actor.kind !== 'session') {
        state.actors.delete(id);
      } else if (actor.done) {
        state.actors.delete(id);
      }
    }
    return zones;
  }

  // Avance d'une case tous les 2 ticks (compteur interne sur l'acteur).
  function tickActor(actor, zones) {
    if (actor.path.length === 0) {
      if (actor.activity === 'leave' && actor.tx === zones.door.tx && actor.ty === zones.door.ty) {
        actor.done = true;
      }
      return false;
    }
    actor._step = (actor._step || 0) + 1;
    if (actor._step % 2) return false;
    const next = actor.path.shift();
    actor.dir = next.tx > actor.tx ? 'right' : next.tx < actor.tx ? 'left' : next.ty > actor.ty ? 'down' : 'up';
    actor.tx = next.tx; actor.ty = next.ty;
    return true;
  }

  function animFor(actor) {
    const c = `char${actor.charIdx}`;
    if (actor.path.length > 0) return `${c}.walk.${actor.dir}`;
    switch (actor.activity) {
      case 'call': return `${c}.phone.right`;
      case 'down': return `${c}.hurt`;
      case 'coffee': return `${c}.idle.right`;
      default: return `${c}.idle.down`;
    }
  }

  return { createOfficeState, layoutRoom, syncActors, tickActor, animFor,
           activityFor, charIndexFor, pathTo, ROOM_COLS, DESKS_PER_ROW, MAX_DESKS };
});
