#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const options = parseArgs(process.argv.slice(2));
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
const supportDir = dirname(dbPath);
const stoppedAt = options.stoppedAt ?? new Date().toISOString();
const stopNote = options.note ?? "closed by dogfood:stop-active";
const runningPids = await runningTimeskeinPids();

if (!existsSync(dbPath)) {
  console.log(`# Остановка активного Timeskein-фокуса\n\nБаза: ${dbPath}\nСтатус: нечего останавливать`);
  process.exit(0);
}

const responsiveAgent = await detectResponsiveAgent(supportDir);
if (responsiveAgent && options.apply && options.stoppedAt && !options.force) {
  console.error(
    [
      "Агент Timeskein сейчас запущен.",
      `Agent URL: ${responsiveAgent}`,
      "--stopped-at нельзя применить через API запущенного агента.",
      "Убери --stopped-at, останови фокус-блок в приложении или передай --force, если прямое изменение базы допустимо.",
    ].join("\n")
  );
  process.exit(1);
}

if (!responsiveAgent && runningPids.length > 0 && options.apply && !options.force) {
  console.error(
    [
      `Процесс Timeskein сейчас запущен: PID ${runningPids.join(", ")}`,
      "Локальный API не отвечает, поэтому прямое изменение SQLite небезопасно.",
      "Сначала закрой Timeskein или передай --force, если точно знаешь, что база не используется.",
    ].join("\n")
  );
  process.exit(1);
}

const summary = await loadActiveSummary(dbPath);

if (summary.activeSessions.length === 0 && summary.activeWorkItems.length === 0) {
  console.log(
    buildReport({
      dbPath,
      responsiveAgent,
      runningPids,
      stoppedAt,
      stopNote,
      dryRun: !options.apply,
      activeSessions: [],
      activeWorkItems: [],
      applied: false,
    })
  );
  process.exit(0);
}

if (options.apply) {
  if (responsiveAgent && !options.force) {
    await stopActiveViaAgent(responsiveAgent, summary, stopNote);
  } else {
    await stopActiveInSqlite(dbPath, stoppedAt, stopNote);
  }
}

console.log(
  buildReport({
    dbPath,
    responsiveAgent,
    runningPids,
    stoppedAt,
    stopNote,
    dryRun: !options.apply,
    activeSessions: summary.activeSessions,
    activeWorkItems: summary.activeWorkItems,
    applied: options.apply,
    applyMethod: options.apply && responsiveAgent && !options.force ? "agent-api" : options.apply ? "sqlite" : undefined,
  })
);

function parseArgs(args) {
  const result = {
    apply: false,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--db") {
      result.db = args[++index];
    } else if (arg === "--apply") {
      result.apply = true;
    } else if (arg === "--force") {
      result.force = true;
    } else if (arg === "--stopped-at") {
      result.stoppedAt = parseIsoDate(args[++index]);
    } else if (arg === "--note") {
      result.note = args[++index] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }

  return result;
}

function printHelp() {
  console.log(`Использование: pnpm dogfood:stop-active [--apply] [--force] [--note text] [--db path/to/timeskein.db]

Останавливает активные фокус-сессии Timeskein и снимает активный статус с дел.
По умолчанию это сухой прогон. Передай --apply, чтобы изменить базу.
Если агент Timeskein запущен, --apply останавливает блок через локальный API.
Если агент не отвечает и процесс приложения не запущен, --apply изменяет SQLite напрямую.
Передай --force, чтобы принудительно использовать прямое изменение SQLite.`);
}

function parseIsoDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error(`Некорректное значение --stopped-at, ожидается ISO-дата: ${value}`);
  }

  return date.toISOString();
}

async function loadActiveSummary(path) {
  const [activeSessions, activeWorkItems] = await Promise.all([
    queryJson(path, `
      SELECT
        fs.id,
        fs.title,
        wi.title AS work_item_title,
        fs.started_at
      FROM focus_sessions fs
      LEFT JOIN work_items wi ON wi.id = fs.work_item_id
      WHERE fs.state = 'active'
      ORDER BY datetime(fs.started_at) DESC
    `),
    queryJson(path, `
      SELECT id, title, updated_at
      FROM work_items
      WHERE deleted_at IS NULL AND state = 'active'
      ORDER BY datetime(updated_at) DESC
    `),
  ]);

  return { activeSessions, activeWorkItems };
}

async function queryJson(path, sql) {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-cmd", ".timeout 5000", "-json", path, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.trim() ? JSON.parse(stdout) : [];
}

async function stopActiveViaAgent(apiUrl, summary, note) {
  for (const session of summary.activeSessions) {
    await rpc(apiUrl, "focus.stop", { id: session.id, note });
  }

  for (const item of summary.activeWorkItems) {
    await rpc(apiUrl, "work_item.set_state", { id: item.id, state: "unknown" });
  }
}

async function stopActiveInSqlite(path, at, note) {
  const sql = `
    BEGIN IMMEDIATE;

    UPDATE focus_sessions
       SET state = 'stopped',
           stopped_at = COALESCE(stopped_at, ${sqlString(at)}),
           updated_at = ${sqlString(at)},
           note = CASE
             WHEN note IS NULL OR trim(note) = '' THEN ${sqlString(note)}
             ELSE note || '; ' || ${sqlString(note)}
           END
     WHERE state = 'active';

    UPDATE work_items
       SET state = 'unknown',
           updated_at = ${sqlString(at)},
           last_seen_at = ${sqlString(at)}
     WHERE deleted_at IS NULL
       AND state = 'active';

    COMMIT;
  `;

  await execFileAsync("sqlite3", ["-cmd", ".timeout 5000", path, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function detectResponsiveAgent(dir) {
  const portPath = join(dir, "agent.port");
  if (!existsSync(portPath)) {
    return undefined;
  }

  const port = readFileSync(portPath, "utf8").trim();
  if (!/^\d+$/.test(port)) {
    return undefined;
  }

  const apiUrl = `http://127.0.0.1:${port}/api`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "1.0",
        request_id: crypto.randomUUID(),
        method: "agent.status",
        params: {},
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return response.ok ? apiUrl : undefined;
  } catch {
    return undefined;
  }
}

async function runningTimeskeinPids() {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-x", "timeskein-desktop"]);
    return stdout
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 1) {
      return [];
    }

    throw error;
  }
}

async function rpc(apiUrl, method, params = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "1.0",
        request_id: crypto.randomUUID(),
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${method}: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
    }

    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

function buildReport({ dbPath, responsiveAgent, runningPids, stoppedAt, stopNote, dryRun, activeSessions, activeWorkItems, applied, applyMethod }) {
  const lines = [
    "# Остановка активного Timeskein-фокуса",
    "",
    `Режим: ${dryRun ? "сухой прогон" : "применено"}`,
    `Способ применения: ${applyMethod ?? "нет"}`,
    `База: ${dbPath}`,
    `Агент отвечает: ${responsiveAgent ?? "нет"}`,
    `PID процессов приложения: ${runningPids.length > 0 ? runningPids.join(", ") : "нет"}`,
    `Остановить на момент: ${stoppedAt}`,
    `Заметка остановки: ${stopNote}`,
    "",
    "## Активные фокус-сессии",
    "",
  ];

  if (activeSessions.length === 0) {
    lines.push("- нет");
  } else {
    for (const session of activeSessions) {
      lines.push(`- ${session.work_item_title ?? session.title}, с ${formatClockTime(session.started_at)}`);
    }
  }

  lines.push("", "## Активные дела", "");
  if (activeWorkItems.length === 0) {
    lines.push("- нет");
  } else {
    for (const item of activeWorkItems) {
      lines.push(`- ${item.title}`);
    }
  }

  lines.push("", "## Дальше", "");
  if (dryRun && (activeSessions.length > 0 || activeWorkItems.length > 0)) {
    lines.push("- Выполни `pnpm dogfood:stop-active -- --apply`, чтобы закрыть активный блок.");
  }
  if (applied) {
    lines.push("- Снова выполни `pnpm dogfood:ready`.");
  }
  lines.push("- Для чистого однодневного теста без старых фокус-блоков используй `pnpm dogfood:reset-db`.");

  return `${lines.join("\n")}\n`;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function formatClockTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
