#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const appBinary = join(
  repoRoot,
  "target/release/bundle/macos/Timeskein.app/Contents/MacOS/timeskein-desktop"
);
const tauriConfigPath = join(repoRoot, "apps/desktop/src-tauri/tauri.conf.json");
const tauriMainPath = join(repoRoot, "apps/desktop/src-tauri/src/main.rs");

if (process.platform !== "darwin") {
  console.log(JSON.stringify({ ok: true, skipped: "macOS only" }, null, 2));
  process.exit(0);
}

if (!existsSync(appBinary)) {
  throw new Error(`Packaged app binary not found: ${appBinary}`);
}

await assertMacosWindowPolicy();

const homeDir = await mkdtemp(join(tmpdir(), "timeskein-open-smoke-"));
let child;

try {
  const checkClear = await runOpenApp(["--check-running-only", "--allow-running"]);
  assert(checkClear.code === 0, "open:macos-app --check-running-only --allow-running should pass before smoke app starts");
  assert(
    hasRunningProcessGuard(checkClear.stdout),
    "open:macos-app --check-running-only did not report the running-process guard"
  );

  child = spawn(appBinary, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
    },
    stdio: "ignore",
  });

  await delay(800);

  const checkBlocked = await runOpenApp(["--check-only"]);
  assert(checkBlocked.code !== 0, "open:macos-app --check-only should refuse while timeskein-desktop is running");
  assert(
    checkBlocked.stderr.includes("Timeskein already appears to be running"),
    "open:macos-app --check-only did not explain the running-app blocker"
  );

  const runningBlocked = await runOpenApp(["--check-running-only"]);
  assert(
    runningBlocked.code !== 0,
    "open:macos-app --check-running-only should refuse while timeskein-desktop is running"
  );
  assert(
    runningBlocked.stderr.includes("Timeskein already appears to be running"),
    "open:macos-app --check-running-only did not explain the running-app blocker"
  );

  const runningAllowed = await runOpenApp(["--check-running-only", "--allow-running"]);
  assert(
    runningAllowed.code === 0,
    "open:macos-app --check-running-only --allow-running should pass while timeskein-desktop is running"
  );
  assert(
    runningAllowed.stdout.includes("Running timeskein-desktop process allowed"),
    "open:macos-app --allow-running did not report the allowed running process"
  );

  const blocked = await runOpenApp();
  assert(blocked.code !== 0, "open:macos-app should refuse while timeskein-desktop is running");
  assert(
    blocked.stderr.includes("Timeskein already appears to be running"),
    "open:macos-app did not explain the running-app blocker"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        app_binary: appBinary,
      },
      null,
      2
    )
  );
} finally {
  await stopChild(child);
  await rm(homeDir, { recursive: true, force: true });
}

async function runOpenApp(extraArgs = []) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [join(repoRoot, "scripts/open-macos-app.mjs"), ...extraArgs],
      {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function stopChild(process) {
  if (!process || process.killed) return;

  process.kill("SIGTERM");
  await waitForExit(process, 3_000).catch(() => process.kill("SIGKILL"));
}

async function waitForExit(process, timeoutMs) {
  if (process.exitCode !== null || process.signalCode !== null) return;

  await Promise.race([
    new Promise((resolve) => process.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
  ]);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasRunningProcessGuard(output) {
  return (
    output.includes("No running timeskein-desktop process found") ||
    output.includes("Running timeskein-desktop process allowed")
  );
}

async function assertMacosWindowPolicy() {
  const config = JSON.parse(await readFile(tauriConfigPath, "utf8"));
  const mainWindow = config.app?.windows?.[0];
  assert(mainWindow, "tauri.conf.json does not define a main window");
  assert(mainWindow.alwaysOnTop === false, "main window must not be always-on-top for dogfood use");
  assert(mainWindow.skipTaskbar === false, "main window must be restorable through normal macOS app switching");

  const mainSource = await readFile(tauriMainPath, "utf8");
  const appSource = await readFile(resolve(repoRoot, "apps/desktop/src/App.tsx"), "utf8");
  const paletteSource = await readFile(resolve(repoRoot, "apps/desktop/src/components/Palette.tsx"), "utf8");
  assert(
    mainSource.includes("RunEvent::Reopen"),
    "Tauri main.rs must handle macOS Reopen so hidden windows can be restored"
  );
  assert(
    mainSource.includes("start_tray_status_updater"),
    "Tauri main.rs must run the native tray status updater"
  );
  assert(
    mainSource.includes('"Показать/скрыть Timeskein"') &&
      mainSource.includes('"Выйти"') &&
      mainSource.includes('"Timeskein: нет фокуса"'),
    "Tauri tray menu must keep user-facing labels in Russian"
  );
  assert(
    mainSource.includes("{active} в фокусе") &&
      mainSource.includes("{} сегодня") &&
      mainSource.includes("{minutes} мин") &&
      mainSource.includes("{hours} ч"),
    "Tauri tray status must keep focus/day labels and duration units in Russian"
  );
  assert(
    !mainSource.includes('"Show/Hide Timeskein"') &&
      !mainSource.includes('"Quit"') &&
      !mainSource.includes('"Timeskein: idle"'),
    "Tauri tray menu must not leak old English labels"
  );
  assert(
    mainSource.includes("tauri_plugin_global_shortcut::Builder::new().build()") &&
      mainSource.includes(".global_shortcut()") &&
      mainSource.includes("toggle_main_window(app, \"global_shortcut\")"),
    "Tauri main.rs must register a global show/hide shortcut for low-friction dogfood entry"
  );
  assert(
    mainSource.includes("\"Ctrl+Shift+Space\"") &&
      mainSource.includes("\"Ctrl+Option+Space\"") &&
      mainSource.includes("\"Cmd+Option+Space\""),
    "Tauri main.rs must keep the documented global shortcut fallback candidates"
  );
  assert(
    mainSource.includes("WindowShowRequested") && mainSource.includes("WindowHideRequested"),
    "Tauri main.rs must log shell window show/hide requests for dogfood friction analysis"
  );
  assert(
    appSource.includes("kind: 'window_hide_requested'") && appSource.includes("control: 'escape'"),
    "App.tsx must log Esc hide requests for dogfood friction analysis"
  );
  assert(
    paletteSource.includes("kind: 'window_hide_requested'") && paletteSource.includes("control: 'hide_button'"),
    "Palette.tsx must log hide-button requests for dogfood friction analysis"
  );
}
