#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SIGNIFICANT_GAP_SECONDS = 20 * 60;
const DEFAULT_MIN_FOCUS_MINUTES = 180;
const WORK_ACTIVITY_ZONE = "work";

const options = parseArgs(process.argv.slice(2));
const date = options.date ? parseLocalDate(options.date) : new Date();
const now = options.now ? parseIsoDate(options.now) : new Date();
const minFocusSeconds = (options.minFocusMinutes ?? DEFAULT_MIN_FOCUS_MINUTES) * 60;
const dateArg = options.date ?? formatLocalDate(date);
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");

if (!existsSync(dbPath)) {
  process.stdout.write(buildMissingDbReport(dateArg, dbPath));
  process.exit(1);
}

const from = startOfLocalDay(date);
const to = nextLocalDay(from);
const evidence = await loadEvidence(dbPath, from, to, now);
const assessment = assessEvidence(evidence, minFocusSeconds);
const output = buildRcReport(dateArg, dbPath, evidence, assessment, minFocusSeconds);
const outputPath = outputReportPath(options, dateArg);

if (outputPath) {
  await writeFile(outputPath, output);
  process.stdout.write(`Saved Timeskein dogfood RC check: ${outputPath}\n`);
} else {
  process.stdout.write(output);
}
process.exit(assessment.hardBlockers.length > 0 ? 1 : 0);

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
    } else if (arg === "--min-focus-minutes") {
      result.minFocusMinutes = Number(args[++index]);
      if (!Number.isFinite(result.minFocusMinutes) || result.minFocusMinutes < 0) {
        throw new Error("--min-focus-minutes must be a non-negative number");
      }
    } else if (arg === "--out") {
      result.out = args[++index];
    } else if (arg === "--save") {
      result.save = true;
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
  console.log(`Usage: pnpm dogfood:rc-check [--date YYYY-MM-DD] [--db path/to/timeskein.db] [--min-focus-minutes N] [--save | --out path.md]

Checks whether the saved Timeskein data is enough for the Dogfood Release Candidate verdict.
It exits with code 1 for hard blockers such as active state, duplicate Work Item titles, or an empty day.
Review items are printed but keep exit code 0 because the final RC verdict still needs human judgment.`);
}

function outputReportPath(options, date) {
  if (options.out) {
    return resolve(options.out);
  }

  if (options.save) {
    return resolve(`timeskein-dogfood-rc-check-${date}.md`);
  }

  return undefined;
}

async function loadEvidence(path, from, to, now) {
  const [
    sessions,
    activeSessions,
    activeWorkItems,
    duplicateTitles,
    openCaptures,
    capturesCreatedToday,
    workItemEvents,
    dayEvents,
    events,
  ] = await Promise.all([
    loadSessions(path, from, to, now),
    loadActiveSessions(path),
    loadActiveWorkItems(path),
    loadDuplicateTitles(path),
    loadOpenCaptures(path),
    loadCapturesCreatedToday(path, from, to),
    loadWorkItemEvents(path, from, to),
    loadDayEvents(path, from, to),
    loadEvents(path, from, to),
  ]);

  const totalFocusSeconds = sessions.reduce((sum, session) => sum + session.active_seconds, 0);
  const workItemTotals = aggregateWorkItemTotals(sessions);
  const activityZoneTotals = aggregateActivityZoneTotals(sessions);
  const workFocusSeconds = getZoneActiveSeconds(activityZoneTotals, WORK_ACTIVITY_ZONE);
  const nonWorkSeconds = Math.max(totalFocusSeconds - workFocusSeconds, 0);
  const gaps = gapsBetweenSessions(sessions).filter((gap) => gap.seconds >= SIGNIFICANT_GAP_SECONDS);
  const capturesDuringActiveFocus = capturesCreatedToday.filter((capture) => capture.focus_session_id).length;
  const workItemNoteCount = workItemTotals.filter((item) => item.note?.trim()).length;
  const workItemEventsDuringActiveFocus = workItemEvents.filter((event) => event.focus_session_id).length;
  const dayEventsDuringActiveFocus = dayEvents.filter((event) => event.focus_session_id).length;
  const dayEventsWithZone = dayEvents.filter((event) => event.activity_zone).length;
  const telemetry = summarizeEvents(events);

  return {
    sessions,
    activeSessions,
    activeWorkItems,
    duplicateTitles,
    openCaptures,
    capturesCreatedToday,
    capturesDuringActiveFocus,
    workItemEvents,
    workItemEventsDuringActiveFocus,
    dayEvents,
    dayEventsDuringActiveFocus,
    dayEventsWithZone,
    events,
    totalFocusSeconds,
    workFocusSeconds,
    nonWorkSeconds,
    workItemTotals,
    workItemNoteCount,
    activityZoneTotals,
    gaps,
    telemetry,
  };
}

async function loadSessions(path, from, to, now) {
  const hasActivityZone = await columnExists(path, "focus_sessions", "activity_zone");
  const activityZoneExpression = hasActivityZone
    ? "fs.activity_zone"
    : `${sqlString(WORK_ACTIVITY_ZONE)}`;

  const rows = await queryJson(path, `
    SELECT
      fs.id,
      fs.title,
      fs.work_item_id,
      wi.title AS work_item_title,
      ${activityZoneExpression} AS activity_zone,
      wi.note AS work_item_note,
      fs.state,
      fs.note,
      fs.started_at,
      fs.stopped_at
    FROM focus_sessions fs
    LEFT JOIN work_items wi ON wi.id = fs.work_item_id
    WHERE datetime(COALESCE(fs.stopped_at, ${sqlString(now.toISOString())})) > datetime(${sqlString(from.toISOString())})
      AND datetime(fs.started_at) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(fs.started_at) ASC
  `);

  return rows.map((row) => ({
    ...row,
    work_item_id: row.work_item_id ?? undefined,
    work_item_title: row.work_item_title ?? undefined,
    activity_zone: row.activity_zone ?? WORK_ACTIVITY_ZONE,
    work_item_note: row.work_item_note ?? undefined,
    note: row.note ?? undefined,
    stopped_at: row.stopped_at ?? undefined,
    active_seconds: clippedActiveSeconds(row.started_at, row.stopped_at, from, to, now),
  }));
}

async function loadActiveSessions(path) {
  return queryJson(path, `
    SELECT fs.id, fs.title, wi.title AS work_item_title, fs.started_at
    FROM focus_sessions fs
    LEFT JOIN work_items wi ON wi.id = fs.work_item_id
    WHERE fs.state = 'active'
    ORDER BY datetime(fs.started_at) DESC
  `);
}

async function loadActiveWorkItems(path) {
  return queryJson(path, `
    SELECT id, title, updated_at
    FROM work_items
    WHERE deleted_at IS NULL AND state = 'active'
    ORDER BY datetime(updated_at) DESC
  `);
}

async function loadDuplicateTitles(path) {
  return queryJson(path, `
    SELECT
      lower(trim(title)) AS normalized_title,
      COUNT(*) AS count,
      GROUP_CONCAT(title, ' | ') AS titles
    FROM work_items
    WHERE deleted_at IS NULL
    GROUP BY lower(trim(title))
    HAVING COUNT(*) > 1
    ORDER BY count DESC, normalized_title ASC
  `);
}

async function loadOpenCaptures(path) {
  if (!(await tableExists(path, "captures"))) return [];

  return queryJson(path, `
    SELECT id, text, created_at
    FROM captures
    WHERE state = 'open'
    ORDER BY datetime(created_at) ASC
  `);
}

async function loadCapturesCreatedToday(path, from, to) {
  if (!(await tableExists(path, "captures"))) return [];

  return queryJson(path, `
    SELECT
      c.id,
      c.text,
      c.state,
      c.work_item_id,
      c.focus_session_id,
      c.created_at,
      c.updated_at,
      c.resolved_at,
      c.converted_at,
      fs.title AS focus_title,
      focus_wi.title AS focus_work_item_title,
      capture_wi.title AS work_item_title
    FROM captures c
    LEFT JOIN focus_sessions fs ON fs.id = c.focus_session_id
    LEFT JOIN work_items focus_wi ON focus_wi.id = fs.work_item_id
    LEFT JOIN work_items capture_wi ON capture_wi.id = c.work_item_id
    WHERE datetime(c.created_at) >= datetime(${sqlString(from.toISOString())})
      AND datetime(c.created_at) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(c.created_at) ASC
  `);
}

async function loadWorkItemEvents(path, from, to) {
  if (!(await tableExists(path, "work_item_events"))) return [];

  const rows = await queryJson(path, `
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
  `);

  return rows
    .map((row) => {
      const payload = parsePayload(row.payload);
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
  if (!(await tableExists(path, "day_events"))) return [];

  const [hasFocusSessionId, hasActivityZone, hasUpdatedAt] = await Promise.all([
    columnExists(path, "day_events", "focus_session_id"),
    columnExists(path, "day_events", "activity_zone"),
    columnExists(path, "day_events", "updated_at"),
  ]);
  const focusSessionExpression = hasFocusSessionId ? "focus_session_id" : "NULL";
  const activityZoneExpression = hasActivityZone ? "activity_zone" : "NULL";
  const updatedAtExpression = hasUpdatedAt ? "updated_at" : "ts";

  const rows = await queryJson(path, `
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
  `);

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

async function loadEvents(path, from, to) {
  if (!(await tableExists(path, "app_events"))) return [];

  return queryJson(path, `
    SELECT id, ts, source, kind, work_item_id, focus_session_id, payload
    FROM app_events
    WHERE datetime(ts) >= datetime(${sqlString(from.toISOString())})
      AND datetime(ts) < datetime(${sqlString(to.toISOString())})
    ORDER BY datetime(ts) ASC
  `).then((rows) =>
    rows.map((row) => ({
      ...row,
      payload: parsePayload(row.payload),
    }))
  );
}

async function tableExists(path, tableName) {
  const rows = await queryJson(
    path,
    `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)}`
  );

  return (rows[0]?.count ?? 0) > 0;
}

async function columnExists(path, tableName, columnName) {
  if (!(await tableExists(path, tableName))) {
    return false;
  }

  const rows = await queryJson(path, `PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return rows.some((row) => row.name === columnName);
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

function assessEvidence(evidence, minFocusSeconds) {
  const hardBlockers = [];
  const reviewItems = [];

  for (const session of evidence.activeSessions) {
    hardBlockers.push(
      `Active focus session is still running: ${session.work_item_title ?? session.title} since ${formatClockTime(session.started_at)}`
    );
  }

  for (const item of evidence.activeWorkItems) {
    hardBlockers.push(`Active Work Item is still marked active: ${item.title}`);
  }

  if (evidence.sessions.length === 0) {
    hardBlockers.push("No focus blocks found for this date.");
  }

  for (const duplicate of evidence.duplicateTitles) {
    hardBlockers.push(`Duplicate Work Item title: ${duplicate.titles}`);
  }

  if (evidence.totalFocusSeconds < minFocusSeconds && evidence.sessions.length > 0) {
    reviewItems.push(
      `Total tracked is ${formatDuration(evidence.totalFocusSeconds)}, below the RC review threshold ${formatDuration(minFocusSeconds)}. Confirm whether this was still a full workday.`
    );
  }

  if (evidence.activityZoneTotals.length <= 1 && evidence.sessions.length > 0) {
    reviewItems.push("Only one Activity Zone appears in the day. Confirm whether coordination/recovery/idle/personal time was intentionally absent or missed.");
  }

  if (evidence.nonWorkSeconds === 0 && evidence.sessions.length > 0) {
    reviewItems.push("Non-work tracked time is zero. Confirm breaks, recovery, coordination, and personal blocks were not folded into work focus.");
  }

  if (
    evidence.dayEvents.length === 0 &&
    evidence.workItemEvents.length === 0 &&
    evidence.workItemNoteCount === 0 &&
    evidence.sessions.length > 0
  ) {
    reviewItems.push("No Day Events, Work Item notes, or timestamped Work Item Events found. If the report needs memory reconstruction, add context before treating it as final.");
  }

  if (evidence.dayEvents.length > 0 && evidence.dayEventsWithZone === 0) {
    reviewItems.push("Day Events exist, but none have an Activity Zone. Confirm buffers, recovery, idle, coordination, and personal notes are classified before the final verdict.");
  }

  if (evidence.workItemEvents.length === 0 && evidence.sessions.length > 0) {
    reviewItems.push("No timestamped Work Item Events found. If any task-specific detail mattered, add or promote an event before relying on memory.");
  }

  if (evidence.openCaptures.length > 0) {
    reviewItems.push(`${evidence.openCaptures.length} open capture(s) remain. Resolve, convert, or explicitly accept them as follow-up.`);
  }

  if (evidence.capturesCreatedToday.length === 0) {
    reviewItems.push("No captures were created today. If there were interruptions, Capture Inbox was not tested in battle.");
  }

  if (evidence.capturesCreatedToday.length > 0 && evidence.capturesDuringActiveFocus === 0) {
    reviewItems.push("Captures were created, but none were linked to an active focus session. Capture Inbox did not prove interruption handling during focus.");
  }

  if (evidence.telemetry.total === 0) {
    reviewItems.push("No App Telemetry events found for this date.");
  }

  if (evidence.telemetry.total > 0 && evidence.telemetry.windowShown + evidence.telemetry.windowHidden === 0) {
    reviewItems.push("No window show/hide telemetry found. Entry/window friction is not evidenced for this day.");
  }

  if (evidence.telemetry.apiErrors > 0) {
    reviewItems.push(`${evidence.telemetry.apiErrors} API error event(s) found. Check whether any tracking data was lost.`);
  }

  if (evidence.telemetry.copyFailures > 0 || evidence.telemetry.manualCopyFallbacks > 0) {
    reviewItems.push("Report copy friction occurred. Check whether evening export was still cheap enough.");
  }

  if (evidence.telemetry.startFailures > 0 || evidence.telemetry.stopFailures > 0) {
    reviewItems.push("Focus start/stop failures occurred. Check whether they broke trust in the timer.");
  }

  if (evidence.telemetry.captureFailures > 0) {
    reviewItems.push(`${evidence.telemetry.captureFailures} Capture Inbox failure event(s) found. Check whether interruption capture stayed trustworthy.`);
  }

  if (evidence.telemetry.correctionFailures > 0) {
    reviewItems.push(`${evidence.telemetry.correctionFailures} focus correction failure event(s) found. Check whether tracking errors were still fixable before the final report.`);
  }

  if (evidence.telemetry.corrections === 0 && evidence.telemetry.correctionReviews === 0 && evidence.sessions.length > 0) {
    reviewItems.push("No focus correction or correction-review telemetry found. If no correction was needed, explicitly accept that; otherwise test add/edit/split correction before closing the goal.");
  }

  if (evidence.gaps.length > 0) {
    reviewItems.push(`${evidence.gaps.length} significant gap(s) found. Classify them as real breaks or lost tracking.`);
  }

  return {
    hardBlockers,
    reviewItems,
  };
}

function buildMissingDbReport(date, path) {
  return [
    `# Timeskein dogfood RC check - ${date}`,
    "",
    "Verdict: blocked",
    "",
    `DB not found: ${path}`,
    "",
  ].join("\n");
}

function buildRcReport(date, path, evidence, assessment, minFocusSeconds) {
  const verdict = assessment.hardBlockers.length > 0
    ? "blocked"
    : assessment.reviewItems.length > 0
      ? "ready for human RC verdict, with review items"
      : "ready for human RC verdict";

  const lines = [
    `# Timeskein dogfood RC check - ${date}`,
    "",
    `Verdict: ${verdict}`,
    `DB: ${path}`,
    "",
    "## Evidence Summary",
    "",
    `- Total tracked: ${formatDuration(evidence.totalFocusSeconds)} (review threshold: ${formatDuration(minFocusSeconds)})`,
    `- Work focus: ${formatDuration(evidence.workFocusSeconds)}`,
    `- Non-work tracked: ${formatDuration(evidence.nonWorkSeconds)}`,
    `- Entrances: ${evidence.sessions.length}`,
    `- Work Items in report: ${evidence.workItemTotals.length}`,
    `- Work Item notes in report: ${evidence.workItemNoteCount}`,
    `- Day Events: ${evidence.dayEvents.length}`,
    `- Day Events with Activity Zone: ${evidence.dayEventsWithZone}`,
    `- Day Events during active focus: ${evidence.dayEventsDuringActiveFocus}`,
    `- Work Item Events: ${evidence.workItemEvents.length}`,
    `- Work Item Events during active focus: ${evidence.workItemEventsDuringActiveFocus}`,
    `- Activity Zones in report: ${evidence.activityZoneTotals.length}`,
    `- Significant gaps: ${evidence.gaps.length}`,
    `- Captures created today: ${evidence.capturesCreatedToday.length}`,
    `- Captures during active focus: ${evidence.capturesDuringActiveFocus}`,
    `- Open captures: ${evidence.openCaptures.length}`,
    `- App telemetry events: ${evidence.telemetry.total}`,
    `- API errors: ${evidence.telemetry.apiErrors}`,
    `- Copy failures/manual fallbacks: ${evidence.telemetry.copyFailures}/${evidence.telemetry.manualCopyFallbacks}`,
    `- Start/stop failures: ${evidence.telemetry.startFailures}/${evidence.telemetry.stopFailures}`,
    `- Capture failures: ${evidence.telemetry.captureFailures}`,
    `- Corrections requested/applied/reviewed/failed: ${evidence.telemetry.correctionRequests}/${evidence.telemetry.corrections}/${evidence.telemetry.correctionReviews}/${evidence.telemetry.correctionFailures}`,
    `- Window shown/hidden: ${evidence.telemetry.windowShown}/${evidence.telemetry.windowHidden}`,
    `- Window drag starts: ${evidence.telemetry.windowDragStarted}`,
    `- Duplicate Work Item title groups: ${evidence.duplicateTitles.length}`,
    "",
  ];

  lines.push(...formatGoalAuditMarkdown(evidence, assessment, minFocusSeconds), "");

  if (evidence.workItemTotals.length > 0) {
    lines.push("## By Work Item", "", "| Duration | Entrances | Work Item |", "| ---: | ---: | --- |");
    for (const item of evidence.workItemTotals) {
      lines.push(`| ${formatDuration(item.activeSeconds)} | ${item.entrances} | ${escapeMarkdownTable(item.title)} |`);
    }
    lines.push("");
  }

  if (evidence.activityZoneTotals.length > 0) {
    lines.push("## By Activity Zone", "", "| Duration | Entrances | Zone |", "| ---: | ---: | --- |");
    for (const item of evidence.activityZoneTotals) {
      lines.push(`| ${formatDuration(item.activeSeconds)} | ${item.entrances} | ${escapeMarkdownTable(formatActivityZoneLabel(item.zone))} |`);
    }
    lines.push("");
  }

  if (evidence.dayEvents.length > 0) {
    lines.push("## Day Events", "", "| Time | Zone | During Focus | Event |", "| --- | --- | --- | --- |");
    for (const event of evidence.dayEvents) {
      lines.push(
        `| ${escapeMarkdownTable(formatClockTime(event.ts))} | ${escapeMarkdownTable(event.activity_zone ? formatActivityZoneLabel(event.activity_zone) : "")} | ${escapeMarkdownTable(event.focus_session_id ? "yes" : "")} | ${escapeMarkdownTable(event.text)} |`
      );
    }
    lines.push("");
  }

  if (evidence.workItemEvents.length > 0) {
    lines.push("## Work Item Events", "", "| Time | Work Item | During Focus | Event |", "| --- | --- | --- | --- |");
    for (const event of evidence.workItemEvents) {
      lines.push(
        `| ${escapeMarkdownTable(formatClockTime(event.ts))} | ${escapeMarkdownTable(event.work_item_title ?? "unknown Work Item")} | ${escapeMarkdownTable(event.focus_session_id ? "yes" : "")} | ${escapeMarkdownTable(event.text)} |`
      );
    }
    lines.push("");
  }

  if (evidence.capturesCreatedToday.length > 0) {
    lines.push(formatCaptureActivityMarkdown(evidence.capturesCreatedToday).trim(), "");
  }

  if (assessment.hardBlockers.length > 0) {
    lines.push("## Hard Blockers", "");
    for (const item of assessment.hardBlockers) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (assessment.reviewItems.length > 0) {
    lines.push("## Review Items", "");
    for (const item of assessment.reviewItems) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push(
    "## Manual RC Verdict",
    "",
    "- Timeskein was the primary tracker for the full day: yes/no",
    "- Activity Zones separated work from coordination/recovery/idle/personal well enough: yes/no",
    "- Day Events, Work Item Events, or notes reduced memory reconstruction: yes/no",
    "- Tracking mistakes could be corrected before the final report: yes/no",
    "- Capture Inbox preserved focus instead of becoming another pile: yes/no",
    "- Report is enough without memory reconstruction: yes/no",
    "- Remaining limitations are acceptable for daily use: yes/no",
    "- Final RC decision: pass/fail",
    "",
    "## Next",
    "",
    "- If blocked, fix only the listed blockers and run another dogfood day.",
    "- If review items remain, fill the manual verdict before marking the roadmap milestone done.",
    "- If the verdict passes, update docs/opskarta and commit the dogfood release baseline.",
    ""
  );

  return lines.join("\n");
}

function formatGoalAuditMarkdown(evidence, assessment, minFocusSeconds) {
  const rows = [
    {
      requirement: "Final state clean",
      status: evidence.activeSessions.length === 0 && evidence.activeWorkItems.length === 0 ? "pass" : "block",
      evidence: `${evidence.activeSessions.length} active focus session(s), ${evidence.activeWorkItems.length} active Work Item(s)`,
    },
    {
      requirement: "Focus blocks visible",
      status: evidence.sessions.length === 0
        ? "block"
        : evidence.totalFocusSeconds >= minFocusSeconds
          ? "pass"
          : "review",
      evidence: `${evidence.sessions.length} entrance(s), ${formatDuration(evidence.totalFocusSeconds)} tracked`,
    },
    {
      requirement: "Work Item totals available",
      status: evidence.workItemTotals.length > 0 ? "pass" : "block",
      evidence: `${evidence.workItemTotals.length} Work Item total row(s)`,
    },
    {
      requirement: "Activity Zones separated",
      status: evidence.sessions.length === 0
        ? "block"
        : evidence.activityZoneTotals.length > 1 && evidence.nonWorkSeconds > 0
          ? "pass"
          : "review",
      evidence: `${evidence.activityZoneTotals.length} zone(s), ${formatDuration(evidence.workFocusSeconds)} work, ${formatDuration(evidence.nonWorkSeconds)} non-work`,
    },
    {
      requirement: "Day and Work Item context present",
      status: evidence.dayEvents.length + evidence.workItemEvents.length + evidence.workItemNoteCount > 0
        ? "pass"
        : "review",
      evidence: `${evidence.dayEvents.length} Day Event(s), ${evidence.workItemEvents.length} Work Item Event(s), ${evidence.workItemNoteCount} Work Item note(s)`,
    },
    {
      requirement: "Gaps and captures visible",
      status: "pass",
      evidence: `${evidence.gaps.length} significant gap(s), ${evidence.openCaptures.length} open capture(s), ${evidence.capturesCreatedToday.length} capture(s) today`,
    },
    {
      requirement: "Window and menubar friction evidenced",
      status: evidence.telemetry.total === 0
        ? "review"
        : evidence.telemetry.apiErrors +
            evidence.telemetry.copyFailures +
            evidence.telemetry.startFailures +
            evidence.telemetry.stopFailures >
          0
          ? "review"
          : "pass",
      evidence: `${evidence.telemetry.windowShown}/${evidence.telemetry.windowHidden} show/hide, ${evidence.telemetry.windowDragStarted} drag start(s), ${evidence.telemetry.apiErrors} API error(s)`,
    },
    {
      requirement: "Tracking correction or review evidenced",
      status: evidence.sessions.length === 0
        ? "block"
        : evidence.telemetry.corrections > 0 || evidence.telemetry.correctionReviews > 0
          ? "pass"
          : "review",
      evidence: `${evidence.telemetry.correctionRequests}/${evidence.telemetry.corrections}/${evidence.telemetry.correctionReviews}/${evidence.telemetry.correctionFailures} requested/applied/reviewed/failed`,
    },
    {
      requirement: "Hard blockers absent",
      status: assessment.hardBlockers.length === 0 ? "pass" : "block",
      evidence: `${assessment.hardBlockers.length} hard blocker(s)`,
    },
    {
      requirement: "Local gates",
      status: "manual",
      evidence: "Run pnpm test and pnpm dogfood:preflight on the same code before closing the goal",
    },
  ];

  return [
    "## Daily Control Goal Audit",
    "",
    "| Requirement | Status | Evidence |",
    "| --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${escapeMarkdownTable(row.requirement)} | ${escapeMarkdownTable(row.status)} | ${escapeMarkdownTable(row.evidence)} |`
    ),
  ];
}

function formatCaptureActivityMarkdown(captures) {
  const lines = [
    "## Capture Activity",
    "",
    "| Time | State | Capture | During | Outcome |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const capture of captures) {
    lines.push(
      `| ${escapeMarkdownTable(formatClockTime(capture.created_at))} | ${escapeMarkdownTable(capture.state)} | ${escapeMarkdownTable(capture.text)} | ${escapeMarkdownTable(formatCaptureDuring(capture))} | ${escapeMarkdownTable(formatCaptureOutcome(capture))} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatCaptureDuring(capture) {
  if (!capture.focus_session_id) {
    return "no active focus";
  }

  return capture.focus_work_item_title ?? capture.focus_title ?? "linked focus block";
}

function formatCaptureOutcome(capture) {
  if (capture.state === "resolved") {
    return `resolved ${formatClockTime(capture.resolved_at ?? capture.updated_at)}`;
  }

  if (capture.state === "converted") {
    const itemTitle = capture.work_item_title ? ` -> ${capture.work_item_title}` : "";
    return `converted ${formatClockTime(capture.converted_at ?? capture.updated_at)}${itemTitle}`;
  }

  return "open";
}

function clippedActiveSeconds(startedAtValue, stoppedAtValue, from, to, now) {
  const startedAt = new Date(startedAtValue);
  const stoppedAt = stoppedAtValue ? new Date(stoppedAtValue) : now;
  const clippedStart = new Date(Math.max(startedAt.getTime(), from.getTime()));
  const clippedStop = new Date(Math.min(stoppedAt.getTime(), to.getTime()));

  return Math.max(Math.floor((clippedStop.getTime() - clippedStart.getTime()) / 1000), 0);
}

function aggregateWorkItemTotals(sessions) {
  const totals = new Map();

  for (const session of sessions) {
    const key = session.work_item_id ?? `title:${session.title}`;
    const title = session.work_item_title ?? session.title;
    const current = totals.get(key) ?? { title, note: undefined, activeSeconds: 0, entrances: 0 };

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
    const zone = session.activity_zone ?? WORK_ACTIVITY_ZONE;
    const current = totals.get(zone) ?? { zone, activeSeconds: 0, entrances: 0 };

    current.activeSeconds += session.active_seconds;
    current.entrances += 1;
    totals.set(zone, current);
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

function formatActivityZoneLabel(zone) {
  switch (zone) {
    case "work":
      return "Work";
    case "coordination":
      return "Coordination";
    case "recovery":
      return "Recovery";
    case "idle":
      return "Idle";
    case "personal":
      return "Personal";
    default:
      return zone;
  }
}

function summarizeEvents(events) {
  const byKind = {};

  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
  }

  const count = (kind) => byKind[kind] ?? 0;

  return {
    total: events.length,
    byKind,
    apiErrors: count("api_error"),
    copyFailures: count("report_copy_failed"),
    manualCopyFallbacks: count("manual_copy_fallback_shown"),
    startFailures: count("focus_start_failed"),
    stopFailures: count("focus_stop_failed"),
    correctionRequests: count("focus_correction_requested"),
    corrections: count("focus_corrected"),
    correctionReviews: count("focus_correction_reviewed"),
    correctionFailures: count("focus_correction_failed"),
    windowShown: count("window_shown"),
    windowHidden: count("window_hidden"),
    windowDragStarted: count("window_drag_started"),
    captureFailures:
      count("capture_create_failed") +
      count("capture_resolve_failed") +
      count("capture_update_failed") +
      count("capture_delete_failed") +
      count("capture_convert_failed"),
  };
}

function parsePayload(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
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

function nextLocalDay(date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  return result;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
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

function escapeMarkdownTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
