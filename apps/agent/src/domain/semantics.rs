//! Long-lived tracks, cross-cutting labels, and historical classification snapshots.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn normalize_semantic_title(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: Uuid,
    pub title: String,
    pub normalized_title: String,
    pub parent_track_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
}

impl Track {
    pub fn new(title: String, parent_track_id: Option<Uuid>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            normalized_title: normalize_semantic_title(&title),
            title,
            parent_track_id,
            created_at: now,
            updated_at: now,
            archived_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: Uuid,
    pub title: String,
    pub normalized_title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
}

impl Label {
    pub fn new(title: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            normalized_title: normalize_semantic_title(&title),
            title,
            created_at: now,
            updated_at: now,
            archived_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrackPathNode {
    pub id: Uuid,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackView {
    pub id: Uuid,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_track_id: Option<Uuid>,
    pub path: Vec<TrackPathNode>,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl TrackView {
    pub fn from_track(track: &Track, path: Vec<TrackPathNode>) -> Self {
        Self {
            id: track.id,
            title: track.title.clone(),
            parent_track_id: track.parent_track_id,
            path,
            archived: track.archived_at.is_some(),
            created_at: track.created_at.to_rfc3339(),
            updated_at: track.updated_at.to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LabelView {
    pub id: Uuid,
    pub title: String,
    pub archived: bool,
}

impl LabelView {
    pub fn from_label(label: &Label) -> Self {
        Self {
            id: label.id,
            title: label.title.clone(),
            archived: label.archived_at.is_some(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkItemSemanticsView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<TrackView>,
    pub labels: Vec<LabelView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSnapshotView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<Uuid>,
    pub track_path: Vec<TrackPathNode>,
    pub labels: Vec<LabelView>,
    pub captured_at: String,
    pub provenance: String,
}
