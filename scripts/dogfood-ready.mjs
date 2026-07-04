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

const lines = [`# Timeskein dogfood readiness - ${formatLocalDate(date)}`, ""];
const blockers = [];
const warnings = [];
const nextActions = [];
const responsiveAgent = await detectResponsiveAgent(supportDir);
const runningPids = await runningTimeskeinPids();

lines.push(`Mode: ${mode}`);
lines.push(`DB: ${dbPath}`);
lines.push(`App bundle: ${existsSync(appBundlePath) ? appBundlePath : "not built yet"}`);
lines.push(`Agent responsive: ${responsiveAgent ?? "no"}`);
lines.push(`Running app PIDs: ${runningPids.length > 0 ? runningPids.join(", ") : "none"}`);
lines.push("");

if (!existsSync(dbPath)) {
  warnings.push("Timeskein database does not exist yet. The macOS app should create it on first launch.");
} else {
  try {
    const summary = await loadSummary(dbPath, date);
    addSummary(lines, blockers, warnings, nextActions, summary, responsiveAgent, runningPids, mode);
  } catch (error) {
    blockers.push(`Could not inspect Timeskein database: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!existsSync(appBundlePath)) {
  warnings.push("macOS app bundle is not built yet. Run `pnpm dogfood:macos` after preflight.");
}

if (responsiveAgent) {
  warnings.push("Timeskein agent is already responsive. Quit the existing app before a clean dogfood start so the fresh packaged app is used.");
}

if (runningPids.length > 0) {
  warnings.push("Timeskein app process is already running. Quit it before a clean dogfood start so the fresh packaged app is used.");
}

lines.push(`Status: ${blockers.length === 0 ? "READY" : "NOT READY"}`, "");
appendSection(lines, "Blockers", blockers);
appendSection(lines, "Warnings", warnings);

if (blockers.length === 0) {
  appendDailyControlChecklist(lines);
} else {
  lines.push("## Next", "");
  for (const action of unique(nextActions)) {
    lines.push(`- ${action}`);
  }
  lines.push(`- Manual backup command if needed: ${backupCommand(dbPath)}`);
  lines.push("- Re-run `pnpm dogfood:ready` before using Timeskein instead of Session.");
}

process.stdout.write(`${lines.join("\n")}\n`);

if (blockers.length > 0) {
  process.exitCode = 1;
}

function appendDailyControlChecklist(lines) {
  lines.push("## Daily-Control Checklist", "");
  lines.push("- Exercise window entrypoints: tray/menu, global shortcut, macOS reopen, hide with Esc or close.");
  lines.push("- Start one new Work Item by typed title and continue one existing Work Item from the list.");
  lines.push("- Use at least two Activity Zones, including one non-work zone such as coordination/recovery/idle/personal.");
  lines.push("- Add one Day Event for a buffer, gap, recovery note, or tracking correction.");
  lines.push("- Add or promote one timestamped Work Item Event when a task-specific detail matters.");
  lines.push("- Capture at least one incoming interruption during an active focus block and resolve, convert, or explicitly leave it open.");
  lines.push("- Before final report, correct one safe tracking detail or accept tracking accuracy in the review checklist.");
  lines.push("- Close the day with `pnpm dogfood:finish:save`; before completing the goal, run `pnpm dogfood:goal-check`.");
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
  console.log(`Usage: pnpm dogfood:ready [--mode start|continue] [--date YYYY-MM-DD] [--db path/to/timeskein.db]

Checks the real local Timeskein database before a one-day Session replacement trial.
The command is read-only and exits with code 1 when the selected mode is not safe.
Mode start requires a clean day. Mode continue allows existing focus blocks and one coherent active focus.`);
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

  lines.push("## Summary", "");
  lines.push(`- Work Items: ${summary.counts.work_items}`);
  lines.push(`- Focus sessions: ${summary.counts.focus_sessions}`);
  lines.push(`- Active focus sessions: ${summary.activeSessions.length}`);
  lines.push(`- Active Work Items: ${summary.activeWorkItems.length}`);
  lines.push(`- Today's focus blocks: ${summary.todaySessions.length}`);
  lines.push(`- Today's focus total: ${formatDuration(todaySeconds)}`);
  lines.push(`- Duplicate normalized titles: ${summary.duplicateTitles.length}`);
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
      blockers.push(`Duplicate Work Item title group (${duplicate.count}): ${duplicate.titles}`);
    }
    if (summary.duplicateTitles.length > 5) {
      blockers.push(`Duplicate title groups omitted: ${summary.duplicateTitles.length - 5}`);
    }
    nextActions.push("For a clean one-day trial, prefer `pnpm dogfood:reset-db` over manual duplicate cleanup.");
  }

  if (summary.counts.work_items === 0) {
    warnings.push("No Work Items yet. That is fine for a fresh trial; typed focus starts will create them.");
  }
}

function addStartModeFindings(blockers, warnings, nextActions, summary, todaySeconds, responsiveAgent, runningPids) {
  const hasExistingDayBlocks = summary.todaySessions.length > 0;

  if (summary.activeSessions.length > 0) {
    for (const session of summary.activeSessions) {
      blockers.push(
        `Active focus session: ${session.work_item_title ?? session.title} since ${formatClockTime(session.started_at)}`
      );
    }
  }

  if (summary.activeWorkItems.length > 0) {
    for (const item of summary.activeWorkItems) {
      blockers.push(`Active Work Item: ${item.title}`);
    }
  }

  if (hasExistingDayBlocks) {
    blockers.push(
      `Today already has ${summary.todaySessions.length} focus block(s), total ${formatDuration(todaySeconds)}. This will contaminate a clean one-day trial.`
    );
    nextActions.push("For a clean one-day trial with existing blocks, prefer reset over stop-active: dry-run `pnpm dogfood:reset-db`.");
    if (responsiveAgent) {
      nextActions.push("Quit Timeskein before applying the reset; `dogfood:reset-db -- --apply` refuses while the agent is responsive.");
    } else if (runningPids.length > 0) {
      nextActions.push("Quit Timeskein before applying the reset; `dogfood:reset-db -- --apply` refuses while the app process is running.");
    }
    nextActions.push("If the reset plan looks right, run `pnpm dogfood:reset-db -- --apply`.");
  }

  if (summary.activeSessions.length > 0) {
    const reason = hasExistingDayBlocks
      ? "If you want to preserve the current database instead of starting clean, dry-run `pnpm dogfood:stop-active`."
      : "Stop the active focus block in Timeskein, or dry-run `pnpm dogfood:stop-active`.";
    nextActions.push(reason);
    nextActions.push("If the stop plan looks right, run `pnpm dogfood:stop-active -- --apply`.");
  }

  if (summary.activeWorkItems.length > 0) {
    nextActions.push("Clear active Work Items by stopping the current focus block or running `pnpm dogfood:stop-active -- --apply`.");
  }
}

function addContinueModeFindings(blockers, warnings, nextActions, summary, todaySeconds) {
  if (summary.todaySessions.length > 0) {
    warnings.push(
      `Selected day already has ${summary.todaySessions.length} focus block(s), total ${formatDuration(todaySeconds)}. Continue mode treats this as an existing dogfood day.`
    );
  }

  if (summary.activeSessions.length > 1) {
    blockers.push(`Multiple active focus sessions: ${summary.activeSessions.length}`);
    nextActions.push("Dry-run `pnpm dogfood:stop-active`, then apply it if the plan looks right.");
    return;
  }

  if (summary.activeSessions.length === 0) {
    if (summary.activeWorkItems.length > 0) {
      for (const item of summary.activeWorkItems) {
        blockers.push(`Active Work Item without active focus session: ${item.title}`);
      }
      nextActions.push("Clear active Work Items with `pnpm dogfood:stop-active -- --apply` or change their state in the app.");
    }
    return;
  }

  const activeSession = summary.activeSessions[0];
  const activeWorkItem = summary.activeWorkItems[0];

  if (summary.activeWorkItems.length !== 1) {
    blockers.push(
      `Active focus session exists, but active Work Item count is ${summary.activeWorkItems.length}; expected exactly 1.`
    );
    nextActions.push("Dry-run `pnpm dogfood:stop-active`, then apply it if the plan looks right.");
    return;
  }

  if (activeSession.work_item_id !== activeWorkItem.id) {
    blockers.push(
      `Active focus session is linked to ${activeSession.work_item_title ?? activeSession.title}, but active Work Item is ${activeWorkItem.title}.`
    );
    nextActions.push("Switch focus in the app, or dry-run `pnpm dogfood:stop-active` and apply it if the plan looks right.");
    return;
  }

  warnings.push(
    `Dogfood day is already in progress: ${activeWorkItem.title} since ${formatClockTime(activeSession.started_at)}.`
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

function appendSection(lines, title, items) {
  lines.push(`## ${title}`, "");

  if (items.length === 0) {
    lines.push("- none", "");
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
