#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-dogfood-report-smoke-"));
const dbPath = join(tempDir, "timeskein.db");

try {
  await runSqlFile(join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/002_focus_sessions.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/003_app_events.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/005_activity_zones.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/004_captures.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/008_day_events.sql"));
  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, note, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Deep Work', 'task', 'unknown', 0, 'Keep the implementation context here.', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z'),
      ('w2', 'Meetings', 'task', 'unknown', 0, NULL, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s1', 'Deep Work', 'w1', 'stopped', 1500, 'first block', '2026-06-30T06:00:00Z', '2026-06-30T06:25:00Z', '2026-06-30T06:25:00Z'),
      ('s2', 'Meetings', 'w2', 'stopped', 1500, NULL, '2026-06-30T07:00:00Z', '2026-06-30T07:30:00Z', '2026-06-30T07:30:00Z'),
      ('s3', 'Deep Work', 'w1', 'stopped', 1500, NULL, '2026-06-30T07:35:00Z', '2026-06-30T07:45:00Z', '2026-06-30T07:45:00Z');

    INSERT INTO captures (id, text, state, work_item_id, focus_session_id, created_at, updated_at, resolved_at, converted_at)
    VALUES
      ('c1', 'Reply to incoming thread after focus', 'open', NULL, NULL, '2026-06-30T07:10:00Z', '2026-06-30T07:10:00Z', NULL, NULL),
      ('c2', 'Already handled interruption', 'resolved', NULL, 's1', '2026-06-30T07:12:00Z', '2026-06-30T07:20:00Z', '2026-06-30T07:20:00Z', NULL),
      ('c3', 'Turn into follow-up', 'converted', 'w2', 's2', '2026-06-30T07:40:00Z', '2026-06-30T07:45:00Z', NULL, '2026-06-30T07:45:00Z');

    INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
    VALUES
      ('e1', '2026-06-30T06:12:00Z', 'w1', 'note_added', '{"text":"implementation checkpoint","focus_session_id":"s1"}');

    INSERT INTO day_events (id, ts, kind, text, focus_session_id, activity_zone, updated_at)
    VALUES
      ('de1', '2026-06-30T06:20:00Z', 'note_added', 'buffer before meeting felt expensive', 's1', 'work', '2026-06-30T06:20:00Z');

    INSERT INTO app_events (id, ts, source, kind, focus_session_id, payload)
    VALUES
      ('ae1', '2026-06-30T07:50:00Z', 'ui', 'focus_correction_requested', 's1', '{"action_id":"k1","control":"edit_block"}'),
      ('ae2', '2026-06-30T07:50:01Z', 'ui', 'focus_corrected', 's1', '{"action_id":"k1","control":"edit_block"}');

    UPDATE work_items SET activity_zone = 'coordination' WHERE id = 'w2';
    UPDATE focus_sessions SET activity_zone = 'coordination' WHERE work_item_id = 'w2';
  `);

  const { stdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(stdout.includes("# Timeskein dogfood report - 2026-06-30"), "report title is missing");
  assert(
    stdout.includes("Report state: final - no active focus block or active Work Item"),
    "final report state is missing"
  );
  assert(stdout.includes("## Focus Data"), "report did not include focus data section");
  assert(stdout.includes("## App Telemetry"), "report did not include app telemetry section");
  assert(stdout.includes("## Review Checklist"), "report did not include review checklist section");
  assert(stdout.includes("## Daily Control Goal Audit"), "report did not include daily-control audit section");
  assert(stdout.includes("| Focus blocks visible | pass |"), "report daily-control audit did not pass focus blocks");
  assert(stdout.includes("| Activity Zones separated | pass |"), "report daily-control audit did not pass zones");
  assert(stdout.includes("| Tracking correction or review evidenced | pass |"), "report daily-control audit did not pass correction evidence");
  assert(stdout.includes("| Local gates | manual |"), "report daily-control audit did not include local gates");
  assert(
    stdout.includes("Resolve or convert open captures"),
    "report review checklist did not include open capture cleanup"
  );
  assert(
    stdout.includes("No timestamped Work Item events") === false,
    "report review checklist missed existing timestamped Work Item event"
  );
  assert(
    stdout.includes("Review Activity Zone coverage") === false,
    "report review checklist should not flag zone coverage when two zones are present"
  );
  assert(
    stdout.includes("Confirm non-work tracked time") === false,
    "report review checklist should not flag non-work time when coordination is present"
  );
  assert(
    stdout.includes("No day or Work Item notes/events") === false,
    "report review checklist should not flag missing context when notes/events are present"
  );
  assert(
    stdout.includes("Confirm tracking accuracy or test correction") === false,
    "report review checklist should not flag correction coverage when a correction was applied"
  );
  assert(stdout.includes("## Open Captures"), "report did not include open captures section");
  assert(stdout.includes("Reply to incoming thread after focus"), "report did not include open capture text");
  assert(stdout.includes("## Capture Activity"), "report did not include Capture Activity section");
  assert(stdout.includes("| open | Reply to incoming thread after focus |"), "report did not include open capture activity");
  assert(stdout.includes("| resolved | Already handled interruption |"), "report did not include resolved capture activity");
  assert(stdout.includes("| converted | Turn into follow-up |"), "report did not include converted capture activity");
  assert(stdout.includes("converted") && stdout.includes("Meetings"), "report did not include converted capture target");
  assert(stdout.includes("Total tracked: 1:05:00"), "report did not include exported tracked total");
  assert(stdout.includes("Work focus: 35:00"), "report did not include exported work focus total");
  assert(stdout.includes("Non-work tracked: 30:00"), "report did not include exported non-work total");
  assert(stdout.includes("## By Work Item"), "report did not include work item totals");
  assert(stdout.includes("## By Activity Zone"), "report did not include activity zone totals");
  assert(stdout.includes("| 35:00 | 2 | Work |"), "report did not include Work zone total");
  assert(stdout.includes("| 30:00 | 1 | Coordination |"), "report did not include Coordination zone total");
  assert(stdout.includes("## Work Item Notes"), "report did not include Work Item Notes section");
  assert(
    stdout.includes("- Deep Work: Keep the implementation context here."),
    "report did not include Work Item note"
  );
  assert(stdout.includes("## Work Item Events"), "report did not include Work Item Events section");
  assert(
    stdout.includes("| Deep Work | Deep Work | implementation checkpoint |"),
    "report did not include timestamped Work Item event"
  );
  assert(stdout.includes("## Day Events"), "report did not include Day Events section");
  assert(
    stdout.includes("| Work | Deep Work | buffer before meeting felt expensive |"),
    "report did not include day event"
  );
  assert(stdout.includes("## Gaps >= 20:00"), "report did not include significant gaps");
  assert(stdout.includes("### Entry Cost"), "report did not include entry cost prompts");
  assert(stdout.includes("Enough data to discuss the day: yes/no"), "report did not include verdict prompts");

  await runSql(`
    DELETE FROM work_item_events;
    DELETE FROM day_events;
    DELETE FROM app_events;
    UPDATE work_items SET note = NULL, activity_zone = 'work';
    UPDATE focus_sessions SET activity_zone = 'work';
  `);

  const { stdout: thinEvidenceStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    thinEvidenceStdout.includes("Review Activity Zone coverage"),
    "report review checklist did not flag single-zone evidence"
  );
  assert(
    thinEvidenceStdout.includes("Confirm non-work tracked time"),
    "report review checklist did not flag zero non-work time"
  );
  assert(
    thinEvidenceStdout.includes("No day or Work Item notes/events"),
    "report review checklist did not flag missing day/Work Item context"
  );
  assert(
    thinEvidenceStdout.includes("Confirm tracking accuracy or test correction"),
    "report review checklist did not flag missing correction evidence"
  );

  await runSql(`
    INSERT INTO app_events (id, ts, source, kind, payload)
    VALUES ('ae3', '2026-06-30T07:55:00Z', 'ui', 'focus_correction_reviewed', '{"action_id":"k2","control":"review_checklist"}');
  `);

  const { stdout: reviewedCorrectionStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    reviewedCorrectionStdout.includes("Confirm tracking accuracy or test correction") === false,
    "report review checklist should not flag correction evidence after explicit review"
  );

  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w3', 'Stuck Active Item', 'task', 'active', 0, '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z', '2026-06-30T08:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s4', 'Stuck Active Item', 'w3', 'stopped', 1500, NULL, '2026-06-30T08:00:00Z', '2026-06-30T08:20:00Z', '2026-06-30T08:20:00Z');
  `);

  const { stdout: stuckItemDraftStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(
    stuckItemDraftStdout.includes("Report state: draft - active Work Item still marked active"),
    "stuck active item report state is missing"
  );
  assert(
    stuckItemDraftStdout.includes("## Active Work Item Warning"),
    "stuck active item report did not include active Work Item warning"
  );
  assert(
    stuckItemDraftStdout.includes("Active Work Item: Stuck Active Item"),
    "stuck active item report did not name active Work Item"
  );
  assert(
    stuckItemDraftStdout.includes("Clear active Work Item state"),
    "stuck active item review checklist did not include active Work Item cleanup"
  );

  await runSql(`
    UPDATE work_items SET state = 'unknown' WHERE id = 'w3';

    INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
    VALUES ('w4', 'Still Running', 'task', 'active', 0, '2026-06-30T09:00:00Z', '2026-06-30T09:00:00Z', '2026-06-30T09:00:00Z');

    INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s5', 'Still Running', 'w4', 'active', 1500, NULL, '2026-06-30T09:00:00Z', NULL, '2026-06-30T09:00:00Z');
  `);

  const { stdout: draftStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-report.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );

  assert(draftStdout.includes("Report state: draft - focus block still active"), "draft report state is missing");
  assert(draftStdout.includes("## Active Block Warning"), "draft report did not include active block warning");
  assert(draftStdout.includes("Active Work Item: Still Running"), "draft report did not name active work item");
  assert(
    draftStdout.includes("Stop the active focus block"),
    "active focus review checklist did not include stop action"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        db_path: dbPath,
      },
      null,
      2
    )
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runSqlFile(path) {
  await execFileAsync("sqlite3", [dbPath, `.read ${path}`], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function runSql(sql) {
  await execFileAsync("sqlite3", [dbPath, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
