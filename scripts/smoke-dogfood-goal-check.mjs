#!/usr/bin/env node

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");

const { stdout } = await execFileAsync(
  "node",
  [
    "scripts/dogfood-goal-check.mjs",
    "--dry-run",
    "--db",
    "/tmp/timeskein goal check.db",
    "--date",
    "2026-06-30",
    "--min-focus-minutes",
    "42",
    "--out",
    "/tmp/timeskein rc.md",
  ],
  { cwd: repoRoot }
);

assert(stdout.includes("# Timeskein dogfood goal check - dry run"), "dry-run title is missing");
assert(stdout.includes("- pnpm test"), "dry-run did not include pnpm test");
assert(stdout.includes("- pnpm dogfood:preflight"), "dry-run did not include dogfood preflight");
assert(stdout.includes("node scripts/dogfood-rc-check.mjs --strict"), "dry-run did not include strict RC check");
assert(stdout.includes("--date 2026-06-30"), "dry-run did not pass date to RC check");
assert(stdout.includes("--min-focus-minutes 42"), "dry-run did not pass min focus threshold to RC check");
assert(stdout.includes("--out '/tmp/timeskein rc.md'"), "dry-run did not quote output path");
assert(stdout.includes("--db '/tmp/timeskein goal check.db'"), "dry-run did not quote DB path");

console.log(
  JSON.stringify(
    {
      ok: true,
    },
    null,
    2
  )
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
