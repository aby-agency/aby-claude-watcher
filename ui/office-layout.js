// ui/office-layout.js — logique pure de la vue office v3 : 3 salles PARTAGÉES
// par fonction (Travail/Pause/Recherche). Les persos (stables par projet,
// hash → premade) MIGRENT entre salles selon l'état de leur session, au lieu
// d'avoir chacun leur propre pièce (v2). Slots stables PAR SALLE. Aucune
// dépendance DOM/canvas → testable en node.
//
// Voir docs/superpowers/specs/2026-07-17-office-salles-design.md (fait foi)
// et docs/superpowers/plans/2026-07-17-office-salles.md (géométrie de
// référence, Task 1). Le socle v2 survit : activityFor/animFor (activité),
// emoteFor (bulles, priorités inchangées), charIndexFor, workflowRunning
// (dédup runId), le principe de routage couloir (généralisé par salle).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfficeLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // ─── Constantes partagées ────────────────────────────────────────────────
  // Porte/spawn IDENTIQUES dans les 3 salles (référence du plan) : simplifie
  // la migration (téléporter = ré-apparaître au même tile dans la salle
  // cible, aucune conversion de coordonnées entre salles).
  const DOOR_TILE = { tx: 6, ty: 0 };
  const SPAWN_TILE = { tx: 6, ty: 1 };
  const ROOM_KEYS = ['work', 'break', 'research'];

  // Plafonds de visibilité "recherche" (salle partagée par TOUTES les
  // sessions — contrairement à v2 où le cap de 4 subagents s'appliquait par
  // session). Au-delà : badge « +N » (overflow), cf. roomsFor().
  const MAX_SUBS = 6;
  const MAX_WF = 4;       // 4 sièges autour de la table de réunion (géométrie fixe)
  const MAX_HEADLESS = 4;

  function createState() {
    return { actors: new Map(), slots: { work: new Map(), break: new Map(), research: new Map() } };
  }

  function charIndexFor(projectName) {
    let h = 0;
    const s = String(projectName || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 10;
  }

  // v3 : `waiting` bascule en salle Pause (nouvelle activité `relax`, idle
  // face caméra — il n'y a plus de bureau à regarder). Supersède le choix
  // v2.7 « waiting reste au PC » : ce choix n'avait de sens que dans le
  // modèle une-pièce-par-session ; le concept v3 (validé par Paul,
  // 2026-07-17) demande explicitement que les sessions waiting PARTENT en
  // salle pause.
  function activityFor(stateName) {
    switch (stateName) {
      case 'thinking': return 'think';
      case 'running': return 'work';
      case 'waiting': return 'relax';
      case 'pending': return 'call';
      case 'error': return 'down';
      default: return 'work';
    }
  }

  // Salle cible selon l'état de la session (table du design doc) : Travail
  // = running/thinking/pending/error ; Pause = waiting.
  function roomKeyForState(stateName) {
    return stateName === 'waiting' ? 'break' : 'work';
  }

  // Comptes « logiques » (déduits du snapshot seul, indépendants de tout
  // acteur) — utilisés pour le footer (counter) ET comme moitié basse du
  // max() de réconciliation ci-dessous.
  function logicalRoomCounts(interactive) {
    let work = 0, brk = 0;
    for (const s of interactive) {
      if (roomKeyForState(s.state && s.state.name) === 'work') work++; else brk++;
    }
    return { work, break: brk };
  }

  // Compte de DIMENSIONNEMENT réconcilié (fix reviewer C1) : pendant qu'un
  // perso migre, `logicalRoomCounts` (snapshot) le retire IMMÉDIATEMENT de sa
  // salle d'origine dès que l'état change, alors que physiquement (slots) il
  // continue à l'occuper le temps de marcher jusqu'à la porte. Si `roomsFor`
  // se dimensionne sur le seul compte logique et que le routage (dans
  // `syncActors`/`tickActor`) se dimensionne sur le seul compte physique, la
  // salle RENDUE peut être plus petite que la salle sur laquelle le trajet a
  // été calculé → le perso marche sur des tuiles jamais dessinées (repro
  // reviewer : 3→2 occupants franchit un palier de paires, 8/12 tuiles hors
  // sol rendu). Fix : les DEUX consomment `max(logique, physique)` — la
  // salle ne rétrécit que lorsque le migrant a fini de sortir (slot libéré
  // par tickActor à l'arrivée au spawn, cf. tickActor). `state` optionnel :
  // sans lui (tests de géométrie pure), on retombe sur le compte logique
  // seul.
  function sizingCounts(interactive, state) {
    const logical = logicalRoomCounts(interactive);
    return {
      work: state ? Math.max(logical.work, state.slots.work.size) : logical.work,
      break: state ? Math.max(logical.break, state.slots.break.size) : logical.break,
    };
  }

  // Total `running` des workflows de la session, dédup par runId (inchangé v2).
  function workflowRunning(session) {
    const seen = new Map();
    for (const w of (session && session.workflows) || []) {
      if (w.running > 0 && !seen.has(w.runId)) seen.set(w.runId, w.running);
    }
    let n = 0;
    for (const v of seen.values()) n += v;
    return n;
  }

  // ─── Géométrie : salle Travail ───────────────────────────────────────────
  // cols 8 ; rangée 0 mur+porte(6,0)/spawn(6,1) ; postes en rangées de 2
  // (cellule 4 tuiles : bureau (0,ty)+(4,ty), persos (1,ty+1)/(5,ty+1)) ;
  // rangées ajoutées par PAIRES de postes occupés (rows = 3+2*pairs, min 5).
  // Couloir de circulation = la rangée du BAS (toujours vide, jamais de
  // bureau dessus) : tout trajet du perso principal passe par cette rangée
  // avant de remonter dans sa colonne de poste (1 ou 5 — jamais 0/4, qui sont
  // les colonnes de bureau) → aucune traversée de bureau possible.
  const WORK_COLS = 8;

  function workPairs(n) { return Math.max(1, Math.ceil(n / 2)); }
  function workRoomRows(n) { return Math.max(5, 3 + 2 * workPairs(n)); }
  function workSlotPosition(idx) {
    const p = Math.floor(idx / 2), parity = idx % 2;
    return { tx: parity === 0 ? 1 : 5, ty: 2 + 2 * p };
  }
  // Rangée de circulation : toujours la dernière rangée de la salle (jamais
  // de bureau dessus par construction — les bureaux occupent au plus jusqu'à
  // la rangée 2*pairsRendues-1, la salle a toujours une rangée de plus).
  function routeInRoom(from, to, corridorTy) {
    const path = [];
    let { tx, ty } = from;
    while (ty !== corridorTy) { ty += Math.sign(corridorTy - ty); path.push({ tx, ty }); }
    while (tx !== to.tx) { tx += Math.sign(to.tx - tx); path.push({ tx, ty }); }
    while (ty !== to.ty) { ty += Math.sign(to.ty - ty); path.push({ tx, ty }); }
    return path;
  }
  function routeWork(from, to, occupantCount) {
    return routeInRoom(from, to, workRoomRows(occupantCount) - 1);
  }

  function workRoomStatics(occupantCount) {
    const pairsToRender = workPairs(occupantCount);
    const rows = workRoomRows(occupantCount);
    const statics = [];
    for (let x = 0; x < WORK_COLS; x++) statics.push({ frame: 'wall', tx: x, ty: 0 });
    for (let y = 1; y < rows; y++) for (let x = 0; x < WORK_COLS; x++) statics.push({ frame: 'floor', tx: x, ty: y });
    statics.push({ frame: 'door', tx: DOOR_TILE.tx, ty: DOOR_TILE.ty });
    for (let p = 0; p < pairsToRender; p++) {
      const deskTy = 1 + 2 * p;
      for (const deskTx of [0, 4]) {
        statics.push({ frame: 'desk', tx: deskTx, ty: deskTy });
        statics.push({ frame: 'deskSetup', tx: deskTx, ty: deskTy });
        statics.push({ frame: 'deskLamp', tx: deskTx, ty: deskTy, dy: -4 });
        const charTx = deskTx === 0 ? 1 : 5;
        statics.push({ frame: 'chairOver', tx: charTx, ty: deskTy + 1, dy: 2, z: 'over' });
      }
    }
    return { cols: WORK_COLS, rows, statics };
  }

  // ─── Géométrie : salle Pause ─────────────────────────────────────────────
  // cols 8, rows 5 fixes ; comptoir+tasse (0,1), fontaine (1,1), distributeur
  // (7,1), canapés (2,3)/(5,3), plantes (7,4)/(0,4) ; porte(6,0)/spawn(6,1).
  // Places debout/assises : (2,2),(4,2),(6,2),(1,3),(4,3),(6,3)… extensible
  // par rangées de 6 sièges au-delà de la base.
  //
  // Écart voulu (±1 tuile, latitude Task 1) à la lettre du plan : les blocs
  // de rangées AJOUTÉS (au-delà de la base 5 rangées) réutilisent le motif
  // sûr [1,4,6] pour les DEUX rangées du bloc, au lieu d'alterner avec
  // [2,4,6]. Motif vérifié : les colonnes 2 et 5 ne sont sûres pour un trajet
  // vertical qu'à la rangée 2 (où ELLES SONT le siège) — au-delà, elles
  // croisent le canapé (2,3)/(5,3) en descendant. [1,4,6] est sûr à toutes
  // les rangées (colonnes 1/4/6 jamais meublées hors rangée 1, jamais
  // traversées par la rangée 2 = couloir toujours net). Verrouillé par les
  // tests de non-traversée.
  const BREAK_COLS = 8;
  const BREAK_CORRIDOR_TY = 2; // rangée 2 : jamais de meuble à aucune colonne (pivot de routage)

  function breakRoomRows(n) {
    if (n <= 6) return 5;
    const extra = Math.ceil((n - 6) / 6);
    return 5 + 2 * extra;
  }
  function breakSlotPosition(idx) {
    const block = Math.floor(idx / 6), within = idx % 6;
    const rowGroup = within < 3 ? 0 : 1;
    const colIdx = within < 3 ? within : within - 3;
    const txArr = block === 0 ? (rowGroup === 0 ? [2, 4, 6] : [1, 4, 6]) : [1, 4, 6];
    const tx = txArr[colIdx];
    const ty = block === 0 ? (2 + rowGroup) : (5 + 2 * (block - 1) + rowGroup);
    return { tx, ty };
  }
  function routeBreak(from, to) {
    return routeInRoom(from, to, BREAK_CORRIDOR_TY);
  }

  function breakRoomStatics(occupantCount) {
    const rows = breakRoomRows(occupantCount);
    const statics = [];
    for (let x = 0; x < BREAK_COLS; x++) statics.push({ frame: 'wall', tx: x, ty: 0 });
    for (let y = 1; y < rows; y++) for (let x = 0; x < BREAK_COLS; x++) statics.push({ frame: 'floor', tx: x, ty: y });
    statics.push({ frame: 'door', tx: DOOR_TILE.tx, ty: DOOR_TILE.ty });
    statics.push({ frame: 'sideDesk', tx: 0, ty: 1 });
    statics.push({ frame: 'coffeeMachine', tx: 0, ty: 1, dy: -3 });
    statics.push({ frame: 'waterCooler', tx: 1, ty: 1 });
    statics.push({ frame: 'vending', tx: 7, ty: 1 });
    statics.push({ frame: 'sofa', tx: 2, ty: 3 });
    statics.push({ frame: 'sofa', tx: 5, ty: 3 });
    statics.push({ frame: 'plant', tx: 7, ty: 4 });
    statics.push({ frame: 'plant', tx: 0, ty: 4 });
    return { cols: BREAK_COLS, rows, statics };
  }

  // ─── Géométrie : salle Recherche ─────────────────────────────────────────
  // cols 8 ; table de réunion double (3,2)-(4,2), whiteboard mur (0,0)-(1,0),
  // porte (6,0) ; sièges table (2,2),(5,2),(3,3),(4,3) [workflow, cap 4] ;
  // postes latéraux col 0-1 rangées 3+ [subagents, cap 6] ; coin headless
  // col 6-7 rangées 2+ [cap 4], voile local (rect alpha 0.35, dessiné par
  // Task 2/office.js — layout expose juste la zone via `darkZone`).
  const RESEARCH_COLS = 8;
  const RESEARCH_MEETING_SEATS = [{ tx: 2, ty: 2 }, { tx: 5, ty: 2 }, { tx: 3, ty: 3 }, { tx: 4, ty: 3 }];

  function researchSubPosition(idx) { return { tx: idx % 2 === 0 ? 0 : 1, ty: 3 + Math.floor(idx / 2) }; }
  function researchHeadlessPosition(idx) { return { tx: idx % 2 === 0 ? 6 : 7, ty: 2 + Math.floor(idx / 2) }; }

  function researchGeometry(subCount, wfCount, headlessCount) {
    const subVisible = Math.min(subCount, MAX_SUBS);
    const wfVisible = Math.min(wfCount, MAX_WF);
    const headlessVisible = Math.min(headlessCount, MAX_HEADLESS);
    const subRows = Math.ceil(subVisible / 2);
    const headlessRows = Math.ceil(headlessVisible / 2);
    const rows = Math.max(4, 3 + subRows, 2 + headlessRows);
    const subagents = Math.max(0, subCount - MAX_SUBS);
    const workflow = Math.max(0, wfCount - MAX_WF);
    const headless = Math.max(0, headlessCount - MAX_HEADLESS);
    return {
      rows, subVisible, wfVisible, headlessVisible,
      // Forme uniforme (M4, revue reviewer) : { total, ...détail } dans les
      // 3 salles — Task 2 peut rendre un badge générique sur `overflow.total`
      // sans savoir si la salle a des sous-familles.
      overflow: { total: subagents + workflow + headless, subagents, workflow, headless },
    };
  }

  function researchRoomStatics(subCount, wfCount, headlessCount) {
    const geo = researchGeometry(subCount, wfCount, headlessCount);
    const statics = [];
    for (let x = 0; x < RESEARCH_COLS; x++) statics.push({ frame: 'wall', tx: x, ty: 0 });
    for (let y = 1; y < geo.rows; y++) for (let x = 0; x < RESEARCH_COLS; x++) statics.push({ frame: 'floor', tx: x, ty: y });
    statics.push({ frame: 'door', tx: DOOR_TILE.tx, ty: DOOR_TILE.ty });
    statics.push({ frame: 'whiteboard', tx: 0, ty: 0 });
    statics.push({ frame: 'meetingTable', tx: 3, ty: 2 });
    statics.push({ frame: 'meetingTable', tx: 4, ty: 2 });
    for (let i = 0; i < geo.subVisible; i++) {
      const p = researchSubPosition(i);
      statics.push({ frame: 'sideDesk', tx: p.tx, ty: p.ty });
      statics.push({ frame: 'laptop', tx: p.tx, ty: p.ty });
    }
    return { cols: RESEARCH_COLS, rows: geo.rows, statics, geo };
  }

  // ─── roomsFor(snapshot, state?) : les 3 salles, ordre fixe ───────────────
  // Signature retenue (fix reviewer C1) : `state` est un 2e paramètre
  // OPTIONNEL. Sans lui, roomsFor reste une fonction pure du snapshot seul
  // (géométrie de base, utilisée telle quelle par les tests de géométrie).
  // Avec lui (c'est ce que Task 2 doit toujours passer pour le RENDU réel),
  // le dimensionnement de Travail/Pause utilise `sizingCounts` — le
  // max(logique, physique) qui garde la salle à sa taille tant qu'un
  // migrant ne l'a pas physiquement quittée (cf. commentaire sizingCounts).
  // `counter` (footer) reste TOUJOURS le compte logique — c'est le nombre
  // « réel » de sessions actuellement dans cet état, pas un compte gonflé
  // par une migration en cours. La salle Recherche n'a pas ce problème
  // (subagents/meeting/headless ne migrent jamais, apparition/suppression
  // immédiate) : son dimensionnement reste purement snapshot, `state` ne la
  // concerne pas.
  function roomsFor(snapshot, state) {
    const interactive = (snapshot && snapshot.interactive) || [];
    const background = (snapshot && snapshot.background) || [];
    const all = [...interactive, ...background];

    const logical = logicalRoomCounts(interactive);
    const sizing = sizingCounts(interactive, state);
    const subCount = all.reduce((n, s) => n + ((s.subagents || []).length), 0);
    const wfCount = all.reduce((n, s) => n + workflowRunning(s), 0);
    const headlessCount = background.length;

    const work = workRoomStatics(sizing.work);
    const brk = breakRoomStatics(sizing.break);
    const research = researchRoomStatics(subCount, wfCount, headlessCount);

    return [
      { key: 'work', cols: work.cols, rows: work.rows, statics: work.statics, doorSpawn: { ...SPAWN_TILE }, counter: logical.work, overflow: { total: 0 } },
      { key: 'break', cols: brk.cols, rows: brk.rows, statics: brk.statics, doorSpawn: { ...SPAWN_TILE }, counter: logical.break, overflow: { total: 0 } },
      {
        key: 'research', cols: research.cols, rows: research.rows, statics: research.statics, doorSpawn: { ...SPAWN_TILE },
        counter: subCount + wfCount + headlessCount, overflow: research.geo.overflow,
        darkZone: { tx: 6, ty: 2, cols: 2, rows: research.rows - 2 },
      },
    ];
  }

  // ─── Slots (bookkeeping stable par salle) ────────────────────────────────
  // Valeur stockée : { idx, kind } — `kind` distingue les sous-familles au
  // sein de la salle recherche (meeting/subagent/headless partagent la même
  // Map mais des plages de positions disjointes ; travail/pause n'ont qu'une
  // seule famille 'session').
  function allocateSlot(state, roomKey, kind, actorId) {
    const map = state.slots[roomKey];
    const used = new Set();
    for (const v of map.values()) if (v.kind === kind) used.add(v.idx);
    let idx = 0;
    while (used.has(idx)) idx++;
    map.set(actorId, { idx, kind });
    return idx;
  }
  function freeSlot(state, roomKey, actorId) {
    state.slots[roomKey].delete(actorId);
  }
  function slotCount(state, roomKey, kind) {
    let n = 0;
    for (const v of state.slots[roomKey].values()) if (v.kind === kind) n++;
    return n;
  }

  function slotPositionFor(roomKey, kind, idx) {
    if (roomKey === 'work') return workSlotPosition(idx);
    if (roomKey === 'break') return breakSlotPosition(idx);
    if (kind === 'meeting') return RESEARCH_MEETING_SEATS[idx] || RESEARCH_MEETING_SEATS[RESEARCH_MEETING_SEATS.length - 1];
    if (kind === 'subagent') return researchSubPosition(idx);
    if (kind === 'headless') return researchHeadlessPosition(idx);
    return { tx: SPAWN_TILE.tx, ty: SPAWN_TILE.ty };
  }

  function retarget(actor, target, occupantCountForRoute) {
    if (!target) return;
    const last = actor.path.length ? actor.path[actor.path.length - 1] : { tx: actor.tx, ty: actor.ty };
    if (last.tx === target.tx && last.ty === target.ty) return;
    const from = { tx: actor.tx, ty: actor.ty };
    actor.path = actor.roomKey === 'break'
      ? routeBreak(from, target)
      : routeWork(from, target, occupantCountForRoute);
  }

  // ─── syncActors : diff global (sessions → acteurs) ───────────────────────
  // `sizing` = sizingCounts(interactive, state), calculé UNE FOIS par appel
  // de syncActors (cf. plus bas) et transmis à chaque syncMainActor : garantit
  // que le routage utilise EXACTEMENT le même compte que roomsFor(snapshot,
  // state) appelé avec le même state (fix C1).
  function syncMainActor(state, s, sizing) {
    const sid = s.sessionId;
    const stateName = s.state && s.state.name;
    const activity = activityFor(stateName);
    const desiredRoom = roomKeyForState(stateName);

    let actor = state.actors.get(sid);
    if (!actor) {
      const idx = allocateSlot(state, desiredRoom, 'session', sid);
      actor = {
        id: sid, sessionId: sid, kind: 'session', charIdx: charIndexFor(s.projectName),
        activity, roomKey: desiredRoom, migratingTo: null, slotIdx: idx,
        tx: SPAWN_TILE.tx, ty: SPAWN_TILE.ty, path: [], dir: 'down', animFrame: 0, done: false,
      };
      state.actors.set(sid, actor);
      retarget(actor, slotPositionFor(desiredRoom, 'session', idx), sizing[desiredRoom]);
      return;
    }

    // Erreur (I2, revue reviewer) : le perso s'effondre SUR PLACE, jamais de
    // marche (transposé de v2 : « un acteur en erreur ne marche pas »),
    // MÊME en pleine migration ou en pleine annulation de migration — cas
    // repro reviewer : running → waiting (migration démarrée) → error avant
    // d'avoir atteint la porte. On NE TOUCHE PAS `roomKey`/`migratingTo` ici
    // : un futur sync (une fois l'erreur résolue) recalculera `desiredRoom`
    // et re-routera proprement depuis la position gelée (cf. branches
    // ci-dessous, qui retargent inconditionnellement même si `path` a été
    // vidé pendant le gel).
    if (activity === 'down') {
      actor.activity = activity;
      actor.path = [];
      actor.done = false;
      return;
    }

    // Salle cible différente de la salle physique actuelle → migration.
    if (desiredRoom !== actor.roomKey) {
      if (actor.migratingTo !== desiredRoom) {
        actor.migratingTo = desiredRoom;
        actor.activity = activity;
        actor.done = false; // annule un `leave` définitif en cours (résurrection avant sortie complète)
        retarget(actor, { ...SPAWN_TILE }, sizing[actor.roomKey]);
      } else {
        actor.activity = activity;
        // Retarget inconditionnel (no-op si le path est déjà bon, cf.
        // `retarget`) : nécessaire pour REPRENDRE la marche si elle a été
        // gelée par un passage en erreur entre-temps (path vidé ci-dessus).
        retarget(actor, { ...SPAWN_TILE }, sizing[actor.roomKey]);
      }
      return;
    }

    // Salle cible = salle physique actuelle : annule une migration en cours
    // si l'état est revenu à la case départ AVANT la sortie effective (slot
    // jamais libéré entre-temps → même poste exact, aucune téléportation).
    if (actor.migratingTo !== null) {
      actor.migratingTo = null;
      actor.activity = activity;
      actor.done = false;
      retarget(actor, slotPositionFor(actor.roomKey, 'session', actor.slotIdx), sizing[actor.roomKey]);
      return;
    }

    // Résurrection pendant un `leave` définitif (session repartie avant que
    // l'appelant ait supprimé l'acteur). Deux cas selon que le slot est
    // ENCORE tenu ou déjà libéré (libération = uniquement au moment où
    // tickActor constate l'arrivée au spawn, cf. tickActor) :
    //  - slot encore tenu (l'acteur marche encore vers la sortie) : annule
    //    le leave, revient exactement au même poste (aucune réallocation —
    //    sinon allocateSlot verrait le slot actuel comme « déjà pris » par
    //    lui-même et sauterait au suivant, décalant le perso pour rien).
    //  - slot déjà libéré (arrivé à la porte, `done` posé) : nouvelle
    //    allocation, poste potentiellement différent (le précédent a pu être
    //    repris entre-temps — correct pour une salle PARTAGÉE, contrairement
    //    à v2 où chaque session avait sa propre pièce).
    if (actor.activity === 'leave' && actor.migratingTo === null) {
      const stillHeld = state.slots[actor.roomKey].has(sid);
      actor.activity = activity;
      actor.done = false;
      if (stillHeld) {
        retarget(actor, slotPositionFor(actor.roomKey, 'session', actor.slotIdx), sizing[actor.roomKey]);
      } else {
        const idx = allocateSlot(state, desiredRoom, 'session', sid);
        actor.slotIdx = idx;
        retarget(actor, slotPositionFor(desiredRoom, 'session', idx), sizing[desiredRoom]);
      }
      return;
    }

    if (actor.activity !== activity) {
      actor.activity = activity;
      actor.animFrame = 0;
      retarget(actor, slotPositionFor(actor.roomKey, 'session', actor.slotIdx), sizing[actor.roomKey]);
    }
  }

  function syncHeadlessActor(state, s) {
    const aid = `${s.sessionId}:headless`;
    if (!state.actors.has(aid)) {
      const idx = allocateSlot(state, 'research', 'headless', aid);
      state.actors.set(aid, {
        id: aid, sessionId: s.sessionId, kind: 'headless', charIdx: charIndexFor(s.projectName),
        activity: 'work', roomKey: 'research', migratingTo: null, slotIdx: idx,
        tx: 0, ty: 0, path: [], dir: 'down', animFrame: 0, done: false,
      });
      const pos = slotPositionFor('research', 'headless', idx);
      const a = state.actors.get(aid);
      a.tx = pos.tx; a.ty = pos.ty;
    }
  }

  // Subagents/agents de workflow, plafonnés GLOBALEMENT (toutes sessions
  // confondues — salle partagée, contrairement au cap par-session de v2).
  function syncResearchEntities(state, allSessions) {
    const wantedSub = new Set();
    const wantedWf = new Set();
    for (const s of allSessions) {
      const sid = s.sessionId;
      for (const sub of (s.subagents || [])) {
        const aid = `${sid}:sub:${sub.agentId}`;
        wantedSub.add(aid);
        if (!state.actors.has(aid)) {
          if (slotCount(state, 'research', 'subagent') >= MAX_SUBS) continue; // cap atteint → overflow (comptabilisé par roomsFor)
          const idx = allocateSlot(state, 'research', 'subagent', aid);
          const pos = researchSubPosition(idx);
          state.actors.set(aid, {
            id: aid, sessionId: sid, kind: 'subagent', charIdx: charIndexFor(sub.agentId),
            activity: 'work', roomKey: 'research', migratingTo: null, slotIdx: idx,
            tx: pos.tx, ty: pos.ty, path: [], dir: 'down', animFrame: 0, done: false,
          });
        }
      }
      const nSeats = Math.min(workflowRunning(s), MAX_WF);
      for (let i = 0; i < nSeats; i++) {
        const aid = `${sid}:wf:${i}`;
        wantedWf.add(aid);
        if (!state.actors.has(aid)) {
          if (slotCount(state, 'research', 'meeting') >= MAX_WF) continue;
          const idx = allocateSlot(state, 'research', 'meeting', aid);
          const seat = RESEARCH_MEETING_SEATS[idx];
          state.actors.set(aid, {
            id: aid, sessionId: sid, kind: 'meeting', charIdx: (charIndexFor(sid) + i + 1) % 10,
            activity: 'work', roomKey: 'research', migratingTo: null, slotIdx: idx,
            tx: seat.tx, ty: seat.ty, path: [], dir: seat.ty === 3 ? 'up' : 'down', animFrame: 0, done: false,
          });
        }
      }
    }
    for (const [aid, a] of state.actors) {
      if (a.kind === 'subagent' && !wantedSub.has(aid)) { freeSlot(state, 'research', aid); state.actors.delete(aid); }
      if (a.kind === 'meeting' && !wantedWf.has(aid)) { freeSlot(state, 'research', aid); state.actors.delete(aid); }
    }
  }

  // Contrat (M5, revue reviewer) : les acteurs dont `done === true` doivent
  // être supprimés par L'APPELANT (`state.actors.delete(id)`) — syncActors
  // ne le fait jamais lui-même pour les acteurs `kind:'session'` (seul
  // tickActor sait QUAND `done` bascule à true, à l'arrivée physique au
  // spawn). Sa libération de slot est déjà faite en interne (par tickActor,
  // au moment même où `done` passe à true) : l'appelant n'a qu'à retirer
  // l'entrée de `state.actors`, jamais à toucher `state.slots`. Un appelant
  // qui oublie cette suppression laisse un acteur fantôme figé à la porte
  // (inoffensif pour le calcul — `sizingCounts`/`roomsFor` ignorent les
  // acteurs, seuls les slots comptent — mais visible si Task 2 itère
  // `actorsIn` sans avoir purgé les `done`).
  function syncActors(state, snapshot) {
    const interactive = (snapshot && snapshot.interactive) || [];
    const background = (snapshot && snapshot.background) || [];
    const all = [...interactive, ...background];
    const liveSessionIds = new Set(all.map(s => s.sessionId));
    const sizing = sizingCounts(interactive, state);

    for (const s of interactive) syncMainActor(state, s, sizing);
    for (const s of background) syncHeadlessActor(state, s);
    syncResearchEntities(state, all);

    // Purge : sessions absentes du snapshot. Perso principal → part pour de
    // bon (leave, marche vers la sortie de sa salle physique actuelle).
    // Headless → suppression immédiate (pas de marche, comme subs/meeting).
    for (const [aid, a] of state.actors) {
      if (liveSessionIds.has(a.sessionId)) continue;
      if (a.kind === 'headless') { freeSlot(state, 'research', aid); state.actors.delete(aid); continue; }
      if (a.kind !== 'session') continue; // subs/meeting déjà nettoyés par syncResearchEntities
      if (a.activity !== 'leave' || a.migratingTo !== null) {
        a.activity = 'leave';
        a.migratingTo = null;
        retarget(a, { ...SPAWN_TILE }, sizing[a.roomKey]);
      }
    }
  }

  // `actorsIn` ne filtre PAS les acteurs `done` (cf. contrat ci-dessus sur
  // syncActors) : un appelant qui n'a pas supprimé un acteur `done` le
  // retrouvera ici, figé à la porte de sortie.
  function actorsIn(state, roomKey) {
    return [...state.actors.values()].filter(a => a.roomKey === roomKey).sort((a, b) => a.ty - b.ty);
  }

  // ─── tickActor : un pas de marche, ou le téléport de fin de migration ────
  function isAtSpawn(actor) { return actor.tx === SPAWN_TILE.tx && actor.ty === SPAWN_TILE.ty; }

  function tickActor(actor, state) {
    if (actor.path.length === 0) {
      if (actor.kind === 'session' && actor.migratingTo !== null && isAtSpawn(actor)) {
        // Téléport : le perso a fini sa marche de sortie (porte de la salle
        // A) — bascule de salle, ré-apparaît au spawn de la salle cible
        // (même tile, cf. SPAWN_TILE partagé), puis repart marcher vers son
        // nouveau poste. Aucune tuile intermédiaire visible hors salle.
        const targetRoom = actor.migratingTo;
        freeSlot(state, actor.roomKey, actor.id); // libéré seulement ICI (pas à la décision) : permet l'annulation sans réallocation tant qu'on n'a pas physiquement quitté
        actor.roomKey = targetRoom;
        actor.migratingTo = null;
        const idx = allocateSlot(state, targetRoom, 'session', actor.id);
        actor.slotIdx = idx;
        actor.tx = SPAWN_TILE.tx; actor.ty = SPAWN_TILE.ty;
        // Compte physique seul ici (pas de `sizing` — tickActor n'a pas le
        // snapshot) : sans risque de divergence dans le cas courant (un seul
        // migrant à la fois), le slot venant d'être alloué se reflète déjà
        // dans `state.slots[targetRoom].size`. Limite documentée : plusieurs
        // migrations simultanées vers la MÊME salle pourraient transitoirement
        // sous-dimensionner l'entrée d'un des arrivants — non repro par le
        // reviewer, hors scope de ce fix (C1 ne portait que sur la sortie).
        retarget(actor, slotPositionFor(targetRoom, 'session', idx), slotCount(state, targetRoom, 'session'));
        return false;
      }
      if (actor.kind === 'session' && actor.activity === 'leave' && actor.migratingTo === null && isAtSpawn(actor)) {
        freeSlot(state, actor.roomKey, actor.id);
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
      case 'work':
      case 'think':
        return actor.kind === 'meeting' ? `${c}.idle.down` : `${c}.idle.up`;
      case 'relax': return `${c}.idle.down`;   // salle pause : face caméra, pas de bureau
      default: return `${c}.idle.down`;
    }
  }

  // --- Émotes (bulle au-dessus du perso principal) — INCHANGÉ depuis v2 ---
  // Priorité : enveloppe (bell active) > émote d'état > émote d'outil (running).
  const STATE_EMOTES = {
    thinking: 'emote.think',
    pending: 'emote.alert',
    error: 'emote.angry',
    waiting: 'emote.zzz',
  };

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
      default: return 'emote.tool.gear';
    }
  }

  function emoteFor(session, bellActive) {
    if (bellActive) return 'emote.mail';
    const stateName = session && session.state && session.state.name;
    if (stateName === 'running') return 'emote.work';
    if (Object.prototype.hasOwnProperty.call(STATE_EMOTES, stateName)) return STATE_EMOTES[stateName];
    return null;
  }

  // ─── Étiquette pixel : nom projet tronqué (8 car.) ───────────────────────
  // `session` = la session PARENTE pour subagent/meeting/headless (l'appelant
  // — office.js Task 2 — passe la session dont dépend l'acteur ; pour un
  // acteur `kind:'session'` c'est sa propre session).
  function labelFor(actor, session) {
    const name = (session && (session.customName || session.projectName)) || '';
    return String(name).slice(0, 8);
  }

  return {
    createState, roomsFor, syncActors, actorsIn, tickActor, animFor, activityFor,
    roomKeyForState, charIndexFor, workflowRunning, emoteFor, labelFor,
    ROOM_KEYS, MAX_SUBS, MAX_WF, MAX_HEADLESS, DOOR_TILE, SPAWN_TILE,
  };
});
