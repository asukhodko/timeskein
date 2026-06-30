#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const appBundle = join(repoRoot, "target/release/bundle/macos/Timeskein.app");
const options = parseArgs(process.argv.slice(2));

if (process.platform !== "darwin") {
  throw new Error("open:macos-app only works on macOS");
}

const runningPids = await runningTimeskeinPids();
if (runningPids.length > 0 && !options.allowRunning) {
  throw new Error(
    [
      `Timeskein already appears to be running: PID ${runningPids.join(", ")}`,
      "Quit Timeskein first so dogfood:start opens the freshly built app.",
      "Pass --allow-running only when you intentionally want to activate an existing process.",
    ].join("\n")
  );
}

if (options.checkRunningOnly) {
  console.log("No running timeskein-desktop process found.");
  process.exit(0);
}

if (!existsSync(appBundle)) {
  throw new Error(`Timeskein.app not found. Build it first: pnpm build`);
}

if (options.checkOnly) {
  console.log("Timeskein.app is ready to open.");
  process.exit(0);
}

const child = spawn("open", [appBundle], {
  cwd: repoRoot,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function parseArgs(args) {
  const result = {
    allowRunning: false,
    checkOnly: false,
    checkRunningOnly: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--allow-running") {
      result.allowRunning = true;
    } else if (arg === "--check-only") {
      result.checkOnly = true;
    } else if (arg === "--check-running-only") {
      result.checkRunningOnly = true;
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
  console.log(`Usage: pnpm open:macos-app [--allow-running] [--check-only] [--check-running-only]

Opens the packaged Timeskein.app on macOS.
By default, refuses when timeskein-desktop is already running so dogfood:start does not accidentally reuse an older process.
Use --check-only to validate the bundle and running-process guard without opening the app.
Use --check-running-only to run only the running-process guard before preflight builds the app.`);
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
