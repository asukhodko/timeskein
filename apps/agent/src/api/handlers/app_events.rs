//! App-event telemetry API handlers.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::api::handlers::RpcResponse;
use crate::domain::{AppEvent, AppEventKind, AppEventSource, AppEventView};
use crate::AppState;

pub async fn handle_app_event_log(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let source = match params.get("source") {
        Some(value) => value
            .as_str()
            .and_then(AppEventSource::from_str)
            .ok_or_else(|| {
                RpcResponse::error(
                    request_id.to_string(),
                    "validation_error",
                    "Valid app event source is required",
                )
            })?,
        None => AppEventSource::Ui,
    };
    let kind = params
        .get("kind")
        .and_then(|value| value.as_str())
        .and_then(AppEventKind::from_str)
        .ok_or_else(|| {
            RpcResponse::error(
                request_id.to_string(),
                "validation_error",
                "Valid app event kind is required",
            )
        })?;

    let mut event = AppEvent::new(source, kind);
    event.work_item_id = parse_optional_uuid(params.get("work_item_id"), request_id)?;
    event.focus_session_id = parse_optional_uuid(params.get("focus_session_id"), request_id)?;
    event.payload = params.get("payload").and_then(sanitize_payload);

    let state = state.read().await;
    state.db.log_app_event(&event).await.map_err(|error| {
        RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
    })?;

    Ok(serde_json::to_value(AppEventView::from(event)).unwrap())
}

pub async fn handle_app_event_list(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let from = parse_optional_datetime(params.get("from"), request_id)?;
    let to = parse_optional_datetime(params.get("to"), request_id)?;

    let state = state.read().await;
    let events = state
        .db
        .list_app_events(from, to)
        .await
        .map_err(|error| {
            RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
        })?
        .into_iter()
        .map(AppEventView::from)
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "events": events,
        "total": events.len(),
        "updated_at": Utc::now().to_rfc3339(),
    }))
}

pub async fn handle_app_event_summary(
    state: &Arc<RwLock<AppState>>,
    params: serde_json::Value,
    request_id: &str,
) -> Result<serde_json::Value, RpcResponse> {
    let from = parse_optional_datetime(params.get("from"), request_id)?;
    let to = parse_optional_datetime(params.get("to"), request_id)?;

    let state = state.read().await;
    let events = state.db.list_app_events(from, to).await.map_err(|error| {
        RpcResponse::error(request_id.to_string(), "internal_error", &error.to_string())
    })?;

    Ok(build_summary(events))
}

pub async fn log_agent_event(
    state: &Arc<RwLock<AppState>>,
    kind: AppEventKind,
    work_item_id: Option<Uuid>,
    focus_session_id: Option<Uuid>,
    payload: Option<serde_json::Value>,
) {
    let mut event = AppEvent::new(AppEventSource::Agent, kind);
    event.work_item_id = work_item_id;
    event.focus_session_id = focus_session_id;
    event.payload = payload.and_then(|value| sanitize_payload(&value));

    let state = state.read().await;
    let _ = state.db.log_app_event(&event).await;
}

fn build_summary(events: Vec<AppEvent>) -> serde_json::Value {
    let mut by_kind = BTreeMap::<String, usize>::new();
    let mut by_source = BTreeMap::<String, usize>::new();
    let mut pending_focus_starts = BTreeMap::<String, DateTime<Utc>>::new();
    let mut pending_day_closures = BTreeMap::<String, DateTime<Utc>>::new();
    let mut start_latency_ms = Vec::<i64>::new();
    let mut day_closure_durations_seconds = Vec::<i64>::new();
    let mut already_active_action_ids = BTreeSet::<String>::new();
    let mut already_active_without_action = 0usize;
    let mut window_shown_at: Option<DateTime<Utc>> = None;
    let mut slow_window_to_focus = 0;

    for event in &events {
        *by_kind.entry(event.kind.as_str().to_string()).or_default() += 1;
        *by_source
            .entry(event.source.as_str().to_string())
            .or_default() += 1;

        if event.kind == AppEventKind::FocusStartRequested
            || event.kind == AppEventKind::FocusSwitchRequested
        {
            if let Some(action_id) = event_action_id(event) {
                pending_focus_starts.insert(action_id, event.ts);
            }
        }

        if event.kind == AppEventKind::FocusStarted || event.kind == AppEventKind::FocusSwitched {
            if let Some(action_id) = event_action_id(event) {
                if let Some(requested_at) = pending_focus_starts.remove(&action_id) {
                    start_latency_ms.push((event.ts - requested_at).num_milliseconds().max(0));
                }
            }

            if let Some(shown_at) = window_shown_at.take() {
                if (event.ts - shown_at).num_seconds() >= 20 {
                    slow_window_to_focus += 1;
                }
            }
        }

        if event.kind == AppEventKind::DayClosureStarted {
            if let Some(action_id) = event_action_id(event) {
                pending_day_closures.insert(action_id, event.ts);
            }
        }

        if event.kind == AppEventKind::DayClosureCompleted {
            if let Some(action_id) = event_action_id(event) {
                if let Some(started_at) = pending_day_closures.remove(&action_id) {
                    day_closure_durations_seconds
                        .push((event.ts - started_at).num_seconds().max(0));
                }
            }
        }

        if event.kind == AppEventKind::WindowShown {
            window_shown_at = Some(event.ts);
        } else if event.kind == AppEventKind::WindowHidden {
            window_shown_at = None;
        }

        if event_already_active(event) {
            if let Some(action_id) = event_action_id(event) {
                already_active_action_ids.insert(action_id);
            } else if event.kind == AppEventKind::FocusStartRequested
                || event.kind == AppEventKind::FocusSwitchRequested
            {
                already_active_without_action += 1;
            }
        }
    }

    let average_focus_start_latency_ms = if start_latency_ms.is_empty() {
        None
    } else {
        Some(start_latency_ms.iter().sum::<i64>() / start_latency_ms.len() as i64)
    };
    let open_day_closure = pending_day_closures
        .iter()
        .max_by(|left, right| left.1.cmp(right.1));
    let open_day_closure_action_id = open_day_closure.map(|(action_id, _)| action_id.clone());
    let open_day_closure_started_at =
        open_day_closure.map(|(_, started_at)| started_at.to_rfc3339());
    let last_day_closure_duration_seconds = day_closure_durations_seconds.last().copied();

    serde_json::json!({
        "total": events.len(),
        "by_kind": by_kind,
        "by_source": by_source,
        "start_requests": count(&by_kind, "focus_start_requested"),
        "switch_requests": count(&by_kind, "focus_switch_requested"),
        "stop_requests": count(&by_kind, "focus_stop_requested"),
        "typed_entry_requests": count_entry_requests_by_controls(&events, &["typed"]),
        "selected_entry_requests": count_entry_requests_by_controls(&events, &["selected_item", "selected_shortcut", "double_click"]),
        "dispatch_ritual_entry_requests": count_entry_requests_by_controls(&events, &["dispatch_ritual", "day_contract"]),
        "start_failures": count(&by_kind, "focus_start_failed"),
        "stop_failures": count(&by_kind, "focus_stop_failed"),
        "correction_requests": count(&by_kind, "focus_correction_requested"),
        "corrections": count(&by_kind, "focus_corrected"),
        "correction_reviews": count(&by_kind, "focus_correction_reviewed"),
        "correction_failures": count(&by_kind, "focus_correction_failed"),
        "day_closure_starts": count(&by_kind, "day_closure_started"),
        "day_closure_completions": count(&by_kind, "day_closure_completed"),
        "day_contract_created": count(&by_kind, "day_contract_created"),
        "day_contract_revisions": count(&by_kind, "day_contract_revised"),
        "day_contract_start_requests": count(&by_kind, "day_contract_start_requested"),
        "day_contract_starts": count(&by_kind, "day_contract_started"),
        "day_contract_start_failures": count(&by_kind, "day_contract_start_failed"),
        "day_contract_reentries": count(&by_kind, "day_contract_reentry_reviewed"),
        "open_day_closure_started_at": open_day_closure_started_at,
        "open_day_closure_action_id": open_day_closure_action_id,
        "last_day_closure_duration_seconds": last_day_closure_duration_seconds,
        "api_errors": count(&by_kind, "api_error"),
        "copy_failures": count(&by_kind, "report_copy_failed"),
        "manual_copy_fallbacks": count(&by_kind, "manual_copy_fallback_shown"),
        "capture_create_requests": count(&by_kind, "capture_create_requested"),
        "capture_created": count(&by_kind, "capture_created"),
        "capture_create_failures": count(&by_kind, "capture_create_failed"),
        "capture_resolve_requests": count(&by_kind, "capture_resolve_requested"),
        "capture_resolved": count(&by_kind, "capture_resolved"),
        "capture_resolve_failures": count(&by_kind, "capture_resolve_failed"),
        "capture_update_requests": count(&by_kind, "capture_update_requested"),
        "capture_updated": count(&by_kind, "capture_updated"),
        "capture_update_failures": count(&by_kind, "capture_update_failed"),
        "capture_delete_requests": count(&by_kind, "capture_delete_requested"),
        "capture_deleted": count(&by_kind, "capture_deleted"),
        "capture_delete_failures": count(&by_kind, "capture_delete_failed"),
        "capture_convert_requests": count(&by_kind, "capture_convert_requested"),
        "capture_converted": count(&by_kind, "capture_converted"),
        "capture_convert_failures": count(&by_kind, "capture_convert_failed"),
        "capture_followup_reviews": count(&by_kind, "capture_followup_reviewed"),
        "day_context_reviews": count(&by_kind, "day_context_reviewed"),
        "work_item_time_badge_reviews": count(&by_kind, "work_item_time_badges_reviewed"),
        "activity_zone_glances": count(&by_kind, "activity_zone_glanced"),
        "activity_zone_reviews": count(&by_kind, "activity_zone_reviewed"),
        "capture_usage_reviews": count(&by_kind, "capture_usage_reviewed"),
        "entry_path_reviews": count(&by_kind, "entry_paths_reviewed"),
        "window_entrypoint_reviews": count(&by_kind, "window_entrypoints_reviewed"),
        "window_shown": count(&by_kind, "window_shown"),
        "window_hidden": count(&by_kind, "window_hidden"),
        "window_show_requested": count(&by_kind, "window_show_requested"),
        "window_hide_requested": count(&by_kind, "window_hide_requested"),
        "window_drag_started": count(&by_kind, "window_drag_started"),
        "stale_runtime_recoveries": count(&by_kind, "agent_stale_runtime_recovered"),
        "already_active_start_attempts": already_active_action_ids.len() + already_active_without_action,
        "average_focus_start_latency_ms": average_focus_start_latency_ms,
        "slow_window_to_focus_count": slow_window_to_focus,
        "updated_at": Utc::now().to_rfc3339(),
    })
}

fn event_already_active(event: &AppEvent) -> bool {
    event
        .payload
        .as_ref()
        .and_then(|payload| payload.get("already_active"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn count(map: &BTreeMap<String, usize>, key: &str) -> usize {
    *map.get(key).unwrap_or(&0)
}

fn event_action_id(event: &AppEvent) -> Option<String> {
    event
        .payload
        .as_ref()
        .and_then(|payload| payload.get("action_id"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn count_entry_requests_by_controls(events: &[AppEvent], controls: &[&str]) -> usize {
    events
        .iter()
        .filter(|event| {
            if event.kind != AppEventKind::FocusStartRequested
                && event.kind != AppEventKind::FocusSwitchRequested
            {
                return false;
            }

            let Some(control) = event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("control"))
                .and_then(|value| value.as_str())
            else {
                return false;
            };

            controls.contains(&control)
        })
        .count()
}

fn sanitize_payload(value: &serde_json::Value) -> Option<serde_json::Value> {
    let object = value.as_object()?;
    let mut safe = serde_json::Map::new();

    for (key, value) in object {
        if is_sensitive_payload_key(key) {
            continue;
        }

        let Some(value) = sanitize_payload_value(value) else {
            continue;
        };
        safe.insert(key.clone(), value);
    }

    Some(serde_json::Value::Object(safe))
}

fn is_sensitive_payload_key(key: &str) -> bool {
    let key = key.to_lowercase();
    ["title", "note", "url", "value", "text", "query", "search"]
        .iter()
        .any(|part| key.contains(part))
}

fn sanitize_payload_value(value: &serde_json::Value) -> Option<serde_json::Value> {
    match value {
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
            Some(value.clone())
        }
        serde_json::Value::String(value) => Some(serde_json::Value::String(
            value.chars().take(120).collect::<String>(),
        )),
        _ => None,
    }
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
