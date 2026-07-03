//! Focus session API handlers.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{
    ActivityZone, AppEvent, AppEventKind, AppEventSource, FocusSession, FocusSessionState,
    FocusSessionView, WorkItem, WorkItemState, WorkItemType,
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
                Some(ActivityZone::Work),
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
    let activity_zone = linked_work_item.activity_zone;
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

    let session = FocusSession::new(title, work_item_id, activity_zone, target_seconds);
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

/// Handle focus.update.
pub async fn handle_focus_update(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = parse_required_uuid(params.get("id"), request_id)?;
    let requested_title = parse_optional_title(params.get("title"), request_id)?;
    let requested_work_item_id = parse_nullable_uuid(params.get("work_item_id"), request_id)?;
    let requested_started_at = parse_optional_datetime(params.get("started_at"), request_id)?;
    let requested_stopped_at = parse_optional_datetime(params.get("stopped_at"), request_id)?;
    let requested_activity_zone =
        parse_optional_activity_zone(params.get("activity_zone"), request_id)?;
    let requested_target_seconds =
        parse_optional_target_seconds(params.get("target_seconds"), request_id)?;
    let requested_note = parse_nullable_note(params.get("note"), request_id)?;

    let state = state.write().await;
    let (mut session, work_item_title) = state
        .db
        .get_focus_session(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "not_found",
                "Focus session not found",
            )
        })?;

    if session.state == FocusSessionState::Active {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Active focus sessions cannot be corrected; stop the timer first",
        ));
    }

    let (title, work_item_id, updated_work_item_title, assignment_activity_zone) =
        resolve_focus_assignment(
            &state,
            requested_title,
            requested_work_item_id,
            session.title.clone(),
            session.work_item_id,
            work_item_title,
            session.activity_zone,
            request_id,
        )
        .await?;

    session.title = title;
    session.work_item_id = work_item_id;
    session.activity_zone = requested_activity_zone.unwrap_or(assignment_activity_zone);
    if let Some(target_seconds) = requested_target_seconds {
        session.target_seconds = target_seconds;
    }
    if let Some(note) = requested_note {
        session.note = note;
    }
    if let Some(started_at) = requested_started_at {
        session.started_at = started_at;
    }
    if let Some(stopped_at) = requested_stopped_at {
        session.stopped_at = Some(stopped_at);
    }

    let stopped_at = session.stopped_at.ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Stopped focus session must have stopped_at",
        )
    })?;
    validate_focus_interval(session.started_at, stopped_at, request_id)?;
    session.updated_at = Utc::now();

    state.db.update_focus_session(&session).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    let view = FocusSessionView::from_session(&session, updated_work_item_title, Utc::now());
    Ok(serde_json::to_value(view).unwrap())
}

/// Handle focus.create_stopped.
pub async fn handle_focus_create_stopped(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let requested_title = parse_optional_title(params.get("title"), request_id)?;
    let requested_work_item_id =
        parse_optional_uuid(params.get("work_item_id"), request_id)?.map(Some);
    if requested_title.is_none() && requested_work_item_id.is_none() {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Title or work_item_id is required",
        ));
    }

    let started_at = parse_required_datetime(params.get("started_at"), request_id)?;
    let stopped_at = parse_required_datetime(params.get("stopped_at"), request_id)?;
    validate_focus_interval(started_at, stopped_at, request_id)?;

    let requested_activity_zone =
        parse_optional_activity_zone(params.get("activity_zone"), request_id)?;
    let requested_target_seconds =
        parse_optional_target_seconds(params.get("target_seconds"), request_id)?;
    let requested_note = parse_nullable_note(params.get("note"), request_id)?;

    let state = state.write().await;
    let (title, work_item_id, work_item_title, assignment_activity_zone) =
        resolve_focus_assignment(
            &state,
            requested_title,
            requested_work_item_id,
            "Missed focus block".to_string(),
            None,
            None,
            ActivityZone::Work,
            request_id,
        )
        .await?;

    let now = Utc::now();
    let session = FocusSession {
        id: Uuid::new_v4(),
        title,
        work_item_id,
        activity_zone: requested_activity_zone.unwrap_or(assignment_activity_zone),
        state: FocusSessionState::Stopped,
        target_seconds: requested_target_seconds.unwrap_or(25 * 60),
        note: requested_note.unwrap_or(None),
        started_at,
        stopped_at: Some(stopped_at),
        updated_at: now,
    };

    state.db.create_focus_session(&session).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    let view = FocusSessionView::from_session(&session, work_item_title, now);
    Ok(serde_json::to_value(view).unwrap())
}

/// Handle focus.split.
pub async fn handle_focus_split(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = parse_required_uuid(params.get("id"), request_id)?;
    let split_at = parse_required_datetime(params.get("split_at"), request_id)?;
    let right_title = parse_optional_title(params.get("right_title"), request_id)?;
    let right_work_item_id = parse_nullable_uuid(params.get("right_work_item_id"), request_id)?;
    let right_note = parse_nullable_note(params.get("right_note"), request_id)?;

    let state = state.write().await;
    let (mut left, left_work_item_title) = state
        .db
        .get_focus_session(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "not_found",
                "Focus session not found",
            )
        })?;

    if left.state == FocusSessionState::Active {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Active focus sessions cannot be split; stop the timer first",
        ));
    }

    let original_stopped_at = left.stopped_at.ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Stopped focus session must have stopped_at",
        )
    })?;

    if split_at <= left.started_at || split_at >= original_stopped_at {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Split time must be inside the focus block",
        ));
    }

    let (right_title, right_work_item_id, right_work_item_title, right_activity_zone) =
        resolve_focus_assignment(
            &state,
            right_title,
            right_work_item_id,
            left.title.clone(),
            left.work_item_id,
            left_work_item_title.clone(),
            left.activity_zone,
            request_id,
        )
        .await?;

    let now = Utc::now();
    left.stopped_at = Some(split_at);
    left.updated_at = now;

    let right = FocusSession {
        id: Uuid::new_v4(),
        title: right_title,
        work_item_id: right_work_item_id,
        activity_zone: right_activity_zone,
        state: FocusSessionState::Stopped,
        target_seconds: left.target_seconds,
        note: right_note.unwrap_or(None),
        started_at: split_at,
        stopped_at: Some(original_stopped_at),
        updated_at: now,
    };

    state.db.update_focus_session(&left).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;
    state.db.create_focus_session(&right).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    Ok(serde_json::json!({
        "left": FocusSessionView::from_session(&left, left_work_item_title, now),
        "right": FocusSessionView::from_session(&right, right_work_item_title, now),
    }))
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

async fn resolve_focus_assignment(
    state: &AppState,
    requested_title: Option<String>,
    requested_work_item_id: Option<Option<Uuid>>,
    fallback_title: String,
    fallback_work_item_id: Option<Uuid>,
    fallback_work_item_title: Option<String>,
    fallback_activity_zone: ActivityZone,
    request_id: &str,
) -> Result<(String, Option<Uuid>, Option<String>, ActivityZone), RpcResponse> {
    if let Some(work_item_id) = requested_work_item_id {
        if let Some(work_item_id) = work_item_id {
            let item = state
                .db
                .get_work_item(work_item_id)
                .await
                .map_err(|e| {
                    RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
                })?
                .ok_or_else(|| {
                    RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
                })?;

            return Ok((
                item.title.clone(),
                Some(item.id),
                Some(item.title),
                item.activity_zone,
            ));
        }

        let title = requested_title.unwrap_or(fallback_title);
        return Ok((title, None, None, fallback_activity_zone));
    }

    if let Some(title) = requested_title {
        let item = if let Some(item) =
            state
                .db
                .find_work_item_by_title(&title)
                .await
                .map_err(|e| {
                    RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
                })? {
            item
        } else {
            let item = WorkItem::new(
                title,
                Some(WorkItemType::Task),
                Some(ActivityZone::Work),
                Some(WorkItemState::Unknown),
                None,
            );
            state.db.create_work_item(&item).await.map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
            item
        };

        return Ok((
            item.title.clone(),
            Some(item.id),
            Some(item.title),
            item.activity_zone,
        ));
    }

    Ok((
        fallback_title,
        fallback_work_item_id,
        fallback_work_item_title,
        fallback_activity_zone,
    ))
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
                "Focus session ID is required",
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

fn parse_nullable_uuid(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<Option<Uuid>>, RpcResponse> {
    let Some(value) = value else {
        return Ok(None);
    };

    if value.is_null() {
        return Ok(Some(None));
    }

    let uuid = value
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "validation_error", "Invalid UUID")
        })?;

    Uuid::parse_str(uuid)
        .map(Some)
        .map(Some)
        .map_err(|_| RpcResponse::error(request_id.to_string(), "validation_error", "Invalid UUID"))
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

fn validate_focus_interval(
    started_at: DateTime<Utc>,
    stopped_at: DateTime<Utc>,
    request_id: &str,
) -> Result<(), RpcResponse> {
    if stopped_at <= started_at {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Focus block end must be after start",
        ));
    }

    Ok(())
}

fn parse_optional_title(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<String>, RpcResponse> {
    value
        .map(|value| {
            value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    RpcResponse::error(
                        request_id.to_string(),
                        "validation_error",
                        "Title cannot be empty",
                    )
                })
        })
        .transpose()
}

fn parse_nullable_note(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<Option<String>>, RpcResponse> {
    let Some(value) = value else {
        return Ok(None);
    };

    if value.is_null() {
        return Ok(Some(None));
    }

    value
        .as_str()
        .map(str::trim)
        .map(|note| {
            if note.is_empty() {
                None
            } else {
                Some(note.to_string())
            }
        })
        .map(Some)
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Note must be a string or null",
            )
        })
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

fn parse_optional_target_seconds(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<i64>, RpcResponse> {
    value
        .map(|value| {
            value
                .as_i64()
                .filter(|seconds| *seconds >= 60)
                .ok_or_else(|| {
                    RpcResponse::error(
                        request_id.to_string(),
                        "validation_error",
                        "Target seconds must be at least 60",
                    )
                })
        })
        .transpose()
}

fn parse_required_datetime(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<DateTime<Utc>, RpcResponse> {
    parse_optional_datetime(value, request_id)?.ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Datetime is required",
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
