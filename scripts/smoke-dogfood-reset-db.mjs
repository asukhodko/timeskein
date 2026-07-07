#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-reset-smoke-"));
const dbPath = join(tempDir, "timeskein.db");

try {
  await writeFile(dbPath, "db");
  await writeFile(`${dbPath}-wal`, "wal");
  await writeFile(`${dbPath}-shm`, "shm");

  const dryRun = await runReset();
  assert(dryRun.stdout.includes("Mode: dry-run"), "dry run did not report dry-run mode");
  assert(dryRun.stdout.includes("Running app PIDs:"), "dry run did not report running app status");
  assert(existsSync(dbPath), "dry run moved the database");
  assert(existsSync(`${dbPath}-wal`), "dry run moved the wal file");
  assert(existsSync(`${dbPath}-shm`), "dry run moved the shm file");

  const dummyApp = spawnDummyTimeskein();
  try {
    await delay(300);
    const blocked = await runResetCaptured("--apply");
    assert(blocked.code !== 0, "apply should refuse while timeskein-desktop process is running");
    assert(
      blocked.stderr.includes("Timeskein app process appears to be running"),
      "apply did not explain running process blocker"
    );
    assert(existsSync(dbPath), "blocked apply moved the database");
  } finally {
    await stopChild(dummyApp);
  }

  const applied = await runReset("--apply", "--force");
  assert(applied.stdout.includes("Mode: applied"), "apply did not report applied mode");
  assert(!existsSync(dbPath), "apply left the database in place");
  assert(!existsSync(`${dbPath}-wal`), "apply left the wal file in place");
  assert(!existsSync(`${dbPath}-shm`), "apply left the shm file in place");

  const names = readdirSync(tempDir);
  assert(names.some((name) => name.startsWith("timeskein.db.before-dogfood-")), "database backup is missing");
  assert(names.some((name) => name.startsWith("timeskein.db-wal.before-dogfood-")), "wal backup is missing");
  assert(names.some((name) => name.startsWith("timeskein.db-shm.before-dogfood-")), "shm backup is missing");

  const ready = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-ready.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );
  assert(ready.stdout.includes("Статус: ГОТОВО"), "missing database should be ready after reset");

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

async function runReset(...args) {
  return execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-reset-db.mjs"), "--db", dbPath, ...args],
    { cwd: repoRoot }
  );
}

async function runResetCaptured(...args) {
  try {
    const { stdout, stderr } = await runReset(...args);
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
