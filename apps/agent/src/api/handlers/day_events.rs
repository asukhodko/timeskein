//! Day-event API handlers.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{ActivityZone, DayEvent, DayEventView};
use crate::AppState;

/// Handle day_event.add.
pub async fn handle_day_event_add(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let text = parse_required_text(params.get("text"), request_id)?;
    let focus_session_id = parse_optional_uuid(params.get("focus_session_id"), request_id)?;
    let activity_zone = parse_optional_activity_zone(params.get("activity_zone"), request_id)?;

    let state = state.write().await;
    if let Some(focus_session_id) = focus_session_id {
        let exists = state
            .db
            .get_focus_session(focus_session_id)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?
            .is_some();
        if !exists {
            return Err(RpcResponse::error(
                request_id.to_string(),
                "not_found",
                "Focus session not found",
            ));
        }
    }

    let event = DayEvent::new(text, focus_session_id, activity_zone);
    state.db.create_day_event(&event).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    Ok(serde_json::to_value(DayEventView::from_event(event)).unwrap())
}

/// Handle day_event.list.
pub async fn handle_day_event_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let from = parse_optional_datetime(params.get("from"), request_id)?;
    let to = parse_optional_datetime(params.get("to"), request_id)?;

    let state = state.read().await;
    let events = state
        .db
        .list_day_events(from, to)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .into_iter()
        .map(DayEventView::from_event)
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "events": events,
        "total": events.len(),
        "updated_at": Utc::now().to_rfc3339(),
    }))
}

/// Handle day_event.update.
pub async fn handle_day_event_update(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = parse_required_uuid(params.get("id"), request_id)?;
    let text = parse_required_text(params.get("text"), request_id)?;
    let activity_zone = parse_nullable_activity_zone(params.get("activity_zone"), request_id)?;

    let state = state.write().await;
    let mut event = state
        .db
        .get_day_event(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Day event not found")
        })?;

    event.text = text;
    if let Some(activity_zone) = activity_zone {
        event.activity_zone = activity_zone;
    }
    event.updated_at = Utc::now();

    state.db.update_day_event(&event).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    Ok(serde_json::to_value(DayEventView::from_event(event)).unwrap())
}

/// Handle day_event.delete.
pub async fn handle_day_event_delete(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = parse_required_uuid(params.get("id"), request_id)?;

    let state = state.write().await;
    let deleted = state.db.delete_day_event(id).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;
    if !deleted {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "not_found",
            "Day event not found",
        ));
    }

    Ok(serde_json::json!({
        "success": true,
        "id": id,
    }))
}

fn parse_required_text(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<String, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Day event text is required",
            )
        })
}

fn parse_required_uuid(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Uuid, RpcResponse> {
    let id = value
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Day event ID is required",
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

fn parse_optional_activity_zone(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<ActivityZone>, RpcResponse> {
    value
        .map(|value| {
            value
                .as_str()
                .and_then(ActivityZone::from_str)
                .ok_or_else(|| {
                    RpcResponse::error(
                        request_id.to_string(),
                        "validation_error",
                        "Invalid activity zone",
                    )
                })
        })
        .transpose()
}

fn parse_nullable_activity_zone(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<Option<ActivityZone>>, RpcResponse> {
    let Some(value) = value else {
        return Ok(None);
    };

    if value.is_null() {
        return Ok(Some(None));
    }

    value
        .as_str()
        .and_then(ActivityZone::from_str)
        .map(Some)
        .map(Some)
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Invalid activity zone",
            )
        })
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
                        "Invalid datetime",
                    )
                })
        })
        .transpose()
}
