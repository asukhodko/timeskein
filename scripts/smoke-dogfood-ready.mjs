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
  assert(ready.stdout.includes("Статус: ГОТОВО"), "ready output did not report localized READY");
  assert(ready.stdout.includes("Режим: старт"), "ready output did not report localized start mode");
  assert(ready.stdout.includes("Агент отвечает: нет"), "ready output did not report localized agent responsiveness");
  assert(ready.stdout.includes("Процессы приложения:"), "ready output did not report localized running app status");
  assert(ready.stdout.includes("## Что сделать дальше"), "ready output did not include localized next section");
  assert(ready.stdout.includes("pnpm dogfood:start"), "ready output did not include start command");
  assert(
    ready.stdout.includes("pnpm dogfood:start:clean:preview"),
    "ready output did not include clean-start preview command"
  );
  assert(ready.stdout.includes("## Памятка закрытия дня"), "ready output did not include day-closure checklist");
  assert(
    ready.stdout.includes("Проверь входы в окно"),
    "ready output did not include window entrypoint reminder"
  );
  assert(
    ready.stdout.includes("Ctrl+Shift+Space") && ready.stdout.includes("запасной") && ready.stdout.includes("Cmd+Option+Space"),
    "ready output did not include concrete global shortcut candidates"
  );
  assert(
    ready.stdout.includes("проверь в списке дел время за день и всего"),
    "ready output did not include item time-total UI reminder"
  );
  assert(
    ready.stdout.includes("Начать закрытие дня") && ready.stdout.includes("10 минут или меньше"),
    "ready output did not include measured day-closure reminder"
  );
  assert(
    ready.stdout.includes("если аудит ещё не чистый") &&
      ready.stdout.includes("Ближайшее действие") &&
      ready.stdout.includes("Проверка перед отчётом"),
    "ready output did not explain pending audit finish flow"
  );
  assert(
    ready.stdout.includes("pnpm dogfood:goal-check -- --date YYYY-MM-DD") &&
      ready.stdout.includes("напечатанному следующему шагу"),
    "ready output did not explain the printed goal-check next step"
  );
  assert(
    ready.stdout.includes("Если запустишь `pnpm dogfood:goal-check` слишком рано") &&
      ready.stdout.includes("Ближайшее действие` из сохранённого отчёта"),
    "ready output did not explain early goal-check next-action guidance"
  );
  assert(!ready.stdout.includes("pnpm dogfood:macos"), "ready output still suggests bypassing dogfood gates");

  const dummyApp = spawnDummyTimeskein();
  try {
    await delay(300);
    const readyWithProcess = await runReady();
    assert(readyWithProcess.code === 0, "clean database with running app process should still be DB-ready");
    assert(
      !readyWithProcess.stdout.includes("Процессы приложения: нет"),
      "ready output did not detect running app process"
    );
    assert(
      readyWithProcess.stdout.includes("Процесс Timeskein уже запущен"),
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
  assert(dirty.stdout.includes("Статус: НЕ ГОТОВО"), "dirty output did not report localized NOT READY");
  assert(dirty.stdout.includes("Активная фокус-сессия"), "dirty output did not mention localized active focus");
  assert(dirty.stdout.includes("Активное дело"), "dirty output did not mention localized active item");
  assert(dirty.stdout.includes("Сегодня уже есть фокус-блоки: 2"), "dirty output did not mention localized today's blocks");
  assert(dirty.stdout.includes("Дублируется название дела"), "dirty output did not mention localized duplicate titles");
  assert(dirty.stdout.includes("pnpm dogfood:stop-active"), "dirty output did not suggest stop-active");
  assert(dirty.stdout.includes("pnpm dogfood:reset-db"), "dirty output did not suggest reset-db");
  assert(
    !dirty.stdout.includes("## Памятка закрытия дня"),
    "dirty output should not show daily-control checklist before readiness blockers are fixed"
  );
  assert(
    dirty.stdout.includes("лучше reset, а не stop-active"),
    "dirty output did not prioritize reset for a contaminated clean trial"
  );
  assert(dirty.stdout.includes("Команда ручного бэкапа"), "dirty output did not include localized manual backup fallback");

  await runSql("DELETE FROM work_items WHERE id IN ('w2', 'w3');");

  const continuing = await runReady(["--mode", "continue"]);
  assert(continuing.code === 0, "continue mode should allow an existing coherent dogfood day");
  assert(continuing.stdout.includes("Режим: продолжение"), "continue output did not report localized continue mode");
  assert(continuing.stdout.includes("Статус: ГОТОВО"), "continue output did not report localized READY");
  assert(
    continuing.stdout.includes("Режим продолжения считает это уже начатым dogfood-днём"),
    "continue output did not explain existing focus blocks"
  );
  assert(
    continuing.stdout.includes("Dogfood-день уже идёт: Dogfood Dirty"),
    "continue output did not identify the active coherent focus"
  );
  assert(
    continuing.stdout.includes("Продолжай текущий dogfood-день в Timeskein"),
    "continue output did not include continue next action"
  );
  assert(
    continuing.stdout.includes("pnpm dogfood:continue"),
    "continue output did not include guarded continue command"
  );
  assert(
    continuing.stdout.includes("## Памятка закрытия дня"),
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
  assert(splitBrain.code !== 0, "continue mode should reject mismatched active item");
  assert(
    splitBrain.stdout.includes("Активная фокус-сессия связана с Dogfood Dirty, а активное дело — Overlapping Dirty"),
    "continue output did not explain active item mismatch"
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
