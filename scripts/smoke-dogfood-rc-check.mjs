#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-rc-check-smoke-"));

try {
  const goodDb = join(tempDir, "good.db");
  await migrate(goodDb);
  await runSql(goodDb, `
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Deep Work', 'task', 'unknown', 0, '2026-06-30T06:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z'),
      ('w2', 'Review', 'task', 'unknown', 0, '2026-06-30T08:30:00Z', '2026-06-30T10:00:00Z', '2026-06-30T10:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s1', 'Deep Work', 'w1', 'stopped', 1500, NULL, '2026-06-30T06:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z'),
      ('s2', 'Review', 'w2', 'stopped', 1500, NULL, '2026-06-30T08:30:00Z', '2026-06-30T10:00:00Z', '2026-06-30T10:00:00Z');

    INSERT INTO captures (id, text, state, focus_session_id, created_at, updated_at, resolved_at)
    VALUES ('c1', 'Check incoming request later', 'resolved', 's1', '2026-06-30T07:00:00Z', '2026-06-30T10:10:00Z', '2026-06-30T10:10:00Z');

    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES
      ('e1', '2026-06-30T06:00:00Z', 'ui', 'app_started', NULL),
      ('e2', '2026-06-30T06:00:01Z', 'ui', 'focus_start_requested', '{"action_id":"a1"}'),
      ('e3', '2026-06-30T06:00:01Z', 'ui', 'focus_started', '{"action_id":"a1"}'),
      ('e4', '2026-06-30T10:00:00Z', 'ui', 'report_copied', '{"report_kind":"dogfood"}');
  `);

  const good = await runRcCheck(goodDb);
  assert(good.code === 0, "good day should not be blocked");
  assert(good.stdout.includes("Verdict: ready for human RC verdict"), "good day verdict is missing");
  assert(good.stdout.includes("Focus total: 3:30:00"), "good day focus total is missing");
  assert(good.stdout.includes("Captures created today: 1"), "good day capture count is missing");
  assert(good.stdout.includes("Captures during active focus: 1"), "good day active-focus capture count is missing");
  assert(good.stdout.includes("## Capture Activity"), "good day capture activity section is missing");
  assert(good.stdout.includes("| resolved | Check incoming request later |"), "good day capture activity row is missing");

  const savedPath = join(tempDir, "rc-check.md");
  const saved = await runRcCheck(goodDb, ["--out", savedPath]);
  assert(saved.code === 0, "good day should save RC check");
  assert(saved.stdout.includes(`Saved Timeskein dogfood RC check: ${savedPath}`), "save output path is missing");
  const savedMarkdown = await readFile(savedPath, "utf8");
  assert(savedMarkdown.includes("# Timeskein dogfood RC check - 2026-06-30"), "saved RC check title is missing");
  assert(savedMarkdown.includes("Manual RC Verdict"), "saved RC check manual verdict is missing");

  const openCaptureDb = join(tempDir, "open-capture.db");
  await copyDb(goodDb, openCaptureDb);
  await runSql(openCaptureDb, `
    INSERT INTO captures (id, text, state, created_at, updated_at)
    VALUES ('c2', 'Unresolved incoming request', 'open', '2026-06-30T09:00:00Z', '2026-06-30T09:00:00Z');
  `);
  const openCapture = await runRcCheck(openCaptureDb);
  assert(openCapture.code === 0, "open capture should be a review item, not a hard blocker");
  assert(openCapture.stdout.includes("Open captures: 1"), "open capture count is missing");
  assert(openCapture.stdout.includes("Review Items"), "open capture review section is missing");

  const noActiveFocusCaptureDb = join(tempDir, "no-active-focus-capture.db");
  await copyDb(goodDb, noActiveFocusCaptureDb);
  await runSql(noActiveFocusCaptureDb, "UPDATE captures SET focus_session_id = NULL WHERE id = 'c1';");
  const noActiveFocusCapture = await runRcCheck(noActiveFocusCaptureDb);
  assert(noActiveFocusCapture.code === 0, "capture without active focus should be a review item, not a hard blocker");
  assert(
    noActiveFocusCapture.stdout.includes("Captures during active focus: 0"),
    "active-focus capture count should show zero"
  );
  assert(
    noActiveFocusCapture.stdout.includes("none were linked to an active focus session"),
    "missing active-focus capture review item"
  );

  const captureFailureDb = join(tempDir, "capture-failure.db");
  await copyDb(goodDb, captureFailureDb);
  await runSql(captureFailureDb, `
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('e5', '2026-06-30T10:30:00Z', 'ui', 'capture_create_failed', '{"action_id":"c1","error_code":"validation_error"}');
  `);
  const captureFailure = await runRcCheck(captureFailureDb);
  assert(captureFailure.code === 0, "capture failure should be a review item, not a hard blocker");
  assert(captureFailure.stdout.includes("Capture failures: 1"), "capture failure count is missing");
  assert(
    captureFailure.stdout.includes("Capture Inbox failure event"),
    "capture failure review item is missing"
  );

  const emptyDb = join(tempDir, "empty.db");
  await migrate(emptyDb);
  const empty = await runRcCheck(emptyDb);
  assert(empty.code !== 0, "empty day should be blocked");
  assert(empty.stdout.includes("No focus blocks found"), "empty day blocker is missing");

  const duplicateDb = join(tempDir, "duplicate.db");
  await copyDb(goodDb, duplicateDb);
  await runSql(duplicateDb, `
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w3', 'deep work', 'task', 'unknown', 0, '2026-06-30T11:00:00Z', '2026-06-30T11:00:00Z', '2026-06-30T11:00:00Z');
  `);
  const duplicate = await runRcCheck(duplicateDb);
  assert(duplicate.code !== 0, "duplicate title should be blocked");
  assert(duplicate.stdout.includes("Duplicate Work Item title"), "duplicate title blocker is missing");

  const activeDb = join(tempDir, "active.db");
  await copyDb(goodDb, activeDb);
  await runSql(activeDb, `
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w4', 'Active Work', 'task', 'active', 0, '2026-06-30T11:00:00Z', '2026-06-30T11:00:00Z', '2026-06-30T11:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s3', 'Active Work', 'w4', 'active', 1500, NULL, '2026-06-30T11:00:00Z', NULL, '2026-06-30T11:00:00Z');
  `);
  const active = await runRcCheck(activeDb);
  assert(active.code !== 0, "active session should be blocked");
  assert(active.stdout.includes("Active focus session is still running"), "active session blocker is missing");

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
}

async function runRcCheck(path, extraArgs = []) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [
        join(repoRoot, "scripts/dogfood-rc-check.mjs"),
        "--db",
        path,
        "--date",
        "2026-06-30",
        "--now",
        "2026-06-30T12:00:00Z",
        ...extraArgs,
      ],
      {
        cwd: repoRoot,
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

async function copyDb(from, to) {
  await execFileAsync("cp", [from, to]);
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
