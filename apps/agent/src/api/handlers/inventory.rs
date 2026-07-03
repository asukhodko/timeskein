//! Inventory API handlers

use chrono::{DateTime, Utc};
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
    let now = Utc::now();

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
    let focus_window = params.get("focus_window");
    let focus_from =
        parse_optional_datetime(focus_window.and_then(|value| value.get("from")), request_id)?;
    let focus_to =
        parse_optional_datetime(focus_window.and_then(|value| value.get("to")), request_id)?;

    // Get work items
    let items = state
        .db
        .list_work_items(search, state_filter.as_deref())
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
    let today_totals = state
        .db
        .work_item_focus_totals(focus_from, focus_to, now)
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
    let total_totals = state
        .db
        .work_item_focus_totals(None, None, now)
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
        views.push(WorkItemView::from_work_item_with_stats(
            item,
            refs,
            *today_totals.get(&item.id).unwrap_or(&0),
            *total_totals.get(&item.id).unwrap_or(&0),
        ));
    }

    Ok(serde_json::json!({
        "items": views,
        "total": views.len(),
        "updated_at": now.to_rfc3339(),
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

fn parse_optional_datetime(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<DateTime<Utc>>, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|dt| dt.with_timezone(&Utc))
                .map_err(|_| {
                    RpcResponse::error(
                        request_id.to_string(),
                        "validation_error",
                        "Invalid focus window datetime",
                    )
                })
        })
        .transpose()
}
