//! Work item API handlers

use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{
    AppEvent, AppEventKind, AppEventSource, FocusSession, WorkItem, WorkItemEvent,
    WorkItemEventKind, WorkItemState, WorkItemType,
};
use crate::AppState;

/// Handle work_item.create
pub async fn handle_work_item_create(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Title is required",
            )
        })?;

    let item_type = params
        .get("type")
        .and_then(|v| v.as_str())
        .and_then(WorkItemType::from_str);

    let item_state = params
        .get("state")
        .and_then(|v| v.as_str())
        .and_then(WorkItemState::from_str);

    let note = params
        .get("note")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let should_start_focus = item_state == Some(WorkItemState::Active);

    let state = state.write().await;

    let mut focus_session_id = None;
    let mut reused = false;

    let mut item = if let Some(item) =
        state.db.find_work_item_by_title(title).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })? {
        reused = true;
        item
    } else {
        let initial_state = if should_start_focus {
            Some(WorkItemState::Unknown)
        } else {
            item_state
        };
        let item = WorkItem::new(title.to_string(), item_type, initial_state, note);
        state.db.create_work_item(&item).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
        item
    };

    if should_start_focus {
        let old_state = item.state;
        focus_session_id =
            activate_work_item_for_focus(&state, &mut item, request_id, "work_item_create_active")
                .await?;

        if reused && old_state != WorkItemState::Active {
            state
                .db
                .log_event(&WorkItemEvent::new(
                    item.id,
                    WorkItemEventKind::StateChanged,
                    Some(serde_json::json!({
                        "old_state": old_state.as_str(),
                        "new_state": WorkItemState::Active.as_str(),
                    })),
                ))
                .await
                .ok();
        }
    }

    Ok(serde_json::json!({
        "id": item.id.to_string(),
        "focus_session_id": focus_session_id,
        "reused": reused,
    }))
}

/// Handle work_item.touch
pub async fn handle_work_item_touch(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let state = state.write().await;

    let mut item = state
        .db
        .get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;

    item.touch();

    state.db.update_work_item(&item).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    state
        .db
        .log_event(&WorkItemEvent::new(id, WorkItemEventKind::Touched, None))
        .await
        .ok();

    Ok(serde_json::json!({ "success": true }))
}

/// Handle work_item.set_state
pub async fn handle_work_item_set_state(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let new_state = params
        .get("state")
        .and_then(|v| v.as_str())
        .and_then(WorkItemState::from_str)
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Valid state is required",
            )
        })?;

    let state = state.write().await;

    let mut item = state
        .db
        .get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;

    let old_state = item.state;
    let mut focus_session_id = None;

    if new_state == WorkItemState::Active {
        focus_session_id =
            activate_work_item_for_focus(&state, &mut item, request_id, "work_item_set_active")
                .await?;
    } else {
        if let Some((mut session, _)) = state.db.get_active_focus_session().await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })? {
            if session.work_item_id == Some(id) {
                let _ = state
                    .db
                    .log_app_event(&app_event(
                        AppEventKind::FocusStopRequested,
                        Some(id),
                        Some(session.id),
                        Some(serde_json::json!({
                            "control": "work_item_state",
                            "reason": "state_changed",
                        })),
                    ))
                    .await;
                session.stop(None);
                state.db.update_focus_session(&session).await.map_err(|e| {
                    RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
                })?;
                let _ = state
                    .db
                    .log_app_event(&app_event(
                        AppEventKind::FocusStopped,
                        Some(id),
                        Some(session.id),
                        Some(serde_json::json!({
                            "control": "work_item_state",
                            "reason": "state_changed",
                        })),
                    ))
                    .await;
            }
        }

        item.set_state(new_state);
        state.db.update_work_item(&item).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
    }

    state
        .db
        .log_event(&WorkItemEvent::new(
            id,
            WorkItemEventKind::StateChanged,
            Some(serde_json::json!({
                "old_state": old_state.as_str(),
                "new_state": new_state.as_str(),
            })),
        ))
        .await
        .ok();

    Ok(serde_json::json!({
        "success": true,
        "focus_session_id": focus_session_id,
    }))
}

/// Handle work_item.set_note
pub async fn handle_work_item_set_note(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let note = params
        .get("note")
        .and_then(|v| v.as_str())
        .map(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
        .unwrap_or(None);

    let state = state.write().await;

    let mut item = state
        .db
        .get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;

    item.set_note(note);

    state.db.update_work_item(&item).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    state
        .db
        .log_event(&WorkItemEvent::new(
            id,
            WorkItemEventKind::NoteChanged,
            None,
        ))
        .await
        .ok();

    Ok(serde_json::json!({ "success": true }))
}

/// Handle work_item.toggle_pin
pub async fn handle_work_item_toggle_pin(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let state = state.write().await;

    let mut item = state
        .db
        .get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;

    let was_pinned = item.pinned;
    item.toggle_pin();

    state.db.update_work_item(&item).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    let event_kind = if was_pinned {
        WorkItemEventKind::Unpinned
    } else {
        WorkItemEventKind::Pinned
    };
    state
        .db
        .log_event(&WorkItemEvent::new(id, event_kind, None))
        .await
        .ok();

    Ok(serde_json::json!({ "success": true, "pinned": item.pinned }))
}

/// Handle work_item.delete
pub async fn handle_work_item_delete(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;

    let mode = params
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("soft");

    let state = state.write().await;

    let mut stopped_focus_session_id = None;
    if let Some((mut session, _)) =
        state.db.get_active_focus_session().await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?
    {
        if session.work_item_id == Some(id) {
            let _ = state
                .db
                .log_app_event(&app_event(
                    AppEventKind::FocusStopRequested,
                    Some(id),
                    Some(session.id),
                    Some(serde_json::json!({
                        "control": "work_item_delete",
                        "reason": "deleted",
                    })),
                ))
                .await;
            session.stop(Some("work item deleted".to_string()));
            stopped_focus_session_id = Some(session.id);
            state.db.update_focus_session(&session).await.map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
            let _ = state
                .db
                .log_app_event(&app_event(
                    AppEventKind::FocusStopped,
                    Some(id),
                    Some(session.id),
                    Some(serde_json::json!({
                        "control": "work_item_delete",
                        "reason": "deleted",
                    })),
                ))
                .await;
        }
    }

    if mode == "hard" {
        // Hard delete
        let deleted = state.db.delete_work_item(id).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

        if !deleted {
            return Err(RpcResponse::error(
                request_id.to_string(),
                "not_found",
                "Work item not found",
            ));
        }
    } else {
        // Soft delete
        let mut item = state
            .db
            .get_work_item(id)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?
            .ok_or_else(|| {
                RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
            })?;

        item.soft_delete();

        state.db.update_work_item(&item).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

        state
            .db
            .log_event(&WorkItemEvent::new(id, WorkItemEventKind::Deleted, None))
            .await
            .ok();
    }

    Ok(serde_json::json!({
        "success": true,
        "stopped_focus_session_id": stopped_focus_session_id,
    }))
}

async fn activate_work_item_for_focus(
    state: &AppState,
    item: &mut WorkItem,
    request_id: &str,
    control: &'static str,
) -> Result<Option<Uuid>, RpcResponse> {
    let id = item.id;
    let mut active_session = state
        .db
        .get_active_focus_session()
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .map(|(session, _)| session);

    let was_switch = active_session
        .as_ref()
        .is_some_and(|session| session.work_item_id != Some(id));
    let already_active = active_session
        .as_ref()
        .is_some_and(|session| session.work_item_id == Some(id));
    let request_kind = if was_switch {
        AppEventKind::FocusSwitchRequested
    } else {
        AppEventKind::FocusStartRequested
    };

    let _ = state
        .db
        .log_app_event(&app_event(
            request_kind,
            Some(id),
            active_session.as_ref().map(|session| session.id),
            Some(serde_json::json!({
                "control": control,
                "already_active": already_active,
            })),
        ))
        .await;

    if was_switch {
        if let Some(mut session) = active_session.take() {
            let stopped_work_item_id = session.work_item_id;
            session.stop(None);
            state.db.update_focus_session(&session).await.map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
            let _ = state
                .db
                .log_app_event(&app_event(
                    AppEventKind::FocusStopped,
                    stopped_work_item_id,
                    Some(session.id),
                    Some(serde_json::json!({
                        "control": control,
                        "reason": "switch",
                    })),
                ))
                .await;
        }
    }

    state
        .db
        .clear_active_work_items_except(Some(id), WorkItemState::Unknown)
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

    item.set_state(WorkItemState::Active);
    state.db.update_work_item(item).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    if let Some(session) = active_session {
        let _ = state
            .db
            .log_app_event(&app_event(
                AppEventKind::FocusStarted,
                Some(id),
                Some(session.id),
                Some(serde_json::json!({
                    "control": control,
                    "already_active": true,
                })),
            ))
            .await;
        Ok(Some(session.id))
    } else {
        let session = FocusSession::new(item.title.clone(), Some(id), None);
        state.db.create_focus_session(&session).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
        let event_kind = if was_switch {
            AppEventKind::FocusSwitched
        } else {
            AppEventKind::FocusStarted
        };
        let _ = state
            .db
            .log_app_event(&app_event(
                event_kind,
                Some(id),
                Some(session.id),
                Some(serde_json::json!({
                    "control": control,
                    "already_active": false,
                })),
            ))
            .await;
        Ok(Some(session.id))
    }
}

fn app_event(
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

/// Helper to extract work item ID from params
fn get_work_item_id(params: &serde_json::Value, request_id: &str) -> Result<Uuid, RpcResponse> {
    let id_str = params.get("id").and_then(|v| v.as_str()).ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Work item ID is required",
        )
    })?;

    Uuid::parse_str(id_str).map_err(|_| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Invalid work item ID",
        )
    })
}
