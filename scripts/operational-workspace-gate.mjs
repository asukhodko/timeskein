#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { findFocusSessionOverlaps } from "./lib/focus-overlaps.mjs";

const execFileAsync = promisify(execFile);

try {
  const options = parseArgs(process.argv.slice(2));
  const dbPath = options.db
    ? resolve(options.db)
    : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
  if (!existsSync(dbPath)) throw new Error(`База Timeskein не найдена: ${dbPath}`);
  await ensureSchema(dbPath);

  const [contractRows, events, focusSessions] = await Promise.all([
    query(dbPath, `
      SELECT id, local_date, revision_number, revision_kind,
             active_subjects_json, first_action_work_item_id,
             first_action_snapshot_json, parked_subjects_json,
             why_now, created_at, source, provenance, supersedes_id
      FROM day_contract_revisions
      WHERE local_date >= ${sql(options.from)} AND local_date < ${sql(options.to)}
      ORDER BY local_date, revision_number;
    `),
    query(dbPath, `
      SELECT id, date(ts, 'localtime') AS local_date, ts, kind,
             work_item_id, focus_session_id, payload
      FROM app_events
      WHERE date(ts, 'localtime') >= ${sql(options.from)}
        AND date(ts, 'localtime') < ${sql(options.to)}
      ORDER BY datetime(ts), id;
    `),
    query(dbPath, `
      SELECT id, title, work_item_id, started_at, stopped_at, state
      FROM focus_sessions
      WHERE datetime(COALESCE(stopped_at, ${sql(new Date().toISOString())})) > datetime(${sql(`${options.from}T00:00:00`)})
        AND datetime(started_at) < datetime(${sql(`${options.to}T00:00:00`)})
      ORDER BY datetime(started_at), id;
    `),
  ]);

  const revisions = contractRows.map(parseRevision);
  const revisionsByDay = groupBy(revisions, (revision) => revision.local_date);
  const contractDays = [...revisionsByDay.keys()].sort();
  const invalidChains = [];
  for (const [localDate, dayRevisions] of revisionsByDay) {
    const issue = validateRevisionChain(dayRevisions);
    if (issue) invalidChains.push(`${localDate}: ${issue}`);
  }

  const eventDays = (kind) => distinct(events.filter((event) => event.kind === kind).map((event) => event.local_date));
  const startDays = eventDays("day_contract_started");
  const requestDays = eventDays("day_contract_start_requested");
  const reentryDays = eventDays("day_contract_reentry_reviewed");
  const closureDays = eventDays("day_closure_completed");
  const revisedDays = contractDays.filter((day) => (revisionsByDay.get(day)?.length ?? 0) > 1);
  const failureKinds = new Set([
    "focus_start_failed",
    "focus_stop_failed",
    "report_copy_failed",
    "day_contract_start_failed",
  ]);
  const failures = events.filter((event) =>
    failureKinds.has(event.kind) || (event.kind === "api_error" && !isReviewedCorrectionValidationError(event, events))
  );
  const shadowStarts = events.filter((event) => {
    if (event.kind !== "focus_start_requested" && event.kind !== "focus_switch_requested") return false;
    return parsePayload(event.payload)?.control === "dispatch_ritual";
  });
  const overlaps = findFocusSessionOverlaps(focusSessions, {
    from: `${options.from}T00:00:00`,
    to: `${options.to}T00:00:00`,
  });

  const checks = [
    check(contractDays.length >= options.minDays, `дней с item-backed договором: ${contractDays.length}/${options.minDays}`),
    check(requestDays.length >= options.minDays, `дней с запросом старта из договора: ${requestDays.length}/${options.minDays}`),
    check(startDays.length >= options.minDays, `дней с успешным стартом из договора: ${startDays.length}/${options.minDays}`),
    check(closureDays.length >= options.minDays, `дней со штатным закрытием: ${closureDays.length}/${options.minDays}`),
    check(reentryDays.length >= options.minReentryDays, `дней с возвращением через договор: ${reentryDays.length}/${options.minReentryDays}`),
    check(revisedDays.length >= 1, `дней с сохранённой ревизией договора: ${revisedDays.length}/1`),
    check(invalidChains.length === 0, `целостность цепочек ревизий: ${invalidChains.length === 0 ? "ок" : invalidChains.join("; ")}`),
    check(failures.length === 0, `неразобранных ошибок API/старт/стоп/копирование/договор: ${failures.length}`),
    check(overlaps.length === 0, `пересечений фокус-блоков: ${overlaps.length}`),
    check(shadowStarts.length === 0, `стартов через старую текстовую диспетчеризацию: ${shadowStarts.length}`),
  ];
  const result = {
    ok: checks.every((item) => item.ok),
    period: { from: options.from, to: options.to, upper_bound_inclusive: false },
    contract_days: contractDays,
    start_request_days: requestDays,
    start_days: startDays,
    reentry_days: reentryDays,
    revised_days: revisedDays,
    closure_days: closureDays,
    revisions: revisions.length,
    invalid_revision_chains: invalidChains,
    failures: failures.map((event) => ({ local_date: event.local_date, kind: event.kind, id: event.id })),
    focus_overlaps: overlaps.map((overlap) => ({
      first_id: overlap.first.id,
      second_id: overlap.second.id,
      seconds: overlap.seconds,
    })),
    shadow_dispatch_starts: shadowStarts.length,
    checks,
  };

  process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderMarkdown(result));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseRevision(row) {
  return {
    ...row,
    active_subjects: JSON.parse(row.active_subjects_json),
    first_action: JSON.parse(row.first_action_snapshot_json),
    parked_subjects: JSON.parse(row.parked_subjects_json),
  };
}

function validateRevisionChain(revisions) {
  for (let index = 0; index < revisions.length; index += 1) {
    const revision = revisions[index];
    const previous = revisions[index - 1];
    if (revision.revision_number !== index + 1) return `ожидалась версия ${index + 1}, получена ${revision.revision_number}`;
    if (index === 0 && revision.revision_kind !== "morning") return "первая версия не утренняя";
    if (index > 0 && revision.revision_kind === "morning") return "повторная версия ошибочно помечена утренней";
    if ((revision.supersedes_id ?? null) !== (previous?.id ?? null)) return `нарушена ссылка supersedes у версии ${revision.revision_number}`;
    if (revision.active_subjects.length < 2 || revision.active_subjects.length > 3) return `неверное число активных направлений у версии ${revision.revision_number}`;
    if (revision.parked_subjects.length < 1 || revision.parked_subjects.length > 3) return `неверное число припаркованных конкурентов у версии ${revision.revision_number}`;
    if (!String(revision.why_now ?? "").trim()) return `пустое основание у версии ${revision.revision_number}`;
    const allKeys = [...revision.active_subjects, ...revision.parked_subjects].map(subjectKey);
    if (new Set(allKeys).size !== allKeys.length) return `дубли или пересечение активного и парковки у версии ${revision.revision_number}`;
    if (!firstActionInScope(revision)) return `первое действие вне активного контура у версии ${revision.revision_number}`;
  }
  return undefined;
}

function firstActionInScope(revision) {
  return revision.active_subjects.some((subject) => {
    if (subject.kind === "work_item") return subject.subject_id === revision.first_action_work_item_id;
    return revision.first_action.track_path?.some((track) => track.id === subject.subject_id);
  });
}

function subjectKey(subject) {
  return `${subject.kind}:${subject.subject_id}`;
}

function parsePayload(value) {
  if (!value) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

function isReviewedCorrectionValidationError(event, events) {
  const payload = parsePayload(event.payload);
  if (payload?.error_code !== "validation_error") return false;
  if (!new Set(["focus.create_stopped", "focus.update", "focus.split"]).has(payload.request_method)) {
    return false;
  }
  return events.some((candidate) =>
    candidate.kind === "focus_correction_reviewed" &&
    candidate.local_date === event.local_date &&
    new Date(candidate.ts).getTime() > new Date(event.ts).getTime()
  );
}

function groupBy(values, keyOf) {
  const result = new Map();
  for (const value of values) {
    const key = keyOf(value);
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function distinct(values) {
  return [...new Set(values)].sort();
}

function check(ok, label) {
  return { ok: Boolean(ok), label };
}

function renderMarkdown(result) {
  const lines = [
    "# Проверка Operational Workspace v1",
    "",
    `Период: ${result.period.from} включительно — ${result.period.to} исключительно`,
    `Итог: ${result.ok ? "пройдено" : "не пройдено"}`,
    "",
    "## Проверки",
    "",
    ...result.checks.map((item) => `- [${item.ok ? "x" : " "}] ${item.label}`),
    "",
    `Дни с договором: ${result.contract_days.join(", ") || "нет"}`,
    `Дни с возвращением: ${result.reentry_days.join(", ") || "нет"}`,
    `Дни с ревизиями: ${result.revised_days.join(", ") || "нет"}`,
    "",
  ];
  if (!result.ok) {
    lines.push(
      "## Что нужно доказать",
      "",
      "1. В каждый полноценный день собери договор из реальных дел/направлений и запусти первое действие кнопкой договора.",
      "2. После заметного перерыва нажми «Вернуться по договору» или сохрани пересмотр для возвращения; нужно минимум два разных дня.",
      "3. Хотя бы раз измени договор: старая версия должна остаться в истории.",
      "4. Заверши каждый день штатным закрытием и повтори gate с верхней границей на день позже последнего прогона.",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

async function ensureSchema(dbPath) {
  const rows = await query(dbPath, `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('day_contract_revisions', 'app_events', 'focus_sessions');
  `);
  const names = new Set(rows.map((row) => row.name));
  const missing = ["day_contract_revisions", "app_events", "focus_sessions"].filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`База ещё не обновлена для Operational Workspace: нет ${missing.join(", ")}. Запусти свежую сборку Timeskein.`);
  }
}

async function query(dbPath, statement) {
  const { stdout } = await execFileAsync(
    "sqlite3",
    ["-readonly", "-cmd", ".timeout 5000", "-json", dbPath, statement],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseArgs(args) {
  const result = { minDays: 3, minReentryDays: 2, format: "md" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--from") result.from = readArg(args, ++index, arg);
    else if (arg === "--to") result.to = readArg(args, ++index, arg);
    else if (arg === "--db") result.db = readArg(args, ++index, arg);
    else if (arg === "--min-days") result.minDays = readPositiveInteger(args, ++index, arg);
    else if (arg === "--min-reentry-days") result.minReentryDays = readPositiveInteger(args, ++index, arg);
    else if (arg === "--format") result.format = readArg(args, ++index, arg);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Использование:
  pnpm operational-workspace:gate -- --from YYYY-MM-DD --to YYYY-MM-DD [параметры]

Проверяет трёхдневную реальную приёмку Operational Workspace v1.
Верхняя граница периода не включается.

Параметры:
  --db PATH              SQLite-база, по умолчанию основная база Timeskein
  --min-days N           Минимум полноценных дней, по умолчанию 3
  --min-reentry-days N   Минимум дней с возвращением через договор, по умолчанию 2
  --format md|json       Формат результата, по умолчанию md`);
      process.exit(0);
    } else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (!result.from || !result.to) throw new Error("Нужны --from и --to; верхняя граница не включается.");
  for (const [name, value] of [["--from", result.from], ["--to", result.to]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} должен иметь формат YYYY-MM-DD.`);
  }
  if (result.from >= result.to) throw new Error("--to должен быть позже --from.");
  if (!new Set(["md", "json"]).has(result.format)) throw new Error("Допустимы --format md и --format json.");
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
