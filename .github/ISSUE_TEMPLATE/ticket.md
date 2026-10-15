---
name: Ticket
about: Un ticket de construction : contexte, spécification, critères binaires, mesurables et conditions d'arrêt (doctrine Aby, registres § 7)
title: ""
labels: []
assignees: []
---

**Epic** : … · **Taille** : XS, S, M, L ou XL · **Dépend de** : #N, ou rien · **Bloque** : #N, ou rien

## Contexte

Pourquoi ce ticket existe : la décision (ADR-xxx), le retour du client, le défaut vu. Deux à cinq phrases.

## Références

- Maquette ou écran de référence.
- Specs et glossaire du projet (le vocabulaire suit le glossaire).

## Spécification

- Ce qui change, fichier par fichier ou règle par règle.
- Ce qui est hors scope, et le ticket qui le porte.

## Critères de succès

**Binaires** (deux conditions oui/non observables) :
1. …
2. …

**Mesurables** (trois vérifications cochables : commande, test, comparaison) :
- [ ] …
- [ ] …
- [ ] …

**Conditions d'arrêt** (ce qui force le stop et renvoie vers une décision humaine ou une ADR) :
- Le schéma de données doit changer hors de ce ticket → stop, ADR d'abord.
- …

<!--
À la prise : s'assigner (gh issue edit N --add-assignee @me), branche ticket/N-slug, commits feat(#N): ….
À la fin : la PR porte « Closes #N » ; le commentaire de clôture tient lieu de « Ce qui a été fait » :
mesures relevées, critères cochés, écarts assumés, ce qui reste (et son issue).
Une décision va dans registres/ADR.md, un pattern dans registres/LRN.md, un blocage > 30 min dans registres/TASKS.md.
-->
