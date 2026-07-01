//! Capture inbox entries.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
pub enum CaptureState {
    Open,
    Resolved,
    Converted,
}

impl CaptureState {
    pub fn from_str(value: &str) -> Option<Self> {
        match value.to_lowercase().as_str() {
            "open" => Some(Self::Open),
            "resolved" => Some(Self::Resolved),
            "converted" => Some(Self::Converted),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Resolved => "resolved",
            Self::Converted => "converted",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capture {
    pub id: Uuid,
    pub text: String,
    pub state: CaptureState,
    pub work_item_id: Option<Uuid>,
    pub focus_session_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub converted_at: Option<DateTime<Utc>>,
}

impl Capture {
    pub fn new(text: String, focus_session_id: Option<Uuid>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            text: text.trim().to_string(),
            state: CaptureState::Open,
            work_item_id: None,
            focus_session_id,
            created_at: now,
            updated_at: now,
            resolved_at: None,
            converted_at: None,
        }
    }

    pub fn resolve(&mut self) {
        let now = Utc::now();
        self.state = CaptureState::Resolved;
        self.updated_at = now;
        self.resolved_at = Some(now);
    }

    pub fn convert_to_work_item(&mut self, work_item_id: Uuid) {
        let now = Utc::now();
        self.state = CaptureState::Converted;
        self.work_item_id = Some(work_item_id);
        self.updated_at = now;
        self.converted_at = Some(now);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureView {
    pub id: Uuid,
    pub text: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_session_id: Option<Uuid>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub converted_at: Option<String>,
}

impl From<Capture> for CaptureView {
    fn from(capture: Capture) -> Self {
        Self {
            id: capture.id,
            text: capture.text,
            state: capture.state.as_str().to_string(),
            work_item_id: capture.work_item_id,
            focus_session_id: capture.focus_session_id,
            created_at: capture.created_at.to_rfc3339(),
            updated_at: capture.updated_at.to_rfc3339(),
            resolved_at: capture.resolved_at.map(|value| value.to_rfc3339()),
            converted_at: capture.converted_at.map(|value| value.to_rfc3339()),
        }
    }
}
