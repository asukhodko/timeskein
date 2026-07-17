//! Operational Reality API handlers.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::db::causal_record_views;
use crate::domain::{
    CausalProvenance, CausalRecordKind, CausalSource, NewCausalRecord, NextActionStatus,
    OperationalState, OperationalSubjectKind, WorkItemEvent, WorkItemEventKind, WorkItemState,
};
use crate::AppState;

pub async fn handle_operational_reality_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let as_of = parse_optional_datetime(params.get("as_of"), request_id)?.unwrap_or_else(Utc::now);
    let state = state.read().await;
    let projection = state.db.operational_reality(as_of).await.map_err(|error| {
        RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
    })?;
    Ok(serde_json::to_value(projection).unwrap())
}

pub async fn handle_causal_record_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let subject = parse_optional_subject(&params, request_id)?;
    let from = parse_optional_datetime(params.get("from"), request_id)?;
    let to = parse_optional_datetime(params.get("to"), request_id)?;
    let state = state.read().await;
    let records = state
        .db
        .list_causal_records(subject, from, to)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    let views = causal_record_views(records);
    Ok(serde_json::json!({
        "records": views,
        "total": views.len(),
        "updated_at": Utc::now().to_rfc3339(),
    }))
}

pub async fn handle_operational_reality_set_state(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let (subject_kind, subject_id) = parse_required_subject(&params, request_id)?;
    let operational_state = params
        .get("state")
        .and_then(|value| value.as_str())
        .and_then(OperationalState::from_str)
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Valid operational state is required",
            )
        })?;
    let reason = params
        .get("reason")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let confirmation_requested = params
        .get("confirmation")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let occurred_at =
        parse_optional_datetime(params.get("occurred_at"), request_id)?.unwrap_or_else(Utc::now);

    let state = state.write().await;
    ensure_subject_exists(&state, subject_kind, subject_id, request_id).await?;
    if operational_state == OperationalState::Active
        && subject_kind == OperationalSubjectKind::WorkItem
    {
        let active_id = state
            .db
            .get_active_focus_session()
            .await
            .map_err(|error| {
                RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
            })?
            .and_then(|(session, _)| session.work_item_id);
        if active_id != Some(subject_id) {
            return Err(RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Start focus instead of marking an inactive item active",
            ));
        }
    }

    let previous = state
        .db
        .latest_operational_state_record(subject_kind, subject_id, occurred_at)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    let previous_state = previous
        .as_ref()
        .and_then(|record| record.operational_state);
    let changes_known_state = previous.is_some() && previous_state != Some(operational_state);
    if changes_known_state && reason.is_none() {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Reason is required when correcting a known operational state",
        ));
    }
    let record_kind = if previous_state == Some(operational_state)
        || (confirmation_requested && !changes_known_state)
    {
        CausalRecordKind::Confirmation
    } else if previous.is_some() {
        CausalRecordKind::Correction
    } else {
        CausalRecordKind::StateAssertion
    };
    let mut draft = draft_for_subject(subject_kind, subject_id, record_kind);
    draft.operational_state = Some(operational_state);
    draft.text = reason;
    draft.occurred_at = occurred_at;
    draft.supersedes_id = previous.as_ref().map(|record| record.id);
    draft.payload = serde_json::json!({
        "previous_state": previous_state.map(|value| value.as_str()),
        "confirmation": confirmation_requested,
    });
    let record = state
        .db
        .create_causal_record(draft)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;

    if subject_kind == OperationalSubjectKind::WorkItem {
        synchronize_work_item_state(&state, subject_id, operational_state, record.id, request_id)
            .await?;
    } else if subject_kind == OperationalSubjectKind::Capture
        && operational_state == OperationalState::Completed
    {
        let mut capture = state
            .db
            .get_capture(subject_id)
            .await
            .map_err(|error| {
                RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
            })?
            .ok_or_else(|| {
                RpcResponse::error(request_id.to_string(), "not_found", "Capture not found")
            })?;
        capture.resolve();
        state.db.update_capture(&capture).await.map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    }

    let projection = state
        .db
        .operational_reality(Utc::now())
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    Ok(serde_json::json!({
        "record": crate::domain::CausalRecordView::from(record),
        "reality": projection,
    }))
}

pub async fn handle_operational_reality_set_next_action(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let (subject_kind, subject_id) = parse_required_subject(&params, request_id)?;
    let action = params
        .get("action")
        .and_then(|value| value.as_str())
        .unwrap_or("set");
    if !matches!(action, "set" | "complete" | "dismiss") {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "Next action operation must be set, complete, or dismiss",
        ));
    }
    let requested_text = params
        .get("text")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let occurred_at =
        parse_optional_datetime(params.get("occurred_at"), request_id)?.unwrap_or_else(Utc::now);

    let state = state.write().await;
    ensure_subject_exists(&state, subject_kind, subject_id, request_id).await?;
    let previous = state
        .db
        .latest_active_causal_record(
            subject_kind,
            subject_id,
            CausalRecordKind::NextAction,
            occurred_at,
        )
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;

    let (text, next_status) = match action {
        "set" => (
            requested_text.ok_or_else(|| {
                RpcResponse::error(
                    request_id.to_string(),
                    "validation_error",
                    "Next action text is required",
                )
            })?,
            NextActionStatus::Open,
        ),
        "complete" | "dismiss" => {
            let current = previous.as_ref().ok_or_else(|| {
                RpcResponse::error(
                    request_id.to_string(),
                    "not_found",
                    "Open next action not found",
                )
            })?;
            (
                current.text.clone().unwrap_or_default(),
                if action == "complete" {
                    NextActionStatus::Completed
                } else {
                    NextActionStatus::Dismissed
                },
            )
        }
        _ => unreachable!(),
    };
    let mut draft = draft_for_subject(subject_kind, subject_id, CausalRecordKind::NextAction);
    draft.text = Some(text);
    draft.next_action_status = Some(next_status);
    draft.occurred_at = occurred_at;
    draft.supersedes_id = previous.as_ref().map(|record| record.id);
    draft.payload = serde_json::json!({ "operation": action });
    let record = state
        .db
        .create_causal_record(draft)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    let projection = state
        .db
        .operational_reality(Utc::now())
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    Ok(serde_json::json!({
        "record": crate::domain::CausalRecordView::from(record),
        "reality": projection,
    }))
}

pub async fn handle_operational_reality_follow_up_decision(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let decision_id = parse_required_uuid(params.get("decision_id"), "decision_id", request_id)?;
    let status = params
        .get("status")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Follow-up status is required",
            )
        })?;
    let note = params
        .get("note")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let evidence_event_id = parse_optional_uuid(params.get("evidence_event_id"), request_id)?;
    let state = state.write().await;
    let followup_id = state
        .db
        .create_operational_decision_followup(decision_id, status, note, evidence_event_id)
        .await
        .map_err(|error| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                &error.to_string(),
            )
        })?;
    let projection = state
        .db
        .operational_reality(Utc::now())
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    Ok(serde_json::json!({ "followup_id": followup_id, "reality": projection }))
}

fn draft_for_subject(
    subject_kind: OperationalSubjectKind,
    subject_id: Uuid,
    record_kind: CausalRecordKind,
) -> NewCausalRecord {
    let mut draft = NewCausalRecord {
        subject_kind,
        subject_id,
        work_item_id: None,
        track_id: None,
        capture_id: None,
        record_kind,
        operational_state: None,
        next_action_status: None,
        text: None,
        occurred_at: Utc::now(),
        source: CausalSource::User,
        provenance: CausalProvenance::Confirmed,
        confidence: 1.0,
        correlation_id: None,
        supersedes_id: None,
        focus_session_id: None,
        evidence_event_id: None,
        reflection_decision_id: None,
        payload: serde_json::json!({}),
    };
    match subject_kind {
        OperationalSubjectKind::WorkItem => draft.work_item_id = Some(subject_id),
        OperationalSubjectKind::Track => draft.track_id = Some(subject_id),
        OperationalSubjectKind::Capture => draft.capture_id = Some(subject_id),
    }
    draft
}

async fn ensure_subject_exists(
    state: &AppState,
    subject_kind: OperationalSubjectKind,
    subject_id: Uuid,
    request_id: &str,
) -> Result<(), RpcResponse> {
    let exists = match subject_kind {
        OperationalSubjectKind::WorkItem => state
            .db
            .get_work_item(subject_id)
            .await
            .map(|value| value.is_some()),
        OperationalSubjectKind::Track => state
            .db
            .get_track(subject_id)
            .await
            .map(|value| value.is_some()),
        OperationalSubjectKind::Capture => state
            .db
            .get_capture(subject_id)
            .await
            .map(|value| value.is_some()),
    }
    .map_err(|error| {
        RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
    })?;
    if !exists {
        return Err(RpcResponse::error(
            request_id.to_string(),
            "not_found",
            "Operational Reality subject not found",
        ));
    }
    Ok(())
}

async fn synchronize_work_item_state(
    state: &AppState,
    work_item_id: Uuid,
    operational_state: OperationalState,
    causal_record_id: Uuid,
    request_id: &str,
) -> Result<(), RpcResponse> {
    let mapped = match operational_state {
        OperationalState::Active => Some(WorkItemState::Active),
        OperationalState::Waiting => Some(WorkItemState::Waiting),
        OperationalState::Blocked => Some(WorkItemState::Blocked),
        OperationalState::Parked => Some(WorkItemState::Someday),
        OperationalState::Completed => Some(WorkItemState::Done),
        OperationalState::Reactive
        | OperationalState::StaleImportant
        | OperationalState::MeetingTail
        | OperationalState::Unknown => Some(WorkItemState::Unknown),
    };
    let Some(mapped) = mapped else {
        return Ok(());
    };
    let mut item = state
        .db
        .get_work_item(work_item_id)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?
        .ok_or_else(|| {
            RpcResponse::error(request_id.to_string(), "not_found", "Work item not found")
        })?;
    if item.state == mapped {
        return Ok(());
    }
    let old_state = item.state;
    item.set_state(mapped);
    state.db.update_work_item(&item).await.map_err(|error| {
        RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
    })?;
    state
        .db
        .log_event(&WorkItemEvent::new(
            work_item_id,
            WorkItemEventKind::StateChanged,
            Some(serde_json::json!({
                "old_state": old_state.as_str(),
                "new_state": mapped.as_str(),
                "causal_record_id": causal_record_id,
            })),
        ))
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    Ok(())
}

fn parse_required_subject(
    params: &serde_json::Value,
    request_id: &str,
) -> Result<(OperationalSubjectKind, Uuid), RpcResponse> {
    parse_optional_subject(params, request_id)?.ok_or_else(|| {
        RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "subject_kind and subject_id are required",
        )
    })
}

fn parse_optional_subject(
    params: &serde_json::Value,
    request_id: &str,
) -> Result<Option<(OperationalSubjectKind, Uuid)>, RpcResponse> {
    let kind = params.get("subject_kind").and_then(|value| value.as_str());
    let id = params.get("subject_id").and_then(|value| value.as_str());
    match (kind, id) {
        (None, None) => Ok(None),
        (Some(kind), Some(id)) => {
            let kind = OperationalSubjectKind::from_str(kind).ok_or_else(|| {
                RpcResponse::error(
                    request_id.to_string(),
                    "validation_error",
                    "Invalid subject_kind",
                )
            })?;
            let id = Uuid::parse_str(id).map_err(|_| {
                RpcResponse::error(
                    request_id.to_string(),
                    "validation_error",
                    "Invalid subject_id",
                )
            })?;
            Ok(Some((kind, id)))
        }
        _ => Err(RpcResponse::error(
            request_id.to_string(),
            "validation_error",
            "subject_kind and subject_id must be provided together",
        )),
    }
}

fn parse_required_uuid(
    value: Option<&serde_json::Value>,
    field: &str,
    request_id: &str,
) -> Result<Uuid, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                &format!("Invalid {field}"),
            )
        })
}

fn parse_optional_uuid(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<Uuid>, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .map(|value| {
            Uuid::parse_str(value).map_err(|_| {
                RpcResponse::error(request_id.to_string(), "validation_error", "Invalid UUID")
            })
        })
        .transpose()
}

fn parse_optional_datetime(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<DateTime<Utc>>, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .map(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|value| value.with_timezone(&Utc))
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
