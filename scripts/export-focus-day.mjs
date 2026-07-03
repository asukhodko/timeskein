#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SIGNIFICANT_GAP_SECONDS = 20 * 60;

const options = parseArgs(process.argv.slice(2));
const date = options.date ? parseLocalDate(options.date) : new Date();
const now = options.now ? parseIsoDate(options.now) : new Date();
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");

if (!existsSync(dbPath)) {
  throw new Error(`Timeskein database not found: ${dbPath}`);
}

const from = startOfLocalDay(date);
const to = new Date(from);
to.setDate(to.getDate() + 1);

const sessions = await loadSessions(dbPath, from, to, now);
const activeSecondsTotal = sessions.reduce((sum, session) => sum + session.active_seconds, 0);
const workItemEvents = await loadWorkItemEvents(dbPath, from, to);
const dayEvents = await loadDayEvents(dbPath, from, to);

process.stdout.write(buildDayMarkdown(sessions, activeSecondsTotal, from, now, workItemEvents, dayEvents));

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
    } else if (arg === "--now") {
      result.now = args[++index];
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
  console.log(`Usage: pnpm export:focus-day [--date YYYY-MM-DD] [--db path/to/timeskein.db] [--now ISO_DATE]

Prints a Markdown focus-day report from the local Timeskein SQLite database.
Default DB: ~/Library/Application Support/Timeskein/timeskein.db`);
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value, expected YYYY-MM-DD: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parseIsoDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid --now value, expected ISO date: ${value}`);
  }

  return date;
}

function startOfLocalDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

async function loadSessions(path, from, to, now) {
  const hasActivityZone = await columnExists(path, "focus_sessions", "activity_zone");
  const activityZoneExpression = hasActivityZone ? "fs.activity_zone" : "'work'";

  const query = `
    SELECT
      fs.id,
      fs.title,
      fs.work_item_id,
      wi.title AS work_item_title,
      ${activityZoneExpression} AS activity_zone,
      wi.note AS work_item_note,
      fs.state,
      fs.target_seconds,
      fs.note,
      fs.started_at,
      fs.stopped_at,
      fs.updated_at
    FROM focus_sessions fs
    LEFT JOIN work_items wi ON wi.id = fs.work_item_id
    WHERE datetime(COALESCE(fs.stopped_at, ${sqlString(now.toISOString())})) > datetime(${sqlString(from.toISOString())})
      AND datetime(fs.started_at) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(fs.started_at) ASC
  `;

  const { stdout } = await execFileAsync("sqlite3", sqliteReadArgs(path, query), {
    maxBuffer: 10 * 1024 * 1024,
  });

  const rows = stdout.trim() ? JSON.parse(stdout) : [];

  return rows.map((row) => {
    return {
      id: row.id,
      title: row.title,
      work_item_id: row.work_item_id ?? undefined,
      work_item_title: row.work_item_title ?? undefined,
      activity_zone: row.activity_zone ?? "work",
      work_item_note: row.work_item_note ?? undefined,
      state: row.state,
      target_seconds: row.target_seconds ?? 1500,
      active_seconds: clippedActiveSeconds(row.started_at, row.stopped_at, from, to, now),
      note: row.note ?? undefined,
      started_at: row.started_at,
      stopped_at: row.stopped_at ?? undefined,
      updated_at: row.updated_at,
    };
  });
}

async function loadWorkItemEvents(path, from, to) {
  if (!(await tableExists(path, "work_item_events"))) {
    return [];
  }

  const query = `
    SELECT
      e.id,
      e.ts,
      e.work_item_id,
      e.kind,
      e.payload,
      wi.title AS work_item_title
    FROM work_item_events e
    LEFT JOIN work_items wi ON wi.id = e.work_item_id
    WHERE e.kind = 'note_added'
      AND datetime(e.ts) >= datetime(${sqlString(from.toISOString())})
      AND datetime(e.ts) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(e.ts) ASC
  `;

  const { stdout } = await execFileAsync("sqlite3", sqliteReadArgs(path, query), {
    maxBuffer: 10 * 1024 * 1024,
  });
  const rows = stdout.trim() ? JSON.parse(stdout) : [];

  return rows
    .map((row) => {
      const payload = parseJsonPayload(row.payload);
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";

      return {
        id: row.id,
        ts: row.ts,
        work_item_id: row.work_item_id,
        work_item_title: row.work_item_title ?? undefined,
        kind: row.kind,
        text,
        focus_session_id: typeof payload?.focus_session_id === "string" ? payload.focus_session_id : undefined,
      };
    })
    .filter((event) => event.text);
}

async function loadDayEvents(path, from, to) {
  if (!(await tableExists(path, "day_events"))) {
    return [];
  }

  const [hasFocusSessionId, hasActivityZone, hasUpdatedAt] = await Promise.all([
    columnExists(path, "day_events", "focus_session_id"),
    columnExists(path, "day_events", "activity_zone"),
    columnExists(path, "day_events", "updated_at"),
  ]);
  const focusSessionExpression = hasFocusSessionId ? "focus_session_id" : "NULL";
  const activityZoneExpression = hasActivityZone ? "activity_zone" : "NULL";
  const updatedAtExpression = hasUpdatedAt ? "updated_at" : "ts";

  const query = `
    SELECT
      id,
      ts,
      kind,
      text,
      ${focusSessionExpression} AS focus_session_id,
      ${activityZoneExpression} AS activity_zone,
      ${updatedAtExpression} AS updated_at
    FROM day_events
    WHERE kind = 'note_added'
      AND datetime(ts) >= datetime(${sqlString(from.toISOString())})
      AND datetime(ts) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(ts) ASC
  `;

  const { stdout } = await execFileAsync("sqlite3", sqliteReadArgs(path, query), {
    maxBuffer: 10 * 1024 * 1024,
  });
  const rows = stdout.trim() ? JSON.parse(stdout) : [];

  return rows
    .map((row) => ({
      id: row.id,
      ts: row.ts,
      kind: row.kind,
      text: typeof row.text === "string" ? row.text.trim() : "",
      focus_session_id: row.focus_session_id ?? undefined,
      activity_zone: row.activity_zone ?? undefined,
      updated_at: row.updated_at,
    }))
    .filter((event) => event.text);
}

async function tableExists(path, tableName) {
  const query = `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)}`;
  const { stdout } = await execFileAsync("sqlite3", sqliteReadArgs(path, query), {
    maxBuffer: 1024 * 1024,
  });
  const rows = stdout.trim() ? JSON.parse(stdout) : [];
  return (rows[0]?.count ?? 0) > 0;
}

async function columnExists(path, tableName, columnName) {
  if (!(await tableExists(path, tableName))) {
    return false;
  }

  const { stdout } = await execFileAsync(
    "sqlite3",
    sqliteReadArgs(path, `PRAGMA table_info(${quoteIdentifier(tableName)})`),
    {
      maxBuffer: 1024 * 1024,
    }
  );
  const rows = stdout.trim() ? JSON.parse(stdout) : [];
  return rows.some((row) => row.name === columnName);
}

function parseJsonPayload(value) {
  if (!value) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function clippedActiveSeconds(startedAtValue, stoppedAtValue, from, to, now) {
  const startedAt = new Date(startedAtValue);
  const stoppedAt = stoppedAtValue ? new Date(stoppedAtValue) : now;
  const clippedStart = new Date(Math.max(startedAt.getTime(), from.getTime()));
  const clippedStop = new Date(Math.min(stoppedAt.getTime(), to.getTime()));

  return Math.max(Math.floor((clippedStop.getTime() - clippedStart.getTime()) / 1000), 0);
}

function sqliteReadArgs(path, sql) {
  return ["-readonly", "-cmd", ".timeout 5000", "-json", path, sql];
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function buildDayMarkdown(sessionsOldestFirst, activeSecondsTotal, day, now, workItemEvents = [], dayEvents = []) {
  const dayStart = startOfLocalDay(day);
  const dayEnd = nextLocalDay(dayStart);
  const zoneTotals = aggregateActivityZoneTotals(sessionsOldestFirst);
  const workFocusSeconds = getZoneActiveSeconds(zoneTotals, "work");
  const nonWorkSeconds = Math.max(activeSecondsTotal - workFocusSeconds, 0);
  const dateTitle = day.toLocaleDateString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const lines = [
    `# Timeskein focus day - ${dateTitle}`,
    "",
    `Total tracked: ${formatDuration(activeSecondsTotal)}`,
    `Work focus: ${formatDuration(workFocusSeconds)}`,
    `Non-work tracked: ${formatDuration(nonWorkSeconds)}`,
    `Entrances: ${sessionsOldestFirst.length}`,
    "",
    "| Time | Duration | Zone | Work Item | Note |",
    "| --- | ---: | --- | --- | --- |",
  ];

  for (const session of sessionsOldestFirst) {
    const title = session.work_item_title ?? session.title;
    const range = `${formatClockTime(session.started_at)}-${formatClockTime(session.stopped_at)}`;
    lines.push(
      `| ${escapeMarkdownTable(range)} | ${escapeMarkdownTable(formatDuration(session.active_seconds))} | ${escapeMarkdownTable(formatActivityZoneLabel(session.activity_zone))} | ${escapeMarkdownTable(title)} | ${escapeMarkdownTable(session.note ?? "")} |`
    );
  }

  const dayBoundaryBlocks = sessionsOldestFirst.filter((session) =>
    sessionCrossesWindow(session, dayStart, dayEnd, now)
  );
  if (dayBoundaryBlocks.length > 0) {
    lines.push("", "## Day-Boundary Blocks");
    for (const session of dayBoundaryBlocks) {
      const title = session.work_item_title ?? session.title;
      const range = `${formatClockTime(session.started_at)}-${formatClockTime(session.stopped_at)}`;
      lines.push(
        `- ${range} ${title}: counted as ${formatDuration(session.active_seconds)} inside this day`
      );
    }
  }

  const workItemTotals = aggregateWorkItemTotals(sessionsOldestFirst);
  if (workItemTotals.length > 0) {
    lines.push("", "## By Work Item", "", "| Duration | Entrances | Work Item |", "| ---: | ---: | --- |");
    for (const item of workItemTotals) {
      lines.push(
        `| ${escapeMarkdownTable(formatDuration(item.activeSeconds))} | ${item.entrances} | ${escapeMarkdownTable(item.title)} |`
      );
    }
  }

  appendWorkItemNotes(lines, workItemTotals);
  appendDayEvents(lines, dayEvents, sessionsOldestFirst);
  appendWorkItemEvents(lines, workItemEvents, sessionsOldestFirst);

  if (zoneTotals.length > 0) {
    lines.push("", "## By Activity Zone", "", "| Duration | Entrances | Zone |", "| ---: | ---: | --- |");
    for (const zone of zoneTotals) {
      lines.push(
        `| ${escapeMarkdownTable(formatDuration(zone.activeSeconds))} | ${zone.entrances} | ${escapeMarkdownTable(formatActivityZoneLabel(zone.zone))} |`
      );
    }
  }

  const gaps = gapsBetweenSessions(sessionsOldestFirst).filter(
    (gap) => gap.seconds >= SIGNIFICANT_GAP_SECONDS
  );
  if (gaps.length > 0) {
    lines.push("", `## Gaps >= ${formatDuration(SIGNIFICANT_GAP_SECONDS)}`);
    for (const gap of gaps) {
      lines.push(
        `- ${formatClockTime(gap.from)}-${formatClockTime(gap.to)}: ${formatDuration(gap.seconds)}`
      );
    }
  }

  const openGap = openGapAfterLastSession(sessionsOldestFirst, now, dayStart, dayEnd);
  if (openGap && openGap.seconds >= SIGNIFICANT_GAP_SECONDS) {
    lines.push("", "## Open Gap");
    lines.push(
      `- ${formatClockTime(openGap.from)}-${formatClockTime(openGap.to)}: ${formatDuration(openGap.seconds)} since last stopped block`
    );
  }

  return `${lines.join("\n")}\n`;
}

function nextLocalDay(date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  return result;
}

function sessionCrossesWindow(session, from, to, now) {
  const startedAt = new Date(session.started_at).getTime();
  const stoppedAt = session.stopped_at ? new Date(session.stopped_at).getTime() : now.getTime();

  return startedAt < from.getTime() || stoppedAt > to.getTime();
}

function aggregateWorkItemTotals(sessions) {
  const totals = new Map();

  for (const session of sessions) {
    const key = session.work_item_id ?? `title:${session.title}`;
    const title = session.work_item_title ?? session.title;
    const current = totals.get(key) ?? {
      title,
      note: session.work_item_note,
      activeSeconds: 0,
      entrances: 0,
    };

    current.title = title;
    if (session.work_item_note) {
      current.note = session.work_item_note;
    }
    current.activeSeconds += session.active_seconds;
    current.entrances += 1;
    totals.set(key, current);
  }

  return Array.from(totals.values()).sort((left, right) => {
    if (right.activeSeconds !== left.activeSeconds) {
      return right.activeSeconds - left.activeSeconds;
    }

    return left.title.localeCompare(right.title);
  });
}

function aggregateActivityZoneTotals(sessions) {
  const totals = new Map();

  for (const session of sessions) {
    const current = totals.get(session.activity_zone) ?? {
      zone: session.activity_zone,
      activeSeconds: 0,
      entrances: 0,
    };

    current.activeSeconds += session.active_seconds;
    current.entrances += 1;
    totals.set(session.activity_zone, current);
  }

  return Array.from(totals.values()).sort((left, right) => {
    if (right.activeSeconds !== left.activeSeconds) {
      return right.activeSeconds - left.activeSeconds;
    }

    return left.zone.localeCompare(right.zone);
  });
}

function getZoneActiveSeconds(zoneTotals, zone) {
  return zoneTotals.find((item) => item.zone === zone)?.activeSeconds ?? 0;
}

function appendWorkItemNotes(lines, workItemTotals) {
  const itemsWithNotes = workItemTotals.filter((item) => item.note?.trim());
  if (itemsWithNotes.length === 0) {
    return;
  }

  lines.push("", "## Work Item Notes");
  for (const item of itemsWithNotes) {
    lines.push(`- ${formatMarkdownListText(item.title)}: ${formatMarkdownListText(item.note)}`);
  }
}

function appendDayEvents(lines, events, sessions) {
  if (events.length === 0) {
    return;
  }

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  lines.push("", "## Day Events", "", "| Time | Zone | During | Event |", "| --- | --- | --- | --- |");
  for (const event of events) {
    lines.push(
      `| ${escapeMarkdownTable(formatClockTime(event.ts))} | ${escapeMarkdownTable(event.activity_zone ? formatActivityZoneLabel(event.activity_zone) : "")} | ${escapeMarkdownTable(formatDayEventDuring(event, sessionsById))} | ${escapeMarkdownTable(event.text)} |`
    );
  }
}

function appendWorkItemEvents(lines, events, sessions) {
  if (events.length === 0) {
    return;
  }

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  lines.push("", "## Work Item Events", "", "| Time | Work Item | During | Event |", "| --- | --- | --- | --- |");
  for (const event of events) {
    lines.push(
      `| ${escapeMarkdownTable(formatClockTime(event.ts))} | ${escapeMarkdownTable(formatEventWorkItemTitle(event, sessionsById))} | ${escapeMarkdownTable(formatEventDuring(event, sessionsById))} | ${escapeMarkdownTable(event.text)} |`
    );
  }
}

function formatDayEventDuring(event, sessionsById) {
  if (!event.focus_session_id) return "day";

  const session = sessionsById.get(event.focus_session_id);
  return session?.work_item_title ?? session?.title ?? "linked focus block";
}

function formatEventWorkItemTitle(event, sessionsById) {
  if (event.work_item_title) return event.work_item_title;

  const session = event.focus_session_id ? sessionsById.get(event.focus_session_id) : undefined;
  return session?.work_item_title ?? session?.title ?? "unknown Work Item";
}

function formatEventDuring(event, sessionsById) {
  if (!event.focus_session_id) return "";

  const session = sessionsById.get(event.focus_session_id);
  return session?.work_item_title ?? session?.title ?? "linked focus block";
}

function gapsBetweenSessions(sessionsOldestFirst) {
  return sessionsOldestFirst.slice(1).map((session, index) => {
    const previous = sessionsOldestFirst[index];
    const previousEnd = previous.stopped_at ?? previous.started_at;
    const seconds = Math.max(
      Math.floor((new Date(session.started_at).getTime() - new Date(previousEnd).getTime()) / 1000),
      0
    );

    return {
      from: previousEnd,
      to: session.started_at,
      seconds,
    };
  });
}

function openGapAfterLastSession(sessionsOldestFirst, now, dayStart, dayEnd) {
  const latest = sessionsOldestFirst[sessionsOldestFirst.length - 1];
  if (!latest || latest.state === "active") {
    return undefined;
  }

  const latestEnd = latest.stopped_at ?? latest.started_at;
  const from = new Date(latestEnd);
  const to = new Date(Math.min(now.getTime(), dayEnd.getTime()));

  if (
    now.getTime() < dayStart.getTime() ||
    now.getTime() >= dayEnd.getTime() ||
    to.getTime() <= from.getTime()
  ) {
    return undefined;
  }

  const seconds = Math.max(Math.floor((to.getTime() - from.getTime()) / 1000), 0);
  if (seconds < SIGNIFICANT_GAP_SECONDS) {
    return undefined;
  }

  return {
    from: latestEnd,
    to: to.toISOString(),
    seconds,
  };
}

function escapeMarkdownTable(value) {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function formatMarkdownListText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function formatActivityZoneLabel(zone) {
  const labels = {
    work: "Work",
    coordination: "Coordination",
    recovery: "Recovery",
    idle: "Idle",
    personal: "Personal",
  };

  return labels[zone] ?? "Work";
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

function formatClockTime(isoDate) {
  if (!isoDate) return "now";

  return new Date(isoDate).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
