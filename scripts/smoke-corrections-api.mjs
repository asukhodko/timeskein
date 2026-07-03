#!/usr/bin/env node

const apiUrl = process.env.TIMESKEIN_API_URL || process.env.API_URL || "http://127.0.0.1:3456/api";
const apiVersion = "1.0";

async function rpc(method, params = {}) {
  const requestId = crypto.randomUUID();
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: apiVersion,
      request_id: requestId,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${apiUrl}`);
  }

  const data = await response.json();
  if (data.error) {
    const error = new Error(`${method}: ${data.error.code}: ${data.error.message}`);
    error.code = data.error.code;
    throw error;
  }

  return data.result;
}

function todayWindow() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);

  const to = new Date(from);
  to.setDate(to.getDate() + 1);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const before = await rpc("focus.current");
if (before.session) {
  throw new Error(
    `Refusing to run correction smoke: active focus session already exists (${before.session.title})`
  );
}

const seed = new Date().toISOString();
const title = `Smoke correction ${seed}`;
const started = await rpc("focus.start", {
  title,
  target_seconds: 60,
});

await new Promise((resolve) => setTimeout(resolve, 1100));

const stopped = await rpc("focus.stop", {
  note: "original correction smoke note",
});
assert(stopped.id === started.id, "focus.stop returned a different correction smoke session");

const end = new Date(stopped.stopped_at);
const start = new Date(end.getTime() - 60_000);
const splitAt = new Date(start.getTime() + 30_000);
const correctedTitle = `${title} corrected`;
const updated = await rpc("focus.update", {
  id: stopped.id,
  title: correctedTitle,
  started_at: start.toISOString(),
  stopped_at: end.toISOString(),
  note: "corrected whole block",
});

assert(updated.state === "stopped", "focus.update changed stopped session state");
assert(updated.work_item_id, "focus.update with title did not link a work item");
assert(updated.work_item_title === correctedTitle, "focus.update did not assign the corrected work item");
assert(updated.note === "corrected whole block", "focus.update did not update note");
assert(updated.active_seconds >= 59, "focus.update did not update duration");

const rightTitle = `${title} right`;
const split = await rpc("focus.split", {
  id: updated.id,
  split_at: splitAt.toISOString(),
  right_title: rightTitle,
  right_note: "right block note",
});

assert(split.left.id === updated.id, "focus.split did not keep the original id on the left block");
assert(split.right.id !== split.left.id, "focus.split did not create a new right block");
assert(split.right.work_item_title === rightTitle, "focus.split did not assign the right work item");
assert(split.right.note === "right block note", "focus.split did not set right block note");
assert(split.left.active_seconds >= 29, "focus.split left block duration is too small");
assert(split.right.active_seconds >= 29, "focus.split right block duration is too small");

const editedRightTitle = `${rightTitle} edited`;
const editedItem = await rpc("work_item.update", {
  id: split.right.work_item_id,
  title: editedRightTitle,
  type: "project",
  note: "edited item note",
});

assert(editedItem.title === editedRightTitle, "work_item.update did not update title");
assert(editedItem.type === "project", "work_item.update did not update type");
assert(editedItem.note === "edited item note", "work_item.update did not update note");

const eventWindowStart = new Date(Date.now() - 60_000).toISOString();
const event = await rpc("work_item.add_event", {
  id: editedItem.id,
  text: "timestamped correction smoke event",
  focus_session_id: split.right.id,
});
assert(event.kind === "note_added", "work_item.add_event did not create a note_added event");
assert(event.text === "timestamped correction smoke event", "work_item.add_event did not return event text");
assert(event.focus_session_id === split.right.id, "work_item.add_event did not keep focus_session_id");

const events = await rpc("work_item.events", {
  id: editedItem.id,
  from: eventWindowStart,
  to: new Date(Date.now() + 60_000).toISOString(),
});
assert(events.total === 1, "work_item.events did not return the timestamped event");
assert(
  events.events[0].text === "timestamped correction smoke event",
  "work_item.events returned wrong event text"
);

const updatedEvent = await rpc("work_item.update_event", {
  id: event.id,
  text: "edited timestamped correction smoke event",
});
assert(updatedEvent.text === "edited timestamped correction smoke event", "work_item.update_event did not edit event text");

const deletedEvent = await rpc("work_item.delete_event", {
  id: event.id,
});
assert(deletedEvent.success === true, "work_item.delete_event did not report success");

const eventsAfterDelete = await rpc("work_item.events", {
  id: editedItem.id,
  from: eventWindowStart,
  to: new Date(Date.now() + 60_000).toISOString(),
});
assert(eventsAfterDelete.total === 0, "work_item.delete_event left deleted event visible");

const duplicate = await rpc("work_item.create", {
  title: `${title} duplicate`,
  type: "task",
});

let duplicateRejected = false;
try {
  await rpc("work_item.update", {
    id: editedItem.id,
    title: `${title} duplicate`,
  });
} catch (error) {
  duplicateRejected = error.code === "validation_error";
}
assert(duplicate.id, "work_item.create did not create duplicate smoke item");
assert(duplicateRejected, "work_item.update allowed a duplicate title");

const day = await rpc("focus.list", todayWindow());
const leftFound = day.sessions.find((session) => session.id === split.left.id);
const rightFound = day.sessions.find((session) => session.id === split.right.id);
assert(leftFound, "focus.list did not include corrected left block");
assert(rightFound, "focus.list did not include split right block");
assert(rightFound.work_item_title === editedRightTitle, "focus.list did not reflect edited Work Item title");

console.log(
  JSON.stringify(
    {
      ok: true,
      corrected_session_id: split.left.id,
      split_session_id: split.right.id,
      edited_work_item_id: editedItem.id,
    },
    null,
    2
  )
);
