//! Item-backed, append-only day contracts for the Operational Workspace.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    LabelView, OperationalNextActionView, OperationalRealityBasisView, OperationalRealityView,
    TrackPathNode,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DayContractSubjectKind {
    WorkItem,
    Track,
}

impl DayContractSubjectKind {
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
pub enum DayContractRevisionKind {
    Morning,
    Reentry,
    Adjustment,
}

impl DayContractRevisionKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "morning" => Some(Self::Morning),
            "reentry" => Some(Self::Reentry),
            "adjustment" => Some(Self::Adjustment),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Morning => "morning",
            Self::Reentry => "reentry",
            Self::Adjustment => "adjustment",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DayContractSubjectRef {
    pub kind: DayContractSubjectKind,
    pub subject_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_outcome: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayContractSubjectSnapshot {
    pub kind: DayContractSubjectKind,
    pub subject_id: Uuid,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<Uuid>,
    pub state: String,
    pub state_provenance: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_record_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_action: Option<OperationalNextActionView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_significant_change: Option<OperationalRealityBasisView>,
    pub track_path: Vec<TrackPathNode>,
    pub labels: Vec<LabelView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_outcome: Option<String>,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayContractRevision {
    pub id: Uuid,
    pub local_date: String,
    pub revision_number: i64,
    pub revision_kind: DayContractRevisionKind,
    pub active_subjects: Vec<DayContractSubjectSnapshot>,
    pub first_action_work_item_id: Uuid,
    pub first_action: DayContractSubjectSnapshot,
    pub parked_subjects: Vec<DayContractSubjectSnapshot>,
    pub overflow_subjects: Vec<DayContractSubjectSnapshot>,
    pub why_now: String,
    pub created_at: DateTime<Utc>,
    pub source: String,
    pub provenance: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes_id: Option<Uuid>,
    pub schema_version: i64,
}

#[derive(Debug, Clone)]
pub struct NewDayContractRevision {
    pub local_date: String,
    pub revision_kind: DayContractRevisionKind,
    pub active_subjects: Vec<DayContractSubjectSnapshot>,
    pub first_action_work_item_id: Uuid,
    pub first_action: DayContractSubjectSnapshot,
    pub parked_subjects: Vec<DayContractSubjectSnapshot>,
    pub overflow_subjects: Vec<DayContractSubjectSnapshot>,
    pub why_now: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationalWorkspaceView {
    pub local_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_contract: Option<DayContractRevision>,
    pub revisions: Vec<DayContractRevision>,
    pub reality: OperationalRealityView,
    pub updated_at: String,
}
