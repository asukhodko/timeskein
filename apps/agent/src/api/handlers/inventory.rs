//! Inventory API handlers

use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{WorkItemState, WorkItemView};
use crate::AppState;

/// Handle inventory.list
pub async fn handle_inventory_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let state = state.read().await;

    // Parse filter params
    let search = params
        .get("filter")
        .and_then(|f| f.get("search"))
        .and_then(|s| s.as_str());

    let state_filter: Option<Vec<WorkItemState>> = params
        .get("filter")
        .and_then(|f| f.get("state"))
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .filter_map(WorkItemState::from_str)
                .collect()
        });

    // Get work items
    let items = state
        .db
        .list_work_items(search, state_filter.as_deref())
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

    // Build views with refs
    let mut views = Vec::new();
    for item in &items {
        let refs = state
            .db
            .get_refs_for_work_item(item.id)
            .await
            .unwrap_or_default();
        views.push(WorkItemView::from_work_item(item, refs));
    }

    Ok(serde_json::json!({
        "items": views,
        "total": views.len(),
        "updated_at": chrono::Utc::now().to_rfc3339(),
    }))
}

/// Handle inventory.get
pub async fn handle_inventory_get(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id_str = params.get("id").and_then(|v| v.as_str()).ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Work item ID is required",
        )
    })?;

    let id = Uuid::parse_str(id_str).map_err(|_| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Invalid work item ID",
        )
    })?;

    let state = state.read().await;

    let item = state
        .db
        .get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;

    let refs = state
        .db
        .get_refs_for_work_item(item.id)
        .await
        .unwrap_or_default();

    let view = WorkItemView::from_work_item(&item, refs);
    Ok(serde_json::to_value(view).unwrap())
}
