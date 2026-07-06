#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const options = parseArgs(process.argv.slice(2));
const date = options.date ?? formatLocalDate(new Date());
const rcArgs = ["scripts/dogfood-rc-check.mjs", "--strict"];
const shouldCheckSavedEvidence = !options.db && !options.skipSavedEvidenceCheck;

if (options.db) {
  rcArgs.push("--db", options.db);
}

rcArgs.push("--date", date);

if (options.minFocusMinutes !== undefined) {
  rcArgs.push("--min-focus-minutes", String(options.minFocusMinutes));
}

if (options.save) {
  rcArgs.push("--save");
}

if (options.out) {
  rcArgs.push("--out", options.out);
}

const steps = [
  ...(shouldCheckSavedEvidence
    ? [["node", ["scripts/dogfood-goal-check.mjs", "--check-saved-evidence-only", "--date", date]]]
    : []),
  ["pnpm", ["test"]],
  ["pnpm", ["dogfood:preflight"]],
  [process.execPath, rcArgs],
];

if (options.checkSavedEvidenceOnly) {
  await checkSavedEvidence(date);
  console.log(`Saved dogfood evidence found for ${date}.`);
  process.exit(0);
}

if (options.dryRun) {
  console.log("# Timeskein dogfood goal check - dry run");
  console.log("");
  for (const [command, args] of steps) {
    console.log(`- ${formatCommand(command, args)}`);
  }
  process.exit(0);
}

for (const [command, args] of steps) {
  await run(command, args);
}

console.log("\nTimeskein dogfood goal check passed.");

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
    } else if (arg === "--min-focus-minutes") {
      result.minFocusMinutes = Number(args[++index]);
      if (!Number.isFinite(result.minFocusMinutes) || result.minFocusMinutes < 0) {
        throw new Error("--min-focus-minutes must be a non-negative number");
      }
    } else if (arg === "--save") {
      result.save = true;
    } else if (arg === "--out") {
      result.out = args[++index];
    } else if (arg === "--skip-saved-evidence-check") {
      result.skipSavedEvidenceCheck = true;
    } else if (arg === "--check-saved-evidence-only") {
      result.checkSavedEvidenceOnly = true;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
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

  if (result.save && result.out) {
    throw new Error("Use either --save or --out, not both");
  }

  return result;
}

function printHelp() {
  console.log(`Usage: pnpm dogfood:goal-check [--date YYYY-MM-DD] [--db path/to/timeskein.db] [--min-focus-minutes N] [--save | --out path.md] [--skip-saved-evidence-check] [--dry-run]

Runs the final local gate for the active daily-control goal:

1. saved dogfood report and RC evidence exist for the selected date
2. pnpm test
3. pnpm dogfood:preflight
4. dogfood:rc-check --strict for the selected dogfood day

Use this after a real dogfood day, before marking the goal complete.`);
}

async function checkSavedEvidence(date) {
  const reportPath = `timeskein-dogfood-report-${date}.md`;
  const rcPath = `timeskein-dogfood-rc-check-${date}.md`;
  const missing = [];

  const report = await readEvidenceFile(reportPath, missing);
  const rcCheck = await readEvidenceFile(rcPath, missing);

  if (missing.length > 0) {
    throw new Error(
      [
        `Saved dogfood evidence is missing for ${date}:`,
        ...missing.map((item) => `- ${item}`),
        "",
        `Run: pnpm dogfood:finish:save -- --date ${date}`,
      ].join("\n")
    );
  }

  const weak = [];
  const reportRequirements = [
    "# Timeskein dogfood report",
    "## Focus Data",
    "## Daily Control Goal Audit",
    "## App Telemetry",
  ];
  const rcRequirements = [
    "# Timeskein dogfood RC check",
    "## Evidence Summary",
    "## Daily Control Goal Audit",
  ];
  const dailyControlRows = [
    "Final state clean",
    "Focus blocks visible",
    "Work Item totals available",
    "Activity Zones separated",
    "Day and Work Item context present",
    "Gaps and captures visible",
    "Window and menubar friction evidenced",
    "Start and continue paths evidenced",
    "Tracking correction or review evidenced",
    "Day closure duration measured",
    "Hard blockers absent",
    "Local gates",
  ];

  for (const needle of reportRequirements) {
    if (!report.includes(needle)) {
      weak.push(`${reportPath} does not include ${needle}`);
    }
  }
  for (const needle of rcRequirements) {
    if (!rcCheck.includes(needle)) {
      weak.push(`${rcPath} does not include ${needle}`);
    }
  }
  for (const row of dailyControlRows) {
    if (!report.includes(row)) {
      weak.push(`${reportPath} Daily Control Goal Audit does not include ${row}`);
    }
    if (!rcCheck.includes(row)) {
      weak.push(`${rcPath} Daily Control Goal Audit does not include ${row}`);
    }
  }

  if (weak.length > 0) {
    throw new Error(
      [
        `Saved dogfood evidence is incomplete for ${date}:`,
        ...weak.map((item) => `- ${item}`),
        "",
        `Regenerate it with: pnpm dogfood:finish:save -- --date ${date}`,
      ].join("\n")
    );
  }
}

async function readEvidenceFile(path, missing) {
  try {
    const text = await readFile(path, "utf8");
    if (text.trim().length === 0) {
      missing.push(`${path} is empty`);
      return "";
    }
    return text;
  } catch (error) {
    if (error?.code === "ENOENT") {
      missing.push(path);
      return "";
    }
    throw error;
  }
}

function run(command, args) {
  const label = formatCommand(command, args);
  console.log(`\n> ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} terminated by ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${label} exited with code ${code}`));
        return;
      }

      resolve();
    });
  });
}

function formatCommand(command, args) {
  const displayCommand = command === process.execPath ? "node" : command;
  return [displayCommand, ...args].map(shellQuote).join(" ");
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
