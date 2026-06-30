//! Focus session entity and timing logic.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Focus session state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
pub enum FocusSessionState {
    Active,
    Stopped,
}

impl FocusSessionState {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "active" => Some(Self::Active),
            "stopped" => Some(Self::Stopped),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Stopped => "stopped",
        }
    }
}

/// A manual contact-time block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusSession {
    pub id: Uuid,
    pub title: String,
    pub work_item_id: Option<Uuid>,
    pub state: FocusSessionState,
    pub target_seconds: i64,
    pub note: Option<String>,
    pub started_at: DateTime<Utc>,
    pub stopped_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

impl FocusSession {
    pub fn new(title: String, work_item_id: Option<Uuid>, target_seconds: Option<i64>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            title,
            work_item_id,
            state: FocusSessionState::Active,
            target_seconds: target_seconds.unwrap_or(25 * 60).max(60),
            note: None,
            started_at: now,
            stopped_at: None,
            updated_at: now,
        }
    }

    pub fn stop(&mut self, note: Option<String>) {
        let now = Utc::now();
        self.state = FocusSessionState::Stopped;
        self.stopped_at = Some(now);
        self.updated_at = now;

        if let Some(note) = note {
            let note = note.trim();
            self.note = if note.is_empty() {
                None
            } else {
                Some(note.to_string())
            };
        }
    }

    pub fn active_seconds_at(&self, now: DateTime<Utc>) -> i64 {
        let end = self.stopped_at.unwrap_or(now);
        (end - self.started_at).num_seconds().max(0)
    }
}

/// Focus session view for API responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusSessionView {
    pub id: Uuid,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_title: Option<String>,
    pub state: String,
    pub target_seconds: i64,
    pub active_seconds: i64,
    pub over_target_seconds: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped_at: Option<String>,
    pub updated_at: String,
}

impl FocusSessionView {
    pub fn from_session(
        session: &FocusSession,
        work_item_title: Option<String>,
        now: DateTime<Utc>,
    ) -> Self {
        let active_seconds = session.active_seconds_at(now);
        Self {
            id: session.id,
            title: session.title.clone(),
            work_item_id: session.work_item_id,
            work_item_title,
            state: session.state.as_str().to_string(),
            target_seconds: session.target_seconds,
            active_seconds,
            over_target_seconds: (active_seconds - session.target_seconds).max(0),
            note: session.note.clone(),
            started_at: session.started_at.to_rfc3339(),
            stopped_at: session.stopped_at.map(|dt| dt.to_rfc3339()),
            updated_at: session.updated_at.to_rfc3339(),
        }
    }
}
