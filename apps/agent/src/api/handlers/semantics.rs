//! RPC handlers for Tracks, Labels, and Work Item semantic assignments.

use std::sync::Arc;

use chrono::Utc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{normalize_semantic_title, Label, LabelView, Track, TrackView};
use crate::AppState;

pub async fn handle_taxonomy_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let include_archived = params
        .get("include_archived")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let state = state.read().await;
    let tracks = state
        .db
        .list_tracks(include_archived)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let labels = state
        .db
        .list_labels(include_archived)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::json!({
        "tracks": tracks,
        "labels": labels,
        "updated_at": Utc::now().to_rfc3339(),
    }))
}

pub async fn handle_track_create(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let title = parse_required_title(params.get("title"), request_id)?;
    let parent_track_id = parse_optional_uuid(params.get("parent_track_id"), request_id)?;
    let state = state.write().await;
    state
        .db
        .validate_track_parent(None, parent_track_id)
        .await
        .map_err(|error| validation_error(request_id, error))?;
    let normalized = normalize_semantic_title(&title);
    if state
        .db
        .find_track_by_normalized_title(&normalized)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .is_some()
    {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Track with this title already exists",
        ));
    }
    let track = Track::new(title, parent_track_id);
    state
        .db
        .create_track(&track)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let path = state
        .db
        .track_path(track.id)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(TrackView::from_track(&track, path)).unwrap())
}

pub async fn handle_track_update(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = parse_required_uuid(params.get("id"), "Track ID", request_id)?;
    let requested_title = params
        .get("title")
        .map(|value| parse_required_title(Some(value), request_id))
        .transpose()?;
    let requested_parent = parse_nullable_uuid(params.get("parent_track_id"), request_id)?;
    let state = state.write().await;
    let mut track = state
        .db
        .get_track(id)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Track not found")
        })?;

    if let Some(title) = requested_title {
        let normalized = normalize_semantic_title(&title);
        if let Some(existing) = state
            .db
            .find_track_by_normalized_title(&normalized)
            .await
            .map_err(|error| internal_error(request_id, error))?
        {
            if existing.id != id {
                return Err(RpcResponse::error(
                    request_id.to_string(),
                    "validation_error",
                    "Track with this title already exists",
                ));
            }
        }
        track.title = title;
        track.normalized_title = normalized;
    }
    if let Some(parent_track_id) = requested_parent {
        state
            .db
            .validate_track_parent(Some(id), parent_track_id)
            .await
            .map_err(|error| validation_error(request_id, error))?;
        track.parent_track_id = parent_track_id;
    }
    track.updated_at = Utc::now();
    state
        .db
        .update_track(&track)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let path = state
        .db
        .track_path(track.id)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(TrackView::from_track(&track, path)).unwrap())
}

pub async fn handle_track_archive(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = parse_required_uuid(params.get("id"), "Track ID", request_id)?;
    let archived = params
        .get("archived")
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    let state = state.write().await;
    let mut track = state
        .db
        .get_track(id)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Track not found")
        })?;
    let now = Utc::now();
    track.archived_at = archived.then_some(now);
    track.updated_at = now;
    state
        .db
        .update_track(&track)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let path = state
        .db
        .track_path(track.id)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(TrackView::from_track(&track, path)).unwrap())
}

pub async fn handle_label_create(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let title = parse_required_title(params.get("title"), request_id)?;
    let state = state.write().await;
    let normalized = normalize_semantic_title(&title);
    if state
        .db
        .find_label_by_normalized_title(&normalized)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .is_some()
    {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Label with this title already exists",
        ));
    }
    let label = Label::new(title);
    state
        .db
        .create_label(&label)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(LabelView::from_label(&label)).unwrap())
}

pub async fn handle_label_update(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = parse_required_uuid(params.get("id"), "Label ID", request_id)?;
    let title = parse_required_title(params.get("title"), request_id)?;
    let state = state.write().await;
    let mut label = state
        .db
        .get_label(id)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Label not found")
        })?;
    let normalized = normalize_semantic_title(&title);
    if let Some(existing) = state
        .db
        .find_label_by_normalized_title(&normalized)
        .await
        .map_err(|error| internal_error(request_id, error))?
    {
        if existing.id != id {
            return Err(RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Label with this title already exists",
            ));
        }
    }
    label.title = title;
    label.normalized_title = normalized;
    label.updated_at = Utc::now();
    state
        .db
        .update_label(&label)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(LabelView::from_label(&label)).unwrap())
}

pub async fn handle_label_archive(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = parse_required_uuid(params.get("id"), "Label ID", request_id)?;
    let archived = params
        .get("archived")
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    let state = state.write().await;
    let mut label = state
        .db
        .get_label(id)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Label not found")
        })?;
    let now = Utc::now();
    label.archived_at = archived.then_some(now);
    label.updated_at = now;
    state
        .db
        .update_label(&label)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(LabelView::from_label(&label)).unwrap())
}

pub async fn handle_work_item_set_semantics(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let work_item_id = parse_required_uuid(params.get("id"), "Work Item ID", request_id)?;
    let track_id = parse_optional_uuid(params.get("track_id"), request_id)?;
    let label_ids = parse_uuid_array(params.get("label_ids"), request_id)?;
    let state = state.write().await;
    state
        .db
        .get_work_item(work_item_id)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;
    let current = state
        .db
        .get_work_item_semantics(work_item_id)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let current_track_id = current.track.as_ref().map(|track| track.id);
    let current_label_ids = current
        .labels
        .iter()
        .map(|label| label.id)
        .collect::<std::collections::HashSet<_>>();
    if let Some(track_id) = track_id {
        let track = state
            .db
            .get_track(track_id)
            .await
            .map_err(|error| internal_error(request_id, error))?
            .ok_or_else(|| {
                RpcResponse::error(request_id.to_string(), "not_found", "Track not found")
            })?;
        if track.archived_at.is_some() && current_track_id != Some(track_id) {
            return Err(RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Archived Track cannot be assigned",
            ));
        }
    }
    for label_id in &label_ids {
        let label = state
            .db
            .get_label(*label_id)
            .await
            .map_err(|error| internal_error(request_id, error))?
            .ok_or_else(|| {
                RpcResponse::error(request_id.to_string(), "not_found", "Label not found")
            })?;
        if label.archived_at.is_some() && !current_label_ids.contains(label_id) {
            return Err(RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Archived Label cannot be assigned",
            ));
        }
    }
    let semantics = state
        .db
        .set_work_item_semantics(work_item_id, track_id, &label_ids)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(semantics).unwrap())
}

fn parse_required_title(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<String, RpcResponse> {
    let title = value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Title is required",
            )
        })?;
    if title.chars().count() > 200 {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Title is too long",
        ));
    }
    Ok(title.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn parse_required_uuid(
    value: Option<&serde_json::Value>,
    label: &str,
    request_id: &str,
) -> Result<Uuid, RpcResponse> {
    let raw = value
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                &format!("{label} is required"),
            )
        })?;
    Uuid::parse_str(raw).map_err(|_| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            &format!("Invalid {label}"),
        )
    })
}

fn parse_optional_uuid(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<Uuid>, RpcResponse> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| {
                RpcResponse::error(request_id.to_string(), "validation_error", "Invalid UUID")
            }),
    }
}

fn parse_nullable_uuid(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<Option<Uuid>>, RpcResponse> {
    match value {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(Some(None)),
        Some(value) => parse_optional_uuid(Some(value), request_id).map(Some),
    }
}

fn parse_uuid_array(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Vec<Uuid>, RpcResponse> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let values = value.as_array().ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "label_ids must be an array",
        )
    })?;
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .and_then(|value| Uuid::parse_str(value).ok())
                .ok_or_else(|| {
                    RpcResponse::error(
                        request_id.to_string(),
                        "validation_error",
                        "label_ids contains an invalid UUID",
                    )
                })
        })
        .collect()
}

fn internal_error(request_id: &str, error: impl std::fmt::Display) -> RpcResponse {
    RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
}

fn validation_error(request_id: &str, error: impl std::fmt::Display) -> RpcResponse {
    RpcResponse::error(
        request_id.to_string(),
        "validation_error",
        &error.to_string(),
    )
}
