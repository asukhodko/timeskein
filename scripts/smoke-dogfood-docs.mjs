#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const checkedFiles = [
  "README.md",
  "docs/index.md",
  "docs/current-implementation.md",
  "docs/dogfood-day.md",
  "docs/dogfood-release-candidate.md",
  "docs/dogfood-release-baseline.md",
  "docs/dogfood-periodic-report.md",
  "docs/roadmap/README.md",
  "docs/roadmap/0003-periodic-reflection-roadmap.md",
  "docs/roadmap/0004-in-day-structure-roadmap.md",
];

const forbiddenPatterns = [
  /\bblockers?\b/iu,
  /\bhard blockers?\b/iu,
  /\boptional review items?\b/iu,
  /\bReview before report\b/u,
  /\bCopy Draft\b/u,
  /Копировать черновик/u,
];

const failures = [];

for (const file of checkedFiles) {
  const text = await readFile(resolve(repoRoot, file), "utf8");
  if (
    file === "docs/current-implementation.md" &&
    !text.includes("typed draft is stored locally per day and is cleared only after a successful add")
  ) {
    failures.push(`${file}: Day Event draft persistence is not documented`);
  }
  if (
    file === "docs/current-implementation.md" &&
    !text.includes("The draft is stored locally per day and Work Item")
  ) {
    failures.push(`${file}: Work Item event draft persistence is not documented`);
  }
  if (
    file === "docs/dogfood-day.md" &&
    !text.includes("Черновик этой строки сохраняется локально для текущего дня")
  ) {
    failures.push(`${file}: dogfood protocol does not mention Day Event draft recovery`);
  }
  if (
    file === "docs/dogfood-day.md" &&
    !text.includes("Черновик события дела сохраняется локально для текущего дня и конкретного дела")
  ) {
    failures.push(`${file}: dogfood protocol does not mention Work Item event draft recovery`);
  }
  if (file === "docs/index.md" && !text.includes("In-Day Structure Roadmap")) {
    failures.push(`${file}: documentation index does not link the in-day structure roadmap`);
  }
  if (
    file === "README.md" &&
    (!text.includes("pnpm report:period -- --from 2026-07-01 --to 2026-07-10") ||
      !text.includes("Candidates are prompts for conscious review"))
  ) {
    failures.push(`${file}: period report command or interpretation boundary is missing`);
  }
  if (
    file === "docs/current-implementation.md" &&
    (!text.includes("## Period Reports") || !text.includes("pnpm smoke:period-report"))
  ) {
    failures.push(`${file}: current period report implementation or smoke coverage is missing`);
  }
  if (
    file === "docs/roadmap/README.md" &&
    (!text.includes("Keep the accepted daily-control gate green") ||
      !text.includes("Keep the accepted in-day structure layer useful") ||
      !text.includes("Continue the active periodic-reflection layer"))
  ) {
    failures.push(`${file}: roadmap README does not preserve the current product order`);
  }
  if (
    file === "docs/roadmap/0003-periodic-reflection-roadmap.md" &&
    (!text.includes("сначала смысл результата") ||
      !text.includes("Roadmap 0004") ||
      !text.includes("Статус: **готово**"))
  ) {
    failures.push(`${file}: periodic reflection roadmap does not keep outcome-first ordering after in-day structure`);
  }
  if (
    file === "docs/dogfood-periodic-report.md" &&
    (!text.includes("39:53:26") ||
      !text.includes("P0 Period Report CLI: принят") ||
      !text.includes("уже завершённая встреча"))
  ) {
    failures.push(`${file}: real period dogfood evidence or known limitation is missing`);
  }
  if (
    file === "docs/roadmap/0004-in-day-structure-roadmap.md" &&
    (!text.includes("без параллельной заметки \"Timeskein, день N\"") ||
      !text.includes("потеря управляемости") ||
      !text.includes("уже закрыто: дешёвое закрытие дня"))
  ) {
    failures.push(`${file}: in-day structure roadmap does not preserve the next-layer acceptance criteria`);
  }
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(line)) {
        failures.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Dogfood docs still contain stale or scary closure wording:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked_files: checkedFiles.length,
    },
    null,
    2
  )
);
