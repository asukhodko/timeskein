//! Repositories for Tracks, Labels, current assignments, and immutable snapshots.

use std::collections::HashSet;

use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{
    Label, LabelView, SemanticSnapshotView, Track, TrackPathNode, TrackView, WorkItemSemanticsView,
};

impl Database {
    pub async fn list_tracks(&self, include_archived: bool) -> Result<Vec<TrackView>> {
        let rows = sqlx::query(
            "SELECT id, title, normalized_title, parent_track_id, created_at, updated_at, archived_at
             FROM tracks
             WHERE ?1 OR archived_at IS NULL
             ORDER BY normalized_title",
        )
        .bind(include_archived)
        .fetch_all(self.pool())
        .await?;

        let mut views = Vec::with_capacity(rows.len());
        for row in rows {
            let track = track_from_row(&row)?;
            let path = self.track_path(track.id).await?;
            views.push(TrackView::from_track(&track, path));
        }
        Ok(views)
    }

    pub async fn get_track(&self, id: Uuid) -> Result<Option<Track>> {
        let row = sqlx::query(
            "SELECT id, title, normalized_title, parent_track_id, created_at, updated_at, archived_at
             FROM tracks WHERE id = ?1",
        )
        .bind(id.to_string())
        .fetch_optional(self.pool())
        .await?;
        row.map(|row| track_from_row(&row)).transpose()
    }

    pub async fn find_track_by_normalized_title(
        &self,
        normalized_title: &str,
    ) -> Result<Option<Track>> {
        let row = sqlx::query(
            "SELECT id, title, normalized_title, parent_track_id, created_at, updated_at, archived_at
             FROM tracks WHERE normalized_title = ?1 LIMIT 1",
        )
        .bind(normalized_title)
        .fetch_optional(self.pool())
        .await?;
        row.map(|row| track_from_row(&row)).transpose()
    }

    pub async fn create_track(&self, track: &Track) -> Result<()> {
        sqlx::query(
            "INSERT INTO tracks (id, title, normalized_title, parent_track_id, created_at, updated_at, archived_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(track.id.to_string())
        .bind(&track.title)
        .bind(&track.normalized_title)
        .bind(track.parent_track_id.map(|id| id.to_string()))
        .bind(track.created_at.to_rfc3339())
        .bind(track.updated_at.to_rfc3339())
        .bind(track.archived_at.map(|value| value.to_rfc3339()))
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn update_track(&self, track: &Track) -> Result<()> {
        sqlx::query(
            "UPDATE tracks
             SET title = ?2, normalized_title = ?3, parent_track_id = ?4, updated_at = ?5, archived_at = ?6
             WHERE id = ?1",
        )
        .bind(track.id.to_string())
        .bind(&track.title)
        .bind(&track.normalized_title)
        .bind(track.parent_track_id.map(|id| id.to_string()))
        .bind(track.updated_at.to_rfc3339())
        .bind(track.archived_at.map(|value| value.to_rfc3339()))
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn track_path(&self, id: Uuid) -> Result<Vec<TrackPathNode>> {
        let mut path = Vec::new();
        let mut cursor = Some(id);
        let mut seen = HashSet::new();

        while let Some(track_id) = cursor {
            if !seen.insert(track_id) {
                return Err(anyhow!("Track hierarchy contains a cycle"));
            }
            if seen.len() > 64 {
                return Err(anyhow!("Track hierarchy is too deep"));
            }
            let track = self
                .get_track(track_id)
                .await?
                .ok_or_else(|| anyhow!("Track not found while building path"))?;
            cursor = track.parent_track_id;
            path.push(TrackPathNode {
                id: track.id,
                title: track.title,
            });
        }

        path.reverse();
        Ok(path)
    }

    pub async fn validate_track_parent(
        &self,
        track_id: Option<Uuid>,
        parent_id: Option<Uuid>,
    ) -> Result<()> {
        let Some(parent_id) = parent_id else {
            return Ok(());
        };
        if track_id == Some(parent_id) {
            return Err(anyhow!("Track cannot be its own parent"));
        }
        self.get_track(parent_id)
            .await?
            .ok_or_else(|| anyhow!("Parent Track not found"))?;
        if let Some(track_id) = track_id {
            let path = self.track_path(parent_id).await?;
            if path.iter().any(|node| node.id == track_id) {
                return Err(anyhow!("Track hierarchy would contain a cycle"));
            }
        }
        Ok(())
    }

    pub async fn list_labels(&self, include_archived: bool) -> Result<Vec<LabelView>> {
        let rows = sqlx::query(
            "SELECT id, title, normalized_title, created_at, updated_at, archived_at
             FROM labels
             WHERE ?1 OR archived_at IS NULL
             ORDER BY normalized_title",
        )
        .bind(include_archived)
        .fetch_all(self.pool())
        .await?;
        rows.iter()
            .map(label_from_row)
            .map(|result| result.map(|label| LabelView::from_label(&label)))
            .collect()
    }

    pub async fn get_label(&self, id: Uuid) -> Result<Option<Label>> {
        let row = sqlx::query(
            "SELECT id, title, normalized_title, created_at, updated_at, archived_at
             FROM labels WHERE id = ?1",
        )
        .bind(id.to_string())
        .fetch_optional(self.pool())
        .await?;
        row.map(|row| label_from_row(&row)).transpose()
    }

    pub async fn find_label_by_normalized_title(
        &self,
        normalized_title: &str,
    ) -> Result<Option<Label>> {
        let row = sqlx::query(
            "SELECT id, title, normalized_title, created_at, updated_at, archived_at
             FROM labels WHERE normalized_title = ?1 LIMIT 1",
        )
        .bind(normalized_title)
        .fetch_optional(self.pool())
        .await?;
        row.map(|row| label_from_row(&row)).transpose()
    }

    pub async fn create_label(&self, label: &Label) -> Result<()> {
        sqlx::query(
            "INSERT INTO labels (id, title, normalized_title, created_at, updated_at, archived_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(label.id.to_string())
        .bind(&label.title)
        .bind(&label.normalized_title)
        .bind(label.created_at.to_rfc3339())
        .bind(label.updated_at.to_rfc3339())
        .bind(label.archived_at.map(|value| value.to_rfc3339()))
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn update_label(&self, label: &Label) -> Result<()> {
        sqlx::query(
            "UPDATE labels
             SET title = ?2, normalized_title = ?3, updated_at = ?4, archived_at = ?5
             WHERE id = ?1",
        )
        .bind(label.id.to_string())
        .bind(&label.title)
        .bind(&label.normalized_title)
        .bind(label.updated_at.to_rfc3339())
        .bind(label.archived_at.map(|value| value.to_rfc3339()))
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn get_work_item_semantics(
        &self,
        work_item_id: Uuid,
    ) -> Result<WorkItemSemanticsView> {
        let track_id: Option<String> =
            sqlx::query_scalar("SELECT track_id FROM work_item_tracks WHERE work_item_id = ?1")
                .bind(work_item_id.to_string())
                .fetch_optional(self.pool())
                .await?;

        let track = if let Some(track_id) = track_id {
            let track_id = Uuid::parse_str(&track_id)?;
            let track = self
                .get_track(track_id)
                .await?
                .ok_or_else(|| anyhow!("Assigned Track not found"))?;
            Some(TrackView::from_track(
                &track,
                self.track_path(track_id).await?,
            ))
        } else {
            None
        };

        let rows = sqlx::query(
            "SELECT l.id, l.title, l.normalized_title, l.created_at, l.updated_at, l.archived_at
             FROM work_item_labels wil
             JOIN labels l ON l.id = wil.label_id
             WHERE wil.work_item_id = ?1
             ORDER BY l.normalized_title",
        )
        .bind(work_item_id.to_string())
        .fetch_all(self.pool())
        .await?;
        let labels = rows
            .iter()
            .map(label_from_row)
            .map(|result| result.map(|label| LabelView::from_label(&label)))
            .collect::<Result<Vec<_>>>()?;

        Ok(WorkItemSemanticsView { track, labels })
    }

    pub async fn set_work_item_semantics(
        &self,
        work_item_id: Uuid,
        track_id: Option<Uuid>,
        label_ids: &[Uuid],
    ) -> Result<WorkItemSemanticsView> {
        let current = self.get_work_item_semantics(work_item_id).await?;
        let current_track_id = current.track.as_ref().map(|track| track.id);
        let current_label_ids = current
            .labels
            .iter()
            .map(|label| label.id)
            .collect::<HashSet<_>>();
        if let Some(track_id) = track_id {
            let track = self
                .get_track(track_id)
                .await?
                .ok_or_else(|| anyhow!("Track not found"))?;
            if track.archived_at.is_some() && current_track_id != Some(track_id) {
                return Err(anyhow!("Archived Track cannot be assigned"));
            }
        }
        let mut unique_labels = HashSet::new();
        for label_id in label_ids {
            if unique_labels.insert(*label_id) {
                let label = self
                    .get_label(*label_id)
                    .await?
                    .ok_or_else(|| anyhow!("Label not found"))?;
                if label.archived_at.is_some() && !current_label_ids.contains(label_id) {
                    return Err(anyhow!("Archived Label cannot be assigned"));
                }
            }
        }

        let now = Utc::now().to_rfc3339();
        let mut transaction = self.pool().begin().await?;
        if let Some(track_id) = track_id {
            sqlx::query(
                "INSERT INTO work_item_tracks (work_item_id, track_id, assigned_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(work_item_id) DO UPDATE SET track_id = excluded.track_id, updated_at = excluded.updated_at",
            )
            .bind(work_item_id.to_string())
            .bind(track_id.to_string())
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        } else {
            sqlx::query("DELETE FROM work_item_tracks WHERE work_item_id = ?1")
                .bind(work_item_id.to_string())
                .execute(&mut *transaction)
                .await?;
        }

        sqlx::query("DELETE FROM work_item_labels WHERE work_item_id = ?1")
            .bind(work_item_id.to_string())
            .execute(&mut *transaction)
            .await?;
        for label_id in unique_labels {
            sqlx::query(
                "INSERT INTO work_item_labels (work_item_id, label_id, assigned_at) VALUES (?1, ?2, ?3)",
            )
            .bind(work_item_id.to_string())
            .bind(label_id.to_string())
            .bind(&now)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        self.get_work_item_semantics(work_item_id).await
    }

    pub async fn snapshot_focus_session_semantics(
        &self,
        focus_session_id: Uuid,
        work_item_id: Option<Uuid>,
    ) -> Result<SemanticSnapshotView> {
        let snapshot = self.build_semantic_snapshot(work_item_id).await?;
        sqlx::query(
            "INSERT INTO focus_session_semantic_snapshots
                (focus_session_id, track_id, track_path_json, labels_json, captured_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(focus_session_id) DO UPDATE SET
                track_id = excluded.track_id,
                track_path_json = excluded.track_path_json,
                labels_json = excluded.labels_json,
                captured_at = excluded.captured_at",
        )
        .bind(focus_session_id.to_string())
        .bind(snapshot.track_id.map(|id| id.to_string()))
        .bind(serde_json::to_string(&snapshot.track_path)?)
        .bind(serde_json::to_string(&snapshot.labels)?)
        .bind(&snapshot.captured_at)
        .execute(self.pool())
        .await?;
        Ok(snapshot)
    }

    pub async fn snapshot_work_item_event_semantics(
        &self,
        event_id: Uuid,
        work_item_id: Uuid,
    ) -> Result<SemanticSnapshotView> {
        let snapshot = self.build_semantic_snapshot(Some(work_item_id)).await?;
        sqlx::query(
            "INSERT INTO work_item_event_semantic_snapshots
                (work_item_event_id, track_id, track_path_json, labels_json, captured_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(work_item_event_id) DO UPDATE SET
                track_id = excluded.track_id,
                track_path_json = excluded.track_path_json,
                labels_json = excluded.labels_json,
                captured_at = excluded.captured_at",
        )
        .bind(event_id.to_string())
        .bind(snapshot.track_id.map(|id| id.to_string()))
        .bind(serde_json::to_string(&snapshot.track_path)?)
        .bind(serde_json::to_string(&snapshot.labels)?)
        .bind(&snapshot.captured_at)
        .execute(self.pool())
        .await?;
        Ok(snapshot)
    }

    async fn build_semantic_snapshot(
        &self,
        work_item_id: Option<Uuid>,
    ) -> Result<SemanticSnapshotView> {
        let semantics = match work_item_id {
            Some(work_item_id) => self.get_work_item_semantics(work_item_id).await?,
            None => WorkItemSemanticsView::default(),
        };
        let track_id = semantics.track.as_ref().map(|track| track.id);
        let track_path = semantics.track.map(|track| track.path).unwrap_or_default();
        Ok(SemanticSnapshotView {
            track_id,
            track_path,
            labels: semantics.labels,
            captured_at: Utc::now().to_rfc3339(),
            provenance: "captured".to_string(),
        })
    }
}

fn track_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Track> {
    Ok(Track {
        id: Uuid::parse_str(&row.get::<String, _>("id"))?,
        title: row.get("title"),
        normalized_title: row.get("normalized_title"),
        parent_track_id: row
            .get::<Option<String>, _>("parent_track_id")
            .and_then(|value| Uuid::parse_str(&value).ok()),
        created_at: parse_datetime(row.get("created_at"))?,
        updated_at: parse_datetime(row.get("updated_at"))?,
        archived_at: row
            .get::<Option<String>, _>("archived_at")
            .map(parse_datetime)
            .transpose()?,
    })
}

fn label_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Label> {
    Ok(Label {
        id: Uuid::parse_str(&row.get::<String, _>("id"))?,
        title: row.get("title"),
        normalized_title: row.get("normalized_title"),
        created_at: parse_datetime(row.get("created_at"))?,
        updated_at: parse_datetime(row.get("updated_at"))?,
        archived_at: row
            .get::<Option<String>, _>("archived_at")
            .map(parse_datetime)
            .transpose()?,
    })
}

fn parse_datetime(value: String) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(&value)?.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::domain::{
        ActivityZone, FocusSession, WorkItem, WorkItemEvent, WorkItemEventKind, WorkItemState,
        WorkItemType,
    };

    #[tokio::test]
    async fn snapshots_remain_stable_after_current_assignment_changes() {
        let directory = tempdir().unwrap();
        let database = Database::new(&directory.path().join("timeskein.db"))
            .await
            .unwrap();

        let root = Track::new("Work".to_string(), None);
        database.create_track(&root).await.unwrap();
        let child = Track::new("Timeskein".to_string(), Some(root.id));
        database.create_track(&child).await.unwrap();
        let label = Label::new("dogfood".to_string());
        database.create_label(&label).await.unwrap();
        let item = WorkItem::new(
            "Build semantic reports".to_string(),
            Some(WorkItemType::Task),
            Some(ActivityZone::Work),
            Some(WorkItemState::Unknown),
            None,
        );
        database.create_work_item(&item).await.unwrap();
        database
            .set_work_item_semantics(item.id, Some(child.id), &[label.id])
            .await
            .unwrap();

        let session =
            FocusSession::new(item.title.clone(), Some(item.id), ActivityZone::Work, None);
        database.create_focus_session(&session).await.unwrap();
        database
            .snapshot_focus_session_semantics(session.id, Some(item.id))
            .await
            .unwrap();
        let event = WorkItemEvent::new(
            item.id,
            WorkItemEventKind::NoteAdded,
            Some(serde_json::json!({"text": "A durable result"})),
        );
        database.log_event(&event).await.unwrap();
        database
            .snapshot_work_item_event_semantics(event.id, item.id)
            .await
            .unwrap();

        database
            .set_work_item_semantics(item.id, Some(root.id), &[])
            .await
            .unwrap();

        let focus_row = sqlx::query(
            "SELECT track_id, track_path_json, labels_json
             FROM focus_session_semantic_snapshots WHERE focus_session_id = ?1",
        )
        .bind(session.id.to_string())
        .fetch_one(database.pool())
        .await
        .unwrap();
        assert_eq!(focus_row.get::<String, _>("track_id"), child.id.to_string());
        let path: Vec<TrackPathNode> =
            serde_json::from_str(&focus_row.get::<String, _>("track_path_json")).unwrap();
        assert_eq!(path.last().unwrap().title, "Timeskein");
        let labels: Vec<LabelView> =
            serde_json::from_str(&focus_row.get::<String, _>("labels_json")).unwrap();
        assert_eq!(labels[0].title, "dogfood");

        let event_track_id: String = sqlx::query_scalar(
            "SELECT track_id FROM work_item_event_semantic_snapshots WHERE work_item_event_id = ?1",
        )
        .bind(event.id.to_string())
        .fetch_one(database.pool())
        .await
        .unwrap();
        assert_eq!(event_track_id, child.id.to_string());
    }

    #[tokio::test]
    async fn track_parent_validation_rejects_cycles() {
        let directory = tempdir().unwrap();
        let database = Database::new(&directory.path().join("timeskein.db"))
            .await
            .unwrap();
        let root = Track::new("Root".to_string(), None);
        database.create_track(&root).await.unwrap();
        let child = Track::new("Child".to_string(), Some(root.id));
        database.create_track(&child).await.unwrap();

        assert!(database
            .validate_track_parent(Some(root.id), Some(child.id))
            .await
            .is_err());
        assert!(database
            .validate_track_parent(Some(root.id), Some(root.id))
            .await
            .is_err());
    }
}
