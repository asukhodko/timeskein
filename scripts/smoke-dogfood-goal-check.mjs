#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-goal-check-smoke-"));

try {
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
  assert(
    stdout.includes("--check-saved-evidence-only") === false,
    "dry-run with explicit DB should not require saved real-day evidence"
  );

  const { stdout: realDryRunStdout } = await execFileAsync(
    "node",
    ["scripts/dogfood-goal-check.mjs", "--dry-run", "--date", "2026-06-30"],
    { cwd: repoRoot }
  );
  assert(
    realDryRunStdout.includes("node scripts/dogfood-goal-check.mjs --check-saved-evidence-only --date 2026-06-30"),
    "real dry-run did not include saved evidence check"
  );

  const missingEvidence = await runGoalCheck(["--check-saved-evidence-only", "--date", "2026-06-30"], tempDir);
  assert(missingEvidence.code !== 0, "missing saved evidence should fail");
  assert(
    `${missingEvidence.stdout}${missingEvidence.stderr}`.includes("Не найдены сохранённые материалы dogfood-дня за 2026-06-30"),
    "missing saved evidence error is missing"
  );
  assert(
    !`${missingEvidence.stdout}${missingEvidence.stderr}`.includes("Saved dogfood evidence is missing"),
    "missing saved evidence error should not use the old English wording"
  );

  await writeFile(
    join(tempDir, "timeskein-dogfood-report-2026-06-30.md"),
    [
      "# Timeskein dogfood report - 2026-06-30",
      "## Focus Data",
      "## Daily Control Goal Audit",
      "## App Telemetry",
      "",
    ].join("\n")
  );
  await writeFile(
    join(tempDir, "timeskein-dogfood-rc-check-2026-06-30.md"),
    [
      "# Timeskein dogfood RC check - 2026-06-30",
      "## Evidence Summary",
      "## Daily Control Goal Audit",
      "",
    ].join("\n")
  );

  const weakEvidence = await runGoalCheck(["--check-saved-evidence-only", "--date", "2026-06-30"], tempDir);
  assert(weakEvidence.code !== 0, "saved evidence without audit rows should fail");
  assert(
    `${weakEvidence.stdout}${weakEvidence.stderr}`.includes("нет строки аудита «Финальное состояние чистое»"),
    "weak saved evidence error did not mention missing audit rows"
  );

  const reportAuditRows = [
    "| Final state clean | pass | 0 active focus block(s), 0 active Work Item(s) |",
    "| Focus blocks visible | pass | 3 entrance(s), 2:00 tracked |",
    "| Work Item totals available | pass | By Work Item section present, 1 UI badge review(s) |",
    "| Activity Zones separated | pass | 1:30 work, 0:30 non-work |",
    "| Day and Work Item context present | pass | Day Events, Work Item Events |",
    "| Gaps and captures visible | pass | gaps section present, 0 open capture(s) |",
    "| Window and menubar friction evidenced | pass | window shown/hidden 2/2 |",
    "| Start and continue paths evidenced | pass | 1/1 typed/selected, 2 stop request(s) |",
    "| Tracking correction or review evidenced | pass | 0/0/1/0 requested/applied/reviewed/failed |",
    "| Day closure duration measured | pass | 1/1 started/completed, last duration 7:00 |",
    "| Hard blockers absent | pass | 0 blocker(s) |",
  ];
  const rcAuditRows = [
    ...reportAuditRows,
    "| Local gates | manual | Run pnpm dogfood:goal-check on the same code before closing the goal |",
  ];
  const reportAuditMarkdown = [
    "## Daily Control Goal Audit",
    "",
    "| Requirement | Status | Evidence |",
    "| --- | --- | --- |",
    ...reportAuditRows,
    "",
  ].join("\n");
  const rcAuditMarkdown = [
    "## Daily Control Goal Audit",
    "",
    "| Requirement | Status | Evidence |",
    "| --- | --- | --- |",
    ...rcAuditRows,
    "",
  ].join("\n");

  const failingClosureReportRows = reportAuditRows.map((row) =>
    row.replace("| Day closure duration measured | pass |", "| Day closure duration measured | review |")
  );
  const failingClosureRcRows = rcAuditRows.map((row) =>
    row.replace("| Day closure duration measured | pass |", "| Day closure duration measured | review |")
  );
  await writeFile(
    join(tempDir, "timeskein-dogfood-report-2026-06-30.md"),
    [
      "# Timeskein dogfood report - 2026-06-30",
      "## Focus Data",
      "## Daily Control Goal Audit",
      "",
      "| Requirement | Status | Evidence |",
      "| --- | --- | --- |",
      ...failingClosureReportRows,
      "",
      "## App Telemetry",
      "",
    ].join("\n")
  );
  await writeFile(
    join(tempDir, "timeskein-dogfood-rc-check-2026-06-30.md"),
    [
      "# Timeskein dogfood RC check - 2026-06-30",
      "## Evidence Summary",
      "## Daily Control Goal Audit",
      "",
      "| Requirement | Status | Evidence |",
      "| --- | --- | --- |",
      ...failingClosureRcRows,
      "",
    ].join("\n")
  );

  const reviewEvidence = await runGoalCheck(["--check-saved-evidence-only", "--date", "2026-06-30"], tempDir);
  assert(reviewEvidence.code !== 0, "saved evidence with review audit rows should fail before expensive gates");
  assert(
    `${reviewEvidence.stdout}${reviewEvidence.stderr}`.includes("строка аудита «Day closure duration measured» ещё не в статусе ok/pass"),
    "review saved evidence error did not mention the non-passing closure-duration row"
  );
  assert(
    `${reviewEvidence.stdout}${reviewEvidence.stderr}`.includes("нажми `Начать закрытие дня`") &&
      `${reviewEvidence.stdout}${reviewEvidence.stderr}`.includes("скопируй финальный отчёт за 10 минут или меньше"),
    "review saved evidence error did not explain how to create measured closure evidence"
  );

  await writeFile(
    join(tempDir, "timeskein-dogfood-report-2026-06-30.md"),
    [
      "# Timeskein dogfood report - 2026-06-30",
      "## Focus Data",
      reportAuditMarkdown,
      "## App Telemetry",
      "",
    ].join("\n")
  );
  await writeFile(
    join(tempDir, "timeskein-dogfood-rc-check-2026-06-30.md"),
    [
      "# Timeskein dogfood RC check - 2026-06-30",
      "## Evidence Summary",
      rcAuditMarkdown,
      "",
    ].join("\n")
  );

  const savedEvidence = await runGoalCheck(["--check-saved-evidence-only", "--date", "2026-06-30"], tempDir);
  assert(savedEvidence.code === 0, "saved evidence check should pass with both evidence files");
  assert(
    savedEvidence.stdout.includes("Сохранённые материалы dogfood-дня за 2026-06-30 найдены."),
    "saved evidence success message is missing"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
      },
      null,
      2
    )
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runGoalCheck(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [join(repoRoot, "scripts/dogfood-goal-check.mjs"), ...args], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
