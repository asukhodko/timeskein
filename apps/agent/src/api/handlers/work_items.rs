//! Work item API handlers

use chrono::{DateTime, Utc};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::db::Database;
use crate::domain::{
    check_denylist, ActivityZone, AppEvent, AppEventKind, AppEventSource, CausalProvenance,
    CausalRecordKind, CausalSource, DenylistCheckResult, EvidenceKind, FocusSession,
    NewCausalRecord, NextActionStatus, OperationalState, Ref, RefKind, WorkItem, WorkItemEvent,
    WorkItemEventKind, WorkItemEventView, WorkItemState, WorkItemType, WorkItemView,
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

    let activity_zone = params
        .get("activity_zone")
        .and_then(|v| v.as_str())
        .and_then(ActivityZone::from_str);

    let item_state = params
        .get("state")
        .and_then(|v| v.as_str())
        .and_then(WorkItemState::from_str);

    let note = params
        .get("note")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let semantics_requested = params.get("track_id").is_some() || params.get("label_ids").is_some();
    let requested_track_id = parse_optional_uuid(params.get("track_id"), request_id)?;
    let requested_label_ids = parse_uuid_array(params.get("label_ids"), request_id)?;

    let should_start_focus = item_state == Some(WorkItemState::Active);

    let state = state.write().await;

    let mut focus_session_id = None;
    let mut reused = false;
    let mut created_event_id = None;

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
        let item = WorkItem::new(
            title.to_string(),
            item_type,
            activity_zone,
            initial_state,
            note,
        );
        created_event_id = Some(state.db.create_work_item(&item).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?);
        item
    };

    if semantics_requested {
        state
            .db
            .set_work_item_semantics(item.id, requested_track_id, &requested_label_ids)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "validation_error", &e.to_string())
            })?;
        if let Some(event_id) = created_event_id {
            state
                .db
                .snapshot_work_item_event_semantics(event_id, item.id)
                .await
                .map_err(|e| {
                    RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
                })?;
        }
    }

    if !reused && !should_start_focus {
        if let Some(operational_state) = item_state.map(operational_state_from_work_item) {
            let mut causal =
                NewCausalRecord::for_work_item(item.id, CausalRecordKind::StateAssertion);
            causal.operational_state = Some(operational_state);
            causal.text = Some("Initial Work Item state".to_string());
            causal.payload = serde_json::json!({ "origin": "work_item.create" });
            state.db.create_causal_record(causal).await.map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
        }
    }

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

    let previous_causal_state = state
        .db
        .latest_operational_state_record(
            crate::domain::OperationalSubjectKind::WorkItem,
            id,
            Utc::now(),
        )
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
    let mut causal = NewCausalRecord::for_work_item(
        id,
        if previous_causal_state.is_some() {
            CausalRecordKind::Correction
        } else {
            CausalRecordKind::StateAssertion
        },
    );
    causal.operational_state = Some(operational_state_from_work_item(new_state));
    causal.supersedes_id = previous_causal_state.map(|record| record.id);
    causal.text = Some(format!(
        "Work Item state changed from {} to {}",
        old_state.as_str(),
        new_state.as_str()
    ));
    causal.payload = serde_json::json!({
        "origin": "work_item.set_state",
        "old_state": old_state.as_str(),
        "new_state": new_state.as_str(),
    });
    state.db.create_causal_record(causal).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

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

/// Handle work_item.add_event
pub async fn handle_work_item_add_event(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;
    let text = params
        .get("text")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Event text is required",
            )
        })?;
    let focus_session_id = parse_optional_uuid(params.get("focus_session_id"), request_id)?;
    let requested_evidence_kind = params
        .get("evidence_kind")
        .and_then(|value| value.as_str())
        .map(|value| {
            EvidenceKind::from_str(value).ok_or_else(|| {
                RpcResponse::error(
                    request_id.to_string(),
                    "validation_error",
                    "Invalid evidence kind",
                )
            })
        })
        .transpose()?;
    let mut ref_ids = parse_uuid_list(params.get("ref_ids"), "ref_ids", request_id)?;
    let evidence_kind = if requested_evidence_kind.is_some()
        || !ref_ids.is_empty()
        || params.get("new_ref").is_some()
    {
        Some(requested_evidence_kind.unwrap_or(EvidenceKind::Observation))
    } else {
        None
    };

    let state = state.write().await;
    let mut item = state
        .db
        .get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;

    if let Some(focus_session_id) = focus_session_id {
        let (session, _) = state
            .db
            .get_focus_session(focus_session_id)
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
            })?;
        if session.work_item_id != Some(id) {
            return Err(RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Focus session belongs to another Work Item",
            ));
        }
    }

    for ref_id in &ref_ids {
        if !state
            .db
            .ref_is_attached_to_work_item(id, *ref_id)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?
        {
            return Err(RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Evidence Ref is not attached to the Work Item",
            ));
        }
    }
    if let Some(new_ref) = params.get("new_ref") {
        let ref_id = resolve_new_evidence_ref(&state.db, id, new_ref, request_id).await?;
        if !ref_ids.contains(&ref_id) {
            ref_ids.push(ref_id);
        }
    }

    item.touch();
    state.db.update_work_item(&item).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    let mut payload = serde_json::json!({ "text": text });
    if let Some(focus_session_id) = focus_session_id {
        payload["focus_session_id"] = serde_json::Value::String(focus_session_id.to_string());
    }
    let event = WorkItemEvent::new(id, WorkItemEventKind::NoteAdded, Some(payload));

    state.db.log_event(&event).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;
    let evidence = match evidence_kind {
        Some(kind) => Some(
            state
                .db
                .create_evidence_entry(event.id, id, kind, focus_session_id, &ref_ids)
                .await
                .map_err(|e| {
                    RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
                })?,
        ),
        None => None,
    };
    if let Some(kind) = evidence_kind {
        create_causal_from_evidence(&state.db, id, event.id, text, kind, focus_session_id, None)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
    }

    Ok(serde_json::to_value(WorkItemEventView::from_event_with_evidence(event, evidence)).unwrap())
}

/// Handle work_item.events
pub async fn handle_work_item_events(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let work_item_id = parse_optional_uuid(params.get("id"), request_id)?;
    let from = parse_optional_datetime(params.get("from"), request_id)?;
    let to = parse_optional_datetime(params.get("to"), request_id)?;

    let state = state.read().await;
    let raw_events = state
        .db
        .list_work_item_events(work_item_id, from, to)
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
    let mut events = Vec::with_capacity(raw_events.len());
    for event in raw_events {
        let evidence = state.db.get_evidence_entry(event.id).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
        events.push(WorkItemEventView::from_event_with_evidence(event, evidence));
    }

    Ok(serde_json::json!({
        "events": events,
        "total": events.len(),
        "updated_at": Utc::now().to_rfc3339(),
    }))
}

/// Handle work_item.update_event
pub async fn handle_work_item_update_event(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_event_id(&params, request_id)?;
    let text = params
        .get("text")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Event text is required",
            )
        })?;
    let evidence_kind = params
        .get("evidence_kind")
        .and_then(|value| value.as_str())
        .map(|value| {
            EvidenceKind::from_str(value).ok_or_else(|| {
                RpcResponse::error(
                    request_id.to_string(),
                    "validation_error",
                    "Invalid evidence kind",
                )
            })
        })
        .transpose()?;

    let state = state.write().await;
    let mut event = state
        .db
        .get_work_item_event(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "not_found",
                "Work item event not found",
            )
        })?;

    if event.kind != WorkItemEventKind::NoteAdded {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Only note_added Work Item events can be edited",
        ));
    }

    let mut payload = event
        .payload
        .take()
        .filter(|payload| payload.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    payload["text"] = serde_json::Value::String(text.to_string());
    event.payload = Some(payload);

    state.db.update_work_item_event(&event).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    let mut evidence = state.db.get_evidence_entry(event.id).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;
    if let Some(kind) = evidence_kind {
        if evidence.is_some() {
            state
                .db
                .update_evidence_kind(event.id, kind)
                .await
                .map_err(|e| {
                    RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
                })?;
        } else {
            let legacy_focus_session_id = event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("focus_session_id"))
                .and_then(|value| value.as_str())
                .and_then(|value| Uuid::parse_str(value).ok());
            state
                .db
                .create_evidence_entry(
                    event.id,
                    event.work_item_id,
                    kind,
                    legacy_focus_session_id,
                    &[],
                )
                .await
                .map_err(|e| {
                    RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
                })?;
        }
        evidence = state.db.get_evidence_entry(event.id).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
    }

    if evidence_kind.is_some() || evidence.is_some() {
        let corrected_kind = evidence_kind
            .or_else(|| {
                evidence
                    .as_ref()
                    .and_then(|entry| EvidenceKind::from_str(&entry.kind))
            })
            .unwrap_or(EvidenceKind::Observation);
        let previous = state
            .db
            .causal_record_for_evidence_event(event.id)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
        create_causal_from_evidence(
            &state.db,
            event.work_item_id,
            event.id,
            text,
            corrected_kind,
            event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("focus_session_id"))
                .and_then(|value| value.as_str())
                .and_then(|value| Uuid::parse_str(value).ok()),
            previous.map(|record| record.id),
        )
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
    }

    Ok(serde_json::to_value(WorkItemEventView::from_event_with_evidence(event, evidence)).unwrap())
}

/// Handle work_item.delete_event
pub async fn handle_work_item_delete_event(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_event_id(&params, request_id)?;

    let state = state.write().await;
    let event = state
        .db
        .get_work_item_event(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "not_found",
                "Work item event not found",
            )
        })?;

    if event.kind != WorkItemEventKind::NoteAdded {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Only note_added Work Item events can be deleted",
        ));
    }

    let previous_causal = state
        .db
        .causal_record_for_evidence_event(id)
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
    let deleted = state
        .db
        .delete_work_item_event_with_causal_correction(
            id,
            event.work_item_id,
            previous_causal.as_ref(),
        )
        .await
        .map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;

    Ok(serde_json::json!({
        "success": deleted,
        "id": id,
    }))
}

/// Handle work_item.update
pub async fn handle_work_item_update(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = get_work_item_id(&params, request_id)?;
    let semantics_requested = params.get("track_id").is_some() || params.get("label_ids").is_some();
    let requested_track_id = parse_optional_uuid(params.get("track_id"), request_id)?;
    let requested_label_ids = parse_uuid_array(params.get("label_ids"), request_id)?;

    let requested_title = if params.get("title").is_some() {
        Some(
            params
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    RpcResponse::error(
                        request_id.to_string(),
                        "validation_error",
                        "Title cannot be empty",
                    )
                })?
                .to_string(),
        )
    } else {
        None
    };

    let requested_type = if let Some(value) = params.get("type") {
        if value.is_null() {
            Some(None)
        } else {
            Some(
                value
                    .as_str()
                    .and_then(WorkItemType::from_str)
                    .ok_or_else(|| {
                        RpcResponse::error(
                            request_id.to_string(),
                            "validation_error",
                            "Valid work item type is required",
                        )
                    })
                    .map(Some)?,
            )
        }
    } else {
        None
    };

    let requested_activity_zone = if let Some(value) = params.get("activity_zone") {
        Some(
            value
                .as_str()
                .and_then(ActivityZone::from_str)
                .ok_or_else(|| {
                    RpcResponse::error(
                        request_id.to_string(),
                        "validation_error",
                        "Valid activity zone is required",
                    )
                })?,
        )
    } else {
        None
    };

    let requested_note = if let Some(value) = params.get("note") {
        if value.is_null() {
            Some(None)
        } else {
            Some(
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
                    .ok_or_else(|| {
                        RpcResponse::error(
                            request_id.to_string(),
                            "validation_error",
                            "Note must be a string or null",
                        )
                    })?,
            )
        }
    } else {
        None
    };

    let state = state.write().await;

    let mut item = state
        .db
        .get_work_item(id)
        .await
        .map_err(|e| RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string()))?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;

    if let Some(title) = requested_title {
        if title != item.title {
            if let Some(existing) = state
                .db
                .find_work_item_by_title(&title)
                .await
                .map_err(|e| {
                    RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
                })?
            {
                if existing.id != id {
                    return Err(RpcResponse::error(
                        request_id.to_string(),
                        "validation_error",
                        "A work item with this title already exists",
                    ));
                }
            }
        }

        item.title = title;
    }

    if let Some(item_type) = requested_type {
        item.item_type = item_type;
    }

    if let Some(activity_zone) = requested_activity_zone {
        item.activity_zone = activity_zone;
    }

    if let Some(note) = requested_note {
        item.note = note;
    }

    let now = Utc::now();
    item.updated_at = now;
    item.last_seen_at = Some(now);

    state.db.update_work_item(&item).await.map_err(|e| {
        RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
    })?;

    if semantics_requested {
        state
            .db
            .set_work_item_semantics(item.id, requested_track_id, &requested_label_ids)
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "validation_error", &e.to_string())
            })?;
    }

    state
        .db
        .log_event(&WorkItemEvent::new(id, WorkItemEventKind::Updated, None))
        .await
        .ok();

    let refs = state
        .db
        .get_refs_for_work_item(item.id)
        .await
        .unwrap_or_default();
    let semantics = state
        .db
        .get_work_item_semantics(item.id)
        .await
        .unwrap_or_default();
    let view = WorkItemView::from_work_item_with_stats_and_semantics(&item, refs, 0, 0, semantics);

    Ok(serde_json::to_value(view).unwrap())
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
        let session = FocusSession::new(item.title.clone(), Some(id), item.activity_zone, None);
        state.db.create_focus_session(&session).await.map_err(|e| {
            RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
        })?;
        state
            .db
            .snapshot_focus_session_semantics(session.id, Some(id))
            .await
            .map_err(|e| {
                RpcResponse::error(request_id.to_string(), "internal_error", &e.to_string())
            })?;
        record_focus_intent(&state.db, item, session.id, control)
            .await
            .map_err(|e| {
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

async fn record_focus_intent(
    db: &Database,
    item: &WorkItem,
    focus_session_id: Uuid,
    control: &str,
) -> anyhow::Result<()> {
    let mut causal = NewCausalRecord::for_work_item(item.id, CausalRecordKind::Intent);
    causal.text = Some(format!("Начат фокус: {}", item.title));
    causal.focus_session_id = Some(focus_session_id);
    causal.correlation_id = Some(focus_session_id.to_string());
    causal.payload = serde_json::json!({ "control": control });
    db.create_causal_record(causal).await?;
    Ok(())
}

async fn create_causal_from_evidence(
    db: &Database,
    work_item_id: Uuid,
    evidence_event_id: Uuid,
    text: &str,
    evidence_kind: EvidenceKind,
    focus_session_id: Option<Uuid>,
    supersedes_id: Option<Uuid>,
) -> anyhow::Result<()> {
    let record_kind = match evidence_kind {
        EvidenceKind::Result => CausalRecordKind::Result,
        EvidenceKind::Decision => CausalRecordKind::Decision,
        EvidenceKind::NextStep => CausalRecordKind::NextAction,
        EvidenceKind::Blocker => CausalRecordKind::StateAssertion,
        EvidenceKind::Observation => {
            if let Some(previous_id) = supersedes_id {
                let mut correction =
                    NewCausalRecord::for_work_item(work_item_id, CausalRecordKind::Correction);
                correction.text = Some(format!("Evidence reclassified as observation: {text}"));
                correction.focus_session_id = focus_session_id;
                correction.evidence_event_id = Some(evidence_event_id);
                correction.supersedes_id = Some(previous_id);
                correction.payload = serde_json::json!({
                    "origin": "work_item.evidence",
                    "evidence_kind": evidence_kind.as_str(),
                    "reclassified": true,
                });
                db.create_causal_record(correction).await?;
            }
            return Ok(());
        }
    };
    let mut causal = NewCausalRecord::for_work_item(work_item_id, record_kind);
    causal.text = Some(text.to_string());
    causal.focus_session_id = focus_session_id;
    causal.evidence_event_id = Some(evidence_event_id);
    causal.supersedes_id = supersedes_id;
    causal.source = CausalSource::User;
    causal.provenance = CausalProvenance::Confirmed;
    if evidence_kind == EvidenceKind::NextStep {
        causal.next_action_status = Some(NextActionStatus::Open);
        if causal.supersedes_id.is_none() {
            causal.supersedes_id = db
                .latest_active_causal_record(
                    crate::domain::OperationalSubjectKind::WorkItem,
                    work_item_id,
                    CausalRecordKind::NextAction,
                    Utc::now(),
                )
                .await?
                .map(|record| record.id);
        }
    } else if evidence_kind == EvidenceKind::Blocker {
        causal.operational_state = Some(OperationalState::Blocked);
        if causal.supersedes_id.is_none() {
            causal.supersedes_id = db
                .latest_operational_state_record(
                    crate::domain::OperationalSubjectKind::WorkItem,
                    work_item_id,
                    Utc::now(),
                )
                .await?
                .map(|record| record.id);
        }
    }
    causal.payload = serde_json::json!({
        "origin": "work_item.evidence",
        "evidence_kind": evidence_kind.as_str(),
    });
    db.create_causal_record(causal).await?;
    Ok(())
}

fn operational_state_from_work_item(state: WorkItemState) -> OperationalState {
    match state {
        WorkItemState::Active => OperationalState::Active,
        WorkItemState::Waiting => OperationalState::Waiting,
        WorkItemState::Blocked => OperationalState::Blocked,
        WorkItemState::Done => OperationalState::Completed,
        WorkItemState::Someday => OperationalState::Parked,
        WorkItemState::Unknown => OperationalState::Unknown,
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

fn get_event_id(params: &serde_json::Value, request_id: &str) -> Result<Uuid, RpcResponse> {
    let id_str = params.get("id").and_then(|v| v.as_str()).ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Work item event ID is required",
        )
    })?;

    Uuid::parse_str(id_str).map_err(|_| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Invalid Work Item event ID",
        )
    })
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

fn parse_uuid_list(
    value: Option<&serde_json::Value>,
    field: &str,
    request_id: &str,
) -> Result<Vec<Uuid>, RpcResponse> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let values = value.as_array().ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            &format!("{field} must be an array"),
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
                        &format!("{field} contains an invalid UUID"),
                    )
                })
        })
        .collect()
}

async fn resolve_new_evidence_ref(
    db: &Database,
    work_item_id: Uuid,
    value: &serde_json::Value,
    request_id: &str,
) -> Result<Uuid, RpcResponse> {
    let kind = value
        .get("kind")
        .and_then(|value| value.as_str())
        .and_then(RefKind::from_str)
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "New evidence Ref kind is required",
            )
        })?;
    let raw_value = value
        .get("value")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "New evidence Ref value is required",
            )
        })?;
    let stored_value = if kind == RefKind::Url {
        let denylist = db.get_denylist().await.unwrap_or_default();
        match check_denylist(raw_value, &denylist) {
            DenylistCheckResult::Blocked { .. } => {
                return Err(RpcResponse::error(
                    request_id.to_string(),
                    "privacy_blocked",
                    "URL is blocked by privacy settings",
                ));
            }
            DenylistCheckResult::Redact { redacted_value, .. } => redacted_value,
            DenylistCheckResult::Allowed => raw_value.to_string(),
        }
    } else {
        raw_value.to_string()
    };
    let ref_entity = Ref::new(kind, stored_value).map_err(|error| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            &error.to_string(),
        )
    })?;

    if let Some(existing_id) = db
        .find_ref_id_by_normalized(kind, &ref_entity.normalized_value)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?
    {
        if db
            .ref_is_attached_to_work_item(work_item_id, existing_id)
            .await
            .map_err(|error| {
                RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
            })?
        {
            return Ok(existing_id);
        }
        return Err(RpcResponse::error(
            request_id.to_string(),
            "conflict",
            "Ref is already attached to another Work Item",
        ));
    }

    let has_refs = db.has_refs(work_item_id).await.unwrap_or(false);
    let is_primary = value
        .get("is_primary")
        .and_then(|value| value.as_bool())
        .unwrap_or(!has_refs);
    db.add_ref(work_item_id, &ref_entity, is_primary || !has_refs)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    Ok(ref_entity.id)
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
