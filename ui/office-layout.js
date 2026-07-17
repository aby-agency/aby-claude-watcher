// ui/office-layout.js — logique pure de la vue office v2 : une mini-pièce
// par session (pièces-cartes). Géométrie adaptative (base 7×5, +1 colonne si
// subagents, +2 rangées si workflow actif), machine d'activité, chemins en L.
// Aucune dépendance DOM/canvas → testable en node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfficeLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Pièce adaptative : base 7×5, +1 colonne si subagents, +2 rangées si workflow actif.
  const BASE_COLS = 7, BASE_ROWS = 5;
  const DESK_CHAR = { tx: 2, ty: 1 };
  const DOOR = { tx: 5, ty: 1 };
  const COFFEE = { tx: 2, ty: 4 };
  const POSTER = { tx: 2, ty: 0 };
  const DESK = { tx: 1, ty: 2 };
  const COFFEE_MACHINE = { tx: 1, ty: 4 };
  const PLANT = { tx: 5, ty: 4 };
  const PAPERS = [{ tx: 3, ty: 3 }, { tx: 2, ty: 2 }];
  const FLOOR_WOOD = [{ tx: 1, ty: 3 }, { tx: 2, ty: 3 }, { tx: 1, ty: 4 }, { tx: 2, ty: 4 }];
  const SIDE_SEATS = [{ tx: 6, ty: 1 }, { tx: 6, ty: 3 }];
  const MEETING_SEATS = [{ tx: 2, ty: 5 }, { tx: 4, ty: 5 }, { tx: 2, ty: 6 }, { tx: 4, ty: 6 }];
  const MEETING_TABLE = { tx: 3, ty: 5 };
  const MAX_SUBS = 2;

  function createState() { return { actors: new Map() }; }

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

  // Total `running` des workflows de la session, dédup par runId.
  function workflowRunning(session) {
    const seen = new Map();
    for (const w of session.workflows || []) {
      if (w.running > 0 && !seen.has(w.runId)) seen.set(w.runId, w.running);
    }
    let n = 0;
    for (const v of seen.values()) n += v;
    return n;
  }

  function roomFor(session) {
    const subs = (session.subagents || []).length;
    const hasSubs = subs > 0;
    const hasMeeting = workflowRunning(session) > 0;
    const cols = hasSubs ? BASE_COLS + 1 : BASE_COLS;
    const rows = hasMeeting ? BASE_ROWS + 2 : BASE_ROWS;
    const zones = {
      door: { ...DOOR },
      deskChar: { ...DESK_CHAR },
      coffee: { ...COFFEE },
      sideSeats: SIDE_SEATS.map(p => ({ ...p })),
      meetingSeats: hasMeeting ? MEETING_SEATS.map(p => ({ ...p })) : [],
      subOverflow: Math.max(0, subs - MAX_SUBS),
    };

    const statics = [];
    for (let x = 0; x < cols; x++) statics.push({ frame: 'wall', tx: x, ty: 0 });
    for (let y = 1; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const wood = FLOOR_WOOD.some(p => p.tx === x && p.ty === y);
        statics.push({ frame: wood ? 'floorWood' : 'floor', tx: x, ty: y });
      }
    }
    statics.push({ frame: 'door', tx: DOOR.tx, ty: 0 });   // marqueur programmatique
    statics.push({ frame: 'poster', tx: POSTER.tx, ty: POSTER.ty });
    statics.push({ frame: 'desk', tx: DESK.tx, ty: DESK.ty });
    statics.push({ frame: 'deskSetup', tx: DESK.tx, ty: DESK.ty, screen: session.sessionId });
    statics.push({ frame: 'coffeeMachine', tx: COFFEE_MACHINE.tx, ty: COFFEE_MACHINE.ty });
    statics.push({ frame: 'plant', tx: PLANT.tx, ty: PLANT.ty });
    for (let i = 0; i < Math.min(subs, MAX_SUBS); i++) {
      statics.push({ frame: 'sideDesk', tx: SIDE_SEATS[i].tx, ty: SIDE_SEATS[i].ty + 1 });
    }
    if (hasMeeting) statics.push({ frame: 'meetingTable', tx: MEETING_TABLE.tx, ty: MEETING_TABLE.ty });
    if (session.state && session.state.name === 'error') {
      statics.push({ frame: '_papers', tx: PAPERS[0].tx, ty: PAPERS[0].ty });
      statics.push({ frame: '_papers', tx: PAPERS[1].tx, ty: PAPERS[1].ty });
    }
    return { cols, rows, statics, zones };
  }

  function pathTo(from, to) {
    const path = [];
    let { tx, ty } = from;
    while (tx !== to.tx) { tx += Math.sign(to.tx - tx); path.push({ tx, ty }); }
    while (ty !== to.ty) { ty += Math.sign(to.ty - ty); path.push({ tx, ty }); }
    return path;
  }

  function targetFor(activity, zones) {
    if (activity === 'coffee') return zones.coffee;
    if (activity === 'leave') return zones.door;
    return zones.deskChar;
  }

  function retarget(actor, target) {
    if (!target) return;
    const last = actor.path.length ? actor.path[actor.path.length - 1] : { tx: actor.tx, ty: actor.ty };
    if (last.tx === target.tx && last.ty === target.ty) return;
    actor.path = pathTo({ tx: actor.tx, ty: actor.ty }, target);
  }

  function syncSession(state, session) {
    const sid = session.sessionId;
    const zones = roomFor(session).zones;
    const activity = activityFor(session.state && session.state.name);

    let actor = state.actors.get(sid);
    if (!actor) {
      actor = { id: sid, sessionId: sid, kind: 'session',
                charIdx: charIndexFor(session.projectName), activity,
                tx: zones.door.tx, ty: zones.door.ty, path: [], dir: 'down',
                animFrame: 0, done: false };
      state.actors.set(sid, actor);
      retarget(actor, targetFor(activity, zones));
    } else if (actor.activity !== activity) {
      actor.activity = activity;
      actor.animFrame = 0;
      actor.done = false;   // session ressuscitée avant suppression : annule un `leave` en cours
      if (activity === 'down') actor.path = [];   // un perso en erreur ne marche pas
      else retarget(actor, targetFor(activity, zones));
    }

    // Subagents : max MAX_SUBS acteurs assis aux sièges latéraux.
    const wanted = new Set();
    (session.subagents || []).slice(0, MAX_SUBS).forEach((sub, i) => {
      const aid = `${sid}:sub:${sub.agentId}`;
      wanted.add(aid);
      if (!state.actors.has(aid)) {
        state.actors.set(aid, { id: aid, sessionId: sid, kind: 'subagent',
          charIdx: charIndexFor(sub.agentId), activity: 'work',
          tx: zones.sideSeats[i].tx, ty: zones.sideSeats[i].ty,
          path: [], dir: 'down', animFrame: 0, done: false });
      }
    });
    // Meeting : min(workflowRunning, 4) sitters.
    const nSeats = Math.min(workflowRunning(session), MEETING_SEATS.length);
    for (let i = 0; i < nSeats; i++) {
      const aid = `${sid}:wf:${i}`;
      wanted.add(aid);
      if (!state.actors.has(aid)) {
        const seat = MEETING_SEATS[i];
        state.actors.set(aid, { id: aid, sessionId: sid, kind: 'meeting',
          charIdx: (charIndexFor(sid) + i + 1) % 10, activity: 'work',
          tx: seat.tx, ty: seat.ty, path: [], dir: seat.ty === 5 ? 'down' : 'up',
          animFrame: 0, done: false });
      }
    }
    // Subs/meeting de cette session qui ne sont plus voulus → suppression.
    for (const [aid, a] of state.actors) {
      if (a.sessionId === sid && a.kind !== 'session' && !wanted.has(aid)) state.actors.delete(aid);
    }
  }

  // Sessions absentes de liveIds : le perso principal sort ; subs/meeting
  // disparaissent immédiatement. Les acteurs done sont supprimés par l'appelant.
  function purge(state, liveIds) {
    for (const [aid, a] of state.actors) {
      if (liveIds.has(a.sessionId)) continue;
      if (a.kind !== 'session') { state.actors.delete(aid); continue; }
      if (a.activity !== 'leave') {
        a.activity = 'leave';
        retarget(a, { tx: DOOR.tx, ty: DOOR.ty });
      }
    }
  }

  function actorsFor(state, sessionId) {
    return [...state.actors.values()]
      .filter(a => a.sessionId === sessionId)
      .sort((a, b) => a.ty - b.ty);
  }

  function tickActor(actor, zones) {
    const door = (zones && zones.door) || DOOR;
    if (actor.path.length === 0) {
      if (actor.activity === 'leave' && actor.tx === door.tx && actor.ty === door.ty) {
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
      case 'coffee': return `${c}.idle.left`;  // machine à gauche du point café
      default: return `${c}.idle.down`;
    }
  }

  return { createState, roomFor, syncSession, purge, actorsFor, tickActor,
           animFor, activityFor, charIndexFor, pathTo, workflowRunning,
           BASE_COLS, BASE_ROWS };
});
