// Tests de scripts/registres.mjs (#697) : `node --test scripts/registres.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "registres-"));
fs.mkdirSync(path.join(root, "registres", "archives"), { recursive: true });
process.env.REGISTRES_ROOT = root;
process.env.REGISTRES_TODAY = "2026-10-14";
process.env.REGISTRES_MEMORY_DIR = path.join(root, "pas-de-memoire");
const m = await import("./registres.mjs");

const write = (rel, text) => fs.writeFileSync(path.join(root, "registres", rel), text);
const readR = (rel) => fs.readFileSync(path.join(root, "registres", rel), "utf8");

test("le découpage en sections est sans perte", () => {
  const text = "# T\n\nintro\n\n## A 2026-10-01\n\nx\n\n\n## B\ny\n";
  const { preamble, sections } = m.splitSections(text);
  assert.equal([preamble, ...sections.map((s) => s.body)].join("\n"), text);
});

test("TASKS : une section close de plus de 7 jours part, une ouverte ou récente reste", () => {
  const plan = m.planTasks(
    "# TASKS\n\n## 2026-09-20 - livré\na\n## 2026-09-20 - dette OUVERT\nb\n## 2026-10-12 - session\nc\n## sans date\nd\n",
    new Date("2026-10-14T12:00:00Z"),
  );
  assert.deepEqual(plan.move.map((s) => s.title), ["## 2026-09-20 - livré"]);
  assert.equal(plan.keep.length, 3);
});

test("LRN : au-delà de 80, les plus anciennes partent, jamais une FUSION", () => {
  const entries = Array.from({ length: 85 }, (_, i) => `## LRN-${300 + i} - 2026-10-01 - e${i}\nx\n`).join("");
  const plan = m.planLrn(`# LRN\n\n## Sommaire\n- a\n## LRN-242 - 2026-08-24 - FUSION : référence\nf\n${entries}`);
  assert.equal(plan.active, 86);
  assert.equal(plan.move.length, 6);
  assert.ok(plan.move.every((s) => !/FUSION/.test(s.title)));
  assert.equal(plan.move[0].title.slice(0, 11), "## LRN-300 ");
});

test("rotate déplace sans perdre, refuse de recopier une section déjà archivée, et complète le sommaire d'ADR", () => {
  write("TASKS.md", "# TASKS\n\n## 2026-09-01 - fini\nx\n## 2026-10-13 - en cours\ny\n");
  write("journal.md", "# Journal\n\n## 2026-10-02 - oct\na\n## 2026-09-30 - sept\nb\n");
  write("LRN.md", "# LRN\n\n## Sommaire\n- s\n");
  write("ADR.md", "# ADR\n\n## Sommaire\n\n- ADR-001 - 2026-06-12 - un\n- ADR-003 - 2026-10-02 - trois\n\n---\n\n## ADR-002 - 2026-09-03 - deux\ntexte deux\n\n## ADR-003 - 2026-10-02 - trois\ntexte trois\n");
  const report = m.rotate();
  assert.ok(report.some((l) => l.includes("TASKS-2026-Q3")));
  assert.match(readR("TASKS.md"), /en cours/);
  assert.doesNotMatch(readR("TASKS.md"), /fini/);
  assert.match(readR("archives/TASKS-2026-Q3.md"), /## 2026-09-01 - fini/);
  assert.match(readR("archives/journal-2026-09.md"), /## 2026-09-30 - sept/);
  assert.doesNotMatch(readR("ADR.md"), /texte deux/);
  assert.match(readR("archives/ADR-2026-Q3.md"), /texte deux/);
  // ADR-002 n'avait pas de ligne : posée entre 001 et 003.
  assert.match(readR("ADR.md"), /- ADR-001[^\n]*\n- ADR-002 - 2026-09-03 - deux\n- ADR-003/);
  assert.deepEqual(m.rotate(), []);
  // Une section remise par erreur dans TASKS alors qu'elle est déjà archivée : refus, rien d'écrit.
  write("TASKS.md", "# TASKS\n\n## 2026-09-01 - fini\nx\n");
  assert.throws(() => m.rotate(), /déjà dans TASKS-2026-Q3.md/);
  assert.match(readR("TASKS.md"), /fini/);
});
