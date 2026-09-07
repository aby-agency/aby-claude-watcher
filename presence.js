// presence.js — Présence de session publiée par Claude Code.
//
// Depuis ~2.1.260 le CLI réécrit ~/.claude/sessions/<pid>.json à chaque rendu
// avec `status` (busy | shell | idle | waiting), `waitingFor` (libellé du
// dialogue bloquant) et `statusUpdatedAt`. Dérivation côté CLI, vérifiée dans
// le binaire 2.1.263 :
//   waiting : un dialogue bloque (waitingFor = "permission prompt" par défaut,
//             "input needed", "sandbox request", "worker request",
//             "goal proposal", "dialog open" = menu /model, /config…)
//   busy    : isLoading || delegatedActive (tour en cours OU agents/teammates/
//             workflows/monitors actifs)
//   shell   : idle mais une tâche Bash de fond (local_bash) tourne encore
//   idle    : rien de tout ça
// Ce module est PUR : lecture + décision, aucun effet. Spec :
// docs/superpowers/specs/2026-09-07-presence-cli-design.md (volet A).

const PRESENCE_STATUSES = ['busy', 'shell', 'idle', 'waiting'];
const DIALOG_OPEN = 'dialog open';

// session.json brut → présence exploitable, ou null (CLI ancien, status inconnu,
// statusUpdatedAt absent). Un status inconnu n'est JAMAIS interprété : mieux
// vaut retomber sur la machine JSONL que deviner.
function readPresence(data) {
  if (!data || typeof data !== 'object') return null;
  if (!PRESENCE_STATUSES.includes(data.status)) return null;
  if (typeof data.statusUpdatedAt !== 'number' || !Number.isFinite(data.statusUpdatedAt)) return null;
  return {
    status: data.status,
    waitingFor: typeof data.waitingFor === 'string' ? data.waitingFor : undefined,
    statusUpdatedAt: data.statusUpdatedAt,
  };
}

// Que faire de cette présence pour une session dans `currentState` ?
//   target     : état cible ('waiting' | 'pending' | 'running') ou null (no-op)
//   trigger    : libellé pour main.log
//   at         : date de la transition = statusUpdatedAt (jamais Date.now())
//   silent     : transition antérieure au démarrage du watcher → pas de notif
//   mute       : la notif « Inactif » doit rester muette dans cet état
//   shell      : une tâche Bash de fond tourne (chip « bg process »)
//   dialogOpen : menu/dialogue local ouvert (chip « Dialogue ouvert », vert)
//   waitingFor : libellé brut du dialogue bloquant (tooltip), sinon null
function presenceDecision({ presence, currentState, stateSince, watcherStartedAt }) {
  const base = {
    target: null,
    trigger: null,
    at: presence.statusUpdatedAt,
    silent: presence.statusUpdatedAt < watcherStartedAt,
    mute: false,
    shell: false,
    dialogOpen: false,
    waitingFor: null,
  };
  // Garde d'ordre : un pending posé par le hook APRÈS l'écriture de cette
  // présence ne doit pas être dégradé par elle (race hook → scan).
  if (currentState === 'pending' && typeof stateSince === 'number'
      && presence.statusUpdatedAt < stateSince) {
    return base;
  }

  switch (presence.status) {
    case 'idle':
      if (currentState !== 'waiting') return { ...base, target: 'waiting', trigger: 'presence:idle' };
      return base;
    case 'shell':
      if (currentState !== 'waiting') return { ...base, target: 'waiting', trigger: 'presence:shell', shell: true, mute: true };
      return { ...base, shell: true, mute: true };
    case 'waiting':
      if (presence.waitingFor === DIALOG_OPEN) {
        if (currentState !== 'waiting') return { ...base, target: 'waiting', trigger: 'presence:dialog', dialogOpen: true, mute: true };
        return { ...base, dialogOpen: true, mute: true };
      }
      if (currentState !== 'pending') {
        return { ...base, target: 'pending', trigger: 'presence:waiting', waitingFor: presence.waitingFor || null };
      }
      return { ...base, waitingFor: presence.waitingFor || null };
    case 'busy':
      if (currentState === 'pending') return { ...base, target: 'running', trigger: 'presence:busy' };
      if (currentState === 'waiting') return { ...base, mute: true };
      return base; // thinking / running : le JSONL raffine déjà
    default:
      return base;
  }
}

module.exports = { readPresence, presenceDecision, PRESENCE_STATUSES, DIALOG_OPEN };
