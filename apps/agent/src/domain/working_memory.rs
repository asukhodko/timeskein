//! Long-lived working memory, stages, re-entry, and portable Context Packs.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{LabelView, TrackPathNode};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkMemorySubjectKind {
    WorkItem,
    Track,
}

impl WorkMemorySubjectKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "work_item" => Some(Self::WorkItem),
            "track" => Some(Self::Track),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::WorkItem => "work_item",
            Self::Track => "track",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkMemoryEntryKind {
    Thought,
    Question,
    Decision,
    Observation,
    Result,
    NextAction,
    Material,
    StateChange,
}

impl WorkMemoryEntryKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "thought" => Some(Self::Thought),
            "question" => Some(Self::Question),
            "decision" => Some(Self::Decision),
            "observation" => Some(Self::Observation),
            "result" => Some(Self::Result),
            "next_action" => Some(Self::NextAction),
            "material" => Some(Self::Material),
            "state_change" => Some(Self::StateChange),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Thought => "thought",
            Self::Question => "question",
            Self::Decision => "decision",
            Self::Observation => "observation",
            Self::Result => "result",
            Self::NextAction => "next_action",
            Self::Material => "material",
            Self::StateChange => "state_change",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkMemoryMaterialKind {
    Text,
    Url,
    FilePath,
}

impl WorkMemoryMaterialKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "text" => Some(Self::Text),
            "url" => Some(Self::Url),
            "file_path" => Some(Self::FilePath),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Url => "url",
            Self::FilePath => "file_path",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkMemoryRevisionKind {
    Create,
    Edit,
    Delete,
    Restore,
}

impl WorkMemoryRevisionKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "create" => Some(Self::Create),
            "edit" => Some(Self::Edit),
            "delete" => Some(Self::Delete),
            "restore" => Some(Self::Restore),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Edit => "edit",
            Self::Delete => "delete",
            Self::Restore => "restore",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkMemoryRevisionView {
    pub id: Uuid,
    pub revision_number: i64,
    pub change_kind: String,
    pub entry_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change_note: Option<String>,
    pub created_at: String,
    pub source: String,
    pub provenance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemStageView {
    pub id: Uuid,
    pub work_item_id: Uuid,
    pub title: String,
    pub position: i64,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    pub active_seconds: i64,
    pub entrances: i64,
}

#[derive(Debug, Clone)]
pub struct NewWorkMemoryEntry {
    pub id: Uuid,
    pub subject_kind: WorkMemorySubjectKind,
    pub subject_id: Uuid,
    pub work_item_id: Option<Uuid>,
    pub track_id: Option<Uuid>,
    pub work_item_title_snapshot: Option<String>,
    pub focus_session_id: Option<Uuid>,
    pub stage_id: Option<Uuid>,
    pub day_contract_revision_id: Option<Uuid>,
    pub local_date: Option<String>,
    pub occurred_at: DateTime<Utc>,
    pub recorded_at: DateTime<Utc>,
    pub source: String,
    pub provenance: String,
    pub origin_kind: String,
    pub origin_ref: Option<String>,
    pub track_snapshot: Vec<TrackPathNode>,
    pub labels_snapshot: Vec<LabelView>,
    pub entry_kind: WorkMemoryEntryKind,
    pub text: Option<String>,
    pub material_kind: Option<WorkMemoryMaterialKind>,
    pub material_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkMemoryEntryView {
    pub id: Uuid,
    pub subject_kind: String,
    pub subject_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_title_snapshot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_session_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day_contract_revision_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_date: Option<String>,
    pub occurred_at: String,
    pub recorded_at: String,
    pub updated_at: String,
    pub source: String,
    pub provenance: String,
    pub origin_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_ref: Option<String>,
    pub track_snapshot: Vec<TrackPathNode>,
    pub labels_snapshot: Vec<LabelView>,
    pub current_revision: WorkMemoryRevisionView,
    pub revisions: Vec<WorkMemoryRevisionView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusWorkSnapshotView {
    pub focus_session_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_outcome: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day_contract_revision_id: Option<Uuid>,
    pub captured_at: String,
    pub provenance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemAliasView {
    pub source_work_item_id: Uuid,
    pub canonical_work_item_id: Uuid,
    pub source_title_snapshot: String,
    pub merged_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContextPackProfile {
    WorkItemReentry,
    TrackReentry,
}

impl ContextPackProfile {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "work-item-reentry" => Some(Self::WorkItemReentry),
            "track-reentry" => Some(Self::TrackReentry),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::WorkItemReentry => "work-item-reentry",
            Self::TrackReentry => "track-reentry",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPackScopeView {
    pub kind: String,
    pub id: Uuid,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_id: Option<Uuid>,
    pub aliases: Vec<WorkItemAliasView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPackWorkItemView {
    pub id: Uuid,
    pub title: String,
    pub state: String,
    pub track_path: Vec<TrackPathNode>,
    pub labels: Vec<LabelView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPackStageSummaryView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Uuid>,
    pub title: String,
    pub state: String,
    pub active_seconds: i64,
    pub entrances: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPackFocusSummaryView {
    pub active_seconds: i64,
    pub entrances: i64,
    pub by_stage: Vec<ContextPackStageSummaryView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPackFactsView {
    pub work_items: Vec<ContextPackWorkItemView>,
    pub stages: Vec<WorkItemStageView>,
    pub memory: Vec<WorkMemoryEntryView>,
    pub focus: ContextPackFocusSummaryView,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_confirmed_change: Option<WorkMemoryEntryView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_stage: Option<WorkItemStageView>,
    pub open_questions: Vec<WorkMemoryEntryView>,
    pub materials: Vec<WorkMemoryEntryView>,
    pub next_actions: Vec<WorkMemoryEntryView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPackProvenanceView {
    pub source: String,
    pub projection: String,
    pub canonical_tables: Vec<String>,
    pub external_text_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPackView {
    pub schema_version: i64,
    pub profile: String,
    pub scope: ContextPackScopeView,
    pub as_of: String,
    pub facts: ContextPackFactsView,
    pub unknowns: Vec<String>,
    pub warnings: Vec<String>,
    pub redactions: Vec<String>,
    pub provenance: ContextPackProvenanceView,
}
