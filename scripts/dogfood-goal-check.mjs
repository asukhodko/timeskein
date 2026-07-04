#!/usr/bin/env node

import { spawn } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
const rcArgs = ["scripts/dogfood-rc-check.mjs", "--strict"];

if (options.db) {
  rcArgs.push("--db", options.db);
}

if (options.date) {
  rcArgs.push("--date", options.date);
}

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
  ["pnpm", ["test"]],
  ["pnpm", ["dogfood:preflight"]],
  [process.execPath, rcArgs],
];

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
  console.log(`Usage: pnpm dogfood:goal-check [--date YYYY-MM-DD] [--db path/to/timeskein.db] [--min-focus-minutes N] [--save | --out path.md] [--dry-run]

Runs the final local gate for the active daily-control goal:

1. pnpm test
2. pnpm dogfood:preflight
3. dogfood:rc-check --strict for the selected dogfood day

Use this after a real dogfood day, before marking the goal complete.`);
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

function shellQuote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
