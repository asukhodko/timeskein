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
    note: "stopped by capture smoke",
  });
}

const focus = await rpc("focus.start", {
  title: `Smoke capture focus ${new Date().toISOString()}`,
  target_seconds: 60,
});

const capture = await rpc("capture.create", {
  text: `Smoke incoming ${new Date().toISOString()}`,
});

assert(capture.id, "capture.create did not return an id");
assert(capture.state === "open", "capture.create did not create an open capture");
assert(capture.focus_session_id === focus.id, "capture.create did not link to active focus");

const currentAfterCapture = await rpc("focus.current");
assert(
  currentAfterCapture.session?.id === focus.id,
  "capture.create interrupted the current focus session"
);

const openList = await rpc("capture.list", {
  state: ["open"],
});
assert(
  openList.captures.some((item) => item.id === capture.id),
  "capture.list did not include the open capture"
);

const editable = await rpc("capture.create", {
  text: `Smoke editable ${new Date().toISOString()}`,
});
const updated = await rpc("capture.update", {
  id: editable.id,
  text: `Smoke edited ${new Date().toISOString()}`,
});
assert(updated.state === "open", "capture.update changed capture state");
assert(updated.text.startsWith("Smoke edited"), "capture.update did not update text");

const deletable = await rpc("capture.create", {
  text: `Smoke delete ${new Date().toISOString()}`,
});
const deleted = await rpc("capture.delete", {
  id: deletable.id,
});
assert(deleted.success === true, "capture.delete did not report success");
const openAfterDelete = await rpc("capture.list", {
  state: ["open"],
});
assert(
  !openAfterDelete.captures.some((item) => item.id === deletable.id),
  "capture.delete did not remove open capture"
);

const resolved = await rpc("capture.resolve", {
  id: capture.id,
});
assert(resolved.state === "resolved", "capture.resolve did not resolve capture");

let updateProcessedFailed = false;
try {
  await rpc("capture.update", {
    id: capture.id,
    text: "should not update processed capture",
  });
} catch {
  updateProcessedFailed = true;
}
assert(updateProcessedFailed, "capture.update allowed editing a processed capture");

const eventCandidate = await rpc("capture.create", {
  text: `Smoke event ${new Date().toISOString()}`,
});
const appended = await rpc("capture.append_to_work_item_event", {
  id: eventCandidate.id,
});

assert(appended.work_item_id === focus.work_item_id, "capture event was not attached to active Work Item");
assert(appended.capture.state === "converted", "capture event did not mark capture as converted");
assert(appended.capture.work_item_id === focus.work_item_id, "capture event did not link capture to Work Item");
assert(appended.event.kind === "note_added", "capture event did not create a note_added Work Item event");
assert(appended.event.text === eventCandidate.text, "capture event did not preserve capture text");
assert(appended.event.focus_session_id === focus.id, "capture event did not preserve focus-session link");

const events = await rpc("work_item.events", {
  id: focus.work_item_id,
});
assert(
  events.events.some((event) => event.id === appended.event.id),
  "capture-created Work Item event is absent from work_item.events"
);

const convertCandidate = await rpc("capture.create", {
  text: `Smoke convert ${new Date().toISOString()}`,
});
const converted = await rpc("capture.convert_to_work_item", {
  id: convertCandidate.id,
});

assert(converted.work_item_id, "capture.convert_to_work_item did not return a work item id");
assert(converted.capture.state === "converted", "converted capture did not get converted state");
assert(
  converted.capture.work_item_id === converted.work_item_id,
  "converted capture is not linked to returned work item"
);
assert(converted.event?.kind === "note_added", "capture.convert_to_work_item did not create a note_added Work Item event");
assert(converted.event?.text === convertCandidate.text, "capture.convert_to_work_item did not preserve capture text");
assert(
  converted.event?.focus_session_id === focus.id,
  "capture.convert_to_work_item did not preserve focus-session link"
);
assert(
  converted.event?.payload?.source_capture_id === convertCandidate.id,
  "capture.convert_to_work_item did not keep source capture id"
);
assert(
  converted.event?.payload?.origin === "capture_convert_to_work_item",
  "capture.convert_to_work_item did not mark capture origin"
);

const inventory = await rpc("inventory.list");
assert(
  inventory.items.some((item) => item.id === converted.work_item_id),
  "converted capture work item is absent from inventory"
);

const convertedEvents = await rpc("work_item.events", {
  id: converted.work_item_id,
});
assert(
  convertedEvents.events.some((event) => event.id === converted.event.id),
  "converted-capture Work Item event is absent from work_item.events"
);

const currentAfterConvert = await rpc("focus.current");
assert(
  currentAfterConvert.session?.id === focus.id,
  "capture conversion interrupted the current focus session"
);

await rpc("focus.stop", {
  note: "capture smoke done",
});

console.log(
  JSON.stringify(
    {
      ok: true,
      api_url: apiUrl,
      capture_id: capture.id,
      updated_capture_id: updated.id,
      converted_work_item_id: converted.work_item_id,
    },
    null,
    2
  )
);
