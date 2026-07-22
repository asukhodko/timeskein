#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "timeskein-working-memory-cli-"));
const dbPath = join(directory, "timeskein.db");
const canonicalId = "11111111-1111-4111-8111-111111111111";
const trackId = "22222222-2222-4222-8222-222222222222";
const stageOne = "33333333-3333-4333-8333-333333333333";
const stageTwo = "44444444-4444-4444-8444-444444444444";

try {
  await verifyContextPackExport();
  await sqlite(schemaSql());
  await sqlite(seedSql());

  const passed = await runGate();
  assert(passed.code === 0, `complete fixture failed gate:\n${passed.stdout}\n${passed.stderr}`);
  assert(passed.stdout.includes("Итог: пройдено"), "passing gate did not report success");
  assert(passed.stdout.includes("возвратов после пауз 1/3/7 дней: 3/3"), "pause evidence is missing");

  await sqlite(`UPDATE app_events SET payload = '{"stage_id":"${stageTwo}","has_next_action":false}' WHERE id = 'reentry-7';`);
  const unverifiedReentry = await runGate();
  assert(unverifiedReentry.code === 1, "re-entry without a saved next action unexpectedly passed gate");
  assert(
    unverifiedReentry.stdout.includes("возвратов после пауз 1/3/7 дней: 2/3"),
    "unverified re-entry was not excluded from pause evidence",
  );
  await sqlite(`UPDATE app_events SET payload = '{"stage_id":"${stageTwo}","has_next_action":true}' WHERE id = 'reentry-7';`);

  await sqlite("DELETE FROM work_memory_entries WHERE id = 'memory-material';");
  const failed = await runGate();
  assert(failed.code === 1, "fixture without material unexpectedly passed gate");
  assert(failed.stdout.includes("зарегистрированных материалов: 0/1"), "missing material was not identified");

  console.log(JSON.stringify({ ok: true, gate: "working-memory", context_pack_cli: true }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function verifyContextPackExport() {
  const calls = [];
  const pack = {
    schema_version: 1,
    profile: "work-item-reentry",
    scope: { kind: "work_item", id: canonicalId, title: "Long project", aliases: [] },
    as_of: "2026-07-20T00:00:00Z",
    facts: { work_items: [], stages: [], memory: [], focus: { active_seconds: 0, entrances: 0, by_stage: [] }, open_questions: [], materials: [], next_actions: [] },
    unknowns: [], warnings: [], redactions: [],
    provenance: { source: "local SQLite", projection: "deterministic canonical projection v1", canonical_tables: [], external_text_policy: "untrusted" },
  };
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    calls.push(rpc);
    const result = rpc.method === "context_pack.build"
      ? { pack, markdown: "# Context Pack: Long project\n\n- Projection: deterministic canonical projection v1\n" }
      : { id: crypto.randomUUID() };
    response.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
    response.end(JSON.stringify({ version: "1.0", request_id: rpc.request_id, result }));
  });
  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => rejectListen(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolveListen();
    });
  });
  const address = server.address();
  const outputPrefix = join(directory, "context-pack");
  try {
    await execFileAsync("node", [
      join(repoRoot, "scripts/context-pack.mjs"),
      "--api-url", `http://127.0.0.1:${address.port}/api`,
      "--profile", "work-item-reentry",
      "--scope", canonicalId,
      "--as-of", "2026-07-20T00:00:00Z",
      "--format", "both",
      "--output", outputPrefix,
    ], { cwd: repoRoot });
  } finally {
    server.closeAllConnections();
    server.close();
  }
  const [markdown, json] = await Promise.all([
    readFile(`${outputPrefix}.md`, "utf8"),
    readFile(`${outputPrefix}.json`, "utf8").then(JSON.parse),
  ]);
  assert(markdown.includes("deterministic canonical projection v1"), "Markdown projection is missing");
  assert(json.provenance.projection === "deterministic canonical projection v1", "JSON projection is missing");
  assert(calls.some((call) => call.method === "context_pack.build"), "Context Pack was not built");
  assert(
    calls.some((call) => call.method === "app_event.log" && call.params.kind === "context_pack_exported"),
    "Context Pack export was not logged",
  );
}

async function runGate() {
  try {
    const { stdout, stderr } = await execFileAsync("node", [
      join(repoRoot, "scripts/working-memory-gate.mjs"),
      "--db", dbPath,
      "--work-item", canonicalId,
      "--from", "2026-07-01",
      "--to", "2026-07-20",
    ], { cwd: repoRoot });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message };
  }
}

async function sqlite(statement) {
  await execFileAsync("sqlite3", [dbPath, statement], { maxBuffer: 16 * 1024 * 1024 });
}

function schemaSql() {
  return `
    CREATE TABLE work_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE work_item_tracks (work_item_id TEXT PRIMARY KEY, track_id TEXT NOT NULL);
    CREATE TABLE work_item_aliases (
      source_work_item_id TEXT PRIMARY KEY, canonical_work_item_id TEXT NOT NULL,
      source_title_snapshot TEXT, merged_at TEXT, merge_reason TEXT
    );
    CREATE TABLE work_memory_entries (
      id TEXT PRIMARY KEY, work_item_id TEXT, occurred_at TEXT, recorded_at TEXT,
      focus_session_id TEXT, stage_id TEXT, day_contract_revision_id TEXT,
      provenance TEXT, deleted_at TEXT, current_revision_number INTEGER
    );
    CREATE TABLE work_memory_entry_revisions (
      id TEXT PRIMARY KEY, entry_id TEXT, revision_number INTEGER, change_kind TEXT,
      entry_kind TEXT, text TEXT, material_kind TEXT, material_value TEXT
    );
    CREATE TABLE work_item_stages (
      id TEXT PRIMARY KEY, work_item_id TEXT, title TEXT, position INTEGER,
      state TEXT, created_at TEXT, completed_at TEXT, deleted_at TEXT
    );
    CREATE TABLE work_item_stage_events (
      id TEXT PRIMARY KEY, stage_id TEXT, work_item_id TEXT, kind TEXT, occurred_at TEXT
    );
    CREATE TABLE focus_sessions (
      id TEXT PRIMARY KEY, title TEXT, work_item_id TEXT, started_at TEXT,
      stopped_at TEXT, state TEXT
    );
    CREATE TABLE focus_session_work_snapshots (
      focus_session_id TEXT PRIMARY KEY, stage_id TEXT, stage_title TEXT,
      daily_outcome TEXT, day_contract_revision_id TEXT, provenance TEXT
    );
    CREATE TABLE app_events (
      id TEXT PRIMARY KEY, ts TEXT, source TEXT, kind TEXT,
      work_item_id TEXT, focus_session_id TEXT, payload TEXT
    );
  `;
}

function seedSql() {
  const statements = [
    `INSERT INTO work_items VALUES (${sql(canonicalId)}, 'Long project', NULL);`,
    `INSERT INTO work_item_tracks VALUES (${sql(canonicalId)}, ${sql(trackId)});`,
    `INSERT INTO work_item_stages VALUES (${sql(stageOne)}, ${sql(canonicalId)}, 'Discovery', 0, 'completed', '2026-07-01T08:00:00Z', '2026-07-05T08:00:00Z', NULL);`,
    `INSERT INTO work_item_stages VALUES (${sql(stageTwo)}, ${sql(canonicalId)}, 'Delivery', 1, 'active', '2026-07-05T08:00:00Z', NULL, NULL);`,
    stageEvent("stage-event-1", stageOne, "created", "2026-07-01T08:00:00Z"),
    stageEvent("stage-event-2", stageOne, "completed", "2026-07-05T08:00:00Z"),
    stageEvent("stage-event-3", stageTwo, "activated", "2026-07-05T08:01:00Z"),
    focus("focus-1", "2026-07-01T08:00:00Z", "2026-07-01T09:00:00Z", stageOne, "Clarify the model"),
    focus("focus-2", "2026-07-02T10:00:00Z", "2026-07-02T10:30:00Z", stageOne, "Clarify the model"),
    focus("focus-3", "2026-07-05T11:00:00Z", "2026-07-05T11:30:00Z", stageTwo, "Ship the bridge"),
    focus("focus-4", "2026-07-12T12:00:00Z", "2026-07-12T12:30:00Z", stageTwo, "Ship the bridge"),
    appEvent("reentry-1", "2026-07-02T10:00:00Z", "reentry_started", { stage_id: stageOne, has_next_action: true }),
    appEvent("reentry-3", "2026-07-05T11:00:00Z", "reentry_started", { stage_id: stageTwo, has_next_action: true }),
    appEvent("reentry-7", "2026-07-12T12:00:00Z", "reentry_started", { stage_id: stageTwo, has_next_action: true }),
    appEvent("pack-work", "2026-07-12T12:01:00Z", "context_pack_built", { profile: "work-item-reentry", scope_id: canonicalId }),
    appEvent("pack-track", "2026-07-12T12:02:00Z", "context_pack_built", { profile: "track-reentry", scope_id: trackId }),
    appEvent("export-work", "2026-07-12T12:03:00Z", "context_pack_exported", { profile: "work-item-reentry", scope_id: canonicalId, format: "both" }),
    appEvent("export-track", "2026-07-12T12:04:00Z", "context_pack_exported", { profile: "track-reentry", scope_id: trackId, format: "both" }),
  ];
  for (const [id, focusId, kind, text, time] of [
    ["memory-r1", "focus-1", "result", "Built schema", "2026-07-01T08:50:00Z"],
    ["memory-c1", "focus-1", "state_change", "History is durable", "2026-07-01T08:51:00Z"],
    ["memory-n1", "focus-1", "next_action", "Test the second path", "2026-07-01T08:52:00Z"],
    ["memory-r2", "focus-3", "result", "Built Context Pack", "2026-07-05T11:20:00Z"],
    ["memory-c2", "focus-3", "state_change", "Re-entry is available", "2026-07-05T11:21:00Z"],
    ["memory-n2", "focus-3", "next_action", "Run real acceptance", "2026-07-05T11:22:00Z"],
    ["memory-thought", null, "thought", "Keep one source of truth", "2026-07-02T12:00:00Z"],
    ["memory-question", null, "question", "What remains unknown?", "2026-07-03T12:00:00Z"],
    ["memory-decision", null, "decision", "Use canonical projection", "2026-07-04T12:00:00Z"],
  ]) {
    statements.push(memory(id, focusId, kind, text, time));
  }
  statements.push(material());
  statements.push(`INSERT INTO work_memory_entry_revisions VALUES ('thought-rev-2', 'memory-thought', 2, 'edit', 'thought', 'Keep exactly one source of truth', NULL, NULL);`);
  return statements.join("\n");
}

function focus(id, startedAt, stoppedAt, stageId, outcome) {
  return `
    INSERT INTO focus_sessions VALUES (${sql(id)}, 'Long project', ${sql(canonicalId)}, ${sql(startedAt)}, ${sql(stoppedAt)}, 'stopped');
    INSERT INTO focus_session_work_snapshots VALUES (${sql(id)}, ${sql(stageId)}, ${sql(stageId === stageOne ? "Discovery" : "Delivery")}, ${sql(outcome)}, 'contract-${id}', 'confirmed');
  `;
}

function memory(id, focusId, kind, text, time) {
  const stageId = focusId === "focus-1" ? stageOne : focusId === "focus-3" ? stageTwo : null;
  const currentRevision = id === "memory-thought" ? 2 : 1;
  return `
    INSERT INTO work_memory_entries VALUES (${sql(id)}, ${sql(canonicalId)}, ${sql(time)}, ${sql(time)}, ${sqlOrNull(focusId)}, ${sqlOrNull(stageId)}, NULL, 'confirmed', NULL, ${currentRevision});
    INSERT INTO work_memory_entry_revisions VALUES (${sql(`${id}-rev-1`)}, ${sql(id)}, 1, 'create', ${sql(kind)}, ${sql(text)}, NULL, NULL);
  `;
}

function material() {
  return `
    INSERT INTO work_memory_entries VALUES ('memory-material', ${sql(canonicalId)}, '2026-07-06T12:00:00Z', '2026-07-06T12:00:00Z', NULL, ${sql(stageTwo)}, NULL, 'confirmed', NULL, 1);
    INSERT INTO work_memory_entry_revisions VALUES ('memory-material-rev-1', 'memory-material', 1, 'create', 'material', NULL, 'url', 'https://example.test/artifact');
  `;
}

function stageEvent(id, stageId, kind, time) {
  return `INSERT INTO work_item_stage_events VALUES (${sql(id)}, ${sql(stageId)}, ${sql(canonicalId)}, ${sql(kind)}, ${sql(time)});`;
}

function appEvent(id, ts, kind, payload) {
  return `INSERT INTO app_events VALUES (${sql(id)}, ${sql(ts)}, 'ui', ${sql(kind)}, ${sql(canonicalId)}, NULL, ${sql(JSON.stringify(payload))});`;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlOrNull(value) {
  return value == null ? "NULL" : sql(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
