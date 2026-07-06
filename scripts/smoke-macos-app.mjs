#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const repoRoot = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const appBinary = join(
  repoRoot,
  "target/release/bundle/macos/Timeskein.app/Contents/MacOS/timeskein-desktop"
);

if (!existsSync(appBinary)) {
  throw new Error(`Packaged app binary not found: ${appBinary}`);
}

const homeDir = await mkdtemp(join(tmpdir(), "timeskein-app-smoke-"));
const dataDir = join(homeDir, "Library/Application Support/Timeskein");
const portFile = join(dataDir, "agent.port");
let child;
let stderrOutput = "";

try {
  await seedLegacyDbWithMultipleActiveWorkItems();
  await seedStaleAgentRuntimeFiles();
  child = spawnApp(homeDir);
  const port = await waitForResponsiveAgent(portFile, 15_000);
  const status = await rpc(port, "agent.status");
  const inventory = await rpc(port, "inventory.list");
  const title = `Packaged app smoke ${new Date().toISOString()}`;
  const started = await rpc(port, "focus.start", {
    title,
    target_seconds: 60,
  });
  const capture = await rpc(port, "capture.create", {
    text: `Packaged smoke capture ${new Date().toISOString()}`,
  });
  assert(capture.state === "open", "capture.create did not create an open capture");
  assert(capture.focus_session_id === started.id, "capture.create did not link to active focus");
  const currentAfterCapture = await rpc(port, "focus.current");
  assert(
    currentAfterCapture.session?.id === started.id,
    "capture.create interrupted the active focus session"
  );
  const editableCapture = await rpc(port, "capture.create", {
    text: `Packaged smoke editable capture ${new Date().toISOString()}`,
  });
  const updatedCapture = await rpc(port, "capture.update", {
    id: editableCapture.id,
    text: `Packaged smoke edited capture ${new Date().toISOString()}`,
  });
  assert(updatedCapture.state === "open", "capture.update changed open capture state");
  assert(updatedCapture.text.startsWith("Packaged smoke edited"), "capture.update did not update text");
  const deletableCapture = await rpc(port, "capture.create", {
    text: `Packaged smoke deletable capture ${new Date().toISOString()}`,
  });
  const deletedCapture = await rpc(port, "capture.delete", {
    id: deletableCapture.id,
  });
  assert(deletedCapture.success === true, "capture.delete did not report success");
  const openCapturesAfterDelete = await rpc(port, "capture.list", {
    state: ["open"],
  });
  assert(
    !openCapturesAfterDelete.captures.some((item) => item.id === deletableCapture.id),
    "capture.delete did not remove open capture in packaged app"
  );
  const resolvedCapture = await rpc(port, "capture.resolve", {
    id: capture.id,
  });
  assert(resolvedCapture.state === "resolved", "capture.resolve did not resolve capture");
  const eventCapture = await rpc(port, "capture.create", {
    text: `Packaged smoke event capture ${new Date().toISOString()}`,
  });
  const appendedCapture = await rpc(port, "capture.append_to_work_item_event", {
    id: eventCapture.id,
  });
  assert(
    appendedCapture.work_item_id === started.work_item_id,
    "capture.append_to_work_item_event did not infer the active Work Item"
  );
  assert(
    appendedCapture.event.text === eventCapture.text,
    "capture.append_to_work_item_event did not create a Work Item event from capture text"
  );
  const eventsAfterAppend = await rpc(port, "work_item.events", {
    id: started.work_item_id,
  });
  assert(
    eventsAfterAppend.events.some((event) => event.id === appendedCapture.event.id),
    "capture-created Work Item event is absent from packaged app event list"
  );
  const dayEvent = await rpc(port, "day_event.add", {
    text: "packaged day event linked to focus",
    focus_session_id: started.id,
    activity_zone: "work",
  });
  assert(dayEvent.kind === "note_added", "day_event.add did not create note_added event");
  assert(dayEvent.focus_session_id === started.id, "day_event.add did not link to packaged focus");
  assert(dayEvent.activity_zone === "work", "day_event.add did not preserve packaged activity zone");

  const freeDayEvent = await rpc(port, "day_event.add", {
    text: "packaged free day event",
    activity_zone: "recovery",
  });
  assert(!freeDayEvent.focus_session_id, "free packaged day event should not be linked to focus");

  const currentAfterDayEvent = await rpc(port, "focus.current");
  assert(
    currentAfterDayEvent.session?.id === started.id,
    "day_event.add interrupted packaged active focus"
  );

  const dayEvents = await rpc(port, "day_event.list", todayWindow());
  assert(
    dayEvents.events.some((event) => event.id === dayEvent.id),
    "day_event.list did not include packaged linked day event"
  );
  assert(
    dayEvents.events.some((event) => event.id === freeDayEvent.id),
    "day_event.list did not include packaged free day event"
  );

  const updatedDayEvent = await rpc(port, "day_event.update", {
    id: dayEvent.id,
    text: "packaged edited day event",
    activity_zone: "coordination",
  });
  assert(updatedDayEvent.text === "packaged edited day event", "day_event.update did not edit text");
  assert(updatedDayEvent.activity_zone === "coordination", "day_event.update did not edit zone");

  const deletedDayEvent = await rpc(port, "day_event.delete", {
    id: freeDayEvent.id,
  });
  assert(deletedDayEvent.success === true, "day_event.delete did not report success");

  const dayEventsAfterDelete = await rpc(port, "day_event.list", todayWindow());
  assert(
    dayEventsAfterDelete.events.every((event) => event.id !== freeDayEvent.id),
    "day_event.delete left packaged event visible"
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const stopped = await rpc(port, "focus.stop", {
    note: "packaged app smoke done",
  });
  const day = await rpc(port, "focus.list", todayWindow());
  const appEvents = await waitForAppEvents(port, ["agent_started", "app_started", "focus_started", "focus_stopped"], 5_000);
  await rpc(port, "app_event.log", {
    source: "script",
    kind: "capture_created",
    work_item_id: started.work_item_id,
    focus_session_id: started.id,
    payload: {
      control: "legacy_app_events_constraint_smoke",
    },
  });
  const appEventSummary = await rpc(port, "app_event.summary", todayWindow());

  assert(status.db_ok === true, "agent.status did not report db_ok=true");
  assert(typeof status.storage_path === "string", "agent.status did not return storage_path");
  assert(Array.isArray(inventory.items), "inventory.list did not return items");
  assert(
    stderrOutput.includes("Ignoring stale Timeskein agent lock/port"),
    "app did not ignore stale agent lock/port before starting embedded agent"
  );
  const seededActiveItems = inventory.items.filter((item) => item.state === "active");
  assert(
    seededActiveItems.length === 1,
    "startup migration did not normalize legacy multiple active work items"
  );
  assert(
    seededActiveItems[0].title === "Legacy Active Newer",
    "startup migration did not keep the newest legacy active work item"
  );
  assert(started.work_item_id, "focus.start did not create or reuse a work item");
  assert(stopped.id === started.id, "focus.stop returned a different session");
  assert(stopped.active_seconds >= 1, "focus.stop returned zero duration");
  assert(
    day.sessions.some((session) => session.id === started.id),
    "focus.list did not include the packaged app smoke session"
  );
  assert(
    appEvents.events.some((event) => event.kind === "agent_stale_runtime_recovered"),
    "app_events did not include stale runtime recovery"
  );
  assert(appEventSummary.total >= 4, "app_event.summary did not count packaged app events");
  assert(appEventSummary.by_kind.agent_started >= 1, "app_event.summary did not count agent_started");
  assert(appEventSummary.by_kind.focus_started >= 1, "app_event.summary did not count focus_started");
  assert(appEventSummary.by_kind.focus_stopped >= 1, "app_event.summary did not count focus_stopped");
  assert(appEventSummary.by_kind.capture_created >= 1, "app_event.summary did not count capture_created");
  assertSessionsOldestFirst(day.sessions);

  const historicalStop = new Date();
  historicalStop.setDate(historicalStop.getDate() - 1);
  historicalStop.setHours(10, 20, 0, 0);
  const historicalStart = new Date(historicalStop.getTime() - 20 * 60 * 1000);
  const historical = await rpc(port, "focus.create_stopped", {
    work_item_id: started.work_item_id,
    started_at: historicalStart.toISOString(),
    stopped_at: historicalStop.toISOString(),
    note: "packaged historical inventory total smoke",
  });

  const inventoryAfterFirstStart = await rpc(port, "inventory.list", {
    focus_window: todayWindow(),
  });
  const matchingItems = inventoryAfterFirstStart.items.filter((item) => item.title === title);
  assert(matchingItems.length === 1, "focus.start created duplicate work items");
  assert(
    matchingItems[0].today_active_seconds >= stopped.active_seconds,
    "inventory.list did not include today's focus seconds for the Work Item"
  );
  assert(
    matchingItems[0].total_active_seconds >= matchingItems[0].today_active_seconds + historical.active_seconds,
    "inventory.list did not include historical focus seconds in the Work Item total"
  );
  assert(
    matchingItems[0].total_active_seconds > matchingItems[0].today_active_seconds,
    "inventory.list did not keep Work Item today and total time distinct"
  );

  const continued = await rpc(port, "focus.start", {
    title,
    target_seconds: 60,
  });
  assert(
    continued.work_item_id === started.work_item_id,
    "focus.start with the same title did not continue the existing work item"
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const switchTitle = `Packaged smoke switch ${new Date().toISOString()}`;
  const switched = await rpc(port, "focus.start", {
    title: switchTitle,
    target_seconds: 60,
  });
  assert(switched.id !== continued.id, "switching by title reused the previous focus session");
  assert(
    switched.work_item_id !== continued.work_item_id,
    "switching by title reused the previous work item"
  );

  const currentAfterSwitch = await rpc(port, "focus.current");
  assert(currentAfterSwitch.session?.id === switched.id, "switching by title did not become current");

  const inventoryAfterSwitchByTitle = await rpc(port, "inventory.list");
  const activeAfterSwitchByTitle = inventoryAfterSwitchByTitle.items.filter(
    (item) => item.state === "active"
  );
  assert(activeAfterSwitchByTitle.length === 1, "switching by title left multiple active work items");
  assert(
    activeAfterSwitchByTitle[0].id === switched.work_item_id,
    "switching by title activated the wrong work item"
  );

  await rpc(port, "focus.stop");

  const inventoryAfterContinue = await rpc(port, "inventory.list");
  const matchingContinuedItems = inventoryAfterContinue.items.filter((item) => item.title === title);
  assert(matchingContinuedItems.length === 1, "continuing by title created a duplicate work item");

  const createTitle = `Packaged smoke create ${new Date().toISOString()}`;
  const createdOnce = await rpc(port, "work_item.create", {
    title: createTitle,
    type: "task",
  });
  const createdTwice = await rpc(port, "work_item.create", {
    title: createTitle,
    type: "task",
  });
  assert(createdOnce.id === createdTwice.id, "work_item.create did not reuse the existing title");
  assert(createdTwice.reused === true, "work_item.create did not report reused=true");

  const convertCapture = await rpc(port, "capture.create", {
    text: `Packaged smoke convert ${new Date().toISOString()}`,
  });
  const convertedCapture = await rpc(port, "capture.convert_to_work_item", {
    id: convertCapture.id,
  });
  assert(
    convertedCapture.capture.state === "converted",
    "capture.convert_to_work_item did not convert capture"
  );
  assert(
    convertedCapture.capture.work_item_id === convertedCapture.work_item_id,
    "converted capture is not linked to returned work item"
  );
  assert(
    convertedCapture.event?.kind === "note_added",
    "capture.convert_to_work_item did not create an origin Work Item event"
  );
  assert(
    convertedCapture.event?.text === convertCapture.text,
    "capture.convert_to_work_item did not preserve capture text"
  );
  assert(
    convertedCapture.event?.payload?.source_capture_id === convertCapture.id,
    "capture.convert_to_work_item did not keep source capture id"
  );
  assert(
    convertedCapture.event?.payload?.origin === "capture_convert_to_work_item",
    "capture.convert_to_work_item did not mark capture origin"
  );

  const inventoryAfterDuplicateCreate = await rpc(port, "inventory.list");
  const matchingCreatedItems = inventoryAfterDuplicateCreate.items.filter(
    (item) => item.title === createTitle
  );
  assert(matchingCreatedItems.length === 1, "work_item.create created duplicate titles");
  assert(
    inventoryAfterDuplicateCreate.items.some((item) => item.id === convertedCapture.work_item_id),
    "converted capture work item is absent from inventory"
  );

  const itemA = await rpc(port, "work_item.create", {
    title: `Packaged smoke linked A ${new Date().toISOString()}`,
    type: "task",
  });
  const itemB = await rpc(port, "work_item.create", {
    title: `Packaged smoke linked B ${new Date().toISOString()}`,
    type: "task",
  });

  const activatedA = await rpc(port, "work_item.set_state", {
    id: itemA.id,
    state: "active",
  });
  assert(activatedA.focus_session_id, "activating a work item did not start focus");

  const currentA = await rpc(port, "focus.current");
  assert(currentA.session?.work_item_id === itemA.id, "active work item A is not current focus");

  const activatedB = await rpc(port, "work_item.set_state", {
    id: itemB.id,
    state: "active",
  });
  assert(activatedB.focus_session_id, "switching active work item did not start focus");
  assert(
    activatedB.focus_session_id !== activatedA.focus_session_id,
    "switching active work item reused the previous focus session"
  );

  const currentB = await rpc(port, "focus.current");
  assert(currentB.session?.work_item_id === itemB.id, "active work item B is not current focus");

  const inventoryAfterSwitch = await rpc(port, "inventory.list");
  const activeItems = inventoryAfterSwitch.items.filter((item) => item.state === "active");
  assert(activeItems.length === 1, "inventory contains more than one active work item");
  assert(activeItems[0].id === itemB.id, "the active work item is not item B");

  const createdActive = await rpc(port, "work_item.create", {
    title: `Packaged smoke create active ${new Date().toISOString()}`,
    type: "task",
    state: "active",
  });
  assert(createdActive.focus_session_id, "creating an active work item did not start focus");
  assert(
    createdActive.focus_session_id !== activatedB.focus_session_id,
    "creating an active work item reused the previous focus session"
  );

  const currentAfterCreateActive = await rpc(port, "focus.current");
  assert(
    currentAfterCreateActive.session?.work_item_id === createdActive.id,
    "created active work item is not current focus"
  );

  const inventoryAfterCreateActive = await rpc(port, "inventory.list");
  const activeAfterCreateActive = inventoryAfterCreateActive.items.filter((item) => item.state === "active");
  assert(activeAfterCreateActive.length === 1, "creating active work item left multiple active items");
  assert(activeAfterCreateActive[0].id === createdActive.id, "created active work item is not the only active item");

  await rpc(port, "work_item.set_state", {
    id: createdActive.id,
    state: "waiting",
  });

  const currentAfterWaiting = await rpc(port, "focus.current");
  assert(!currentAfterWaiting.session, "moving active work item to waiting did not stop focus");

  const itemC = await rpc(port, "work_item.create", {
    title: `Packaged smoke delete active ${new Date().toISOString()}`,
    type: "task",
  });
  const activatedC = await rpc(port, "work_item.set_state", {
    id: itemC.id,
    state: "active",
  });
  assert(activatedC.focus_session_id, "activating delete-test item did not start focus");

  const deletedActive = await rpc(port, "work_item.delete", {
    id: itemC.id,
  });
  assert(
    deletedActive.stopped_focus_session_id === activatedC.focus_session_id,
    "deleting active work item did not report the stopped focus session"
  );

  const currentAfterActiveDelete = await rpc(port, "focus.current");
  assert(!currentAfterActiveDelete.session, "deleting active work item did not stop focus");

  const inventoryAfterActiveDelete = await rpc(port, "inventory.list");
  assert(
    inventoryAfterActiveDelete.items.every((item) => item.state !== "active"),
    "inventory still contains an active work item after deleting active item"
  );

  await runCorrectionSmoke(port);

  const restartTitle = `Packaged smoke restart ${new Date().toISOString()}`;
  const restartStarted = await rpc(port, "focus.start", {
    title: restartTitle,
    target_seconds: 60,
  });
  await new Promise((resolve) => setTimeout(resolve, 1100));

  await stopChild(child);
  child = undefined;
  await unlink(portFile).catch(() => {});

  child = spawnApp(homeDir);
  const restartedPort = await waitForResponsiveAgent(portFile, 15_000);
  const restored = await rpc(restartedPort, "focus.current");

  assert(
    restored.session?.id === restartStarted.id,
    "active focus session was not restored after app restart"
  );
  assert(
    restored.session.active_seconds >= 1,
    "restored active focus session did not keep advancing time"
  );

  const restartStopped = await rpc(restartedPort, "focus.stop", {
    note: "restart restore smoke done",
  });
  assert(restartStopped.id === restartStarted.id, "restored focus stop returned a different session");

  await stopChild(child);
  child = undefined;
  await unlink(portFile).catch(() => {});
  await seedOrphanActiveFocusSession(restartStopped.id);

  child = spawnApp(homeDir);
  const normalizedPort = await waitForResponsiveAgent(portFile, 15_000);
  const currentAfterOrphanStartup = await rpc(normalizedPort, "focus.current");
  assert(
    !currentAfterOrphanStartup.session,
    "startup normalization did not stop orphan active focus session"
  );

  const inventoryAfterOrphanStartup = await rpc(normalizedPort, "inventory.list");
  assert(
    inventoryAfterOrphanStartup.items.every((item) => item.state !== "active"),
    "startup normalization did not clear active work item after orphan focus"
  );

  const dayAfterOrphanStartup = await rpc(normalizedPort, "focus.list", todayWindow());
  const orphanNormalized = dayAfterOrphanStartup.sessions.find((session) => session.id === restartStopped.id);
  assert(orphanNormalized?.state === "stopped", "orphan focus session was not persisted as stopped");
  assert(
    orphanNormalized.note?.includes("linked work item is unavailable"),
    "orphan focus session did not get a startup normalization note"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        app_binary: appBinary,
        api_url: `http://127.0.0.1:${port}/api`,
        db_ok: status.db_ok,
        work_items: inventory.items.length,
        session_id: stopped.id,
        continued_session_id: continued.id,
        linked_switch_session_id: activatedB.focus_session_id,
        restart_restore_session_id: restartStopped.id,
        active_seconds: stopped.active_seconds,
      },
      null,
      2
    )
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${message}${stderrOutput ? `\nApp stderr:\n${stderrOutput.trim()}` : ""}`);
} finally {
  await stopChild(child);
  await rm(homeDir, { recursive: true, force: true });
}

function spawnApp(homeDir) {
  const appProcess = spawn(appBinary, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  appProcess.stderr.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });

  return appProcess;
}

async function rpc(port, method, params = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: "1.0",
      request_id: crypto.randomUUID(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`${method}: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`${method}: ${data.error.code}: ${data.error.message}`);
  }

  return data.result;
}

async function runCorrectionSmoke(port) {
  const title = `Packaged correction ${new Date().toISOString()}`;
  const started = await rpc(port, "focus.start", {
    title,
    target_seconds: 60,
  });
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const stopped = await rpc(port, "focus.stop", {
    note: "packaged correction original note",
  });
  const end = new Date(stopped.stopped_at);
  const start = new Date(end.getTime() - 60_000);
  const splitAt = new Date(start.getTime() + 30_000);
  const correctedTitle = `${title} corrected`;
  const updated = await rpc(port, "focus.update", {
    id: stopped.id,
    title: correctedTitle,
    started_at: start.toISOString(),
    stopped_at: end.toISOString(),
    activity_zone: "recovery",
    note: "packaged correction note",
  });

  assert(updated.id === started.id, "focus.update returned a different session");
  assert(updated.work_item_title === correctedTitle, "focus.update did not reassign work item");
  assert(updated.activity_zone === "recovery", "focus.update did not set packaged activity zone");
  assert(updated.active_seconds >= 59, "focus.update did not update duration");

  const rightTitle = `${title} right`;
  const split = await rpc(port, "focus.split", {
    id: updated.id,
    split_at: splitAt.toISOString(),
    right_title: rightTitle,
    right_note: "packaged right note",
  });

  assert(split.left.id === updated.id, "focus.split did not keep the original left id");
  assert(split.right.id !== split.left.id, "focus.split did not create a right block");
  assert(split.right.work_item_title === rightTitle, "focus.split did not assign right title");
  assert(split.right.activity_zone === "work", "focus.split did not snapshot packaged right zone");

  const currentDay = todayWindow();
  const missedStart = new Date(new Date(currentDay.from).getTime() + 12 * 60 * 60_000);
  const missedStop = new Date(missedStart.getTime() + 20 * 60_000);
  const missedTitle = `${title} missed`;
  const missed = await rpc(port, "focus.create_stopped", {
    title: missedTitle,
    started_at: missedStart.toISOString(),
    stopped_at: missedStop.toISOString(),
    activity_zone: "coordination",
    note: "packaged missed block",
  });
  assert(missed.state === "stopped", "focus.create_stopped did not create a stopped packaged block");
  assert(missed.work_item_title === missedTitle, "focus.create_stopped did not assign packaged Work Item");
  assert(missed.activity_zone === "coordination", "focus.create_stopped did not set packaged zone");
  assert(missed.active_seconds >= 1199, "focus.create_stopped returned wrong packaged duration");

  const currentAfterMissed = await rpc(port, "focus.current");
  assert(!currentAfterMissed.session, "focus.create_stopped unexpectedly started packaged active timer");

  const editedRightTitle = `${rightTitle} edited`;
  const editedItem = await rpc(port, "work_item.update", {
    id: split.right.work_item_id,
    title: editedRightTitle,
    type: "project",
    activity_zone: "coordination",
    note: "packaged edited item note",
  });
  assert(editedItem.title === editedRightTitle, "work_item.update did not update title");
  assert(editedItem.type === "project", "work_item.update did not update type");
  assert(editedItem.activity_zone === "coordination", "work_item.update did not update activity zone");

  const beforeZoneCorrection = await rpc(port, "focus.list", todayWindow());
  const rightBeforeZoneCorrection = beforeZoneCorrection.sessions.find((session) => session.id === split.right.id);
  assert(
    rightBeforeZoneCorrection?.activity_zone === "work",
    "work_item.update unexpectedly changed packaged focus block zone"
  );

  const zoneCorrected = await rpc(port, "focus.update", {
    id: split.right.id,
    activity_zone: "coordination",
  });
  assert(zoneCorrected.activity_zone === "coordination", "focus.update did not correct packaged zone");

  const eventWindowStart = new Date(Date.now() - 60_000).toISOString();
  const event = await rpc(port, "work_item.add_event", {
    id: editedItem.id,
    text: "packaged timestamped event",
    focus_session_id: split.right.id,
  });
  assert(event.kind === "note_added", "work_item.add_event did not create note_added event");
  assert(event.text === "packaged timestamped event", "work_item.add_event did not return event text");

  const events = await rpc(port, "work_item.events", {
    id: editedItem.id,
    from: eventWindowStart,
    to: new Date(Date.now() + 60_000).toISOString(),
  });
  assert(
    events.events.some((entry) => entry.kind === "note_added" && entry.text === "packaged timestamped event"),
    "work_item.events did not list packaged event"
  );

  const updatedEvent = await rpc(port, "work_item.update_event", {
    id: event.id,
    text: "edited packaged timestamped event",
  });
  assert(updatedEvent.text === "edited packaged timestamped event", "work_item.update_event did not edit packaged event");

  const deletedEvent = await rpc(port, "work_item.delete_event", {
    id: event.id,
  });
  assert(deletedEvent.success === true, "work_item.delete_event did not report success");

  const eventsAfterDelete = await rpc(port, "work_item.events", {
    id: editedItem.id,
    from: eventWindowStart,
    to: new Date(Date.now() + 60_000).toISOString(),
  });
  assert(
    eventsAfterDelete.events.every((entry) => entry.id !== event.id),
    "work_item.delete_event left packaged event visible"
  );

  const day = await rpc(port, "focus.list", todayWindow());
  const rightFound = day.sessions.find((session) => session.id === split.right.id);
  const missedFound = day.sessions.find((session) => session.id === missed.id);
  assert(rightFound?.work_item_title === editedRightTitle, "focus.list did not reflect edited item title");
  assert(rightFound?.activity_zone === "coordination", "focus.list did not reflect corrected packaged zone");
  assert(missedFound?.work_item_title === missedTitle, "focus.list did not include packaged missed block");
}

async function waitForPortFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const content = await readFile(path, "utf8");
      const port = Number.parseInt(content.trim(), 10);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for port file: ${path}`);
}

async function waitForResponsiveAgent(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const port = await waitForPortFile(path, Math.min(500, Math.max(deadline - Date.now(), 1)));
      await rpc(port, "agent.ping");
      return port;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out waiting for responsive agent: ${message}`);
}

async function waitForAppEvents(port, kinds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest;

  while (Date.now() < deadline) {
    latest = await rpc(port, "app_event.list", todayWindow());
    if (kinds.every((kind) => latest.events.some((event) => event.kind === kind))) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const observed = latest?.events?.map((event) => event.kind).join(", ") ?? "";
  throw new Error(`Timed out waiting for app events. Observed: ${observed}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSessionsOldestFirst(sessions) {
  assert(
    sessions.every((session, index) => {
      if (index === 0) return true;
      return new Date(sessions[index - 1].started_at).getTime() <= new Date(session.started_at).getTime();
    }),
    "focus.list did not return sessions oldest first"
  );
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

async function waitForExit(process, timeoutMs) {
  if (process.exitCode !== null || process.signalCode !== null) return;

  await Promise.race([
    new Promise((resolve) => process.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
  ]);
}

async function stopChild(process) {
  if (!process || process.killed) return;

  process.kill("SIGTERM");
  await waitForExit(process, 3_000).catch(() => process.kill("SIGKILL"));
}

async function seedLegacyDbWithMultipleActiveWorkItems() {
  const dbPath = join(dataDir, "timeskein.db");
  await mkdir(dataDir, { recursive: true });
  await runSqlFile(dbPath, join(repoRoot, "apps/agent/migrations/001_initial.sql"));
  await runSql(
    dbPath,
    `
      CREATE TABLE focus_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        work_item_id TEXT,
        state TEXT NOT NULL DEFAULT 'active'
            CHECK(state IN ('active', 'stopped')),
        target_seconds INTEGER NOT NULL DEFAULT 1500,
        note TEXT,
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
      );

      CREATE UNIQUE INDEX idx_focus_sessions_single_active
          ON focus_sessions(state)
          WHERE state = 'active';

      CREATE INDEX idx_focus_sessions_started_at
          ON focus_sessions(started_at DESC);

      CREATE INDEX idx_focus_sessions_work_item
          ON focus_sessions(work_item_id);

      CREATE TABLE app_events (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        source TEXT NOT NULL
            CHECK(source IN ('ui', 'agent', 'script', 'system')),
        kind TEXT NOT NULL CHECK(kind IN (
            'app_started',
            'agent_started',
            'agent_reused',
            'agent_stale_runtime_recovered',
            'window_shown',
            'window_hidden',
            'window_drag_started',
            'focus_start_requested',
            'focus_started',
            'focus_start_failed',
            'focus_switch_requested',
            'focus_switched',
            'focus_stop_requested',
            'focus_stopped',
            'focus_stop_failed',
            'report_copy_requested',
            'report_copied',
            'report_copy_failed',
            'manual_copy_fallback_shown',
            'api_error'
        )),
        work_item_id TEXT,
        focus_session_id TEXT,
        payload TEXT,
        FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
        FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_app_events_ts
          ON app_events(ts DESC);

      CREATE INDEX idx_app_events_kind
          ON app_events(kind);

      CREATE INDEX idx_app_events_work_item
          ON app_events(work_item_id);

      CREATE INDEX idx_app_events_focus_session
          ON app_events(focus_session_id);

      INSERT INTO app_events (id, ts, source, kind, work_item_id, focus_session_id, payload)
      VALUES (
        '00000000-0000-4000-8000-000000000301',
        '2026-06-30T07:00:00Z',
        'agent',
        'agent_started',
        NULL,
        NULL,
        NULL
      );

      INSERT INTO work_items (id, title, type, state, pinned, created_at, updated_at, last_seen_at)
      VALUES
        ('00000000-0000-4000-8000-000000000101', 'Legacy Active Older', 'task', 'active', 0, '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z', '2026-06-30T06:00:00Z'),
        ('00000000-0000-4000-8000-000000000102', 'Legacy Active Newer', 'task', 'active', 0, '2026-06-30T07:00:00Z', '2026-06-30T07:00:00Z', '2026-06-30T07:00:00Z');

      INSERT INTO focus_sessions (id, title, work_item_id, state, target_seconds, note, started_at, stopped_at, updated_at)
      VALUES ('00000000-0000-4000-8000-000000000201', 'Legacy Active Newer', '00000000-0000-4000-8000-000000000102', 'active', 1500, NULL, '2026-06-30T07:00:00Z', NULL, '2026-06-30T07:00:00Z');
    `
  );
}

async function seedStaleAgentRuntimeFiles() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "agent.lock"), String(process.pid));
  await writeFile(portFile, "9");
}

async function seedOrphanActiveFocusSession(sessionId) {
  const dbPath = join(dataDir, "timeskein.db");
  await runSql(
    dbPath,
    `
      UPDATE focus_sessions
      SET state = 'active',
          work_item_id = NULL,
          stopped_at = NULL,
          note = NULL,
          updated_at = '2026-06-30T10:00:00Z'
      WHERE id = '${sessionId}';

      UPDATE work_items
      SET state = CASE id WHEN '00000000-0000-4000-8000-000000000101' THEN 'active' ELSE 'unknown' END,
          updated_at = '2026-06-30T10:00:00Z',
          last_seen_at = '2026-06-30T10:00:00Z';
    `
  );
}

async function runSqlFile(path, sqlFile) {
  await execFileAsync("sqlite3", [path, `.read ${sqlFile}`], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function runSql(path, sql) {
  await execFileAsync("sqlite3", [path, sql], {
    maxBuffer: 10 * 1024 * 1024,
  });
}
