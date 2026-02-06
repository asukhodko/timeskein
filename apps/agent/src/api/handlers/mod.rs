//! API handlers

mod agent;
mod inventory;
mod work_items;
mod refs;
mod settings;

use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::AppState;

pub use agent::*;
pub use inventory::*;
pub use work_items::*;
pub use refs::*;
pub use settings::*;

/// API version
pub const API_VERSION: &str = "1.0";

/// RPC request envelope
#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub version: Option<String>,
    pub request_id: Option<String>,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// RPC response envelope
#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub version: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// RPC error
#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl RpcResponse {
    pub fn success(request_id: String, result: serde_json::Value) -> Self {
        Self {
            version: API_VERSION.to_string(),
            request_id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(request_id: String, code: &str, message: &str) -> Self {
        Self {
            version: API_VERSION.to_string(),
            request_id,
            result: None,
            error: Some(RpcError {
                code: code.to_string(),
                message: message.to_string(),
                details: None,
            }),
        }
    }

    pub fn error_with_details(request_id: String, code: &str, message: &str, details: serde_json::Value) -> Self {
        Self {
            version: API_VERSION.to_string(),
            request_id,
            result: None,
            error: Some(RpcError {
                code: code.to_string(),
                message: message.to_string(),
                details: Some(details),
            }),
        }
    }
}

/// Main RPC handler
pub async fn handle_rpc(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(request): Json<RpcRequest>,
) -> (StatusCode, Json<RpcResponse>) {
    let request_id = request.request_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    
    let response = match dispatch_method(&state, &request.method, request.params, &request_id).await {
        Ok(result) => RpcResponse::success(request_id, result),
        Err(e) => e,
    };

    (StatusCode::OK, Json(response))
}

/// Dispatch method to appropriate handler
async fn dispatch_method(
    state: &Arc<RwLock<AppState>>,
    method: &str,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    match method {
        // Agent methods
        "agent.ping" => handle_agent_ping(),
        "agent.status" => handle_agent_status(state).await,
        "agent.version" => handle_agent_version(),

        // Inventory methods
        "inventory.list" => handle_inventory_list(state, params, request_id).await,
        "inventory.get" => handle_inventory_get(state, params, request_id).await,

        // Work item methods
        "work_item.create" => handle_work_item_create(state, params, request_id).await,
        "work_item.touch" => handle_work_item_touch(state, params, request_id).await,
        "work_item.set_state" => handle_work_item_set_state(state, params, request_id).await,
        "work_item.set_note" => handle_work_item_set_note(state, params, request_id).await,
        "work_item.toggle_pin" => handle_work_item_toggle_pin(state, params, request_id).await,
        "work_item.delete" => handle_work_item_delete(state, params, request_id).await,

        // Ref methods
        "ref.add" => handle_ref_add(state, params, request_id).await,
        "ref.remove" => handle_ref_remove(state, params, request_id).await,
        "ref.open" => handle_ref_open(state, params, request_id).await,
        "ref.check_conflict" => handle_ref_check_conflict(state, params, request_id).await,

        // Settings methods
        "settings.get" => handle_settings_get(state).await,
        "settings.set" => handle_settings_set(state, params, request_id).await,
        "settings.get_denylist" => handle_settings_get_denylist(state).await,
        "settings.add_to_denylist" => handle_settings_add_to_denylist(state, params, request_id).await,
        "settings.remove_from_denylist" => handle_settings_remove_from_denylist(state, params, request_id).await,

        _ => Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            &format!("Unknown method: {}", method),
        )),
    }
}
