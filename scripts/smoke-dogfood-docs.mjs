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
  "docs/dogfood-operational-reality.md",
  "docs/dogfood-learnings.md",
  "docs/acceptance-causal-work-spine-v1.md",
  "docs/roadmap/README.md",
  "docs/roadmap/0003-periodic-reflection-roadmap.md",
  "docs/roadmap/0004-in-day-structure-roadmap.md",
  "docs/roadmap/0005-causal-work-memory-roadmap.md",
  "docs/adr/0004-user-truth-and-derived-inference.md",
  "docs/rfc/0009-causal-work-memory-and-operational-reality.md",
];

const forbiddenPatterns = [
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
  if (
    file === "docs/index.md" &&
    (!text.includes("In-Day Structure Roadmap") || !text.includes("Causal Work Memory Roadmap"))
  ) {
    failures.push(`${file}: documentation index does not link the accepted and north-star roadmaps`);
  }
  if (
    file === "README.md" &&
    (!text.includes("pnpm report:period -- --from 2026-07-01 --to 2026-07-10") ||
      !text.includes("Candidates are prompts for conscious review") ||
      !text.includes("pnpm reflection:save") ||
      !text.includes("pnpm reflection:list"))
  ) {
    failures.push(`${file}: period report/reflection command or interpretation boundary is missing`);
  }
  if (
    file === "docs/current-implementation.md" &&
    (!text.includes("## Period Reports") || !text.includes("pnpm smoke:period-report"))
  ) {
    failures.push(`${file}: current period report implementation or smoke coverage is missing`);
  }
  if (
    file === "docs/roadmap/README.md" &&
    (!text.includes("Keep the accepted manual foundation green") ||
      !text.includes("Use the accepted architecture gate") ||
      !text.includes("Converge the operational workspace") ||
      !text.includes("Close the manual working-memory gap") ||
      !text.includes("Operational Workspace convergence") ||
      !text.includes("Bounded Context Capture Probe") ||
      !text.includes("Working Memory Bridge") ||
      !text.includes("Causal period review") ||
      !text.includes("Twelve real workdays"))
  ) {
    failures.push(`${file}: roadmap README does not preserve the north-star product order`);
  }
  if (
    file === "docs/dogfood-learnings.md" &&
    (!text.includes("twelve real workdays") ||
      !text.includes("The difficult part is usually the transition") ||
      !text.includes("Operational Reality is the strongest new direction") ||
      !text.includes("M2: Operational Workspace convergence") ||
      !text.includes("M3: Working Memory Bridge") ||
      !text.includes("M5: Bounded Context Capture Probe"))
  ) {
    failures.push(`${file}: cross-day findings or the evidence-derived route is missing`);
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
    file === "docs/dogfood-operational-reality.md" &&
    (!text.includes("pnpm operational-reality:gate") ||
      !text.includes("намерение -> результат с Ref -> следующий шаг") ||
      !text.includes("Не нужно искусственно использовать все состояния"))
  ) {
    failures.push(`${file}: Operational Reality dogfood path or interpretation boundary is missing`);
  }
  if (
    file === "docs/acceptance-causal-work-spine-v1.md" &&
    (!text.includes("**Принято 2026-07-16.**") ||
      !text.includes("11/3") ||
      !text.includes("overlapping_focus_sessions") ||
      !text.includes("superseded result") ||
      !text.includes("последний пользовательский критерий остаётся смысловым"))
  ) {
    failures.push(`${file}: acceptance audit does not preserve the accepted real-use gate and trust boundary`);
  }
  if (
    file === "docs/roadmap/0004-in-day-structure-roadmap.md" &&
    (!text.includes("без параллельной заметки \"Timeskein, день N\"") ||
      !text.includes("потеря управляемости") ||
      !text.includes("уже закрыто: дешёвое закрытие дня"))
  ) {
    failures.push(`${file}: in-day structure roadmap does not preserve the next-layer acceptance criteria`);
  }
  if (
    file === "docs/roadmap/0005-causal-work-memory-roadmap.md" &&
    (!text.includes("## Северная звезда") ||
      !text.includes("M1. Causal Work Spine and Operational Reality v1") ||
      !text.includes("M2. Operational Workspace convergence") ||
      !text.includes("M3. Working Memory Bridge") ||
      !text.includes("M4. Causal Period Review") ||
      !text.includes("M5. Bounded Context Capture Probe") ||
      !text.includes("## Риск-гейты") ||
      !text.includes("не переписывать всю базу на event sourcing"))
  ) {
    failures.push(`${file}: north-star roadmap is missing the causal route or risk gates`);
  }
  if (
    file === "docs/adr/0004-user-truth-and-derived-inference.md" &&
    (!text.includes("Пользовательское состояние остаётся авторитетным") ||
      !text.includes("Машинная интерпретация является производной"))
  ) {
    failures.push(`${file}: user-truth boundary is missing`);
  }
  if (
    file === "docs/rfc/0009-causal-work-memory-and-operational-reality.md" &&
    (!text.includes("## Причинная цепочка") ||
      !text.includes("## Operational Reality") ||
      !text.includes("## Ограниченный Context Probe") ||
      !text.includes("## Инкрементальная миграция"))
  ) {
    failures.push(`${file}: causal model or bounded probe contract is missing`);
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
