#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const options = parseArgs(process.argv.slice(2));
const dbPath = options.db
  ? resolve(options.db)
  : join(homedir(), "Library/Application Support/Timeskein/timeskein.db");
const supportDir = dirname(dbPath);
const backupSuffix = `before-dogfood-${formatLocalDateTime(new Date()).replaceAll(":", "").replace("T", "-")}`;
const files = existingDatabaseFiles(dbPath);
const runningPids = await runningTimeskeinPids();

if (files.length === 0) {
  console.log(`# Timeskein dogfood DB reset\n\nDB: ${dbPath}\nStatus: nothing to reset`);
  process.exit(0);
}

const responsiveAgent = await detectResponsiveAgent(supportDir);
if (responsiveAgent && options.apply && !options.force) {
  console.error(
    [
      "Timeskein agent appears to be running.",
      `Agent URL: ${responsiveAgent}`,
      "Quit Timeskein first, or pass --force if you know the database is not in use.",
    ].join("\n")
  );
  process.exit(1);
}

if (runningPids.length > 0 && options.apply && !options.force) {
  console.error(
    [
      `Timeskein app process appears to be running: PID ${runningPids.join(", ")}`,
      "Quit Timeskein first, or pass --force if you know the database is not in use.",
    ].join("\n")
  );
  process.exit(1);
}

const plannedMoves = files.map((file) => ({
  from: file,
  to: `${file}.${backupSuffix}`,
}));

if (!options.apply) {
  console.log(buildPlan({ dbPath, plannedMoves, responsiveAgent, runningPids, dryRun: true }));
  process.exit(0);
}

await mkdir(supportDir, { recursive: true });
for (const move of plannedMoves) {
  await rename(move.from, move.to);
}

console.log(buildPlan({ dbPath, plannedMoves, responsiveAgent, runningPids, dryRun: false }));

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
  console.log(`Usage: pnpm dogfood:reset-db [--apply] [--force] [--db path/to/timeskein.db]

Moves the current local Timeskein SQLite database aside before a clean Timeskein day.
Default mode is a dry run. Use --apply to move the database and its -wal/-shm files.
If a Timeskein agent or app process appears to be running, --apply refuses unless --force is passed.`);
}

function existingDatabaseFiles(path) {
  return [path, `${path}-wal`, `${path}-shm`].filter((file) => existsSync(file));
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

function buildPlan({ dbPath, plannedMoves, responsiveAgent, runningPids, dryRun }) {
  const lines = [
    "# Timeskein dogfood DB reset",
    "",
    `Mode: ${dryRun ? "dry-run" : "applied"}`,
    `DB: ${dbPath}`,
    `Agent responsive: ${responsiveAgent ?? "no"}`,
    `Running app PIDs: ${runningPids.length > 0 ? runningPids.join(", ") : "none"}`,
    "",
    "## Moves",
    "",
  ];

  for (const move of plannedMoves) {
    lines.push(`- ${move.from}`);
    lines.push(`  -> ${move.to}`);
  }

  if (dryRun) {
    lines.push("", "## Next", "", "- Run `pnpm dogfood:reset-db -- --apply` to move these files aside.");
    lines.push("- Then run `pnpm dogfood:ready` again.");
  } else {
    lines.push("", "## Next", "", "- Run `pnpm dogfood:ready` again.");
    lines.push("- Launch Timeskein; the app will create a fresh SQLite database.");
  }

  return `${lines.join("\n")}\n`;
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

function formatLocalDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}
