# Jauge de consommation Claude dans la barre de menu — Design

**Date** : 2026-07-06
**Statut** : validé (design), plan d'implémentation à suivre
**Origine** : idée d'Etienne — voir le taux de conso Claude « directement dans la barre du haut, comme le wifi et l'heure ».

## Objectif

Afficher en permanence, dans la barre de menu macOS (le tray de l'app), l'état du **quota de rate limit 5 h** de Claude Code : pourcentage consommé + temps restant avant reset, sous forme d'un **anneau de progression** qui se remplit et change de couleur, doublé du chiffre exact en texte.

Cible d'affichage : `[anneau coloré] 5H 27% · 35m` dans la barre, entre les apps et le wifi.

## Source de données (prouvé par spike le 2026-07-06)

Claude Code passe à **tout script de statusline** (mécanisme officiel `statusLine` dans `settings.json`) un JSON sur stdin qui contient :

```json
"rate_limits": {
  "five_hour": { "used_percentage": 27, "resets_at": 1783360800 },
  "seven_day": { "used_percentage": 72, "resets_at": 1783706400 }
}
```

Vérifié en conditions réelles sur **Claude Code v2.1.201** (payload capturé : `five_hour` 27 %, reset dans 35 min ; `seven_day` 72 %). C'est la **donnée serveur réelle** (issue des en-têtes `anthropic-ratelimit-unified-5h-*`), pas une estimation, et son obtention par ce canal **ne consomme aucun quota**.

Le même payload expose en bonus : `cost`, `context_window`, `model`, `session_name`, `exceeds_200k_tokens` — réutilisables pour enrichir la statusline reproduite.

**Contrainte structurante** : `rate_limits` n'est exposé **que** via la statusline. Aucun hook ni fichier local ne le contient. La statusline étant un slot unique, activer la jauge **remplace la statusline native** de Claude Code — qu'il faut donc reproduire (voir plus bas).

## Architecture

```
statusLine custom ──écrit (atomique)──▶ état JSON ──lit──▶ watcher ──▶ tray
  (à chaque tour CC)                    ~/.claude/aby-watcher/           setImage(anneau)
  extrait rate_limits + cost            ratelimit.json                  setTitle("5H 27% · 35m")
  rend la ligne native reproduite
```

### Composants

1. **Script de statusline** (`assets/statusline/aby-statusline.js`, installé et référencé par chemin absolu dans `~/.claude/settings.json`)
   - Entrée : payload JSON de Claude Code sur stdin.
   - Effet de bord : écrit `rate_limits` + `cost` + `model` + `ts` dans le fichier d'état, en **écriture atomique** (fichier temporaire + `rename`).
   - Sortie : une ligne de statusline **reproduisant le rendu natif** (contexte projet · modèle · ctx · coût · `5H % ⧗reset`), pour que l'utilisateur ne perde rien visuellement.
   - Zéro dépendance lourde ; doit s'exécuter en quelques ms (appelé à chaque refresh CC).

2. **Fichier d'état** `~/.claude/aby-watcher/ratelimit.json`
   - Forme : `{ five_hour:{used_percentage,resets_at}, seven_day:{used_percentage,resets_at}, cost, model, ts }`.
   - `ts` = epoch d'écriture, pour détecter la fraîcheur.
   - Écrit par n'importe quelle session active ; `rate_limits` étant un état **de compte** (pas par session), toute session donne la même valeur → la dernière écriture fait foi.

3. **Lecteur (watcher.js)**
   - Lit le fichier d'état dans la boucle de poll existante (250 ms) — ou `fs.watch` sur le fichier avec fallback poll.
   - Recalcule le **temps restant** depuis `resets_at` (timestamp absolu) → défile juste même sans session Claude ouverte.
   - Gère le **post-reset** : si `now > resets_at`, considère la fenêtre écoulée → `used_percentage` affiché = 0 % (état « rechargé ») en attendant la prochaine écriture.
   - Expose l'état via IPC vers le main / renderer.

4. **Générateur d'icône anneau** (`ring-icon.js`)
   - Entrée : `(used_percentage)` → **image PNG** de l'anneau.
   - Dessin sur canvas dans le renderer (le seul contexte avec canvas), `toDataURL('image/png')` @2x pour le Retina, envoi au main par IPC.
   - Main : `nativeImage.createFromDataURL` → `tray.setImage`.
   - Image **non-template** (couleur volontaire) ; l'anneau + une track grise translucide restent lisibles sur barre claire **et** sombre. Aucun texte dans l'image (le texte passe par `setTitle`, monochrome auto-adapté par macOS).
   - Régénérée seulement quand le % (arrondi à l'entier) change, pour éviter le travail inutile.

5. **Tray (main.js)**
   - `setImage(anneau)` + `setTitle("5H 27% · 35m")`.
   - Menu contextuel : bascule affichage 7 j, activer/désactiver la jauge, lien vers réglages.

### Décisions UX (défauts, ajustables)

- **Anneau + texte** ensemble : l'anneau pour le coup d'œil couleur, le texte pour le chiffre précis.
- **Seuils de couleur** : vert < 50 %, ambre 50–80 %, rouge > 80 %, gris = fenêtre rechargée. Couleurs système macOS (`#28c451` / `#ff9f0a` / `#ff453a`).
- **Fenêtre affichée** : 5 h en principal. Le 7 j reste secondaire (menu contextuel ou réglage), pas dans le titre par défaut.
- **Format du titre** : `5H 27% · 35m`. Le reset s'affiche en minutes sous 1 h, en heures au-delà.

## Installation de la statusline (consentement)

Comme activer la jauge **remplace la statusline native**, l'app ne doit jamais patcher `settings.json` en douce :

- Action explicite dans l'app (« Activer la jauge de conso »), avec explication du remplacement et bouton de désactivation.
- À l'activation : backup de la valeur `statusLine` existante, écriture du script, patch `settings.json`.
- À la désactivation : restauration de la valeur d'origine, retrait du script.
- Réversibilité totale garantie.

## Cas limites

- **Pas de session Claude active** : le fichier d'état n'est plus rafraîchi, mais le temps restant reste correct (recalcul depuis `resets_at`). Le % peut être légèrement périmé — acceptable, il ne monte que si on consomme (donc si une session tourne).
- **Fenêtre expirée** (`now > resets_at`) : afficher 0 % / « rechargé » sans attendre une nouvelle écriture.
- **Champ `rate_limits` absent** (régression de version CC, cf. historique v2.1.96) : le lecteur tolère l'absence → l'anneau passe en état « indisponible » (gris, pas de %), pas de crash.
- **Multi-sessions** : dernière écriture gagne ; valeurs identiques de toute façon.
- **Écriture concurrente** : atomicité par temp + `rename`.

## Tests

- **Faisabilité** : ✅ déjà validée (spike, payload capturé).
- Génération d'icône : rendu correct de l'anneau à 0 / 27 / 50 / 80 / 81 / 100 %, couleurs aux bons seuils, lisibilité sur fond clair et sombre.
- Post-reset : `resets_at` dans le passé → 0 % affiché.
- Fraîcheur : temps restant décrémente sans session active.
- Absence de `rate_limits` : état « indisponible », pas de crash.
- Install/désinstall : `settings.json` restauré à l'identique après désactivation.

## Hors périmètre (v1)

- Graphe historique de consommation.
- Notifications de seuil (80 %/90 %) — le watcher a déjà une infra de notif, à brancher en v2 si besoin.
- Jauge répliquée dans la fenêtre principale du renderer — le focus v1 est le tray.
- Affichage du 7 j dans le titre par défaut.

## Points à confirmer avant/pendant l'implémentation

1. **Fidélité de reproduction de la statusline native** : reconstruire au plus proche à partir du payload ; itérer avec Paul sur le format exact.
2. **Chaîne de dessin de l'icône** : renderer→IPC→main retenue faute de canvas côté main ; valider la latence et le rendu Retina.
3. **Lisibilité de l'anneau couleur** sur les deux thèmes de barre de menu (clair/sombre) sans passer en template.
4. **Piège `build.files`** : tout nouveau module `.js` (ex. `ring-icon.js`) et le script de statusline embarqué doivent être ajoutés à `package.json` → `build.files`, sinon le DMG crashe au lancement (invisible en dev). Vérifier avant release.
