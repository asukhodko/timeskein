#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));

try {
  if (options.resetDb) {
    const resetArgs = [resolve(repoRoot, "scripts/dogfood-reset-db.mjs")];
    if (!options.dryRun) {
      resetArgs.push("--apply");
    }
    if (options.db) {
      resetArgs.push("--db", options.db);
    }

    await run(process.execPath, resetArgs);

    if (options.dryRun) {
      await run(process.execPath, [resolve(repoRoot, "scripts/open-macos-app.mjs"), "--check-running-only"]);
      if (!options.skipPreflight) {
        await run("pnpm", ["dogfood:preflight"]);
      }
      console.log("\nTimeskein clean dogfood start dry run passed. Database was not moved and app was not opened.");
      process.exit(0);
    }
  }

  const readyArgs = [resolve(repoRoot, "scripts/dogfood-ready.mjs")];
  if (options.mode) {
    readyArgs.push("--mode", options.mode);
  }
  if (options.db) {
    readyArgs.push("--db", options.db);
  }
  if (options.date) {
    readyArgs.push("--date", options.date);
  }

  await run(process.execPath, readyArgs);

  await run(process.execPath, [resolve(repoRoot, "scripts/open-macos-app.mjs"), "--check-running-only"]);

  if (!options.skipPreflight) {
    await run("pnpm", ["dogfood:preflight"]);
  }

  if (options.dryRun) {
    console.log("\nTimeskein dogfood start gate passed. Dry run: app was not opened.");
  } else {
    await run(process.execPath, [resolve(repoRoot, "scripts/open-macos-app.mjs")]);
    await run(process.execPath, [resolve(repoRoot, "scripts/dogfood-agent-status.mjs")]);
    console.log("\nTimeskein dogfood start gate passed. App opened and embedded agent is responsive.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nTimeskein dogfood start gate failed: ${message}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const result = {
    dryRun: false,
    resetDb: false,
    skipPreflight: false,
  };

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
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--reset-db") {
      result.resetDb = true;
    } else if (arg === "--skip-preflight") {
      result.skipPreflight = true;
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
  console.log(`Usage: pnpm dogfood:start [--mode start|continue] [--skip-preflight] [--dry-run] [--reset-db] [--date YYYY-MM-DD] [--db path/to/timeskein.db]

Runs the dogfood start gate:
1. optional database backup reset when --reset-db is passed;
2. real local database readiness check, in start mode by default or continue mode for an existing dogfood day;
3. running-process check;
4. dogfood preflight, unless --skip-preflight is passed;
5. opens the macOS app, unless --dry-run is passed;
6. waits for the embedded agent to become responsive.

With --reset-db --dry-run, only prints the reset plan and checks the running-process/preflight gates. It does not move database files.`);
}

function run(command, args) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
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
