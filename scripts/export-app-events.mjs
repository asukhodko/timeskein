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

process.stdout.write(buildEventsMarkdown(events, from));

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
  console.log(`Использование: pnpm export:app-events [--date YYYY-MM-DD] [--db path/to/timeskein.db]

Печатает Markdown-таблицу локальных технических событий Timeskein.`);
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

  return stdout.trim() ? JSON.parse(stdout) : [];
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

function buildEventsMarkdown(events, day) {
  const dateTitle = day.toLocaleDateString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const lines = [
    `# События приложения Timeskein - ${dateTitle}`,
    "",
    `Всего событий: ${events.length}`,
    "",
    "| Время | Источник | Тип | Дело | Фокус-блок | Тех. payload |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const event of events) {
    lines.push(
      `| ${formatClockTime(event.ts)} | ${escapeMarkdownTable(event.source)} | ${escapeMarkdownTable(event.kind)} | ${escapeMarkdownTable(event.work_item_id ?? "")} | ${escapeMarkdownTable(event.focus_session_id ?? "")} | ${escapeMarkdownTable(event.payload ?? "")} |`
    );
  }

  return `${lines.join("\n")}\n`;
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

function formatClockTime(value) {
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
