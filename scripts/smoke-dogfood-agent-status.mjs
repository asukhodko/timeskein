#!/usr/bin/env node

import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-agent-status-smoke-"));

try {
  const healthyServer = await startStatusServer({ dbOk: true });
  try {
    await writeFile(join(tempDir, "agent.port"), String(healthyServer.port));
    const healthy = await runStatus();
    assert(healthy.code === 0, "healthy agent should pass status");
    assert(healthy.stdout.includes("Состояние: готов"), "healthy status did not report localized ready state");
    assert(healthy.stdout.includes("База в порядке: true"), "healthy status did not report localized DB OK");
    assert(!healthy.stdout.includes("Status: READY"), "healthy status leaked old English READY");
  } finally {
    await healthyServer.close();
  }

  const unhealthyServer = await startStatusServer({ dbOk: false });
  try {
    await writeFile(join(tempDir, "agent.port"), String(unhealthyServer.port));
    const unhealthy = await runStatus();
    assert(unhealthy.code !== 0, "unhealthy agent should fail status");
    assert(unhealthy.stdout.includes("Состояние: не готов"), "unhealthy status did not report localized not-ready state");
    assert(unhealthy.stdout.includes("база не в порядке"), "unhealthy status did not explain db health");
    assert(unhealthy.stdout.includes("pnpm dogfood:start"), "unhealthy status did not mention guarded start");
    assert(unhealthy.stdout.includes("pnpm dogfood:continue"), "unhealthy status did not mention guarded continue");
    assert(!unhealthy.stdout.includes("Status: NOT READY"), "unhealthy status leaked old English NOT READY");
    assert(!unhealthy.stdout.includes("## Blockers"), "unhealthy status leaked old English blockers heading");
    assert(!unhealthy.stdout.includes("pnpm dogfood:macos"), "unhealthy status still suggests bypassing the start gate");
  } finally {
    await unhealthyServer.close();
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        support_dir: tempDir,
      },
      null,
      2
    )
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runStatus() {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [join(repoRoot, "scripts/dogfood-agent-status.mjs"), "--support-dir", tempDir, "--timeout-ms", "3000"],
      { cwd: repoRoot }
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

function startStatusServer({ dbOk }) {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/api") {
      response.writeHead(404);
      response.end();
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json",
    });
    response.end(
      JSON.stringify({
        version: "1.0",
        request_id: "smoke",
        result: {
          version: "0.1.0",
          api_version: "1.0",
          uptime_seconds: 1,
          work_items_count: 0,
          storage_path: tempDir,
          db_ok: dbOk,
        },
      })
    );
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
