// ui/office-layout.js — logique pure de la vue office v2 : une mini-pièce
// par session (pièces-cartes). Géométrie adaptative (base 7×5, +1 colonne si
// subagents, +2 rangées si workflow actif), machine d'activité, chemins en L.
// Aucune dépendance DOM/canvas → testable en node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfficeLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Pièce adaptative : base 6×5 (v2.4, cubicle dense), +1 colonne si
  // subagents, +2 rangées si workflow actif.
  //
  // v2.4 visait 6×4 (une rangée en moins) : proposition du plan tentée
  // sérieusement (cf. rapport task-2), abandonnée — sur 4 rangées, seules 3
  // sont des rangées de sol utilisables (ty 1..3, ty 0 = mur), et les 2
  // sièges subagents ont chacun besoin d'une rangée-table au nord (seat.ty-1).
  // Avec seulement 3 rangées de sol, tout choix de 2 sièges non adjacents
  // pousse une des deux tables sur la rangée mur (ty 0, visuellement une
  // chaise/laptop encastrée dans le mur) ; tout choix de sièges adjacents fait
  // coïncider la table de l'un avec le siège de l'autre (collision de tuile
  // réelle, pas seulement esthétique). 6×5 restaure la 4e rangée de sol et
  // supprime les deux problèmes d'un coup, en gardant la densité (colonne en
  // moins + mobilier ajouté : lampe, papiers, tableau blanc) — voir schéma
  // dans le rapport.
  const BASE_COLS = 6, BASE_ROWS = 5;
  // Vue par-dessus l'épaule : le perso est au SUD de son bureau (1,2), dos au
  // spectateur, face à l'écran qui lui fait face plein sud. Colonne 1 (pas 2)
  // pour ne pas s'aligner avec le café (2,4) : sinon le perso debout au café
  // (tx2, 1 rangée sous ty3) recouvre la chaise vide en visuel.
  const DESK_CHAR = { tx: 1, ty: 3 };
  const DOOR = { tx: 4, ty: 1 };
  const COFFEE = { tx: 2, ty: 4 };
  // Tableau blanc mural (densité v2.4, remplace l'ancien poster) : sprite
  // 30×23 (~2 tuiles de large), ancré tx=1 pour déborder visuellement sur
  // tx=2, au-dessus du bureau.
  const WHITEBOARD = { tx: 1, ty: 0 };
  const DESK = { tx: 1, ty: 2 };
  // Décalée en colonne 0 (pas 1, sous le siège) : sinon la machine (poussée
  // vers le haut) et la chaise (poussée vers le bas) se chevauchent en pixels.
  const COFFEE_MACHINE = { tx: 0, ty: 4 };
  // Colonne 4 (pas 5) : la colonne 5 est celle des sièges subagents
  // (SIDE_SEATS[1] = (5,4)) — sinon la plante et le 2e subagent assis
  // occupent la même tuile quand 2 subagents sont actifs.
  const PLANT = { tx: 4, ty: 4 };
  const PAPERS = [{ tx: 3, ty: 3 }, { tx: 2, ty: 2 }];
  const FLOOR_WOOD = [{ tx: 0, ty: 3 }, { tx: 1, ty: 3 }, { tx: 2, ty: 3 },
                       { tx: 0, ty: 4 }, { tx: 1, ty: 4 }, { tx: 2, ty: 4 }];
  // Sièges subagents = position du perso (SUD de sa table, cf. push table ty-1 plus bas).
  const SIDE_SEATS = [{ tx: 5, ty: 2 }, { tx: 5, ty: 4 }];
  const CHAIR_FRAME = 'chairFront';   // dossier au sud du perso dos-au-spectateur : chairFront lit mieux ici
  const CHAIR_DY = 3;    // décale la chaise vers le bas pour que le dossier dépasse sous le perso (côté spectateur)
  const COFFEE_DY = -3;   // pose la tasse sur le comptoir sans qu'elle déborde de sa tuile
  // Densité bureau (v2.4) : lampe + papiers posés sur le bureau, tous deux
  // côté tx=DESK.tx (le tx=DESK.tx+1 reste libre pour l'indicateur d'état
  // dessiné sur le "moniteur droit", cf. office.js). dy négatif = lampe qui
  // dépasse au-dessus du plan de travail ; dy positif = papiers posés à
  // l'avant du bureau, côté chaise. Valeurs de départ raisonnables — le
  // réglage pixel-perfect se fait au rendu (Task 3).
  const DESK_LAMP_DY = -4;
  const PAPERS_DESK_DY = 3;
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
    statics.push({ frame: 'whiteboard', tx: WHITEBOARD.tx, ty: WHITEBOARD.ty });
    statics.push({ frame: 'desk', tx: DESK.tx, ty: DESK.ty });
    statics.push({ frame: 'deskSetup', tx: DESK.tx, ty: DESK.ty, screen: session.sessionId });
    statics.push({ frame: 'deskLamp', tx: DESK.tx, ty: DESK.ty, dy: DESK_LAMP_DY });
    statics.push({ frame: 'papersDesk', tx: DESK.tx, ty: DESK.ty, dy: PAPERS_DESK_DY });
    statics.push({ frame: CHAIR_FRAME, tx: DESK_CHAR.tx, ty: DESK_CHAR.ty, dy: CHAIR_DY });
    statics.push({ frame: 'sideDesk', tx: COFFEE_MACHINE.tx, ty: COFFEE_MACHINE.ty });   // comptoir sous la tasse
    statics.push({ frame: 'coffeeMachine', tx: COFFEE_MACHINE.tx, ty: COFFEE_MACHINE.ty, dy: COFFEE_DY });
    statics.push({ frame: 'plant', tx: PLANT.tx, ty: PLANT.ty });
    // Note géométrie : la table du 2e subagent (SIDE_SEATS[1].ty - 1 = 3)
    // atterrit sur CORRIDOR_TY (3), colonne 6 — inoffensif aujourd'hui car
    // routeTo() n'est utilisé que pour le perso principal (kind: 'session'),
    // dont les cibles restent tx∈{1,2,5} ; les subagents ne marchent jamais
    // (posés directement à leur siège, jamais de path). À réévaluer si
    // MAX_SUBS augmente ou si les subagents se mettent à se déplacer.
    for (let i = 0; i < Math.min(subs, MAX_SUBS); i++) {
      const seat = SIDE_SEATS[i];
      statics.push({ frame: 'sideDesk', tx: seat.tx, ty: seat.ty - 1 });
      statics.push({ frame: 'laptop', tx: seat.tx, ty: seat.ty - 1 });
      statics.push({ frame: CHAIR_FRAME, tx: seat.tx, ty: seat.ty, dy: CHAIR_DY });
    }
    if (hasMeeting) statics.push({ frame: 'meetingTable', tx: MEETING_TABLE.tx, ty: MEETING_TABLE.ty });
    if (session.state && session.state.name === 'error') {
      statics.push({ frame: '_papers', tx: PAPERS[0].tx, ty: PAPERS[0].ty });
      statics.push({ frame: '_papers', tx: PAPERS[1].tx, ty: PAPERS[1].ty });
    }
    return { cols, rows, statics, zones };
  }

  // Primitive : L horizontal-d'abord puis vertical. Ne PAS l'utiliser pour
  // les trajets du perso principal (porte/chaise/café) — sur cette géométrie
  // ça traverse le bureau (1,2)-(2,2). Gardée pour composer / usages futurs.
  function pathTo(from, to) {
    const path = [];
    let { tx, ty } = from;
    while (tx !== to.tx) { tx += Math.sign(to.tx - tx); path.push({ tx, ty }); }
    while (ty !== to.ty) { ty += Math.sign(to.ty - ty); path.push({ tx, ty }); }
    return path;
  }

  // Rangée libre au sud du bureau (desk/deskSetup occupent ty=2). Porte
  // (5,1), chaise (1,3) et café (2,4) sont tous accessibles depuis cette
  // rangée sans traverser le bureau ni la plante (5,4).
  const CORRIDOR_TY = 3;

  // Routage en couloir : vertical jusqu'à CORRIDOR_TY, horizontal le long de
  // cette rangée, puis vertical jusqu'à la cible. Chaque segment vide est
  // sauté (aucune tuile poussée si déjà aligné). Remplace pathTo pour tous
  // les trajets du perso principal (porte↔chaise↔café) afin de contourner
  // le bureau (1,2)/(2,2) au lieu de le traverser.
  function routeTo(from, to) {
    const path = [];
    let { tx, ty } = from;
    while (ty !== CORRIDOR_TY) { ty += Math.sign(CORRIDOR_TY - ty); path.push({ tx, ty }); }
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
    actor.path = routeTo({ tx: actor.tx, ty: actor.ty }, target);
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
      case 'work':
      case 'think':
        // Au bureau (perso principal / subagent) : dos au spectateur, face à l'écran.
        // Les assis en réunion (kind 'meeting') gardent idle.down (autour de la table).
        return actor.kind === 'meeting' ? `${c}.idle.down` : `${c}.idle.up`;
      default: return `${c}.idle.down`;
    }
  }

  // --- Émotes (bulle au-dessus du perso principal) -------------------------
  // Priorité : enveloppe (bell active) > émote d'état > émote d'outil (running).
  // `emoteFor` est PURE : bellActive est fourni par l'appelant (Task 3 lit
  // `activeBells`, une Map de renderer.js) — cette fonction n'accède à aucun
  // état global ni horloge.
  //
  // Choix "waiting long" (zzz) : la session telle qu'elle arrive ici est
  // celle sérialisée par `serializeSession()` dans main.js (sessionId,
  // projectName, state, lastTool, model, gitBranch, startedAt, tokens, cwd,
  // isBackground, notifEnabled, subagents, workflows) — AUCUN timestamp
  // d'entrée d'état n'y figure. `watcher.js` a bien un `session.lastEventTime`
  // interne, mais il est strippé par `serializeSession` avant d'atteindre le
  // renderer/UI (vérifié : grep ne le trouve nulle part côté ui/*.js), et
  // `startedAt` est l'heure de démarrage de la session entière, pas l'heure
  // d'entrée dans l'état waiting. Sans signal fiable exposé jusqu'ici,
  // `waiting` retombe systématiquement sur `emote.zzz` (pas de distinction
  // waiting-frais / waiting-inactif à ce stade — dette documentée, à
  // reprendre si un `state.since` est un jour exposé côté serialization).
  const STATE_EMOTES = {
    thinking: 'emote.think',
    pending: 'emote.alert',
    error: 'emote.angry',
    waiting: 'emote.zzz',
  };

  // Mapping outil → émote, valable uniquement en `running` (lastTool n'a de
  // sens que là). mcp__* et tout outil inconnu/absent retombent sur
  // l'engrenage générique.
  function toolEmote(toolName) {
    switch (toolName) {
      case 'Bash':
      case 'BashOutput': return 'emote.tool.terminal';
      case 'Read':
      case 'Grep':
      case 'Glob': return 'emote.tool.search';
      case 'Edit':
      case 'Write':
      case 'NotebookEdit': return 'emote.tool.write';
      case 'WebFetch':
      case 'WebSearch': return 'emote.tool.web';
      case 'Task': return 'emote.tool.agents';
      default: return 'emote.tool.gear';   // mcp__*, inconnu, absent
    }
  }

  function emoteFor(session, bellActive) {
    if (bellActive) return 'emote.mail';
    const stateName = session && session.state && session.state.name;
    if (stateName === 'running') return toolEmote(session.lastTool);
    if (Object.prototype.hasOwnProperty.call(STATE_EMOTES, stateName)) return STATE_EMOTES[stateName];
    return null;   // état inconnu/absent (ex. acteur subagent, pas de bulle en v1)
  }

  return { createState, roomFor, syncSession, purge, actorsFor, tickActor,
           animFor, activityFor, charIndexFor, pathTo, routeTo, workflowRunning,
           emoteFor, BASE_COLS, BASE_ROWS, DESK, CORRIDOR_TY };
});
