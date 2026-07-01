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
    throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
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
    `Refusing to run smoke: active focus session already exists (${before.session.title})`
  );
}

const title = `Smoke focus ${new Date().toISOString()}`;
const started = await rpc("focus.start", {
  title,
  target_seconds: 60,
});

assert(started.id, "focus.start did not return an id");
assert(started.title === title, "focus.start returned unexpected title");
assert(started.state === "active", "focus.start did not create an active session");
assert(started.work_item_id, "focus.start did not create or reuse a work item");

await new Promise((resolve) => setTimeout(resolve, 1100));

const current = await rpc("focus.current");
assert(current.session?.id === started.id, "focus.current did not return the started session");
assert(current.session.active_seconds >= 1, "focus.current did not advance active_seconds");

const stopped = await rpc("focus.stop", {
  note: "smoke done",
});
assert(stopped.id === started.id, "focus.stop returned a different session");
assert(stopped.state === "stopped", "focus.stop did not stop the session");
assert(stopped.active_seconds >= 1, "focus.stop returned zero duration");

const day = await rpc("focus.list", todayWindow());
const found = day.sessions.find((session) => session.id === started.id);
assert(found, "focus.list did not include the stopped session");
assert(day.active_seconds_total >= stopped.active_seconds, "focus.list total is too small");
assert(
  day.sessions.every((session, index, sessions) => {
    if (index === 0) return true;
    return new Date(sessions[index - 1].started_at).getTime() <= new Date(session.started_at).getTime();
  }),
  "focus.list did not return sessions oldest first"
);

const inventoryAfterFreeStart = await rpc("inventory.list");
const matchingFreeItems = inventoryAfterFreeStart.items.filter((item) => item.title === title);
assert(matchingFreeItems.length === 1, "focus.start created an unexpected number of work items");

const continued = await rpc("focus.start", {
  title,
  target_seconds: 60,
});
assert(
  continued.work_item_id === started.work_item_id,
  "focus.start with the same title did not continue the existing work item"
);
await new Promise((resolve) => setTimeout(resolve, 1100));

const switchTitle = `Smoke switch ${new Date().toISOString()}`;
const switched = await rpc("focus.start", {
  title: switchTitle,
  target_seconds: 60,
});
assert(switched.id !== continued.id, "switching by title reused the previous focus session");
assert(
  switched.work_item_id !== continued.work_item_id,
  "switching by title reused the previous work item"
);

const currentAfterSwitch = await rpc("focus.current");
assert(currentAfterSwitch.session?.id === switched.id, "switching by title did not become current");

const inventoryAfterSwitchByTitle = await rpc("inventory.list");
const activeAfterSwitchByTitle = inventoryAfterSwitchByTitle.items.filter((item) => item.state === "active");
assert(activeAfterSwitchByTitle.length === 1, "switching by title left multiple active work items");
assert(activeAfterSwitchByTitle[0].id === switched.work_item_id, "switching by title activated the wrong work item");

await rpc("focus.stop");

const inventoryAfterContinue = await rpc("inventory.list");
const matchingContinuedItems = inventoryAfterContinue.items.filter((item) => item.title === title);
assert(matchingContinuedItems.length === 1, "continuing by title created a duplicate work item");

const createTitle = `Smoke create ${new Date().toISOString()}`;
const createdOnce = await rpc("work_item.create", {
  title: createTitle,
  type: "task",
});
const createdTwice = await rpc("work_item.create", {
  title: createTitle,
  type: "task",
});
assert(createdOnce.id === createdTwice.id, "work_item.create did not reuse the existing title");
assert(createdTwice.reused === true, "work_item.create did not report reused=true");

const inventoryAfterDuplicateCreate = await rpc("inventory.list");
const matchingCreatedItems = inventoryAfterDuplicateCreate.items.filter((item) => item.title === createTitle);
assert(matchingCreatedItems.length === 1, "work_item.create created duplicate titles");

const itemA = await rpc("work_item.create", {
  title: `Smoke linked A ${new Date().toISOString()}`,
  type: "task",
});
const itemB = await rpc("work_item.create", {
  title: `Smoke linked B ${new Date().toISOString()}`,
  type: "task",
});

const activatedA = await rpc("work_item.set_state", {
  id: itemA.id,
  state: "active",
});
assert(activatedA.focus_session_id, "activating a work item did not start focus");

const currentA = await rpc("focus.current");
assert(currentA.session?.work_item_id === itemA.id, "active work item A is not current focus");

const activatedB = await rpc("work_item.set_state", {
  id: itemB.id,
  state: "active",
});
assert(activatedB.focus_session_id, "switching active work item did not start focus");
assert(
  activatedB.focus_session_id !== activatedA.focus_session_id,
  "switching active work item reused the previous focus session"
);

const currentB = await rpc("focus.current");
assert(currentB.session?.work_item_id === itemB.id, "active work item B is not current focus");

const inventoryAfterSwitch = await rpc("inventory.list");
const activeItems = inventoryAfterSwitch.items.filter((item) => item.state === "active");
assert(activeItems.length === 1, "inventory contains more than one active work item");
assert(activeItems[0].id === itemB.id, "the active work item is not item B");

const createdActive = await rpc("work_item.create", {
  title: `Smoke create active ${new Date().toISOString()}`,
  type: "task",
  state: "active",
});
assert(createdActive.focus_session_id, "creating an active work item did not start focus");
assert(
  createdActive.focus_session_id !== activatedB.focus_session_id,
  "creating an active work item reused the previous focus session"
);

const currentAfterCreateActive = await rpc("focus.current");
assert(
  currentAfterCreateActive.session?.work_item_id === createdActive.id,
  "created active work item is not current focus"
);

const inventoryAfterCreateActive = await rpc("inventory.list");
const activeAfterCreateActive = inventoryAfterCreateActive.items.filter((item) => item.state === "active");
assert(activeAfterCreateActive.length === 1, "creating active work item left multiple active items");
assert(activeAfterCreateActive[0].id === createdActive.id, "created active work item is not the only active item");

await rpc("work_item.set_state", {
  id: createdActive.id,
  state: "waiting",
});

const currentAfterWaiting = await rpc("focus.current");
assert(!currentAfterWaiting.session, "moving active work item to waiting did not stop focus");

const inventoryAfterStop = await rpc("inventory.list");
assert(
  inventoryAfterStop.items.every((item) => item.state !== "active"),
  "inventory still contains an active work item after stopping linked focus"
);

const itemC = await rpc("work_item.create", {
  title: `Smoke delete active ${new Date().toISOString()}`,
  type: "task",
});
const activatedC = await rpc("work_item.set_state", {
  id: itemC.id,
  state: "active",
});
assert(activatedC.focus_session_id, "activating delete-test item did not start focus");

const deletedActive = await rpc("work_item.delete", {
  id: itemC.id,
});
assert(
  deletedActive.stopped_focus_session_id === activatedC.focus_session_id,
  "deleting active work item did not report the stopped focus session"
);

const currentAfterActiveDelete = await rpc("focus.current");
assert(!currentAfterActiveDelete.session, "deleting active work item did not stop focus");

const inventoryAfterActiveDelete = await rpc("inventory.list");
assert(
  inventoryAfterActiveDelete.items.every((item) => item.state !== "active"),
  "inventory still contains an active work item after deleting active item"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      api_url: apiUrl,
      session_id: started.id,
      linked_switch_session_id: activatedB.focus_session_id,
      active_seconds: stopped.active_seconds,
      day_total_seconds: day.active_seconds_total,
    },
    null,
    2
  )
);
