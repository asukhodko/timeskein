//! Settings API handlers

use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{DenylistRule, DenylistPolicy, DenylistRuleView};
use crate::AppState;

/// Handle settings.get
pub async fn handle_settings_get(
    state: &Arc<RwLock<AppState>>,
) -> Result<serde_json::Value, RpcResponse> {
    let state = state.read().await;

    let settings = state.db.get_all_settings()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));

    Ok(settings)
}

/// Handle settings.set
pub async fn handle_settings_set(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let state = state.write().await;

    // Iterate over params and set each key-value
    if let Some(obj) = params.as_object() {
        for (key, value) in obj {
            let value_str = serde_json::to_string(value)
                .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

            state.db.set_setting(key, &value_str)
                .await
                .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;
        }
    }

    Ok(serde_json::json!({ "success": true }))
}

/// Handle settings.get_denylist
pub async fn handle_settings_get_denylist(
    state: &Arc<RwLock<AppState>>,
) -> Result<serde_json::Value, RpcResponse> {
    let state = state.read().await;

    let rules = state.db.get_denylist()
        .await
        .unwrap_or_default();

    let views: Vec<DenylistRuleView> = rules.iter().map(DenylistRuleView::from).collect();

    Ok(serde_json::to_value(views).unwrap())
}

/// Handle settings.add_to_denylist
pub async fn handle_settings_add_to_denylist(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let pattern = params.get("pattern")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "validation_error", "Pattern is required"))?;

    let policy_str = params.get("policy")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "validation_error", "Policy is required"))?;

    let policy = DenylistPolicy::from_str(policy_str)
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "validation_error", "Invalid policy"))?;

    let rule = DenylistRule::new(pattern.to_string(), policy);

    let state = state.write().await;

    state.db.add_denylist_rule(&rule)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

    Ok(serde_json::json!({ "id": rule.id.to_string() }))
}

/// Handle settings.remove_from_denylist
pub async fn handle_settings_remove_from_denylist(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id_str = params.get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "validation_error", "Rule ID is required"))?;

    let id = Uuid::parse_str(id_str)
        .map_err(|_| RpcResponse::error(request_id.to_string(), "validation_error", "Invalid rule ID"))?;

    let state = state.write().await;

    let removed = state.db.remove_denylist_rule(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?;

    if !removed {
        return Err(RpcResponse::error(request_id.to_string(), "not_found", "Denylist rule not found"));
    }

    Ok(serde_json::json!({ "success": true }))
}
