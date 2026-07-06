#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const options = parseArgs(process.argv.slice(2));
const date = options.date ? parseLocalDate(options.date) : new Date();
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");

if (!existsSync(dbPath)) {
  throw new Error(`Timeskein database not found: ${dbPath}`);
}

const from = startOfLocalDay(date);
const to = nextLocalDay(from);
const events = await loadEvents(dbPath, from, to);

process.stdout.write(buildTelemetryMarkdown(events));

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
  console.log(`Usage: pnpm dogfood:metrics [--date YYYY-MM-DD] [--db path/to/timeskein.db]

Prints a Markdown App Telemetry section from local Timeskein app_events.`);
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value, expected YYYY-MM-DD: ${value}`);
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

function buildTelemetryMarkdown(events) {
  const summary = summarizeEvents(events);
  const lines = [
    "## App Telemetry",
    "",
    `Total events: ${summary.total}`,
    `Start requests: ${summary.startRequests}`,
    `Switch requests: ${summary.switchRequests}`,
    `Stop requests: ${summary.stopRequests}`,
    `Typed/selected entry requests: ${summary.typedEntryRequests}/${summary.selectedEntryRequests}`,
    `Start/stop failures: ${summary.startFailures}/${summary.stopFailures}`,
    `Window shown/hidden: ${summary.windowShown}/${summary.windowHidden}`,
    `Window show/hide requests: ${summary.windowShowRequested}/${summary.windowHideRequested}`,
    `Window drag starts: ${summary.windowDragStarted}`,
    `Copy failures: ${summary.copyFailures}`,
    `Manual copy fallbacks: ${summary.manualCopyFallbacks}`,
    `Capture created/resolved/converted: ${summary.captureCreated}/${summary.captureResolved}/${summary.captureConverted}`,
    `Capture follow-up reviews: ${summary.captureFollowupReviews}`,
    `Work Item time badge reviews: ${summary.workItemTimeBadgeReviews}`,
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
  ];

  if (Object.keys(summary.byKind).length > 0) {
    lines.push("", "### Events By Kind", "", "| Count | Kind |", "| ---: | --- |");
    for (const [kind, count] of Object.entries(summary.byKind).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
      lines.push(`| ${count} | ${escapeMarkdownTable(kind)} |`);
    }
  }

  return `${lines.join("\n")}\n`;
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
    workItemTimeBadgeReviews: count("work_item_time_badges_reviewed"),
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
