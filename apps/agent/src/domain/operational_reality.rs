//! Append-only causal assertions and the explainable current-state projection.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{EvidenceRefSnapshotView, LabelView, TrackPathNode};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationalSubjectKind {
    WorkItem,
    Track,
    Capture,
}

impl OperationalSubjectKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "work_item" => Some(Self::WorkItem),
            "track" => Some(Self::Track),
            "capture" => Some(Self::Capture),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::WorkItem => "work_item",
            Self::Track => "track",
            Self::Capture => "capture",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OperationalState {
    Active,
    Waiting,
    Blocked,
    Parked,
    Reactive,
    Completed,
    StaleImportant,
    MeetingTail,
    Unknown,
}

impl OperationalState {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "waiting" => Some(Self::Waiting),
            "blocked" => Some(Self::Blocked),
            "parked" => Some(Self::Parked),
            "reactive" => Some(Self::Reactive),
            "completed" => Some(Self::Completed),
            "stale-important" => Some(Self::StaleImportant),
            "meeting-tail" => Some(Self::MeetingTail),
            "unknown" => Some(Self::Unknown),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Waiting => "waiting",
            Self::Blocked => "blocked",
            Self::Parked => "parked",
            Self::Reactive => "reactive",
            Self::Completed => "completed",
            Self::StaleImportant => "stale-important",
            Self::MeetingTail => "meeting-tail",
            Self::Unknown => "unknown",
        }
    }

    pub fn priority(self) -> u8 {
        match self {
            Self::Active => 1,
            Self::Blocked => 2,
            Self::MeetingTail => 3,
            Self::StaleImportant => 4,
            Self::Waiting => 5,
            Self::Reactive => 6,
            Self::Unknown => 7,
            Self::Parked => 8,
            Self::Completed => 9,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CausalRecordKind {
    Intent,
    StateAssertion,
    Result,
    Decision,
    NextAction,
    Confirmation,
    Correction,
}

impl CausalRecordKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "intent" => Some(Self::Intent),
            "state_assertion" => Some(Self::StateAssertion),
            "result" => Some(Self::Result),
            "decision" => Some(Self::Decision),
            "next_action" => Some(Self::NextAction),
            "confirmation" => Some(Self::Confirmation),
            "correction" => Some(Self::Correction),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Intent => "intent",
            Self::StateAssertion => "state_assertion",
            Self::Result => "result",
            Self::Decision => "decision",
            Self::NextAction => "next_action",
            Self::Confirmation => "confirmation",
            Self::Correction => "correction",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CausalSource {
    User,
    System,
    Reflection,
    Legacy,
}

impl CausalSource {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Self::User),
            "system" => Some(Self::System),
            "reflection" => Some(Self::Reflection),
            "legacy" => Some(Self::Legacy),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::System => "system",
            Self::Reflection => "reflection",
            Self::Legacy => "legacy",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CausalProvenance {
    Confirmed,
    Observed,
    Derived,
    LegacyCurrent,
}

impl CausalProvenance {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "confirmed" => Some(Self::Confirmed),
            "observed" => Some(Self::Observed),
            "derived" => Some(Self::Derived),
            "legacy_current" => Some(Self::LegacyCurrent),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Confirmed => "confirmed",
            Self::Observed => "observed",
            Self::Derived => "derived",
            Self::LegacyCurrent => "legacy_current",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NextActionStatus {
    Open,
    Completed,
    Replaced,
    Dismissed,
}

impl NextActionStatus {
    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "open" => Some(Self::Open),
            "completed" => Some(Self::Completed),
            "replaced" => Some(Self::Replaced),
            "dismissed" => Some(Self::Dismissed),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Completed => "completed",
            Self::Replaced => "replaced",
            Self::Dismissed => "dismissed",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CausalRecord {
    pub id: Uuid,
    pub subject_kind: OperationalSubjectKind,
    pub subject_id: Uuid,
    pub work_item_id: Option<Uuid>,
    pub track_id: Option<Uuid>,
    pub capture_id: Option<Uuid>,
    pub record_kind: CausalRecordKind,
    pub operational_state: Option<OperationalState>,
    pub next_action_status: Option<NextActionStatus>,
    pub text: Option<String>,
    pub occurred_at: DateTime<Utc>,
    pub recorded_at: DateTime<Utc>,
    pub source: CausalSource,
    pub provenance: CausalProvenance,
    pub confidence: f64,
    pub schema_version: i64,
    pub device_id: String,
    pub correlation_id: Option<String>,
    pub supersedes_id: Option<Uuid>,
    pub focus_session_id: Option<Uuid>,
    pub evidence_event_id: Option<Uuid>,
    pub reflection_decision_id: Option<Uuid>,
    pub track_snapshot: Vec<TrackPathNode>,
    pub labels_snapshot: Vec<LabelView>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct NewCausalRecord {
    pub subject_kind: OperationalSubjectKind,
    pub subject_id: Uuid,
    pub work_item_id: Option<Uuid>,
    pub track_id: Option<Uuid>,
    pub capture_id: Option<Uuid>,
    pub record_kind: CausalRecordKind,
    pub operational_state: Option<OperationalState>,
    pub next_action_status: Option<NextActionStatus>,
    pub text: Option<String>,
    pub occurred_at: DateTime<Utc>,
    pub source: CausalSource,
    pub provenance: CausalProvenance,
    pub confidence: f64,
    pub correlation_id: Option<String>,
    pub supersedes_id: Option<Uuid>,
    pub focus_session_id: Option<Uuid>,
    pub evidence_event_id: Option<Uuid>,
    pub reflection_decision_id: Option<Uuid>,
    pub payload: serde_json::Value,
}

impl NewCausalRecord {
    pub fn for_work_item(work_item_id: Uuid, record_kind: CausalRecordKind) -> Self {
        Self {
            subject_kind: OperationalSubjectKind::WorkItem,
            subject_id: work_item_id,
            work_item_id: Some(work_item_id),
            track_id: None,
            capture_id: None,
            record_kind,
            operational_state: None,
            next_action_status: None,
            text: None,
            occurred_at: Utc::now(),
            source: CausalSource::User,
            provenance: CausalProvenance::Confirmed,
            confidence: 1.0,
            correlation_id: None,
            supersedes_id: None,
            focus_session_id: None,
            evidence_event_id: None,
            reflection_decision_id: None,
            payload: serde_json::json!({}),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalRecordView {
    pub id: Uuid,
    pub subject_kind: String,
    pub subject_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_id: Option<Uuid>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operational_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_action_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub occurred_at: String,
    pub recorded_at: String,
    pub source: String,
    pub provenance: String,
    pub confidence: f64,
    pub schema_version: i64,
    pub device_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_session_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_event_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reflection_decision_id: Option<Uuid>,
    pub track_snapshot: Vec<TrackPathNode>,
    pub labels_snapshot: Vec<LabelView>,
    pub payload: serde_json::Value,
}

impl From<CausalRecord> for CausalRecordView {
    fn from(record: CausalRecord) -> Self {
        Self {
            id: record.id,
            subject_kind: record.subject_kind.as_str().to_string(),
            subject_id: record.subject_id,
            work_item_id: record.work_item_id,
            track_id: record.track_id,
            capture_id: record.capture_id,
            kind: record.record_kind.as_str().to_string(),
            operational_state: record
                .operational_state
                .map(|state| state.as_str().to_string()),
            next_action_status: record
                .next_action_status
                .map(|status| status.as_str().to_string()),
            text: record.text,
            occurred_at: record.occurred_at.to_rfc3339(),
            recorded_at: record.recorded_at.to_rfc3339(),
            source: record.source.as_str().to_string(),
            provenance: record.provenance.as_str().to_string(),
            confidence: record.confidence,
            schema_version: record.schema_version,
            device_id: record.device_id,
            correlation_id: record.correlation_id,
            supersedes_id: record.supersedes_id,
            focus_session_id: record.focus_session_id,
            evidence_event_id: record.evidence_event_id,
            reflection_decision_id: record.reflection_decision_id,
            track_snapshot: record.track_snapshot,
            labels_snapshot: record.labels_snapshot,
            payload: record.payload,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationalRealityBasisView {
    pub kind: String,
    pub summary: String,
    pub occurred_at: String,
    pub source: String,
    pub provenance: String,
    pub confidence: f64,
    pub refs: Vec<EvidenceRefSnapshotView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causal_record_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_event_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reflection_decision_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationalNextActionView {
    pub record_id: Uuid,
    pub text: String,
    pub status: String,
    pub occurred_at: String,
    pub provenance: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationalRealityItemView {
    pub id: String,
    pub subject_kind: String,
    pub subject_id: Uuid,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_item_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_id: Option<Uuid>,
    pub state: String,
    pub state_provenance: String,
    pub state_confirmed: bool,
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_record_id: Option<Uuid>,
    pub why_visible: Vec<String>,
    pub facts: Vec<OperationalRealityBasisView>,
    pub unknowns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_significant_change: Option<OperationalRealityBasisView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_action: Option<OperationalNextActionView>,
    pub track_path: Vec<TrackPathNode>,
    pub labels: Vec<LabelView>,
    pub can_start_focus: bool,
    pub requires_attention: bool,
    pub last_touched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationalRealitySummaryView {
    pub total: usize,
    pub requiring_attention: usize,
    pub confirmed: usize,
    pub derived: usize,
    pub legacy_current: usize,
    pub without_next_action: usize,
    pub by_state: std::collections::BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationalRealityView {
    pub as_of: String,
    pub items: Vec<OperationalRealityItemView>,
    pub summary: OperationalRealitySummaryView,
    pub updated_at: String,
}
