#!/usr/bin/env node

const apiUrl = process.env.TIMESKEIN_API_URL || process.env.API_URL || "http://127.0.0.1:3456/api";

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

const suffix = new Date().toISOString();
const track = await rpc("track.create", { title: `Evidence Track ${suffix}` });
const item = await rpc("work_item.create", {
  title: `Evidence item ${suffix}`,
  type: "project",
  state: "active",
  track_id: track.id,
});
const event = await rpc("work_item.add_event", {
  id: item.id,
  text: "The semantic evidence flow reached a testable state",
  focus_session_id: item.focus_session_id,
  evidence_kind: "result",
  new_ref: { kind: "issue_key", value: `EVIDENCE-${Date.now()}` },
});

assert(event.evidence?.kind === "result", "Typed evidence kind is missing");
assert(event.evidence?.provenance === "captured", "Evidence provenance is missing");
assert(event.evidence?.refs.length === 1, "New Ref was not captured with the evidence entry");
assert(event.evidence.refs[0].provenance === "captured", "Ref snapshot provenance is missing");
const current = await rpc("focus.current", {});
assert(current.session?.id === item.focus_session_id, "Recording evidence stopped or switched the active timer");

const listed = await rpc("work_item.events", { id: item.id });
const listedEvent = listed.events.find((candidate) => candidate.id === event.id);
assert(listedEvent?.evidence?.refs[0]?.value === event.evidence.refs[0].value, "Evidence Ref snapshot was not read back");

await rpc("focus.stop", {});

console.log(JSON.stringify({ ok: true, api_url: apiUrl, work_item_id: item.id, event_id: event.id }, null, 2));
