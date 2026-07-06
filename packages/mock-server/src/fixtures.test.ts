import assert from "node:assert/strict";
import { test } from "node:test";
import { MockDataStore } from "./fixtures";

test("focus start reuses titles and keeps one active work item", async () => {
  const store = new MockDataStore();
  const first = store.startFocusSession({
    title: "Mock Focus A",
    target_seconds: 60,
  });
  const continued = store.startFocusSession({
    title: "Mock Focus A",
    target_seconds: 60,
  });
  const switched = store.startFocusSession({
    title: "Mock Focus B",
    target_seconds: 60,
  });

  assert.equal(continued.id, first.id);
  assert.equal(continued.work_item_id, first.work_item_id);
  assert.notEqual(switched.id, first.id);
  assert.notEqual(switched.work_item_id, first.work_item_id);

  const activeItems = store
    .listWorkItems()
    .filter((item) => item.state === "active");
  assert.equal(activeItems.length, 1);
  assert.equal(activeItems[0].id, switched.work_item_id);
});

test("capture inbox does not interrupt active focus", async () => {
  const store = new MockDataStore();
  const focus = store.startFocusSession({
    title: "Mock Capture Focus",
    target_seconds: 60,
  });
  const capture = store.createCapture({
    text: "remember this without switching",
  });

  assert.equal(capture.state, "open");
  assert.equal(capture.focus_session_id, focus.id);
  assert.equal(store.getActiveFocusSession()?.id, focus.id);

  const edited = store.updateCapture(capture.id, "remember this after cleanup");
  assert.equal(edited?.text, "remember this after cleanup");
  assert.equal(store.getActiveFocusSession()?.id, focus.id);

  const converted = store.convertCaptureToWorkItem(capture.id);
  assert.equal(converted.capture?.state, "converted");
  assert.equal(converted.event?.kind, "note_added");
  assert.equal(converted.event?.text, capture.text);
  assert.equal(converted.event?.focus_session_id, focus.id);
  assert.equal(converted.event?.payload?.source_capture_id, capture.id);
  assert.equal(converted.event?.payload?.origin, "capture_convert_to_work_item");
  assert.equal(store.getActiveFocusSession()?.id, focus.id);

  const eventCapture = store.createCapture({
    text: "this belongs to the current focus",
  });
  const appended = store.appendCaptureToWorkItemEvent(eventCapture.id);
  assert.equal(appended.capture?.state, "converted");
  assert.equal(appended.workItemId, focus.work_item_id);
  assert.equal(appended.event?.text, eventCapture.text);
  assert.equal(appended.event?.focus_session_id, focus.id);
  assert.equal(appended.event?.payload?.source_capture_id, eventCapture.id);
  assert.equal(store.getActiveFocusSession()?.id, focus.id);

  const deleteCapture = store.createCapture({
    text: "delete this later",
  });
  assert.equal(store.deleteCapture(deleteCapture.id), true);
  assert.equal(store.listCaptures(["open"]).some((item) => item.id === deleteCapture.id), false);
  assert.equal(store.deleteCapture(capture.id), false);
});

test("day events do not interrupt active focus and can be cleaned up", async () => {
  const store = new MockDataStore();
  const focus = store.startFocusSession({
    title: "Mock Day Event Focus",
    target_seconds: 60,
  });
  const linked = store.addDayEvent({
    text: "buffer before meeting felt expensive",
    focus_session_id: focus.id,
    activity_zone: "work",
  });
  const free = store.addDayEvent({
    text: "recovery was not enough",
    activity_zone: "recovery",
  });

  assert.equal(linked?.focus_session_id, focus.id);
  assert.equal(linked?.activity_zone, "work");
  assert.equal(free?.focus_session_id, undefined);
  assert.equal(free?.activity_zone, "recovery");
  assert.equal(store.getActiveFocusSession()?.id, focus.id);

  const events = store.listDayEvents({
    from: new Date(Date.now() - 60_000).toISOString(),
    to: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(events.length, 2);

  const updated = store.updateDayEvent(linked!.id, {
    text: "edited day event",
    activity_zone: "coordination",
  });
  assert.equal(updated?.text, "edited day event");
  assert.equal(updated?.activity_zone, "coordination");

  assert.equal(store.deleteDayEvent(free!.id), true);
  assert.equal(store.listDayEvents().length, 1);
});

test("focus correction update, split and work item edit are reflected in day data", async () => {
  const store = new MockDataStore();
  const started = store.startFocusSession({
    title: "Mock Correction Original",
    target_seconds: 60,
  });
  const stopped = store.stopFocusSession(started.id, "original note");

  assert.equal(stopped?.id, started.id);

  const now = Date.now();
  const start = new Date(now - 180_000).toISOString();
  const splitAt = new Date(now - 120_000).toISOString();
  const stop = new Date(now).toISOString();
  const updated = store.updateFocusSession(started.id, {
    title: "Mock Correction Left",
    started_at: start,
    stopped_at: stop,
    activity_zone: "recovery",
    note: "corrected note",
  });

  assert.equal(updated?.work_item_title, "Mock Correction Left");
  assert.equal(updated?.activity_zone, "recovery");
  assert.equal(updated?.note, "corrected note");
  assert.equal(updated?.active_seconds, 180);

  const missed = store.createStoppedFocusSession({
    title: "Mock Correction Missed",
    started_at: new Date(now + 300_000).toISOString(),
    stopped_at: new Date(now + 600_000).toISOString(),
    activity_zone: "coordination",
    note: "added later",
  });

  assert.equal(missed?.state, "stopped");
  assert.equal(missed?.work_item_title, "Mock Correction Missed");
  assert.equal(missed?.activity_zone, "coordination");
  assert.equal(missed?.note, "added later");
  assert.equal(missed?.active_seconds, 300);
  assert.equal(store.getActiveFocusSession(), undefined);

  const split = store.splitFocusSession(started.id, {
    split_at: splitAt,
    right_title: "Mock Correction Right",
    right_note: "right note",
  });

  assert.ok(split);
  assert.equal(split.left.active_seconds, 60);
  assert.equal(split.right.active_seconds, 120);
  assert.equal(split.right.work_item_title, "Mock Correction Right");
  assert.equal(split.right.activity_zone, "work");

  const edited = store.updateWorkItem(split.right.work_item_id!, {
    title: "Mock Correction Right Edited",
    type: "project",
    activity_zone: "coordination",
    note: "edited note",
  });

  assert.equal(edited?.title, "Mock Correction Right Edited");
  assert.equal(edited?.type, "project");
  assert.equal(edited?.activity_zone, "coordination");

  const beforeZoneCorrection = store.listFocusSessions(
    new Date(now - 240_000).toISOString(),
    new Date(now + 60_000).toISOString()
  );
  const rightBeforeZoneCorrection = beforeZoneCorrection.find((session) => session.id === split.right.id);
  assert.equal(rightBeforeZoneCorrection?.work_item_title, "Mock Correction Right Edited");
  assert.equal(rightBeforeZoneCorrection?.activity_zone, "work");

  const zoneCorrected = store.updateFocusSession(split.right.id, {
    activity_zone: "coordination",
  });
  assert.equal(zoneCorrected?.activity_zone, "coordination");

  const eventWindowStart = new Date(Date.now() - 60_000).toISOString();
  const event = store.addWorkItemEvent({
    id: split.right.work_item_id!,
    text: "timestamped mock event",
    focus_session_id: split.right.id,
  });

  assert.equal(event?.kind, "note_added");
  assert.equal(event?.text, "timestamped mock event");
  assert.equal(event?.focus_session_id, split.right.id);

  const events = store.listWorkItemEvents({
    id: split.right.work_item_id!,
    from: eventWindowStart,
    to: new Date(Date.now() + 60_000).toISOString(),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].text, "timestamped mock event");

  const updatedEvent = store.updateWorkItemEvent(event!.id, "edited timestamped mock event");
  assert.equal(updatedEvent?.text, "edited timestamped mock event");

  const deletedEvent = store.deleteWorkItemEvent(event!.id);
  assert.equal(deletedEvent, true);

  const eventsAfterDelete = store.listWorkItemEvents({
    id: split.right.work_item_id!,
    from: eventWindowStart,
    to: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(eventsAfterDelete.length, 0);

  const listed = store.listFocusSessions(
    new Date(now - 240_000).toISOString(),
    new Date(now + 660_000).toISOString()
  );
  const right = listed.find((session) => session.id === split.right.id);

  assert.equal(listed.length, 3);
  assert.equal(right?.work_item_title, "Mock Correction Right Edited");
  assert.equal(right?.activity_zone, "coordination");

  const inventory = store.listWorkItems(
    undefined,
    undefined,
    {
      from: new Date(now - 240_000).toISOString(),
      to: new Date(now + 60_000).toISOString(),
    }
  );
  const editedItem = inventory.find((item) => item.id === split.right.work_item_id);
  assert.equal(editedItem?.today_active_seconds, 120);
  assert.equal(editedItem?.total_active_seconds, 120);
});
