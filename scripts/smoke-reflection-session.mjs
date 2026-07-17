#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = await mkdtemp(join(tmpdir(), "timeskein-reflection-session-"));
const dbPath = join(tempDir, "timeskein.db");
const templatePath = join(tempDir, "reflection.json");

try {
  for (const migration of [
    "001_initial.sql",
    "002_focus_sessions.sql",
    "005_activity_zones.sql",
    "008_day_events.sql",
    "009_reflection_sessions.sql",
    "010_semantic_tracks.sql",
    "011_evidence_story.sql",
  ]) {
    await runSqlFile(join(repoRoot, "apps/agent/migrations", migration));
  }

  await runSql(`
    INSERT INTO work_items (id, title, type, state, pinned, note, created_at, updated_at, last_seen_at, activity_zone)
    VALUES
      ('w1', 'Build the review loop', 'project', 'unknown', 0, 'Outcome context', '2026-07-01T09:00:00+03:00', '2026-07-02T10:00:00+03:00', '2026-07-02T10:00:00+03:00', 'work'),
      ('w2', 'Reactive messages', 'task', 'unknown', 0, NULL, '2026-07-01T11:00:00+03:00', '2026-07-02T11:10:00+03:00', '2026-07-02T11:10:00+03:00', 'work');

    INSERT INTO focus_sessions (id, title, work_item_id, state, activity_zone, target_seconds, note, started_at, stopped_at, updated_at)
    VALUES
      ('s1', 'Build the review loop', 'w1', 'stopped', 'work', 1500, 'first result', '2026-07-01T09:00:00+03:00', '2026-07-01T09:40:00+03:00', '2026-07-01T09:40:00+03:00'),
      ('s2', 'Build the review loop', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-02T09:00:00+03:00', '2026-07-02T09:35:00+03:00', '2026-07-02T09:35:00+03:00'),
      ('s3', 'Reactive messages', 'w2', 'stopped', 'work', 1500, NULL, '2026-07-02T11:00:00+03:00', '2026-07-02T11:10:00+03:00', '2026-07-02T11:10:00+03:00'),
      ('s4', 'Build the review loop', 'w1', 'stopped', 'work', 1500, NULL, '2026-07-02T10:00:00+03:00', '2026-07-02T10:20:00+03:00', '2026-07-02T10:20:00+03:00');

    INSERT INTO tracks (id, title, normalized_title, parent_track_id, created_at, updated_at)
    VALUES ('t-review', 'Review Loop', 'review loop', NULL, '2026-07-01T08:00:00+03:00', '2026-07-02T10:00:00+03:00');
    INSERT INTO work_item_tracks (work_item_id, track_id, assigned_at, updated_at)
    VALUES ('w1', 't-review', '2026-07-01T08:00:00+03:00', '2026-07-02T10:00:00+03:00');
    INSERT INTO focus_session_semantic_snapshots (focus_session_id, track_id, track_path_json, labels_json, captured_at)
    VALUES
      ('s1', 't-review', '[{"id":"t-review","title":"Review Loop"}]', '[]', '2026-07-01T09:00:00+03:00'),
      ('s2', 't-review', '[{"id":"t-review","title":"Review Loop"}]', '[]', '2026-07-02T09:00:00+03:00'),
      ('s4', 't-review', '[{"id":"t-review","title":"Review Loop"}]', '[]', '2026-07-02T10:00:00+03:00');
  `);

  const profiles = ["weekly-review", "sprint-review", "track-retrospective", "performance-evidence"];
  const purposes = new Set();
  for (const profile of profiles) {
    const profileArgs = profile === "track-retrospective" ? ["--track", "t-review"] : [];
    const report = JSON.parse(await runReport(["--profile", profile, "--format", "json", ...profileArgs]));
    assert(report.schema_version === 3, `${profile}: JSON schema version is incorrect`);
    assert(report.request.profile === profile, `${profile}: selected profile is not explicit`);
    assert(report.profile.id === profile, `${profile}: profile definition is missing`);
    assert(report.profile.questions.length >= 4, `${profile}: profile-specific questions are missing`);
    assert(report.facts.summary.tracked_seconds === report.summary.tracked_seconds, `${profile}: explicit facts are inconsistent`);
    assert(Array.isArray(report.observations.fragmented_work_items), `${profile}: observations are missing`);
    assert(Array.isArray(report.warnings), `${profile}: warnings are missing`);
    assert(Array.isArray(report.decisions.supported_types), `${profile}: decision section is missing`);
    purposes.add(report.profile.purpose);
  }
  assert(purposes.size === profiles.length, "Profiles do not express distinct review purposes");

  const markdown = await runReport(["--profile", "weekly-review", "--reflection-template", templatePath]);
  assert(markdown.includes("## Задача обзора"), "Markdown profile section is missing");
  assert(markdown.includes("## Сохранённые решения"), "Markdown saved decisions section is missing");
  assert(markdown.includes("## Решения текущего обзора"), "Markdown current decisions section is missing");

  const template = JSON.parse(await readFile(templatePath, "utf8"));
  assert(template.profile === "weekly-review", "Reflection template lost the report profile");
  assert(template.decisions[0]?.work_item_id === "w1", "Reflection template did not keep the candidate Work Item");
  template.summary = "Review loop became the next protected product focus.";
  template.findings = ["Two substantial blocks produced visible progress."];
  template.decisions = [
    {
      work_item_id: "w1",
      subject: "Build the review loop",
      decision: "protect-next-focus",
      note: "Reserve the first substantial block next week.",
    },
    {
      work_item_id: "w2",
      subject: "Reactive messages",
      decision: "reactive",
      note: "Keep in a bounded coordination slot.",
    },
  ];
  await writeFile(templatePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");

  const saved = JSON.parse((await execFileAsync(
    "node",
    [join(repoRoot, "scripts/reflection-session.mjs"), "save", "--db", dbPath, "--input", templatePath, "--now", "2026-07-03T12:00:00+03:00"],
    { cwd: repoRoot }
  )).stdout);
  assert(saved.decisions.length === 2, "Reflection save lost decisions");

  const listedJson = JSON.parse((await execFileAsync(
    "node",
    [join(repoRoot, "scripts/reflection-session.mjs"), "list", "--db", dbPath, "--format", "json", "--profile", "weekly-review"],
    { cwd: repoRoot }
  )).stdout);
  assert(listedJson.length === 1, "Saved reflection is not listed");
  assert(listedJson[0].decisions.some((item) => item.decision === "protect-next-focus"), "Saved protect decision is missing");

  const listedMarkdown = (await execFileAsync(
    "node",
    [join(repoRoot, "scripts/reflection-session.mjs"), "list", "--db", dbPath],
    { cwd: repoRoot }
  )).stdout;
  assert(listedMarkdown.includes("Защитить следующий фокус"), "Markdown list does not render decision labels");

  const repeatedJson = JSON.parse(await runReport(["--profile", "weekly-review", "--format", "json"]));
  assert(repeatedJson.decisions.selected_period.length === 1, "Repeated JSON report did not load the saved review");
  assert(repeatedJson.decisions.selected_period[0].decisions.length === 2, "Repeated JSON report lost saved decisions");
  const repeatedMarkdown = await runReport(["--profile", "weekly-review"]);
  assert(repeatedMarkdown.includes("Review loop became the next protected product focus."), "Repeated Markdown report did not show the saved summary");
  assert(repeatedMarkdown.includes("Reactive messages"), "Repeated Markdown report did not show the saved decision subject");

  const trackTemplatePath = join(tempDir, "track-reflection.json");
  await runReport([
    "--profile", "track-retrospective",
    "--track", "t-review",
    "--reflection-template", trackTemplatePath,
  ]);
  const trackTemplate = JSON.parse(await readFile(trackTemplatePath, "utf8"));
  assert(trackTemplate.decisions[0]?.track_id === "t-review", "Track template did not create a Track decision");
  trackTemplate.summary = "The Review Loop Track produced a working reflection path.";
  trackTemplate.findings = ["Track scope stayed stable across both focus blocks."];
  trackTemplate.decisions = [
    {
      track_id: "t-review",
      subject: "Review Loop",
      decision: "continue",
      note: "Keep the Track active for the next review period.",
    },
    {
      track_id: "t-review",
      subject: "Review Loop",
      decision: "protect-next-focus",
      note: "Protect the next substantive review block.",
    },
  ];
  await writeFile(trackTemplatePath, `${JSON.stringify(trackTemplate, null, 2)}\n`, "utf8");
  const savedTrack = JSON.parse((await execFileAsync(
    "node",
    [join(repoRoot, "scripts/reflection-session.mjs"), "save", "--db", dbPath, "--input", trackTemplatePath, "--now", "2026-07-01T10:00:00+03:00"],
    { cwd: repoRoot }
  )).stdout);
  assert(savedTrack.decisions[0].track_id === "t-review", "Track decision was lost while saving");

  await runSql(`
    INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
    VALUES ('we-followup', '2026-07-02T09:34:00+03:00', 'w1', 'note_added', '{"text":"The protected review flow now produces repeatable reports"}');
    INSERT INTO work_item_event_semantic_snapshots
      (work_item_event_id, track_id, track_path_json, labels_json, captured_at)
    VALUES ('we-followup', 't-review', '[{"id":"t-review","title":"Review Loop"}]', '[]', '2026-07-02T09:34:00+03:00');
    INSERT INTO evidence_entries (work_item_event_id, evidence_kind, focus_session_id, captured_at)
    VALUES ('we-followup', 'result', 's2', '2026-07-02T09:34:00+03:00');
    INSERT INTO refs (id, kind, value, normalized_value, created_at)
    VALUES ('ref-followup', 'file_path', '/tmp/repeatable-review.md', '/tmp/repeatable-review.md', '2026-07-02T09:34:00+03:00');
    INSERT INTO work_item_refs (work_item_id, ref_id, is_primary, created_at)
    VALUES ('w1', 'ref-followup', 1, '2026-07-02T09:34:00+03:00');
    INSERT INTO evidence_ref_snapshots (id, work_item_event_id, ref_id, ref_kind, ref_value, captured_at)
    VALUES ('ers-followup', 'we-followup', 'ref-followup', 'file_path', '/tmp/repeatable-review.md', '2026-07-02T09:34:00+03:00');
  `);

  const repeatedTrack = JSON.parse(await runReport([
    "--profile", "track-retrospective",
    "--track", "t-review",
    "--format", "json",
  ]));
  assert(repeatedTrack.decisions.selected_period.length === 1, "Filtered Track report did not load its Reflection Session");
  assert(repeatedTrack.decisions.selected_period[0].decisions[0].track_id === "t-review", "Repeated Track report lost Track decision scope");
  const followupCandidate = repeatedTrack.evidence_story.decision_followups.find(
    (item) => item.prior_decision_id === savedTrack.decisions[0].id,
  );
  assert(followupCandidate?.status === "needs_review", "Later evidence did not create a decision follow-up candidate");
  assert(followupCandidate.candidate_evidence_event_ids.includes("we-followup"), "Decision follow-up candidate lost later evidence");

  const followupTemplatePath = join(tempDir, "track-followup.json");
  await runReport([
    "--profile", "track-retrospective",
    "--track", "t-review",
    "--reflection-template", followupTemplatePath,
  ]);
  const followupTemplate = JSON.parse(await readFile(followupTemplatePath, "utf8"));
  const templateFollowupIds = new Set(followupTemplate.decision_followups.map((item) => item.prior_decision_id));
  assert(
    savedTrack.decisions.every((decision) => templateFollowupIds.has(decision.id)),
    "Follow-up template lost a prior decision",
  );
  followupTemplate.summary = "The earlier Track decision was checked against a captured result.";
  followupTemplate.findings = ["The protected focus produced a repeatable report path."];
  followupTemplate.decisions = [{
    track_id: "t-review",
    subject: "Review Loop",
    decision: "continue",
    note: "Continue with evidence-backed review.",
  }];
  followupTemplate.decision_followups = savedTrack.decisions.map((decision) => ({
    prior_decision_id: decision.id,
    status: "progressed",
    note: "A captured result appeared after the decision.",
    evidence_event_id: "we-followup",
  }));
  await writeFile(followupTemplatePath, `${JSON.stringify(followupTemplate, null, 2)}\n`, "utf8");
  const savedFollowup = JSON.parse((await execFileAsync(
    "node",
    [join(repoRoot, "scripts/reflection-session.mjs"), "save", "--db", dbPath, "--input", followupTemplatePath, "--now", "2026-07-02T12:00:00+03:00"],
    { cwd: repoRoot }
  )).stdout);
  assert(savedFollowup.decision_followups[0].status === "progressed", "Explicit decision follow-up was not saved");

  const checkedTrack = JSON.parse(await runReport([
    "--profile", "track-retrospective",
    "--track", "t-review",
    "--format", "json",
  ]));
  const checkedFollowup = checkedTrack.evidence_story.decision_followups.find(
    (item) => item.prior_decision_id === savedTrack.decisions[0].id,
  );
  assert(checkedFollowup?.status === "progressed", "Repeated report did not load the explicit follow-up status");
  assert(checkedFollowup?.evidence_event_id === "we-followup", "Repeated report lost follow-up evidence link");
  const trackList = (await execFileAsync(
    "node",
    [join(repoRoot, "scripts/reflection-session.mjs"), "list", "--db", dbPath, "--profile", "track-retrospective"],
    { cwd: repoRoot }
  )).stdout;
  assert(trackList.includes("Track: Review Loop"), "Reflection list did not render Track scope");
  assert(trackList.includes("Продвинуто") && trackList.includes("we-followup"), "Reflection list did not render decision follow-up evidence");

  const gate = JSON.parse((await execFileAsync(
    "node",
    [
      join(repoRoot, "scripts/evidence-story-gate.mjs"),
      "--db", dbPath,
      "--from", "2026-07-01",
      "--to", "2026-07-03",
      "--track", "t-review",
      "--format", "json",
    ],
    { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 }
  )).stdout);
  assert(gate.ok, "Evidence-story acceptance gate did not pass on the complete fixture");
  assert(gate.captured_blocks === 3, "Evidence-story gate lost captured focus blocks");
  assert(gate.confirmed_changes.length === 1, "Evidence-story gate lost the confirmed result");
  assert(gate.decision_followups.length === 2, "Evidence-story gate lost explicit decision follow-ups");

  template.decisions[0].decision = "wishful-thinking";
  await writeFile(templatePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
  await expectFailure(
    ["save", "--db", dbPath, "--input", templatePath],
    "decision неизвестно"
  );

  console.log(JSON.stringify({ ok: true, profiles, saved_reflection_id: saved.id }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function runReport(extraArgs = []) {
  const { stdout } = await execFileAsync(
    "node",
    [
      join(repoRoot, "scripts/report-period.mjs"),
      "--db", dbPath,
      "--from", "2026-07-01",
      "--to", "2026-07-03",
      "--now", "2026-07-03T12:00:00+03:00",
      ...extraArgs,
    ],
    { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 }
  );
  return stdout;
}

async function expectFailure(args, expected) {
  try {
    await execFileAsync("node", [join(repoRoot, "scripts/reflection-session.mjs"), ...args], { cwd: repoRoot });
    throw new Error(`Expected failure containing: ${expected}`);
  } catch (error) {
    assert(String(error?.stderr ?? "").includes(expected), `Failure did not contain ${expected}: ${error?.stderr ?? error}`);
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
