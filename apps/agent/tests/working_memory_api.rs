use std::sync::Arc;

use chrono::Local;
use serde_json::{json, Value};
use tempfile::tempdir;
use timeskein_agent::api::{
    handle_context_pack_build, handle_day_contract_revise, handle_focus_list, handle_focus_start,
    handle_focus_stop, handle_focus_update, handle_label_create, handle_track_create,
    handle_work_item_create, handle_work_item_merge, handle_work_item_resolve,
    handle_work_item_set_semantics, handle_work_item_stage_create, handle_work_item_stage_update,
    handle_work_memory_create, handle_work_memory_delete, handle_work_memory_list,
    handle_work_memory_update,
};
use timeskein_agent::{db::Database, AppState};
use tokio::sync::RwLock;
use uuid::Uuid;

async fn test_state() -> Arc<RwLock<AppState>> {
    let directory = tempdir().expect("tempdir");
    let database = Database::new(&directory.path().join("timeskein-test.db"))
        .await
        .expect("database");
    Box::leak(Box::new(directory));
    Arc::new(RwLock::new(AppState {
        db: database,
        start_time: std::time::Instant::now(),
    }))
}

async fn create_item(state: &Arc<RwLock<AppState>>, title: &str) -> String {
    handle_work_item_create(
        state,
        json!({ "title": title, "type": "task", "state": "unknown" }),
        title,
    )
    .await
    .expect("create item")["id"]
        .as_str()
        .expect("item id")
        .to_string()
}

fn memory_texts(response: &Value) -> Vec<&str> {
    response["entries"]
        .as_array()
        .expect("memory entries")
        .iter()
        .filter_map(|entry| entry["current_revision"]["text"].as_str())
        .collect()
}

#[tokio::test]
async fn working_memory_keeps_revisions_stage_and_daily_outcome_snapshots() {
    let state = test_state().await;
    let track = handle_track_create(&state, json!({ "title": "Timeskein" }), "track")
        .await
        .expect("track");
    let track_id = track["id"].as_str().unwrap().to_string();
    let main_id = create_item(&state, "Working Memory Bridge").await;
    let companion_id = create_item(&state, "Keep ordinary work moving").await;
    let overflow_id = create_item(&state, "Optional commitment").await;
    handle_work_item_set_semantics(
        &state,
        json!({ "id": main_id, "track_id": track_id, "label_ids": [] }),
        "classify",
    )
    .await
    .expect("classify item");

    let local_date = Local::now().date_naive().format("%Y-%m-%d").to_string();
    let contract = handle_day_contract_revise(
        &state,
        json!({
            "local_date": local_date,
            "revision_kind": "morning",
            "active_subjects": [
                {
                    "kind": "work_item",
                    "subject_id": main_id,
                    "daily_outcome": "Prove immutable re-entry context"
                },
                {
                    "kind": "work_item",
                    "subject_id": companion_id,
                    "daily_outcome": "Keep the surrounding workflow healthy"
                }
            ],
            "first_action_work_item_id": main_id,
            "parked_subjects": [],
            "overflow_subjects": [
                {
                    "kind": "work_item",
                    "subject_id": overflow_id,
                    "daily_outcome": "Only if capacity remains"
                }
            ],
            "why_now": "The long-lived task must survive a pause"
        }),
        "contract",
    )
    .await
    .expect("day contract");
    assert_eq!(
        contract["revision"]["overflow_subjects"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let discovery = handle_work_item_stage_create(
        &state,
        json!({ "work_item_id": main_id, "title": "Discovery", "activate": true }),
        "discovery",
    )
    .await
    .expect("discovery stage");
    let discovery_id = discovery["id"].as_str().unwrap().to_string();
    let first = handle_focus_start(
        &state,
        json!({ "work_item_id": main_id, "stage_id": discovery_id }),
        "first-focus",
    )
    .await
    .expect("first focus");
    assert_eq!(first["work_context"]["stage_title"], "Discovery");
    assert_eq!(
        first["work_context"]["daily_outcome"],
        "Prove immutable re-entry context"
    );
    let first_focus_id = first["id"].as_str().unwrap().to_string();
    handle_focus_stop(
        &state,
        json!({
            "id": first_focus_id,
            "result": "Created the canonical memory schema",
            "state_change": "The task now has a durable history",
            "next_action": "Exercise the second stage"
        }),
        "stop-first",
    )
    .await
    .expect("stop first focus");

    handle_work_item_stage_update(
        &state,
        json!({ "id": discovery_id, "title": "Discovery complete", "state": "completed" }),
        "complete-discovery",
    )
    .await
    .expect("complete discovery");
    handle_day_contract_revise(
        &state,
        json!({
            "local_date": local_date,
            "revision_kind": "adjustment",
            "active_subjects": [
                {
                    "kind": "work_item",
                    "subject_id": main_id,
                    "daily_outcome": "Ship the tested bridge"
                },
                {
                    "kind": "work_item",
                    "subject_id": companion_id,
                    "daily_outcome": "Keep the surrounding workflow healthy"
                }
            ],
            "first_action_work_item_id": main_id,
            "parked_subjects": [],
            "overflow_subjects": [],
            "why_now": "Discovery is complete"
        }),
        "contract-adjustment",
    )
    .await
    .expect("adjust contract");
    let delivery = handle_work_item_stage_create(
        &state,
        json!({ "work_item_id": main_id, "title": "Delivery", "activate": true }),
        "delivery",
    )
    .await
    .expect("delivery stage");
    let second = handle_focus_start(
        &state,
        json!({ "work_item_id": main_id, "stage_id": delivery["id"] }),
        "second-focus",
    )
    .await
    .expect("second focus");
    assert_eq!(second["work_context"]["stage_title"], "Delivery");
    assert_eq!(
        second["work_context"]["daily_outcome"],
        "Ship the tested bridge"
    );
    handle_focus_stop(
        &state,
        json!({ "id": second["id"], "result": "Exercised the delivery stage" }),
        "stop-second",
    )
    .await
    .expect("stop second focus");

    let corrected_first = handle_focus_update(
        &state,
        json!({
            "id": first_focus_id,
            "note": "A later correction must not resnapshot context"
        }),
        "correct-first-focus",
    )
    .await
    .expect("correct first focus");
    assert_eq!(corrected_first["work_context"]["stage_title"], "Discovery");
    assert_eq!(
        corrected_first["work_context"]["daily_outcome"],
        "Prove immutable re-entry context"
    );

    let thought = handle_work_memory_create(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": main_id,
            "kind": "thought",
            "text": "The first formulation"
        }),
        "thought",
    )
    .await
    .expect("thought");
    let thought_id = thought["id"].as_str().unwrap().to_string();
    let revised = handle_work_memory_update(
        &state,
        json!({
            "id": thought_id,
            "kind": "decision",
            "text": "Use one canonical projection",
            "change_note": "Turned the thought into a decision"
        }),
        "revise-thought",
    )
    .await
    .expect("revise thought");
    assert_eq!(revised["revisions"].as_array().unwrap().len(), 2);
    assert_eq!(revised["revisions"][0]["text"], "The first formulation");
    assert_eq!(
        revised["current_revision"]["text"],
        "Use one canonical projection"
    );

    let rejected_revision = handle_work_memory_update(
        &state,
        json!({
            "id": thought_id,
            "kind": "material",
            "material_kind": "file_path"
        }),
        "reject-invalid-revision",
    )
    .await
    .expect_err("invalid revision must be rejected before persistence");
    assert_eq!(
        rejected_revision
            .error
            .as_ref()
            .map(|error| error.code.as_str()),
        Some("validation_error")
    );

    let unchanged_after_rejection = handle_work_memory_list(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": main_id,
            "include_deleted": true
        }),
        "memory-after-rejected-revision",
    )
    .await
    .expect("memory after rejected revision");
    let unchanged_thought = unchanged_after_rejection["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"].as_str() == Some(thought_id.as_str()))
        .expect("rejected revision leaves the entry available");
    assert_eq!(unchanged_thought["revisions"].as_array().unwrap().len(), 2);
    assert_eq!(
        unchanged_thought["current_revision"]["text"],
        "Use one canonical projection"
    );

    let event_count_before_invalid_memory = {
        let state = state.read().await;
        state
            .db
            .list_work_item_events(
                Some(Uuid::parse_str(&main_id).expect("main item UUID")),
                None,
                None,
            )
            .await
            .expect("events before invalid memory")
            .len()
    };
    assert!(handle_work_memory_create(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": main_id,
            "kind": "material",
            "material_kind": "file_path"
        }),
        "invalid-material",
    )
    .await
    .is_err());
    let event_count_after_invalid_memory = {
        let state = state.read().await;
        state
            .db
            .list_work_item_events(
                Some(Uuid::parse_str(&main_id).expect("main item UUID")),
                None,
                None,
            )
            .await
            .expect("events after invalid memory")
            .len()
    };
    assert_eq!(
        event_count_after_invalid_memory, event_count_before_invalid_memory,
        "invalid memory must not leave a compatibility event behind"
    );

    let material = handle_work_memory_create(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": main_id,
            "kind": "material",
            "material_kind": "file_path",
            "material_value": "/tmp/working-memory-evidence.md"
        }),
        "material",
    )
    .await
    .expect("material");
    handle_work_memory_delete(
        &state,
        json!({ "id": material["id"], "reason": "Replaced by a better artifact" }),
        "delete-material",
    )
    .await
    .expect("delete material");

    let focus = handle_focus_list(&state, json!({}), "focus-list")
        .await
        .expect("focus list");
    let sessions = focus["sessions"].as_array().unwrap();
    let first_again = sessions
        .iter()
        .find(|session| session["id"].as_str() == Some(first_focus_id.as_str()))
        .expect("first session");
    assert_eq!(first_again["work_context"]["stage_title"], "Discovery");
    assert_eq!(
        first_again["work_context"]["daily_outcome"],
        "Prove immutable re-entry context"
    );

    let memory = handle_work_memory_list(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": main_id,
            "include_deleted": true
        }),
        "memory-list",
    )
    .await
    .expect("memory list");
    let texts = memory_texts(&memory);
    assert!(texts.contains(&"Created the canonical memory schema"));
    assert!(texts.contains(&"The task now has a durable history"));
    assert!(texts.contains(&"Exercise the second stage"));
    assert!(memory["entries"].as_array().unwrap().iter().any(|entry| {
        entry["id"].as_str() == Some(material["id"].as_str().unwrap())
            && entry["deleted_at"].is_string()
    }));

    let as_of = "2099-01-01T00:00:00Z";
    let first_pack = handle_context_pack_build(
        &state,
        json!({
            "profile": "work-item-reentry",
            "scope_id": main_id,
            "as_of": as_of,
            "format": "both"
        }),
        "pack-one",
    )
    .await
    .expect("first context pack");
    let second_pack = handle_context_pack_build(
        &state,
        json!({
            "profile": "work-item-reentry",
            "scope_id": main_id,
            "as_of": as_of,
            "format": "both"
        }),
        "pack-two",
    )
    .await
    .expect("second context pack");
    assert_eq!(first_pack, second_pack);
    assert!(first_pack["markdown"]
        .as_str()
        .unwrap()
        .contains("Exercise the second stage"));
    assert_eq!(
        first_pack["pack"]["provenance"]["projection"],
        "deterministic canonical projection v1"
    );

    let track_pack = handle_context_pack_build(
        &state,
        json!({
            "profile": "track-reentry",
            "scope_id": track_id,
            "as_of": as_of,
            "format": "json"
        }),
        "track-pack",
    )
    .await
    .expect("track context pack");
    assert_eq!(track_pack["pack"]["scope"]["title"], "Timeskein");
    assert_eq!(
        track_pack["pack"]["facts"]["work_items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn merging_duplicate_items_preserves_history_and_resolves_the_old_id() {
    let state = test_state().await;
    let canonical_id = create_item(&state, "Canonical project").await;
    let duplicate_id = create_item(&state, "Canonical Project duplicate").await;
    let label = handle_label_create(&state, json!({ "title": "dogfood" }), "label")
        .await
        .expect("label");
    handle_work_item_set_semantics(
        &state,
        json!({
            "id": duplicate_id,
            "track_id": null,
            "label_ids": [label["id"]]
        }),
        "label-duplicate",
    )
    .await
    .expect("label duplicate");
    handle_work_memory_create(
        &state,
        json!({
            "subject_kind": "work_item",
            "subject_id": duplicate_id,
            "kind": "next_action",
            "text": "Continue through the old identity"
        }),
        "duplicate-memory",
    )
    .await
    .expect("duplicate memory");
    let stage = handle_work_item_stage_create(
        &state,
        json!({ "work_item_id": duplicate_id, "title": "Before merge", "activate": true }),
        "duplicate-stage",
    )
    .await
    .expect("duplicate stage");
    let focus = handle_focus_start(
        &state,
        json!({ "work_item_id": duplicate_id, "stage_id": stage["id"] }),
        "duplicate-focus",
    )
    .await
    .expect("duplicate focus");
    handle_focus_stop(
        &state,
        json!({ "id": focus["id"], "result": "Made progress before merge" }),
        "stop-duplicate",
    )
    .await
    .expect("stop duplicate");

    let alias = handle_work_item_merge(
        &state,
        json!({
            "source_id": duplicate_id,
            "canonical_id": canonical_id,
            "reason": "Same long-running project"
        }),
        "merge",
    )
    .await
    .expect("merge items");
    assert_eq!(alias["source_work_item_id"], duplicate_id);
    assert_eq!(alias["canonical_work_item_id"], canonical_id);

    let resolved =
        handle_work_item_resolve(&state, json!({ "id": duplicate_id }), "resolve-old-id")
            .await
            .expect("resolve old id");
    assert_eq!(resolved["canonical_id"], canonical_id);
    assert_eq!(resolved["aliases"].as_array().unwrap().len(), 1);

    let memory = handle_work_memory_list(
        &state,
        json!({ "subject_kind": "work_item", "subject_id": canonical_id }),
        "canonical-memory",
    )
    .await
    .expect("canonical memory");
    let texts = memory_texts(&memory);
    assert!(texts.contains(&"Continue through the old identity"));
    assert!(texts.contains(&"Made progress before merge"));

    let sessions = handle_focus_list(&state, json!({}), "focus-after-merge")
        .await
        .expect("focus after merge");
    assert!(sessions["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|session| {
            session["id"] == focus["id"] && session["work_item_id"] == canonical_id
        }));

    let pack = handle_context_pack_build(
        &state,
        json!({
            "profile": "work-item-reentry",
            "scope_id": duplicate_id,
            "as_of": "2099-01-01T00:00:00Z",
            "format": "json"
        }),
        "pack-through-alias",
    )
    .await
    .expect("context pack through alias");
    assert_eq!(pack["pack"]["scope"]["id"], duplicate_id);
    assert_eq!(pack["pack"]["scope"]["canonical_id"], canonical_id);
    assert!(pack["pack"]["facts"]["next_actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["current_revision"]["text"] == "Continue through the old identity"));

    let semantics = {
        let state = state.read().await;
        state
            .db
            .get_work_item_semantics(canonical_id.parse().expect("canonical UUID"))
            .await
            .expect("canonical semantics")
    };
    assert_eq!(semantics.labels.len(), 1);
    assert_eq!(semantics.labels[0].title, "dogfood");
}
