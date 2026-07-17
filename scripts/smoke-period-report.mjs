#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-period-report-"));
const dbPath = join(tempDir, "timeskein.db");
const outputPath = join(tempDir, "period.md");

try {
  for (const migration of [
    "001_initial.sql",
    "002_focus_sessions.sql",
    "004_captures.sql",
    "005_activity_zones.sql",
    "008_day_events.sql",
    "009_reflection_sessions.sql",
    "010_semantic_tracks.sql",
    "011_evidence_story.sql",
    "012_causal_work_spine.sql",
  ]) {
    await runSqlFile(join(repoRoot, "apps/agent/migrations", migration));
  }

  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, note, created_at, updated_at, last_seen_at)
    VALUES
      ('w1', 'Important Project', 'project', 'unknown', 0, 'Meaningful continuation context', '2026-06-30T06:00:00+03:00', '2026-07-02T10:30:00+03:00', '2026-07-02T10:30:00+03:00'),
      ('w2', 'Reactive Inbox', 'task', 'unknown', 0, NULL, '2026-06-30T12:00:00+03:00', '2026-07-02T12:05:00+03:00', '2026-07-02T12:05:00+03:00'),
      ('w3', 'Mixed Zone Item', 'task', 'unknown', 0, NULL, '2026-06-30T11:00:00+03:00', '2026-06-30T11:30:00+03:00', '2026-06-30T11:30:00+03:00');

    INSERT INTO focus_sessions (id, title, work_item_id, state, activity_zone, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s1', 'Important Project', 'w1', 'stopped', 'work', 1500, 'first result', '2026-06-30T09:00:00+03:00', '2026-06-30T09:30:00+03:00', '2026-06-30T09:30:00+03:00'),
      ('s2', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-06-30T10:00:00+03:00', '2026-06-30T10:30:00+03:00', '2026-06-30T10:30:00+03:00'),
      ('s3', 'Mixed Zone Item', 'w3', 'stopped', 'work', 1500, NULL, '2026-06-30T11:00:00+03:00', '2026-06-30T11:10:00+03:00', '2026-06-30T11:10:00+03:00'),
      ('s4', 'Mixed Zone Item', 'w3', 'stopped', 'personal', 1500, NULL, '2026-06-30T11:20:00+03:00', '2026-06-30T11:30:00+03:00', '2026-06-30T11:30:00+03:00'),
      ('s5', 'Reactive Inbox', 'w2', 'stopped', 'work', 1500, NULL, '2026-06-30T12:00:00+03:00', '2026-06-30T12:05:00+03:00', '2026-06-30T12:05:00+03:00'),
      ('s6', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-01T09:00:00+03:00', '2026-07-01T09:30:00+03:00', '2026-07-01T09:30:00+03:00'),
      ('s7', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-01T10:00:00+03:00', '2026-07-01T10:30:00+03:00', '2026-07-01T10:30:00+03:00'),
      ('s8', 'Reactive Inbox', 'w2', 'stopped', 'work', 1500, NULL, '2026-07-01T11:00:00+03:00', '2026-07-01T11:05:00+03:00', '2026-07-01T11:05:00+03:00'),
      ('s9', 'Reactive Inbox', 'w2', 'stopped', 'work', 1500, NULL, '2026-07-01T11:10:00+03:00', '2026-07-01T11:15:00+03:00', '2026-07-01T11:15:00+03:00'),
      ('s10', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-02T09:00:00+03:00', '2026-07-02T09:30:00+03:00', '2026-07-02T09:30:00+03:00'),
      ('s11', 'Important Project', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-02T10:00:00+03:00', '2026-07-02T10:30:00+03:00', '2026-07-02T10:30:00+03:00'),
      ('s12', 'Reactive Inbox', 'w2', 'stopped', 'work', 1500, NULL, '2026-07-02T12:00:00+03:00', '2026-07-02T12:05:00+03:00', '2026-07-02T12:05:00+03:00'),
      ('outside', 'Outside Range', NULL, 'stopped', 'work', 1500, NULL, '2026-07-03T00:00:00+03:00', '2026-07-03T00:30:00+03:00', '2026-07-03T00:30:00+03:00');

    INSERT INTO day_events (id, ts, kind, text, focus_session_id, activity_zone, updated_at)
    VALUES
      ('de1', '2026-06-30T09:45:00+03:00', 'note_added', 'Разрыв 09:30-09:45: восстановление перед продолжением', 's1', 'recovery', '2026-06-30T09:45:00+03:00');

    INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
    VALUES
      ('we1', '2026-06-30T09:20:00+03:00', 'w1', 'note_added', '{"text":"state changed after first step","focus_session_id":"s1"}'),
      ('we2', '2026-07-01T09:00:00+03:00', 'w2', 'created', NULL),
      ('we3', '2026-06-30T09:22:00+03:00', 'w1', 'note_added', '{"text":"Ship the verified baseline"}'),
      ('we4', '2026-06-30T09:23:00+03:00', 'w1', 'note_added', '{"text":"Waiting for external approval"}'),
      ('we5', '2026-06-30T09:24:00+03:00', 'w1', 'note_added', '{"text":"Verify the next captured block"}'),
      ('we6', '2026-06-30T09:25:00+03:00', 'w1', 'note_added', '{"text":"The report is easier to trust"}'),
      ('we7', '2026-06-30T09:26:00+03:00', 'w1', 'note_added', '{"text":"legacy free-form note"}');

    INSERT INTO captures (id, text, state, work_item_id, focus_session_id, created_at, updated_at, resolved_at, converted_at)
    VALUES
      ('c1', 'Unresolved interruption', 'open', NULL, 's6', '2026-07-01T09:10:00+03:00', '2026-07-01T09:10:00+03:00', NULL, NULL),
      ('c2', 'Converted idea', 'converted', 'w1', 's10', '2026-07-02T09:10:00+03:00', '2026-07-02T09:20:00+03:00', NULL, '2026-07-02T09:20:00+03:00');

    INSERT INTO refs (id, kind, value, normalized_value, created_at)
    VALUES
      ('r1', 'issue_key', 'PROJ-42', 'PROJ-42', '2026-06-30T08:00:00+03:00'),
      ('r2', 'issue_key', 'CURRENT-7', 'CURRENT-7', '2026-06-30T08:05:00+03:00');
    INSERT INTO work_item_refs (work_item_id, ref_id, is_primary, created_at)
    VALUES
      ('w1', 'r1', 1, '2026-06-30T08:00:00+03:00'),
      ('w1', 'r2', 0, '2026-06-30T08:05:00+03:00');

    INSERT INTO tracks (id, title, normalized_title, parent_track_id, created_at, updated_at)
    VALUES
      ('t-root', 'Product Work', 'product work', NULL, '2026-06-01T00:00:00Z', '2026-07-02T00:00:00Z'),
      ('t-important', 'Important Track Current', 'important track current', 't-root', '2026-06-01T00:00:00Z', '2026-07-02T00:00:00Z'),
      ('t-reactive', 'Reactive Operations', 'reactive operations', 't-root', '2026-06-01T00:00:00Z', '2026-07-02T00:00:00Z');

    INSERT INTO labels (id, title, normalized_title, created_at, updated_at)
    VALUES
      ('l-performance', 'performance-review', 'performance-review', '2026-06-01T00:00:00Z', '2026-07-02T00:00:00Z'),
      ('l-reactive', 'reactive', 'reactive', '2026-06-01T00:00:00Z', '2026-07-02T00:00:00Z');

    INSERT INTO work_item_tracks (work_item_id, track_id, assigned_at, updated_at)
    VALUES ('w1', 't-important', '2026-06-01T00:00:00Z', '2026-07-02T00:00:00Z'),
           ('w2', 't-reactive', '2026-06-01T00:00:00Z', '2026-07-02T00:00:00Z');

    INSERT INTO work_item_labels (work_item_id, label_id, assigned_at)
    VALUES ('w1', 'l-performance', '2026-06-01T00:00:00Z'),
           ('w2', 'l-reactive', '2026-06-01T00:00:00Z');

    INSERT INTO focus_session_semantic_snapshots
      (focus_session_id, track_id, track_path_json, labels_json, captured_at)
    SELECT id, 't-important',
           '[{"id":"t-root","title":"Product Work"},{"id":"t-important","title":"Important Track Historical"}]',
           '[{"id":"l-performance","title":"performance-review","archived":false}]',
           started_at
      FROM focus_sessions
     WHERE id IN ('s1', 's2', 's6', 's7', 's10');

    INSERT INTO focus_session_semantic_snapshots
      (focus_session_id, track_id, track_path_json, labels_json, captured_at)
    SELECT id, 't-reactive',
           '[{"id":"t-root","title":"Product Work"},{"id":"t-reactive","title":"Reactive Operations"}]',
           '[{"id":"l-reactive","title":"reactive","archived":false}]',
           started_at
      FROM focus_sessions
     WHERE id IN ('s5', 's8', 's9', 's12');

    INSERT INTO work_item_event_semantic_snapshots
      (work_item_event_id, track_id, track_path_json, labels_json, captured_at)
    SELECT id, 't-important',
           '[{"id":"t-root","title":"Product Work"},{"id":"t-important","title":"Important Track Historical"}]',
           '[{"id":"l-performance","title":"performance-review","archived":false}]',
           ts
      FROM work_item_events
     WHERE id IN ('we1', 'we3', 'we4', 'we5', 'we6', 'we7');

    INSERT INTO evidence_entries (work_item_event_id, evidence_kind, focus_session_id, captured_at)
    VALUES
      ('we1', 'result', 's1', '2026-06-30T09:20:00+03:00'),
      ('we3', 'decision', 's1', '2026-06-30T09:22:00+03:00'),
      ('we4', 'blocker', 's1', '2026-06-30T09:23:00+03:00'),
      ('we5', 'next_step', 's1', '2026-06-30T09:24:00+03:00'),
      ('we6', 'observation', 's1', '2026-06-30T09:25:00+03:00');

    INSERT INTO evidence_ref_snapshots
      (id, work_item_event_id, ref_id, ref_kind, ref_value, captured_at)
    VALUES
      ('ers1', 'we1', 'r1', 'issue_key', 'PROJ-42', '2026-06-30T09:20:00+03:00');

    DELETE FROM work_item_refs WHERE work_item_id = 'w1' AND ref_id = 'r1';
    DELETE FROM refs WHERE id = 'r1';
  `);

  const markdown = await runReport(["--format", "md"]);
  assert(markdown.includes("# Периодический отчёт Timeskein"), "Markdown title is missing");
  assert(markdown.includes("Диапазон: 2026-06-30 включительно — 2026-07-03 исключительно"), "Range semantics are missing");
  assert(markdown.includes("Учтено: 3:40:00"), "Tracked total is incorrect");
  assert(markdown.includes("исполнение: 3:30:00"), `Executive total is incorrect:\n${markdown.slice(0, 900)}`);
  assert(markdown.includes("## Факты периода"), "Facts section is missing");
  assert(markdown.includes("## Разрывы и восстановление"), "Gaps section is missing");
  assert(markdown.includes("## Отвлечения"), "Captures section is missing");
  assert(markdown.includes("## События дня"), "Day Events section is missing");
  assert(markdown.includes("## События дел"), "Work Item Events section is missing");
  assert(markdown.includes("## Связанные refs") && markdown.includes("CURRENT-7"), "Current refs section is missing");
  assert(markdown.includes("## Решения текущего обзора"), "Focus tuning section is missing");
  assert(markdown.includes("Important Project"), "Focus candidate is missing");
  assert(!markdown.includes("Outside Range"), "Exclusive upper bound leaked into Markdown");

  const json = JSON.parse(await runReport(["--format", "json"]));
  assert(json.schema_version === 3, "JSON schema version is missing");
  assert(json.profile.id === "weekly-review", "JSON profile definition is missing");
  assert(json.facts.summary.tracked_seconds === json.summary.tracked_seconds, "Explicit facts are inconsistent");
  assert(Array.isArray(json.decisions.supported_types), "JSON decisions section is missing");
  assert(json.request.range_semantics === "from_inclusive_to_exclusive", "JSON range semantics are incorrect");
  assert(json.summary.calendar_days === 3, "JSON calendar day count is incorrect");
  assert(json.summary.tracked_seconds === 13_200, "JSON tracked seconds are incorrect");
  assert(json.summary.executive_work_seconds === 12_600, "JSON executive seconds are incorrect");
  assert(json.summary.entrances === 12, "JSON entrance count is incorrect");
  assert(json.captures.length === 2, "JSON captures are missing");
  assert(json.events.day.length === 1, "JSON day events are missing");
  assert(json.events.work_item.length === 7, "JSON Work Item events are missing");
  assert(json.gaps.some((gap) => gap.explained && gap.classification === "recovery"), "Explained recovery gap is missing");
  assert(json.gaps.some((gap) => !gap.explained), "Unexplained gap evidence is missing");
  const warningCodes = new Set(json.warnings.map((warning) => warning.code));
  for (const code of [
    "unexplained_significant_gaps",
    "open_captures",
    "low_context_event_density",
    "questionable_activity_zones",
    "possibly_overbroad_work_items",
  ]) {
    assert(warningCodes.has(code), `Expected quality warning is missing: ${code}`);
  }
  assert(json.focus_tuning.candidates[0]?.title === "Important Project", "Focus candidates are not evidence-based");
  assert(!json.timeline.some((session) => session.id === "outside"), "Exclusive upper bound leaked into JSON");
  assert(json.classification.captured_entrances === 9, "Captured semantic coverage is incorrect");
  assert(json.classification.inferred_current_entrances === 3, "Legacy semantic inference is not explicit");
  assert(json.classification.unclassified_source_entrances === 2, "Unclassified rows are not visible");

  await runSql(`
    INSERT INTO focus_sessions (id, title, work_item_id, state, activity_zone, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES ('s_overlap', 'Reactive Inbox', 'w2', 'stopped', 'work', 1500, NULL, '2026-06-30T09:20:00+03:00', '2026-06-30T09:25:00+03:00', '2026-06-30T09:25:00+03:00');
  `);
  const overlapJson = JSON.parse(await runReport(["--format", "json"]));
  assert(
    overlapJson.warnings.some((warning) => warning.code === "overlapping_focus_sessions"),
    "Period report should expose overlapping focus blocks as a trust warning"
  );
  await runSql("DELETE FROM focus_sessions WHERE id = 's_overlap';");

  const trackJson = JSON.parse(await runReport([
    "--format", "json",
    "--profile", "track-retrospective",
    "--track", "t-important",
  ]));
  assert(trackJson.summary.entrances === 6, "Track filter did not include captured and inferred rows");
  assert(trackJson.timeline.every((session) => session.semantic.track_id === "t-important"), "Track filter leaked another Track");
  assert(trackJson.timeline.some((session) => session.semantic.track_path.at(-1)?.title === "Important Track Historical"), "Historical Track title was rewritten");
  assert(trackJson.timeline.some((session) => session.semantic.provenance === "inferred-current"), "Legacy fallback is not marked");
  assert(trackJson.refs.length === 1 && trackJson.refs[0].value === "CURRENT-7", "Current Track refs are missing");
  assert(trackJson.profile_analysis.open_tails.some((tail) => tail.subject === "Important Project"), "Track tails are missing");
  assert(trackJson.request.filters.track.title === "Important Track Current", "Resolved Track is missing from request filters");
  assert(trackJson.profile_analysis.headline.includes("Important Track Current"), "Track profile still guesses its scope");
  assert(trackJson.classification.unclassified_source_entrances === 2, "Filtered report hid Unclassified source data");
  assert(trackJson.classification.inferred_current_included_entrances === 1, "Filtered legacy coverage is incorrect");
  assert(trackJson.classification.captured_included_entrances === 5, "Filtered captured coverage is incorrect");
  assert(trackJson.evidence_story.changes.length === 1, "Typed result evidence is missing");
  assert(trackJson.evidence_story.changes[0].confirmed === true, "Result with a Ref snapshot is not confirmed");
  assert(trackJson.evidence_story.decisions.length === 1, "Typed decision evidence is missing");
  assert(trackJson.evidence_story.blockers_and_tails.some((item) => item.source === "typed_evidence"), "Typed blocker is missing");
  assert(trackJson.evidence_story.next_actions.length === 1, "Typed next step is missing");
  assert(trackJson.evidence_story.observations.length === 1, "Typed observation is missing");
  assert(trackJson.evidence_story.legacy_notes.length === 1, "Legacy note provenance is missing");
  assert(trackJson.evidence_story.evidence[0].refs[0].provenance === "captured", "Historical Ref provenance is missing");
  assert(trackJson.evidence_story.evidence[0].refs[0].value === "PROJ-42", "Removed current Ref was lost from historical evidence");
  assert(!trackJson.warnings.some((warning) => warning.code === "no_result_evidence"), "Confirmed result still triggers no-result warning");

  await runSql(`
    INSERT INTO causal_records (
      id, subject_kind, subject_id, work_item_id, track_id, record_kind,
      operational_state, text, occurred_at, recorded_at, source, provenance,
      confidence, track_snapshot_json, labels_snapshot_json, payload_json
    ) VALUES
      ('or-state-1', 'work_item', 'w1', 'w1', 't-important', 'confirmation',
       'waiting', 'Waiting after the reported period', '2026-07-04T09:00:00+03:00',
       '2026-07-04T09:00:00+03:00', 'user', 'confirmed', 1.0,
       '[{"id":"t-important","title":"Important Track Current"}]', '[]', '{}'),
      ('or-state-2', 'work_item', 'w1', 'w1', 't-important', 'correction',
       'blocked', 'Blocked after the reported period', '2026-07-09T09:00:00+03:00',
       '2026-07-09T09:00:00+03:00', 'user', 'confirmed', 1.0,
       '[{"id":"t-important","title":"Important Track Current"}]', '[]',
       '{"previous_state":"waiting"}');
    UPDATE causal_records SET supersedes_id = 'or-state-1' WHERE id = 'or-state-2';
  `);
  const trackAfterCurrentCorrection = JSON.parse(await runReport([
    "--format", "json",
    "--profile", "track-retrospective",
    "--track", "t-important",
  ]));
  assert(
    JSON.stringify(trackAfterCurrentCorrection) === JSON.stringify(trackJson),
    "Later Operational Reality correction rewrote an earlier period report"
  );

  const trackMarkdown = await runReport([
    "--format", "md",
    "--profile", "track-retrospective",
    "--track", "t-important",
  ]);
  for (const heading of [
    "## Что изменилось",
    "## Доказательства",
    "## Решения",
    "## Блокеры и хвосты",
    "## Что произошло после прошлых решений",
    "## Следующие действия",
  ]) {
    assert(trackMarkdown.includes(heading), `Track evidence heading is missing: ${heading}`);
  }

  await runSql("UPDATE tracks SET parent_track_id = NULL WHERE id = 't-important';");
  const parentJson = JSON.parse(await runReport([
    "--format", "json",
    "--track", "Product Work",
    "--include-child-tracks",
  ]));
  assert(parentJson.summary.entrances === 9, "Parent Track filter did not preserve historical descendants");
  assert(parentJson.timeline.some((session) => session.id === "s1"), "Historical child membership was lost after reparenting");
  assert(!parentJson.timeline.some((session) => session.id === "s11"), "Legacy current-tree inference was presented as historical membership");

  const labelJson = JSON.parse(await runReport([
    "--format", "json",
    "--label", "performance-review",
  ]));
  assert(labelJson.summary.entrances === 6, "Label filter selected incorrect focus blocks");

  const personalJson = JSON.parse(await runReport([
    "--format", "json",
    "--zone", "personal",
  ]));
  assert(personalJson.summary.entrances === 1 && personalJson.timeline[0].id === "s4", "Activity Zone filter is incorrect");

  const { stdout: savedPath } = await execFileAsync(
    "node",
    [
      join(repoRoot, "scripts/report-period.mjs"),
      "--db", dbPath,
      "--from", "2026-06-30",
      "--to", "2026-07-03",
      "--now", "2026-07-03T12:00:00+03:00",
      "--output", outputPath,
    ],
    { cwd: repoRoot }
  );
  assert(savedPath.trim() === outputPath, "--output did not print the saved path");
  assert((await readFile(outputPath, "utf8")).includes("## Решения текущего обзора"), "--output did not save Markdown");

  await expectFailure(
    ["--from", "2026-07-03", "--to", "2026-07-03"],
    "Значение --to должно быть позже --from"
  );
  await expectFailure(
    ["--from", "2026-06-30", "--to", "2026-07-03", "--format", "csv"],
    "Некорректный --format"
  );
  await expectFailure(
    ["--from", "2026-06-30", "--to", "2026-07-03", "--profile", "track-retrospective"],
    "требует --track"
  );

  console.log(JSON.stringify({ ok: true, db_path: dbPath }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runReport(extraArgs) {
  const { stdout } = await execFileAsync(
    "node",
    [
      join(repoRoot, "scripts/report-period.mjs"),
      "--db", dbPath,
      "--from", "2026-06-30",
      "--to", "2026-07-03",
      "--now", "2026-07-03T12:00:00+03:00",
      ...extraArgs,
    ],
    { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 }
  );
  return stdout;
}

async function expectFailure(args, expectedMessage) {
  try {
    await execFileAsync("node", [join(repoRoot, "scripts/report-period.mjs"), "--db", dbPath, ...args], {
      cwd: repoRoot,
    });
    throw new Error(`Expected failure containing: ${expectedMessage}`);
  } catch (error) {
    const stderr = error?.stderr ?? "";
    assert(stderr.includes(expectedMessage), `Failure did not contain: ${expectedMessage}\n${stderr}`);
  }
}

async function runSqlFile(path) {
  await execFileAsync("sqlite3", [dbPath, `.read ${path}`], { maxBuffer: 10 * 1024 * 1024 });
}

async function runSql(sql) {
  await execFileAsync("sqlite3", [dbPath, sql], { maxBuffer: 10 * 1024 * 1024 });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
