//! Typed user-authored evidence attached to timestamped Work Item events.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    Result,
    Decision,
    Blocker,
    NextStep,
    Observation,
}

impl EvidenceKind {
    pub fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            "result" => Some(Self::Result),
            "decision" => Some(Self::Decision),
            "blocker" => Some(Self::Blocker),
            "next_step" => Some(Self::NextStep),
            "observation" => Some(Self::Observation),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Result => "result",
            Self::Decision => "decision",
            Self::Blocker => "blocker",
            Self::NextStep => "next_step",
            Self::Observation => "observation",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceRefSnapshotView {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_id: Option<Uuid>,
    pub kind: String,
    pub value: String,
    pub captured_at: String,
    pub provenance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceEntryView {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_session_id: Option<Uuid>,
    pub refs: Vec<EvidenceRefSnapshotView>,
    pub captured_at: String,
    pub provenance: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evidence_kinds_are_explicit_and_stable() {
        for kind in [
            EvidenceKind::Result,
            EvidenceKind::Decision,
            EvidenceKind::Blocker,
            EvidenceKind::NextStep,
            EvidenceKind::Observation,
        ] {
            assert_eq!(EvidenceKind::from_str(kind.as_str()), Some(kind));
        }
        assert_eq!(EvidenceKind::from_str("thought"), None);
    }
}
