//! Work Item entity and business logic

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Work item state representing current status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
pub enum WorkItemState {
    Active,
    Waiting,
    Blocked,
    Done,
    Someday,
    Unknown,
}

impl WorkItemState {
    /// Get sort priority (lower = higher priority)
    pub fn priority(&self) -> u8 {
        match self {
            Self::Active => 1,
            Self::Blocked => 2,
            Self::Waiting => 3,
            Self::Unknown => 4,
            Self::Someday => 5,
            Self::Done => 6,
        }
    }

    /// Parse from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "active" => Some(Self::Active),
            "waiting" => Some(Self::Waiting),
            "blocked" => Some(Self::Blocked),
            "done" => Some(Self::Done),
            "someday" => Some(Self::Someday),
            "unknown" => Some(Self::Unknown),
            _ => None,
        }
    }

    /// Convert to string
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Waiting => "waiting",
            Self::Blocked => "blocked",
            Self::Done => "done",
            Self::Someday => "someday",
            Self::Unknown => "unknown",
        }
    }
}

impl Default for WorkItemState {
    fn default() -> Self {
        Self::Unknown
    }
}

/// Work item type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
pub enum WorkItemType {
    Task,
    Project,
    Question,
}

impl WorkItemType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "task" => Some(Self::Task),
            "project" => Some(Self::Project),
            "question" => Some(Self::Question),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Project => "project",
            Self::Question => "question",
        }
    }
}

/// Broad activity zone for day review.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
pub enum ActivityZone {
    Work,
    Coordination,
    Recovery,
    Idle,
    Personal,
}

impl ActivityZone {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "work" => Some(Self::Work),
            "coordination" => Some(Self::Coordination),
            "recovery" => Some(Self::Recovery),
            "idle" => Some(Self::Idle),
            "personal" => Some(Self::Personal),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Work => "work",
            Self::Coordination => "coordination",
            Self::Recovery => "recovery",
            Self::Idle => "idle",
            Self::Personal => "personal",
        }
    }
}

impl Default for ActivityZone {
    fn default() -> Self {
        Self::Work
    }
}

/// Work item entity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItem {
    pub id: Uuid,
    pub title: String,
    #[serde(rename = "type")]
    pub item_type: Option<WorkItemType>,
    pub activity_zone: ActivityZone,
    pub state: WorkItemState,
    pub pinned: bool,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub deleted_at: Option<DateTime<Utc>>,
}

impl WorkItem {
    /// Create a new work item
    pub fn new(
        title: String,
        item_type: Option<WorkItemType>,
        activity_zone: Option<ActivityZone>,
        state: Option<WorkItemState>,
        note: Option<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            title,
            item_type,
            activity_zone: activity_zone.unwrap_or_default(),
            state: state.unwrap_or_default(),
            pinned: false,
            note,
            created_at: now,
            updated_at: now,
            last_seen_at: Some(now), // Initial creation counts as "seen"
            deleted_at: None,
        }
    }

    /// Touch - update last_seen_at to now
    pub fn touch(&mut self) {
        let now = Utc::now();
        self.updated_at = now;
        self.last_seen_at = Some(now);
    }

    /// Set state
    pub fn set_state(&mut self, state: WorkItemState) {
        let now = Utc::now();
        self.state = state;
        self.updated_at = now;
        self.last_seen_at = Some(now);
    }

    /// Set note
    pub fn set_note(&mut self, note: Option<String>) {
        let now = Utc::now();
        self.note = note;
        self.updated_at = now;
        self.last_seen_at = Some(now);
    }

    /// Toggle pinned
    pub fn toggle_pin(&mut self) {
        let now = Utc::now();
        self.pinned = !self.pinned;
        self.updated_at = now;
    }

    /// Soft delete
    pub fn soft_delete(&mut self) {
        let now = Utc::now();
        self.deleted_at = Some(now);
        self.updated_at = now;
    }

    /// Check if deleted
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }
}

/// Work item view for API responses (includes refs)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemView {
    pub id: Uuid,
    pub title: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub item_type: Option<String>,
    pub activity_zone: String,
    pub state: String,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub refs_count: usize,
    pub refs: Vec<super::RefView>,
    pub today_active_seconds: i64,
    pub total_active_seconds: i64,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<String>,
}

impl WorkItemView {
    pub fn from_work_item(item: &WorkItem, refs: Vec<super::RefView>) -> Self {
        Self::from_work_item_with_stats(item, refs, 0, 0)
    }

    pub fn from_work_item_with_stats(
        item: &WorkItem,
        refs: Vec<super::RefView>,
        today_active_seconds: i64,
        total_active_seconds: i64,
    ) -> Self {
        Self {
            id: item.id,
            title: item.title.clone(),
            item_type: item.item_type.map(|t| t.as_str().to_string()),
            activity_zone: item.activity_zone.as_str().to_string(),
            state: item.state.as_str().to_string(),
            pinned: item.pinned,
            note: item.note.clone(),
            refs_count: refs.len(),
            refs,
            today_active_seconds,
            total_active_seconds,
            created_at: item.created_at.to_rfc3339(),
            updated_at: item.updated_at.to_rfc3339(),
            last_seen_at: item.last_seen_at.map(|dt| dt.to_rfc3339()),
        }
    }
}

/// Event kinds for audit log
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkItemEventKind {
    Created,
    Touched,
    StateChanged,
    NoteChanged,
    Pinned,
    Unpinned,
    RefAttached,
    RefRemoved,
    OpenedRef,
    Updated,
    NoteAdded,
    Deleted,
}

impl WorkItemEventKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "created" => Some(Self::Created),
            "touched" => Some(Self::Touched),
            "state_changed" => Some(Self::StateChanged),
            "note_changed" => Some(Self::NoteChanged),
            "pinned" => Some(Self::Pinned),
            "unpinned" => Some(Self::Unpinned),
            "ref_attached" => Some(Self::RefAttached),
            "ref_removed" => Some(Self::RefRemoved),
            "opened_ref" => Some(Self::OpenedRef),
            "updated" => Some(Self::Updated),
            "note_added" => Some(Self::NoteAdded),
            "deleted" => Some(Self::Deleted),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Touched => "touched",
            Self::StateChanged => "state_changed",
            Self::NoteChanged => "note_changed",
            Self::Pinned => "pinned",
            Self::Unpinned => "unpinned",
            Self::RefAttached => "ref_attached",
            Self::RefRemoved => "ref_removed",
            Self::OpenedRef => "opened_ref",
            Self::Updated => "updated",
            Self::NoteAdded => "note_added",
            Self::Deleted => "deleted",
        }
    }
}

/// Work item event for audit log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemEvent {
    pub id: Uuid,
    pub ts: DateTime<Utc>,
    pub work_item_id: Uuid,
    pub kind: WorkItemEventKind,
    pub payload: Option<serde_json::Value>,
}

impl WorkItemEvent {
    pub fn new(
        work_item_id: Uuid,
        kind: WorkItemEventKind,
        payload: Option<serde_json::Value>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            ts: Utc::now(),
            work_item_id,
            kind,
            payload,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemEventView {
    pub id: Uuid,
    pub ts: String,
    pub work_item_id: Uuid,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_session_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

impl WorkItemEventView {
    pub fn from_event(event: WorkItemEvent) -> Self {
        let text = event
            .payload
            .as_ref()
            .and_then(|payload| payload.get("text"))
            .and_then(|value| value.as_str())
            .map(str::to_string);
        let focus_session_id = event
            .payload
            .as_ref()
            .and_then(|payload| payload.get("focus_session_id"))
            .and_then(|value| value.as_str())
            .and_then(|value| Uuid::parse_str(value).ok());

        Self {
            id: event.id,
            ts: event.ts.to_rfc3339(),
            work_item_id: event.work_item_id,
            kind: event.kind.as_str().to_string(),
            text,
            focus_session_id,
            payload: event.payload,
        }
    }
}
