#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));
const reportDay = options.date ? parseLocalDate(options.date) : new Date();
const reportDate = options.date ?? formatLocalDate(reportDay);
const from = startOfLocalDay(reportDay);
const to = nextLocalDay(from);
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
const exportArgs = [resolve(repoRoot, "scripts/export-focus-day.mjs"), "--db", dbPath];
const metricsArgs = [resolve(repoRoot, "scripts/dogfood-metrics.mjs"), "--db", dbPath];

if (options.date) {
  exportArgs.push("--date", options.date);
  metricsArgs.push("--date", options.date);
}

const activeSummary = existsSync(dbPath)
  ? await loadActiveSummary(dbPath, from, to)
  : { activeFocus: undefined, activeWorkItems: [], openCaptures: [], captureActivity: [] };
const { stdout: dayMarkdown } = await execFileAsync(process.execPath, exportArgs, {
  cwd: repoRoot,
  maxBuffer: 10 * 1024 * 1024,
});
const { stdout: telemetryMarkdown } = await execFileAsync(process.execPath, metricsArgs, {
  cwd: repoRoot,
  maxBuffer: 10 * 1024 * 1024,
});

process.stdout.write(
  buildDogfoodReport(
    reportDate,
    dayMarkdown,
    telemetryMarkdown,
    activeSummary.activeFocus,
    activeSummary.activeWorkItems,
    activeSummary.openCaptures,
    activeSummary.captureActivity,
    dayMarkdown
  )
);

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

  if (result.date && !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
    throw new Error(`Invalid --date value, expected YYYY-MM-DD: ${result.date}`);
  }

  return result;
}

function printHelp() {
  console.log(`Usage: pnpm dogfood:report [--date YYYY-MM-DD] [--db path/to/timeskein.db]

Prints a Markdown dogfood report from the local Timeskein SQLite database.
The report includes the focus-day export plus review prompts for evening analysis.
If a focus block or Work Item is still active, the report is marked as a draft.`);
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value, expected YYYY-MM-DD: ${value}`);
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
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

async function loadActiveSummary(path, from, to) {
  const [activeFocusRows, activeWorkItems, openCaptures, captureActivity] = await Promise.all([
    queryJson(path, `
      SELECT
        fs.title,
        wi.title AS work_item_title,
        fs.started_at
      FROM focus_sessions fs
      LEFT JOIN work_items wi ON wi.id = fs.work_item_id
      WHERE fs.state = 'active'
      ORDER BY datetime(fs.started_at) DESC
      LIMIT 1
    `),
    queryJson(path, `
      SELECT id, title, updated_at
      FROM work_items
      WHERE deleted_at IS NULL AND state = 'active'
      ORDER BY datetime(updated_at) DESC
    `),
    loadOpenCaptures(path),
    loadCaptureActivity(path, from, to),
  ]);

  const row = activeFocusRows[0];
  if (!row) {
    return { activeFocus: undefined, activeWorkItems, openCaptures, captureActivity };
  }

  const activeSeconds = Math.max(
    Math.floor((Date.now() - new Date(row.started_at).getTime()) / 1000),
    0
  );

  return {
    activeFocus: {
      title: row.work_item_title ?? row.title,
      started_at: row.started_at,
      active_seconds: activeSeconds,
    },
    activeWorkItems,
    openCaptures,
    captureActivity,
  };
}

async function loadOpenCaptures(path) {
  if (!(await tableExists(path, "captures"))) {
    return [];
  }

  return queryJson(path, `
    SELECT id, text, created_at
    FROM captures
    WHERE state = 'open'
    ORDER BY datetime(created_at) ASC
  `);
}

async function loadCaptureActivity(path, from, to) {
  if (!(await tableExists(path, "captures"))) {
    return [];
  }

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

async function tableExists(path, tableName) {
  const rows = await queryJson(
    path,
    `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)}`
  );

  return (rows[0]?.count ?? 0) > 0;
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

function buildDogfoodReport(
  date,
  dayMarkdown,
  telemetryMarkdown,
  activeFocus,
  activeWorkItems,
  openCaptures = [],
  captureActivity = [],
  focusMarkdown = dayMarkdown
) {
  const hasActiveWorkItems = activeWorkItems.length > 0;
  const reportState = activeFocus
    ? "draft - focus block still active"
    : hasActiveWorkItems
      ? "draft - active Work Item still marked active"
      : "final - no active focus block or active Work Item";

  const lines = [
    `# Timeskein dogfood report - ${date}`,
    "",
    `Report state: ${reportState}`,
    "",
  ];

  if (activeFocus) {
    lines.push(
      "## Active Block Warning",
      "",
      `- Active Work Item: ${activeFocus.title}`,
      `- Started: ${formatClockTime(activeFocus.started_at)}`,
      `- Current duration: ${formatDuration(activeFocus.active_seconds)}`,
      "- Stop the active block before treating this as the final day report.",
      ""
    );
  }

  if (!activeFocus && hasActiveWorkItems) {
    lines.push(
      "## Active Work Item Warning",
      "",
      ...activeWorkItems.map((item) => `- Active Work Item: ${item.title}`),
      "- Clear active Work Items before treating this as the final day report.",
      ""
    );
  }

  if (openCaptures.length > 0) {
    lines.push(
      "## Open Captures",
      "",
      ...openCaptures.map((capture) => `- ${formatClockTime(capture.created_at)} ${formatMarkdownListText(capture.text)}`),
      "- Resolve, convert, or explicitly accept these captures as follow-up during review.",
      ""
    );
  }

  if (captureActivity.length > 0) {
    lines.push(formatCaptureActivityMarkdown(captureActivity).trim(), "");
  }

  const reviewItems = buildReviewChecklistItems({
    activeFocus,
    activeWorkItems,
    openCaptures,
    captureActivity,
    focusMarkdown,
    telemetryMarkdown,
  });

  lines.push(formatReviewChecklistMarkdown(reviewItems).trim(), "");
  lines.push(formatDailyControlGoalAuditMarkdown({
    activeFocus,
    activeWorkItems,
    openCaptures,
    captureActivity,
    focusMarkdown,
    telemetryMarkdown,
    reviewItems,
  }).trim(), "");

  lines.push(
    "## Focus Data",
    "",
    dayMarkdown.trim(),
    "",
    telemetryMarkdown.trim(),
    "",
    "## Review",
    "",
    "### Coverage",
    "",
    "- Missing focus blocks:",
    "- Blocks with unclear or wrong Work Item:",
    "- Duplicate or too-broad Work Items:",
    "",
    "### Gaps and Switching",
    "",
    "- Long gaps explained by real breaks:",
    "- Long gaps that look like lost tracking:",
    "- Switches that felt expensive:",
    "",
    "### Entry Cost",
    "",
    "- Where starting the next block required noticeable effort:",
    "- What made the effort easier to pay:",
    "- What Timeskein should make cheaper before daily use:",
    "",
    "### Product Friction",
    "",
    "- Start/switch/stop friction:",
    "- Window/tray friction:",
    "- Data trust issues:",
    "",
    "## Verdict",
    "",
    "- Enough data to discuss the day: yes/no",
    "- Good enough to replace Session tomorrow: yes/no",
    "- Next product fix:",
  );

  return `${lines.join("\n")}\n`;
}

function buildReviewChecklistItems({
  activeFocus,
  activeWorkItems,
  openCaptures,
  captureActivity,
  focusMarkdown,
  telemetryMarkdown = "",
}) {
  const items = [];

  if (activeFocus) {
    items.push({
      level: "blocker",
      title: "Stop the active focus block",
      detail: activeFocus.title,
    });
  }

  if (activeWorkItems.length > 0) {
    items.push({
      level: "blocker",
      title: "Clear active Work Item state",
      detail: `${activeWorkItems.length} active item${activeWorkItems.length === 1 ? "" : "s"}`,
    });
  }

  const captureFollowupReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Capture follow-up reviews"));

  if (openCaptures.length > 0 && captureFollowupReviews === 0) {
    items.push({
      level: "review",
      title: "Resolve, convert, or accept open captures",
      detail: `${openCaptures.length} open`,
    });
  }

  if (focusMarkdown.includes("## Gaps >=") && !hasGapExplanationEvent(focusMarkdown)) {
    items.push({
      level: "review",
      title: "Classify significant gaps",
      detail: "Review Gaps section",
    });
  }

  if (focusMarkdown.includes("## Open Gap") && !hasOpenGapExplanationEvent(focusMarkdown)) {
    items.push({
      level: "review",
      title: "Explain current open gap",
      detail: "Tracking is idle after the last stopped block",
    });
  }

  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && countActivityZoneRows(focusMarkdown) <= 1) {
    items.push({
      level: "review",
      title: "Review Activity Zone coverage",
      detail: "Only one zone appears in the report",
    });
  }

  if (focusMarkdown.includes("Non-work tracked: 0:00")) {
    items.push({
      level: "review",
      title: "Confirm non-work tracked time",
      detail: "Breaks, recovery, coordination, and personal blocks may be missing",
    });
  }

  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && captureActivity.length === 0) {
    items.push({
      level: "review",
      title: "Capture Inbox untested today",
      detail: "No captures created during this day",
    });
  }

  if (captureActivity.length > 0 && captureActivity.every((capture) => !capture.focus_session_id)) {
    items.push({
      level: "review",
      title: "Captures were not linked to active focus",
      detail: "Interruption handling is not proven for this day",
    });
  }

  if (
    focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") &&
    !focusMarkdown.includes("## Day Events") &&
    !focusMarkdown.includes("## Work Item Events") &&
    !focusMarkdown.includes("## Work Item Notes")
  ) {
    items.push({
      level: "review",
      title: "No day or Work Item notes/events",
      detail: "Add context if the report still needs memory reconstruction",
    });
  }

  const correctionTelemetry = parseCorrectionTelemetry(telemetryMarkdown);
  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && correctionTelemetry) {
    if (correctionTelemetry.failures > 0) {
      items.push({
        level: "review",
        title: "Review failed focus corrections",
        detail: `${correctionTelemetry.failures} failure${correctionTelemetry.failures === 1 ? "" : "s"}`,
      });
    } else if (correctionTelemetry.applied === 0 && correctionTelemetry.reviewed === 0) {
      items.push({
        level: "review",
        title: "Confirm tracking accuracy or test correction",
        detail: "No focus corrections applied today",
      });
    }
  }

  const entryTelemetry = parseEntryTelemetry(telemetryMarkdown);
  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && entryTelemetry) {
    if (entryTelemetry.typedEntryRequests === 0 || entryTelemetry.selectedEntryRequests === 0 || entryTelemetry.stopRequests === 0) {
      items.push({
        level: "review",
        title: "Exercise start and continue paths",
        detail: `${entryTelemetry.typedEntryRequests} typed, ${entryTelemetry.selectedEntryRequests} selected/list, ${entryTelemetry.stopRequests} stop request(s)`,
      });
    }
  }

  const windowTelemetry = parseWindowTelemetry(telemetryMarkdown);
  if (focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |") && windowTelemetry) {
    if (windowTelemetry.showRequests + windowTelemetry.hideRequests === 0) {
      items.push({
        level: "review",
        title: "Test window entrypoints",
        detail: "No tray/menu/shortcut/reopen show-hide request telemetry found",
      });
    }
  }

  if (items.length === 0) {
    items.push({
      level: "ok",
      title: "Ready to copy final report",
      detail: "No automatic review items detected",
    });
  }

  return items;
}

function parseWindowTelemetry(markdown) {
  const match = markdown.match(/Window show\/hide requests:\s*(\d+)\/(\d+)/);
  if (!match) return undefined;

  return {
    showRequests: Number(match[1]),
    hideRequests: Number(match[2]),
  };
}

function formatDailyControlGoalAuditMarkdown({
  activeFocus,
  activeWorkItems,
  openCaptures,
  captureActivity,
  focusMarkdown,
  telemetryMarkdown,
  reviewItems,
}) {
  const hasReview = (title) => reviewItems.some((item) => item.title === title);
  const hasFocusBlocks = focusMarkdown.includes("| Time | Duration | Zone | Work Item | Note |");
  const totalTracked = extractLineValue(focusMarkdown, "Total tracked") ?? "n/a";
  const workFocus = extractLineValue(focusMarkdown, "Work focus") ?? "n/a";
  const nonWorkTracked = extractLineValue(focusMarkdown, "Non-work tracked") ?? "n/a";
  const entrances = extractLineValue(focusMarkdown, "Entrances") ?? "0";
  const windowEvidence = extractLineValue(telemetryMarkdown, "Window shown/hidden") ?? "n/a";
  const windowRequestEvidence = extractLineValue(telemetryMarkdown, "Window show/hide requests") ?? "n/a";
  const apiErrors = parseLeadingNumber(extractLineValue(telemetryMarkdown, "API errors"));
  const copyFailures = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Copy failures"));
  const startStopFailures = extractLineValue(telemetryMarkdown, "Start/stop failures") ?? "n/a";
  const entryPathEvidence = extractLineValue(telemetryMarkdown, "Typed/selected entry requests") ?? "n/a";
  const entryTelemetry = parseEntryTelemetry(telemetryMarkdown);
  const correctionEvidence =
    extractLineValue(telemetryMarkdown, "Corrections requested/applied/reviewed/failed") ?? "n/a";
  const captureFollowupReviews = parseLeadingNumber(extractLineValue(telemetryMarkdown, "Capture follow-up reviews"));
  const telemetryAvailable = telemetryMarkdown.includes("Total events:");

  const rows = [
    {
      requirement: "Final state clean",
      status: activeFocus || activeWorkItems.length > 0 ? "block" : "pass",
      evidence: `${activeFocus ? 1 : 0} active focus block(s), ${activeWorkItems.length} active Work Item(s)`,
    },
    {
      requirement: "Focus blocks visible",
      status: hasFocusBlocks ? "pass" : "block",
      evidence: `${entrances} entrance(s), ${totalTracked} tracked`,
    },
    {
      requirement: "Work Item totals available",
      status: focusMarkdown.includes("## By Work Item") ? "pass" : "review",
      evidence: focusMarkdown.includes("## By Work Item") ? "By Work Item section present" : "By Work Item section missing",
    },
    {
      requirement: "Activity Zones separated",
      status:
        hasFocusBlocks && !hasReview("Review Activity Zone coverage") && !hasReview("Confirm non-work tracked time")
          ? "pass"
          : "review",
      evidence: `${workFocus} work, ${nonWorkTracked} non-work`,
    },
    {
      requirement: "Day and Work Item context present",
      status: hasReview("No day or Work Item notes/events") ? "review" : "pass",
      evidence: [
        focusMarkdown.includes("## Day Events") ? "Day Events" : "",
        focusMarkdown.includes("## Work Item Events") ? "Work Item Events" : "",
        focusMarkdown.includes("## Work Item Notes") ? "Work Item Notes" : "",
      ].filter(Boolean).join(", ") || "no context sections",
    },
    {
      requirement: "Gaps and captures visible",
      status:
        hasReview("Classify significant gaps") ||
        hasReview("Capture Inbox untested today") ||
        hasReview("Captures were not linked to active focus") ||
        hasReview("Resolve, convert, or accept open captures")
          ? "review"
          : "pass",
      evidence: `${focusMarkdown.includes("## Gaps >=") ? "gaps section present" : "no significant gaps section"}, ${openCaptures.length} open capture(s), ${captureFollowupReviews} follow-up review(s), ${captureActivity.length} capture(s) today`,
    },
    {
      requirement: "Window and menubar friction evidenced",
      status:
        !telemetryAvailable ||
        apiErrors > 0 ||
        copyFailures > 0 ||
        startStopFailures !== "0/0" ||
        hasReview("Test window entrypoints")
          ? "review"
          : "pass",
      evidence: `window shown/hidden ${windowEvidence}, requests ${windowRequestEvidence}, API errors ${apiErrors}, start/stop failures ${startStopFailures}`,
    },
    {
      requirement: "Start and continue paths evidenced",
      status:
        !telemetryAvailable ||
        !entryTelemetry ||
        entryTelemetry.typedEntryRequests === 0 ||
        entryTelemetry.selectedEntryRequests === 0 ||
        entryTelemetry.stopRequests === 0 ||
        hasReview("Exercise start and continue paths")
          ? "review"
          : "pass",
      evidence: `${entryPathEvidence} typed/selected, ${entryTelemetry?.stopRequests ?? "n/a"} stop request(s)`,
    },
    {
      requirement: "Tracking correction or review evidenced",
      status: hasReview("Confirm tracking accuracy or test correction") ? "review" : "pass",
      evidence: correctionEvidence,
    },
    {
      requirement: "Hard blockers absent",
      status: activeFocus || activeWorkItems.length > 0 ? "block" : "pass",
      evidence: reviewItems.filter((item) => item.level === "blocker").length + " blocker(s)",
    },
    {
      requirement: "Local gates",
      status: "manual",
      evidence: "Run pnpm dogfood:goal-check on the same code before closing the goal",
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
  ].join("\n");
}

function extractLineValue(markdown, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function parseLeadingNumber(value) {
  if (!value) return 0;
  const match = value.match(/^\d+/);
  return match ? Number(match[0]) : 0;
}

function parseCorrectionTelemetry(markdown) {
  const match = markdown.match(/Corrections requested\/applied\/reviewed\/failed:\s*(\d+)\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return undefined;

  return {
    requested: Number(match[1]),
    applied: Number(match[2]),
    reviewed: Number(match[3]),
    failures: Number(match[4]),
  };
}

function parseEntryTelemetry(markdown) {
  const entryMatch = markdown.match(/Typed\/selected entry requests:\s*(\d+)\/(\d+)/);
  const stopMatch = markdown.match(/Stop requests:\s*(\d+)/);
  if (!entryMatch || !stopMatch) return undefined;

  return {
    typedEntryRequests: Number(entryMatch[1]),
    selectedEntryRequests: Number(entryMatch[2]),
    stopRequests: Number(stopMatch[1]),
  };
}

function countActivityZoneRows(markdown) {
  const section = extractMarkdownSection(markdown, "## By Activity Zone");
  if (!section) return 0;

  return section
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .filter((line) => !line.includes("---"))
    .filter((line) => !line.includes("Duration") || !line.includes("Zone"))
    .length;
}

function hasGapExplanationEvent(markdown) {
  return /\bopen\s+gap\b|\bgap\b|разрыв|перерыв|буфер|recovery/i.test(extractMarkdownSection(markdown, "## Day Events"));
}

function hasOpenGapExplanationEvent(markdown) {
  return /\bopen\s+gap\b/i.test(extractMarkdownSection(markdown, "## Day Events"));
}

function extractMarkdownSection(markdown, title) {
  const start = markdown.indexOf(title);
  if (start < 0) return "";

  const rest = markdown.slice(start + title.length);
  const nextSection = rest.search(/\n## /);
  return nextSection >= 0 ? rest.slice(0, nextSection) : rest;
}

function formatReviewChecklistMarkdown(items) {
  const lines = ["## Review Checklist", ""];
  for (const item of items) {
    const marker = item.level === "ok" ? "[x]" : "[ ]";
    const suffix = item.detail ? ` - ${formatMarkdownListText(item.detail)}` : "";
    lines.push(`- ${marker} ${formatMarkdownListText(item.title)}${suffix}`);
  }

  return `${lines.join("\n")}\n`;
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

function formatClockTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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

function formatMarkdownListText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeMarkdownTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
