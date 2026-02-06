//! Agent API handlers

use std::sync::Arc;
use tokio::sync::RwLock;

use crate::api::handlers::{RpcResponse, API_VERSION};
use crate::AppState;

/// Handle agent.ping
pub fn handle_agent_ping() -> Result<serde_json::Value, RpcResponse> {
    Ok(serde_json::json!("pong"))
}

/// Handle agent.status
pub async fn handle_agent_status(state: &Arc<RwLock<AppState>>) -> Result<serde_json::Value, RpcResponse> {
    let state = state.read().await;
    let uptime = state.start_time.elapsed().as_secs();
    let work_items_count = state.db.count_work_items().await.unwrap_or(0);
    let db_ok = state.db.is_healthy().await;
    
    let data_dir = crate::runtime::get_data_dir();
    
    Ok(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "api_version": API_VERSION,
        "uptime_seconds": uptime,
        "work_items_count": work_items_count,
        "storage_path": data_dir.to_string_lossy(),
        "db_ok": db_ok,
    }))
}

/// Handle agent.version
pub fn handle_agent_version() -> Result<serde_json::Value, RpcResponse> {
    Ok(serde_json::json!({
        "agent_version": env!("CARGO_PKG_VERSION"),
        "api_version": API_VERSION,
    }))
}
