#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-ready-smoke-"));
const dbPath = join(tempDir, "timeskein.db");
const smokeDate = new Date(2026, 5, 30);
const smokeDayStart = startOfLocalDay(smokeDate);
const overlappingStart = shiftedIso(smokeDayStart, -10 * 60);
const overlappingStop = shiftedIso(smokeDayStart, 10 * 60);

try {
  await runSqlFile(join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/002_focus_sessions.sql"));

  const ready = await runReady();
  assert(ready.code === 0, "clean database should be ready");
  assert(ready.stdout.includes("Status: READY"), "ready output did not report READY");
  assert(ready.stdout.includes("Mode: start"), "ready output did not report start mode");
  assert(ready.stdout.includes("Agent responsive: no"), "ready output did not report agent responsiveness");
  assert(ready.stdout.includes("Running app PIDs: none"), "ready output did not report running app PIDs");
  assert(ready.stdout.includes("## Daily-Control Checklist"), "ready output did not include daily-control checklist");
  assert(
    ready.stdout.includes("Exercise window entrypoints"),
    "ready output did not include window entrypoint reminder"
  );
  assert(
    ready.stdout.includes("pnpm dogfood:rc-check:strict"),
    "ready output did not include strict RC reminder"
  );

  const dummyApp = spawnDummyTimeskein();
  try {
    await delay(300);
    const readyWithProcess = await runReady();
    assert(readyWithProcess.code === 0, "clean database with running app process should still be DB-ready");
    assert(
      !readyWithProcess.stdout.includes("Running app PIDs: none"),
      "ready output did not detect running app process"
    );
    assert(
      readyWithProcess.stdout.includes("Timeskein app process is already running"),
      "ready output did not warn about running app process"
    );
  } finally {
    await stopChild(dummyApp);
  }

  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Dogfood Dirty', 'task', 'active', 0, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z'),
      ('w2', 'Duplicate Title', 'task', 'unknown', 0, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z'),
      ('w3', ' duplicate title ', 'task', 'unknown', 0, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z'),
      ('w4', 'Overlapping Dirty', 'task', 'unknown', 0, '${overlappingStart}', '${overlappingStop}', '${overlappingStop}');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s1', 'Dogfood Dirty', 'w1', 'active', 1500, NULL, '2026-06-30T06:00:00Z', NULL, '2026-06-30T06:00:00Z'),
      ('s2', 'Overlapping Dirty', 'w4', 'stopped', 1500, NULL, '${overlappingStart}', '${overlappingStop}', '${overlappingStop}');
  `);

  const dirty = await runReady();
  assert(dirty.code !== 0, "dirty database should not be ready");
  assert(dirty.stdout.includes("Status: NOT READY"), "dirty output did not report NOT READY");
  assert(dirty.stdout.includes("Active focus session"), "dirty output did not mention active focus");
  assert(dirty.stdout.includes("Active Work Item"), "dirty output did not mention active work item");
  assert(dirty.stdout.includes("Today already has 2 focus block"), "dirty output did not mention today's blocks");
  assert(dirty.stdout.includes("Duplicate Work Item title group"), "dirty output did not mention duplicate titles");
  assert(dirty.stdout.includes("pnpm dogfood:stop-active"), "dirty output did not suggest stop-active");
  assert(dirty.stdout.includes("pnpm dogfood:reset-db"), "dirty output did not suggest reset-db");
  assert(
    !dirty.stdout.includes("## Daily-Control Checklist"),
    "dirty output should not show daily-control checklist before readiness blockers are fixed"
  );
  assert(
    dirty.stdout.includes("prefer reset over stop-active"),
    "dirty output did not prioritize reset for a contaminated clean trial"
  );
  assert(dirty.stdout.includes("Manual backup command"), "dirty output did not include manual backup fallback");

  await runSql("DELETE FROM work_items WHERE id IN ('w2', 'w3');");

  const continuing = await runReady(["--mode", "continue"]);
  assert(continuing.code === 0, "continue mode should allow an existing coherent dogfood day");
  assert(continuing.stdout.includes("Mode: continue"), "continue output did not report continue mode");
  assert(continuing.stdout.includes("Status: READY"), "continue output did not report READY");
  assert(
    continuing.stdout.includes("Continue mode treats this as an existing dogfood day"),
    "continue output did not explain existing focus blocks"
  );
  assert(
    continuing.stdout.includes("Dogfood day is already in progress: Dogfood Dirty"),
    "continue output did not identify the active coherent focus"
  );
  assert(
    continuing.stdout.includes("## Daily-Control Checklist"),
    "continue output did not include daily-control checklist"
  );

  await runSql(`
    UPDATE work_items
    SET state = CASE id WHEN 'w4' THEN 'active' ELSE 'unknown' END,
        updated_at = '2026-06-30T07:00:00Z',
        last_seen_at = '2026-06-30T07:00:00Z'
    WHERE id IN ('w1', 'w4');
  `);

  const splitBrain = await runReady(["--mode", "continue"]);
  assert(splitBrain.code !== 0, "continue mode should reject mismatched active Work Item");
  assert(
    splitBrain.stdout.includes("Active focus session is linked to Dogfood Dirty, but active Work Item is Overlapping Dirty"),
    "continue output did not explain active Work Item mismatch"
  );

  const duplicateActiveWrite = await runSqlCaptured(`
    UPDATE work_items
    SET state = 'active', updated_at = '2026-06-30T07:30:00Z', last_seen_at = '2026-06-30T07:30:00Z'
    WHERE id = 'w1';
  `);
  assert(duplicateActiveWrite.code !== 0, "schema allowed multiple active Work Items");
  assert(
    `${duplicateActiveWrite.stderr}${duplicateActiveWrite.stdout}`.includes("UNIQUE constraint failed"),
    "schema did not report the active Work Item unique constraint"
  );

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

async function runReady(extraArgs = []) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [join(repoRoot, "scripts/dogfood-ready.mjs"), "--db", dbPath, "--date", "2026-06-30", ...extraArgs],
      { cwd: repoRoot }
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

async function runSqlCaptured(sql) {
  try {
    const { stdout, stderr } = await execFileAsync("sqlite3", [dbPath, sql], {
      maxBuffer: 10 * 1024 * 1024,
    });

    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
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

function spawnDummyTimeskein() {
  return spawn(process.execPath, ["-e", "process.title='timeskein-desktop'; setTimeout(() => {}, 30000)"], {
    stdio: "ignore",
  });
}

async function stopChild(child) {
  if (!child || child.killed) return;

  child.kill("SIGTERM");
  await waitForExit(child, 3_000).catch(() => child.kill("SIGKILL"));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
  ]);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
