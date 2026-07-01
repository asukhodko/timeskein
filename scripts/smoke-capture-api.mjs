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

const resolved = await rpc("capture.resolve", {
  id: capture.id,
});
assert(resolved.state === "resolved", "capture.resolve did not resolve capture");

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

const inventory = await rpc("inventory.list");
assert(
  inventory.items.some((item) => item.id === converted.work_item_id),
  "converted capture work item is absent from inventory"
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
      converted_work_item_id: converted.work_item_id,
    },
    null,
    2
  )
);
