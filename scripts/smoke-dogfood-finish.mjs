#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-finish-smoke-"));
const smokeDate = new Date(2026, 5, 30);
const smokeDayStart = startOfLocalDay(smokeDate);
const overlappingStart = shiftedIso(smokeDayStart, -10 * 60);
const overlappingStop = shiftedIso(smokeDayStart, 10 * 60);

try {
  const emptyDb = join(tempDir, "empty.db");
  await migrate(emptyDb);
  const empty = await runFinish(emptyDb);
  assert(empty.code !== 0, "empty day should not finish");
  assert(empty.stdout.includes("# Закрытие дня Timeskein заблокировано - 2026-06-30"), "empty day did not show localized blocked title");
  assert(empty.stdout.includes("База:"), "empty day did not show localized DB label");
  assert(empty.stdout.includes("## Что мешает"), "empty day did not show localized blocker section");
  assert(empty.stdout.includes("За 2026-06-30 нет фокус-блоков"), "empty day did not explain missing blocks");
  assert(empty.stdout.includes("## Что сделать дальше"), "empty day did not show localized next steps");
  assert(
    empty.stdout.includes("Ближайшее действие: закрывать пока нечего; вернись к закрытию после первого фокус-блока за этот день."),
    "empty day did not show one calm next action"
  );
  assert(
    !empty.stdout.includes("dogfood-дня") &&
      !empty.stdout.includes("DB:") &&
      !empty.stdout.includes("## Blockers") &&
      !empty.stdout.includes("## Next"),
    "empty day leaked old English diagnostic text"
  );

  const help = await runFinish(emptyDb, ["--help"]);
  assert(help.code === 0, "help should exit successfully");
  assert(
    help.stdout.includes("Использование: pnpm dogfood:finish"),
    "finish help did not show localized usage"
  );
  assert(!help.stdout.includes("Usage:"), "finish help leaked old English usage heading");

  const badDate = await runFinish(emptyDb, ["--date", "not-a-date"]);
  assert(badDate.code !== 0, "finish should reject invalid date");
  assert(
    `${badDate.stdout}${badDate.stderr}`.includes("Некорректное значение --date") &&
      !`${badDate.stdout}${badDate.stderr}`.includes("Invalid --date"),
    "finish invalid-date error is not localized"
  );

  const badArg = await runFinish(emptyDb, ["--wat"]);
  assert(badArg.code !== 0, "finish should reject unknown argument");
  assert(
    `${badArg.stdout}${badArg.stderr}`.includes("Неизвестный аргумент: --wat") &&
      !`${badArg.stdout}${badArg.stderr}`.includes("Unknown argument"),
    "finish unknown-argument error is not localized"
  );

  const cleanDb = join(tempDir, "clean.db");
  await migrate(cleanDb);
  await runSql(cleanDb, `
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Deep Work', 'task', 'unknown', 0, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z'),
      ('w2', 'Overlapping Work', 'task', 'unknown', 0, '${overlappingStart}', '${overlappingStop}', '${overlappingStop}');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s0', 'Overlapping Work', 'w2', 'stopped', 1500, 'started before day', '${overlappingStart}', '${overlappingStop}', '${overlappingStop}'),
      ('s1', 'Deep Work', 'w1', 'stopped', 1500, 'finished block', '2026-06-30T06:00:00Z', '2026-06-30T06:25:00Z', '2026-06-30T06:25:00Z');
  `);
  const clean = await runFinish(cleanDb);
  assert(clean.code === 0, "stopped day should finish");
  assert(clean.stdout.includes("# Отчёт закрытия дня Timeskein - 2026-06-30"), "finish did not output dogfood report");
  assert(clean.stdout.includes("started before day"), "finish did not include overlapping focus session");
  assert(clean.stdout.includes("## Блоки на границе дня"), "finish did not flag day-boundary blocks");
  assert(clean.stdout.includes("finished block"), "finish did not include focus session note");
  assert(clean.stdout.includes("Не нужен для закрытия дня. Оставь пустым"), "finish did not keep optional review clearly optional");
  assert(!clean.stdout.includes("### Цена входа"), "finish should not include a large optional review questionnaire");

  const cleanReportPath = join(tempDir, "clean-report.md");
  const cleanSaved = await runFinish(cleanDb, ["--out", cleanReportPath]);
  assert(cleanSaved.code === 0, "stopped day should save a report");
  assert(cleanSaved.stdout.includes(`Сохранён отчёт закрытия дня Timeskein: ${cleanReportPath}`), "finish did not report saved file path");
  assert(!cleanSaved.stdout.includes("Saved Timeskein dogfood report:"), "finish leaked old English saved-report message");
  const cleanSavedMarkdown = await readFile(cleanReportPath, "utf8");
  assert(
    cleanSavedMarkdown.includes("# Отчёт закрытия дня Timeskein - 2026-06-30"),
    "saved report did not include dogfood report title"
  );
  assert(cleanSavedMarkdown.includes("Не нужен для закрытия дня. Оставь пустым"), "saved report did not keep optional review clearly optional");
  assert(!cleanSavedMarkdown.includes("### Цена входа"), "saved report should not include a large optional review questionnaire");

  const cleanSavedDefault = await runFinish(cleanDb, ["--save"], tempDir);
  assert(cleanSavedDefault.code === 0, "stopped day should save default report and RC check");
  const defaultReportPath = join(tempDir, "timeskein-dogfood-report-2026-06-30.md");
  const defaultRcPath = join(tempDir, "timeskein-dogfood-rc-check-2026-06-30.md");
  assert(
    cleanSavedDefault.stdout.includes("Сохранён отчёт закрытия дня Timeskein:") &&
      cleanSavedDefault.stdout.includes("timeskein-dogfood-report-2026-06-30.md"),
    "finish --save did not report saved dogfood report"
  );
  assert(
    cleanSavedDefault.stdout.includes("Сохранена проверка закрытия дня Timeskein:") &&
      cleanSavedDefault.stdout.includes("timeskein-dogfood-rc-check-2026-06-30.md"),
    "finish --save did not report saved RC check"
  );
  assert(
    !cleanSavedDefault.stdout.includes("Saved Timeskein dogfood"),
    "finish --save leaked old English saved evidence messages"
  );
  assert(
    cleanSavedDefault.stdout.includes("## До финального отчёта") &&
      cleanSavedDefault.stdout.includes("это ещё не финальное закрытие дня") &&
      cleanSavedDefault.stdout.includes("длительность закрытия не измерена или больше 10 минут") &&
      cleanSavedDefault.stdout.includes("Статус сохранённого отчёта:") &&
      cleanSavedDefault.stdout.includes("черновик") &&
      cleanSavedDefault.stdout.includes("Ближайшее действие из отчёта:") &&
      cleanSavedDefault.stdout.includes("pnpm dogfood:finish:save -- --date 2026-06-30"),
    "finish --save did not calmly explain missing measured closure and saved draft report state"
  );
  const defaultReportMarkdown = await readFile(defaultReportPath, "utf8");
  const defaultRcMarkdown = await readFile(defaultRcPath, "utf8");
  assert(
    defaultReportMarkdown.includes("## Проверка закрытия дня"),
    "saved default report did not include daily control check"
  );
  assert(
    defaultRcMarkdown.includes("## Проверка закрытия дня"),
    "saved closure check did not include daily control check"
  );

  await runSql(cleanDb, `
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES
      ('ae_closure_start', '2026-06-30T08:00:00Z', 'ui', 'day_closure_started', '{"action_id":"closure-1","control":"review_panel"}'),
      ('ae_closure_done', '2026-06-30T08:07:00Z', 'ui', 'day_closure_completed', '{"action_id":"closure-1","control":"copy_report"}');
  `);
  const measuredPendingDefault = await runFinish(cleanDb, ["--save"], tempDir);
  assert(measuredPendingDefault.code === 0, "measured day with pending review should save default report and RC check");
  assert(
    measuredPendingDefault.stdout.includes("## До финального отчёта") &&
      measuredPendingDefault.stdout.includes("ещё не готов для финального закрытия дня") &&
      measuredPendingDefault.stdout.includes("Статус сохранённого отчёта:") &&
      measuredPendingDefault.stdout.includes("черновик") &&
      measuredPendingDefault.stdout.includes("Ближайшее действие из отчёта:") &&
      measuredPendingDefault.stdout.includes("pnpm dogfood:finish:save -- --date 2026-06-30"),
    "finish --save did not calmly explain pending daily-control audit rows and saved draft report state"
  );
  assert(
    !measuredPendingDefault.stdout.includes("pnpm dogfood:goal-check"),
    "finish --save should not suggest goal-check while daily-control audit rows are pending"
  );

  await runSql(cleanDb, `
    UPDATE work_items
    SET note = 'Context preserved for day closure.'
    WHERE id = 'w1';

    UPDATE work_items
    SET activity_zone = 'coordination'
    WHERE id = 'w2';

    UPDATE focus_sessions
    SET activity_zone = 'coordination'
    WHERE id = 's0';

    INSERT INTO day_events (id, ts, kind, text, focus_session_id, activity_zone, updated_at)
    VALUES ('de_gap', '2026-06-30T00:20:00Z', 'note_added', 'Разрыв 00:10-06:00 объяснён тестом закрытия дня.', 's0', 'recovery', '2026-06-30T00:20:00Z');

    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES
      ('ae_badges', '2026-06-30T08:08:00Z', 'ui', 'work_item_time_badges_reviewed', '{"control":"review_panel"}'),
      ('ae_capture_usage', '2026-06-30T08:08:01Z', 'ui', 'capture_usage_reviewed', '{"control":"review_panel"}'),
      ('ae_entry_typed', '2026-06-30T08:08:02Z', 'ui', 'focus_start_requested', '{"action_id":"typed-1","control":"typed"}'),
      ('ae_entry_selected', '2026-06-30T08:08:03Z', 'ui', 'focus_start_requested', '{"action_id":"selected-1","control":"selected_item"}'),
      ('ae_stop_request', '2026-06-30T08:08:04Z', 'ui', 'focus_stop_requested', '{"action_id":"stop-1","control":"stop_button_or_enter"}'),
      ('ae_window_show', '2026-06-30T08:08:05Z', 'ui', 'window_show_requested', '{"control":"menubar"}'),
      ('ae_window_hide', '2026-06-30T08:08:06Z', 'ui', 'window_hide_requested', '{"control":"escape"}'),
      ('ae_correction_review', '2026-06-30T08:08:07Z', 'ui', 'focus_correction_reviewed', '{"control":"review_panel"}');
  `);

  const measuredSavedDefault = await runFinish(cleanDb, ["--save"], tempDir);
  assert(measuredSavedDefault.code === 0, "measured day should save default report and RC check");
  assert(
    measuredSavedDefault.stdout.includes("## Следующий шаг") &&
      measuredSavedDefault.stdout.includes("финальную проверку цели") &&
      measuredSavedDefault.stdout.includes("Короткое закрытие: Закрытие уложилось в 10 минут: да (7:00).") &&
      measuredSavedDefault.stdout.includes("Если во время закрытия пришлось спрашивать Codex") &&
      measuredSavedDefault.stdout.includes("pnpm dogfood:goal-check -- --date 2026-06-30 --no-codex-guidance"),
    "finish --save did not print the final goal-check next step after measured closure"
  );
  assert(!measuredSavedDefault.stdout.includes("gate цели"), "finish --save leaked old gate wording");
  assert(
    !measuredSavedDefault.stdout.includes("это ещё не финальное закрытие дня"),
    "finish --save should not warn about missing measured closure after closure telemetry exists"
  );
  assert(
    !measuredSavedDefault.stdout.includes("Статус сохранённого отчёта:"),
    "finish --save should not print draft report status after final measured closure"
  );

  const activeDb = join(tempDir, "active.db");
  await migrate(activeDb);
  await runSql(activeDb, `
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w1', 'Active Work', 'task', 'active', 0, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s1', 'Active Work', 'w1', 'active', 1500, NULL, '2026-06-30T06:00:00Z', NULL, '2026-06-30T06:00:00Z');
  `);
  const active = await runFinish(activeDb);
  assert(active.code !== 0, "active day should not finish");
  assert(active.stdout.includes("Активный фокус-блок ещё идёт"), "active day did not explain active focus");
  assert(
    active.stdout.includes("Ближайшее действие: останови активный фокус-блок в Timeskein кнопкой `Стоп`."),
    "active day did not prioritize the one active-focus stop action"
  );
  assert(!active.stdout.includes("Active focus session is still running"), "active day leaked old English active-focus blocker");

  const activeSoft = await runFinish(activeDb, ["--soft-fail"]);
  assert(activeSoft.code === 0, "soft-fail active day should keep the manual closure route calm");
  assert(
    activeSoft.stdout.includes("Ближайшее действие: останови активный фокус-блок в Timeskein кнопкой `Стоп`."),
    "soft-fail active day did not preserve the blocked next action"
  );

  const splitBrainDb = join(tempDir, "split-brain.db");
  await migrate(splitBrainDb);
  await runSql(splitBrainDb, `
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w1', 'Stuck Active Item', 'task', 'active', 0, '2026-06-30T06:00:00Z', '2026-06-30T06:30:00Z', '2026-06-30T06:30:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s1', 'Stuck Active Item', 'w1', 'stopped', 1500, NULL, '2026-06-30T06:00:00Z', '2026-06-30T06:25:00Z', '2026-06-30T06:25:00Z');
  `);
  const splitBrain = await runFinish(splitBrainDb);
  assert(splitBrain.code !== 0, "split-brain active work item should not finish");
  assert(
    splitBrain.stdout.includes("У дела всё ещё активный статус"),
    "split-brain day did not explain active work item"
  );
  assert(
    splitBrain.stdout.includes(
      "Ближайшее действие: сними активный статус с дела в Timeskein или сначала выполни `pnpm dogfood:stop-active`."
    ),
    "split-brain day did not show one active-status next action"
  );
  assert(
    !splitBrain.stdout.includes("У Work Item всё ещё активный статус"),
    "split-brain day leaked model-side Work Item wording"
  );
  assert(
    !splitBrain.stdout.includes("Active Work Item is still marked active"),
    "split-brain day leaked old English active Work Item blocker"
  );
  assert(
    splitBrain.stdout.includes("pnpm dogfood:stop-active"),
    "split-brain day did not suggest stop-active"
  );

  const packageSoft = await runFinishPackage(splitBrainDb);
  assert(packageSoft.code === 0, "pnpm dogfood:finish:save should soft-fail on expected blockers");
  assert(
    packageSoft.stdout.includes("Закрытие дня Timeskein заблокировано") &&
      packageSoft.stdout.includes("Ближайшее действие: сними активный статус с дела"),
    "pnpm dogfood:finish:save did not keep blocked diagnostics visible"
  );
  assert(
    !`${packageSoft.stdout}${packageSoft.stderr}`.includes("[ELIFECYCLE]"),
    "pnpm dogfood:finish:save leaked pnpm lifecycle noise on an expected blocker"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        temp_dir: tempDir,
      },
      null,
      2
    )
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function migrate(path) {
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/002_focus_sessions.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/003_app_events.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/004_captures.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/005_activity_zones.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/006_work_item_note_events.sql"));
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/008_day_events.sql"));
}

async function runFinish(path, extraArgs = [], cwd = repoRoot) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [join(repoRoot, "scripts/dogfood-finish.mjs"), "--db", path, "--date", "2026-06-30", ...extraArgs],
      {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function runFinishPackage(path, cwd = repoRoot) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      ["dogfood:finish:save", "--", "--db", path, "--date", "2026-06-30"],
      {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function runSqlFile(path, sqlFile) {
  await execFileAsync("sqlite3", [path, `.read ${sqlFile}`], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function runSql(path, sql) {
  await execFileAsync("sqlite3", [path, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function startOfLocalDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function shiftedIso(date, offsetSeconds) {
  return new Date(date.getTime() + offsetSeconds * 1000).toISOString();
}
