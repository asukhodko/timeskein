//! Working Memory Bridge v1 API handlers.

use std::sync::Arc;

use chrono::{DateTime, Local, Utc};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{
    ContextPackProfile, ContextPackView, NewWorkMemoryEntry, WorkItemEvent, WorkItemEventKind,
    WorkMemoryEntryKind, WorkMemoryMaterialKind, WorkMemorySubjectKind,
};
use crate::AppState;

pub async fn handle_work_memory_create(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let entry_kind = parse_entry_kind(params.get("kind"), request_id)?;
    let text = optional_trimmed(params.get("text"));
    let material_kind = parse_optional_material_kind(params.get("material_kind"), request_id)?;
    let material_value = optional_trimmed(params.get("material_value"));
    validate_entry_content(
        entry_kind,
        text.as_deref(),
        material_kind,
        material_value.as_deref(),
        request_id,
    )?;
    let occurred_at =
        parse_optional_datetime(params.get("occurred_at"), request_id)?.unwrap_or_else(Utc::now);
    let local_date = params
        .get("local_date")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Local::now().date_naive().format("%Y-%m-%d").to_string());
    let requested_subject_kind = params
        .get("subject_kind")
        .and_then(|value| value.as_str())
        .unwrap_or("work_item");
    let subject_kind = WorkMemorySubjectKind::from_str(requested_subject_kind)
        .ok_or_else(|| validation_error(request_id, "subject_kind must be work_item or track"))?;
    let requested_subject_id = required_uuid(
        params
            .get("subject_id")
            .or_else(|| params.get("work_item_id"))
            .or_else(|| params.get("track_id")),
        "subject_id",
        request_id,
    )?;
    let requested_focus_session_id = optional_uuid(params.get("focus_session_id"), request_id)?;
    let requested_stage_id = optional_uuid(params.get("stage_id"), request_id)?;
    let origin_kind = params
        .get("origin_kind")
        .and_then(|value| value.as_str())
        .filter(|value| {
            matches!(
                *value,
                "manual" | "focus_stop" | "day_contract" | "capture" | "import"
            )
        })
        .unwrap_or("manual")
        .to_string();
    let origin_ref = optional_trimmed(params.get("origin_ref"));

    let state = state.write().await;
    let recorded_at = Utc::now();
    let (
        subject_id,
        work_item_id,
        track_id,
        work_item_title_snapshot,
        track_snapshot,
        labels_snapshot,
    ) = match subject_kind {
        WorkMemorySubjectKind::WorkItem => {
            let canonical_id = state
                .db
                .resolve_canonical_work_item_id(requested_subject_id)
                .await
                .map_err(|error| internal_error(request_id, error))?;
            let item = state
                .db
                .get_work_item(canonical_id)
                .await
                .map_err(|error| internal_error(request_id, error))?
                .ok_or_else(|| not_found(request_id, "Work Item not found"))?;
            let semantics = state
                .db
                .get_work_item_semantics(canonical_id)
                .await
                .map_err(|error| internal_error(request_id, error))?;
            let track_id = semantics.track.as_ref().map(|track| track.id);
            let track_snapshot = semantics
                .track
                .as_ref()
                .map(|track| track.path.clone())
                .unwrap_or_default();
            (
                canonical_id,
                Some(canonical_id),
                track_id,
                Some(item.title),
                track_snapshot,
                semantics.labels,
            )
        }
        WorkMemorySubjectKind::Track => {
            let track = state
                .db
                .get_track(requested_subject_id)
                .await
                .map_err(|error| internal_error(request_id, error))?
                .ok_or_else(|| not_found(request_id, "Track not found"))?;
            let track_snapshot = state
                .db
                .track_path(track.id)
                .await
                .map_err(|error| internal_error(request_id, error))?;
            (track.id, None, Some(track.id), None, track_snapshot, vec![])
        }
    };

    let focus_session_id = match (requested_focus_session_id, work_item_id) {
        (Some(focus_id), Some(item_id)) => {
            let (session, _) = state
                .db
                .get_focus_session(focus_id)
                .await
                .map_err(|error| internal_error(request_id, error))?
                .ok_or_else(|| not_found(request_id, "Focus session not found"))?;
            if session.work_item_id != Some(item_id) {
                return Err(validation_error(
                    request_id,
                    "Focus session belongs to another Work Item",
                ));
            }
            Some(focus_id)
        }
        (Some(_), None) => {
            return Err(validation_error(
                request_id,
                "Track memory cannot be linked directly to a focus session",
            ));
        }
        (None, Some(item_id)) => state
            .db
            .get_active_focus_session()
            .await
            .map_err(|error| internal_error(request_id, error))?
            .and_then(|(session, _)| (session.work_item_id == Some(item_id)).then_some(session.id)),
        (None, None) => None,
    };

    let stage_id = match (requested_stage_id, work_item_id) {
        (Some(stage_id), Some(item_id)) => {
            let stage = state
                .db
                .get_work_item_stage(stage_id)
                .await
                .map_err(|error| internal_error(request_id, error))?
                .ok_or_else(|| not_found(request_id, "Work Item stage not found"))?;
            if stage.work_item_id != item_id || stage.deleted_at.is_some() {
                return Err(validation_error(
                    request_id,
                    "Stage belongs to another Work Item or is archived",
                ));
            }
            Some(stage_id)
        }
        (Some(_), None) => {
            return Err(validation_error(
                request_id,
                "Track memory cannot be linked directly to a Work Item stage",
            ));
        }
        (None, Some(item_id)) => state
            .db
            .active_work_item_stage(item_id)
            .await
            .map_err(|error| internal_error(request_id, error))?
            .map(|stage| stage.id),
        (None, None) => None,
    };
    let day_contract_revision_id = state
        .db
        .list_day_contract_revisions(&local_date)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .last()
        .map(|revision| revision.id);

    let entry_id = Uuid::new_v4();
    let compatibility_event = work_item_id.map(|item_id| {
        let mut payload = serde_json::json!({
            "text": text.clone().or_else(|| material_value.clone()).unwrap_or_default(),
            "memory_entry_kind": entry_kind.as_str(),
            "material_kind": material_kind.map(|kind| kind.as_str()),
            "material_value": material_value.clone(),
        });
        if let Some(focus_id) = focus_session_id {
            payload["focus_session_id"] = serde_json::Value::String(focus_id.to_string());
        }
        let mut event = WorkItemEvent::new(item_id, WorkItemEventKind::NoteAdded, Some(payload));
        event.id = entry_id;
        event.ts = occurred_at;
        event
    });
    if let Some(event) = compatibility_event.as_ref() {
        state
            .db
            .log_event(event)
            .await
            .map_err(|error| internal_error(request_id, error))?;
    }

    let created = state
        .db
        .create_work_memory_entry(NewWorkMemoryEntry {
            id: entry_id,
            subject_kind,
            subject_id,
            work_item_id,
            track_id,
            work_item_title_snapshot,
            focus_session_id,
            stage_id,
            day_contract_revision_id,
            local_date: Some(local_date),
            occurred_at,
            recorded_at,
            source: "user".to_string(),
            provenance: "confirmed".to_string(),
            origin_kind,
            origin_ref,
            track_snapshot,
            labels_snapshot,
            entry_kind,
            text,
            material_kind,
            material_value,
        })
        .await
        .map_err(|error| internal_error(request_id, error))?;

    Ok(serde_json::to_value(created).expect("working-memory entry serializes"))
}

pub async fn handle_work_memory_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let subject_id = optional_uuid(params.get("subject_id"), request_id)?;
    let subject = match subject_id {
        Some(id) => {
            let kind = params
                .get("subject_kind")
                .and_then(|value| value.as_str())
                .and_then(WorkMemorySubjectKind::from_str)
                .ok_or_else(|| validation_error(request_id, "subject_kind is required"))?;
            Some((kind, id))
        }
        None => None,
    };
    let from = parse_optional_datetime(params.get("from"), request_id)?;
    let to = parse_optional_datetime(params.get("to"), request_id)?;
    let include_deleted = params
        .get("include_deleted")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let state = state.read().await;
    let entries = state
        .db
        .list_work_memory_entries(subject, from, to, include_deleted)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::json!({ "entries": entries, "total": entries.len() }))
}

pub async fn handle_work_memory_update(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = required_uuid(params.get("id"), "id", request_id)?;
    let entry_kind = parse_entry_kind(params.get("kind"), request_id)?;
    let text = optional_trimmed(params.get("text"));
    let material_kind = parse_optional_material_kind(params.get("material_kind"), request_id)?;
    let material_value = optional_trimmed(params.get("material_value"));
    validate_entry_content(
        entry_kind,
        text.as_deref(),
        material_kind,
        material_value.as_deref(),
        request_id,
    )?;
    let change_note = optional_trimmed(params.get("change_note"));
    let state = state.write().await;
    let entry = state
        .db
        .revise_work_memory_entry(
            id,
            entry_kind,
            text,
            material_kind,
            material_value,
            change_note,
        )
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(entry).expect("working-memory entry serializes"))
}

pub async fn handle_work_memory_delete(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = required_uuid(params.get("id"), "id", request_id)?;
    let reason = optional_trimmed(params.get("reason"));
    let state = state.write().await;
    let entry = state
        .db
        .tombstone_work_memory_entry(id, reason)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(entry).expect("working-memory entry serializes"))
}

pub async fn handle_work_item_stage_create(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let work_item_id = required_uuid(params.get("work_item_id"), "work_item_id", request_id)?;
    let title = required_text(params.get("title"), "title", request_id)?;
    let activate = params
        .get("activate")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let state = state.write().await;
    state
        .db
        .get_work_item(work_item_id)
        .await
        .map_err(|error| internal_error(request_id, error))?
        .ok_or_else(|| not_found(request_id, "Work Item not found"))?;
    let stage = state
        .db
        .create_work_item_stage(work_item_id, title, activate)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(stage).expect("stage serializes"))
}

pub async fn handle_work_item_stage_update(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = required_uuid(params.get("id"), "id", request_id)?;
    let title = optional_trimmed(params.get("title"));
    let stage_state = optional_trimmed(params.get("state"));
    let position = params.get("position").and_then(|value| value.as_i64());
    let state = state.write().await;
    let stage = state
        .db
        .update_work_item_stage(id, title, stage_state, position)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(stage).expect("stage serializes"))
}

pub async fn handle_work_item_stage_delete(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = required_uuid(params.get("id"), "id", request_id)?;
    let state = state.write().await;
    let stage = state
        .db
        .delete_work_item_stage(id)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(stage).expect("stage serializes"))
}

pub async fn handle_work_item_stage_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let work_item_id = required_uuid(params.get("work_item_id"), "work_item_id", request_id)?;
    let include_archived = params
        .get("include_archived")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let state = state.read().await;
    let stages = state
        .db
        .list_work_item_stages(work_item_id, include_archived)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::json!({ "stages": stages }))
}

pub async fn handle_work_item_merge(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let source_id = required_uuid(params.get("source_id"), "source_id", request_id)?;
    let canonical_id = required_uuid(params.get("canonical_id"), "canonical_id", request_id)?;
    let reason = optional_trimmed(params.get("reason"));
    let state = state.write().await;
    let alias = state
        .db
        .merge_work_items(source_id, canonical_id, reason)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::to_value(alias).expect("alias serializes"))
}

pub async fn handle_work_item_resolve(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let id = required_uuid(params.get("id"), "id", request_id)?;
    let state = state.read().await;
    let canonical_id = state
        .db
        .resolve_canonical_work_item_id(id)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let aliases = state
        .db
        .list_work_item_aliases(canonical_id)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    Ok(serde_json::json!({ "requested_id": id, "canonical_id": canonical_id, "aliases": aliases }))
}

pub async fn handle_context_pack_build(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let profile = params
        .get("profile")
        .and_then(|value| value.as_str())
        .and_then(ContextPackProfile::from_str)
        .ok_or_else(|| {
            validation_error(
                request_id,
                "profile must be work-item-reentry or track-reentry",
            )
        })?;
    let scope_id = required_uuid(params.get("scope_id"), "scope_id", request_id)?;
    let as_of = parse_optional_datetime(params.get("as_of"), request_id)?.unwrap_or_else(Utc::now);
    let format = params
        .get("format")
        .and_then(|value| value.as_str())
        .unwrap_or("both");
    if !matches!(format, "json" | "markdown" | "both") {
        return Err(validation_error(
            request_id,
            "format must be json, markdown, or both",
        ));
    }
    let state = state.read().await;
    let pack = state
        .db
        .build_context_pack(profile, scope_id, as_of)
        .await
        .map_err(|error| internal_error(request_id, error))?;
    let markdown = render_context_pack_markdown(&pack);
    Ok(match format {
        "json" => serde_json::json!({ "pack": pack }),
        "markdown" => serde_json::json!({ "markdown": markdown }),
        _ => serde_json::json!({ "pack": pack, "markdown": markdown }),
    })
}

fn render_context_pack_markdown(pack: &ContextPackView) -> String {
    let mut lines = vec![
        format!("# Context Pack: {}", pack.scope.title),
        String::new(),
        format!("- Profile: `{}`", pack.profile),
        format!("- Scope: `{}` / `{}`", pack.scope.kind, pack.scope.id),
        format!("- As of: `{}`", pack.as_of),
        format!("- Projection: {}", pack.provenance.projection),
        String::new(),
        "## Current re-entry point".to_string(),
    ];
    if let Some(change) = &pack.facts.latest_confirmed_change {
        lines.push(format!(
            "- Latest confirmed change: {}",
            one_line(
                change
                    .current_revision
                    .text
                    .as_deref()
                    .or(change.current_revision.material_value.as_deref())
                    .unwrap_or("(empty)")
            )
        ));
    }
    if let Some(stage) = &pack.facts.current_stage {
        lines.push(format!(
            "- Current stage: {} (`{}`)",
            one_line(&stage.title),
            stage.state
        ));
    }
    if pack.facts.next_actions.is_empty() {
        lines.push("- Next action: not recorded".to_string());
    } else {
        for entry in pack.facts.next_actions.iter().rev().take(3) {
            lines.push(format!(
                "- Next action: {}",
                one_line(entry.current_revision.text.as_deref().unwrap_or("(empty)"))
            ));
        }
    }

    lines.extend([
        String::new(),
        "## Focus by stage".to_string(),
        String::new(),
        "| Stage | State | Time | Entrances |".to_string(),
        "| --- | --- | ---: | ---: |".to_string(),
    ]);
    for stage in &pack.facts.focus.by_stage {
        lines.push(format!(
            "| {} | {} | {} | {} |",
            markdown_cell(&stage.title),
            markdown_cell(&stage.state),
            format_duration(stage.active_seconds),
            stage.entrances
        ));
    }

    lines.extend([
        String::new(),
        "## Working memory".to_string(),
        String::new(),
    ]);
    if pack.facts.memory.is_empty() {
        lines.push("No entries.".to_string());
    } else {
        for entry in &pack.facts.memory {
            let content = entry
                .current_revision
                .text
                .as_deref()
                .or(entry.current_revision.material_value.as_deref())
                .unwrap_or("(empty)");
            lines.push(format!(
                "- `{}` `{}` {}",
                entry.occurred_at,
                entry.current_revision.entry_kind,
                one_line(content)
            ));
        }
    }

    if !pack.unknowns.is_empty() {
        lines.extend([String::new(), "## Unknowns".to_string(), String::new()]);
        lines.extend(
            pack.unknowns
                .iter()
                .map(|value| format!("- {}", one_line(value))),
        );
    }
    if !pack.warnings.is_empty() {
        lines.extend([String::new(), "## Warnings".to_string(), String::new()]);
        lines.extend(
            pack.warnings
                .iter()
                .map(|value| format!("- {}", one_line(value))),
        );
    }
    lines.extend([
        String::new(),
        "## Provenance".to_string(),
        String::new(),
        format!("- Source: {}", pack.provenance.source),
        format!(
            "- Canonical tables: {}",
            pack.provenance.canonical_tables.join(", ")
        ),
        format!(
            "- External text policy: {}",
            pack.provenance.external_text_policy
        ),
        String::new(),
        "## Canonical JSON".to_string(),
        String::new(),
        "The fenced payload below is the exact canonical projection used by the UI and JSON export.".to_string(),
        String::new(),
        "```json".to_string(),
        serde_json::to_string_pretty(pack).expect("Context Pack must serialize"),
        "```".to_string(),
        String::new(),
    ]);
    lines.join("\n")
}

fn one_line(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn markdown_cell(value: &str) -> String {
    one_line(value).replace('|', "\\|")
}

fn format_duration(seconds: i64) -> String {
    let seconds = seconds.max(0);
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let seconds = seconds % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

fn parse_entry_kind(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<WorkMemoryEntryKind, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .and_then(WorkMemoryEntryKind::from_str)
        .ok_or_else(|| validation_error(request_id, "Valid working-memory kind is required"))
}

fn validate_entry_content(
    kind: WorkMemoryEntryKind,
    text: Option<&str>,
    material_kind: Option<WorkMemoryMaterialKind>,
    material_value: Option<&str>,
    request_id: &str,
) -> Result<(), RpcResponse> {
    if kind == WorkMemoryEntryKind::Material {
        if material_kind.is_none() || material_value.is_none() {
            return Err(validation_error(
                request_id,
                "Material entries require material_kind and material_value",
            ));
        }
    } else if text.is_none() {
        return Err(validation_error(
            request_id,
            "Text is required for non-material working-memory entries",
        ));
    }
    Ok(())
}

fn parse_optional_material_kind(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<WorkMemoryMaterialKind>, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            WorkMemoryMaterialKind::from_str(value)
                .ok_or_else(|| validation_error(request_id, "Invalid material_kind"))
        })
        .transpose()
}

fn required_uuid(
    value: Option<&serde_json::Value>,
    field: &str,
    request_id: &str,
) -> Result<Uuid, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| validation_error(request_id, &format!("Valid {field} is required")))
}

fn optional_uuid(
    value: Option<&serde_json::Value>,
    request_id: &str,
) -> Result<Option<Uuid>, RpcResponse> {
    value
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            Uuid::parse_str(value).map_err(|_| validation_error(request_id, "Invalid UUID"))
        })
        .transpose()
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
                .map(|value| value.with_timezone(&Utc))
                .map_err(|_| validation_error(request_id, "Invalid RFC3339 timestamp"))
        })
        .transpose()
}

fn required_text(
    value: Option<&serde_json::Value>,
    field: &str,
    request_id: &str,
) -> Result<String, RpcResponse> {
    optional_trimmed(value)
        .ok_or_else(|| validation_error(request_id, &format!("{field} is required")))
}

fn optional_trimmed(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn validation_error(request_id: &str, message: &str) -> RpcResponse {
    RpcResponse::error(request_id.to_string(), "validation_error", message)
}

fn not_found(request_id: &str, message: &str) -> RpcResponse {
    RpcResponse::error(request_id.to_string(), "not_found", message)
}

fn internal_error(request_id: &str, error: impl std::fmt::Display) -> RpcResponse {
    RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
}
