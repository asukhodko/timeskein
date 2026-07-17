//! Repositories for typed evidence and immutable Ref snapshots.

use anyhow::{anyhow, Result};
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{EvidenceEntryView, EvidenceKind, EvidenceRefSnapshotView, RefKind};

impl Database {
    pub async fn create_evidence_entry(
        &self,
        event_id: Uuid,
        work_item_id: Uuid,
        kind: EvidenceKind,
        focus_session_id: Option<Uuid>,
        ref_ids: &[Uuid],
    ) -> Result<EvidenceEntryView> {
        let captured_at = Utc::now().to_rfc3339();
        let mut transaction = self.pool().begin().await?;

        sqlx::query(
            "INSERT INTO evidence_entries
                (work_item_event_id, evidence_kind, focus_session_id, captured_at)
             VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(event_id.to_string())
        .bind(kind.as_str())
        .bind(focus_session_id.map(|id| id.to_string()))
        .bind(&captured_at)
        .execute(&mut *transaction)
        .await?;

        let mut snapshots = Vec::with_capacity(ref_ids.len());
        for ref_id in ref_ids {
            let row = sqlx::query(
                "SELECT r.kind, r.value
                   FROM refs r
                   JOIN work_item_refs wir ON wir.ref_id = r.id
                  WHERE r.id = ?1 AND wir.work_item_id = ?2",
            )
            .bind(ref_id.to_string())
            .bind(work_item_id.to_string())
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or_else(|| anyhow!("Ref is not attached to the Work Item"))?;

            let snapshot_id = Uuid::new_v4();
            let ref_kind: String = row.get("kind");
            let ref_value: String = row.get("value");
            sqlx::query(
                "INSERT INTO evidence_ref_snapshots
                    (id, work_item_event_id, ref_id, ref_kind, ref_value, captured_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(snapshot_id.to_string())
            .bind(event_id.to_string())
            .bind(ref_id.to_string())
            .bind(&ref_kind)
            .bind(&ref_value)
            .bind(&captured_at)
            .execute(&mut *transaction)
            .await?;

            snapshots.push(EvidenceRefSnapshotView {
                id: snapshot_id,
                ref_id: Some(*ref_id),
                kind: ref_kind,
                value: ref_value,
                captured_at: captured_at.clone(),
                provenance: "captured".to_string(),
            });
        }

        transaction.commit().await?;
        Ok(EvidenceEntryView {
            kind: kind.as_str().to_string(),
            focus_session_id,
            refs: snapshots,
            captured_at,
            provenance: "captured".to_string(),
        })
    }

    pub async fn get_evidence_entry(&self, event_id: Uuid) -> Result<Option<EvidenceEntryView>> {
        let row = sqlx::query(
            "SELECT evidence_kind, focus_session_id, captured_at
               FROM evidence_entries
              WHERE work_item_event_id = ?1",
        )
        .bind(event_id.to_string())
        .fetch_optional(self.pool())
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };
        let focus_session_id = row
            .get::<Option<String>, _>("focus_session_id")
            .and_then(|value| Uuid::parse_str(&value).ok());
        let captured_at: String = row.get("captured_at");
        let ref_rows = sqlx::query(
            "SELECT id, ref_id, ref_kind, ref_value, captured_at
               FROM evidence_ref_snapshots
              WHERE work_item_event_id = ?1
              ORDER BY datetime(captured_at), id",
        )
        .bind(event_id.to_string())
        .fetch_all(self.pool())
        .await?;
        let refs = ref_rows
            .into_iter()
            .map(|row| {
                Ok(EvidenceRefSnapshotView {
                    id: Uuid::parse_str(&row.get::<String, _>("id"))?,
                    ref_id: row
                        .get::<Option<String>, _>("ref_id")
                        .and_then(|value| Uuid::parse_str(&value).ok()),
                    kind: row.get("ref_kind"),
                    value: row.get("ref_value"),
                    captured_at: row.get("captured_at"),
                    provenance: "captured".to_string(),
                })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(Some(EvidenceEntryView {
            kind: row.get("evidence_kind"),
            focus_session_id,
            refs,
            captured_at,
            provenance: "captured".to_string(),
        }))
    }

    pub async fn update_evidence_kind(&self, event_id: Uuid, kind: EvidenceKind) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE evidence_entries SET evidence_kind = ?2 WHERE work_item_event_id = ?1",
        )
        .bind(event_id.to_string())
        .bind(kind.as_str())
        .execute(self.pool())
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn ref_is_attached_to_work_item(
        &self,
        work_item_id: Uuid,
        ref_id: Uuid,
    ) -> Result<bool> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM work_item_refs WHERE work_item_id = ?1 AND ref_id = ?2",
        )
        .bind(work_item_id.to_string())
        .bind(ref_id.to_string())
        .fetch_one(self.pool())
        .await?;
        Ok(count > 0)
    }

    pub async fn find_ref_id_by_normalized(
        &self,
        kind: RefKind,
        normalized_value: &str,
    ) -> Result<Option<Uuid>> {
        let value: Option<String> = sqlx::query_scalar(
            "SELECT id FROM refs WHERE kind = ?1 AND normalized_value = ?2 LIMIT 1",
        )
        .bind(kind.as_str())
        .bind(normalized_value)
        .fetch_optional(self.pool())
        .await?;
        value
            .map(|id| Uuid::parse_str(&id).map_err(Into::into))
            .transpose()
    }
}
