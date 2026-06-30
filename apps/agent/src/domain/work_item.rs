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

/// Work item entity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItem {
    pub id: Uuid,
    pub title: String,
    #[serde(rename = "type")]
    pub item_type: Option<WorkItemType>,
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
        state: Option<WorkItemState>,
        note: Option<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            title,
            item_type,
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
    pub state: String,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub refs_count: usize,
    pub refs: Vec<super::RefView>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<String>,
}

impl WorkItemView {
    pub fn from_work_item(item: &WorkItem, refs: Vec<super::RefView>) -> Self {
        Self {
            id: item.id,
            title: item.title.clone(),
            item_type: item.item_type.map(|t| t.as_str().to_string()),
            state: item.state.as_str().to_string(),
            pinned: item.pinned,
            note: item.note.clone(),
            refs_count: refs.len(),
            refs,
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
    Deleted,
}

impl WorkItemEventKind {
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
