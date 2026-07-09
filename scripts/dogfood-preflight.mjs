#!/usr/bin/env node

import { spawn } from "node:child_process";

const steps = [
  ["node", ["--check", "scripts/open-macos-app.mjs"]],
  ["node", ["--check", "scripts/export-focus-day.mjs"]],
  ["node", ["--check", "scripts/report-period.mjs"]],
  ["node", ["--check", "scripts/export-app-events.mjs"]],
  ["node", ["--check", "scripts/dogfood-metrics.mjs"]],
  ["node", ["--check", "scripts/dogfood-report.mjs"]],
  ["node", ["--check", "scripts/dogfood-finish.mjs"]],
  ["node", ["--check", "scripts/dogfood-goal-check.mjs"]],
  ["node", ["--check", "scripts/dogfood-agent-status.mjs"]],
  ["node", ["--check", "scripts/dogfood-ready.mjs"]],
  ["node", ["--check", "scripts/dogfood-rc-check.mjs"]],
  ["node", ["--check", "scripts/dogfood-reset-db.mjs"]],
  ["node", ["--check", "scripts/dogfood-start.mjs"]],
  ["node", ["--check", "scripts/dogfood-stop-active.mjs"]],
  ["node", ["--check", "scripts/test-suite.mjs"]],
  ["node", ["--check", "scripts/smoke-focus-api.mjs"]],
  ["node", ["--check", "scripts/smoke-corrections-api.mjs"]],
  ["node", ["--check", "scripts/smoke-capture-api.mjs"]],
  ["node", ["--check", "scripts/smoke-day-events-api.mjs"]],
  ["node", ["--check", "scripts/smoke-mock-api.mjs"]],
  ["node", ["--check", "scripts/smoke-export-focus-day.mjs"]],
  ["node", ["--check", "scripts/smoke-period-report.mjs"]],
  ["node", ["--check", "scripts/smoke-app-events.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-report.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-finish.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-docs.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-goal-check.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-agent-status.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-ready.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-rc-check.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-reset-db.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-start.mjs"]],
  ["node", ["--check", "scripts/smoke-dogfood-stop-active.mjs"]],
  ["node", ["--check", "scripts/smoke-open-macos-app.mjs"]],
  ["node", ["--check", "scripts/smoke-macos-app.mjs"]],
  ["pnpm", ["roadmap:validate"]],
  ["pnpm", ["--filter", "@timeskein/contracts", "build"]],
  ["pnpm", ["--filter", "@timeskein/desktop", "typecheck"]],
  ["cargo", ["test", "-p", "timeskein-agent"]],
  ["pnpm", ["--filter", "@timeskein/mock-server", "test"]],
  ["pnpm", ["smoke:inventory-modes"]],
  ["pnpm", ["smoke:timestamped-event-entry"]],
  ["pnpm", ["smoke:day-closure"]],
  ["pnpm", ["smoke:day-review-copy"]],
  ["pnpm", ["smoke:mock-api"]],
  ["pnpm", ["smoke:export-focus-day"]],
  ["pnpm", ["smoke:period-report"]],
  ["pnpm", ["smoke:app-events"]],
  ["pnpm", ["smoke:dogfood-report"]],
  ["pnpm", ["smoke:dogfood-finish"]],
  ["pnpm", ["smoke:dogfood-docs"]],
  ["pnpm", ["smoke:dogfood-goal-check"]],
  ["pnpm", ["smoke:dogfood-status"]],
  ["pnpm", ["smoke:dogfood-ready"]],
  ["pnpm", ["smoke:dogfood-rc-check"]],
  ["pnpm", ["smoke:dogfood-reset-db"]],
  ["pnpm", ["smoke:dogfood-start"]],
  ["pnpm", ["smoke:dogfood-stop-active"]],
  ["pnpm", ["--filter", "@timeskein/desktop", "build"]],
  ["pnpm", ["smoke:open-macos-app"]],
  ["pnpm", ["smoke:macos-app"]],
];

for (const [command, args] of steps) {
  await run(command, args);
}

console.log("\nTimeskein dogfood preflight passed.");

function run(command, args) {
  const label = [command, ...args].join(" ");
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
