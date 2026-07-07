#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const options = parseArgs(process.argv.slice(2));
const mode = options.mode ?? "start";
const date = options.date ? parseLocalDate(options.date) : new Date();
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
const supportDir = dirname(dbPath);
const appBundlePath = resolve("target/release/bundle/macos/Timeskein.app");

const lines = [`# Готовность Timeskein dogfood - ${formatLocalDate(date)}`, ""];
const blockers = [];
const warnings = [];
const nextActions = [];
const responsiveAgent = await detectResponsiveAgent(supportDir);
const runningPids = await runningTimeskeinPids();

lines.push(`Режим: ${formatMode(mode)}`);
lines.push(`База: ${dbPath}`);
lines.push(`Приложение: ${existsSync(appBundlePath) ? appBundlePath : "сборка ещё не найдена"}`);
lines.push(`Агент отвечает: ${responsiveAgent ?? "нет"}`);
lines.push(`Процессы приложения: ${runningPids.length > 0 ? runningPids.join(", ") : "нет"}`);
lines.push("");

if (!existsSync(dbPath)) {
  warnings.push("База Timeskein ещё не создана. macOS-приложение должно создать её при первом запуске.");
} else {
  try {
    const summary = await loadSummary(dbPath, date);
    addSummary(lines, blockers, warnings, nextActions, summary, responsiveAgent, runningPids, mode);
  } catch (error) {
    blockers.push(`Не удалось прочитать базу Timeskein: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!existsSync(appBundlePath)) {
  warnings.push("macOS-приложение ещё не собрано. `pnpm dogfood:start` соберёт его через preflight перед открытием.");
}

if (responsiveAgent) {
  warnings.push("Агент Timeskein уже отвечает. Перед чистым dogfood-стартом закрой текущее приложение, чтобы использовать свежую сборку.");
}

if (runningPids.length > 0) {
  warnings.push("Процесс Timeskein уже запущен. Перед чистым dogfood-стартом закрой его, чтобы использовать свежую сборку.");
}

lines.push(`Статус: ${blockers.length === 0 ? "ГОТОВО" : "НЕ ГОТОВО"}`, "");
appendSection(lines, "Блокеры", blockers);
appendSection(lines, "Предупреждения", warnings);

if (blockers.length === 0) {
  appendReadyNext(lines, mode);
  appendDailyControlChecklist(lines);
} else {
  lines.push("## Что сделать дальше", "");
  for (const action of unique(nextActions)) {
    lines.push(`- ${action}`);
  }
  lines.push(`- Команда ручного бэкапа, если понадобится: ${backupCommand(dbPath)}`);
  lines.push("- Перед использованием Timeskein вместо Session снова выполни `pnpm dogfood:ready`.");
}

process.stdout.write(`${lines.join("\n")}\n`);

if (blockers.length > 0) {
  process.exitCode = 1;
}

function appendDailyControlChecklist(lines) {
  lines.push("## Памятка закрытия дня", "");
  lines.push("- Проверь входы в окно: menu bar, глобальный хоткей (`Ctrl+Shift+Space`, запасной `Ctrl+Option+Space` или `Cmd+Option+Space`), возврат через macOS, скрытие через Esc или закрытие окна.");
  lines.push("- Начни одно новое дело вводом названия и продолжи одно существующее дело из списка.");
  lines.push("- Когда у затронутого дела появится фокус-время, проверь в списке дел время за день и всего, затем нажми `Время верно` в соответствующей проверке.");
  lines.push("- Используй минимум две зоны активности, включая одну нерабочую: координация, восстановление, простой или личные дела.");
  lines.push("- Добавь одно событие дня через `Добавить событие дня...` для буфера, разрыва, восстановления или коррекции трекинга.");
  lines.push("- Добавь или продвинь одно событие дела с временем, если для задачи важна конкретная подробность.");
  lines.push("- Во время активного фокуса зафиксируй хотя бы одно входящее отвлечение через `Зафиксировать отвлечение...`, затем закрой его, преврати `В дело`/`В событие` или явно оставь открытым.");
  lines.push("- Перед финальным отчётом поправь одну безопасную деталь трекинга или нажми `Трекинг верен` у проверки точности трекинга.");
  lines.push("- Вечером нажми `Начать закрытие дня`, убери красные блокеры, осознанно отметь оставшиеся жёлтые проверки и дойди до финального `Копировать отчёт` за 10 минут или меньше.");
  lines.push("- Закрой день командой `pnpm dogfood:finish:save`; если аудит ещё не чистый, она покажет `Ближайшее действие` и куда вернуться в `Проверка перед отчётом`.");
  lines.push("- Когда закрытие измерено и аудит весь `ок`, `pnpm dogfood:finish:save` напечатает точную команду `pnpm dogfood:goal-check -- --date YYYY-MM-DD`.");
  lines.push("- Если запустишь `pnpm dogfood:goal-check` слишком рано, он тоже повторит `Ближайшее действие` из сохранённого отчёта.");
  lines.push("- Если закрываешь день после полуночи, сначала явно передай дату dogfood-дня: `pnpm dogfood:finish:save -- --date YYYY-MM-DD`, затем следуй напечатанному следующему шагу.");
}

function appendReadyNext(lines, mode) {
  lines.push("## Что сделать дальше", "");
  if (mode === "continue") {
    lines.push("- Продолжай текущий dogfood-день в Timeskein.");
    lines.push("- Если приложение не открыто, выполни `pnpm dogfood:continue`: команда проверит состояние дня и откроет собранное приложение.");
  } else {
    lines.push("- Начни dogfood-день командой `pnpm dogfood:start`.");
    lines.push("- Если предупреждения говорят о запущенном приложении или агенте, сначала закрой Timeskein, чтобы использовать свежую сборку.");
    lines.push("- Если нужна чистая тестовая база, сначала посмотри план через `pnpm dogfood:start:clean:preview`, затем выполни `pnpm dogfood:start:clean`.");
  }
  lines.push("");
}

function parseArgs(args) {
  const result = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--db") {
      result.db = args[++index];
    } else if (arg === "--date") {
      result.date = args[++index];
    } else if (arg === "--mode") {
      const mode = args[++index];
      if (mode !== "start" && mode !== "continue") {
        throw new Error(`Invalid --mode value, expected start or continue: ${mode}`);
      }
      result.mode = mode;
    } else if (arg === "--continue") {
      result.mode = "continue";
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function printHelp() {
  console.log(`Использование: pnpm dogfood:ready [--mode start|continue] [--date YYYY-MM-DD] [--db path/to/timeskein.db]

Проверяет реальную локальную базу Timeskein перед однодневной заменой Session.
Команда ничего не меняет и завершается с кодом 1, если выбранный режим небезопасен.
Режим start требует чистого дня. Режим continue разрешает уже начатый день и один согласованный активный фокус.`);
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value, expected YYYY-MM-DD: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

async function loadSummary(path, day) {
  const from = startOfLocalDay(day);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  const now = new Date();

  const [counts, activeSessions, activeWorkItems, todaySessions, duplicateTitles] =
    await Promise.all([
      queryJson(path, `
        SELECT
          (SELECT COUNT(*) FROM work_items WHERE deleted_at IS NULL) AS work_items,
          (SELECT COUNT(*) FROM focus_sessions) AS focus_sessions
      `),
      queryJson(path, `
        SELECT
          fs.id,
          fs.title,
          fs.work_item_id,
          wi.title AS work_item_title,
          fs.started_at,
          fs.updated_at
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
      queryJson(path, `
        SELECT
          fs.id,
          fs.title,
          wi.title AS work_item_title,
          fs.state,
          fs.started_at,
          fs.stopped_at,
          fs.note
        FROM focus_sessions fs
        LEFT JOIN work_items wi ON wi.id = fs.work_item_id
        WHERE datetime(COALESCE(fs.stopped_at, ${sqlString(now.toISOString())})) > datetime(${sqlString(from.toISOString())})
          AND datetime(fs.started_at) < datetime(${sqlString(to.toISOString())})
        ORDER BY datetime(fs.started_at) ASC
      `),
      queryJson(path, `
        SELECT
          lower(trim(title)) AS normalized_title,
          COUNT(*) AS count,
          GROUP_CONCAT(title, ' | ') AS titles
        FROM work_items
        WHERE deleted_at IS NULL
        GROUP BY lower(trim(title))
        HAVING COUNT(*) > 1
        ORDER BY count DESC, normalized_title ASC
      `),
    ]);

  return {
    counts: counts[0] ?? { work_items: 0, focus_sessions: 0 },
    activeSessions,
    activeWorkItems,
    todaySessions: todaySessions.map((session) => ({
      ...session,
      active_seconds: clippedActiveSeconds(session, from, to, now),
    })),
    duplicateTitles,
  };
}

async function queryJson(path, sql) {
  const { stdout } = await execFileAsync("sqlite3", sqliteReadArgs(path, sql), {
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.trim() ? JSON.parse(stdout) : [];
}

function sqliteReadArgs(path, sql) {
  return ["-readonly", "-cmd", ".timeout 5000", "-json", path, sql];
}

function addSummary(lines, blockers, warnings, nextActions, summary, responsiveAgent, runningPids, mode) {
  const todaySeconds = summary.todaySessions.reduce((sum, session) => sum + session.active_seconds, 0);

  lines.push("## Сводка", "");
  lines.push(`- Дел: ${summary.counts.work_items}`);
  lines.push(`- Фокус-сессий: ${summary.counts.focus_sessions}`);
  lines.push(`- Активных фокус-сессий: ${summary.activeSessions.length}`);
  lines.push(`- Активных дел: ${summary.activeWorkItems.length}`);
  lines.push(`- Фокус-блоков сегодня: ${summary.todaySessions.length}`);
  lines.push(`- Фокус сегодня: ${formatDuration(todaySeconds)}`);
  lines.push(`- Групп дублей названий: ${summary.duplicateTitles.length}`);
  lines.push("");

  if (mode === "continue") {
    addContinueModeFindings(blockers, warnings, nextActions, summary, todaySeconds);
  } else {
    addStartModeFindings(
      blockers,
      warnings,
      nextActions,
      summary,
      todaySeconds,
      responsiveAgent,
      runningPids
    );
  }

  if (summary.duplicateTitles.length > 0) {
    for (const duplicate of summary.duplicateTitles.slice(0, 5)) {
      blockers.push(`Дублируется название дела (${duplicate.count}): ${duplicate.titles}`);
    }
    if (summary.duplicateTitles.length > 5) {
      blockers.push(`Ещё групп дублей: ${summary.duplicateTitles.length - 5}`);
    }
    nextActions.push("Для чистого однодневного теста лучше выполнить `pnpm dogfood:reset-db`, а не разбирать дубли вручную.");
  }

  if (summary.counts.work_items === 0) {
    warnings.push("Дел пока нет. Для свежего теста это нормально: ввод названия создаст их при старте фокуса.");
  }
}

function addStartModeFindings(blockers, warnings, nextActions, summary, todaySeconds, responsiveAgent, runningPids) {
  const hasExistingDayBlocks = summary.todaySessions.length > 0;

  if (summary.activeSessions.length > 0) {
    for (const session of summary.activeSessions) {
      blockers.push(
        `Активная фокус-сессия: ${session.work_item_title ?? session.title}, с ${formatClockTime(session.started_at)}`
      );
    }
  }

  if (summary.activeWorkItems.length > 0) {
    for (const item of summary.activeWorkItems) {
      blockers.push(`Активное дело: ${item.title}`);
    }
  }

  if (hasExistingDayBlocks) {
    blockers.push(
      `Сегодня уже есть фокус-блоки: ${summary.todaySessions.length}, всего ${formatDuration(todaySeconds)}. Это смешает чистый однодневный тест со старыми данными.`
    );
    nextActions.push("Для чистого однодневного теста с уже существующими блоками лучше reset, а не stop-active: сначала выполни dry-run `pnpm dogfood:reset-db`.");
    if (responsiveAgent) {
      nextActions.push("Перед применением reset закрой Timeskein: `dogfood:reset-db -- --apply` откажется работать, пока агент отвечает.");
    } else if (runningPids.length > 0) {
      nextActions.push("Перед применением reset закрой Timeskein: `dogfood:reset-db -- --apply` откажется работать, пока процесс приложения запущен.");
    }
    nextActions.push("Если план reset выглядит правильно, выполни `pnpm dogfood:reset-db -- --apply`.");
  }

  if (summary.activeSessions.length > 0) {
    const reason = hasExistingDayBlocks
      ? "Если хочешь сохранить текущую базу вместо чистого старта, сначала выполни dry-run `pnpm dogfood:stop-active`."
      : "Останови активный фокус-блок в Timeskein или сначала выполни dry-run `pnpm dogfood:stop-active`.";
    nextActions.push(reason);
    nextActions.push("Если план остановки выглядит правильно, выполни `pnpm dogfood:stop-active -- --apply`.");
  }

  if (summary.activeWorkItems.length > 0) {
    nextActions.push("Сними активный статус с дела: останови текущий фокус-блок или выполни `pnpm dogfood:stop-active -- --apply`.");
  }
}

function addContinueModeFindings(blockers, warnings, nextActions, summary, todaySeconds) {
  if (summary.todaySessions.length > 0) {
    warnings.push(
      `В выбранном дне уже есть фокус-блоки: ${summary.todaySessions.length}, всего ${formatDuration(todaySeconds)}. Режим продолжения считает это уже начатым dogfood-днём.`
    );
  }

  if (summary.activeSessions.length > 1) {
    blockers.push(`Несколько активных фокус-сессий: ${summary.activeSessions.length}`);
    nextActions.push("Сначала выполни dry-run `pnpm dogfood:stop-active`, затем примени план, если он выглядит правильно.");
    return;
  }

  if (summary.activeSessions.length === 0) {
    if (summary.activeWorkItems.length > 0) {
      for (const item of summary.activeWorkItems) {
        blockers.push(`Дело активно, но активной фокус-сессии нет: ${item.title}`);
      }
      nextActions.push("Сними активный статус через `pnpm dogfood:stop-active -- --apply` или поменяй состояние в приложении.");
    }
    return;
  }

  const activeSession = summary.activeSessions[0];
  const activeWorkItem = summary.activeWorkItems[0];

  if (summary.activeWorkItems.length !== 1) {
    blockers.push(
      `Активная фокус-сессия есть, но активных дел: ${summary.activeWorkItems.length}; ожидалось ровно одно.`
    );
    nextActions.push("Сначала выполни dry-run `pnpm dogfood:stop-active`, затем примени план, если он выглядит правильно.");
    return;
  }

  if (activeSession.work_item_id !== activeWorkItem.id) {
    blockers.push(
      `Активная фокус-сессия связана с ${activeSession.work_item_title ?? activeSession.title}, а активное дело — ${activeWorkItem.title}.`
    );
    nextActions.push("Переключи фокус в приложении или выполни dry-run `pnpm dogfood:stop-active` и примени план, если он выглядит правильно.");
    return;
  }

  warnings.push(
    `Dogfood-день уже идёт: ${activeWorkItem.title}, с ${formatClockTime(activeSession.started_at)}.`
  );
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

function unique(values) {
  return [...new Set(values)];
}

function formatMode(value) {
  return value === "continue" ? "продолжение" : "старт";
}

function appendSection(lines, title, items) {
  lines.push(`## ${title}`, "");

  if (items.length === 0) {
    lines.push("- нет", "");
    return;
  }

  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push("");
}

function startOfLocalDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function clippedActiveSeconds(session, from, to, now) {
  const startedAt = new Date(session.started_at);
  const stoppedAt = session.stopped_at ? new Date(session.stopped_at) : now;
  const clippedStart = Math.max(startedAt.getTime(), from.getTime());
  const clippedStop = Math.min(stoppedAt.getTime(), to.getTime());

  return Math.max(Math.floor((clippedStop - clippedStart) / 1000), 0);
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function backupCommand(path) {
  const suffix = formatLocalDateTime(new Date()).replaceAll(":", "").replace("T", "-");
  return `cp ${shellQuote(path)} ${shellQuote(`${path}.before-dogfood-${suffix}`)}`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(Math.floor(totalSeconds), 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatClockTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${formatLocalDate(date)}T${hours}:${minutes}:${seconds}`;
}
