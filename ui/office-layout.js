// ui/office-layout.js — logique pure de la vue office v4 : UNE seule salle
// « open-space », zonée en quadrants (lounge / agents / deep-research /
// headless) reliés par un couloir central toujours libre. Remplace les 3
// salles v3 (Travail/Pause/Recherche) — pivot demandé par Paul, mockup fourni
// (.superpowers/sdd/mockup-v4.png). Aucune dépendance DOM/canvas → testable
// en node.
//
// Voir docs/superpowers/specs/2026-07-19-office-open-space-design.md (fait
// foi) et le plan associé (Task 2 : layout v4). Le socle v2/v3 survit :
// activityFor (activité par état), emoteFor (bulles + priorités + règle
// « waiting à cloche active reste au poste »), labelFor (étiquette pixel),
// charIndexFor, workflowRunning (dédup runId), le principe « slots stables,
// jamais sous les occupants réels » (famille de fixes C1/C2/C3), le contrat
// M5 (acteurs `done` supprimés par l'appelant), la purge sur flip
// `isBackground` (I3).
//
// ─── Interfaces de sortie (FERMES pour Task 3) ─────────────────────────────
//   createState()                 → { actors: Map, slots: {lounge,agents,dr,headless: Map} }
//   roomFor(snapshot, state?)      → { cols, rows, statics, zones }
//     - cols = 16 toujours. rows = 1 (mur) + max(besoin gauche, besoin
//       droite) + 1 (rangée basse de circulation).
//     - statics : liste de { frame, tx, ty, dy?, z? }. `z:'over'` = dessiné
//       PAR-DESSUS l'acteur assis (fauteuils `chairOrange`/`chairBlack`,
//       visibilité conditionnelle à l'occupation — même contrat que
//       `chairOver` en v3, RENOMMÉ : office.js (Task 3) doit étendre son
//       `overVisible()` à ces deux nouveaux noms de frame, cf. rapport).
//       Marqueurs spéciaux conservés : `door` (pas d'asset atlas, placeholder
//       dessiné par office.js) ; PAS de `coffeeMachine` séparé — l'asset
//       Task 1 (`coffeeTable`, single 322) bake déjà la machine+tasses sur la
//       table basse, un overlay ferait doublon (décision documentée) ; PAS de
//       `_papers` — marqueur d'un plan v2 abandonné (2026-07-17-office-rooms-
//       adaptive), jamais implémenté même en v3, rien à transposer.
//     - zones : { lounge, agents, dr, headless }, chacune
//       { counter, overflow:{total,...}, box:{tx,ty,cols,rows} }. `counter`
//       = compte LOGIQUE (snapshot seul, jamais gonflé par une migration en
//       cours) ; `overflow.total` = ce qui dépasse le cap (0 si la zone est
//       extensible sans cap, cf. agents). `box` = rectangle occupé par la
//       zone, pour que Task 3 puisse dessiner des séparateurs/étiquettes sans
//       recalculer les constantes de géométrie.
//   syncActors(state, snapshot)    → diff sessions→acteurs (contrat M5 : les
//     acteurs `done===true` doivent être supprimés par L'APPELANT, jamais ici)
//   actorsAll(state)               → tous les acteurs, triés par ty (UN seul
//     canvas — plus de `actorsIn(state, roomKey)` par salle, v3 en avait 3)
//   tickActor(actor, state)        → un pas de marche (2 ticks/tuile) ou le
//     téléport de fin de migration / le passage à `done`
//   animFor(actor) / emoteFor(session, bellActive) / labelFor(actor, session)
//     → inchangés dans l'esprit (mêmes priorités bulles, même règle cloche)
//
// ─── Géométrie (mockup, latitude ±1) ────────────────────────────────────────
// Salle unique, 16 colonnes fixes. Couloir central vertical = colonnes 6-9,
// TOUJOURS libre de tout mobilier, sur toute la hauteur (pivot de routage =
// colonne 7, qui porte aussi la porte/spawn — « au bord du couloir central »,
// le mockup n'en montre pas). Bloc gauche (cols 0-5) : lounge fixe en haut
// (rows 1-4, canapé d'angle + table basse, cap 8 + "+N"), agents extensible
// en bas (row 5+, rangées de 3 postes, AUCUN cap — c'est le compte réel de
// sessions actives). Bloc droit (cols 10-15) : deep-research fixe en haut
// (rows 1-4, postes latéraux empilés, cap 8 + "+N"), headless extensible en
// bas (row 5+, cap 6 + "+N", mêmes rangées de 3 que agents mais fauteuil
// NOIR). Rangée basse de circulation = toujours la dernière rangée rendue,
// jamais de mobilier dessus (générique, en plus du couloir vertical).
//
// Migration lounge↔agents = la SEULE marche intra-salle (les autres kinds —
// subagent/workflow/headless — apparaissent/disparaissent directement à leur
// slot, jamais de trajet, transposé de v3). Le routage passe TOUJOURS par la
// colonne du couloir (7) : un acteur en salle lounge doit d'abord rejoindre
// SA rangée de circulation locale (row 4, la seule rangée du lounge sans
// mobilier) avant de filer horizontalement vers le couloir — sinon il
// traverserait le canapé/la table (cf. `connectorTyFor`). Un acteur en zone
// agents/headless est DÉJÀ sur une rangée sûre (la rangée du fauteuil, jamais
// de mobilier au-delà du bureau qui est une rangée plus haut) : pas
// d'échappée verticale nécessaire, juste le trajet horizontal direct.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfficeLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // ─── Constantes de géométrie ──────────────────────────────────────────────
  const COLS = 16;
  const CORRIDOR_TX = 7;                 // pivot de routage, dans le couloir (cols 6-9)
  const DOOR_TILE = { tx: 7, ty: 0 };
  const SPAWN_TILE = { tx: 7, ty: 1 };

  const LOUNGE_TOP = 1;
  const LOUNGE_ROWS = 4;                 // rows 1-4, boîte FIXE (cap+overflow, ne redimensionne jamais)
  const LOUNGE_CAP = 8;
  const LOUNGE_CONNECTOR_TY = 4;         // seule rangée du lounge sans mobilier (échappée/entrée)
  const LOUNGE_SEATS = [{ tx: 1, ty: 1 }, { tx: 3, ty: 1 }, { tx: 0, ty: 3 }]; // sur le canapé
  const LOUNGE_STAND_TXS = [1, 2, 3, 4, 5]; // debout, row 4 (5 places)

  const AGENTS_TOP = 5;                  // juste sous le lounge, FIXE (le lounge ne grandit jamais)
  const MAX_SUB_PER_PARENT = 2;          // portables : jusqu'à 2 par parent, "+N" au-delà (cap PAR PARENT, pas global)

  const DR_TOP = 1;
  const DR_ROWS = 4;                     // rows 1-4, boîte FIXE (cap+overflow)
  const MAX_DR = 8;
  const DR_COL_A = 10, DR_COL_B = 13;    // 2 postes par rangée

  const HEADLESS_TOP = 5;                // juste sous deep-research, FIXE (deep-research ne grandit jamais)
  const MAX_HEADLESS = 6;
  const HEADLESS_COLS = [10, 12, 14];    // 3 postes par rangée, comme agents

  const TV_TX = 12;

  function createState() {
    return { actors: new Map(), slots: { lounge: new Map(), agents: new Map(), dr: new Map(), headless: new Map() } };
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
      case 'waiting': return 'relax';
      case 'pending': return 'call';
      case 'error': return 'down';
      default: return 'work';
    }
  }

  // Zone cible selon l'état de la session : agents = thinking/running/
  // pending/error ; lounge = waiting. Nuance cloche (conservée depuis
  // 2026-07-19) : un waiting dont la cloche needs-you est active reste à son
  // poste (zone agents) jusqu'à expiration/traitement.
  function zoneForState(stateName, bellActive) {
    return (stateName === 'waiting' && !bellActive) ? 'lounge' : 'agents';
  }

  function workflowRunning(session) {
    const seen = new Map();
    for (const w of (session && session.workflows) || []) {
      if (w.running > 0 && !seen.has(w.runId)) seen.set(w.runId, w.running);
    }
    let n = 0;
    for (const v of seen.values()) n += v;
    return n;
  }

  // ─── Slots (bookkeeping stable PAR ZONE) ─────────────────────────────────
  function allocateSlot(state, zone, kind, actorId) {
    const map = state.slots[zone];
    const used = new Set();
    for (const v of map.values()) if (v.kind === kind) used.add(v.idx);
    let idx = 0;
    while (used.has(idx)) idx++;
    map.set(actorId, { idx, kind });
    return idx;
  }
  function freeSlot(state, zone, actorId) { state.slots[zone].delete(actorId); }
  function slotCount(state, zone, kind) {
    let n = 0;
    for (const v of state.slots[zone].values()) if (v.kind === kind) n++;
    return n;
  }
  // Plus haut index de slot ENCORE TENU (+1), transposé de v3 (fix C2) : les
  // slots sont stables et jamais renumérotés — ce compte se fragmente dès
  // qu'un occupant à un index bas part avant un occupant à un index haut.
  function maxHeldSlotIdx(state, zone, kind) {
    let max = -1;
    for (const v of state.slots[zone].values()) if (v.kind === kind && v.idx > max) max = v.idx;
    return max;
  }
  // Plus haute tuile (ty) physiquement occupée dans la zone par un acteur du
  // `kind` donné (marcheur OU gelé en erreur), transposé de v3 (fix C3) :
  // couvre le cas d'un acteur gelé EN PLEIN COULOIR (loin de son slot
  // logique) — cf. commentaire de tête sur le routage.
  function maxActorTyInZone(state, zone, kind) {
    if (!state) return -1;
    let max = -1;
    for (const a of state.actors.values()) if (a.zone === zone && a.kind === kind && a.ty > max) max = a.ty;
    return max;
  }

  // ─── Positions par zone ───────────────────────────────────────────────────
  function loungeSlotPosition(idx) {
    if (idx < LOUNGE_SEATS.length) return { ...LOUNGE_SEATS[idx] };
    const standIdx = (idx - LOUNGE_SEATS.length) % LOUNGE_STAND_TXS.length;
    return { tx: LOUNGE_STAND_TXS[standIdx], ty: LOUNGE_CONNECTOR_TY };
  }

  // Cellule de poste = 2 colonnes de large (console col c, portable réservé
  // col c+1 si subagents) ; rangées de 3 postes ; groupes séparés par 1
  // rangée de circulation (gap) — transpose la géométrie « bureau+fauteuil »
  // v3 en 1-poste-par-cellule au lieu de paires.
  function agentStationPosition(idx) {
    const group = Math.floor(idx / 3), within = idx % 3;
    const c = within * 2;
    const consoleTy = AGENTS_TOP + group * 3;
    const chairTy = consoleTy + 1;
    return {
      consoleTx: c, consoleTy, chairTx: c, chairTy,
      laptop: [{ tx: c + 1, ty: chairTy }, { tx: c + 1, ty: consoleTy }],
    };
  }
  function agentsGroups(n) { return Math.max(1, Math.ceil(n / 3)); }
  function agentsRows(n) { return agentsGroups(n) * 3 - 1; }

  function drPosition(idx) {
    const tx = idx % 2 === 0 ? DR_COL_A : DR_COL_B;
    const ty = DR_TOP + Math.floor(idx / 2);
    return { tx, ty };
  }

  function headlessPosition(idx) {
    const group = Math.floor(idx / 3), within = idx % 3;
    const c = HEADLESS_COLS[within];
    const consoleTy = HEADLESS_TOP + group * 3;
    const chairTy = consoleTy + 1;
    return { consoleTx: c, consoleTy, chairTx: c, chairTy };
  }
  function headlessGroups(n) { return Math.max(1, Math.ceil(n / 3)); }
  function headlessRows(n) { return headlessGroups(n) * 3 - 1; }

  // Position de repos d'un acteur `kind:'session'` dans sa zone physique
  // actuelle (lounge ou agents) — seules zones où ce kind peut se trouver.
  function slotPositionFor(zone, idx) {
    if (zone === 'lounge') return loungeSlotPosition(idx);
    const p = agentStationPosition(idx);
    return { tx: p.chairTx, ty: p.chairTy };
  }

  // Cap + fallback (lounge est la SEULE zone cap-limitée où un acteur
  // `session` peut vouloir aller) : si le lounge est plein, on ne fait
  // jamais disparaître une session réelle — elle reste visible à un poste
  // agents (zone non-cappée) plutôt que de ne plus être rendue du tout.
  // Décision documentée (au-delà de la lettre de la spec, qui ne précise pas
  // ce cas) : un outil de monitoring ne doit jamais rendre une session
  // invisible.
  //
  // `effectiveZoneFor` est la version SANS ALLOCATION de cette même
  // résolution — un « dry run » pur (lecture de `slotCount`, aucune
  // mutation) utilisé par `syncMainActor` pour décider s'il faut (re)lancer
  // une migration. Fix reviewer (Critical, pacing des débordés) : comparer
  // `desiredZone` (brut, ignore le cap) à `actor.zone` faisait rejouer une
  // migration lounge→agents à CHAQUE sync tant que le lounge restait plein,
  // même snapshot inchangé — l'acteur navette porte↔siège en boucle. La
  // comparaison doit se faire sur la zone EFFECTIVE (celle que l'allocation
  // peut réellement offrir MAINTENANT, cap compris) : si le débordé est déjà
  // installé en agents et que le lounge est toujours plein, effectiveZone
  // === 'agents' === actor.zone → aucune migration. Recalculée à CHAQUE
  // appel (jamais mise en cache) : dès qu'une place se libère au lounge,
  // effectiveZone repasse à 'lounge' et une migration UNIQUE et propre se
  // déclenche naturellement au sync suivant.
  //
  // `excludeSid` (2e fix, même famille de bug) : un acteur DÉJÀ installé au
  // lounge, en train de se demander « dois-je y rester ? », tient LUI-MÊME
  // un des slots comptés par `slotCount` — sans l'exclure, un lounge
  // EXACTEMENT au cap (8/8, lui compris) se voit comme « plein » et se
  // renvoie en agents tout seul, ce qui rouvre le pacing dans l'AUTRE sens
  // (allers-retours lounge→agents→lounge→...). `allocateSessionSlot`
  // (création, ou réallocation après libération effective du slot) n'a
  // jamais ce problème : l'acteur n'y détient encore AUCUN slot au moment de
  // l'appel, `excludeSid` y est donc toujours omis.
  function effectiveZoneFor(state, wantedZone, excludeSid) {
    if (wantedZone !== 'lounge') return wantedZone;
    let count = slotCount(state, 'lounge', 'session');
    if (excludeSid && state.slots.lounge.has(excludeSid)) count -= 1;
    return count >= LOUNGE_CAP ? 'agents' : 'lounge';
  }
  function allocateSessionSlot(state, wantedZone, sid) {
    const zone = effectiveZoneFor(state, wantedZone);
    return { zone, idx: allocateSlot(state, zone, 'session', sid) };
  }

  // ─── Routage : couloir central, connecteur par zone ──────────────────────
  // Le lounge a UNE rangée sans mobilier (row 4) : tout trajet entrant/
  // sortant y passe obligatoirement avant de filer vers le couloir (sinon on
  // traverse le canapé/la table). Les autres positions utilisées par un
  // acteur `session` (poste agents, ou le couloir lui-même) sont déjà sur une
  // rangée sûre : le connecteur y est sa propre ty (échappée = 0 tuile).
  function connectorTyFor(pos) {
    if (pos.tx >= 0 && pos.tx <= 5 && pos.ty >= LOUNGE_TOP && pos.ty <= LOUNGE_TOP + LOUNGE_ROWS - 1) {
      return LOUNGE_CONNECTOR_TY;
    }
    return pos.ty;
  }

  // Trajet en 2 coudes via le couloir (colonne CORRIDOR_TX, libre à toute
  // hauteur) : échappée verticale (rangée sûre de départ) → horizontale
  // jusqu'au couloir → verticale dans le couloir → horizontale jusqu'à la
  // colonne cible → entrée verticale (rangée sûre d'arrivée). Chaque étape
  // est un no-op si déjà satisfaite (ex. spawn/agents n'ont pas d'échappée).
  function routeViaCorridor(from, to) {
    const path = [];
    let { tx, ty } = from;
    const fromConn = connectorTyFor(from);
    while (ty !== fromConn) { ty += Math.sign(fromConn - ty); path.push({ tx, ty }); }
    while (tx !== CORRIDOR_TX) { tx += Math.sign(CORRIDOR_TX - tx); path.push({ tx, ty }); }
    const toConn = connectorTyFor(to);
    while (ty !== toConn) { ty += Math.sign(toConn - ty); path.push({ tx, ty }); }
    while (tx !== to.tx) { tx += Math.sign(to.tx - tx); path.push({ tx, ty }); }
    while (ty !== to.ty) { ty += Math.sign(to.ty - ty); path.push({ tx, ty }); }
    return path;
  }

  function retarget(actor, target) {
    if (!target) return;
    const last = actor.path.length ? actor.path[actor.path.length - 1] : { tx: actor.tx, ty: actor.ty };
    if (last.tx === target.tx && last.ty === target.ty) return;
    actor.path = routeViaCorridor({ tx: actor.tx, ty: actor.ty }, target);
  }

  // ─── Statics : décor ──────────────────────────────────────────────────────
  function buildShell(statics, cols, rows) {
    for (let x = 0; x < cols; x++) statics.push({ frame: 'wall', tx: x, ty: 0 });
    for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) statics.push({ frame: 'floor', tx: x, ty: y });
    statics.push({ frame: 'door', tx: DOOR_TILE.tx, ty: DOOR_TILE.ty });
    statics.push({ frame: 'tv', tx: TV_TX, ty: 0 });
    statics.push({ frame: 'plant', tx: 15, ty: 1 });
  }

  // Canapé d'angle en L, assemblé depuis les 4 fragments (bbox atlas, cf.
  // rapport Task 1) : B (anchor, arm horizontal gauche) + A (rallonge l'arm
  // horizontal) en row 1 ; C + D (rallongent l'arm vertical) en col 0, rows
  // 2-3. Table basse (avec machine à café bakée) en face de l'arm horizontal
  // (cols 4-5, row 2). Plante en bout d'arm horizontal.
  // Fix Task 3 (checkpoint visuel « doit lire comme un canapé ») : A et B
  // contiennent CHACUN leur propre bras horizontal 2 tuiles + amorce de
  // virage (constaté au bake-preview zoomé, pas documenté ainsi au Task 1/2)
  // — les poser côte à côte sans chevauchement (A à tx:2, comme écrit
  // initialement) affichait deux coins dupliqués séparés par une marche,
  // pas un canapé continu. A posé à tx:1 (chevauchement d'1 tuile avec B,
  // A dessiné PAR-DESSUS car plus loin dans le tableau) fusionne les deux
  // motifs de coussin en un seul bloc — vérifié au CDP (screenshot zoomé),
  // comparé au mockup (bloc large plutôt qu'un L net, cf. rapport Task 3).
  // Conséquence acceptée : le siège lounge idx1 (tx:3,ty:1, cf. LOUNGE_SEATS)
  // n'est plus visuellement SUR un fragment (sol nu) — aucun test ne
  // vérifie ce détail, priorité donnée à la silhouette d'ensemble.
  function buildLounge(statics) {
    statics.push({ frame: 'sofaCornerB', tx: 0, ty: 1 });
    statics.push({ frame: 'sofaCornerA', tx: 1, ty: 1 });
    statics.push({ frame: 'plant', tx: 5, ty: 1 });
    statics.push({ frame: 'sofaCornerC', tx: 0, ty: 2 });
    statics.push({ frame: 'coffeeTable', tx: 4, ty: 2 });
    statics.push({ frame: 'sofaCornerD', tx: 0, ty: 3 });
  }

  function buildAgents(statics, groups) {
    for (let g = 0; g < groups; g++) {
      for (let within = 0; within < 3; within++) {
        const c = within * 2;
        const consoleTy = AGENTS_TOP + g * 3;
        statics.push({ frame: 'stationConsole', tx: c, ty: consoleTy });
        statics.push({ frame: 'chairOrange', tx: c, ty: consoleTy + 1, dy: 2, z: 'over' });
      }
    }
  }

  // Fix Task 3 (checkpoint visuel) : le bureau/écran est décalé d'1 tuile à
  // DROITE de la tuile de l'acteur (pas superposé) — posé sur la MÊME tuile
  // que l'acteur (comme écrit initialement), le sprite standing 16×32 de
  // l'acteur (idle.down, face caméra, pas idle.up comme aux postes agents)
  // recouvre presque entièrement le petit décor 15×15/15×16, invisible au
  // rendu (constaté au CDP, screenshot zoomé). tx+1 reste dans la boîte dr
  // (cols 10-15) sans jamais toucher le couloir (cols 6-9, testé ailleurs) —
  // vérifié pour les 2 colonnes de poste (10→11, 13→14).
  function buildDR(statics, count) {
    for (let i = 0; i < count; i++) {
      const p = drPosition(i);
      statics.push({ frame: 'sideDesk90', tx: p.tx + 1, ty: p.ty });
      statics.push({ frame: 'sideSetup90', tx: p.tx + 1, ty: p.ty, dy: -3 });
    }
  }

  function buildHeadless(statics, groups) {
    for (let g = 0; g < groups; g++) {
      for (let within = 0; within < 3; within++) {
        const c = HEADLESS_COLS[within];
        const consoleTy = HEADLESS_TOP + g * 3;
        statics.push({ frame: 'stationConsole', tx: c, ty: consoleTy });
        statics.push({ frame: 'chairBlack', tx: c, ty: consoleTy + 1, dy: 2, z: 'over' });
      }
    }
  }

  // ─── roomFor(snapshot, state?) ────────────────────────────────────────────
  function roomFor(snapshot, state) {
    const interactive = (snapshot && snapshot.interactive) || [];
    const background = (snapshot && snapshot.background) || [];

    let loungeLogical = 0, agentsLogical = 0;
    for (const s of interactive) {
      const zone = zoneForState(s.state && s.state.name, !!s.bellActive);
      if (zone === 'lounge') loungeLogical++; else agentsLogical++;
    }
    // Overflow subagents : calculable depuis le SNAPSHOT SEUL (indépendant
    // du rendu/adjacence réelle, qui nécessite `state` — cf. note plus bas).
    const subOverflow = interactive.reduce((n, s) => n + Math.max(0, (s.subagents || []).length - MAX_SUB_PER_PARENT), 0);
    const wfTotal = interactive.reduce((n, s) => n + workflowRunning(s), 0);
    const bgTotal = background.length;

    // Sizing dynamique (C1/C2/C3 transposé) : SEULES les zones agents et
    // headless redimensionnent selon l'occupation (lounge et deep-research
    // sont des boîtes FIXES, cap+overflow, jamais de risque C1/C2/C3 — leur
    // taille ne dépend jamais du compte d'occupants).
    const agentsHeldMax = state ? maxHeldSlotIdx(state, 'agents', 'session') + 1 : 0;
    const agentsSizing = Math.max(agentsLogical, agentsHeldMax);
    const agentsFloorAbs = state ? maxActorTyInZone(state, 'agents', 'session') + 1 : 0;
    const agentsRowsN = agentsRows(agentsSizing);
    const agentsBottom = Math.max(AGENTS_TOP + agentsRowsN, agentsFloorAbs);
    // Hauteur de boîte EXPOSÉE (métadonnée `zones.agents.box.rows`) : doit
    // elle aussi refléter le plancher C3 (acteur gelé en plein couloir, ty
    // au-delà de ce que `agentsRowsN` seul couvrirait) — sinon `room.rows`
    // (total) protège le rendu global mais la métadonnée de zone mentirait
    // à Task 3 sur l'étendue réelle nécessaire.
    const agentsBoxRows = agentsBottom - AGENTS_TOP;

    const headlessCapped = Math.min(bgTotal, MAX_HEADLESS);
    const headlessHeldMax = state ? maxHeldSlotIdx(state, 'headless', 'headless') + 1 : 0;
    const headlessSizing = Math.max(headlessCapped, headlessHeldMax);
    const headlessRowsN = headlessRows(headlessSizing);
    const headlessBottom = HEADLESS_TOP + headlessRowsN;
    // Pas de plancher par-position pour headless : ces acteurs n'ont jamais
    // de path (apparition directe au slot, jamais de marche gelable en
    // erreur) — contrairement à `agents`, où un acteur `session` PEUT geler
    // en plein couloir pendant une migration interrompue.

    const rows = 1 + Math.max(agentsBottom, headlessBottom) + 1;
    const cols = COLS;

    const statics = [];
    buildShell(statics, cols, rows);
    buildLounge(statics);
    buildAgents(statics, agentsGroups(agentsSizing));
    const drVisible = Math.min(wfTotal, MAX_DR);
    buildDR(statics, Math.max(1, drVisible));
    buildHeadless(statics, headlessGroups(headlessSizing));
    // Portables (subagents) : dérivés des acteurs `subagent` DÉJÀ positionnés
    // par syncActors (nécessite `state` — l'adjacence au poste du parent est
    // par construction une donnée d'état, pas une géométrie pure de snapshot).
    if (state) {
      for (const a of state.actors.values()) {
        if (a.kind === 'subagent') statics.push({ frame: 'laptop', tx: a.tx, ty: a.ty });
      }
    }

    const zones = {
      lounge: {
        counter: loungeLogical,
        overflow: { total: Math.max(0, loungeLogical - LOUNGE_CAP) },
        box: { tx: 0, ty: LOUNGE_TOP, cols: 6, rows: LOUNGE_ROWS },
      },
      agents: {
        counter: agentsLogical,
        overflow: { total: subOverflow, subagents: subOverflow },
        box: { tx: 0, ty: AGENTS_TOP, cols: 6, rows: agentsBoxRows },
      },
      dr: {
        counter: wfTotal,
        overflow: { total: Math.max(0, wfTotal - MAX_DR) },
        box: { tx: DR_COL_A, ty: DR_TOP, cols: 6, rows: DR_ROWS },
      },
      headless: {
        counter: bgTotal,
        overflow: { total: Math.max(0, bgTotal - MAX_HEADLESS) },
        box: { tx: DR_COL_A, ty: HEADLESS_TOP, cols: 6, rows: headlessRowsN },
      },
    };

    return { cols, rows, statics, zones };
  }

  // ─── syncActors : diff global (sessions → acteurs) ───────────────────────
  function syncMainActor(state, s) {
    const sid = s.sessionId;
    const stateName = s.state && s.state.name;
    const bellActive = !!s.bellActive;
    const activity = (stateName === 'waiting' && bellActive) ? 'work' : activityFor(stateName);
    const desiredZone = zoneForState(stateName, bellActive);

    let actor = state.actors.get(sid);
    if (!actor) {
      const alloc = allocateSessionSlot(state, desiredZone, sid);
      actor = {
        id: sid, sessionId: sid, kind: 'session', charIdx: charIndexFor(s.projectName),
        activity, zone: alloc.zone, migratingTo: null, slotIdx: alloc.idx,
        tx: SPAWN_TILE.tx, ty: SPAWN_TILE.ty, path: [], dir: 'down', animFrame: 0, done: false,
      };
      state.actors.set(sid, actor);
      retarget(actor, slotPositionFor(alloc.zone, alloc.idx));
      return;
    }

    // Erreur : le perso s'effondre SUR PLACE (transposé v3/I2), même en
    // pleine migration — `zone`/`migratingTo` intacts, un futur sync
    // recalculera `desiredZone` et re-routera depuis la position gelée.
    if (activity === 'down') {
      actor.activity = activity;
      actor.path = [];
      actor.done = false;
      return;
    }

    // Zone EFFECTIVE (cap lounge résolu, cf. `effectiveZoneFor`) différente
    // de la zone physique actuelle → migration. Comparer sur `desiredZone`
    // brut ici reproduirait le bug du pacing perpétuel (cf. commentaire de
    // `effectiveZoneFor`) : un débordé déjà installé en agents, avec le
    // lounge toujours plein, ne doit JAMAIS redéclencher de migration à
    // snapshot inchangé.
    const effectiveZone = effectiveZoneFor(state, desiredZone, sid);
    if (effectiveZone !== actor.zone) {
      if (actor.migratingTo !== effectiveZone) {
        actor.migratingTo = effectiveZone;
        actor.activity = activity;
        actor.done = false; // annule un `leave` définitif en cours (résurrection avant sortie complète)
        retarget(actor, { ...SPAWN_TILE });
      } else {
        actor.activity = activity;
        retarget(actor, { ...SPAWN_TILE }); // no-op si déjà en route, relance si gelé (reprise post-erreur)
      }
      return;
    }

    // Zone cible = zone physique actuelle : annule une migration en cours
    // si l'état est revenu à la case départ AVANT la sortie effective.
    if (actor.migratingTo !== null) {
      actor.migratingTo = null;
      actor.activity = activity;
      actor.done = false;
      retarget(actor, slotPositionFor(actor.zone, actor.slotIdx));
      return;
    }

    // Résurrection pendant un `leave` définitif (session repartie avant que
    // l'appelant ait supprimé l'acteur).
    if (actor.activity === 'leave' && actor.migratingTo === null) {
      const stillHeld = state.slots[actor.zone].has(sid);
      actor.activity = activity;
      actor.done = false;
      if (stillHeld) {
        retarget(actor, slotPositionFor(actor.zone, actor.slotIdx));
      } else {
        const alloc = allocateSessionSlot(state, desiredZone, sid);
        actor.zone = alloc.zone; actor.slotIdx = alloc.idx;
        retarget(actor, slotPositionFor(alloc.zone, alloc.idx));
      }
      return;
    }

    if (actor.activity !== activity) {
      actor.activity = activity;
      actor.animFrame = 0;
      retarget(actor, slotPositionFor(actor.zone, actor.slotIdx));
    }
  }

  function syncHeadlessActor(state, s) {
    const aid = `${s.sessionId}:headless`;
    if (state.actors.has(aid)) return;
    if (slotCount(state, 'headless', 'headless') >= MAX_HEADLESS) return; // cap atteint → overflow (roomFor)
    const idx = allocateSlot(state, 'headless', 'headless', aid);
    const p = headlessPosition(idx);
    state.actors.set(aid, {
      id: aid, sessionId: s.sessionId, kind: 'headless', charIdx: charIndexFor(s.projectName),
      activity: 'work', zone: 'headless', migratingTo: null, slotIdx: idx,
      tx: p.chairTx, ty: p.chairTy, path: [], dir: 'down', animFrame: 0, done: false,
    });
  }

  // Agents de workflow (deep-research), plafonnés GLOBALEMENT (dédup runId,
  // transposé de v3).
  function syncWorkflowAgents(state, allSessions) {
    const wanted = new Set();
    for (const s of allSessions) {
      const sid = s.sessionId;
      const n = Math.min(workflowRunning(s), MAX_DR);
      for (let i = 0; i < n; i++) {
        const aid = `${sid}:wf:${i}`;
        wanted.add(aid);
        if (!state.actors.has(aid)) {
          if (slotCount(state, 'dr', 'workflow') >= MAX_DR) continue;
          const idx = allocateSlot(state, 'dr', 'workflow', aid);
          const p = drPosition(idx);
          state.actors.set(aid, {
            id: aid, sessionId: sid, kind: 'workflow', charIdx: (charIndexFor(sid) + i + 1) % 10,
            activity: 'work', zone: 'dr', migratingTo: null, slotIdx: idx,
            tx: p.tx, ty: p.ty, path: [], dir: 'down', animFrame: 0, done: false,
          });
        }
      }
    }
    for (const [aid, a] of state.actors) {
      if (a.kind === 'workflow' && !wanted.has(aid)) { freeSlot(state, 'dr', aid); state.actors.delete(aid); }
    }
  }

  // Subagents : PAS un pool global (contrairement à v3) — adjacents au poste
  // COURANT de leur parent, jusqu'à MAX_SUB_PER_PARENT. Un parent qui n'a pas
  // ACTUELLEMENT de poste agents (encore en lounge, ou en pleine migration)
  // ne fait apparaître aucun portable : l'adjacence n'a de sens que si le
  // poste existe physiquement (décision documentée — cas rare en pratique,
  // les subagents ne tournent que pendant un run actif, donc le parent est
  // quasi toujours en zone agents à ce moment).
  function syncSubagents(state, allSessions) {
    const wanted = new Set();
    for (const s of allSessions) {
      const parent = state.actors.get(s.sessionId);
      if (!parent || parent.kind !== 'session' || parent.zone !== 'agents') continue;
      const subs = (s.subagents || []).slice(0, MAX_SUB_PER_PARENT);
      const pos = agentStationPosition(parent.slotIdx);
      subs.forEach((sub, i) => {
        const aid = `${s.sessionId}:sub:${sub.agentId}`;
        wanted.add(aid);
        const spot = pos.laptop[i];
        const existing = state.actors.get(aid);
        if (!existing) {
          state.actors.set(aid, {
            id: aid, sessionId: s.sessionId, kind: 'subagent', charIdx: charIndexFor(sub.agentId),
            activity: 'work', zone: 'agents', migratingTo: null, slotIdx: i,
            tx: spot.tx, ty: spot.ty, path: [], dir: 'down', animFrame: 0, done: false,
          });
        } else {
          // Le poste du parent a pu changer (nouvelle migration terminée) :
          // le portable suit, sans marche (apparition directe, cf. tête de
          // fichier).
          existing.tx = spot.tx; existing.ty = spot.ty;
        }
      });
    }
    for (const [aid, a] of state.actors) {
      if (a.kind === 'subagent' && !wanted.has(aid)) state.actors.delete(aid);
    }
  }

  function syncActors(state, snapshot) {
    const interactive = (snapshot && snapshot.interactive) || [];
    const background = (snapshot && snapshot.background) || [];
    const all = [...interactive, ...background];
    const liveSessionIds = new Set(all.map(s => s.sessionId));

    for (const s of interactive) syncMainActor(state, s);
    for (const s of background) syncHeadlessActor(state, s);
    syncWorkflowAgents(state, all);
    syncSubagents(state, all); // après syncMainActor : lit la zone/slot COURANT du parent

    // Classification courante (flip isBackground, I3 transposé) : une
    // session qui bascule interactive⇄headless reste VIVANTE (toujours dans
    // liveSessionIds), donc un simple test "disparu" ne suffit pas.
    const isBgNow = new Map();
    for (const s of interactive) isBgNow.set(s.sessionId, false);
    for (const s of background) isBgNow.set(s.sessionId, true);

    for (const [aid, a] of state.actors) {
      const stillLive = liveSessionIds.has(a.sessionId);
      const currentlyBg = isBgNow.get(a.sessionId);

      if (a.kind === 'headless') {
        if (!stillLive || currentlyBg === false) { freeSlot(state, 'headless', aid); state.actors.delete(aid); }
        continue;
      }
      if (a.kind !== 'session') continue; // subagent/workflow déjà nettoyés ci-dessus

      const shouldLeave = !stillLive || currentlyBg === true;
      if (shouldLeave && (a.activity !== 'leave' || a.migratingTo !== null)) {
        a.activity = 'leave';
        a.migratingTo = null;
        retarget(a, { ...SPAWN_TILE });
      }
    }
  }

  // Un seul canvas (v4) : tous les acteurs, triés par ty (ordre de dessin).
  function actorsAll(state) {
    return [...state.actors.values()].sort((a, b) => a.ty - b.ty);
  }

  // ─── tickActor : un pas de marche, ou le téléport de fin de migration ────
  function isAtSpawn(actor) { return actor.tx === SPAWN_TILE.tx && actor.ty === SPAWN_TILE.ty; }

  function tickActor(actor, state) {
    if (actor.path.length === 0) {
      if (actor.kind === 'session' && actor.migratingTo !== null && isAtSpawn(actor)) {
        const wanted = actor.migratingTo;
        freeSlot(state, actor.zone, actor.id); // libéré seulement ICI (permet l'annulation sans réallocation)
        const alloc = allocateSessionSlot(state, wanted, actor.id); // cap lounge réévalué AU MOMENT de l'arrivée
        actor.zone = alloc.zone; actor.slotIdx = alloc.idx; actor.migratingTo = null;
        actor.tx = SPAWN_TILE.tx; actor.ty = SPAWN_TILE.ty;
        retarget(actor, slotPositionFor(alloc.zone, alloc.idx));
        return false;
      }
      if (actor.kind === 'session' && actor.activity === 'leave' && actor.migratingTo === null && isAtSpawn(actor)) {
        freeSlot(state, actor.zone, actor.id);
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
        return actor.kind === 'workflow' ? `${c}.idle.down` : `${c}.idle.up`;
      case 'relax': return `${c}.idle.down`;   // lounge : face caméra, pas de bureau
      default: return `${c}.idle.down`;
    }
  }

  // --- Émotes (bulle au-dessus du perso principal) — INCHANGÉ depuis v2/v3 ---
  const STATE_EMOTES = {
    thinking: 'emote.think',
    pending: 'emote.alert',
    error: 'emote.angry',
    waiting: 'emote.zzz',
  };

  function emoteFor(session, bellActive) {
    if (bellActive) return 'emote.mail';
    const stateName = session && session.state && session.state.name;
    if (stateName === 'running') return 'emote.work';
    if (Object.prototype.hasOwnProperty.call(STATE_EMOTES, stateName)) return STATE_EMOTES[stateName];
    return null;
  }

  // ─── Étiquette pixel : nom projet tronqué (8 car.) ───────────────────────
  function labelFor(actor, session) {
    const name = (session && (session.customName || session.projectName)) || '';
    return String(name).slice(0, 8);
  }

  return {
    createState, roomFor, syncActors, actorsAll, tickActor, animFor, activityFor,
    zoneForState, charIndexFor, workflowRunning, emoteFor, labelFor,
    COLS, CORRIDOR_TX, DOOR_TILE, SPAWN_TILE,
    LOUNGE_CAP, MAX_SUB_PER_PARENT, MAX_DR, MAX_HEADLESS,
    AGENTS_TOP, HEADLESS_TOP, DR_TOP, DR_ROWS, LOUNGE_TOP, LOUNGE_ROWS,
  };
});
