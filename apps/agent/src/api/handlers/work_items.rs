//! Work item API handlers

use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{WorkItem, WorkItemState, WorkItemType, WorkItemEvent, WorkItemEventKind};
use crate::AppState;

/// Handle work_item.create
pub async fn handle_work_item_create(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let title = params.get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "validation_error", "Title is required"))?;

    let item_type = params.get("type")
        .and_then(|v| v.as_str())
        .and_then(WorkItemType::from_str);

    let item_state = params.get("state")
        .and_then(|v| v.as_str())
        .and_then(WorkItemState::from_str);

    let note = params.get("note")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let item = WorkItem::new(title.to_string(), item_type, item_state, note);

    let state = state.write().await;
    state.db.create_work_item(&item)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

    Ok(serde_json::json!({ "id": item.id.to_string() }))
}

/// Handle work_item.touch
pub async fn handle_work_item_touch(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let state = state.write().await;

    let mut item = state.db.get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "not_found", "Work item not found"))?;

    item.touch();

    state.db.update_work_item(&item)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

    state.db.log_event(&WorkItemEvent::new(id, WorkItemEventKind::Touched, None))
        .await
        .ok();

    Ok(serde_json::json!({ "success": true }))
}

/// Handle work_item.set_state
pub async fn handle_work_item_set_state(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let new_state = params.get("state")
        .and_then(|v| v.as_str())
        .and_then(WorkItemState::from_str)
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "validation_error", "Valid state is required"))?;

    let state = state.write().await;

    let mut item = state.db.get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "not_found", "Work item not found"))?;

    let old_state = item.state;
    item.set_state(new_state);

    state.db.update_work_item(&item)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

    state.db.log_event(&WorkItemEvent::new(id, WorkItemEventKind::StateChanged, Some(serde_json::json!({
        "old_state": old_state.as_str(),
        "new_state": new_state.as_str(),
    }))))
        .await
        .ok();

    Ok(serde_json::json!({ "success": true }))
}

/// Handle work_item.set_note
pub async fn handle_work_item_set_note(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let note = params.get("note")
        .and_then(|v| v.as_str())
        .map(|s| if s.is_empty() { None } else { Some(s.to_string()) })
        .unwrap_or(None);

    let state = state.write().await;

    let mut item = state.db.get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "not_found", "Work item not found"))?;

    item.set_note(note);

    state.db.update_work_item(&item)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

    state.db.log_event(&WorkItemEvent::new(id, WorkItemEventKind::NoteChanged, None))
        .await
        .ok();

    Ok(serde_json::json!({ "success": true }))
}

/// Handle work_item.toggle_pin
pub async fn handle_work_item_toggle_pin(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let state = state.write().await;

    let mut item = state.db.get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "not_found", "Work item not found"))?;

    let was_pinned = item.pinned;
    item.toggle_pin();

    state.db.update_work_item(&item)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

    let event_kind = if was_pinned { WorkItemEventKind::Unpinned } else { WorkItemEventKind::Pinned };
    state.db.log_event(&WorkItemEvent::new(id, event_kind, None))
        .await
        .ok();

    Ok(serde_json::json!({ "success": true, "pinned": item.pinned }))
}

/// Handle work_item.delete
pub async fn handle_work_item_delete(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let mode = params.get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("soft");

    let state = state.write().await;

    if mode == "hard" {
        // Hard delete
        let deleted = state.db.delete_work_item(id)
            .await
            .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

        if !deleted {
            return Err(RpcResponse::error(request_id.to_string(), "not_found", "Work item not found"));
        }
    } else {
        // Soft delete
        let mut item = state.db.get_work_item(id)
            .await
            .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
            .ok_or_else(|| RpcResponse::error(request_id.to_string(), "not_found", "Work item not found"))?;

        item.soft_delete();

        state.db.update_work_item(&item)
            .await
            .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

        state.db.log_event(&WorkItemEvent::new(id, WorkItemEventKind::Deleted, None))
            .await
            .ok();
    }

    Ok(serde_json::json!({ "success": true }))
}

/// Helper to extract work item ID from params
fn get_work_item_id(params: &serde_json::Value, request_id: &str) -> Result<Uuid, RpcResponse> {
    let id_str = params.get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "validation_error", "Work item ID is required"))?;

    Uuid::parse_str(id_str)
        .map_err(|_| RpcResponse::error(request_id.to_string(), "validation_error", "Invalid work item ID"))
}
