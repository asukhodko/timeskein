#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-app-events-smoke-"));
const dbPath = join(tempDir, "timeskein.db");

try {
  await runSqlFile(join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/002_focus_sessions.sql"));
  await runSqlFile(join(repoRoot, "apps/agent/migrations/003_app_events.sql"));
  await runSql(`
    INSERT INTO app_events (id, ts, source, kind, work_item_id, focus_session_id, payload)
    VALUES
      ('e1', '2026-06-30T06:00:00Z', 'ui', 'window_shown', NULL, NULL, '{"control":"tray"}'),
      ('e2', '2026-06-30T06:00:00Z', 'ui', 'window_show_requested', NULL, NULL, '{"control":"tray_click"}'),
      ('e3', '2026-06-30T06:00:05Z', 'ui', 'window_hide_requested', NULL, NULL, '{"control":"global_shortcut"}'),
      ('e4', '2026-06-30T06:00:10Z', 'ui', 'focus_start_requested', 'w1', NULL, '{"action_id":"a1","control":"typed"}'),
      ('e5', '2026-06-30T06:00:11Z', 'ui', 'focus_started', 'w1', 's1', '{"action_id":"a1","already_active":false}'),
      ('e6', '2026-06-30T06:20:00Z', 'ui', 'focus_stop_requested', 'w1', 's1', '{"action_id":"a2"}'),
      ('e7', '2026-06-30T06:20:01Z', 'ui', 'focus_stopped', 'w1', 's1', '{"action_id":"a2"}'),
      ('e8', '2026-06-30T06:30:00Z', 'agent', 'agent_stale_runtime_recovered', NULL, NULL, NULL),
      ('e9', '2026-06-30T06:40:00Z', 'ui', 'report_copy_failed', NULL, NULL, '{"report_kind":"dogfood"}'),
      ('e10', '2026-06-30T06:40:01Z', 'ui', 'manual_copy_fallback_shown', NULL, NULL, '{"report_kind":"dogfood"}'),
      ('e11', '2026-06-30T06:50:00Z', 'ui', 'capture_create_requested', NULL, 's1', '{"action_id":"c1","control":"capture_input","has_active_focus":true}'),
      ('e12', '2026-06-30T06:50:01Z', 'ui', 'capture_created', NULL, 's1', '{"action_id":"c1","control":"capture_input","has_active_focus":true}'),
      ('e13', '2026-06-30T06:55:00Z', 'ui', 'capture_resolve_requested', NULL, 's1', '{"action_id":"c2","control":"done_button","had_focus_link":true}'),
      ('e14', '2026-06-30T06:55:01Z', 'ui', 'capture_resolved', NULL, 's1', '{"action_id":"c2","control":"done_button","had_focus_link":true}'),
      ('e15', '2026-06-30T06:56:00Z', 'ui', 'capture_update_requested', NULL, 's1', '{"action_id":"c3","control":"edit_button","had_focus_link":true}'),
      ('e16', '2026-06-30T06:56:01Z', 'ui', 'capture_updated', NULL, 's1', '{"action_id":"c3","control":"edit_button","had_focus_link":true}'),
      ('e17', '2026-06-30T06:57:00Z', 'ui', 'capture_delete_requested', NULL, 's1', '{"action_id":"c4","control":"delete_button","had_focus_link":true}'),
      ('e18', '2026-06-30T06:57:01Z', 'ui', 'capture_deleted', NULL, 's1', '{"action_id":"c4","control":"delete_button","had_focus_link":true}'),
      ('e19', '2026-06-30T06:58:00Z', 'ui', 'capture_convert_failed', NULL, 's1', '{"action_id":"c5","control":"make_item_button","error_code":"not_found"}'),
      ('e20', '2026-06-30T07:10:00Z', 'ui', 'focus_correction_requested', 'w1', 's1', '{"action_id":"k1","control":"edit_block"}'),
      ('e21', '2026-06-30T07:10:01Z', 'ui', 'focus_corrected', 'w1', 's1', '{"action_id":"k1","control":"edit_block"}'),
      ('e22', '2026-06-30T07:11:00Z', 'ui', 'focus_correction_failed', 'w1', 's1', '{"action_id":"k2","control":"split_block","error_code":"validation_error"}'),
      ('e23', '2026-06-30T07:12:00Z', 'ui', 'focus_correction_reviewed', NULL, NULL, '{"action_id":"k3","control":"review_checklist"}'),
      ('e24', '2026-06-30T07:13:00Z', 'ui', 'capture_followup_reviewed', NULL, NULL, '{"action_id":"c6","control":"review_checklist","open_count":1}'),
      ('e25', '2026-06-30T07:14:00Z', 'ui', 'work_item_time_badges_reviewed', NULL, NULL, '{"action_id":"b1","control":"review_checklist","touched_work_item_count":2}');
  `);

  const { stdout: metricsStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/dogfood-metrics.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );
  assert(metricsStdout.includes("## App Telemetry"), "metrics did not include App Telemetry header");
  assert(metricsStdout.includes("Total events: 25"), "metrics did not count events");
  assert(metricsStdout.includes("Start requests: 1"), "metrics did not count start requests");
  assert(metricsStdout.includes("Typed/selected entry requests: 1/0"), "metrics did not count entry request controls");
  assert(metricsStdout.includes("Manual copy fallbacks: 1"), "metrics did not count manual copy fallbacks");
  assert(metricsStdout.includes("Window show/hide requests: 1/1"), "metrics did not count window requests");
  assert(metricsStdout.includes("Capture created/resolved/converted: 1/1/0"), "metrics did not count capture outcomes");
  assert(metricsStdout.includes("Capture follow-up reviews: 1"), "metrics did not count capture follow-up reviews");
  assert(metricsStdout.includes("Work Item time badge reviews: 1"), "metrics did not count Work Item time badge reviews");
  assert(metricsStdout.includes("Capture updated/deleted: 1/1"), "metrics did not count capture cleanup");
  assert(metricsStdout.includes("Capture failures create/resolve/update/delete/convert: 0/0/0/0/1"), "metrics did not count capture failures");
  assert(metricsStdout.includes("Corrections requested/applied/reviewed/failed: 1/1/1/1"), "metrics did not count corrections");
  assert(metricsStdout.includes("Stale runtime recoveries: 1"), "metrics did not count stale recoveries");
  assert(metricsStdout.includes("Average start latency: 1000ms"), "metrics did not calculate start latency");

  const { stdout: exportStdout } = await execFileAsync(
    "node",
    [join(repoRoot, "scripts/export-app-events.mjs"), "--db", dbPath, "--date", "2026-06-30"],
    { cwd: repoRoot }
  );
  assert(exportStdout.includes("# Timeskein app events"), "event export did not include title");
  assert(exportStdout.includes("focus_start_requested"), "event export did not include start request");
  assert(exportStdout.includes("window_show_requested"), "event export did not include window request");
  assert(exportStdout.includes("capture_created"), "event export did not include capture event");
  assert(exportStdout.includes("capture_followup_reviewed"), "event export did not include capture follow-up review");
  assert(exportStdout.includes("work_item_time_badges_reviewed"), "event export did not include Work Item time badge review");
  assert(exportStdout.includes("focus_corrected"), "event export did not include correction event");
  assert(exportStdout.includes("manual_copy_fallback_shown"), "event export did not include copy fallback");

  console.log(JSON.stringify({ ok: true, db_path: dbPath }, null, 2));
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
