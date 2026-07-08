#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APP_EVENT_KIND_LABELS = {
  app_started: "приложение запущено",
  agent_started: "агент запущен",
  agent_reused: "агент переиспользован",
  agent_stale_runtime_recovered: "устаревшее состояние агента восстановлено",
  api_error: "ошибка API",
  window_shown: "окно показано",
  window_hidden: "окно скрыто",
  window_drag_started: "перетаскивание окна начато",
  window_show_requested: "запрошен показ окна",
  window_hide_requested: "запрошено скрытие окна",
  window_entrypoints_reviewed: "входы в окно проверены",
  focus_start_requested: "запрошен старт фокуса",
  focus_started: "фокус начат",
  focus_switch_requested: "запрошено переключение фокуса",
  focus_switched: "фокус переключён",
  focus_stop_requested: "запрошена остановка фокуса",
  focus_stopped: "фокус остановлен",
  focus_start_failed: "старт фокуса не удался",
  focus_stop_failed: "остановка фокуса не удалась",
  focus_correction_requested: "запрошена коррекция фокуса",
  focus_corrected: "фокус скорректирован",
  focus_correction_reviewed: "коррекция фокуса проверена",
  focus_correction_failed: "коррекция фокуса не удалась",
  capture_create_requested: "запрошено создание отвлечения",
  capture_created: "отвлечение создано",
  capture_resolve_requested: "запрошено закрытие отвлечения",
  capture_resolved: "отвлечение закрыто",
  capture_update_requested: "запрошено исправление отвлечения",
  capture_updated: "отвлечение исправлено",
  capture_delete_requested: "запрошено удаление отвлечения",
  capture_deleted: "отвлечение удалено",
  capture_convert_requested: "запрошено превращение отвлечения в дело",
  capture_converted: "отвлечение превращено в дело",
  capture_create_failed: "создание отвлечения не удалось",
  capture_resolve_failed: "закрытие отвлечения не удалось",
  capture_update_failed: "исправление отвлечения не удалось",
  capture_delete_failed: "удаление отвлечения не удалось",
  capture_convert_failed: "превращение отвлечения не удалось",
  capture_followup_reviewed: "открытые отвлечения проверены",
  day_context_reviewed: "контекст дня проверен",
  capture_usage_reviewed: "инбокс отвлечений проверен",
  work_item_time_badges_reviewed: "время по делам проверено",
  activity_zone_glanced: "зоны активности учтены",
  activity_zone_reviewed: "зоны активности проверены",
  entry_paths_reviewed: "пути входа проверены",
  day_closure_started: "закрытие дня начато",
  day_closure_completed: "закрытие дня завершено",
  report_copy_requested: "запрошено копирование отчёта",
  report_copied: "отчёт скопирован",
  report_copy_failed: "копирование отчёта не удалось",
  manual_copy_fallback_shown: "показано ручное копирование",
};

try {
  const options = parseArgs(process.argv.slice(2));
  const date = options.date ? parseLocalDate(options.date) : new Date();
  const dbPath = options.db
    ? resolve(options.db)
    : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");

  if (!existsSync(dbPath)) {
    throw new Error(`База Timeskein не найдена: ${dbPath}`);
  }

  const from = startOfLocalDay(date);
  const to = nextLocalDay(from);
  const events = await loadEvents(dbPath, from, to);

  process.stdout.write(buildTelemetryMarkdown(events, { raw: Boolean(options.raw) }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
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
    } else if (arg === "--raw") {
      result.raw = true;
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
  console.log(`Использование: pnpm dogfood:metrics [--date YYYY-MM-DD] [--db path/to/timeskein.db] [--raw]

Печатает Markdown-сводку локальной технической телеметрии Timeskein.
По умолчанию вывод человекочитаемый на русском. --raw оставляет старые технические labels для внутренних скриптов.`);
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Некорректное значение --date, ожидается YYYY-MM-DD: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

async function loadEvents(path, from, to) {
  if (!(await tableExists(path, "app_events"))) {
    return [];
  }

  const query = `
    SELECT id, ts, source, kind, work_item_id, focus_session_id, payload
    FROM app_events
    WHERE datetime(ts) >= datetime(${sqlString(from.toISOString())})
      AND datetime(ts) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(ts) ASC
  `;

  const { stdout } = await execFileAsync("sqlite3", sqliteReadArgs(path, query), {
    maxBuffer: 10 * 1024 * 1024,
  });

  const rows = stdout.trim() ? JSON.parse(stdout) : [];
  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    source: row.source,
    kind: row.kind,
    work_item_id: row.work_item_id ?? undefined,
    focus_session_id: row.focus_session_id ?? undefined,
    payload: parsePayload(row.payload),
  }));
}

async function tableExists(path, tableName) {
  const { stdout } = await execFileAsync(
    "sqlite3",
    sqliteReadArgs(
      path,
      `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)}`
    ),
    { maxBuffer: 1024 * 1024 }
  );
  const rows = stdout.trim() ? JSON.parse(stdout) : [];
  return (rows[0]?.count ?? 0) > 0;
}

function buildTelemetryMarkdown(events, { raw = false } = {}) {
  const summary = summarizeEvents(events);
  const lines = raw
    ? [
        "## App Telemetry",
        "",
        `Total events: ${summary.total}`,
        `Start requests: ${summary.startRequests}`,
        `Switch requests: ${summary.switchRequests}`,
        `Stop requests: ${summary.stopRequests}`,
        `Typed/selected/dispatch entry requests: ${summary.typedEntryRequests}/${summary.selectedEntryRequests}/${summary.dispatchRitualEntryRequests}`,
        `Start/stop failures: ${summary.startFailures}/${summary.stopFailures}`,
        `Window shown/hidden: ${summary.windowShown}/${summary.windowHidden}`,
        `Window show/hide requests: ${summary.windowShowRequested}/${summary.windowHideRequested}`,
        `Window drag starts: ${summary.windowDragStarted}`,
        `Copy failures: ${summary.copyFailures}`,
        `Manual copy fallbacks: ${summary.manualCopyFallbacks}`,
        `Capture created/resolved/converted: ${summary.captureCreated}/${summary.captureResolved}/${summary.captureConverted}`,
        `Capture follow-up reviews: ${summary.captureFollowupReviews}`,
        `Day context reviews: ${summary.dayContextReviews}`,
        `Work Item time badge reviews: ${summary.workItemTimeBadgeReviews}`,
        `Activity Zone glances: ${summary.activityZoneGlances}`,
        `Activity Zone reviews: ${summary.activityZoneReviews}`,
        `Capture usage reviews: ${summary.captureUsageReviews}`,
        `Entry path reviews: ${summary.entryPathReviews}`,
        `Window entrypoint reviews: ${summary.windowEntrypointReviews}`,
        `Capture updated/deleted: ${summary.captureUpdated}/${summary.captureDeleted}`,
        `Capture failures create/resolve/update/delete/convert: ${summary.captureCreateFailures}/${summary.captureResolveFailures}/${summary.captureUpdateFailures}/${summary.captureDeleteFailures}/${summary.captureConvertFailures}`,
        `Corrections requested/applied/reviewed/failed: ${summary.correctionRequests}/${summary.corrections}/${summary.correctionReviews}/${summary.correctionFailures}`,
        `Day closure started/completed: ${summary.dayClosureStarts}/${summary.dayClosureCompletions}`,
        `Last day closure duration: ${summary.lastDayClosureDurationSeconds == null ? "n/a" : formatDuration(summary.lastDayClosureDurationSeconds)}`,
        `API errors: ${summary.apiErrors}`,
        `Already-active start attempts: ${summary.alreadyActiveStartAttempts}`,
        `Stale runtime recoveries: ${summary.staleRuntimeRecoveries}`,
        `Average start latency: ${summary.averageStartLatencyMs == null ? "n/a" : `${summary.averageStartLatencyMs}ms`}`,
        `Slow window-to-focus gaps: ${summary.slowWindowToFocusCount}`,
      ]
    : [
        "## Телеметрия приложения",
        "",
        `Всего событий: ${summary.total}`,
        `Запросов старта: ${summary.startRequests}`,
        `Запросов переключения: ${summary.switchRequests}`,
        `Запросов остановки: ${summary.stopRequests}`,
        `Входов вводом/из списка/через диспетчеризацию: ${summary.typedEntryRequests}/${summary.selectedEntryRequests}/${summary.dispatchRitualEntryRequests}`,
        `Ошибок старта/остановки: ${summary.startFailures}/${summary.stopFailures}`,
        `Окно показано/скрыто: ${summary.windowShown}/${summary.windowHidden}`,
        `Запросов показать/скрыть окно: ${summary.windowShowRequested}/${summary.windowHideRequested}`,
        `Начатых перетаскиваний окна: ${summary.windowDragStarted}`,
        `Ошибок копирования: ${summary.copyFailures}`,
        `Ручных копирований вместо буфера: ${summary.manualCopyFallbacks}`,
        `Отвлечений создано/закрыто/превращено: ${summary.captureCreated}/${summary.captureResolved}/${summary.captureConverted}`,
        `Проверок открытых отвлечений: ${summary.captureFollowupReviews}`,
        `Проверок времени по делам: ${summary.workItemTimeBadgeReviews}`,
        `Просмотров зон активности: ${summary.activityZoneGlances}`,
        `Проверок зон активности: ${summary.activityZoneReviews}`,
        `Проверок использования инбокса: ${summary.captureUsageReviews}`,
        `Проверок путей входа: ${summary.entryPathReviews}`,
        `Проверок входа в окно: ${summary.windowEntrypointReviews}`,
        `Отвлечений исправлено/удалено: ${summary.captureUpdated}/${summary.captureDeleted}`,
        `Ошибок отвлечений создать/закрыть/исправить/удалить/превратить: ${summary.captureCreateFailures}/${summary.captureResolveFailures}/${summary.captureUpdateFailures}/${summary.captureDeleteFailures}/${summary.captureConvertFailures}`,
        `Коррекций запрошено/применено/проверено/ошибок: ${summary.correctionRequests}/${summary.corrections}/${summary.correctionReviews}/${summary.correctionFailures}`,
        `Закрытие дня начато/завершено: ${summary.dayClosureStarts}/${summary.dayClosureCompletions}`,
        `Последняя длительность закрытия дня: ${summary.lastDayClosureDurationSeconds == null ? "нет данных" : formatDuration(summary.lastDayClosureDurationSeconds)}`,
        `Ошибок API: ${summary.apiErrors}`,
        `Попыток старта уже активного дела: ${summary.alreadyActiveStartAttempts}`,
        `Восстановлений устаревшего состояния агента: ${summary.staleRuntimeRecoveries}`,
        `Средняя задержка старта: ${summary.averageStartLatencyMs == null ? "нет данных" : `${summary.averageStartLatencyMs} мс`}`,
        `Медленных переходов окно-фокус: ${summary.slowWindowToFocusCount}`,
      ];

  if (Object.keys(summary.byKind).length > 0) {
    lines.push(
      "",
      raw ? "### Events By Kind" : "### События по типам",
      "",
      raw ? "| Count | Kind |" : "| Кол-во | Тип |",
      "| ---: | --- |"
    );
    for (const [kind, count] of Object.entries(summary.byKind).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
      lines.push(`| ${count} | ${escapeMarkdownTable(raw ? kind : formatAppEventKind(kind))} |`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatAppEventKind(kind) {
  return APP_EVENT_KIND_LABELS[kind] ?? kind;
}

function summarizeEvents(events) {
  const byKind = {};
  const pendingStarts = new Map();
  const pendingClosures = new Map();
  const startLatencies = [];
  const closureDurationsSeconds = [];
  const alreadyActiveActionIds = new Set();
  let alreadyActiveWithoutAction = 0;
  let windowShownAt;
  let slowWindowToFocusCount = 0;

  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;

    if (event.kind === "focus_start_requested" || event.kind === "focus_switch_requested") {
      const actionId = typeof event.payload?.action_id === "string" ? event.payload.action_id : undefined;
      if (actionId) pendingStarts.set(actionId, new Date(event.ts).getTime());
    }

    if (event.kind === "focus_started" || event.kind === "focus_switched") {
      const actionId = typeof event.payload?.action_id === "string" ? event.payload.action_id : undefined;
      if (actionId && pendingStarts.has(actionId)) {
        startLatencies.push(Math.max(new Date(event.ts).getTime() - pendingStarts.get(actionId), 0));
        pendingStarts.delete(actionId);
      }

      if (windowShownAt && new Date(event.ts).getTime() - windowShownAt >= 20_000) {
        slowWindowToFocusCount += 1;
      }
      windowShownAt = undefined;
    }

    if (event.kind === "day_closure_started") {
      const actionId = typeof event.payload?.action_id === "string" ? event.payload.action_id : undefined;
      if (actionId) pendingClosures.set(actionId, new Date(event.ts).getTime());
    }

    if (event.kind === "day_closure_completed") {
      const actionId = typeof event.payload?.action_id === "string" ? event.payload.action_id : undefined;
      if (actionId && pendingClosures.has(actionId)) {
        closureDurationsSeconds.push(Math.floor(Math.max(new Date(event.ts).getTime() - pendingClosures.get(actionId), 0) / 1000));
        pendingClosures.delete(actionId);
      }
    }

    if (event.kind === "window_shown") {
      windowShownAt = new Date(event.ts).getTime();
    } else if (event.kind === "window_hidden") {
      windowShownAt = undefined;
    }

    if (event.payload?.already_active === true) {
      const actionId = typeof event.payload.action_id === "string" ? event.payload.action_id : undefined;
      if (actionId) {
        alreadyActiveActionIds.add(actionId);
      } else if (event.kind === "focus_start_requested" || event.kind === "focus_switch_requested") {
        alreadyActiveWithoutAction += 1;
      }
    }
  }

  const count = (kind) => byKind[kind] ?? 0;
  const averageStartLatencyMs = startLatencies.length
    ? Math.floor(startLatencies.reduce((sum, value) => sum + value, 0) / startLatencies.length)
    : undefined;

  return {
    total: events.length,
    byKind,
    startRequests: count("focus_start_requested"),
    switchRequests: count("focus_switch_requested"),
    stopRequests: count("focus_stop_requested"),
    typedEntryRequests: countEntryRequestsByControls(events, ["typed"]),
    selectedEntryRequests: countEntryRequestsByControls(events, ["selected_item", "selected_shortcut", "double_click"]),
    dispatchRitualEntryRequests: countEntryRequestsByControls(events, ["dispatch_ritual"]),
    startFailures: count("focus_start_failed"),
    stopFailures: count("focus_stop_failed"),
    windowShown: count("window_shown"),
    windowHidden: count("window_hidden"),
    windowShowRequested: count("window_show_requested"),
    windowHideRequested: count("window_hide_requested"),
    windowDragStarted: count("window_drag_started"),
    copyFailures: count("report_copy_failed"),
    manualCopyFallbacks: count("manual_copy_fallback_shown"),
    captureCreateRequests: count("capture_create_requested"),
    captureCreated: count("capture_created"),
    captureCreateFailures: count("capture_create_failed"),
    captureResolveRequests: count("capture_resolve_requested"),
    captureResolved: count("capture_resolved"),
    captureResolveFailures: count("capture_resolve_failed"),
    captureUpdateRequests: count("capture_update_requested"),
    captureUpdated: count("capture_updated"),
    captureUpdateFailures: count("capture_update_failed"),
    captureDeleteRequests: count("capture_delete_requested"),
    captureDeleted: count("capture_deleted"),
    captureDeleteFailures: count("capture_delete_failed"),
    captureConvertRequests: count("capture_convert_requested"),
    captureConverted: count("capture_converted"),
    captureConvertFailures: count("capture_convert_failed"),
    captureFollowupReviews: count("capture_followup_reviewed"),
    dayContextReviews: count("day_context_reviewed"),
    workItemTimeBadgeReviews: count("work_item_time_badges_reviewed"),
    activityZoneGlances: count("activity_zone_glanced"),
    activityZoneReviews: count("activity_zone_reviewed"),
    captureUsageReviews: count("capture_usage_reviewed"),
    entryPathReviews: count("entry_paths_reviewed"),
    windowEntrypointReviews: count("window_entrypoints_reviewed"),
    correctionRequests: count("focus_correction_requested"),
    corrections: count("focus_corrected"),
    correctionReviews: count("focus_correction_reviewed"),
    correctionFailures: count("focus_correction_failed"),
    dayClosureStarts: count("day_closure_started"),
    dayClosureCompletions: count("day_closure_completed"),
    lastDayClosureDurationSeconds: closureDurationsSeconds.at(-1),
    apiErrors: count("api_error"),
    alreadyActiveStartAttempts: alreadyActiveActionIds.size + alreadyActiveWithoutAction,
    staleRuntimeRecoveries: count("agent_stale_runtime_recovered"),
    averageStartLatencyMs,
    slowWindowToFocusCount,
  };
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

function countEntryRequestsByControls(events, controls) {
  const allowedControls = new Set(controls);

  return events.filter((event) => {
    if (event.kind !== "focus_start_requested" && event.kind !== "focus_switch_requested") {
      return false;
    }

    const control = event.payload?.control;
    return typeof control === "string" && allowedControls.has(control);
  }).length;
}

function parsePayload(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function sqliteReadArgs(path, sql) {
  return ["-readonly", "-cmd", ".timeout 5000", "-json", path, sql];
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function startOfLocalDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function nextLocalDay(date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  return result;
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
