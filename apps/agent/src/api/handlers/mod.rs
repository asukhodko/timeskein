//! API handlers

mod agent;
mod app_events;
mod captures;
mod day_events;
mod focus_sessions;
mod inventory;
mod operational_reality;
mod operational_workspace;
mod refs;
mod semantics;
mod settings;
mod work_items;
mod working_memory;

use std::sync::Arc;

use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::AppState;

pub use agent::*;
pub use app_events::*;
pub use captures::*;
pub use day_events::*;
pub use focus_sessions::*;
pub use inventory::*;
pub use operational_reality::*;
pub use operational_workspace::*;
pub use refs::*;
pub use semantics::*;
pub use settings::*;
pub use work_items::*;
pub use working_memory::*;

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

    pub fn error_with_details(
        request_id: String,
        code: &str,
        message: &str,
        details: serde_json::Value,
    ) -> Self {
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
    let request_id = request
        .request_id
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let method = request.method;
    let response = match dispatch_method(&state, &method, request.params, &request_id).await {
        Ok(result) => RpcResponse::success(request_id, result),
        Err(e) => {
            if method != "app_event.log" {
                let code = e
                    .error
                    .as_ref()
                    .map(|error| error.code.clone())
                    .unwrap_or_else(|| "unknown".to_string());
                log_agent_event(
                    &state,
                    crate::domain::AppEventKind::ApiError,
                    None,
                    None,
                    Some(serde_json::json!({
                        "request_method": method,
                        "error_code": code,
                    })),
                )
                .await;
            }
            e
        }
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

        // App event telemetry methods
        "app_event.log" => handle_app_event_log(state, params, request_id).await,
        "app_event.list" => handle_app_event_list(state, params, request_id).await,
        "app_event.summary" => handle_app_event_summary(state, params, request_id).await,

        // Capture inbox methods
        "capture.create" => handle_capture_create(state, params, request_id).await,
        "capture.list" => handle_capture_list(state, params, request_id).await,
        "capture.resolve" => handle_capture_resolve(state, params, request_id).await,
        "capture.update" => handle_capture_update(state, params, request_id).await,
        "capture.delete" => handle_capture_delete(state, params, request_id).await,
        "capture.convert_to_work_item" => {
            handle_capture_convert_to_work_item(state, params, request_id).await
        }
        "capture.append_to_work_item_event" => {
            handle_capture_append_to_work_item_event(state, params, request_id).await
        }

        // Day event methods
        "day_event.add" => handle_day_event_add(state, params, request_id).await,
        "day_event.list" => handle_day_event_list(state, params, request_id).await,
        "day_event.update" => handle_day_event_update(state, params, request_id).await,
        "day_event.delete" => handle_day_event_delete(state, params, request_id).await,

        // Inventory methods
        "inventory.list" => handle_inventory_list(state, params, request_id).await,
        "inventory.get" => handle_inventory_get(state, params, request_id).await,

        // Semantic taxonomy methods
        "taxonomy.list" => handle_taxonomy_list(state, params, request_id).await,
        "track.create" => handle_track_create(state, params, request_id).await,
        "track.update" => handle_track_update(state, params, request_id).await,
        "track.archive" => handle_track_archive(state, params, request_id).await,
        "label.create" => handle_label_create(state, params, request_id).await,
        "label.update" => handle_label_update(state, params, request_id).await,
        "label.archive" => handle_label_archive(state, params, request_id).await,

        // Causal work spine and current projection
        "causal_record.list" => handle_causal_record_list(state, params, request_id).await,
        "operational_reality.list" => {
            handle_operational_reality_list(state, params, request_id).await
        }
        "operational_reality.set_state" => {
            handle_operational_reality_set_state(state, params, request_id).await
        }
        "operational_reality.set_next_action" => {
            handle_operational_reality_set_next_action(state, params, request_id).await
        }
        "operational_reality.follow_up_decision" => {
            handle_operational_reality_follow_up_decision(state, params, request_id).await
        }
        "operational_workspace.get" => {
            handle_operational_workspace_get(state, params, request_id).await
        }
        "day_contract.revise" => handle_day_contract_revise(state, params, request_id).await,
        "day_contract.list" => handle_day_contract_list(state, params, request_id).await,

        // Work item methods
        "work_item.create" => handle_work_item_create(state, params, request_id).await,
        "work_item.touch" => handle_work_item_touch(state, params, request_id).await,
        "work_item.set_state" => handle_work_item_set_state(state, params, request_id).await,
        "work_item.set_note" => handle_work_item_set_note(state, params, request_id).await,
        "work_item.add_event" => handle_work_item_add_event(state, params, request_id).await,
        "work_item.events" => handle_work_item_events(state, params, request_id).await,
        "work_item.update_event" => handle_work_item_update_event(state, params, request_id).await,
        "work_item.delete_event" => handle_work_item_delete_event(state, params, request_id).await,
        "work_item.update" => handle_work_item_update(state, params, request_id).await,
        "work_item.set_semantics" => {
            handle_work_item_set_semantics(state, params, request_id).await
        }
        "work_item.toggle_pin" => handle_work_item_toggle_pin(state, params, request_id).await,
        "work_item.delete" => handle_work_item_delete(state, params, request_id).await,

        // Long-lived working memory and Work Item stages
        "working_memory.create" => handle_work_memory_create(state, params, request_id).await,
        "working_memory.list" => handle_work_memory_list(state, params, request_id).await,
        "working_memory.update" => handle_work_memory_update(state, params, request_id).await,
        "working_memory.delete" => handle_work_memory_delete(state, params, request_id).await,
        "work_item_stage.create" => handle_work_item_stage_create(state, params, request_id).await,
        "work_item_stage.update" => handle_work_item_stage_update(state, params, request_id).await,
        "work_item_stage.delete" => handle_work_item_stage_delete(state, params, request_id).await,
        "work_item_stage.list" => handle_work_item_stage_list(state, params, request_id).await,
        "work_item.merge" => handle_work_item_merge(state, params, request_id).await,
        "work_item.resolve" => handle_work_item_resolve(state, params, request_id).await,
        "context_pack.build" => handle_context_pack_build(state, params, request_id).await,

        // Focus session methods
        "focus.current" => handle_focus_current(state, params, request_id).await,
        "focus.start" => handle_focus_start(state, params, request_id).await,
        "focus.stop" => handle_focus_stop(state, params, request_id).await,
        "focus.update" => handle_focus_update(state, params, request_id).await,
        "focus.create_stopped" => handle_focus_create_stopped(state, params, request_id).await,
        "focus.split" => handle_focus_split(state, params, request_id).await,
        "focus.list" => handle_focus_list(state, params, request_id).await,

        // Ref methods
        "ref.add" => handle_ref_add(state, params, request_id).await,
        "ref.remove" => handle_ref_remove(state, params, request_id).await,
        "ref.open" => handle_ref_open(state, params, request_id).await,
        "ref.check_conflict" => handle_ref_check_conflict(state, params, request_id).await,

        // Settings methods
        "settings.get" => handle_settings_get(state).await,
        "settings.set" => handle_settings_set(state, params, request_id).await,
        "settings.get_denylist" => handle_settings_get_denylist(state).await,
        "settings.add_to_denylist" => {
            handle_settings_add_to_denylist(state, params, request_id).await
        }
        "settings.remove_from_denylist" => {
            handle_settings_remove_from_denylist(state, params, request_id).await
        }

        _ => Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            &format!("Unknown method: {}", method),
        )),
    }
}
