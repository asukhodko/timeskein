//! Work Items repository

use anyhow::Result;
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{WorkItem, WorkItemState, WorkItemType, WorkItemEvent, WorkItemEventKind};

impl Database {
    /// List all work items (not deleted), sorted by pinned, state priority, last_seen
    pub async fn list_work_items(&self, search: Option<&str>, state_filter: Option<&[WorkItemState]>) -> Result<Vec<WorkItem>> {
        let mut sql = String::from(
            "SELECT id, title, type, state, pinned, note, created_at, updated_at, last_seen_at, deleted_at 
             FROM work_items 
             WHERE deleted_at IS NULL"
        );

        // Add search filter
        if search.is_some() {
            sql.push_str(" AND (title LIKE '%' || ?1 || '%' OR note LIKE '%' || ?1 || '%')");
        }

        // Add state filter
        if let Some(states) = state_filter {
            if !states.is_empty() {
                let state_list: Vec<String> = states.iter().map(|s| format!("'{}'", s.as_str())).collect();
                sql.push_str(&format!(" AND state IN ({})", state_list.join(",")));
            }
        }

        // Sort: pinned DESC, state priority, last_seen DESC
        sql.push_str(
            " ORDER BY pinned DESC, 
                CASE state 
                    WHEN 'active' THEN 1 
                    WHEN 'blocked' THEN 2 
                    WHEN 'waiting' THEN 3 
                    WHEN 'unknown' THEN 4 
                    WHEN 'someday' THEN 5 
                    WHEN 'done' THEN 6 
                END,
                COALESCE(last_seen_at, '1970-01-01') DESC"
        );

        let rows = if let Some(search_term) = search {
            sqlx::query(&sql)
                .bind(search_term)
                .fetch_all(self.pool())
                .await?
        } else {
            sqlx::query(&sql)
                .fetch_all(self.pool())
                .await?
        };

        let mut items = Vec::new();
        for row in rows {
            items.push(work_item_from_row(&row)?);
        }

        Ok(items)
    }

    /// Get a single work item by ID
    pub async fn get_work_item(&self, id: Uuid) -> Result<Option<WorkItem>> {
        let row = sqlx::query(
            "SELECT id, title, type, state, pinned, note, created_at, updated_at, last_seen_at, deleted_at 
             FROM work_items 
             WHERE id = ?1 AND deleted_at IS NULL"
        )
        .bind(id.to_string())
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some(row) => Ok(Some(work_item_from_row(&row)?)),
            None => Ok(None),
        }
    }

    /// Create a new work item
    pub async fn create_work_item(&self, item: &WorkItem) -> Result<()> {
        sqlx::query(
            "INSERT INTO work_items (id, title, type, state, pinned, note, created_at, updated_at, last_seen_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        )
        .bind(item.id.to_string())
        .bind(&item.title)
        .bind(item.item_type.map(|t| t.as_str()))
        .bind(item.state.as_str())
        .bind(item.pinned)
        .bind(&item.note)
        .bind(item.created_at.to_rfc3339())
        .bind(item.updated_at.to_rfc3339())
        .bind(item.last_seen_at.map(|dt| dt.to_rfc3339()))
        .bind(item.deleted_at.map(|dt| dt.to_rfc3339()))
        .execute(self.pool())
        .await?;

        // Log event
        self.log_event(&WorkItemEvent::new(item.id, WorkItemEventKind::Created, None)).await?;

        Ok(())
    }

    /// Update a work item
    pub async fn update_work_item(&self, item: &WorkItem) -> Result<()> {
        sqlx::query(
            "UPDATE work_items 
             SET title = ?2, type = ?3, state = ?4, pinned = ?5, note = ?6, 
                 updated_at = ?7, last_seen_at = ?8, deleted_at = ?9
             WHERE id = ?1"
        )
        .bind(item.id.to_string())
        .bind(&item.title)
        .bind(item.item_type.map(|t| t.as_str()))
        .bind(item.state.as_str())
        .bind(item.pinned)
        .bind(&item.note)
        .bind(item.updated_at.to_rfc3339())
        .bind(item.last_seen_at.map(|dt| dt.to_rfc3339()))
        .bind(item.deleted_at.map(|dt| dt.to_rfc3339()))
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Delete a work item (hard delete)
    pub async fn delete_work_item(&self, id: Uuid) -> Result<bool> {
        let result = sqlx::query("DELETE FROM work_items WHERE id = ?1")
            .bind(id.to_string())
            .execute(self.pool())
            .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Count work items
    pub async fn count_work_items(&self) -> Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM work_items WHERE deleted_at IS NULL"
        )
        .fetch_one(self.pool())
        .await?;

        Ok(count)
    }

    /// Log a work item event
    pub async fn log_event(&self, event: &WorkItemEvent) -> Result<()> {
        sqlx::query(
            "INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)"
        )
        .bind(event.id.to_string())
        .bind(event.ts.to_rfc3339())
        .bind(event.work_item_id.to_string())
        .bind(event.kind.as_str())
        .bind(event.payload.as_ref().map(|p| p.to_string()))
        .execute(self.pool())
        .await?;

        Ok(())
    }
}

/// Parse a work item from a database row
fn work_item_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<WorkItem> {
    use chrono::DateTime;

    let id_str: String = row.get("id");
    let id = Uuid::parse_str(&id_str)?;

    let state_str: String = row.get("state");
    let state = WorkItemState::from_str(&state_str).unwrap_or_default();

    let type_str: Option<String> = row.get("type");
    let item_type = type_str.and_then(|s| WorkItemType::from_str(&s));

    let created_at_str: String = row.get("created_at");
    let created_at = DateTime::parse_from_rfc3339(&created_at_str)?.with_timezone(&chrono::Utc);

    let updated_at_str: String = row.get("updated_at");
    let updated_at = DateTime::parse_from_rfc3339(&updated_at_str)?.with_timezone(&chrono::Utc);

    let last_seen_at: Option<chrono::DateTime<chrono::Utc>> = row.get::<Option<String>, _>("last_seen_at")
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    let deleted_at: Option<chrono::DateTime<chrono::Utc>> = row.get::<Option<String>, _>("deleted_at")
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    Ok(WorkItem {
        id,
        title: row.get("title"),
        item_type,
        state,
        pinned: row.get("pinned"),
        note: row.get("note"),
        created_at,
        updated_at,
        last_seen_at,
        deleted_at,
    })
}
