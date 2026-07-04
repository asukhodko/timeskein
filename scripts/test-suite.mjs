#!/usr/bin/env node

import { spawn } from "node:child_process";

const steps = [
  ["pnpm", ["--filter", "@timeskein/contracts", "build"]],
  ["pnpm", ["typecheck"]],
  ["cargo", ["test", "-p", "timeskein-agent"]],
  ["pnpm", ["--filter", "@timeskein/mock-server", "test"]],
  ["pnpm", ["smoke:inventory-modes"]],
  ["pnpm", ["smoke:mock-api"]],
  ["pnpm", ["smoke:export-focus-day"]],
  ["pnpm", ["smoke:app-events"]],
  ["pnpm", ["smoke:dogfood-report"]],
  ["pnpm", ["smoke:dogfood-finish"]],
  ["pnpm", ["smoke:dogfood-goal-check"]],
  ["pnpm", ["smoke:dogfood-rc-check"]],
];

for (const [command, args] of steps) {
  await run(command, args);
}

console.log("\nTimeskein test suite passed.");

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
