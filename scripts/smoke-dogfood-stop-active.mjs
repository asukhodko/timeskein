#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-stop-active-smoke-"));
const dbPath = join(tempDir, "timeskein.db");
const stoppedAt = "2026-06-30T09:00:00.000Z";
const stopNote = "smoke emergency stop";

try {
  await runSqlFile(join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/002_focus_sessions.sql"));
  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Active Work', 'task', 'active', 0, '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z'),
      ('w2', 'Waiting Work', 'task', 'waiting', 0, '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s1', 'Active Work', 'w1', 'active', 1500, NULL, '2026-06-30T08:00:00Z', NULL, '2026-06-30T08:00:00Z');
  `);

  const dryRun = await runStopActive("--stopped-at", stoppedAt, "--note", stopNote);
  assert(dryRun.stdout.includes("Mode: dry-run"), "dry run did not report dry-run mode");
  assert(dryRun.stdout.includes("Active Work since"), "dry run did not list active focus session");
  assert(dryRun.stdout.includes(`Stop note: ${stopNote}`), "dry run did not report stop note");

  let activeState = await loadActiveState();
  assert(activeState.activeSessions === 1, "dry run stopped active session");
  assert(activeState.activeWorkItems === 1, "dry run cleared active work item");

  const dummyApp = spawnDummyTimeskein();
  try {
    await delay(300);
    const blocked = await runStopActiveCaptured("--apply", "--stopped-at", stoppedAt, "--note", stopNote);
    assert(blocked.code !== 0, "apply should refuse while app process is running and agent is not responsive");
    assert(
      blocked.stderr.includes("direct SQLite update would be unsafe"),
      "apply did not explain unsafe direct SQLite update"
    );
    activeState = await loadActiveState();
    assert(activeState.activeSessions === 1, "blocked apply stopped active session");
    assert(activeState.activeWorkItems === 1, "blocked apply cleared active work item");
  } finally {
    await stopChild(dummyApp);
  }

  const applied = await runStopActive("--apply", "--stopped-at", stoppedAt, "--note", stopNote);
  assert(applied.stdout.includes("Mode: applied"), "apply did not report applied mode");

  activeState = await loadActiveState();
  assert(activeState.activeSessions === 0, "apply left active session");
  assert(activeState.activeWorkItems === 0, "apply left active work item");
  assert(activeState.stoppedAt === stoppedAt, "apply did not set stopped_at");
  assert(activeState.note === stopNote, "apply did not set stop note");

  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w3', 'API Active Work', 'task', 'active', 0, '2026-06-30T10:00:00Z', '2026-06-30T10:00:00Z', '2026-06-30T10:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s2', 'API Active Work', 'w3', 'active', 1500, NULL, '2026-06-30T10:00:00Z', NULL, '2026-06-30T10:00:00Z');
  `);

  const apiCalls = [];
  const server = await startApiServer(apiCalls);
  try {
    await writeFile(join(tempDir, "agent.port"), String(server.port));
    const apiApplied = await runStopActive("--apply", "--note", "api stop note");
    assert(apiApplied.stdout.includes("Apply method: agent-api"), "apply did not use agent API");
    assert(apiCalls.some((call) => call.method === "focus.stop"), "agent API path did not call focus.stop");
    assert(
      apiCalls.some((call) => call.method === "work_item.set_state"),
      "agent API path did not clear active work item"
    );
  } finally {
    await server.close();
  }

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

async function runStopActive(...args) {
  return execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-stop-active.mjs"), "--db", dbPath, ...args],
    {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    }
  );
}

async function runStopActiveCaptured(...args) {
  try {
    const { stdout, stderr } = await runStopActive(...args);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
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

async function loadActiveState() {
  const { stdout } = await execFileAsync(
    "sqlite3",
    [
      "-json",
      dbPath,
      `
        SELECT
          (SELECT COUNT(*) FROM focus_sessions WHERE state = 'active') AS active_sessions,
          (SELECT COUNT(*) FROM work_items WHERE state = 'active') AS active_work_items,
          (SELECT stopped_at FROM focus_sessions WHERE id = 's1') AS stopped_at,
          (SELECT note FROM focus_sessions WHERE id = 's1') AS note
      `,
    ],
    { maxBuffer: 10 * 1024 * 1024 }
  );

  const row = JSON.parse(stdout)[0];
  return {
    activeSessions: row.active_sessions,
    activeWorkItems: row.active_work_items,
    stoppedAt: row.stopped_at,
    note: row.note,
  };
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

function startApiServer(calls) {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }

    const payload = body ? JSON.parse(body) : {};
    calls.push({ method: payload.method, params: payload.params });

    let result = "pong";
    if (payload.method === "agent.status") {
      result = {
        version: "0.1.0",
        api_version: "1.0",
        uptime_seconds: 1,
        work_items_count: 1,
        storage_path: tempDir,
        db_ok: true,
      };
    } else if (payload.method === "focus.stop") {
      result = {
        id: payload.params?.id,
        title: "API Active Work",
        state: "stopped",
        target_seconds: 1500,
        active_seconds: 60,
        over_target_seconds: 0,
        note: payload.params?.note,
        started_at: "2026-06-30T10:00:00Z",
        stopped_at: "2026-06-30T10:01:00Z",
        updated_at: "2026-06-30T10:01:00Z",
      };
    } else if (payload.method === "work_item.set_state") {
      result = { success: true };
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        version: "1.0",
        request_id: payload.request_id,
        result,
      })
    );
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}
