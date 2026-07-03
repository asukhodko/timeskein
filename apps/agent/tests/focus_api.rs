use std::sync::Arc;

use chrono::{Duration, Utc};
use serde_json::json;
use tempfile::tempdir;
use timeskein_agent::api::{
    handle_focus_list, handle_focus_split, handle_focus_start, handle_focus_stop,
    handle_focus_update, handle_inventory_list, handle_work_item_update,
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
            "note": "corrected note",
        }),
        "update",
    )
    .await
    .expect("update");

    assert_eq!(updated["state"].as_str(), Some("stopped"));
    assert_eq!(updated["work_item_title"].as_str(), Some("Correction Left"));
    assert_eq!(updated["note"].as_str(), Some("corrected note"));
    assert_eq!(updated["active_seconds"].as_i64(), Some(180));

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

    let edited_item = handle_work_item_update(
        &state,
        json!({
            "id": split["right"]["work_item_id"].as_str().expect("right item id"),
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

    let listed = handle_focus_list(
        &state,
        json!({
            "from": (start - Duration::minutes(1)).to_rfc3339(),
            "to": (end + Duration::minutes(1)).to_rfc3339(),
        }),
        "list",
    )
    .await
    .expect("list");
    let sessions = listed["sessions"].as_array().expect("sessions");

    assert_eq!(sessions.len(), 2);
    assert_eq!(listed["active_seconds_total"].as_i64(), Some(180));
    assert_eq!(
        sessions[1]["work_item_title"].as_str(),
        Some("Correction Right Edited")
    );
    assert_eq!(sessions[1]["activity_zone"].as_str(), Some("coordination"));

    let inventory = handle_inventory_list(
        &state,
        json!({
            "focus_window": {
                "from": (start - Duration::minutes(1)).to_rfc3339(),
                "to": (end + Duration::minutes(1)).to_rfc3339(),
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
