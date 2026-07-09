#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-period-report-"));
const dbPath = join(tempDir, "timeskein.db");
const outputPath = join(tempDir, "period.md");

try {
  for (const migration of [
    "001_initial.sql",
    "002_focus_sessions.sql",
    "004_captures.sql",
    "005_activity_zones.sql",
    "008_day_events.sql",
  ]) {
    await runSqlFile(join(repoRoot, "apps/agent/migrations", migration));
  }

  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, note, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Important Project', 'project', 'unknown', 0, 'Meaningful continuation context', '2026-06-30T06:00:00+03:00', '2026-07-02T10:30:00+03:00', '2026-07-02T10:30:00+03:00'),
      ('w2', 'Reactive Inbox', 'task', 'unknown', 0, NULL, '2026-06-30T12:00:00+03:00', '2026-07-02T12:05:00+03:00', '2026-07-02T12:05:00+03:00'),
      ('w3', 'Mixed Zone Item', 'task', 'unknown', 0, NULL, '2026-06-30T11:00:00+03:00', '2026-06-30T11:30:00+03:00', '2026-06-30T11:30:00+03:00');

    INSERT INTO focus_sessions (id, title, work_item_id, state, activity_zone, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s1', 'Important Project', 'w1', 'stopped', 'work', 1500, 'first result', '2026-06-30T09:00:00+03:00', '2026-06-30T09:30:00+03:00', '2026-06-30T09:30:00+03:00'),
      ('s2', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-06-30T10:00:00+03:00', '2026-06-30T10:30:00+03:00', '2026-06-30T10:30:00+03:00'),
      ('s3', 'Mixed Zone Item', 'w3', 'stopped', 'work', 1500, NULL, '2026-06-30T11:00:00+03:00', '2026-06-30T11:10:00+03:00', '2026-06-30T11:10:00+03:00'),
      ('s4', 'Mixed Zone Item', 'w3', 'stopped', 'personal', 1500, NULL, '2026-06-30T11:20:00+03:00', '2026-06-30T11:30:00+03:00', '2026-06-30T11:30:00+03:00'),
      ('s5', 'Reactive Inbox', 'w2', 'stopped', 'work', 1500, NULL, '2026-06-30T12:00:00+03:00', '2026-06-30T12:05:00+03:00', '2026-06-30T12:05:00+03:00'),
      ('s6', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-01T09:00:00+03:00', '2026-07-01T09:30:00+03:00', '2026-07-01T09:30:00+03:00'),
      ('s7', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-01T10:00:00+03:00', '2026-07-01T10:30:00+03:00', '2026-07-01T10:30:00+03:00'),
      ('s8', 'Reactive Inbox', 'w2', 'stopped', 'work', 1500, NULL, '2026-07-01T11:00:00+03:00', '2026-07-01T11:05:00+03:00', '2026-07-01T11:05:00+03:00'),
      ('s9', 'Reactive Inbox', 'w2', 'stopped', 'work', 1500, NULL, '2026-07-01T11:10:00+03:00', '2026-07-01T11:15:00+03:00', '2026-07-01T11:15:00+03:00'),
      ('s10', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-02T09:00:00+03:00', '2026-07-02T09:30:00+03:00', '2026-07-02T09:30:00+03:00'),
      ('s11', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-02T10:00:00+03:00', '2026-07-02T10:30:00+03:00', '2026-07-02T10:30:00+03:00'),
      ('s12', 'Reactive Inbox', 'w2', 'stopped', 'work', 1500, NULL, '2026-07-02T12:00:00+03:00', '2026-07-02T12:05:00+03:00', '2026-07-02T12:05:00+03:00'),
      ('outside', 'Outside Range', NULL, 'stopped', 'work', 1500, NULL, '2026-07-03T00:00:00+03:00', '2026-07-03T00:30:00+03:00', '2026-07-03T00:30:00+03:00');

    INSERT INTO day_events (id, ts, kind, text, focus_session_id, activity_zone, updated_at)
    VALUES
      ('de1', '2026-06-30T09:45:00+03:00', 'note_added', 'Разрыв 09:30-09:45: восстановление перед продолжением', 's1', 'recovery', '2026-06-30T09:45:00+03:00');

    INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
    VALUES
      ('we1', '2026-06-30T09:20:00+03:00', 'w1', 'note_added', '{"text":"state changed after first step","focus_session_id":"s1"}'),
      ('we2', '2026-07-01T09:00:00+03:00', 'w2', 'created', NULL);

    INSERT INTO captures (id, text, state, work_item_id, focus_session_id, created_at, updated_at, resolved_at, converted_at)
    VALUES
      ('c1', 'Unresolved interruption', 'open', NULL, 's6', '2026-07-01T09:10:00+03:00', '2026-07-01T09:10:00+03:00', NULL, NULL),
      ('c2', 'Converted idea', 'converted', 'w1', 's10', '2026-07-02T09:10:00+03:00', '2026-07-02T09:20:00+03:00', NULL, '2026-07-02T09:20:00+03:00');
  `);

  const markdown = await runReport(["--format", "md"]);
  assert(markdown.includes("# Периодический отчёт Timeskein"), "Markdown title is missing");
  assert(markdown.includes("Диапазон: 2026-06-30 включительно — 2026-07-03 исключительно"), "Range semantics are missing");
  assert(markdown.includes("Учтено: 3:40:00"), "Tracked total is incorrect");
  assert(markdown.includes("исполнение: 3:30:00"), `Executive total is incorrect:\n${markdown.slice(0, 900)}`);
  assert(markdown.includes("## Факты периода"), "Facts section is missing");
  assert(markdown.includes("## Разрывы и восстановление"), "Gaps section is missing");
  assert(markdown.includes("## Отвлечения"), "Captures section is missing");
  assert(markdown.includes("## События дня"), "Day Events section is missing");
  assert(markdown.includes("## События дел"), "Work Item Events section is missing");
  assert(markdown.includes("## Настройка следующего периода"), "Focus tuning section is missing");
  assert(markdown.includes("Important Project"), "Focus candidate is missing");
  assert(!markdown.includes("Outside Range"), "Exclusive upper bound leaked into Markdown");

  const json = JSON.parse(await runReport(["--format", "json"]));
  assert(json.schema_version === 1, "JSON schema version is missing");
  assert(json.request.range_semantics === "from_inclusive_to_exclusive", "JSON range semantics are incorrect");
  assert(json.summary.calendar_days === 3, "JSON calendar day count is incorrect");
  assert(json.summary.tracked_seconds === 13_200, "JSON tracked seconds are incorrect");
  assert(json.summary.executive_work_seconds === 12_600, "JSON executive seconds are incorrect");
  assert(json.summary.entrances === 12, "JSON entrance count is incorrect");
  assert(json.captures.length === 2, "JSON captures are missing");
  assert(json.events.day.length === 1, "JSON day events are missing");
  assert(json.events.work_item.length === 2, "JSON Work Item events are missing");
  assert(json.gaps.some((gap) => gap.explained && gap.classification === "recovery"), "Explained recovery gap is missing");
  assert(json.gaps.some((gap) => !gap.explained), "Unexplained gap evidence is missing");
  const warningCodes = new Set(json.warnings.map((warning) => warning.code));
  for (const code of [
    "unexplained_significant_gaps",
    "open_captures",
    "low_context_event_density",
    "questionable_activity_zones",
    "possibly_overbroad_work_items",
  ]) {
    assert(warningCodes.has(code), `Expected quality warning is missing: ${code}`);
  }
  assert(json.focus_tuning.candidates[0]?.title === "Important Project", "Focus candidates are not evidence-based");
  assert(!json.timeline.some((session) => session.id === "outside"), "Exclusive upper bound leaked into JSON");

  const { stdout: savedPath } = await execFileAsync(
    "node",
    [
      join(repoRoot, "scripts/report-period.mjs"),
      "--db", dbPath,
      "--from", "2026-06-30",
      "--to", "2026-07-03",
      "--now", "2026-07-03T12:00:00+03:00",
      "--output", outputPath,
    ],
    { cwd: repoRoot }
  );
  assert(savedPath.trim() === outputPath, "--output did not print the saved path");
  assert((await readFile(outputPath, "utf8")).includes("## Настройка следующего периода"), "--output did not save Markdown");

  await expectFailure(
    ["--from", "2026-07-03", "--to", "2026-07-03"],
    "Значение --to должно быть позже --from"
  );
  await expectFailure(
    ["--from", "2026-06-30", "--to", "2026-07-03", "--format", "csv"],
    "Некорректный --format"
  );

  console.log(JSON.stringify({ ok: true, db_path: dbPath }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runReport(extraArgs) {
  const { stdout } = await execFileAsync(
    "node",
    [
      join(repoRoot, "scripts/report-period.mjs"),
      "--db", dbPath,
      "--from", "2026-06-30",
      "--to", "2026-07-03",
      "--now", "2026-07-03T12:00:00+03:00",
      ...extraArgs,
    ],
    { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 }
  );
  return stdout;
}

async function expectFailure(args, expectedMessage) {
  try {
    await execFileAsync("node", [join(repoRoot, "scripts/report-period.mjs"), "--db", dbPath, ...args], {
      cwd: repoRoot,
    });
    throw new Error(`Expected failure containing: ${expectedMessage}`);
  } catch (error) {
    const stderr = error?.stderr ?? "";
    assert(stderr.includes(expectedMessage), `Failure did not contain: ${expectedMessage}\n${stderr}`);
  }
}

async function runSqlFile(path) {
  await execFileAsync("sqlite3", [dbPath, `.read ${path}`], { maxBuffer: 10 * 1024 * 1024 });
}

async function runSql(sql) {
  await execFileAsync("sqlite3", [dbPath, sql], { maxBuffer: 10 * 1024 * 1024 });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
