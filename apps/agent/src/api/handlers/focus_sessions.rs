//! Focus session API handlers.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{
    AppEvent, AppEventKind, AppEventSource, FocusSession, FocusSessionState, FocusSessionView,
    WorkItem, WorkItemState, WorkItemType,
};
use crate::AppState;

/// Handle focus.current.
pub async fn handle_focus_current(
    state: &Arc<RwLock<AppState>>,
    _params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let state = state.read().await;
    let now = Utc::now();
    let session = state
        .db
        .get_active_focus_session()
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .map(|(session, work_item_title)| {
            FocusSessionView::from_session(&session, work_item_title, now)
        });

    Ok(serde_json::json!({ "session": session }))
}

/// Handle focus.start.
pub async fn handle_focus_start(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let requested_work_item_id = parse_optional_uuid(params.get("work_item_id"), request_id)?;
    let target_seconds = params
        .get("target_seconds")
        .and_then(|value| value.as_i64())
        .filter(|seconds| *seconds >= 60);
    let telemetry_action_id = params
        .get("telemetry_action_id")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let requested_title = params
        .get("title")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let state = state.write().await;

    let mut reused_work_item = false;
    let linked_work_item = if let Some(work_item_id) = requested_work_item_id {
        state
            .db
            .get_work_item(work_item_id)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?
            .ok_or_else(|| {
                RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
            })?
    } else {
        let title = requested_title.as_ref().ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Title is required",
            )
        })?;

        if let Some(item) = state.db.find_work_item_by_title(title).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })? {
            reused_work_item = true;
            item
        } else {
            let item = WorkItem::new(
                title.clone(),
                Some(WorkItemType::Task),
                Some(WorkItemState::Unknown),
                None,
            );
            state.db.create_work_item(&item).await.map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
            item
        }
    };
    let work_item_id = Some(linked_work_item.id);
    let work_item_title = Some(linked_work_item.title.clone());
    let title = linked_work_item.title.clone();

    if let Some((mut active_session, active_work_item_title)) =
        state.db.get_active_focus_session().await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?
    {
        if active_session.work_item_id == work_item_id {
            let view =
                FocusSessionView::from_session(&active_session, active_work_item_title, Utc::now());
            let _ = state
                .db
                .log_app_event(&agent_event(
                    AppEventKind::FocusStarted,
                    work_item_id,
                    Some(active_session.id),
                    Some(serde_json::json!({
                    "action_id": telemetry_action_id,
                    "already_active": true,
                    "reused": true,
                    })),
                ))
                .await;
            return Ok(serde_json::to_value(view).unwrap());
        }

        active_session.stop(None);
        state
            .db
            .update_focus_session(&active_session)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
        let stopped_id = active_session.id;
        let _ = state
            .db
            .log_app_event(&agent_event(
                AppEventKind::FocusStopped,
                None,
                Some(stopped_id),
                Some(serde_json::json!({
                "reason": "switch",
                })),
            ))
            .await;
    }

    state
        .db
        .clear_active_work_items_except(work_item_id, WorkItemState::Unknown)
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

    let session = FocusSession::new(title, work_item_id, target_seconds);
    state.db.create_focus_session(&session).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    let mut item = linked_work_item;
    item.set_state(WorkItemState::Active);
    let _ = state.db.update_work_item(&item).await;

    let view = FocusSessionView::from_session(&session, work_item_title, Utc::now());
    let focus_session_id = session.id;
    let event_kind = if reused_work_item || requested_work_item_id.is_some() {
        AppEventKind::FocusSwitched
    } else {
        AppEventKind::FocusStarted
    };
    let _ = state
        .db
        .log_app_event(&agent_event(
            event_kind,
            work_item_id,
            Some(focus_session_id),
            Some(serde_json::json!({
            "action_id": telemetry_action_id,
            "already_active": false,
            "reused": reused_work_item,
            })),
        ))
        .await;
    Ok(serde_json::to_value(view).unwrap())
}

/// Handle focus.stop.
pub async fn handle_focus_stop(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let requested_id = parse_optional_uuid(params.get("id"), request_id)?;
    let telemetry_action_id = params
        .get("telemetry_action_id")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let note = params
        .get("note")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    let state = state.write().await;

    let (mut session, work_item_title) = if let Some(id) = requested_id {
        state
            .db
            .get_focus_session(id)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?
            .ok_or_else(|| {
                RpcResponse::error(
                    request_id.to_string(),
                    "not_found",
                    "Focus session not found",
                )
            })?
    } else {
        state
            .db
            .get_active_focus_session()
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?
            .ok_or_else(|| {
                RpcResponse::error(
                    request_id.to_string(),
                    "not_found",
                    "No active focus session",
                )
            })?
    };

    if session.state == FocusSessionState::Active {
        session.stop(note);
        state.db.update_focus_session(&session).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

        state
            .db
            .clear_active_work_items_except(None, WorkItemState::Unknown)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
    }

    let view = FocusSessionView::from_session(&session, work_item_title, Utc::now());
    let work_item_id = session.work_item_id;
    let focus_session_id = session.id;
    let _ = state
        .db
        .log_app_event(&agent_event(
            AppEventKind::FocusStopped,
            work_item_id,
            Some(focus_session_id),
            Some(serde_json::json!({
            "action_id": telemetry_action_id,
            })),
        ))
        .await;
    Ok(serde_json::to_value(view).unwrap())
}

fn agent_event(
    kind: AppEventKind,
    work_item_id: Option<Uuid>,
    focus_session_id: Option<Uuid>,
    payload: Option<serde_json::Value>,
) -> AppEvent {
    let mut event = AppEvent::new(AppEventSource::Agent, kind);
    event.work_item_id = work_item_id;
    event.focus_session_id = focus_session_id;
    event.payload = payload;
    event
}

/// Handle focus.list.
pub async fn handle_focus_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let from = parse_optional_datetime(params.get("from"), request_id)?;
    let to = parse_optional_datetime(params.get("to"), request_id)?;

    let state = state.read().await;
    let now = Utc::now();
    let sessions = state
        .db
        .list_focus_sessions(from, to, now)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .into_iter()
        .map(|(session, work_item_title)| {
            let mut view = FocusSessionView::from_session(&session, work_item_title, now);
            if from.is_some() || to.is_some() {
                view.active_seconds = clipped_active_seconds(&session, now, from, to);
                view.over_target_seconds = (view.active_seconds - view.target_seconds).max(0);
            }
            view
        })
        .collect::<Vec<_>>();

    let active_seconds_total = sessions
        .iter()
        .map(|session| session.active_seconds)
        .sum::<i64>();

    Ok(serde_json::json!({
        "sessions": sessions,
        "total": sessions.len(),
        "active_seconds_total": active_seconds_total,
        "updated_at": now.to_rfc3339(),
    }))
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

fn clipped_active_seconds(
    session: &FocusSession,
    now: DateTime<Utc>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
) -> i64 {
    let started_at = from
        .filter(|from| *from > session.started_at)
        .unwrap_or(session.started_at);
    let raw_stopped_at = session.stopped_at.unwrap_or(now);
    let stopped_at = to
        .filter(|to| *to < raw_stopped_at)
        .unwrap_or(raw_stopped_at);

    (stopped_at - started_at).num_seconds().max(0)
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
