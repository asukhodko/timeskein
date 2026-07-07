#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-start-smoke-"));
const dbPath = join(tempDir, "timeskein.db");

try {
  await runSqlFile(join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/002_focus_sessions.sql"));

  const clean = await runStart();
  assert(clean.code === 0, "clean database should pass the start gate");
  assert(clean.stdout.includes("Статус: ГОТОВО"), "clean start gate did not run localized readiness");
  assert(
    clean.stdout.includes("No running timeskein-desktop process found"),
    "clean start gate did not check for an already running app"
  );
  assert(clean.stdout.includes("Dry run: app was not opened"), "clean start gate did not stay dry-run");

  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w1', 'Dirty Start Gate', 'task', 'active', 0, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s1', 'Dirty Start Gate', 'w1', 'active', 1500, NULL, '2026-06-30T06:00:00Z', NULL, '2026-06-30T06:00:00Z');
  `);

  const dirty = await runStart();
  assert(dirty.code !== 0, "dirty database should fail the start gate");
  assert(dirty.stdout.includes("Статус: НЕ ГОТОВО"), "dirty start gate did not report localized NOT READY");
  assert(dirty.stdout.includes("Активная фокус-сессия"), "dirty start gate did not mention localized active focus");

  const continuing = await runStart({ mode: "continue" });
  assert(continuing.code === 0, "coherent active dogfood day should pass the continue gate");
  assert(continuing.stdout.includes("Режим: продолжение"), "continue start gate did not use localized continue readiness");
  assert(continuing.stdout.includes("Статус: ГОТОВО"), "continue start gate did not report localized READY");
  assert(continuing.stdout.includes("Dry run: app was not opened"), "continue start gate did not stay dry-run");

  const fakeBin = join(tempDir, "fake-bin");
  await mkdir(fakeBin);
  await writeFile(join(fakeBin, "pnpm"), "#!/bin/sh\necho preflight should not run >&2\nexit 42\n");
  await chmod(join(fakeBin, "pnpm"), 0o755);

  const dirtyWithoutSkip = await runStart({
    skipPreflight: false,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    },
  });
  assert(dirtyWithoutSkip.code !== 0, "dirty database should fail before preflight");
  assert(dirtyWithoutSkip.stdout.includes("Статус: НЕ ГОТОВО"), "dirty start gate did not run localized readiness first");
  assert(
    !dirtyWithoutSkip.stderr.includes("preflight should not run"),
    "dirty start gate ran preflight before readiness"
  );

  const cleanStart = await runStart({ resetDb: true });
  assert(cleanStart.code === 0, "clean start dry run should plan reset and pass safe checks");
  assert(cleanStart.stdout.includes("# Timeskein dogfood DB reset"), "clean start did not run reset-db");
  assert(cleanStart.stdout.includes("Mode: dry-run"), "clean start dry run applied reset");
  assert(
    cleanStart.stdout.includes("No running timeskein-desktop process found"),
    "clean start dry run did not check for an already running app"
  );
  assert(
    cleanStart.stdout.includes("Database was not moved and app was not opened"),
    "clean start dry run did not explain that it was non-mutating"
  );
  assert(existsSync(dbPath), "clean start dry run moved the dirty database");

  const dirtyAfterCleanDryRun = await runStart();
  assert(dirtyAfterCleanDryRun.code !== 0, "clean start dry run should leave dirty database dirty");

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

async function runStart({ resetDb = false, skipPreflight = true, env = process.env, mode } = {}) {
  const args = [
    join(repoRoot, "scripts/dogfood-start.mjs"),
    "--dry-run",
    "--db",
    dbPath,
    "--date",
    "2026-06-30",
  ];

  if (skipPreflight) {
    args.splice(1, 0, "--skip-preflight");
  }

  if (resetDb) {
    args.splice(1, 0, "--reset-db");
  }

  if (mode) {
    args.splice(1, 0, "--mode", mode);
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      args,
      {
        cwd: repoRoot,
        env,
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
