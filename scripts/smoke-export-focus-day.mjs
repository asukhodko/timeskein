#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-export-smoke-"));
const dbPath = join(tempDir, "timeskein.db");
const smokeDate = new Date(2026, 5, 30);
const smokeDayStart = startOfLocalDay(smokeDate);
const overlappingStart = shiftedIso(smokeDayStart, -10 * 60);
const overlappingStop = shiftedIso(smokeDayStart, 10 * 60);

try {
  await runSqlFile(join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/002_focus_sessions.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/005_activity_zones.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/008_day_events.sql"));
  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, note, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Deep Work', 'task', 'unknown', 0, 'Keep the implementation context here.', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z'),
      ('w2', 'Meetings', 'task', 'unknown', 0, NULL, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s0', 'Deep Work', 'w1', 'stopped', 1500, 'started before day', '${overlappingStart}', '${overlappingStop}', '${overlappingStop}'),
      ('s1', 'Deep Work', 'w1', 'stopped', 1500, 'first block', '2026-06-30T06:00:00Z', '2026-06-30T06:25:00Z', '2026-06-30T06:25:00Z'),
      ('s2', 'Meetings', 'w2', 'stopped', 1500, NULL, '2026-06-30T07:00:00Z', '2026-06-30T07:30:00Z', '2026-06-30T07:30:00Z'),
      ('s3', 'Deep Work', 'w1', 'stopped', 1500, NULL, '2026-06-30T07:35:00Z', '2026-06-30T07:45:00Z', '2026-06-30T07:45:00Z');

    INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
    VALUES
      ('e1', '2026-06-30T06:12:00Z', 'w1', 'note_added', '{"text":"implementation checkpoint","focus_session_id":"s1"}');

    INSERT INTO day_events (id, ts, kind, text, focus_session_id, activity_zone, updated_at)
    VALUES
      ('de1', '2026-06-30T06:20:00Z', 'note_added', 'buffer before meeting felt expensive', 's1', 'work', '2026-06-30T06:20:00Z'),
      ('de2', '2026-06-30T07:50:00Z', 'note_added', 'recovery was not enough', NULL, 'recovery', '2026-06-30T07:50:00Z');

    UPDATE work_items SET activity_zone = 'coordination' WHERE id = 'w2';
    UPDATE focus_sessions SET activity_zone = 'coordination' WHERE work_item_id = 'w2';
  `);

  const { stdout } = await execFileAsync(
    "node",
    [
      join(repoRoot, "scripts/export-focus-day.mjs"),
      "--db",
      dbPath,
      "--date",
      "2026-06-30",
      "--now",
      "2026-06-30T08:15:00Z",
    ],
    { cwd: repoRoot }
  );

  assert(stdout.includes("Total tracked: 1:15:00"), "export did not include expected tracked total");
  assert(stdout.includes("Work focus: 45:00"), "export did not include expected work focus total");
  assert(stdout.includes("Non-work tracked: 30:00"), "export did not include expected non-work total");
  assert(stdout.includes("Entrances: 4"), "export did not include expected entrance count");
  assert(stdout.includes("started before day"), "export did not include overlapping session");
  assert(stdout.includes("## Day-Boundary Blocks"), "export did not flag day-boundary blocks");
  assert(
    stdout.includes("counted as 10:00 inside this day"),
    "export did not explain clipped day-boundary duration"
  );
  assert(stdout.includes("## By Work Item"), "export did not include By Work Item section");
  assert(stdout.includes("## By Activity Zone"), "export did not include By Activity Zone section");
  assert(stdout.includes("| 45:00 | 3 | Work |"), "export did not aggregate Work zone");
  assert(stdout.includes("| 30:00 | 1 | Coordination |"), "export did not aggregate Coordination zone");
  assert(stdout.includes("| 45:00 | 3 | Deep Work |"), "export did not aggregate Deep Work");
  assert(stdout.includes("| 30:00 | 1 | Meetings |"), "export did not aggregate Meetings");
  assert(stdout.includes("## Work Item Notes"), "export did not include Work Item Notes section");
  assert(
    stdout.includes("- Deep Work: Keep the implementation context here."),
    "export did not include Work Item note"
  );
  assert(stdout.includes("## Work Item Events"), "export did not include Work Item Events section");
  assert(
    stdout.includes("| Deep Work | Deep Work | implementation checkpoint |"),
    "export did not include timestamped Work Item event"
  );
  assert(stdout.includes("## Day Events"), "export did not include Day Events section");
  assert(
    stdout.includes("| Work | Deep Work | buffer before meeting felt expensive |"),
    "export did not include focus-linked day event"
  );
  assert(
    stdout.includes("| Recovery | day | recovery was not enough |"),
    "export did not include day-level recovery event"
  );
  assert(stdout.includes("## Gaps >= 20:00"), "export did not include significant gaps section");
  assert(stdout.includes(": 35:00"), "export did not include expected significant gap duration");
  assert(stdout.includes("## Open Gap"), "export did not include open gap section");
  assert(
    stdout.includes(": 30:00 since last stopped block"),
    "export did not include expected open gap duration"
  );

  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w3', 'Active Draft Work', 'task', 'active', 0, '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s4', 'Active Draft Work', 'w3', 'active', 1500, NULL, '2026-06-30T08:00:00Z', NULL, '2026-06-30T08:00:00Z');
  `);

  const { stdout: activeStdout } = await execFileAsync(
    "node",
    [
      join(repoRoot, "scripts/export-focus-day.mjs"),
      "--db",
      dbPath,
      "--date",
      "2026-06-30",
      "--now",
      "2026-06-30T08:15:00Z",
    ],
    { cwd: repoRoot }
  );

  assert(activeStdout.includes("Total tracked: 1:30:00"), "active export did not include running total");
  assert(activeStdout.includes("Work focus: 1:00:00"), "active export did not include running work focus total");
  assert(activeStdout.includes("Non-work tracked: 30:00"), "active export did not include running non-work total");
  assert(activeStdout.includes("Entrances: 5"), "active export did not include running entrance count");
  assert(activeStdout.includes("Active Draft Work"), "active export did not include active work item");
  assert(activeStdout.includes("-now | 15:00 | Work | Active Draft Work"), "active export did not show active block ending at now");
  assert(!activeStdout.includes("## Open Gap"), "active export showed open gap while latest block is active");

  console.log(
    JSON.stringify(
      {
        ok: true,
        db_path: dbPath,
      },
      null,
      2
    )
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runSqlFile(path) {
  await execFileAsync("sqlite3", [dbPath, `.read ${path}`], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function runSql(sql) {
  await execFileAsync("sqlite3", [dbPath, sql], {
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
