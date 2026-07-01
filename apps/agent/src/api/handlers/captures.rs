//! Capture inbox API handlers.

use std::sync::Arc;

use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{Capture, CaptureState, WorkItem, WorkItemState, WorkItemType};
use crate::AppState;

pub async fn handle_capture_create(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let text = params
        .get("text")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Capture text is required",
            )
        })?;

    let requested_focus_session_id =
        parse_optional_uuid(params.get("focus_session_id"), request_id)?;

    let state = state.read().await;
    let focus_session_id = match requested_focus_session_id {
        Some(id) => Some(id),
        None => state
            .db
            .get_active_focus_session()
            .await
            .map_err(|error| {
                RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
            })?
            .map(|(session, _)| session.id),
    };

    let capture = Capture::new(text.to_string(), focus_session_id);
    state.db.create_capture(&capture).await.map_err(|error| {
        RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
    })?;

    Ok(serde_json::to_value(crate::domain::CaptureView::from(capture)).unwrap())
}

pub async fn handle_capture_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let states = params
        .get("state")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str())
                .filter_map(CaptureState::from_str)
                .collect::<Vec<_>>()
        });

    let state = state.read().await;
    let captures = state
        .db
        .list_captures(states.as_deref())
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?
        .into_iter()
        .map(crate::domain::CaptureView::from)
        .collect::<Vec<_>>();
    let total = captures.len();

    Ok(serde_json::json!({
        "captures": captures,
        "total": total,
        "updated_at": chrono::Utc::now().to_rfc3339(),
    }))
}

pub async fn handle_capture_resolve(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_capture_id(&params, request_id)?;
    let state = state.write().await;
    let mut capture = get_existing_capture(&state, id, request_id).await?;

    capture.resolve();
    state.db.update_capture(&capture).await.map_err(|error| {
        RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
    })?;

    Ok(serde_json::to_value(crate::domain::CaptureView::from(capture)).unwrap())
}

pub async fn handle_capture_convert_to_work_item(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_capture_id(&params, request_id)?;
    let title_override = params
        .get("title")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let state = state.write().await;
    let mut capture = get_existing_capture(&state, id, request_id).await?;
    let title = title_override.unwrap_or(capture.text.as_str()).to_string();

    let mut reused = false;
    let item = if let Some(item) =
        state
            .db
            .find_work_item_by_title(&title)
            .await
            .map_err(|error| {
                RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
            })? {
        reused = true;
        item
    } else {
        let item = WorkItem::new(
            title,
            Some(WorkItemType::Task),
            Some(WorkItemState::Unknown),
            None,
        );
        state.db.create_work_item(&item).await.map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
        item
    };

    capture.convert_to_work_item(item.id);
    state.db.update_capture(&capture).await.map_err(|error| {
        RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
    })?;

    Ok(serde_json::json!({
        "capture": crate::domain::CaptureView::from(capture),
        "work_item_id": item.id.to_string(),
        "reused": reused,
    }))
}

async fn get_existing_capture(
    state: &AppState,
    id: Uuid,
    request_id: &str,
) -> Result<Capture, RpcResponse> {
    state
        .db
        .get_capture(id)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?
        .ok_or_else(|| RpcResponse::error(request_id.to_string(), "not_found", "Capture not found"))
}

fn get_capture_id(params: &serde_json::Value, request_id: &str) -> Result<Uuid, RpcResponse> {
    let id = params
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Capture ID is required",
            )
        })?;

    Uuid::parse_str(id)
        .map_err(|_| RpcResponse::error(request_id.to_string(), "validation_error", "Invalid UUID"))
}

fn parse_optional_uuid(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<Uuid>, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            Uuid::parse_str(value).map_err(|_| {
                RpcResponse::error(request_id.to_string(), "validation_error", "Invalid UUID")
            })
        })
        .transpose()
}
