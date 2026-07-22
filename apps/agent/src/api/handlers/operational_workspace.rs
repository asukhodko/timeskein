//! Item-backed day contracts and the combined Operational Workspace projection.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{Local, NaiveDate, Utc};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{
    AppEvent, AppEventKind, AppEventSource, DayContractRevisionKind, DayContractSubjectKind,
    DayContractSubjectRef, DayContractSubjectSnapshot, NewDayContractRevision,
    OperationalRealityView, OperationalWorkspaceView, WorkItemState,
};
use crate::{db::Database, AppState};

pub async fn handle_operational_workspace_get(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let local_date = parse_local_date(params.get("local_date"), request_id)?;
    let state = state.read().await;
    let workspace = build_workspace(&state.db, &local_date)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    Ok(serde_json::to_value(workspace).unwrap())
}

pub async fn handle_day_contract_revise(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let local_date = parse_local_date(params.get("local_date"), request_id)?;
    let revision_kind = params
        .get("revision_kind")
        .and_then(|value| value.as_str())
        .and_then(DayContractRevisionKind::from_str)
        .ok_or_else(|| validation_error(request_id, "Valid revision_kind is required"))?;
    let active_refs =
        parse_subject_refs(params.get("active_subjects"), "active_subjects", request_id)?;
    let parked_refs =
        parse_subject_refs(params.get("parked_subjects"), "parked_subjects", request_id)?;
    let overflow_refs = parse_subject_refs(
        params.get("overflow_subjects"),
        "overflow_subjects",
        request_id,
    )?;
    if !(2..=3).contains(&active_refs.len()) {
        return Err(validation_error(
            request_id,
            "Day contract must contain 2 or 3 active subjects",
        ));
    }
    if parked_refs.len() > 3 {
        return Err(validation_error(
            request_id,
            "Day contract may contain at most 3 parked competitors",
        ));
    }
    if overflow_refs.len() > 20 {
        return Err(validation_error(
            request_id,
            "Day contract may contain at most 20 overflow subjects",
        ));
    }
    ensure_distinct_subjects(&active_refs, &parked_refs, &overflow_refs, request_id)?;
    let first_action_work_item_id = parse_required_uuid(
        params.get("first_action_work_item_id"),
        "first_action_work_item_id",
        request_id,
    )?;
    let why_now = params
        .get("why_now")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| validation_error(request_id, "why_now is required"))?
        .chars()
        .take(2000)
        .collect::<String>();

    let state = state.write().await;
    let previous = state
        .db
        .list_day_contract_revisions(&local_date)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    if previous.is_empty() && revision_kind != DayContractRevisionKind::Morning {
        return Err(validation_error(
            request_id,
            "The first contract revision must be morning",
        ));
    }
    if !previous.is_empty() && revision_kind == DayContractRevisionKind::Morning {
        return Err(validation_error(
            request_id,
            "Morning contract already exists; use reentry or adjustment",
        ));
    }

    let first_action = state
        .db
        .get_work_item(first_action_work_item_id)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "not_found",
                "First action Work Item not found",
            )
        })?;
    let first_semantics = state
        .db
        .get_work_item_semantics(first_action_work_item_id)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let first_is_in_active_scope = active_refs.iter().any(|subject| match subject.kind {
        DayContractSubjectKind::WorkItem => subject.subject_id == first_action_work_item_id,
        DayContractSubjectKind::Track => first_semantics
            .track
            .as_ref()
            .is_some_and(|track| track.path.iter().any(|node| node.id == subject.subject_id)),
    });
    if !first_is_in_active_scope {
        return Err(validation_error(
            request_id,
            "First action must belong to one of the active Work Items or Tracks",
        ));
    }

    let captured_at = Utc::now();
    let reality = state
        .db
        .operational_reality(captured_at)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let mut active_subjects = Vec::with_capacity(active_refs.len());
    for subject in &active_refs {
        active_subjects
            .push(snapshot_subject(&state.db, &reality, subject, captured_at, request_id).await?);
    }
    let mut parked_subjects = Vec::with_capacity(parked_refs.len());
    for subject in &parked_refs {
        parked_subjects
            .push(snapshot_subject(&state.db, &reality, subject, captured_at, request_id).await?);
    }
    let mut overflow_subjects = Vec::with_capacity(overflow_refs.len());
    for subject in &overflow_refs {
        overflow_subjects
            .push(snapshot_subject(&state.db, &reality, subject, captured_at, request_id).await?);
    }
    let first_outcome = active_refs
        .iter()
        .find(|subject| match subject.kind {
            DayContractSubjectKind::WorkItem => subject.subject_id == first_action_work_item_id,
            DayContractSubjectKind::Track => first_semantics
                .track
                .as_ref()
                .is_some_and(|track| track.path.iter().any(|node| node.id == subject.subject_id)),
        })
        .and_then(|subject| subject.daily_outcome.clone());
    let first_action_snapshot = snapshot_subject(
        &state.db,
        &reality,
        &DayContractSubjectRef {
            kind: DayContractSubjectKind::WorkItem,
            subject_id: first_action.id,
            daily_outcome: first_outcome,
        },
        captured_at,
        request_id,
    )
    .await?;

    let revision = state
        .db
        .append_day_contract_revision(NewDayContractRevision {
            local_date: local_date.clone(),
            revision_kind,
            active_subjects,
            first_action_work_item_id,
            first_action: first_action_snapshot,
            parked_subjects,
            overflow_subjects,
            why_now,
        })
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let mut event = AppEvent::new(
        AppEventSource::Agent,
        if revision.revision_number == 1 {
            AppEventKind::DayContractCreated
        } else {
            AppEventKind::DayContractRevised
        },
    );
    event.work_item_id = Some(first_action_work_item_id);
    event.payload = Some(serde_json::json!({
        "revision_number": revision.revision_number,
        "revision_kind": revision.revision_kind.as_str(),
        "active_count": revision.active_subjects.len(),
        "parked_count": revision.parked_subjects.len(),
        "overflow_count": revision.overflow_subjects.len(),
    }));
    let _ = state.db.log_app_event(&event).await;

    let workspace = build_workspace(&state.db, &local_date)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?;
    Ok(serde_json::json!({
        "revision": revision,
        "workspace": workspace,
    }))
}

pub async fn handle_day_contract_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let from = parse_required_date(params.get("from"), "from", request_id)?;
    let to = parse_required_date(params.get("to"), "to", request_id)?;
    if from >= to {
        return Err(validation_error(request_id, "to must be later than from"));
    }
    let state = state.read().await;
    let revisions = state
        .db
        .list_day_contract_revisions_range(&from, &to)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::json!({
        "revisions": revisions,
        "total": revisions.len(),
        "updated_at": Utc::now().to_rfc3339(),
    }))
}

async fn build_workspace(
    database: &Database,
    local_date: &str,
) -> anyhow::Result<OperationalWorkspaceView> {
    let revisions = database.list_day_contract_revisions(local_date).await?;
    let current_contract = revisions.last().cloned();
    let reality = database.operational_reality(Utc::now()).await?;
    Ok(OperationalWorkspaceView {
        local_date: local_date.to_string(),
        current_contract,
        revisions,
        reality,
        updated_at: Utc::now().to_rfc3339(),
    })
}

async fn snapshot_subject(
    database: &Database,
    reality: &OperationalRealityView,
    subject: &DayContractSubjectRef,
    captured_at: chrono::DateTime<Utc>,
    request_id: &str,
) -> Result<DayContractSubjectSnapshot, RpcResponse> {
    if let Some(item) = reality.items.iter().find(|item| {
        item.subject_kind == subject.kind.as_str() && item.subject_id == subject.subject_id
    }) {
        return Ok(DayContractSubjectSnapshot {
            kind: subject.kind,
            subject_id: subject.subject_id,
            title: item.title.clone(),
            work_item_id: item.work_item_id,
            track_id: item.track_id,
            state: item.state.clone(),
            state_provenance: item.state_provenance.clone(),
            state_record_id: item.state_record_id,
            next_action: item.next_action.clone(),
            last_significant_change: item.last_significant_change.clone(),
            track_path: item.track_path.clone(),
            labels: item.labels.clone(),
            daily_outcome: subject.daily_outcome.clone(),
            captured_at: captured_at.to_rfc3339(),
        });
    }

    match subject.kind {
        DayContractSubjectKind::WorkItem => {
            let item = database
                .get_work_item(subject.subject_id)
                .await
                .map_err(|error| internal_error(request_id, error))?
                .ok_or_else(|| {
                    RpcResponse::error(request_id.to_string(), "not_found", "Work Item not found")
                })?;
            let semantics = database
                .get_work_item_semantics(item.id)
                .await
                .map_err(|error| internal_error(request_id, error))?;
            Ok(DayContractSubjectSnapshot {
                kind: subject.kind,
                subject_id: item.id,
                title: item.title,
                work_item_id: Some(item.id),
                track_id: semantics.track.as_ref().map(|track| track.id),
                state: work_item_state_to_operational(item.state).to_string(),
                state_provenance: "legacy_current".to_string(),
                state_record_id: None,
                next_action: None,
                last_significant_change: None,
                track_path: semantics
                    .track
                    .as_ref()
                    .map(|track| track.path.clone())
                    .unwrap_or_default(),
                labels: semantics.labels,
                daily_outcome: subject.daily_outcome.clone(),
                captured_at: captured_at.to_rfc3339(),
            })
        }
        DayContractSubjectKind::Track => {
            let track = database
                .get_track(subject.subject_id)
                .await
                .map_err(|error| internal_error(request_id, error))?
                .ok_or_else(|| {
                    RpcResponse::error(request_id.to_string(), "not_found", "Track not found")
                })?;
            let path = database
                .track_path(track.id)
                .await
                .map_err(|error| internal_error(request_id, error))?;
            Ok(DayContractSubjectSnapshot {
                kind: subject.kind,
                subject_id: track.id,
                title: track.title,
                work_item_id: None,
                track_id: Some(track.id),
                state: "unknown".to_string(),
                state_provenance: "derived".to_string(),
                state_record_id: None,
                next_action: None,
                last_significant_change: None,
                track_path: path,
                labels: vec![],
                daily_outcome: subject.daily_outcome.clone(),
                captured_at: captured_at.to_rfc3339(),
            })
        }
    }
}

fn parse_subject_refs(
    value: Option<&serde_json::Value>,
    field: &str,
    request_id: &str,
) -> Result<Vec<DayContractSubjectRef>, RpcResponse> {
    let Some(value) = value else {
        return Ok(vec![]);
    };
    let values = value
        .as_array()
        .ok_or_else(|| validation_error(request_id, &format!("{field} must be an array")))?;
    values
        .iter()
        .map(|value| {
            let kind = value
                .get("kind")
                .and_then(|value| value.as_str())
                .and_then(DayContractSubjectKind::from_str)
                .ok_or_else(|| {
                    validation_error(request_id, "Subject kind must be work_item or track")
                })?;
            let subject_id =
                parse_required_uuid(value.get("subject_id"), "subject_id", request_id)?;
            let daily_outcome = value
                .get("daily_outcome")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.chars().take(1000).collect::<String>());
            Ok(DayContractSubjectRef {
                kind,
                subject_id,
                daily_outcome,
            })
        })
        .collect()
}

fn ensure_distinct_subjects(
    active: &[DayContractSubjectRef],
    parked: &[DayContractSubjectRef],
    overflow: &[DayContractSubjectRef],
    request_id: &str,
) -> Result<(), RpcResponse> {
    let mut seen = HashSet::new();
    for subject in active.iter().chain(parked).chain(overflow) {
        if !seen.insert((subject.kind, subject.subject_id)) {
            return Err(validation_error(
                request_id,
                "The same subject cannot appear more than once or be both active and parked",
            ));
        }
    }
    Ok(())
}

fn parse_local_date(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<String, RpcResponse> {
    match value.and_then(|value| value.as_str()) {
        Some(value) if !value.trim().is_empty() => parse_date(value, "local_date", request_id),
        _ => Ok(Local::now().date_naive().format("%Y-%m-%d").to_string()),
    }
}

fn parse_required_date(
    value: Option<&serde_json::Value>,
    field: &str,
    request_id: &str,
) -> Result<String, RpcResponse> {
    let value = value
        .and_then(|value| value.as_str())
        .ok_or_else(|| validation_error(request_id, &format!("{field} is required")))?;
    parse_date(value, field, request_id)
}

fn parse_date(value: &str, field: &str, request_id: &str) -> Result<String, RpcResponse> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|date| date.format("%Y-%m-%d").to_string())
        .map_err(|_| validation_error(request_id, &format!("{field} must be YYYY-MM-DD")))
}

fn parse_required_uuid(
    value: Option<&serde_json::Value>,
    field: &str,
    request_id: &str,
) -> Result<Uuid, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| validation_error(request_id, &format!("Valid {field} is required")))
}

fn work_item_state_to_operational(state: WorkItemState) -> &'static str {
    match state {
        WorkItemState::Active => "active",
        WorkItemState::Waiting => "waiting",
        WorkItemState::Blocked => "blocked",
        WorkItemState::Done => "completed",
        WorkItemState::Someday => "parked",
        WorkItemState::Unknown => "unknown",
    }
}

fn validation_error(request_id: &str, message: &str) -> RpcResponse {
    RpcResponse::error(request_id.to_string(), "validation_error", message)
}

fn internal_error(request_id: &str, error: impl std::fmt::Display) -> RpcResponse {
    RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
}
