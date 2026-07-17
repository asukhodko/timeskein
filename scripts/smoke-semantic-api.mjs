#!/usr/bin/env node

const apiUrl = process.env.TIMESKEIN_API_URL || process.env.API_URL || "http://127.0.0.1:3456/api";

async function rpc(method, params = {}) {
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
  const data = await response.json();
  if (data.error) throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
  return data.result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const suffix = new Date().toISOString();
const root = await rpc("track.create", { title: `Smoke root ${suffix}` });
const child = await rpc("track.create", {
  title: `Smoke child ${suffix}`,
  parent_track_id: root.id,
});
const label = await rpc("label.create", { title: `smoke-label-${suffix}` });
assert(child.path.map((node) => node.id).join(",") === `${root.id},${child.id}`, "Track hierarchy path is incorrect");

const item = await rpc("work_item.create", {
  title: `Smoke semantic item ${suffix}`,
  type: "task",
  track_id: child.id,
  label_ids: [label.id],
});
const inventory = await rpc("inventory.list");
const classified = inventory.items.find((candidate) => candidate.id === item.id);
assert(classified?.track?.id === child.id, "Work Item Track assignment is missing");
assert(classified?.labels?.some((candidate) => candidate.id === label.id), "Work Item Label assignment is missing");

const renamed = await rpc("track.update", {
  id: child.id,
  title: `Smoke child renamed ${suffix}`,
  parent_track_id: root.id,
});
assert(renamed.title.includes("renamed"), "Track rename failed");
const relabeled = await rpc("label.update", { id: label.id, title: `smoke-renamed-${suffix}` });
assert(relabeled.title.includes("renamed"), "Label rename failed");

await rpc("work_item.set_semantics", { id: item.id, track_id: root.id, label_ids: [] });
const reassigned = await rpc("inventory.get", { id: item.id });
assert(reassigned.track?.id === root.id, "Work Item Track reassignment failed");
assert((reassigned.labels ?? []).length === 0, "Work Item Label removal failed");

const archivedTrack = await rpc("track.archive", { id: child.id, archived: true });
const archivedLabel = await rpc("label.archive", { id: label.id, archived: true });
assert(archivedTrack.archived && archivedLabel.archived, "Taxonomy archive failed");
const activeTaxonomy = await rpc("taxonomy.list", { include_archived: false });
assert(!activeTaxonomy.tracks.some((candidate) => candidate.id === child.id), "Archived Track leaked into active taxonomy");
assert(!activeTaxonomy.labels.some((candidate) => candidate.id === label.id), "Archived Label leaked into active taxonomy");

console.log(JSON.stringify({ ok: true, api_url: apiUrl, track_id: root.id, work_item_id: item.id }, null, 2));
