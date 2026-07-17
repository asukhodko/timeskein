#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");

try {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = options.db
    ? resolve(options.db)
    : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
  if (!existsSync(dbPath)) throw new Error(`База Timeskein не найдена: ${dbPath}`);

  const baseArgs = [
    resolve(repoRoot, "scripts/report-period.mjs"),
    "--from", options.from,
    "--to", options.to,
    "--profile", "track-retrospective",
    "--track", options.track,
    "--db", dbPath,
  ];
  const [{ stdout: jsonText }, { stdout: markdown }] = await Promise.all([
    execFileAsync(process.execPath, [...baseArgs, "--format", "json"], { maxBuffer: 32 * 1024 * 1024 }),
    execFileAsync(process.execPath, [...baseArgs, "--format", "md"], { maxBuffer: 32 * 1024 * 1024 }),
  ]);
  const report = JSON.parse(jsonText);
  const story = report.evidence_story;
  if (!story) throw new Error("Отчёт не содержит evidence_story; проверь профиль и версию схемы.");

  const capturedBlocks = Number(report.classification?.captured_included_entrances ?? 0);
  const confirmedChanges = story.changes.filter((entry) => entry.confirmed);
  const typedEntriesWithCapturedClassification = story.entries.filter(
    (entry) => entry.provenance?.classification === "captured",
  );
  const explicitFollowups = story.decision_followups.filter(
    (followup) => followup.provenance === "explicit_followup",
  );
  const requiredFollowups = options.decisions.map((decision) => ({
    decision,
    match: explicitFollowups.find((followup) => followup.decision === decision),
  }));
  const requiredHeadings = [
    "## Что изменилось",
    "## Доказательства",
    "## Решения",
    "## Блокеры и хвосты",
    "## Что произошло после прошлых решений",
    "## Следующие действия",
  ];

  const checks = [
    {
      ok: capturedBlocks >= options.minBlocks,
      label: `captured Timeskein-блоки: ${capturedBlocks}/${options.minBlocks}`,
    },
    {
      ok: confirmedChanges.length >= options.minConfirmedResults,
      label: `подтверждённые изменения: ${confirmedChanges.length}/${options.minConfirmedResults}`,
    },
    {
      ok: story.entries.length > 0 && typedEntriesWithCapturedClassification.length === story.entries.length,
      label: `typed evidence с captured-классификацией: ${typedEntriesWithCapturedClassification.length}/${story.entries.length}`,
    },
    ...requiredFollowups.map(({ decision, match }) => ({
      ok: Boolean(match),
      label: `явная проверка решения ${decision}: ${match ? match.status : "нет"}`,
    })),
    {
      ok: requiredFollowups.some(({ match }) => match?.evidence_event_id),
      label: "хотя бы одна проверка решения связана с evidence event",
    },
    ...requiredHeadings.map((heading) => ({
      ok: markdown.includes(heading),
      label: `Markdown содержит ${heading}`,
    })),
  ];

  const failed = checks.filter((check) => !check.ok);
  const result = {
    ok: failed.length === 0,
    period: { from: options.from, to: options.to },
    track: report.request?.filters?.track?.path?.map((node) => node.title).join(" / ") || options.track,
    captured_blocks: capturedBlocks,
    typed_evidence_entries: story.entries.length,
    confirmed_changes: confirmedChanges.map((entry) => ({
      id: entry.id,
      text: entry.text,
      refs: entry.refs.map((ref) => ({ kind: ref.kind, value: ref.value, provenance: ref.provenance })),
    })),
    decision_followups: explicitFollowups.map((followup) => ({
      prior_decision_id: followup.prior_decision_id,
      decision: followup.decision,
      status: followup.status,
      evidence_event_id: followup.evidence_event_id,
    })),
    checks,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdown(result));
  }
  if (failed.length > 0) process.exit(1);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

function parseArgs(args) {
  const result = {
    track: "Timeskein",
    minBlocks: 3,
    minConfirmedResults: 1,
    decisions: ["protect-next-focus", "continue"],
    format: "md",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--from") result.from = readArg(args, ++index, arg);
    else if (arg === "--to") result.to = readArg(args, ++index, arg);
    else if (arg === "--track") result.track = readArg(args, ++index, arg);
    else if (arg === "--db") result.db = readArg(args, ++index, arg);
    else if (arg === "--min-blocks") result.minBlocks = readPositiveInteger(args, ++index, arg);
    else if (arg === "--min-confirmed-results") result.minConfirmedResults = readPositiveInteger(args, ++index, arg);
    else if (arg === "--decision") result.decisions.push(readArg(args, ++index, arg));
    else if (arg === "--format") result.format = readArg(args, ++index, arg);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (!result.from || !result.to) throw new Error("Нужны --from и --to; верхняя граница не включается.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.from) || !/^\d{4}-\d{2}-\d{2}$/.test(result.to)) {
    throw new Error("--from и --to должны иметь формат YYYY-MM-DD.");
  }
  if (!new Set(["md", "json"]).has(result.format)) throw new Error("Допустимы --format md и --format json.");
  result.decisions = [...new Set(result.decisions)];
  return result;
}

function readArg(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`После ${option} ожидается значение.`);
  return value;
}

function readPositiveInteger(args, index, option) {
  const value = Number(readArg(args, index, option));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${option} должен быть положительным целым числом.`);
  return value;
}

function renderMarkdown(result) {
  const lines = [
    `# Проверка доказуемой истории Track ${result.track}`,
    "",
    `Период: ${result.period.from} включительно — ${result.period.to} исключительно`,
    `Итог: ${result.ok ? "пройдено" : "не пройдено"}`,
    "",
    "## Проверки",
    "",
    ...result.checks.map((check) => `- [${check.ok ? "x" : " "}] ${check.label}`),
    "",
    `Captured-блоков: ${result.captured_blocks}`,
    `Typed evidence: ${result.typed_evidence_entries}`,
    `Подтверждённых изменений: ${result.confirmed_changes.length}`,
    `Явных проверок решений: ${result.decision_followups.length}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function printHelp() {
  console.log(`Использование:
  pnpm evidence:gate -- --from YYYY-MM-DD --to YYYY-MM-DD [параметры]

Проверяет реальный evidence-backed Track gate через два отчёта одного среза: JSON и Markdown.

Параметры:
  --track ID_OR_TITLE              Track, по умолчанию Timeskein
  --db PATH                        SQLite-база, по умолчанию основная база Timeskein
  --min-blocks N                   Минимум captured-блоков, по умолчанию 3
  --min-confirmed-results N        Минимум результатов с Ref snapshot, по умолчанию 1
  --decision KIND                  Дополнительный вид решения для явной проверки
  --format md|json                 Формат результата проверки, по умолчанию md`);
}
