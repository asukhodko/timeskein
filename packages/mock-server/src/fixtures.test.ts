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

  const converted = store.convertCaptureToWorkItem(capture.id);
  assert.equal(converted.capture?.state, "converted");
  assert.equal(store.getActiveFocusSession()?.id, focus.id);
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
    note: "corrected note",
  });

  assert.equal(updated?.work_item_title, "Mock Correction Left");
  assert.equal(updated?.note, "corrected note");
  assert.equal(updated?.active_seconds, 180);

  const split = store.splitFocusSession(started.id, {
    split_at: splitAt,
    right_title: "Mock Correction Right",
    right_note: "right note",
  });

  assert.ok(split);
  assert.equal(split.left.active_seconds, 60);
  assert.equal(split.right.active_seconds, 120);
  assert.equal(split.right.work_item_title, "Mock Correction Right");

  const edited = store.updateWorkItem(split.right.work_item_id!, {
    title: "Mock Correction Right Edited",
    type: "project",
    activity_zone: "coordination",
    note: "edited note",
  });

  assert.equal(edited?.title, "Mock Correction Right Edited");
  assert.equal(edited?.type, "project");
  assert.equal(edited?.activity_zone, "coordination");

  const listed = store.listFocusSessions(
    new Date(now - 240_000).toISOString(),
    new Date(now + 60_000).toISOString()
  );
  const right = listed.find((session) => session.id === split.right.id);

  assert.equal(listed.length, 2);
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
