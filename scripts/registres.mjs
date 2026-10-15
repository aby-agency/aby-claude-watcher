#!/usr/bin/env node
// Registres bornés (promu de Cercla #697, ADR-206 D6 ; template-aby 1.4.0) : les registres sont lus à chaque
// session et grossissaient sans fin, faute d'automatisme (TASKS 500 Ko et
// 158 sections, journal 600 Ko en quatorze jours, LRN 240 entrées actives
// pour un seuil de 80, consolidation du 2026-10-12 jamais faite). Une
// consolidation « à faire » n'a jamais lieu (LRN-486) : ce script la rend
// mécanique. Il DÉPLACE, il ne supprime jamais (le total des sections est
// vérifié avant d'écrire).
//
//   node scripts/registres.mjs check [--quiet]   seuils ; --quiet : une ligne, rien si tout va bien
//   node scripts/registres.mjs rotate [--dry]    TASKS clos > 7 j, journal hors mois courant, LRN au-delà de 80,
//                                                texte des ADR des trimestres passés, sommaire d'ADR complété
//
// Sans dépendance (Node seul). Lancé par le hook SessionStart en `check --quiet`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.REGISTRES_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REG = path.join(ROOT, "registres");
const ARCH = path.join(REG, "archives");
const TODAY = process.env.REGISTRES_TODAY ? new Date(`${process.env.REGISTRES_TODAY}T12:00:00Z`) : new Date();

// Seuils d'ADR-206 D6.
export const LIMITS = {
  // Ce qui est LU au démarrage d'une session (CLAUDE.md, « Démarrage de
  // session ») : TASKS, le sommaire d'ADR jusqu'à « --- », le sommaire de LRN.
  tasksBytes: 60_000,
  adrSummaryBytes: 80_000,
  lrnSummaryBytes: 30_000,
  lrnActive: 80,
  memoryBytes: 6_000,
  tasksClosedAfterDays: 7,
};

const OPEN_MARKERS = /OUVERT|EN COURS|BLOQUÉ|BLOQUE|blocked|à trancher|à ratifier|A TRANCHER|À TRANCHER|À RATIFIER/;

// ─── Découpage en sections « ## » ───────────────────────────────────────────
// Un registre = un préambule (tout avant le premier « ## ») + des sections.
export function splitSections(text) {
  const lines = text.split("\n");
  const preamble = [];
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      current = { title: line, lines: [line] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  return { preamble: preamble.join("\n"), sections: sections.map((s) => ({ title: s.title, body: s.lines.join("\n") })) };
}

/** Première date AAAA-MM-JJ du titre (l'entrée la plus ancienne d'une plage). */
export function dateOf(title) {
  const m = title.match(/(20\d{2})-(\d{2})-(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`) : null;
}

export const quarterOf = (date) => `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
const daysBetween = (a, b) => Math.floor((b.getTime() - a.getTime()) / 86_400_000);
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
const size = (file) => (fs.existsSync(file) ? fs.statSync(file).size : 0);
const join = (preamble, sections) => [preamble, ...sections.map((s) => s.body)].join("\n");

// ─── TASKS : une section close de plus de 7 jours part à l'archive ──────────
export function planTasks(text, today = TODAY) {
  const { preamble, sections } = splitSections(text);
  const keep = [];
  const move = [];
  for (const section of sections) {
    const date = dateOf(section.title);
    const open = OPEN_MARKERS.test(section.title);
    if (!open && date && daysBetween(date, today) > LIMITS.tasksClosedAfterDays) move.push(section);
    else keep.push(section);
  }
  return { preamble, keep, move };
}

// ─── Journal : le mois courant reste, le reste va par mois en archive ───────
export function planJournal(text, today = TODAY) {
  const { preamble, sections } = splitSections(text);
  const month = today.toISOString().slice(0, 7);
  const keep = [];
  const byMonth = new Map();
  for (const section of sections) {
    const date = dateOf(section.title);
    const key = date ? date.toISOString().slice(0, 7) : month;
    if (key === month) keep.push(section);
    else byMonth.set(key, [...(byMonth.get(key) ?? []), section]);
  }
  return { preamble, keep, byMonth };
}

// ─── LRN : au-delà de 80 entrées actives, les plus anciennes partent ────────
// Les fusions de référence (titre « FUSION ») restent toujours actives.
export function planLrn(text) {
  const { preamble, sections } = splitSections(text);
  const entries = sections.filter((s) => /^## LRN-\d+/.test(s.title));
  const others = sections.filter((s) => !/^## LRN-\d+/.test(s.title));
  const pinned = entries.filter((s) => /FUSION/.test(s.title));
  const plain = entries.filter((s) => !/FUSION/.test(s.title));
  const room = Math.max(0, LIMITS.lrnActive - pinned.length);
  const num = (s) => Number(s.title.match(/^## LRN-(\d+)/)[1]);
  const sorted = [...plain].sort((a, b) => num(a) - num(b));
  const move = sorted.slice(0, Math.max(0, sorted.length - room));
  const moved = new Set(move);
  return { preamble, keep: [...others, ...entries.filter((s) => !moved.has(s))], move, active: entries.length };
}

// ─── ADR : le texte des trimestres passés part en archive, le sommaire reste ─
// Une ADR se date par son titre (« ## ADR-NNN - AAAA-MM-JJ ») ; un amendement
// daté du trimestre courant garde l'ADR entière active.
export function planAdr(text, today = TODAY) {
  const { preamble, sections } = splitSections(text);
  const current = quarterOf(today);
  const keep = [];
  const byQuarter = new Map();
  const numberOf = (s) => s.title.match(/^## ADR-(\d+)/)?.[1];
  const recent = new Set(
    sections.filter((s) => numberOf(s) && dateOf(s.title) && quarterOf(dateOf(s.title)) === current).map(numberOf),
  );
  for (const section of sections) {
    const n = numberOf(section);
    const date = dateOf(section.title);
    if (!n || !date || recent.has(n)) keep.push(section);
    else byQuarter.set(quarterOf(date), [...(byQuarter.get(quarterOf(date)) ?? []), section]);
  }
  return { preamble, keep, byQuarter };
}

/** Lignes de sommaire manquantes, écrites depuis le titre de l'ADR. */
export function withAdrSummary(text, archiveTexts = []) {
  const gaps = new Set(adrSummaryGaps(text, archiveTexts.join("\n")));
  if (gaps.size === 0) return text;
  const titles = new Map();
  for (const source of [text, ...archiveTexts]) {
    for (const m of source.matchAll(/^## (ADR-(\d+) - .*)$/gm)) if (gaps.has(m[2]) && !titles.has(m[2])) titles.set(m[2], m[1]);
  }
  // Chaque ligne manquante s'insère avant la première ligne de numéro supérieur.
  const cut = text.indexOf("\n---\n");
  const head = text.slice(0, cut).split("\n");
  for (const [n, title] of [...titles.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const at = head.findIndex((line) => Number(line.match(/^- ADR-(\d+)/)?.[1] ?? -1) > Number(n));
    const lastListed = head.reduce((last, line, i) => (/^- ADR-\d+/.test(line) ? i : last), -1);
    head.splice(at === -1 ? lastListed + 1 : at, 0, `- ${title}`);
  }
  return `${head.join("\n")}${text.slice(cut)}`;
}

// ─── ADR : chaque ADR du texte a sa ligne de sommaire ───────────────────────
export function adrSummaryGaps(text, archiveText = "") {
  const head = text.split(/\n---\n/)[0];
  const listed = new Set([...head.matchAll(/^- ADR-(\d+)/gm)].map((m) => m[1]));
  const written = new Set([...`${text}\n${archiveText}`.matchAll(/^## ADR-(\d+)/gm)].map((m) => m[1]));
  return [...written].filter((n) => !listed.has(n)).sort();
}

function adrArchives() {
  if (!fs.existsSync(ARCH)) return [];
  return fs.readdirSync(ARCH).filter((f) => /^ADR-.*\.md$/.test(f)).map((f) => read(path.join(ARCH, f)));
}

function memoryDir() {
  const slug = ROOT.replace(/[/.]/g, "-");
  return process.env.REGISTRES_MEMORY_DIR ?? path.join(os.homedir(), ".claude", "projects", slug, "memory");
}

// ─── check ──────────────────────────────────────────────────────────────────
export function check() {
  const problems = [];
  const tasks = read(path.join(REG, "TASKS.md"));
  const tasksPlan = planTasks(tasks);
  if (size(path.join(REG, "TASKS.md")) > LIMITS.tasksBytes)
    problems.push(`TASKS.md ${Math.round(size(path.join(REG, "TASKS.md")) / 1000)} Ko > ${LIMITS.tasksBytes / 1000} Ko`);
  if (tasksPlan.move.length > 0) problems.push(`${tasksPlan.move.length} section(s) close(s) de plus de 14 jours dans TASKS.md`);
  const journalPlan = planJournal(read(path.join(REG, "journal.md")));
  const stale = [...journalPlan.byMonth.values()].reduce((n, list) => n + list.length, 0);
  if (stale > 0) problems.push(`${stale} entrée(s) de journal hors du mois courant`);
  const lrn = planLrn(read(path.join(REG, "LRN.md")));
  if (lrn.active > LIMITS.lrnActive) problems.push(`LRN : ${lrn.active} entrées actives > ${LIMITS.lrnActive}`);
  const gaps = adrSummaryGaps(read(path.join(REG, "ADR.md")), adrArchives().join("\n"));
  if (gaps.length > 0) problems.push(`sommaire d'ADR incomplet (${gaps.length} : ADR-${gaps.slice(0, 6).join(", ADR-")}${gaps.length > 6 ? "…" : ""})`);
  if (planAdr(read(path.join(REG, "ADR.md"))).byQuarter.size > 0) problems.push("texte d'ADR des trimestres passés encore dans ADR.md");
  const adrHead = Buffer.byteLength(read(path.join(REG, "ADR.md")).split(/\n---\n/)[0]);
  if (adrHead > LIMITS.adrSummaryBytes) problems.push(`sommaire d'ADR ${Math.round(adrHead / 1000)} Ko > ${LIMITS.adrSummaryBytes / 1000} Ko`);
  const lrnHead = Buffer.byteLength(splitSections(read(path.join(REG, "LRN.md"))).sections.filter((s) => !/^## LRN-/.test(s.title)).map((s) => s.body).join("\n"));
  if (lrnHead > LIMITS.lrnSummaryBytes) problems.push(`sommaire de LRN ${Math.round(lrnHead / 1000)} Ko > ${LIMITS.lrnSummaryBytes / 1000} Ko`);
  const mem = memoryDir();
  if (fs.existsSync(mem)) {
    const index = size(path.join(mem, "MEMORY.md"));
    if (index > LIMITS.memoryBytes) problems.push(`MEMORY.md ${Math.round(index / 1000)} Ko > ${LIMITS.memoryBytes / 1000} Ko`);
    const sessions = fs.readdirSync(mem).filter((f) => f.startsWith("project-session-")).length;
    if (sessions > 0) problems.push(`${sessions} fiche(s) de mémoire par session (le récit va au journal)`);
  }
  return problems;
}

// ─── rotate ─────────────────────────────────────────────────────────────────
function countSections(text) {
  return splitSections(text).sections.length;
}

function writeChecked(files, before) {
  const after = files.reduce((n, f) => n + countSections(f.content), 0);
  if (after !== before) throw new Error(`registres: ${before} sections avant, ${after} après ; rien n'est écrit`);
  for (const f of files) fs.writeFileSync(f.file, f.content);
}

function groupByQuarter(sections) {
  const groups = new Map();
  for (const section of sections) {
    const date = dateOf(section.title);
    const key = date ? quarterOf(date) : quarterOf(TODAY);
    groups.set(key, [...(groups.get(key) ?? []), section]);
  }
  return groups;
}

function appendSections(file, header, sections) {
  const existing = read(file) || `${header}\n`;
  // Rejeu sûr : une section déjà présente à l'identique dans l'archive n'y
  // est jamais recopiée (vu en écrivant l'outil : un second passage doublait
  // le texte des ADR).
  const already = new Set(splitSections(existing).sections.map((s) => s.body.replace(/\n+$/, "")));
  const duplicate = sections.find((s) => already.has(s.body.replace(/\n+$/, "")));
  if (duplicate) throw new Error(`registres: « ${duplicate.title.slice(0, 80)} » est déjà dans ${path.basename(file)} ; rien n'est écrit`);
  return `${existing.replace(/\n+$/, "")}\n\n${sections.map((s) => s.body.replace(/\n+$/, "")).join("\n\n")}\n`;
}

export function rotate({ dry = false } = {}) {
  const report = [];
  // TASKS
  const tasksFile = path.join(REG, "TASKS.md");
  const tasks = read(tasksFile);
  const t = planTasks(tasks);
  if (t.move.length > 0) {
    const files = [{ file: tasksFile, content: join(t.preamble, t.keep) }];
    let before = countSections(tasks);
    for (const [quarter, sections] of groupByQuarter(t.move)) {
      const file = path.join(ARCH, `TASKS-${quarter}.md`);
      before += countSections(read(file));
      files.push({ file, content: appendSections(file, `# TASKS - archive ${quarter} (verbatim)`, sections) });
      report.push(`TASKS : ${sections.length} section(s) close(s) → archives/TASKS-${quarter}.md`);
    }
    if (!dry) writeChecked(files, before);
    report.push(`TASKS : ${t.keep.length} section(s) gardée(s)`);
  }
  // Journal
  const journalFile = path.join(REG, "journal.md");
  const journal = read(journalFile);
  const j = planJournal(journal);
  if (j.byMonth.size > 0) {
    const files = [{ file: journalFile, content: join(j.preamble, j.keep) }];
    let before = countSections(journal);
    for (const [month, sections] of j.byMonth) {
      const file = path.join(ARCH, `journal-${month}.md`);
      before += countSections(read(file));
      files.push({ file, content: appendSections(file, `# Journal - ${month} (archive, verbatim)`, sections) });
      report.push(`journal : ${sections.length} entrée(s) de ${month} → archives/journal-${month}.md`);
    }
    if (!dry) writeChecked(files, before);
  }
  // LRN
  const lrnFile = path.join(REG, "LRN.md");
  const lrn = read(lrnFile);
  const l = planLrn(lrn);
  if (l.move.length > 0) {
    const files = [{ file: lrnFile, content: join(l.preamble, l.keep) }];
    let before = countSections(lrn);
    for (const [quarter, sections] of groupByQuarter(l.move)) {
      const file = path.join(ARCH, `LRN-${quarter}.md`);
      before += countSections(read(file));
      files.push({ file, content: appendSections(file, `# LRN - archive ${quarter} (verbatim, greppable par numéro)`, sections) });
      report.push(`LRN : ${sections.length} entrée(s) → archives/LRN-${quarter}.md`);
    }
    if (!dry) writeChecked(files, before);
    report.push(`LRN : ${l.active - l.move.length} entrée(s) active(s)`);
  }
  // ADR : texte des trimestres passés en archive, puis sommaire complété.
  const adrFile = path.join(REG, "ADR.md");
  const adr = read(adrFile);
  const a = planAdr(adr);
  let adrText = adr;
  if (a.byQuarter.size > 0) {
    adrText = join(a.preamble, a.keep);
    const files = [{ file: adrFile, content: adrText }];
    let before = countSections(adr);
    for (const [quarter, sections] of a.byQuarter) {
      const file = path.join(ARCH, `ADR-${quarter}.md`);
      before += countSections(read(file));
      files.push({ file, content: appendSections(file, `# ADR - archive ${quarter} (texte intégral, greppable par numéro)`, sections) });
      report.push(`ADR : ${sections.length} texte(s) → archives/ADR-${quarter}.md (sommaire inchangé)`);
    }
    if (!dry) writeChecked(files, before);
  }
  const current = dry ? adrText : read(adrFile);
  const missing = adrSummaryGaps(current, adrArchives().join("\n")).length;
  if (missing > 0) {
    if (!dry) fs.writeFileSync(adrFile, withAdrSummary(current, adrArchives()));
    report.push(`ADR : ${missing} ligne(s) de sommaire ajoutée(s)`);
  }
  return report;
}

// ─── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, ...flags] = process.argv.slice(2);
  if (command === "check") {
    const problems = check();
    if (flags.includes("--quiet")) {
      if (problems.length > 0) console.log(`registres : consolidation due (${problems.join(" ; ")}) - node scripts/registres.mjs rotate`);
    } else {
      console.log(problems.length === 0 ? "registres : dans les bornes (ADR-206 D6)" : problems.map((p) => `- ${p}`).join("\n"));
      process.exitCode = problems.length === 0 ? 0 : 1;
    }
  } else if (command === "rotate") {
    const report = rotate({ dry: flags.includes("--dry") });
    console.log(report.length === 0 ? "registres : rien à déplacer" : report.join("\n"));
  } else {
    console.error("usage : node scripts/registres.mjs check [--quiet] | rotate [--dry]");
    process.exitCode = 2;
  }
}
