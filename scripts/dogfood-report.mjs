#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));
const reportDate = options.date ?? formatLocalDate(new Date());
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
const exportArgs = [resolve(repoRoot, "scripts/export-focus-day.mjs"), "--db", dbPath];

if (options.date) {
  exportArgs.push("--date", options.date);
}

const activeSummary = existsSync(dbPath)
  ? await loadActiveSummary(dbPath)
  : { activeFocus: undefined, activeWorkItems: [] };
const { stdout: dayMarkdown } = await execFileAsync(process.execPath, exportArgs, {
  cwd: repoRoot,
  maxBuffer: 10 * 1024 * 1024,
});

process.stdout.write(
  buildDogfoodReport(reportDate, dayMarkdown, activeSummary.activeFocus, activeSummary.activeWorkItems)
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

async function loadActiveSummary(path) {
  const [activeFocusRows, activeWorkItems] = await Promise.all([
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
  ]);

  const row = activeFocusRows[0];
  if (!row) {
    return { activeFocus: undefined, activeWorkItems };
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

function buildDogfoodReport(date, dayMarkdown, activeFocus, activeWorkItems) {
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

  lines.push(
    "## Focus Data",
    "",
    dayMarkdown.trim(),
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

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
