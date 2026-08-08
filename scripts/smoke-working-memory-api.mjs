#!/usr/bin/env node

const apiUrl = process.env.TIMESKEIN_API_URL || process.env.API_URL || "http://127.0.0.1:3456/api";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const localDate = new Date().toISOString().slice(0, 10);

const track = await rpc("track.create", { title: `Working memory track ${suffix}` });
const label = await rpc("label.create", { title: `working-memory-${suffix}` });
const canonical = await rpc("work_item.create", {
  title: `Long work ${suffix}`,
  type: "project",
  track_id: track.id,
  label_ids: [label.id],
});
const companion = await rpc("work_item.create", { title: `Companion ${suffix}`, type: "task" });
const overflow = await rpc("work_item.create", { title: `Overflow ${suffix}`, type: "task" });
const duplicate = await rpc("work_item.create", {
  title: `Long work duplicate ${suffix}`,
  type: "project",
  track_id: track.id,
  label_ids: [label.id],
});

const contract = await rpc("day_contract.revise", {
  local_date: localDate,
  revision_kind: "morning",
  active_subjects: [
    {
      kind: "work_item",
      subject_id: canonical.id,
      daily_outcome: "Get one verified signal and preserve the next action",
    },
    { kind: "work_item", subject_id: companion.id, daily_outcome: "Keep the companion bounded" },
  ],
  first_action_work_item_id: canonical.id,
  parked_subjects: [],
  overflow_subjects: [{ kind: "work_item", subject_id: overflow.id }],
  why_now: "A long-lived Work Item needs a reproducible return path",
});
assert(contract.revision.active_subjects[0].daily_outcome, "daily outcome was not preserved");
assert(contract.revision.overflow_subjects.length === 1, "day-contract overflow was not preserved");

const discovery = await rpc("work_item_stage.create", {
  work_item_id: canonical.id,
  title: "Discovery",
  activate: true,
});
const firstStart = await rpc("focus.start", {
  work_item_id: canonical.id,
  title: `Long work ${suffix}`,
  stage_id: discovery.id,
  activity_zone: "work",
});
assert(firstStart.work_context?.stage_title === "Discovery", "focus did not snapshot the active stage");
assert(
  firstStart.work_context?.daily_outcome === "Get one verified signal and preserve the next action",
  "focus did not snapshot the daily outcome",
);
const duringFocus = await rpc("working_memory.create", {
  subject_kind: "work_item",
  subject_id: canonical.id,
  kind: "observation",
  text: "The active block exposed one boundary worth preserving",
  focus_session_id: firstStart.id,
  stage_id: discovery.id,
  local_date: localDate,
});
assert(
  duringFocus.focus_session_id === firstStart.id,
  "working-memory entry created during focus lost its Focus Session link",
);
assert(
  duringFocus.stage_id === discovery.id && duringFocus.stage_title === "Discovery",
  "working-memory entry created during focus lost its stage snapshot",
);
await rpc("focus.stop", {
  id: firstStart.id,
  result: "Verified the first boundary",
  state_change: "The unknown boundary is now explicit",
  next_action: "Open the implementation and test the narrow path",
});

await rpc("work_item_stage.update", {
  id: discovery.id,
  title: "Discovery complete",
  state: "completed",
});
const delivery = await rpc("work_item_stage.create", {
  work_item_id: canonical.id,
  title: "Delivery",
  activate: true,
});
const secondStart = await rpc("focus.start", {
  work_item_id: canonical.id,
  title: `Long work ${suffix}`,
  stage_id: delivery.id,
  activity_zone: "work",
});
assert(secondStart.work_context?.stage_title === "Delivery", "second focus did not snapshot the new stage");
await rpc("focus.stop", {
  id: secondStart.id,
  result: "Implemented the narrow path",
  state_change: "The path is executable",
  next_action: "Run the acceptance scenario after a pause",
});

const thought = await rpc("working_memory.create", {
  subject_kind: "work_item",
  subject_id: canonical.id,
  kind: "thought",
  text: "The return surface must explain why this is the next step",
  local_date: localDate,
});
await delay(2);
const beforeThoughtEdit = new Date().toISOString();
await delay(2);
const edited = await rpc("working_memory.update", {
  id: thought.id,
  kind: "decision",
  text: "The return surface must show state change and the next physical action",
  change_note: "Turned the thought into a decision",
});
assert(edited.revisions.length === 2, "working-memory revision history was not preserved");

const material = await rpc("working_memory.create", {
  subject_kind: "work_item",
  subject_id: canonical.id,
  kind: "material",
  material_kind: "url",
  material_value: "https://example.invalid/working-memory",
  local_date: localDate,
});
assert(material.current_revision.material_value, "material value was not preserved");

const temporary = await rpc("working_memory.create", {
  subject_kind: "work_item",
  subject_id: canonical.id,
  kind: "observation",
  text: "Temporary observation",
  local_date: localDate,
});
const deleted = await rpc("working_memory.delete", { id: temporary.id, reason: "Superseded" });
assert(deleted.deleted_at, "working-memory tombstone was not created");
assert(deleted.revisions.at(-1)?.text === "Temporary observation", "tombstone lost the previous content");
const allMemory = await rpc("working_memory.list", {
  subject_kind: "work_item",
  subject_id: canonical.id,
  include_deleted: true,
});
assert(allMemory.entries.some((entry) => entry.id === temporary.id && entry.deleted_at), "deleted entry is not auditable");

const historicalPack = await rpc("context_pack.build", {
  profile: "work-item-reentry",
  scope_id: canonical.id,
  as_of: beforeThoughtEdit,
  format: "json",
});
const historicalThought = historicalPack.pack.facts.memory.find((entry) => entry.id === thought.id);
assert(historicalThought?.current_revision.text === "The return surface must explain why this is the next step",
  "Context Pack leaked a later working-memory revision into as_of");
assert(historicalThought?.revisions.length === 1, "Context Pack leaked future revision history into as_of");

const workItemPackA = await rpc("context_pack.build", {
  profile: "work-item-reentry",
  scope_id: canonical.id,
  as_of: "2199-01-01T00:00:00.000Z",
  format: "both",
});
const workItemPackB = await rpc("context_pack.build", {
  profile: "work-item-reentry",
  scope_id: canonical.id,
  as_of: "2199-01-01T00:00:00.000Z",
  format: "both",
});
assert(workItemPackA.markdown === workItemPackB.markdown, "Context Pack markdown is not deterministic");
assert(
  JSON.stringify(workItemPackA.pack) === JSON.stringify(workItemPackB.pack),
  "Context Pack JSON is not deterministic",
);
assert(workItemPackA.pack.facts.stages.length === 2, "Context Pack did not include both stages");
assert(workItemPackA.pack.facts.materials.length === 1, "Context Pack did not include the material");
assert(workItemPackA.pack.facts.next_actions.length >= 2, "Context Pack did not include next actions");
assert(workItemPackA.markdown.includes("Run the acceptance scenario after a pause"), "markdown lost the next action");
for (const stageTitle of ["Discovery", "Delivery"]) {
  const stage = workItemPackA.pack.facts.focus.by_stage.find((entry) => entry.title === stageTitle);
  assert(stage?.entrances === 1, `Context Pack lost focus totals for ${stageTitle}`);
}
for (const [result, stageTitle] of [
  ["Verified the first boundary", "Discovery"],
  ["Implemented the narrow path", "Delivery"],
]) {
  const entry = workItemPackA.pack.facts.memory.find(
    (candidate) => candidate.current_revision.text === result,
  );
  assert(entry?.stage_title === stageTitle, `Context Pack lost the ${stageTitle} result snapshot`);
}

const trackPack = await rpc("context_pack.build", {
  profile: "track-reentry",
  scope_id: track.id,
  as_of: "2199-01-01T00:00:00.000Z",
  format: "both",
});
assert(trackPack.pack.scope.kind === "track", "Track Context Pack has the wrong scope");
assert(trackPack.pack.facts.work_items.some((item) => item.id === canonical.id), "Track Context Pack lost its Work Item");

await rpc("working_memory.create", {
  subject_kind: "work_item",
  subject_id: duplicate.id,
  kind: "question",
  text: "Will duplicate history survive the merge?",
  local_date: localDate,
});
const alias = await rpc("work_item.merge", {
  source_id: duplicate.id,
  canonical_id: canonical.id,
  reason: "Duplicate created for merge acceptance",
});
assert(alias.canonical_work_item_id === canonical.id, "merge returned the wrong canonical Work Item");
const resolved = await rpc("work_item.resolve", { id: duplicate.id });
assert(resolved.canonical_id === canonical.id, "old Work Item ID did not resolve to the canonical item");
const mergedMemory = await rpc("working_memory.list", {
  subject_kind: "work_item",
  subject_id: canonical.id,
  include_deleted: true,
});
assert(
  mergedMemory.entries.some((entry) => entry.current_revision.text === "Will duplicate history survive the merge?"),
  "merge lost duplicate working-memory history",
);

await rpc("app_event.log", {
  source: "script",
  kind: "context_pack_exported",
  work_item_id: canonical.id,
  payload: { profile: "work-item-reentry", format: "both" },
});

console.log(JSON.stringify({
  ok: true,
  api_url: apiUrl,
  work_item_id: canonical.id,
  track_id: track.id,
  stages: 2,
  memory_entries: mergedMemory.total,
}, null, 2));

async function rpc(method, params = {}) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: "1.0", request_id: crypto.randomUUID(), method, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
  return data.result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
