//! Local app-event telemetry for dogfooding.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppEventSource {
    Ui,
    Agent,
    Script,
    System,
}

impl AppEventSource {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "ui" => Some(Self::Ui),
            "agent" => Some(Self::Agent),
            "script" => Some(Self::Script),
            "system" => Some(Self::System),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ui => "ui",
            Self::Agent => "agent",
            Self::Script => "script",
            Self::System => "system",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppEventKind {
    AppStarted,
    AgentStarted,
    AgentReused,
    AgentStaleRuntimeRecovered,
    WindowShown,
    WindowHidden,
    WindowShowRequested,
    WindowHideRequested,
    WindowDragStarted,
    FocusStartRequested,
    FocusStarted,
    FocusStartFailed,
    FocusSwitchRequested,
    FocusSwitched,
    FocusStopRequested,
    FocusStopped,
    FocusStopFailed,
    FocusCorrectionRequested,
    FocusCorrected,
    FocusCorrectionReviewed,
    FocusCorrectionFailed,
    DayClosureStarted,
    DayClosureCompleted,
    ReportCopyRequested,
    ReportCopied,
    ReportCopyFailed,
    ManualCopyFallbackShown,
    CaptureCreateRequested,
    CaptureCreated,
    CaptureCreateFailed,
    CaptureResolveRequested,
    CaptureResolved,
    CaptureResolveFailed,
    CaptureUpdateRequested,
    CaptureUpdated,
    CaptureUpdateFailed,
    CaptureDeleteRequested,
    CaptureDeleted,
    CaptureDeleteFailed,
    CaptureConvertRequested,
    CaptureConverted,
    CaptureConvertFailed,
    CaptureFollowupReviewed,
    WorkItemTimeBadgesReviewed,
    ActivityZoneReviewed,
    CaptureUsageReviewed,
    EntryPathsReviewed,
    WindowEntrypointsReviewed,
    ApiError,
}

impl AppEventKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "app_started" => Some(Self::AppStarted),
            "agent_started" => Some(Self::AgentStarted),
            "agent_reused" => Some(Self::AgentReused),
            "agent_stale_runtime_recovered" => Some(Self::AgentStaleRuntimeRecovered),
            "window_shown" => Some(Self::WindowShown),
            "window_hidden" => Some(Self::WindowHidden),
            "window_show_requested" => Some(Self::WindowShowRequested),
            "window_hide_requested" => Some(Self::WindowHideRequested),
            "window_drag_started" => Some(Self::WindowDragStarted),
            "focus_start_requested" => Some(Self::FocusStartRequested),
            "focus_started" => Some(Self::FocusStarted),
            "focus_start_failed" => Some(Self::FocusStartFailed),
            "focus_switch_requested" => Some(Self::FocusSwitchRequested),
            "focus_switched" => Some(Self::FocusSwitched),
            "focus_stop_requested" => Some(Self::FocusStopRequested),
            "focus_stopped" => Some(Self::FocusStopped),
            "focus_stop_failed" => Some(Self::FocusStopFailed),
            "focus_correction_requested" => Some(Self::FocusCorrectionRequested),
            "focus_corrected" => Some(Self::FocusCorrected),
            "focus_correction_reviewed" => Some(Self::FocusCorrectionReviewed),
            "focus_correction_failed" => Some(Self::FocusCorrectionFailed),
            "day_closure_started" => Some(Self::DayClosureStarted),
            "day_closure_completed" => Some(Self::DayClosureCompleted),
            "report_copy_requested" => Some(Self::ReportCopyRequested),
            "report_copied" => Some(Self::ReportCopied),
            "report_copy_failed" => Some(Self::ReportCopyFailed),
            "manual_copy_fallback_shown" => Some(Self::ManualCopyFallbackShown),
            "capture_create_requested" => Some(Self::CaptureCreateRequested),
            "capture_created" => Some(Self::CaptureCreated),
            "capture_create_failed" => Some(Self::CaptureCreateFailed),
            "capture_resolve_requested" => Some(Self::CaptureResolveRequested),
            "capture_resolved" => Some(Self::CaptureResolved),
            "capture_resolve_failed" => Some(Self::CaptureResolveFailed),
            "capture_update_requested" => Some(Self::CaptureUpdateRequested),
            "capture_updated" => Some(Self::CaptureUpdated),
            "capture_update_failed" => Some(Self::CaptureUpdateFailed),
            "capture_delete_requested" => Some(Self::CaptureDeleteRequested),
            "capture_deleted" => Some(Self::CaptureDeleted),
            "capture_delete_failed" => Some(Self::CaptureDeleteFailed),
            "capture_convert_requested" => Some(Self::CaptureConvertRequested),
            "capture_converted" => Some(Self::CaptureConverted),
            "capture_convert_failed" => Some(Self::CaptureConvertFailed),
            "capture_followup_reviewed" => Some(Self::CaptureFollowupReviewed),
            "work_item_time_badges_reviewed" => Some(Self::WorkItemTimeBadgesReviewed),
            "activity_zone_reviewed" => Some(Self::ActivityZoneReviewed),
            "capture_usage_reviewed" => Some(Self::CaptureUsageReviewed),
            "entry_paths_reviewed" => Some(Self::EntryPathsReviewed),
            "window_entrypoints_reviewed" => Some(Self::WindowEntrypointsReviewed),
            "api_error" => Some(Self::ApiError),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AppStarted => "app_started",
            Self::AgentStarted => "agent_started",
            Self::AgentReused => "agent_reused",
            Self::AgentStaleRuntimeRecovered => "agent_stale_runtime_recovered",
            Self::WindowShown => "window_shown",
            Self::WindowHidden => "window_hidden",
            Self::WindowShowRequested => "window_show_requested",
            Self::WindowHideRequested => "window_hide_requested",
            Self::WindowDragStarted => "window_drag_started",
            Self::FocusStartRequested => "focus_start_requested",
            Self::FocusStarted => "focus_started",
            Self::FocusStartFailed => "focus_start_failed",
            Self::FocusSwitchRequested => "focus_switch_requested",
            Self::FocusSwitched => "focus_switched",
            Self::FocusStopRequested => "focus_stop_requested",
            Self::FocusStopped => "focus_stopped",
            Self::FocusStopFailed => "focus_stop_failed",
            Self::FocusCorrectionRequested => "focus_correction_requested",
            Self::FocusCorrected => "focus_corrected",
            Self::FocusCorrectionReviewed => "focus_correction_reviewed",
            Self::FocusCorrectionFailed => "focus_correction_failed",
            Self::DayClosureStarted => "day_closure_started",
            Self::DayClosureCompleted => "day_closure_completed",
            Self::ReportCopyRequested => "report_copy_requested",
            Self::ReportCopied => "report_copied",
            Self::ReportCopyFailed => "report_copy_failed",
            Self::ManualCopyFallbackShown => "manual_copy_fallback_shown",
            Self::CaptureCreateRequested => "capture_create_requested",
            Self::CaptureCreated => "capture_created",
            Self::CaptureCreateFailed => "capture_create_failed",
            Self::CaptureResolveRequested => "capture_resolve_requested",
            Self::CaptureResolved => "capture_resolved",
            Self::CaptureResolveFailed => "capture_resolve_failed",
            Self::CaptureUpdateRequested => "capture_update_requested",
            Self::CaptureUpdated => "capture_updated",
            Self::CaptureUpdateFailed => "capture_update_failed",
            Self::CaptureDeleteRequested => "capture_delete_requested",
            Self::CaptureDeleted => "capture_deleted",
            Self::CaptureDeleteFailed => "capture_delete_failed",
            Self::CaptureConvertRequested => "capture_convert_requested",
            Self::CaptureConverted => "capture_converted",
            Self::CaptureConvertFailed => "capture_convert_failed",
            Self::CaptureFollowupReviewed => "capture_followup_reviewed",
            Self::WorkItemTimeBadgesReviewed => "work_item_time_badges_reviewed",
            Self::ActivityZoneReviewed => "activity_zone_reviewed",
            Self::CaptureUsageReviewed => "capture_usage_reviewed",
            Self::EntryPathsReviewed => "entry_paths_reviewed",
            Self::WindowEntrypointsReviewed => "window_entrypoints_reviewed",
            Self::ApiError => "api_error",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppEvent {
    pub id: Uuid,
    pub ts: DateTime<Utc>,
    pub source: AppEventSource,
    pub kind: AppEventKind,
    pub work_item_id: Option<Uuid>,
    pub focus_session_id: Option<Uuid>,
    pub payload: Option<serde_json::Value>,
}

impl AppEvent {
    pub fn new(source: AppEventSource, kind: AppEventKind) -> Self {
        Self {
            id: Uuid::new_v4(),
            ts: Utc::now(),
            source,
            kind,
            work_item_id: None,
            focus_session_id: None,
            payload: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AppEventView {
    pub id: Uuid,
    pub ts: String,
    pub source: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_session_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

impl From<AppEvent> for AppEventView {
    fn from(event: AppEvent) -> Self {
        Self {
            id: event.id,
            ts: event.ts.to_rfc3339(),
            source: event.source.as_str().to_string(),
            kind: event.kind.as_str().to_string(),
            work_item_id: event.work_item_id,
            focus_session_id: event.focus_session_id,
            payload: event.payload,
        }
    }
}
