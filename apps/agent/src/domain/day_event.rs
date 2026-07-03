//! Day-level timestamped notes for review.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::ActivityZone;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DayEventKind {
    NoteAdded,
}

impl DayEventKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "note_added" => Some(Self::NoteAdded),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NoteAdded => "note_added",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayEvent {
    pub id: Uuid,
    pub ts: DateTime<Utc>,
    pub kind: DayEventKind,
    pub text: String,
    pub focus_session_id: Option<Uuid>,
    pub activity_zone: Option<ActivityZone>,
    pub updated_at: DateTime<Utc>,
}

impl DayEvent {
    pub fn new(
        text: String,
        focus_session_id: Option<Uuid>,
        activity_zone: Option<ActivityZone>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            ts: now,
            kind: DayEventKind::NoteAdded,
            text,
            focus_session_id,
            activity_zone,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayEventView {
    pub id: Uuid,
    pub ts: String,
    pub kind: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_session_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_zone: Option<String>,
    pub updated_at: String,
}

impl DayEventView {
    pub fn from_event(event: DayEvent) -> Self {
        Self {
            id: event.id,
            ts: event.ts.to_rfc3339(),
            kind: event.kind.as_str().to_string(),
            text: event.text,
            focus_session_id: event.focus_session_id,
            activity_zone: event.activity_zone.map(|zone| zone.as_str().to_string()),
            updated_at: event.updated_at.to_rfc3339(),
        }
    }
}
