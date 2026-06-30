//! Ref API handlers

use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{
    check_denylist, DenylistCheckResult, Ref, RefKind, WorkItemEvent, WorkItemEventKind,
};
use crate::AppState;

/// Handle ref.add
pub async fn handle_ref_add(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let work_item_id_str = params
        .get("work_item_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Work item ID is required",
            )
        })?;

    let work_item_id = Uuid::parse_str(work_item_id_str).map_err(|_| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Invalid work item ID",
        )
    })?;

    let kind_str = params.get("kind").and_then(|v| v.as_str()).ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Ref kind is required",
        )
    })?;

    let kind = RefKind::from_str(kind_str).ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Invalid ref kind",
        )
    })?;

    let value = params
        .get("value")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Ref value is required",
            )
        })?;

    let is_primary = params
        .get("is_primary")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let state_guard = state.write().await;

    // Check work item exists
    let _item = state_guard
        .db
        .get_work_item(work_item_id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;

    // Check denylist for URLs
    if kind == RefKind::Url {
        let denylist = state_guard.db.get_denylist().await.unwrap_or_default();

        match check_denylist(value, &denylist) {
            DenylistCheckResult::Blocked { pattern, .. } => {
                return Err(RpcResponse::error_with_details(
                    request_id.to_string(),
                    "privacy_blocked",
                    "URL is blocked by privacy settings",
                    serde_json::json!({
                        "pattern": pattern,
                        "value": value,
                    }),
                ));
            }
            DenylistCheckResult::Redact { redacted_value, .. } => {
                // Use redacted value instead
                let ref_entity = Ref::new(kind, redacted_value.clone()).map_err(|e| {
                    RpcResponse::error(request_id.to_string(), "validation_error", &e.to_string())
                })?;

                // Check if this work item already has refs (to set is_primary)
                let has_refs = state_guard.db.has_refs(work_item_id).await.unwrap_or(false);

                state_guard
                    .db
                    .add_ref(work_item_id, &ref_entity, is_primary || !has_refs)
                    .await
                    .map_err(|e| {
                        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
                    })?;

                return Ok(serde_json::json!({
                    "ref_id": ref_entity.id.to_string(),
                    "redacted": true,
                    "original_value": value,
                    "stored_value": redacted_value,
                }));
            }
            DenylistCheckResult::Allowed => {}
        }
    }

    // Create ref entity with normalization
    let ref_entity = Ref::new(kind, value.to_string()).map_err(|e| {
        RpcResponse::error(request_id.to_string(), "validation_error", &e.to_string())
    })?;

    // Check for conflict
    let conflict = state_guard
        .db
        .check_ref_conflict(kind, &ref_entity.normalized_value)
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

    if let Some(conflict_info) = conflict {
        if conflict_info.existing_work_item_id != work_item_id {
            return Err(RpcResponse::error_with_details(
                request_id.to_string(),
                "conflict",
                "Ref already attached to another work item",
                serde_json::json!({
                    "conflict_type": "ref_already_attached",
                    "existing_work_item": {
                        "id": conflict_info.existing_work_item_id.to_string(),
                        "title": conflict_info.existing_work_item_title,
                    },
                    "options": ["attach_anyway", "open_existing", "cancel"],
                }),
            ));
        }
    }

    // Check if this work item already has refs (to set is_primary)
    let has_refs = state_guard.db.has_refs(work_item_id).await.unwrap_or(false);

    // Add ref
    state_guard
        .db
        .add_ref(work_item_id, &ref_entity, is_primary || !has_refs)
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

    Ok(serde_json::json!({ "ref_id": ref_entity.id.to_string() }))
}

/// Handle ref.remove
pub async fn handle_ref_remove(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let work_item_id_str = params
        .get("work_item_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Work item ID is required",
            )
        })?;

    let work_item_id = Uuid::parse_str(work_item_id_str).map_err(|_| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Invalid work item ID",
        )
    })?;

    let ref_id_str = params
        .get("ref_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Ref ID is required",
            )
        })?;

    let ref_id = Uuid::parse_str(ref_id_str).map_err(|_| {
        RpcResponse::error(request_id.to_string(), "validation_error", "Invalid ref ID")
    })?;

    let state = state.write().await;

    let removed = state
        .db
        .remove_ref(work_item_id, ref_id)
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

    if !removed {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "not_found",
            "Ref not found",
        ));
    }

    Ok(serde_json::json!({ "success": true }))
}

/// Handle ref.open
pub async fn handle_ref_open(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let work_item_id_str = params
        .get("work_item_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Work item ID is required",
            )
        })?;

    let work_item_id = Uuid::parse_str(work_item_id_str).map_err(|_| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Invalid work item ID",
        )
    })?;

    let ref_id = params
        .get("ref_id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());

    let state_guard = state.write().await;

    // Get the ref to open
    let ref_entity = if let Some(id) = ref_id {
        state_guard
            .db
            .get_ref(id)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?
            .ok_or_else(|| {
                RpcResponse::error(request_id.to_string(), "not_found", "Ref not found")
            })?
    } else {
        // Get primary ref
        state_guard
            .db
            .get_primary_ref(work_item_id)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?
            .ok_or_else(|| {
                RpcResponse::error(request_id.to_string(), "not_found", "No refs to open")
            })?
    };

    // Open the ref using OS handler
    let open_result = open_ref(&ref_entity);

    if let Err(e) = open_result {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            &format!("Failed to open ref: {}", e),
        ));
    }

    // Update last_seen_at
    let mut item = state_guard
        .db
        .get_work_item(work_item_id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;

    item.touch();

    state_guard.db.update_work_item(&item).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    state_guard
        .db
        .log_event(&WorkItemEvent::new(
            work_item_id,
            WorkItemEventKind::OpenedRef,
            Some(serde_json::json!({
                "ref_id": ref_entity.id.to_string(),
                "kind": ref_entity.kind.as_str(),
            })),
        ))
        .await
        .ok();

    Ok(serde_json::json!({
        "opened": true,
        "ref_id": ref_entity.id.to_string(),
        "kind": ref_entity.kind.as_str(),
        "value": ref_entity.value,
    }))
}

/// Handle ref.check_conflict
pub async fn handle_ref_check_conflict(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let kind_str = params.get("kind").and_then(|v| v.as_str()).ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Ref kind is required",
        )
    })?;

    let kind = RefKind::from_str(kind_str).ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Invalid ref kind",
        )
    })?;

    let value = params
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Ref value is required",
            )
        })?;

    // Normalize value
    let ref_entity = Ref::new(kind, value.to_string()).map_err(|e| {
        RpcResponse::error(request_id.to_string(), "validation_error", &e.to_string())
    })?;

    let state = state.read().await;

    let conflict = state
        .db
        .check_ref_conflict(kind, &ref_entity.normalized_value)
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

    match conflict {
        Some(info) => Ok(serde_json::json!({
            "exists": true,
            "existing_work_item": {
                "id": info.existing_work_item_id.to_string(),
                "title": info.existing_work_item_title,
            },
        })),
        None => Ok(serde_json::json!({
            "exists": false,
        })),
    }
}

/// Open a ref using OS handler
fn open_ref(ref_entity: &Ref) -> Result<(), String> {
    let value = &ref_entity.value;

    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", value])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(value)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(value)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
