#!/usr/bin/env node

const apiUrl = process.env.TIMESKEIN_API_URL || process.env.API_URL || "http://127.0.0.1:3456/api";
const apiVersion = "1.0";

async function rpc(method, params = {}) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: apiVersion,
      request_id: crypto.randomUUID(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${apiUrl}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
  }

  return data.result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const before = await rpc("focus.current");
if (before.session) {
  await rpc("focus.stop", {
    note: "stopped by day-events smoke",
  });
}

const focus = await rpc("focus.start", {
  title: `Smoke day event focus ${new Date().toISOString()}`,
  target_seconds: 60,
});

const linked = await rpc("day_event.add", {
  text: `Smoke day event linked ${new Date().toISOString()}`,
  focus_session_id: focus.id,
  activity_zone: "work",
});

assert(linked.id, "day_event.add did not return an id");
assert(linked.kind === "note_added", "day_event.add did not create a note_added event");
assert(linked.focus_session_id === focus.id, "day_event.add did not preserve focus_session_id");
assert(linked.activity_zone === "work", "day_event.add did not preserve activity zone");

const currentAfterAdd = await rpc("focus.current");
assert(
  currentAfterAdd.session?.id === focus.id,
  "day_event.add interrupted the current focus session"
);

const free = await rpc("day_event.add", {
  text: `Smoke day event free ${new Date().toISOString()}`,
  activity_zone: "recovery",
});
assert(!free.focus_session_id, "free day event should not be linked to focus");
assert(free.activity_zone === "recovery", "free day event did not keep recovery zone");

const listed = await rpc("day_event.list", {
  from: new Date(Date.now() - 60_000).toISOString(),
  to: new Date(Date.now() + 60_000).toISOString(),
});
assert(
  listed.events.some((event) => event.id === linked.id),
  "day_event.list did not include linked event"
);
assert(
  listed.events.some((event) => event.id === free.id),
  "day_event.list did not include free event"
);

const updated = await rpc("day_event.update", {
  id: linked.id,
  text: "Smoke day event edited",
  activity_zone: "coordination",
});
assert(updated.text === "Smoke day event edited", "day_event.update did not update text");
assert(updated.activity_zone === "coordination", "day_event.update did not update zone");

const clearedZone = await rpc("day_event.update", {
  id: linked.id,
  text: "Smoke day event zone cleared",
  activity_zone: null,
});
assert(clearedZone.activity_zone === undefined, "day_event.update did not clear zone");

const deleted = await rpc("day_event.delete", {
  id: free.id,
});
assert(deleted.success === true, "day_event.delete did not report success");

const afterDelete = await rpc("day_event.list", {
  from: new Date(Date.now() - 60_000).toISOString(),
  to: new Date(Date.now() + 60_000).toISOString(),
});
assert(
  !afterDelete.events.some((event) => event.id === free.id),
  "day_event.delete did not remove event"
);

let emptyTextFailed = false;
try {
  await rpc("day_event.add", {
    text: "   ",
  });
} catch {
  emptyTextFailed = true;
}
assert(emptyTextFailed, "day_event.add accepted empty text");

await rpc("focus.stop", {
  note: "day-events smoke done",
});

console.log(
  JSON.stringify(
    {
      ok: true,
      api_url: apiUrl,
      linked_day_event_id: linked.id,
      updated_day_event_id: updated.id,
    },
    null,
    2
  )
);
