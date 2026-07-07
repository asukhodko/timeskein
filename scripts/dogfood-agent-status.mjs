#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const supportDir = options.supportDir
  ? resolve(options.supportDir)
  : join(homedir(), "Library/Application Support/Timeskein");
const portFile = join(supportDir, "agent.port");
const timeoutMs = options.timeoutMs ?? 20_000;

const result = await waitForAgent(portFile, timeoutMs);

if (!result.ok) {
  process.stdout.write(
    [
      "# Timeskein agent status",
      "",
      `Status: NOT READY`,
      `Support dir: ${supportDir}`,
      "",
      "## Blockers",
      "",
      `- ${result.error}`,
      "",
      "## Next",
      "",
      "- If Timeskein is not running, start the Timeskein day with `pnpm dogfood:start`.",
      "- If the Timeskein day was already started and Timeskein was quit, reopen it with `pnpm dogfood:continue`.",
      "- If a stale port file remains after a crash, launching the app again should rewrite it.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

const status = result.status;
process.stdout.write(
  [
    "# Timeskein agent status",
    "",
    "Status: READY",
    `API: ${result.apiUrl}`,
    `Support dir: ${supportDir}`,
    `Storage path: ${status.storage_path}`,
    `DB OK: ${status.db_ok}`,
    `Work Items: ${status.work_items_count}`,
    `Agent uptime: ${status.uptime_seconds}s`,
    "",
  ].join("\n")
);

function parseArgs(args) {
  const result = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--support-dir") {
      result.supportDir = args[++index];
    } else if (arg === "--timeout-ms") {
      result.timeoutMs = Number(args[++index]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (result.timeoutMs !== undefined && (!Number.isFinite(result.timeoutMs) || result.timeoutMs <= 0)) {
    throw new Error(`Invalid --timeout-ms value: ${result.timeoutMs}`);
  }

  return result;
}

function printHelp() {
  console.log(`Usage: pnpm dogfood:status [--support-dir path] [--timeout-ms 20000]

Waits for the local Timeskein embedded agent port file and verifies agent.status.
Exits with code 1 when the agent does not become responsive or reports db_ok=false.
Use dogfood:start for a clean day start and dogfood:continue to reopen an already started day.`);
}

async function waitForAgent(path, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = `Port file not found: ${path}`;

  while (Date.now() < deadline) {
    if (!existsSync(path)) {
      await delay(150);
      continue;
    }

    const port = readFileSync(path, "utf8").trim();
    if (!/^\d+$/.test(port)) {
      lastError = `Invalid port file content: ${path}`;
      await delay(150);
      continue;
    }

    const apiUrl = `http://127.0.0.1:${port}/api`;
    try {
      const status = await rpc(apiUrl, "agent.status");
      if (status.db_ok !== true) {
        return {
          ok: false,
          error: `Agent responded but database is not healthy: ${apiUrl}`,
        };
      }

      return { ok: true, apiUrl, status };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(150);
    }
  }

  return {
    ok: false,
    error: `Agent did not become responsive within ${timeout}ms. Last error: ${lastError}`,
  };
}

async function rpc(apiUrl, method, params = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "1.0",
        request_id: crypto.randomUUID(),
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${method}: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
    }

    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
