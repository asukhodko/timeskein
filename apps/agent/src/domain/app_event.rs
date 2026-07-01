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
    WindowDragStarted,
    FocusStartRequested,
    FocusStarted,
    FocusStartFailed,
    FocusSwitchRequested,
    FocusSwitched,
    FocusStopRequested,
    FocusStopped,
    FocusStopFailed,
    ReportCopyRequested,
    ReportCopied,
    ReportCopyFailed,
    ManualCopyFallbackShown,
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
            "window_drag_started" => Some(Self::WindowDragStarted),
            "focus_start_requested" => Some(Self::FocusStartRequested),
            "focus_started" => Some(Self::FocusStarted),
            "focus_start_failed" => Some(Self::FocusStartFailed),
            "focus_switch_requested" => Some(Self::FocusSwitchRequested),
            "focus_switched" => Some(Self::FocusSwitched),
            "focus_stop_requested" => Some(Self::FocusStopRequested),
            "focus_stopped" => Some(Self::FocusStopped),
            "focus_stop_failed" => Some(Self::FocusStopFailed),
            "report_copy_requested" => Some(Self::ReportCopyRequested),
            "report_copied" => Some(Self::ReportCopied),
            "report_copy_failed" => Some(Self::ReportCopyFailed),
            "manual_copy_fallback_shown" => Some(Self::ManualCopyFallbackShown),
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
            Self::WindowDragStarted => "window_drag_started",
            Self::FocusStartRequested => "focus_start_requested",
            Self::FocusStarted => "focus_started",
            Self::FocusStartFailed => "focus_start_failed",
            Self::FocusSwitchRequested => "focus_switch_requested",
            Self::FocusSwitched => "focus_switched",
            Self::FocusStopRequested => "focus_stop_requested",
            Self::FocusStopped => "focus_stopped",
            Self::FocusStopFailed => "focus_stop_failed",
            Self::ReportCopyRequested => "report_copy_requested",
            Self::ReportCopied => "report_copied",
            Self::ReportCopyFailed => "report_copy_failed",
            Self::ManualCopyFallbackShown => "manual_copy_fallback_shown",
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
