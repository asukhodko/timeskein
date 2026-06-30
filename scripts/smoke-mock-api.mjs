#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const port = process.env.TIMESKEIN_MOCK_PORT || "3457";
const apiUrl = `http://127.0.0.1:${port}/api`;

const server = spawn("pnpm", ["--filter", "@timeskein/mock-server", "start"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: port,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForApi(apiUrl, server);
  await run("node", ["scripts/smoke-focus-api.mjs"], {
    ...process.env,
    TIMESKEIN_API_URL: apiUrl,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        api_url: apiUrl,
      },
      null,
      2
    )
  );
} finally {
  await stopServer(server);
}

async function waitForApi(url, child) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`mock server exited early with code ${child.exitCode}\n${serverOutput}`);
    }

    try {
      const response = await fetch(url, {
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
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }

  throw new Error(`mock server did not become ready at ${url}\n${serverOutput}`);
}

function run(command, args, env) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
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

function stopServer(child) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);

    child.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill("SIGTERM");
  });
}
