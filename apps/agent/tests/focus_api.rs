use std::sync::Arc;

use chrono::{Duration, Utc};
use serde_json::json;
use sqlx::Row;
use tempfile::tempdir;
use timeskein_agent::api::{
    handle_capture_append_to_work_item_event, handle_capture_convert_to_work_item,
    handle_capture_create, handle_capture_delete, handle_capture_update, handle_day_event_add,
    handle_day_event_delete, handle_day_event_list, handle_day_event_update,
    handle_focus_create_stopped, handle_focus_list, handle_focus_split, handle_focus_start,
    handle_focus_stop, handle_focus_update, handle_inventory_list, handle_label_create,
    handle_ref_remove, handle_taxonomy_list, handle_track_create, handle_track_update,
    handle_work_item_add_event, handle_work_item_create, handle_work_item_delete_event,
    handle_work_item_events, handle_work_item_set_semantics, handle_work_item_update,
    handle_work_item_update_event,
};
use timeskein_agent::{db::Database, AppState};
use tokio::sync::RwLock;

async fn test_state() -> Arc<RwLock<AppState>> {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("timeskein-test.db");
    let db = Database::new(&db_path).await.expect("database");

    // Keep the directory alive for the test process by leaking it. The SQLite
    // file is tiny and test processes are short-lived.
    Box::leak(Box::new(dir));

    Arc::new(RwLock::new(AppState {
        db,
        start_time: std::time::Instant::now(),
    }))
}

#[tokio::test]
async fn semantic_taxonomy_api_assigns_and_snapshots_focus_history() {
    let state = test_state().await;
    let root = handle_track_create(&state, json!({ "title": "Work" }), "root")
        .await
        .expect("root track");
    let root_id = root["id"].as_str().unwrap().to_string();
    let child = handle_track_create(
        &state,
        json!({ "title": "Timeskein", "parent_track_id": root_id }),
        "child",
    )
    .await
    .expect("child track");
    let child_id = child["id"].as_str().unwrap().to_string();
    let label = handle_label_create(&state, json!({ "title": "dogfood" }), "label")
        .await
        .expect("label");
    let label_id = label["id"].as_str().unwrap().to_string();

    let created = handle_work_item_create(
        &state,
        json!({
            "title": "Semantic API Work",
            "type": "task",
            "state": "active",
            "track_id": child_id,
            "label_ids": [label_id],
        }),
        "create-item",
    )
    .await
    .expect("create classified item");
    let work_item_id = created["id"].as_str().unwrap().to_string();
    let focus_session_id = created["focus_session_id"].as_str().unwrap().to_string();

    let inventory = handle_inventory_list(&state, json!({}), "inventory")
        .await
        .expect("inventory");
    let item = inventory["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"].as_str() == Some(work_item_id.as_str()))
        .unwrap();
    assert_eq!(item["track"]["id"].as_str(), Some(child_id.as_str()));
    assert_eq!(item["labels"][0]["id"].as_str(), Some(label_id.as_str()));

    handle_work_item_set_semantics(
        &state,
        json!({ "id": work_item_id, "track_id": root_id, "label_ids": [] }),
        "reassign",
    )
    .await
    .expect("reassign");

    let snapshot_row = {
        let state = state.read().await;
        sqlx::query(
            "SELECT track_id, track_path_json FROM focus_session_semantic_snapshots WHERE focus_session_id = ?1",
        )
        .bind(&focus_session_id)
        .fetch_one(state.db.pool())
        .await
        .unwrap()
    };
    assert_eq!(snapshot_row.get::<String, _>("track_id"), child_id);
    assert!(snapshot_row
        .get::<String, _>("track_path_json")
        .contains("Timeskein"));

    let created_event_snapshot = {
        let state = state.read().await;
        sqlx::query(
            "SELECT s.track_id, s.track_path_json
             FROM work_item_events e
             JOIN work_item_event_semantic_snapshots s ON s.work_item_event_id = e.id
             WHERE e.work_item_id = ?1 AND e.kind = 'created'",
        )
        .bind(&work_item_id)
        .fetch_one(state.db.pool())
        .await
        .unwrap()
    };
    assert_eq!(
        created_event_snapshot.get::<String, _>("track_id"),
        child_id
    );
    assert!(created_event_snapshot
        .get::<String, _>("track_path_json")
        .contains("Timeskein"));

    let taxonomy = handle_taxonomy_list(&state, json!({}), "taxonomy")
        .await
        .expect("taxonomy");
    assert_eq!(taxonomy["tracks"].as_array().unwrap().len(), 2);

    let cycle = handle_track_update(
        &state,
        json!({ "id": root_id, "parent_track_id": child_id }),
        "cycle",
    )
    .await;
    assert!(cycle.is_err());

    handle_focus_stop(&state, json!({}), "stop")
        .await
        .expect("stop");
}

#[tokio::test]
async fn typed_evidence_keeps_ref_and_track_snapshots_after_current_links_change() {
    let state = test_state().await;
    let root = handle_track_create(&state, json!({ "title": "Personal Projects" }), "root")
        .await
        .expect("root track");
    let root_id = root["id"].as_str().unwrap().to_string();
    let child = handle_track_create(
        &state,
        json!({ "title": "Timeskein", "parent_track_id": root_id }),
        "child",
    )
    .await
    .expect("child track");
    let child_id = child["id"].as_str().unwrap().to_string();
    let created = handle_work_item_create(
        &state,
        json!({
            "title": "Evidence-backed Track story",
            "type": "project",
            "state": "active",
            "track_id": child_id,
        }),
        "create-item",
    )
    .await
    .expect("create classified item");
    let work_item_id = created["id"].as_str().unwrap().to_string();
    let focus_session_id = created["focus_session_id"].as_str().unwrap().to_string();

    let evidence = handle_work_item_add_event(
        &state,
        json!({
            "id": work_item_id,
            "text": "Track report now links the result to a stable artifact",
            "focus_session_id": focus_session_id,
            "evidence_kind": "result",
            "new_ref": {
                "kind": "issue_key",
                "value": "time-42"
            }
        }),
        "evidence",
    )
    .await
    .expect("typed evidence");
    let event_id = evidence["id"].as_str().unwrap().to_string();
    let ref_id = evidence["evidence"]["refs"][0]["ref_id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(evidence["evidence"]["kind"].as_str(), Some("result"));
    assert_eq!(
        evidence["evidence"]["focus_session_id"].as_str(),
        Some(focus_session_id.as_str())
    );
    assert_eq!(
        evidence["evidence"]["refs"][0]["value"].as_str(),
        Some("time-42")
    );

    let decision = handle_work_item_add_event(
        &state,
        json!({
            "id": work_item_id,
            "text": "Use the same artifact for the rollout decision",
            "focus_session_id": focus_session_id,
            "evidence_kind": "decision",
            "ref_ids": [ref_id]
        }),
        "decision-evidence",
    )
    .await
    .expect("evidence with existing ref");
    assert_eq!(decision["evidence"]["kind"].as_str(), Some("decision"));
    assert_eq!(
        decision["evidence"]["refs"][0]["ref_id"].as_str(),
        Some(ref_id.as_str())
    );
    let current = timeskein_agent::api::handle_focus_current(&state, json!({}), "current")
        .await
        .expect("current focus after evidence");
    assert_eq!(
        current["session"]["id"].as_str(),
        Some(focus_session_id.as_str()),
        "recording evidence stopped or switched the active focus"
    );

    handle_work_item_set_semantics(
        &state,
        json!({ "id": work_item_id, "track_id": root_id, "label_ids": [] }),
        "reassign",
    )
    .await
    .expect("reassign item");
    handle_ref_remove(
        &state,
        json!({ "work_item_id": work_item_id, "ref_id": ref_id }),
        "remove-ref",
    )
    .await
    .expect("remove current ref");

    let listed = handle_work_item_events(&state, json!({ "id": work_item_id }), "list-evidence")
        .await
        .expect("list evidence");
    let event = listed["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["id"].as_str() == Some(event_id.as_str()))
        .expect("evidence event");
    assert_eq!(event["evidence"]["kind"].as_str(), Some("result"));
    assert_eq!(
        event["evidence"]["refs"][0]["value"].as_str(),
        Some("time-42")
    );
    assert!(event["evidence"]["refs"][0]["ref_id"].is_null());

    let state_guard = state.read().await;
    let semantic = sqlx::query(
        "SELECT track_id, track_path_json
           FROM work_item_event_semantic_snapshots
          WHERE work_item_event_id = ?1",
    )
    .bind(&event_id)
    .fetch_one(state_guard.db.pool())
    .await
    .expect("semantic snapshot");
    assert_eq!(semantic.get::<String, _>("track_id"), child_id);
    assert!(semantic
        .get::<String, _>("track_path_json")
        .contains("Timeskein"));
    drop(state_guard);

    handle_focus_stop(&state, json!({}), "stop")
        .await
        .expect("stop focus");
}

#[tokio::test]
async fn capture_conversion_preserves_origin_as_work_item_event() {
    let state = test_state().await;

    let started = handle_focus_start(
        &state,
        json!({
            "title": "Capture Convert Origin Focus",
            "target_seconds": 60,
        }),
        "start",
    )
    .await
    .expect("start");
    let session_id = started["id"].as_str().expect("session id").to_string();

    let capture = handle_capture_create(
        &state,
        json!({
            "text": "convert me without losing origin",
        }),
        "capture",
    )
    .await
    .expect("capture");
    let capture_id = capture["id"].as_str().expect("capture id").to_string();

    let converted = handle_capture_convert_to_work_item(
        &state,
        json!({
            "id": capture_id,
        }),
        "convert",
    )
    .await
    .expect("convert");
    let work_item_id = converted["work_item_id"]
        .as_str()
        .expect("work item id")
        .to_string();
    let event_id = converted["event"]["id"]
        .as_str()
        .expect("event id")
        .to_string();

    assert_eq!(converted["capture"]["state"].as_str(), Some("converted"));
    assert_eq!(
        converted["capture"]["work_item_id"].as_str(),
        Some(work_item_id.as_str())
    );
    assert_eq!(converted["event"]["kind"].as_str(), Some("note_added"));
    assert_eq!(
        converted["event"]["text"].as_str(),
        Some("convert me without losing origin")
    );
    assert_eq!(
        converted["event"]["focus_session_id"].as_str(),
        Some(session_id.as_str())
    );
    assert_eq!(
        converted["event"]["payload"]["source_capture_id"].as_str(),
        Some(capture_id.as_str())
    );
    assert_eq!(
        converted["event"]["payload"]["origin"].as_str(),
        Some("capture_convert_to_work_item")
    );

    let listed_events = handle_work_item_events(
        &state,
        json!({
            "id": work_item_id,
            "from": (Utc::now() - Duration::minutes(1)).to_rfc3339(),
            "to": (Utc::now() + Duration::minutes(1)).to_rfc3339(),
        }),
        "list-events",
    )
    .await
    .expect("list events");
    let events = listed_events["events"].as_array().expect("events");
    assert!(events.iter().any(|event| {
        event["id"].as_str() == Some(event_id.as_str())
            && event["text"].as_str() == Some("convert me without losing origin")
    }));
}

#[tokio::test]
async fn focus_start_switch_and_active_work_item_stay_coherent() {
    let state = test_state().await;

    let first = handle_focus_start(
        &state,
        json!({
            "title": "Coherent Focus A",
            "target_seconds": 60,
        }),
        "start-a",
    )
    .await
    .expect("start A");
    let first_id = first["id"].as_str().expect("first session id").to_string();
    let first_item_id = first["work_item_id"]
        .as_str()
        .expect("first work item id")
        .to_string();

    let continued = handle_focus_start(
        &state,
        json!({
            "title": "Coherent Focus A",
            "target_seconds": 60,
        }),
        "continue-a",
    )
    .await
    .expect("continue A");
    assert_eq!(continued["id"].as_str(), Some(first_id.as_str()));
    assert_eq!(
        continued["work_item_id"].as_str(),
        Some(first_item_id.as_str())
    );

    let switched = handle_focus_start(
        &state,
        json!({
            "title": "Coherent Focus B",
            "target_seconds": 60,
        }),
        "switch-b",
    )
    .await
    .expect("switch B");
    assert_ne!(switched["id"].as_str(), Some(first_id.as_str()));
    assert_ne!(
        switched["work_item_id"].as_str(),
        Some(first_item_id.as_str())
    );

    let inventory = handle_inventory_list(&state, json!({}), "inventory")
        .await
        .expect("inventory");
    let active_items = inventory["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter(|item| item["state"].as_str() == Some("active"))
        .collect::<Vec<_>>();

    assert_eq!(active_items.len(), 1);
    assert_eq!(
        active_items[0]["id"].as_str(),
        switched["work_item_id"].as_str()
    );
}

#[tokio::test]
async fn capture_can_be_appended_to_linked_work_item_event_without_interrupting_focus() {
    let state = test_state().await;

    let started = handle_focus_start(
        &state,
        json!({
            "title": "Capture Event Focus",
            "target_seconds": 60,
        }),
        "start",
    )
    .await
    .expect("start");
    let session_id = started["id"].as_str().expect("session id").to_string();
    let work_item_id = started["work_item_id"]
        .as_str()
        .expect("work item id")
        .to_string();

    let capture = handle_capture_create(
        &state,
        json!({
            "text": "remember this as an event",
        }),
        "capture",
    )
    .await
    .expect("capture");
    let capture_id = capture["id"].as_str().expect("capture id").to_string();

    assert_eq!(capture["state"].as_str(), Some("open"));
    assert_eq!(
        capture["focus_session_id"].as_str(),
        Some(session_id.as_str())
    );

    let appended = handle_capture_append_to_work_item_event(
        &state,
        json!({
            "id": capture_id,
        }),
        "append",
    )
    .await
    .expect("append");

    assert_eq!(
        appended["work_item_id"].as_str(),
        Some(work_item_id.as_str())
    );
    assert_eq!(appended["capture"]["state"].as_str(), Some("converted"));
    assert_eq!(
        appended["event"]["text"].as_str(),
        Some("remember this as an event")
    );
    assert_eq!(
        appended["event"]["focus_session_id"].as_str(),
        Some(session_id.as_str())
    );
    assert_eq!(
        appended["event"]["payload"]["source_capture_id"].as_str(),
        Some(capture_id.as_str())
    );
    assert_eq!(
        appended["event"]["payload"]["origin"].as_str(),
        Some("capture_append_to_work_item_event")
    );

    let listed_events = handle_work_item_events(
        &state,
        json!({
            "id": work_item_id,
            "from": (Utc::now() - Duration::minutes(1)).to_rfc3339(),
            "to": (Utc::now() + Duration::minutes(1)).to_rfc3339(),
        }),
        "list-events",
    )
    .await
    .expect("list events");
    let events = listed_events["events"].as_array().expect("events");
    assert!(events.iter().any(|event| {
        event["kind"].as_str() == Some("note_added")
            && event["text"].as_str() == Some("remember this as an event")
    }));

    let inventory = handle_inventory_list(&state, json!({}), "inventory")
        .await
        .expect("inventory");
    let active_items = inventory["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter(|item| item["state"].as_str() == Some("active"))
        .collect::<Vec<_>>();
    assert_eq!(active_items.len(), 1);
    assert_eq!(active_items[0]["id"].as_str(), Some(work_item_id.as_str()));
}

#[tokio::test]
async fn open_capture_can_be_updated_or_deleted_without_interrupting_focus() {
    let state = test_state().await;

    let started = handle_focus_start(
        &state,
        json!({
            "title": "Capture Cleanup Focus",
            "target_seconds": 60,
        }),
        "start",
    )
    .await
    .expect("start");
    let session_id = started["id"].as_str().expect("session id").to_string();

    let capture = handle_capture_create(
        &state,
        json!({
            "text": "rough reminder",
        }),
        "capture",
    )
    .await
    .expect("capture");
    let capture_id = capture["id"].as_str().expect("capture id").to_string();

    let updated = handle_capture_update(
        &state,
        json!({
            "id": capture_id,
            "text": "polished reminder",
        }),
        "update-capture",
    )
    .await
    .expect("update capture");

    assert_eq!(updated["text"].as_str(), Some("polished reminder"));
    assert_eq!(updated["state"].as_str(), Some("open"));

    let current = timeskein_agent::api::handle_focus_current(&state, json!({}), "current")
        .await
        .expect("current focus");
    assert_eq!(current["session"]["id"].as_str(), Some(session_id.as_str()));

    handle_capture_delete(
        &state,
        json!({
            "id": updated["id"].as_str().expect("updated capture id"),
        }),
        "delete-capture",
    )
    .await
    .expect("delete capture");

    let current_after_delete =
        timeskein_agent::api::handle_focus_current(&state, json!({}), "current-after-delete")
            .await
            .expect("current after delete");
    assert_eq!(
        current_after_delete["session"]["id"].as_str(),
        Some(session_id.as_str())
    );

    let resolved = handle_capture_create(
        &state,
        json!({
            "text": "processed reminder",
        }),
        "processed-capture",
    )
    .await
    .expect("processed capture");
    let resolved_id = resolved["id"].as_str().expect("resolved id").to_string();
    timeskein_agent::api::handle_capture_resolve(
        &state,
        json!({
            "id": resolved_id,
        }),
        "resolve-capture",
    )
    .await
    .expect("resolve capture");

    let blocked_update = handle_capture_update(
        &state,
        json!({
            "id": resolved["id"].as_str().expect("capture id"),
            "text": "should not update",
        }),
        "blocked-update",
    )
    .await;
    assert!(blocked_update.is_err());
}

#[tokio::test]
async fn day_event_can_be_added_edited_and_deleted_without_interrupting_focus() {
    let state = test_state().await;

    let started = handle_focus_start(
        &state,
        json!({
            "title": "Day Event Focus",
            "target_seconds": 60,
        }),
        "start",
    )
    .await
    .expect("start");
    let session_id = started["id"].as_str().expect("session id").to_string();

    let linked_event = handle_day_event_add(
        &state,
        json!({
            "text": "buffer before meeting felt expensive",
            "focus_session_id": session_id,
            "activity_zone": "work",
        }),
        "add-day-event",
    )
    .await
    .expect("add day event");

    assert_eq!(linked_event["kind"].as_str(), Some("note_added"));
    assert_eq!(
        linked_event["text"].as_str(),
        Some("buffer before meeting felt expensive")
    );
    assert_eq!(
        linked_event["focus_session_id"].as_str(),
        Some(session_id.as_str())
    );
    assert_eq!(linked_event["activity_zone"].as_str(), Some("work"));

    let current = timeskein_agent::api::handle_focus_current(&state, json!({}), "current")
        .await
        .expect("current focus");
    assert_eq!(current["session"]["id"].as_str(), Some(session_id.as_str()));

    let free_event = handle_day_event_add(
        &state,
        json!({
            "text": "recovery was not enough",
            "activity_zone": "recovery",
        }),
        "add-free-day-event",
    )
    .await
    .expect("add free day event");
    assert_eq!(free_event["activity_zone"].as_str(), Some("recovery"));
    assert!(free_event.get("focus_session_id").is_none());

    let listed = handle_day_event_list(
        &state,
        json!({
            "from": (Utc::now() - Duration::minutes(1)).to_rfc3339(),
            "to": (Utc::now() + Duration::minutes(1)).to_rfc3339(),
        }),
        "list-day-events",
    )
    .await
    .expect("list day events");
    let events = listed["events"].as_array().expect("events");
    assert_eq!(events.len(), 2);

    let linked_id = linked_event["id"].as_str().expect("linked event id");
    let updated = handle_day_event_update(
        &state,
        json!({
            "id": linked_id,
            "text": "edited day event",
            "activity_zone": "coordination",
        }),
        "update-day-event",
    )
    .await
    .expect("update day event");
    assert_eq!(updated["text"].as_str(), Some("edited day event"));
    assert_eq!(updated["activity_zone"].as_str(), Some("coordination"));

    let free_id = free_event["id"].as_str().expect("free event id");
    let deleted = handle_day_event_delete(
        &state,
        json!({
            "id": free_id,
        }),
        "delete-day-event",
    )
    .await
    .expect("delete day event");
    assert_eq!(deleted["success"].as_bool(), Some(true));

    let listed_after_delete = handle_day_event_list(
        &state,
        json!({
            "from": (Utc::now() - Duration::minutes(1)).to_rfc3339(),
            "to": (Utc::now() + Duration::minutes(1)).to_rfc3339(),
        }),
        "list-day-events-after-delete",
    )
    .await
    .expect("list day events after delete");
    let events_after_delete = listed_after_delete["events"].as_array().expect("events");
    assert_eq!(events_after_delete.len(), 1);
    assert_eq!(events_after_delete[0]["id"].as_str(), Some(linked_id));
}

#[tokio::test]
async fn stopped_focus_block_can_be_updated_split_and_reported_correctly() {
    let state = test_state().await;

    let started = handle_focus_start(
        &state,
        json!({
            "title": "Correction Original",
            "target_seconds": 60,
        }),
        "start",
    )
    .await
    .expect("start");
    let started_id = started["id"].as_str().expect("session id").to_string();

    let stopped = handle_focus_stop(
        &state,
        json!({
            "note": "original note",
        }),
        "stop",
    )
    .await
    .expect("stop");
    assert_eq!(stopped["id"].as_str(), Some(started_id.as_str()));

    let start = Utc::now() - Duration::minutes(3);
    let split_at = start + Duration::minutes(1);
    let end = start + Duration::minutes(3);

    let updated = handle_focus_update(
        &state,
        json!({
            "id": started_id,
            "title": "Correction Left",
            "started_at": start.to_rfc3339(),
            "stopped_at": end.to_rfc3339(),
            "activity_zone": "recovery",
            "note": "corrected note",
        }),
        "update",
    )
    .await
    .expect("update");

    assert_eq!(updated["state"].as_str(), Some("stopped"));
    assert_eq!(updated["work_item_title"].as_str(), Some("Correction Left"));
    assert_eq!(updated["activity_zone"].as_str(), Some("recovery"));
    assert_eq!(updated["note"].as_str(), Some("corrected note"));
    assert_eq!(updated["active_seconds"].as_i64(), Some(180));

    let missed_start = end + Duration::minutes(10);
    let missed_end = missed_start + Duration::minutes(20);
    let missed = handle_focus_create_stopped(
        &state,
        json!({
            "title": "Correction Missed",
            "started_at": missed_start.to_rfc3339(),
            "stopped_at": missed_end.to_rfc3339(),
            "activity_zone": "coordination",
            "note": "added after the fact",
        }),
        "create-stopped",
    )
    .await
    .expect("create stopped");

    assert_eq!(missed["state"].as_str(), Some("stopped"));
    assert_eq!(
        missed["work_item_title"].as_str(),
        Some("Correction Missed")
    );
    assert_eq!(missed["activity_zone"].as_str(), Some("coordination"));
    assert_eq!(missed["note"].as_str(), Some("added after the fact"));
    assert_eq!(missed["active_seconds"].as_i64(), Some(1200));

    let current_after_missed =
        timeskein_agent::api::handle_focus_current(&state, json!({}), "current-after-missed")
            .await
            .expect("current after missed block");
    assert!(
        current_after_missed["session"].is_null(),
        "post-factum block unexpectedly started an active timer"
    );

    let split = handle_focus_split(
        &state,
        json!({
            "id": updated["id"].as_str().expect("updated id"),
            "split_at": split_at.to_rfc3339(),
            "right_title": "Correction Right",
            "right_note": "right note",
        }),
        "split",
    )
    .await
    .expect("split");

    assert_eq!(split["left"]["id"].as_str(), updated["id"].as_str());
    assert_ne!(split["right"]["id"].as_str(), updated["id"].as_str());
    assert_eq!(
        split["right"]["work_item_title"].as_str(),
        Some("Correction Right")
    );
    assert_eq!(split["right"]["note"].as_str(), Some("right note"));
    assert_eq!(split["left"]["active_seconds"].as_i64(), Some(60));
    assert_eq!(split["right"]["active_seconds"].as_i64(), Some(120));
    assert_eq!(split["right"]["activity_zone"].as_str(), Some("work"));

    let right_item_id = split["right"]["work_item_id"]
        .as_str()
        .expect("right item id")
        .to_string();
    let right_session_id = split["right"]["id"].as_str().expect("right session id");
    let edited_item = handle_work_item_update(
        &state,
        json!({
            "id": right_item_id.clone(),
            "title": "Correction Right Edited",
            "type": "project",
            "activity_zone": "coordination",
            "note": "edited item note",
        }),
        "edit-item",
    )
    .await
    .expect("edit item");

    assert_eq!(
        edited_item["title"].as_str(),
        Some("Correction Right Edited")
    );
    assert_eq!(edited_item["type"].as_str(), Some("project"));
    assert_eq!(edited_item["activity_zone"].as_str(), Some("coordination"));
    assert_eq!(edited_item["note"].as_str(), Some("edited item note"));

    let listed_before_zone_correction = handle_focus_list(
        &state,
        json!({
            "from": (start - Duration::minutes(1)).to_rfc3339(),
            "to": (end + Duration::minutes(1)).to_rfc3339(),
        }),
        "list-before-zone-correction",
    )
    .await
    .expect("list before zone correction");
    let sessions_before_zone_correction = listed_before_zone_correction["sessions"]
        .as_array()
        .expect("sessions before zone correction");
    let right_before_zone_correction = sessions_before_zone_correction
        .iter()
        .find(|session| session["id"].as_str() == Some(right_session_id))
        .expect("right session before zone correction");

    assert_eq!(
        right_before_zone_correction["work_item_title"].as_str(),
        Some("Correction Right Edited")
    );
    assert_eq!(
        right_before_zone_correction["activity_zone"].as_str(),
        Some("work")
    );

    let right_zone_corrected = handle_focus_update(
        &state,
        json!({
            "id": right_session_id,
            "activity_zone": "coordination",
        }),
        "correct-right-zone",
    )
    .await
    .expect("correct right zone");

    assert_eq!(
        right_zone_corrected["activity_zone"].as_str(),
        Some("coordination")
    );

    let event_window_start = Utc::now() - Duration::minutes(1);
    let added_event = handle_work_item_add_event(
        &state,
        json!({
            "id": right_item_id.clone(),
            "text": "timestamped implementation event",
            "focus_session_id": right_session_id,
        }),
        "add-event",
    )
    .await
    .expect("add event");

    assert_eq!(added_event["kind"].as_str(), Some("note_added"));
    assert_eq!(
        added_event["text"].as_str(),
        Some("timestamped implementation event")
    );
    assert_eq!(
        added_event["focus_session_id"].as_str(),
        Some(right_session_id)
    );

    let listed_events = handle_work_item_events(
        &state,
        json!({
            "id": right_item_id.clone(),
            "from": event_window_start.to_rfc3339(),
            "to": (Utc::now() + Duration::minutes(1)).to_rfc3339(),
        }),
        "list-events",
    )
    .await
    .expect("list events");
    let events = listed_events["events"].as_array().expect("events");
    let note_added_event = events
        .iter()
        .find(|event| event["kind"].as_str() == Some("note_added"))
        .expect("note_added event");

    assert_eq!(
        note_added_event["text"].as_str(),
        Some("timestamped implementation event")
    );
    let event_id = added_event["id"].as_str().expect("event id").to_string();

    let updated_event = handle_work_item_update_event(
        &state,
        json!({
            "id": event_id.clone(),
            "text": "edited timestamped implementation event",
        }),
        "update-event",
    )
    .await
    .expect("update event");

    assert_eq!(
        updated_event["text"].as_str(),
        Some("edited timestamped implementation event")
    );

    let deleted_event = handle_work_item_delete_event(
        &state,
        json!({
            "id": event_id.clone(),
        }),
        "delete-event",
    )
    .await
    .expect("delete event");

    assert_eq!(deleted_event["success"].as_bool(), Some(true));

    let listed_after_delete = handle_work_item_events(
        &state,
        json!({
            "id": right_item_id.clone(),
            "from": event_window_start.to_rfc3339(),
            "to": (Utc::now() + Duration::minutes(1)).to_rfc3339(),
        }),
        "list-events-after-delete",
    )
    .await
    .expect("list events after delete");
    let events_after_delete = listed_after_delete["events"].as_array().expect("events");
    assert!(
        events_after_delete
            .iter()
            .all(|event| event["id"].as_str() != Some(event_id.as_str())),
        "deleted Work Item event remained visible"
    );

    let listed = handle_focus_list(
        &state,
        json!({
            "from": (start - Duration::minutes(1)).to_rfc3339(),
            "to": (missed_end + Duration::minutes(1)).to_rfc3339(),
        }),
        "list",
    )
    .await
    .expect("list");
    let sessions = listed["sessions"].as_array().expect("sessions");

    assert_eq!(sessions.len(), 3);
    assert_eq!(listed["active_seconds_total"].as_i64(), Some(1380));
    assert_eq!(
        sessions[1]["work_item_title"].as_str(),
        Some("Correction Right Edited")
    );
    assert_eq!(sessions[1]["activity_zone"].as_str(), Some("coordination"));
    assert_eq!(
        sessions[2]["work_item_title"].as_str(),
        Some("Correction Missed")
    );

    let inventory = handle_inventory_list(
        &state,
        json!({
            "focus_window": {
                "from": (start - Duration::minutes(1)).to_rfc3339(),
                "to": (missed_end + Duration::minutes(1)).to_rfc3339(),
            }
        }),
        "inventory",
    )
    .await
    .expect("inventory");
    let items = inventory["items"].as_array().expect("items");
    let right_item = items
        .iter()
        .find(|item| item["title"].as_str() == Some("Correction Right Edited"))
        .expect("right item in inventory");

    assert_eq!(right_item["today_active_seconds"].as_i64(), Some(120));
    assert_eq!(right_item["total_active_seconds"].as_i64(), Some(120));
}

#[tokio::test]
async fn stopped_focus_blocks_cannot_overlap() {
    let state = test_state().await;
    let start = Utc::now() - Duration::hours(2);
    let middle = start + Duration::minutes(30);
    let end = start + Duration::hours(1);

    let first = handle_focus_create_stopped(
        &state,
        json!({
            "title": "Overlap Guard First",
            "started_at": start.to_rfc3339(),
            "stopped_at": middle.to_rfc3339(),
        }),
        "create-first",
    )
    .await
    .expect("create first block");

    let touching = handle_focus_create_stopped(
        &state,
        json!({
            "title": "Overlap Guard Touching",
            "started_at": middle.to_rfc3339(),
            "stopped_at": end.to_rfc3339(),
        }),
        "create-touching",
    )
    .await
    .expect("touching boundaries are valid");

    let overlapping_create = handle_focus_create_stopped(
        &state,
        json!({
            "title": "Overlap Guard Rejected",
            "started_at": (start + Duration::minutes(20)).to_rfc3339(),
            "stopped_at": (middle + Duration::minutes(10)).to_rfc3339(),
        }),
        "create-overlap",
    )
    .await;
    assert!(
        overlapping_create.is_err(),
        "overlapping missed block was accepted"
    );

    let overlapping_update = handle_focus_update(
        &state,
        json!({
            "id": touching["id"].as_str().expect("touching id"),
            "started_at": (middle - Duration::minutes(1)).to_rfc3339(),
        }),
        "update-overlap",
    )
    .await;
    assert!(
        overlapping_update.is_err(),
        "overlapping correction was accepted"
    );

    let unchanged = {
        let state = state.read().await;
        state
            .db
            .get_focus_session(
                uuid::Uuid::parse_str(first["id"].as_str().expect("first id")).expect("uuid"),
            )
            .await
            .expect("read first")
            .expect("first exists")
            .0
    };
    assert_eq!(unchanged.started_at, start);
    assert_eq!(unchanged.stopped_at, Some(middle));
}

#[tokio::test]
async fn unicode_search_reuses_titles_and_dispatch_can_create_coordination_work() {
    let state = test_state().await;

    let created = handle_work_item_create(
        &state,
        json!({
            "title": "Проект Альфа",
            "type": "task",
            "state": "unknown",
        }),
        "create-rb",
    )
    .await
    .expect("create Cyrillic item");
    let work_item_id = created["id"].as_str().unwrap().to_string();

    let search = handle_inventory_list(
        &state,
        json!({ "filter": { "search": "проект альфа" } }),
        "search-lowercase",
    )
    .await
    .expect("Unicode search");
    assert_eq!(search["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        search["items"][0]["id"].as_str(),
        Some(work_item_id.as_str())
    );

    let reused = handle_focus_start(
        &state,
        json!({ "title": "ПРОЕКТ АЛЬФА" }),
        "reuse-uppercase",
    )
    .await
    .expect("reuse case-insensitive title");
    assert_eq!(reused["work_item_id"].as_str(), Some(work_item_id.as_str()));
    handle_focus_stop(&state, json!({}), "stop-rb")
        .await
        .expect("stop reused item");

    let dispatch = handle_focus_start(
        &state,
        json!({
            "title": "Возврат после перерыва",
            "activity_zone": "coordination",
        }),
        "start-dispatch",
    )
    .await
    .expect("start tracked dispatch");
    assert_eq!(dispatch["activity_zone"].as_str(), Some("coordination"));

    let mixed = handle_work_item_create(
        &state,
        json!({
            "title": "spirit-сode-daily-synс",
            "type": "task",
            "state": "unknown",
        }),
        "create-mixed-script",
    )
    .await
    .expect("create mixed-script item");
    let mixed_id = mixed["id"].as_str().unwrap();
    let mixed_search = handle_inventory_list(
        &state,
        json!({ "filter": { "search": "spirit-code-daily-sync" } }),
        "search-mixed-script",
    )
    .await
    .expect("homoglyph-tolerant search");
    assert!(mixed_search["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["id"].as_str() == Some(mixed_id)));
}
