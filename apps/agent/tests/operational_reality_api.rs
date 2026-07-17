use std::{path::PathBuf, sync::Arc};

use chrono::{Duration, Utc};
use serde_json::{json, Value};
use tempfile::TempDir;
use timeskein_agent::api::{
    handle_capture_create, handle_causal_record_list, handle_focus_create_stopped,
    handle_focus_start, handle_label_create, handle_operational_reality_follow_up_decision,
    handle_operational_reality_list, handle_operational_reality_set_next_action,
    handle_operational_reality_set_state, handle_track_create, handle_work_item_add_event,
    handle_work_item_create, handle_work_item_delete_event, handle_work_item_set_semantics,
    handle_work_item_update_event,
};
use timeskein_agent::{
    db::Database,
    domain::{
        CausalProvenance, CausalRecordKind, CausalSource, NewCausalRecord, OperationalSubjectKind,
    },
    AppState,
};
use tokio::sync::RwLock;
use uuid::Uuid;

async fn persistent_test_state() -> (TempDir, PathBuf, Arc<RwLock<AppState>>) {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("timeskein-operational-reality-test.db");
    let db = Database::new(&db_path).await.expect("database");
    let state = Arc::new(RwLock::new(AppState {
        db,
        start_time: std::time::Instant::now(),
    }));
    (dir, db_path, state)
}

fn item_by_title<'a>(reality: &'a Value, title: &str) -> &'a Value {
    reality["items"]
        .as_array()
        .expect("reality items")
        .iter()
        .find(|item| item["title"].as_str() == Some(title))
        .unwrap_or_else(|| panic!("Operational Reality item not found: {title}"))
}

#[tokio::test]
async fn corrections_are_append_only_historical_and_survive_reopen() {
    let (_dir, db_path, state) = persistent_test_state().await;
    let root = handle_track_create(&state, json!({ "title": "Personal Projects" }), "root")
        .await
        .expect("root track");
    let root_id = root["id"].as_str().unwrap().to_string();
    let track = handle_track_create(
        &state,
        json!({ "title": "Timeskein", "parent_track_id": root_id }),
        "track",
    )
    .await
    .expect("track");
    let track_id = track["id"].as_str().unwrap().to_string();
    let label = handle_label_create(&state, json!({ "title": "operational-reality" }), "label")
        .await
        .expect("label");
    let label_id = label["id"].as_str().unwrap().to_string();

    handle_operational_reality_set_state(
        &state,
        json!({
            "subject_kind": "track",
            "subject_id": track_id,
            "state": "waiting",
            "reason": "Track is waiting for its first real-day gate"
        }),
        "track-state",
    )
    .await
    .expect("track state");
    handle_operational_reality_set_next_action(
        &state,
        json!({
            "subject_kind": "track",
            "subject_id": track_id,
            "action": "set",
            "text": "Run the Track gate"
        }),
        "track-next-action",
    )
    .await
    .expect("track next action");

    let created = handle_work_item_create(
        &state,
        json!({
            "title": "Build Causal Work Spine",
            "type": "project",
            "track_id": track_id,
            "label_ids": [label_id],
        }),
        "create",
    )
    .await
    .expect("work item");
    let work_item_id = created["id"].as_str().unwrap().to_string();

    let legacy = handle_operational_reality_list(&state, json!({}), "legacy")
        .await
        .expect("legacy projection");
    let legacy_item = item_by_title(&legacy, "Build Causal Work Spine");
    assert_eq!(legacy_item["state"].as_str(), Some("unknown"));
    assert_eq!(
        legacy_item["state_provenance"].as_str(),
        Some("legacy_current")
    );
    assert_eq!(legacy_item["state_confirmed"].as_bool(), Some(false));
    assert_eq!(
        legacy_item["requires_attention"].as_bool(),
        Some(false),
        "an ordinary legacy item must not turn Operational Reality into another backlog"
    );
    let track_item = item_by_title(&legacy, "Timeskein");
    assert_eq!(track_item["subject_kind"].as_str(), Some("track"));
    assert_eq!(track_item["state"].as_str(), Some("waiting"));
    assert_eq!(track_item["requires_attention"].as_bool(), Some(true));
    assert_eq!(
        track_item["next_action"]["text"].as_str(),
        Some("Run the Track gate")
    );

    let asserted_at = Utc::now() - Duration::hours(2);
    let corrected_at = Utc::now() - Duration::hours(1);
    let asserted = handle_operational_reality_set_state(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": work_item_id,
            "state": "waiting",
            "reason": "Waiting for the first dogfood day",
            "occurred_at": asserted_at.to_rfc3339(),
        }),
        "assert-state",
    )
    .await
    .expect("assert state");
    let asserted_record_id = asserted["record"]["id"].as_str().unwrap().to_string();

    let next_action_at = asserted_at + Duration::minutes(5);
    handle_operational_reality_set_next_action(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": work_item_id,
            "action": "set",
            "text": "Run a real dogfood day",
            "occurred_at": next_action_at.to_rfc3339(),
        }),
        "next-action",
    )
    .await
    .expect("next action");
    handle_work_item_add_event(
        &state,
        json!({
            "id": work_item_id,
            "text": "Operational Reality API is usable",
            "evidence_kind": "result",
            "new_ref": { "kind": "issue_key", "value": "OR-TRACK-1" }
        }),
        "result-evidence",
    )
    .await
    .expect("result evidence");

    handle_work_item_set_semantics(
        &state,
        json!({ "id": work_item_id, "track_id": root_id, "label_ids": [] }),
        "reclassify",
    )
    .await
    .expect("reclassify current item");

    let rejected = handle_operational_reality_set_state(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": work_item_id,
            "state": "blocked",
            "occurred_at": corrected_at.to_rfc3339(),
        }),
        "missing-reason",
    )
    .await;
    assert!(
        rejected.is_err(),
        "known state corrections require a reason"
    );

    let corrected = handle_operational_reality_set_state(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": work_item_id,
            "state": "blocked",
            "reason": "Dogfood exposed a data-trust blocker",
            "occurred_at": corrected_at.to_rfc3339(),
        }),
        "correct-state",
    )
    .await
    .expect("correct state");
    assert_eq!(corrected["record"]["kind"].as_str(), Some("correction"));
    assert_eq!(
        corrected["record"]["supersedes_id"].as_str(),
        Some(asserted_record_id.as_str())
    );

    let historical_as_of = asserted_at + Duration::minutes(30);
    let historical = handle_operational_reality_list(
        &state,
        json!({ "as_of": historical_as_of.to_rfc3339() }),
        "historical",
    )
    .await
    .expect("historical projection");
    let historical_item = item_by_title(&historical, "Build Causal Work Spine");
    assert_eq!(historical_item["state"].as_str(), Some("waiting"));
    assert_eq!(
        historical_item["next_action"]["text"].as_str(),
        Some("Run a real dogfood day")
    );

    let current = handle_operational_reality_list(&state, json!({}), "current")
        .await
        .expect("current projection");
    let current_item = item_by_title(&current, "Build Causal Work Spine");
    assert_eq!(current_item["state"].as_str(), Some("blocked"));
    assert_eq!(current_item["state_provenance"].as_str(), Some("confirmed"));
    assert_eq!(
        current_item["facts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|fact| fact["summary"].as_str() == Some("Operational Reality API is usable"))
            .count(),
        1,
        "typed evidence must not appear twice through old and new adapters"
    );
    let current_track = item_by_title(&current, "Timeskein");
    let track_result = current_track["facts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|fact| fact["summary"].as_str() == Some("Operational Reality API is usable"))
        .expect("historically related result must explain the Track");
    assert_eq!(track_result["refs"][0]["kind"].as_str(), Some("issue_key"));
    assert_eq!(
        track_result["refs"][0]["value"].as_str(),
        Some("OR-TRACK-1")
    );
    let parent_track = item_by_title(&current, "Personal Projects");
    assert!(parent_track["facts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|fact| fact["summary"].as_str() == Some("Operational Reality API is usable")),
        "a recent child result must make the parent Track explainable even without a direct Track assertion"
    );
    assert_eq!(
        parent_track["requires_attention"].as_bool(),
        Some(false),
        "a parent Track supported only by child history belongs in Show all, not the decision queue"
    );

    let records = handle_causal_record_list(
        &state,
        json!({ "subject_kind": "work_item", "subject_id": work_item_id }),
        "records",
    )
    .await
    .expect("causal records");
    let next_action = records["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["kind"].as_str() == Some("next_action"))
        .expect("next action record");
    let result_record = records["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["kind"].as_str() == Some("result"))
        .expect("result causal record");
    assert_eq!(result_record["track_id"].as_str(), Some(track_id.as_str()));
    assert_eq!(
        next_action["track_snapshot"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()["title"]
            .as_str(),
        Some("Timeskein"),
        "historical semantic snapshot must survive current reclassification"
    );
    assert_eq!(
        next_action["labels_snapshot"][0]["title"].as_str(),
        Some("operational-reality")
    );

    let same_as_of_a = handle_operational_reality_list(
        &state,
        json!({ "as_of": historical_as_of.to_rfc3339() }),
        "deterministic-a",
    )
    .await
    .unwrap();
    let same_as_of_b = handle_operational_reality_list(
        &state,
        json!({ "as_of": historical_as_of.to_rfc3339() }),
        "deterministic-b",
    )
    .await
    .unwrap();
    assert_eq!(same_as_of_a["items"], same_as_of_b["items"]);
    assert_eq!(same_as_of_a["summary"], same_as_of_b["summary"]);

    let reopened_db = Database::new(&db_path).await.expect("reopen database");
    let reopened = Arc::new(RwLock::new(AppState {
        db: reopened_db,
        start_time: std::time::Instant::now(),
    }));
    let after_reopen = handle_operational_reality_list(&reopened, json!({}), "reopened")
        .await
        .expect("projection after reopen");
    let reopened_item = item_by_title(&after_reopen, "Build Causal Work Spine");
    assert_eq!(reopened_item["state"].as_str(), Some("blocked"));
    assert_eq!(
        reopened_item["next_action"]["text"].as_str(),
        Some("Run a real dogfood day")
    );
    assert_eq!(
        reopened_item["facts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|fact| fact["summary"].as_str() == Some("Operational Reality API is usable"))
            .count(),
        1,
        "restart backfill must not duplicate a current causal evidence record"
    );
}

#[tokio::test]
async fn reflection_decision_remains_visible_until_dated_follow_up() {
    let (_dir, _db_path, state) = persistent_test_state().await;
    let created = handle_work_item_create(
        &state,
        json!({ "title": "Protect the next Timeskein focus", "type": "task" }),
        "create",
    )
    .await
    .expect("work item");
    let work_item_id = created["id"].as_str().unwrap().to_string();
    let session_id = Uuid::new_v4();
    let decision_id = Uuid::new_v4();
    let decision_at = Utc::now() - Duration::hours(1);
    {
        let state = state.read().await;
        sqlx::query(
            "INSERT INTO reflection_sessions (
                id, created_at, period_from, period_to, profile,
                filters_json, summary, findings_json
             ) VALUES (?1, ?2, '2026-07-01', '2026-07-09', 'operational-reality', '{}', ?3, '[]')",
        )
        .bind(session_id.to_string())
        .bind(decision_at.to_rfc3339())
        .bind("Choose the next protected focus")
        .execute(state.db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO reflection_decisions (
                id, reflection_session_id, work_item_id, subject,
                decision, note, created_at
             ) VALUES (?1, ?2, ?3, ?4, 'protect-next-focus', ?5, ?6)",
        )
        .bind(decision_id.to_string())
        .bind(session_id.to_string())
        .bind(&work_item_id)
        .bind("Protect the next focus")
        .bind("Start with the causal projection")
        .bind(decision_at.to_rfc3339())
        .execute(state.db.pool())
        .await
        .unwrap();
    }

    let before = handle_operational_reality_list(&state, json!({}), "before")
        .await
        .expect("projection before follow-up");
    let before_item = item_by_title(&before, "Protect the next Timeskein focus");
    assert_eq!(before_item["state"].as_str(), Some("stale-important"));
    assert!(before_item["why_visible"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str().unwrap().contains("без follow-up")));

    let before_followup_as_of = Utc::now();
    handle_operational_reality_follow_up_decision(
        &state,
        json!({
            "decision_id": decision_id.to_string(),
            "status": "progressed",
            "note": "The projection is now implemented"
        }),
        "follow-up",
    )
    .await
    .expect("follow-up");

    let after = handle_operational_reality_list(&state, json!({}), "after")
        .await
        .expect("projection after follow-up");
    let after_item = item_by_title(&after, "Protect the next Timeskein focus");
    assert!(!after_item["why_visible"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str().unwrap().contains("без follow-up")));
    assert!(!after_item["facts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|fact| fact["reflection_decision_id"].as_str() == Some(&decision_id.to_string())));

    let historical = handle_operational_reality_list(
        &state,
        json!({ "as_of": before_followup_as_of.to_rfc3339() }),
        "historical-before-follow-up",
    )
    .await
    .expect("historical projection before follow-up");
    let historical_item = item_by_title(&historical, "Protect the next Timeskein focus");
    assert!(historical_item["why_visible"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value.as_str().unwrap().contains("без follow-up")));
}

#[tokio::test]
async fn evidence_reclassification_and_deletion_correct_the_projection_without_erasing_history() {
    let (_dir, _db_path, state) = persistent_test_state().await;
    let created = handle_work_item_create(
        &state,
        json!({ "title": "Correct an overstated result", "type": "task" }),
        "create",
    )
    .await
    .expect("work item");
    let work_item_id = created["id"].as_str().unwrap().to_string();
    let result = handle_work_item_add_event(
        &state,
        json!({
            "id": work_item_id,
            "text": "The integration is complete",
            "evidence_kind": "result",
            "new_ref": { "kind": "issue_key", "value": "OR-42" }
        }),
        "result",
    )
    .await
    .expect("result event");
    let event_id = result["id"].as_str().unwrap().to_string();

    let before = handle_operational_reality_list(&state, json!({}), "before")
        .await
        .expect("projection with result");
    let before_item = item_by_title(&before, "Correct an overstated result");
    assert!(before_item["facts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|fact| fact["summary"].as_str() == Some("The integration is complete")));
    let result_fact = before_item["facts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|fact| fact["summary"].as_str() == Some("The integration is complete"))
        .unwrap();
    assert_eq!(result_fact["refs"][0]["kind"].as_str(), Some("issue_key"));
    assert_eq!(result_fact["refs"][0]["value"].as_str(), Some("OR-42"));

    handle_work_item_update_event(
        &state,
        json!({
            "id": event_id,
            "text": "The integration was only inspected",
            "evidence_kind": "observation"
        }),
        "reclassify",
    )
    .await
    .expect("reclassify result as observation");

    let reclassified = handle_operational_reality_list(&state, json!({}), "reclassified")
        .await
        .expect("projection after reclassification");
    let reclassified_item = item_by_title(&reclassified, "Correct an overstated result");
    assert!(!reclassified_item["facts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|fact| fact["summary"].as_str() == Some("The integration is complete")));
    assert!(reclassified_item["facts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|fact| fact["summary"].as_str() == Some("The integration was only inspected")));

    let after_reclassification_records = handle_causal_record_list(
        &state,
        json!({ "subject_kind": "work_item", "subject_id": work_item_id }),
        "records-after-reclassification",
    )
    .await
    .expect("causal records after reclassification");
    let records = after_reclassification_records["records"]
        .as_array()
        .unwrap();
    assert_eq!(records.len(), 2);
    let original_id = records
        .iter()
        .find(|record| record["kind"].as_str() == Some("result"))
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let reclassification_id = records
        .iter()
        .find(|record| record["kind"].as_str() == Some("correction"))
        .unwrap()["id"]
        .as_str()
        .unwrap();
    assert_eq!(
        records
            .iter()
            .find(|record| record["id"].as_str() == Some(reclassification_id))
            .unwrap()["supersedes_id"]
            .as_str(),
        Some(original_id)
    );

    let deleted =
        handle_work_item_delete_event(&state, json!({ "id": event_id }), "delete-observation")
            .await
            .expect("delete source event atomically");
    assert_eq!(deleted["success"].as_bool(), Some(true));

    let after_delete = handle_operational_reality_list(&state, json!({}), "after-delete")
        .await
        .expect("projection after source deletion");
    let after_delete_item = item_by_title(&after_delete, "Correct an overstated result");
    assert!(!after_delete_item["facts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|fact| fact["summary"].as_str() == Some("The integration was only inspected")));
    assert!(after_delete_item["facts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|fact| fact["summary"]
            .as_str()
            .is_some_and(|text| text.contains("removed the source event"))));

    let after_delete_records = handle_causal_record_list(
        &state,
        json!({ "subject_kind": "work_item", "subject_id": work_item_id }),
        "records-after-delete",
    )
    .await
    .expect("causal records after deletion");
    let records = after_delete_records["records"].as_array().unwrap();
    assert_eq!(
        records.len(),
        3,
        "both corrections and the original must remain"
    );
    let deletion = records.last().unwrap();
    assert_eq!(deletion["kind"].as_str(), Some("correction"));
    assert_eq!(
        deletion["supersedes_id"].as_str(),
        Some(reclassification_id)
    );
    assert!(deletion["evidence_event_id"].is_null());
}

#[tokio::test]
async fn migrated_track_decision_stops_driving_current_reality_after_follow_up() {
    let (_dir, _db_path, state) = persistent_test_state().await;
    let track = handle_track_create(&state, json!({ "title": "Follow-up Track" }), "track")
        .await
        .expect("track");
    let track_id = Uuid::parse_str(track["id"].as_str().unwrap()).unwrap();
    let reflection_session_id = Uuid::new_v4();
    let decision_id = Uuid::new_v4();
    let decision_at = Utc::now() - Duration::hours(1);
    {
        let state = state.read().await;
        sqlx::query(
            "INSERT INTO reflection_sessions (
                id, created_at, period_from, period_to, profile,
                filters_json, summary, findings_json
             ) VALUES (?1, ?2, '2026-07-01', '2026-07-09',
                       'track-retrospective', '{}', 'Track review', '[]')",
        )
        .bind(reflection_session_id.to_string())
        .bind(decision_at.to_rfc3339())
        .execute(state.db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO reflection_decisions (
                id, reflection_session_id, subject, decision, note, created_at
             ) VALUES (?1, ?2, 'Follow-up Track', 'protect-next-focus',
                       'Protect the next block', ?3)",
        )
        .bind(decision_id.to_string())
        .bind(reflection_session_id.to_string())
        .bind(decision_at.to_rfc3339())
        .execute(state.db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO reflection_decision_tracks (
                reflection_decision_id, track_id, track_path_json
             ) VALUES (?1, ?2, ?3)",
        )
        .bind(decision_id.to_string())
        .bind(track_id.to_string())
        .bind(serde_json::to_string(&state.db.track_path(track_id).await.unwrap()).unwrap())
        .execute(state.db.pool())
        .await
        .unwrap();

        let mut causal = NewCausalRecord {
            subject_kind: OperationalSubjectKind::Track,
            subject_id: track_id,
            work_item_id: None,
            track_id: Some(track_id),
            capture_id: None,
            record_kind: CausalRecordKind::Decision,
            operational_state: None,
            next_action_status: None,
            text: Some("Protect the next block".to_string()),
            occurred_at: decision_at,
            source: CausalSource::Legacy,
            provenance: CausalProvenance::LegacyCurrent,
            confidence: 0.70,
            correlation_id: None,
            supersedes_id: None,
            focus_session_id: None,
            evidence_event_id: None,
            reflection_decision_id: Some(decision_id),
            payload: json!({ "migration": "test" }),
        };
        causal.track_id = Some(track_id);
        state.db.create_causal_record(causal).await.unwrap();
    }

    let before_followup = Utc::now();
    let before = handle_operational_reality_list(&state, json!({}), "before-followup")
        .await
        .expect("projection before follow-up");
    let before_item = item_by_title(&before, "Follow-up Track");
    assert_eq!(before_item["subject_kind"].as_str(), Some("track"));

    handle_operational_reality_follow_up_decision(
        &state,
        json!({
            "decision_id": decision_id,
            "status": "fulfilled",
            "note": "The protected block happened"
        }),
        "follow-up",
    )
    .await
    .expect("follow up migrated decision");

    let current = handle_operational_reality_list(&state, json!({}), "current")
        .await
        .expect("current projection");
    assert!(current["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["title"].as_str() != Some("Follow-up Track")));

    let historical = handle_operational_reality_list(
        &state,
        json!({ "as_of": before_followup.to_rfc3339() }),
        "historical",
    )
    .await
    .expect("historical projection");
    assert_eq!(
        item_by_title(&historical, "Follow-up Track")["subject_kind"].as_str(),
        Some("track")
    );

    let records = handle_causal_record_list(
        &state,
        json!({ "subject_kind": "track", "subject_id": track_id }),
        "track-records",
    )
    .await
    .expect("track causal records");
    let records = records["records"].as_array().unwrap();
    assert_eq!(records.len(), 2);
    assert_eq!(records[1]["kind"].as_str(), Some("confirmation"));
    assert_eq!(records[1]["supersedes_id"], records[0]["id"]);
}

#[tokio::test]
async fn projection_exposes_every_v1_state_and_keeps_closed_items_out_of_attention() {
    let (_dir, _db_path, state) = persistent_test_state().await;
    let states = [
        "waiting",
        "blocked",
        "parked",
        "reactive",
        "completed",
        "stale-important",
        "meeting-tail",
        "unknown",
    ];
    for operational_state in states {
        let title = format!("State {operational_state}");
        let created = handle_work_item_create(
            &state,
            json!({ "title": title, "type": "task" }),
            &format!("create-{operational_state}"),
        )
        .await
        .expect("work item");
        handle_operational_reality_set_state(
            &state,
            json!({
                "subject_kind": "work_item",
                "subject_id": created["id"],
                "state": operational_state,
                "reason": format!("Confirm {operational_state}")
            }),
            &format!("state-{operational_state}"),
        )
        .await
        .expect("operational state");
    }

    let active = handle_work_item_create(
        &state,
        json!({ "title": "State active", "type": "task" }),
        "create-active",
    )
    .await
    .expect("active work item");
    handle_focus_start(
        &state,
        json!({ "work_item_id": active["id"], "target_seconds": 60 }),
        "focus-active",
    )
    .await
    .expect("active focus");

    handle_capture_create(
        &state,
        json!({ "text": "Unclassified incoming fact" }),
        "capture",
    )
    .await
    .expect("capture");

    let reality = handle_operational_reality_list(&state, json!({}), "reality")
        .await
        .expect("projection");
    for operational_state in [
        "active",
        "waiting",
        "blocked",
        "parked",
        "reactive",
        "completed",
        "stale-important",
        "meeting-tail",
        "unknown",
    ] {
        let item = item_by_title(&reality, &format!("State {operational_state}"));
        assert_eq!(item["state"].as_str(), Some(operational_state));
        assert_eq!(item["state_confirmed"].as_bool(), Some(true));
        assert!(!item["why_visible"].as_array().unwrap().is_empty());
        assert_eq!(
            item["requires_attention"].as_bool(),
            Some(!matches!(operational_state, "completed" | "parked"))
        );
    }

    for operational_state in ["completed", "parked"] {
        let item = item_by_title(&reality, &format!("State {operational_state}"));
        assert_eq!(item["requires_attention"].as_bool(), Some(false));
        assert!(item["unknowns"].as_array().unwrap().iter().all(|unknown| {
            unknown.as_str() != Some("Не зафиксировано следующее действие")
        }));
    }
    assert_eq!(
        item_by_title(&reality, "State completed")["can_start_focus"].as_bool(),
        Some(false)
    );
    let capture = item_by_title(&reality, "Unclassified incoming fact");
    assert_eq!(capture["state_provenance"].as_str(), Some("legacy_current"));
    assert_eq!(capture["state_confirmed"].as_bool(), Some(false));
    assert_eq!(capture["confidence"].as_f64(), Some(0.70));
}

#[tokio::test]
async fn attention_queue_ignores_ordinary_legacy_items_but_flags_large_effort_without_result() {
    let (_dir, _db_path, state) = persistent_test_state().await;
    handle_work_item_create(
        &state,
        json!({ "title": "Ordinary legacy item", "type": "task" }),
        "ordinary",
    )
    .await
    .expect("ordinary item");
    let expensive = handle_work_item_create(
        &state,
        json!({ "title": "Large effort without result", "type": "task" }),
        "expensive",
    )
    .await
    .expect("expensive item");
    let stopped_at = Utc::now() - Duration::minutes(5);
    let started_at = stopped_at - Duration::hours(2);
    handle_focus_create_stopped(
        &state,
        json!({
            "work_item_id": expensive["id"],
            "started_at": started_at.to_rfc3339(),
            "stopped_at": stopped_at.to_rfc3339(),
        }),
        "expensive-focus",
    )
    .await
    .expect("stopped focus");

    let reality = handle_operational_reality_list(&state, json!({}), "reality")
        .await
        .expect("projection");
    assert_eq!(
        item_by_title(&reality, "Ordinary legacy item")["requires_attention"].as_bool(),
        Some(false)
    );
    let expensive_item = item_by_title(&reality, "Large effort without result");
    assert_eq!(expensive_item["requires_attention"].as_bool(), Some(true));
    assert!(expensive_item["why_visible"]
        .as_array()
        .unwrap()
        .iter()
        .any(|reason| reason.as_str().unwrap().contains("120 мин работы")));
}
