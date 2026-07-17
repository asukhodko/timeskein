#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "timeskein-operational-workspace-gate-"));
const dbPath = join(directory, "timeskein.db");

try {
  await sqlite(schemaSql());
  await sqlite(seedSql());

  const passed = await runGate();
  assert(passed.code === 0, `complete fixture failed gate:\n${passed.stdout}\n${passed.stderr}`);
  assert(passed.stdout.includes("Итог: пройдено"), "passing gate did not report success");
  assert(passed.stdout.includes("дней с возвращением через договор: 2/2"), "reentry evidence is missing");

  await sqlite("DELETE FROM app_events WHERE id = 'close-3';");
  const failed = await runGate();
  assert(failed.code === 1, "incomplete fixture unexpectedly passed gate");
  assert(failed.stdout.includes("дней со штатным закрытием: 2/3"), "failure did not identify missing closure");

  console.log(JSON.stringify({ ok: true, gate: "operational-workspace" }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function runGate() {
  try {
    const { stdout, stderr } = await execFileAsync("node", [
      join(repoRoot, "scripts/operational-workspace-gate.mjs"),
      "--db", dbPath,
      "--from", "2099-01-17",
      "--to", "2099-01-20",
    ], { cwd: repoRoot });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
  }
}

async function sqlite(statement) {
  await execFileAsync("sqlite3", [dbPath, statement], { maxBuffer: 8 * 1024 * 1024 });
}

function schemaSql() {
  return `
    CREATE TABLE day_contract_revisions (
      id TEXT PRIMARY KEY, local_date TEXT NOT NULL, revision_number INTEGER NOT NULL,
      revision_kind TEXT NOT NULL, active_subjects_json TEXT NOT NULL,
      first_action_work_item_id TEXT NOT NULL, first_action_snapshot_json TEXT NOT NULL,
      parked_subjects_json TEXT NOT NULL, why_now TEXT NOT NULL, created_at TEXT NOT NULL,
      source TEXT NOT NULL, provenance TEXT NOT NULL, supersedes_id TEXT
    );
    CREATE TABLE app_events (
      id TEXT PRIMARY KEY, ts TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL,
      work_item_id TEXT, focus_session_id TEXT, payload TEXT
    );
    CREATE TABLE focus_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, work_item_id TEXT,
      started_at TEXT NOT NULL, stopped_at TEXT, state TEXT NOT NULL
    );
  `;
}

function seedSql() {
  const statements = [];
  for (let index = 0; index < 3; index += 1) {
    const day = 17 + index;
    const date = `2099-01-${day}`;
    const firstId = `work-${index}-a`;
    const secondId = `work-${index}-b`;
    const parkedId = `work-${index}-p`;
    const revisionId = `revision-${index}-1`;
    statements.push(insertRevision({
      id: revisionId,
      date,
      number: 1,
      kind: "morning",
      active: [snapshot(firstId), snapshot(secondId)],
      first: snapshot(firstId),
      parked: [snapshot(parkedId)],
      supersedesId: null,
    }));
    if (index === 0) {
      statements.push(insertRevision({
        id: "revision-0-2",
        date,
        number: 2,
        kind: "adjustment",
        active: [snapshot(firstId), snapshot(secondId)],
        first: snapshot(secondId),
        parked: [snapshot(parkedId)],
        supersedesId: revisionId,
      }));
    }
    statements.push(
      insertEvent(`create-${index}`, `${date}T08:00:00Z`, "day_contract_created"),
      insertEvent(`request-${index}`, `${date}T08:01:00Z`, "day_contract_start_requested", '{"control":"day_contract"}'),
      insertEvent(`start-${index}`, `${date}T08:01:01Z`, "day_contract_started"),
      insertEvent(`close-${index + 1}`, `${date}T17:00:00Z`, "day_closure_completed"),
      `INSERT INTO focus_sessions VALUES ('focus-${index}', 'First', '${firstId}', '${date}T08:01:01Z', '${date}T08:26:01Z', 'stopped');`,
    );
    if (index < 2) {
      statements.push(insertEvent(`reentry-${index}`, `${date}T12:00:00Z`, "day_contract_reentry_reviewed"));
    }
  }
  statements.push(insertEvent("revised-0", "2099-01-17T12:01:00Z", "day_contract_revised"));
  return statements.join("\n");
}

function snapshot(id) {
  return {
    kind: "work_item",
    subject_id: id,
    title: id,
    work_item_id: id,
    state: "unknown",
    state_provenance: "legacy_current",
    track_path: [],
    labels: [],
    captured_at: "2099-01-17T08:00:00Z",
  };
}

function insertRevision({ id, date, number, kind, active, first, parked, supersedesId }) {
  return `INSERT INTO day_contract_revisions VALUES (
    ${sql(id)}, ${sql(date)}, ${number}, ${sql(kind)}, ${sql(JSON.stringify(active))},
    ${sql(first.subject_id)}, ${sql(JSON.stringify(first))}, ${sql(JSON.stringify(parked))},
    'Nearest useful signal', ${sql(`${date}T08:00:00Z`)}, 'user', 'confirmed', ${supersedesId ? sql(supersedesId) : "NULL"}
  );`;
}

function insertEvent(id, ts, kind, payload = null) {
  return `INSERT INTO app_events VALUES (${sql(id)}, ${sql(ts)}, 'ui', ${sql(kind)}, NULL, NULL, ${payload ? sql(payload) : "NULL"});`;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
