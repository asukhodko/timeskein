#!/usr/bin/env node

const apiUrl = process.env.TIMESKEIN_API_URL || process.env.API_URL || "http://127.0.0.1:3456/api";

async function rpcRaw(method, params = {}) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "1.0",
      request_id: crypto.randomUUID(),
      method,
      params,
    }),
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

const suffix = new Date().toISOString();
const root = await rpc("track.create", { title: `Operational root ${suffix}` });
const track = await rpc("track.create", {
  title: `Operational Timeskein ${suffix}`,
  parent_track_id: root.id,
});
const label = await rpc("label.create", { title: `causal-smoke-${suffix}` });
const created = await rpc("work_item.create", {
  title: `Operational Reality smoke ${suffix}`,
  type: "project",
  track_id: track.id,
  label_ids: [label.id],
});
await rpc("operational_reality.set_state", {
  subject_kind: "track",
  subject_id: track.id,
  state: "waiting",
  reason: "Track waits for its smoke proof",
});
await rpc("operational_reality.set_next_action", {
  subject_kind: "track",
  subject_id: track.id,
  action: "set",
  text: "Complete the Operational Reality smoke",
});

const initial = await rpc("operational_reality.list");
const initialItem = initial.items.find((item) => item.work_item_id === created.id);
assert(initialItem?.state_provenance === "legacy_current", "unconfirmed legacy state must be explicit");
assert(initialItem?.requires_attention === false, "ordinary legacy item polluted the decision queue");
const initialTrack = initial.items.find((item) => item.subject_kind === "track" && item.subject_id === track.id);
assert(initialTrack?.state === "waiting", "Track state is missing from Operational Reality");
assert(
  initialTrack?.next_action?.text === "Complete the Operational Reality smoke",
  "Track next action is missing from Operational Reality"
);

const now = Date.now();
const assertedAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
const correctedAt = new Date(now - 60 * 60 * 1000).toISOString();
const historicalAsOf = new Date(now - 90 * 60 * 1000).toISOString();
const asserted = await rpc("operational_reality.set_state", {
  subject_kind: "work_item",
  subject_id: created.id,
  state: "waiting",
  reason: "Waiting for the smoke gate",
  occurred_at: assertedAt,
});
await rpc("operational_reality.set_next_action", {
  subject_kind: "work_item",
  subject_id: created.id,
  action: "set",
  text: "Run the smoke gate",
  occurred_at: new Date(now - 110 * 60 * 1000).toISOString(),
});
const resultEvent = await rpc("work_item.add_event", {
  id: created.id,
  text: "The Track-level causal story is visible",
  evidence_kind: "result",
  new_ref: { kind: "issue_key", value: `OR-TRACK-${Date.now()}` },
});
await rpc("work_item.set_semantics", { id: created.id, track_id: root.id, label_ids: [] });

const rejected = await rpcRaw("operational_reality.set_state", {
  subject_kind: "work_item",
  subject_id: created.id,
  state: "blocked",
  occurred_at: correctedAt,
});
assert(rejected.error?.code === "validation_error", "state correction without a reason must be rejected");

const corrected = await rpc("operational_reality.set_state", {
  subject_kind: "work_item",
  subject_id: created.id,
  state: "blocked",
  reason: "The smoke gate found a blocker",
  occurred_at: correctedAt,
});
assert(corrected.record.kind === "correction", "state change must be an explicit correction");
assert(corrected.record.supersedes_id === asserted.record.id, "correction must supersede the prior state record");

const historical = await rpc("operational_reality.list", { as_of: historicalAsOf });
const historicalItem = historical.items.find((item) => item.work_item_id === created.id);
assert(historicalItem?.state === "waiting", "later correction rewrote the historical state");
assert(historicalItem?.next_action?.text === "Run the smoke gate", "historical next action is missing");

const records = await rpc("causal_record.list", {
  subject_kind: "work_item",
  subject_id: created.id,
});
const nextAction = records.records.find((record) => record.kind === "next_action");
assert(nextAction?.track_snapshot.at(-1)?.id === track.id, "causal Track snapshot was rewritten");
assert(nextAction?.labels_snapshot.some((candidate) => candidate.id === label.id), "causal Label snapshot was rewritten");
const resultRecord = records.records.find((record) => record.evidence_event_id === resultEvent.id);
assert(resultRecord?.track_id === track.id, "result causal record lost its historical Track link");

const current = await rpc("operational_reality.list");
const currentItem = current.items.find((item) => item.work_item_id === created.id);
assert(currentItem?.state === "blocked", "current corrected state is missing");
assert(currentItem?.state_confirmed === true, "corrected state must be user-confirmed");
assert(currentItem?.next_action?.text === "Run the smoke gate", "current next action is missing");
for (const expectedTrackId of [track.id, root.id]) {
  const relatedTrack = current.items.find((item) =>
    item.subject_kind === "track" && item.subject_id === expectedTrackId
  );
  const relatedResult = relatedTrack?.facts.find((fact) =>
    fact.summary === "The Track-level causal story is visible"
  );
  assert(relatedResult, `related result is missing from Track ${expectedTrackId}`);
  assert(relatedResult.refs[0]?.value === resultEvent.evidence.refs[0].value, "Track result lost its Ref snapshot");
  if (expectedTrackId === root.id) {
    assert(relatedTrack.requires_attention === false, "parent Track history polluted the decision queue");
  }
}

await rpc("operational_reality.set_next_action", {
  subject_kind: "work_item",
  subject_id: created.id,
  action: "complete",
});
const afterCompletion = await rpc("operational_reality.list");
assert(
  !afterCompletion.items.find((item) => item.work_item_id === created.id)?.next_action,
  "completed next action remains active"
);

JSON.stringify(current);
console.log(JSON.stringify({
  ok: true,
  api_url: apiUrl,
  work_item_id: created.id,
  causal_records: records.total,
}, null, 2));
