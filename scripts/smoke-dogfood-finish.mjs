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
  assert(empty.stdout.includes("No focus blocks found"), "empty day did not explain missing blocks");

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
  assert(clean.stdout.includes("# Timeskein dogfood report - 2026-06-30"), "finish did not output dogfood report");
  assert(clean.stdout.includes("started before day"), "finish did not include overlapping focus session");
  assert(clean.stdout.includes("## Day-Boundary Blocks"), "finish did not flag day-boundary blocks");
  assert(clean.stdout.includes("finished block"), "finish did not include focus session note");
  assert(clean.stdout.includes("### Цена входа"), "finish did not include review prompts");

  const cleanReportPath = join(tempDir, "clean-report.md");
  const cleanSaved = await runFinish(cleanDb, ["--out", cleanReportPath]);
  assert(cleanSaved.code === 0, "stopped day should save a report");
  assert(cleanSaved.stdout.includes(`Saved Timeskein dogfood report: ${cleanReportPath}`), "finish did not report saved file path");
  const cleanSavedMarkdown = await readFile(cleanReportPath, "utf8");
  assert(
    cleanSavedMarkdown.includes("# Timeskein dogfood report - 2026-06-30"),
    "saved report did not include dogfood report title"
  );
  assert(cleanSavedMarkdown.includes("### Цена входа"), "saved report did not include review prompts");

  const cleanSavedDefault = await runFinish(cleanDb, ["--save"], tempDir);
  assert(cleanSavedDefault.code === 0, "stopped day should save default report and RC check");
  const defaultReportPath = join(tempDir, "timeskein-dogfood-report-2026-06-30.md");
  const defaultRcPath = join(tempDir, "timeskein-dogfood-rc-check-2026-06-30.md");
  assert(
    cleanSavedDefault.stdout.includes("Saved Timeskein dogfood report:") &&
      cleanSavedDefault.stdout.includes("timeskein-dogfood-report-2026-06-30.md"),
    "finish --save did not report saved dogfood report"
  );
  assert(
    cleanSavedDefault.stdout.includes("Saved Timeskein dogfood RC check:") &&
      cleanSavedDefault.stdout.includes("timeskein-dogfood-rc-check-2026-06-30.md"),
    "finish --save did not report saved RC check"
  );
  const defaultReportMarkdown = await readFile(defaultReportPath, "utf8");
  const defaultRcMarkdown = await readFile(defaultRcPath, "utf8");
  assert(
    defaultReportMarkdown.includes("## Daily Control Goal Audit"),
    "saved default report did not include daily control audit"
  );
  assert(
    defaultRcMarkdown.includes("## Daily Control Goal Audit"),
    "saved RC check did not include daily control audit"
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
  assert(active.stdout.includes("Active focus session is still running"), "active day did not explain active focus");

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
    splitBrain.stdout.includes("Active Work Item is still marked active"),
    "split-brain day did not explain active work item"
  );
  assert(
    splitBrain.stdout.includes("pnpm dogfood:stop-active"),
    "split-brain day did not suggest stop-active"
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
  await runSqlFile(path, join(repoRoot, "apps/agent/migrations/005_activity_zones.sql"));
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
