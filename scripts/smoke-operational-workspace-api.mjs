#!/usr/bin/env node

const apiUrl = process.env.TIMESKEIN_API_URL || process.env.API_URL || "http://127.0.0.1:3456/api";

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const localDate = "2099-01-17";
const track = await rpc("track.create", { title: `Workspace track ${suffix}` });
const first = await rpc("work_item.create", {
  title: `Workspace first ${suffix}`,
  type: "task",
  track_id: track.id,
});
const second = await rpc("work_item.create", { title: `Workspace second ${suffix}`, type: "task" });
const parked = await rpc("work_item.create", { title: `Workspace parked ${suffix}`, type: "task" });
const outside = await rpc("work_item.create", { title: `Workspace outside ${suffix}`, type: "task" });

const before = await rpc("operational_workspace.get", { local_date: localDate });
assert(before.current_contract == null, "new day unexpectedly contains a contract");

const invalid = await rpcRaw("day_contract.revise", {
  local_date: localDate,
  revision_kind: "morning",
  active_subjects: [
    { kind: "track", subject_id: track.id },
    { kind: "work_item", subject_id: second.id },
  ],
  first_action_work_item_id: outside.id,
  parked_subjects: [{ kind: "work_item", subject_id: parked.id }],
  why_now: "Must reject an action outside the active scope",
});
assert(invalid.error?.code === "validation_error", "out-of-scope first action was accepted");

const morning = await rpc("day_contract.revise", {
  local_date: localDate,
  revision_kind: "morning",
  active_subjects: [
    { kind: "track", subject_id: track.id },
    { kind: "work_item", subject_id: second.id },
  ],
  first_action_work_item_id: first.id,
  parked_subjects: [{ kind: "work_item", subject_id: parked.id }],
  why_now: "The first action provides the nearest useful signal",
});
assert(morning.revision.revision_number === 1, "morning revision number is not 1");
assert(morning.workspace.current_contract?.id === morning.revision.id, "workspace did not expose the current contract");
assert(morning.revision.active_subjects.length === 2, "active subject snapshot is incomplete");

const originalFirstTitle = morning.revision.first_action.title;
await rpc("work_item.update", { id: first.id, title: `${originalFirstTitle} renamed` });
const adjustment = await rpc("day_contract.revise", {
  local_date: localDate,
  revision_kind: "adjustment",
  active_subjects: [
    { kind: "work_item", subject_id: first.id },
    { kind: "work_item", subject_id: second.id },
  ],
  first_action_work_item_id: second.id,
  parked_subjects: [{ kind: "work_item", subject_id: parked.id }],
  why_now: "New evidence changed the first action without rewriting the morning",
});
assert(adjustment.revision.revision_number === 2, "adjustment revision number is not 2");
assert(adjustment.revision.supersedes_id === morning.revision.id, "revision chain is broken");

const history = await rpc("day_contract.list", { from: localDate, to: "2099-01-18" });
assert(history.total === 2, "day-contract history is incomplete");
assert(history.revisions[0].first_action.title === originalFirstTitle, "current Work Item title rewrote the morning snapshot");
assert(history.revisions[1].first_action.subject_id === second.id, "current revision first action is wrong");

const current = await rpc("operational_workspace.get", { local_date: localDate });
assert(current.revisions.length === 2, "workspace revision history is incomplete");
assert(current.current_contract?.id === adjustment.revision.id, "workspace current contract is stale");

console.log(JSON.stringify({
  ok: true,
  api_url: apiUrl,
  local_date: localDate,
  revisions: history.total,
}, null, 2));

async function rpcRaw(method, params = {}) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: "1.0", request_id: crypto.randomUUID(), method, params }),
  });
  return response.json();
}

async function rpc(method, params = {}) {
  const data = await rpcRaw(method, params);
  if (data.error) throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
  return data.result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
