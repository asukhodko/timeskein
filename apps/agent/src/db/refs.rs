//! Refs repository

use anyhow::Result;
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{Ref, RefKind, RefView, WorkItemRef, RefConflict, WorkItemEventKind, WorkItemEvent};

impl Database {
    /// Get refs for a work item
    pub async fn get_refs_for_work_item(&self, work_item_id: Uuid) -> Result<Vec<RefView>> {
        let rows = sqlx::query(
            "SELECT r.id, r.kind, r.value, wir.is_primary
             FROM refs r
             JOIN work_item_refs wir ON r.id = wir.ref_id
             WHERE wir.work_item_id = ?1
             ORDER BY wir.is_primary DESC, wir.created_at ASC"
        )
        .bind(work_item_id.to_string())
        .fetch_all(self.pool())
        .await?;

        let mut refs = Vec::new();
        for row in rows {
            let id_str: String = row.get("id");
            let id = Uuid::parse_str(&id_str)?;
            let kind_str: String = row.get("kind");
            let kind = RefKind::from_str(&kind_str).unwrap_or(RefKind::Custom);
            
            refs.push(RefView {
                id,
                kind: kind.as_str().to_string(),
                value: row.get("value"),
                is_primary: row.get("is_primary"),
            });
        }

        Ok(refs)
    }

    /// Check for ref conflict (ref already attached to another work item)
    pub async fn check_ref_conflict(&self, kind: RefKind, normalized_value: &str) -> Result<Option<RefConflict>> {
        let row = sqlx::query(
            "SELECT r.id, r.kind, r.value, wi.id as work_item_id, wi.title as work_item_title
             FROM refs r
             JOIN work_item_refs wir ON r.id = wir.ref_id
             JOIN work_items wi ON wir.work_item_id = wi.id
             WHERE r.kind = ?1 AND r.normalized_value = ?2 AND wi.deleted_at IS NULL"
        )
        .bind(kind.as_str())
        .bind(normalized_value)
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some(row) => {
                let work_item_id_str: String = row.get("work_item_id");
                let work_item_id = Uuid::parse_str(&work_item_id_str)?;
                
                Ok(Some(RefConflict {
                    existing_work_item_id: work_item_id,
                    existing_work_item_title: row.get("work_item_title"),
                    ref_kind: kind.as_str().to_string(),
                    ref_value: row.get("value"),
                }))
            }
            None => Ok(None),
        }
    }

    /// Add a ref to a work item
    pub async fn add_ref(&self, work_item_id: Uuid, ref_entity: &Ref, is_primary: bool) -> Result<()> {
        // Insert ref
        sqlx::query(
            "INSERT INTO refs (id, kind, value, normalized_value, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)"
        )
        .bind(ref_entity.id.to_string())
        .bind(ref_entity.kind.as_str())
        .bind(&ref_entity.value)
        .bind(&ref_entity.normalized_value)
        .bind(ref_entity.created_at.to_rfc3339())
        .execute(self.pool())
        .await?;

        // Link to work item
        let wir = WorkItemRef::new(work_item_id, ref_entity.id, is_primary);
        sqlx::query(
            "INSERT INTO work_item_refs (work_item_id, ref_id, is_primary, created_at)
             VALUES (?1, ?2, ?3, ?4)"
        )
        .bind(wir.work_item_id.to_string())
        .bind(wir.ref_id.to_string())
        .bind(wir.is_primary)
        .bind(wir.created_at.to_rfc3339())
        .execute(self.pool())
        .await?;

        // Log event
        let payload = serde_json::json!({
            "ref_id": ref_entity.id.to_string(),
            "kind": ref_entity.kind.as_str(),
            "value": ref_entity.value,
        });
        self.log_event(&WorkItemEvent::new(work_item_id, WorkItemEventKind::RefAttached, Some(payload))).await?;

        Ok(())
    }

    /// Remove a ref from a work item
    pub async fn remove_ref(&self, work_item_id: Uuid, ref_id: Uuid) -> Result<bool> {
        // Remove junction
        let result = sqlx::query(
            "DELETE FROM work_item_refs WHERE work_item_id = ?1 AND ref_id = ?2"
        )
        .bind(work_item_id.to_string())
        .bind(ref_id.to_string())
        .execute(self.pool())
        .await?;

        if result.rows_affected() == 0 {
            return Ok(false);
        }

        // Check if ref is still used by other work items
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM work_item_refs WHERE ref_id = ?1"
        )
        .bind(ref_id.to_string())
        .fetch_one(self.pool())
        .await?;

        // If orphaned, delete the ref
        if count == 0 {
            sqlx::query("DELETE FROM refs WHERE id = ?1")
                .bind(ref_id.to_string())
                .execute(self.pool())
                .await?;
        }

        // Log event
        let payload = serde_json::json!({
            "ref_id": ref_id.to_string(),
        });
        self.log_event(&WorkItemEvent::new(work_item_id, WorkItemEventKind::RefRemoved, Some(payload))).await?;

        Ok(true)
    }

    /// Get a ref by ID
    pub async fn get_ref(&self, ref_id: Uuid) -> Result<Option<Ref>> {
        let row = sqlx::query(
            "SELECT id, kind, value, normalized_value, created_at FROM refs WHERE id = ?1"
        )
        .bind(ref_id.to_string())
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some(row) => {
                let id_str: String = row.get("id");
                let id = Uuid::parse_str(&id_str)?;
                let kind_str: String = row.get("kind");
                let kind = RefKind::from_str(&kind_str).unwrap_or(RefKind::Custom);
                let created_at_str: String = row.get("created_at");
                let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)?
                    .with_timezone(&chrono::Utc);

                Ok(Some(Ref {
                    id,
                    kind,
                    value: row.get("value"),
                    normalized_value: row.get("normalized_value"),
                    created_at,
                }))
            }
            None => Ok(None),
        }
    }

    /// Check if work item has refs
    pub async fn has_refs(&self, work_item_id: Uuid) -> Result<bool> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM work_item_refs WHERE work_item_id = ?1"
        )
        .bind(work_item_id.to_string())
        .fetch_one(self.pool())
        .await?;

        Ok(count > 0)
    }

    /// Get primary ref for a work item (or first ref if no primary)
    pub async fn get_primary_ref(&self, work_item_id: Uuid) -> Result<Option<Ref>> {
        let row = sqlx::query(
            "SELECT r.id, r.kind, r.value, r.normalized_value, r.created_at
             FROM refs r
             JOIN work_item_refs wir ON r.id = wir.ref_id
             WHERE wir.work_item_id = ?1
             ORDER BY wir.is_primary DESC, wir.created_at ASC
             LIMIT 1"
        )
        .bind(work_item_id.to_string())
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some(row) => {
                let id_str: String = row.get("id");
                let id = Uuid::parse_str(&id_str)?;
                let kind_str: String = row.get("kind");
                let kind = RefKind::from_str(&kind_str).unwrap_or(RefKind::Custom);
                let created_at_str: String = row.get("created_at");
                let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)?
                    .with_timezone(&chrono::Utc);

                Ok(Some(Ref {
                    id,
                    kind,
                    value: row.get("value"),
                    normalized_value: row.get("normalized_value"),
                    created_at,
                }))
            }
            None => Ok(None),
        }
    }
}
