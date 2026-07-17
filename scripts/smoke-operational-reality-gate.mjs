#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-operational-reality-gate-"));
const dbPath = join(tempDir, "timeskein.db");
const legacyDbPath = join(tempDir, "timeskein-legacy.db");

try {
  await execFileAsync("sqlite3", [dbPath, fixtureSql()]);
  const { stdout } = await execFileAsync(process.execPath, [
    resolve(repoRoot, "scripts/operational-reality-gate.mjs"),
    "--from", "2026-07-10",
    "--to", "2026-07-12",
    "--db", dbPath,
    "--format", "json",
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.start_days.length, 2);
  assert.equal(result.operational_reality_starts, 3);
  assert.equal(result.corrections.length, 1);
  assert.equal(result.restarted_after_correction, true);
  assert.equal(result.closure_days.length, 2);
  assert.equal(result.reflection_followups.length, 1);
  assert.equal(result.causal_chains.length, 1);

  await assert.rejects(
    execFileAsync(process.execPath, [
      resolve(repoRoot, "scripts/operational-reality-gate.mjs"),
      "--from", "2026-07-11",
      "--to", "2026-07-12",
      "--db", dbPath,
    ]),
    (error) => error?.code === 1,
  );

  await execFileAsync("sqlite3", [legacyDbPath, "CREATE TABLE app_events (id TEXT PRIMARY KEY);"]);
  await assert.rejects(
    execFileAsync(process.execPath, [
      resolve(repoRoot, "scripts/operational-reality-gate.mjs"),
      "--from", "2026-07-10",
      "--to", "2026-07-12",
      "--db", legacyDbPath,
    ]),
    (error) => {
      assert.equal(error?.code, 1);
      assert.match(error?.stderr ?? "", /База ещё не обновлена для Operational Reality/);
      assert.match(error?.stderr ?? "", /pnpm dogfood:start/);
      return true;
    },
  );

  console.log(JSON.stringify({ ok: true, checks: result.checks.length }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function fixtureSql() {
  return `
    CREATE TABLE app_events (
      id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL,
      work_item_id TEXT, payload TEXT
    );
    CREATE TABLE causal_records (
      id TEXT PRIMARY KEY, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL,
      work_item_id TEXT, record_kind TEXT NOT NULL, operational_state TEXT,
      next_action_status TEXT, text TEXT, occurred_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL, supersedes_id TEXT, evidence_event_id TEXT,
      reflection_decision_id TEXT
    );
    CREATE TABLE reflection_decision_followups (
      id TEXT PRIMARY KEY, prior_decision_id TEXT NOT NULL, status TEXT NOT NULL,
      evidence_event_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE evidence_ref_snapshots (
      id TEXT PRIMARY KEY, work_item_event_id TEXT NOT NULL, ref_kind TEXT NOT NULL,
      ref_value TEXT NOT NULL, captured_at TEXT NOT NULL
    );

    INSERT INTO app_events VALUES
      ('start-1', '2026-07-10T09:00:00+03:00', 'focus_start_requested', 'w1', '{"control":"operational_reality"}'),
      ('start-2', '2026-07-10T14:00:00+03:00', 'focus_start_requested', 'w1', '{"control":"operational_reality"}'),
      ('start-3', '2026-07-11T10:00:00+03:00', 'focus_start_requested', 'w2', '{"control":"operational_reality"}'),
      ('restart-1', '2026-07-11T10:30:00+03:00', 'app_started', NULL, NULL),
      ('closure-1', '2026-07-10T19:00:00+03:00', 'day_closure_completed', NULL, NULL),
      ('closure-2', '2026-07-11T19:00:00+03:00', 'day_closure_completed', NULL, NULL);

    INSERT INTO causal_records VALUES
      ('intent-1', 'work_item', 'w1', 'w1', 'intent', NULL, NULL, 'Начать', '2026-07-10T09:00:01+03:00', '2026-07-10T09:00:01+03:00', NULL, NULL, NULL),
      ('result-1', 'work_item', 'w1', 'w1', 'result', NULL, NULL, 'Готово', '2026-07-10T10:00:00+03:00', '2026-07-10T10:00:00+03:00', NULL, 'event-1', NULL),
      ('next-1', 'work_item', 'w1', 'w1', 'next_action', NULL, 'open', 'Проверить', '2026-07-10T10:01:00+03:00', '2026-07-10T10:01:00+03:00', NULL, NULL, NULL),
      ('state-1', 'work_item', 'w2', 'w2', 'state_assertion', 'waiting', NULL, 'Ждём', '2026-07-11T09:00:00+03:00', '2026-07-11T09:00:00+03:00', NULL, NULL, NULL),
      ('correction-1', 'work_item', 'w2', 'w2', 'correction', 'blocked', NULL, 'Появился блокер', '2026-07-11T09:30:00+03:00', '2026-07-11T09:30:00+03:00', 'state-1', NULL, NULL);

    INSERT INTO evidence_ref_snapshots VALUES
      ('ref-1', 'event-1', 'file_path', '/tmp/result.md', '2026-07-10T10:00:00+03:00');
    INSERT INTO reflection_decision_followups VALUES
      ('followup-1', 'decision-1', 'progressed', 'event-1', '2026-07-11T12:00:00+03:00');
  `;
}
