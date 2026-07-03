//! Work Items repository

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{
    ActivityZone, WorkItem, WorkItemEvent, WorkItemEventKind, WorkItemState, WorkItemType,
};

impl Database {
    /// List all work items (not deleted), sorted by pinned, state priority, last_seen
    pub async fn list_work_items(
        &self,
        search: Option<&str>,
        state_filter: Option<&[WorkItemState]>,
    ) -> Result<Vec<WorkItem>> {
        let mut sql = String::from(
            "SELECT id, title, type, activity_zone, state, pinned, note, created_at, updated_at, last_seen_at, deleted_at
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
                let state_list: Vec<String> =
                    states.iter().map(|s| format!("'{}'", s.as_str())).collect();
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
                COALESCE(last_seen_at, '1970-01-01') DESC",
        );

        let rows = if let Some(search_term) = search {
            sqlx::query(&sql)
                .bind(search_term)
                .fetch_all(self.pool())
                .await?
        } else {
            sqlx::query(&sql).fetch_all(self.pool()).await?
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
            "SELECT id, title, type, activity_zone, state, pinned, note, created_at, updated_at, last_seen_at, deleted_at
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

    /// Find a non-deleted work item by normalized title.
    pub async fn find_work_item_by_title(&self, title: &str) -> Result<Option<WorkItem>> {
        let title = title.trim();
        if title.is_empty() {
            return Ok(None);
        }

        let row = sqlx::query(
            "SELECT id, title, type, activity_zone, state, pinned, note, created_at, updated_at, last_seen_at, deleted_at
             FROM work_items
             WHERE deleted_at IS NULL
               AND lower(trim(title)) = lower(trim(?1))
             ORDER BY updated_at DESC
             LIMIT 1",
        )
        .bind(title)
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
            "INSERT INTO work_items (id, title, type, activity_zone, state, pinned, note, created_at, updated_at, last_seen_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
        )
        .bind(item.id.to_string())
        .bind(&item.title)
        .bind(item.item_type.map(|t| t.as_str()))
        .bind(item.activity_zone.as_str())
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
        self.log_event(&WorkItemEvent::new(
            item.id,
            WorkItemEventKind::Created,
            None,
        ))
        .await?;

        Ok(())
    }

    /// Update a work item
    pub async fn update_work_item(&self, item: &WorkItem) -> Result<()> {
        sqlx::query(
            "UPDATE work_items
             SET title = ?2, type = ?3, activity_zone = ?4, state = ?5, pinned = ?6, note = ?7,
                 updated_at = ?8, last_seen_at = ?9, deleted_at = ?10
             WHERE id = ?1",
        )
        .bind(item.id.to_string())
        .bind(&item.title)
        .bind(item.item_type.map(|t| t.as_str()))
        .bind(item.activity_zone.as_str())
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

    /// Demote active work items, optionally keeping one item active.
    pub async fn clear_active_work_items_except(
        &self,
        keep_id: Option<Uuid>,
        replacement_state: WorkItemState,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "UPDATE work_items
             SET state = ?1, updated_at = ?2, last_seen_at = ?2
             WHERE state = 'active'
               AND deleted_at IS NULL
               AND (?3 IS NULL OR id != ?3)",
        )
        .bind(replacement_state.as_str())
        .bind(now)
        .bind(keep_id.map(|id| id.to_string()))
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Align legacy work item state with the focus-session invariant.
    pub async fn normalize_active_work_items_for_focus(&self) -> Result<()> {
        let active_work_item_id: Option<String> = sqlx::query_scalar(
            "SELECT wi.id
             FROM focus_sessions fs
             JOIN work_items wi ON wi.id = fs.work_item_id
             WHERE fs.state = 'active'
               AND wi.deleted_at IS NULL
             ORDER BY fs.started_at DESC
             LIMIT 1",
        )
        .fetch_optional(self.pool())
        .await?;

        let keep_id = active_work_item_id
            .as_deref()
            .and_then(|id| Uuid::parse_str(id).ok());

        if keep_id.is_none() {
            let now = chrono::Utc::now().to_rfc3339();
            sqlx::query(
                "UPDATE focus_sessions
                 SET state = 'stopped',
                     stopped_at = COALESCE(stopped_at, ?1),
                     updated_at = ?1,
                     note = COALESCE(note, 'stopped on startup: linked work item is unavailable')
                 WHERE state = 'active'",
            )
            .bind(&now)
            .execute(self.pool())
            .await?;
        }

        self.clear_active_work_items_except(keep_id, WorkItemState::Unknown)
            .await?;

        if let Some(id) = active_work_item_id {
            let now = chrono::Utc::now().to_rfc3339();
            sqlx::query(
                "UPDATE work_items
                 SET state = 'active', updated_at = ?2, last_seen_at = ?2
                 WHERE id = ?1 AND deleted_at IS NULL",
            )
            .bind(id)
            .bind(now)
            .execute(self.pool())
            .await?;
        }

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
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM work_items WHERE deleted_at IS NULL")
                .fetch_one(self.pool())
                .await?;

        Ok(count)
    }

    /// Aggregate focus seconds by Work Item over an optional time window.
    pub async fn work_item_focus_totals(
        &self,
        from: Option<chrono::DateTime<chrono::Utc>>,
        to: Option<chrono::DateTime<chrono::Utc>>,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<std::collections::HashMap<Uuid, i64>> {
        let sessions = self.list_focus_sessions(from, to, now).await?;
        let mut totals = std::collections::HashMap::new();

        for (session, _, _) in sessions {
            let Some(work_item_id) = session.work_item_id else {
                continue;
            };

            let started_at = from
                .map(|from| session.started_at.max(from))
                .unwrap_or(session.started_at);
            let stopped_at = to
                .map(|to| session.stopped_at.unwrap_or(now).min(to))
                .unwrap_or_else(|| session.stopped_at.unwrap_or(now));
            let active_seconds = (stopped_at - started_at).num_seconds().max(0);

            *totals.entry(work_item_id).or_insert(0) += active_seconds;
        }

        Ok(totals)
    }

    /// Log a work item event
    pub async fn log_event(&self, event: &WorkItemEvent) -> Result<()> {
        sqlx::query(
            "INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)",
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

    /// List Work Item events, optionally scoped by item and time window.
    pub async fn list_work_item_events(
        &self,
        work_item_id: Option<Uuid>,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
    ) -> Result<Vec<WorkItemEvent>> {
        let mut sql = String::from(
            "SELECT id, ts, work_item_id, kind, payload
             FROM work_item_events
             WHERE 1 = 1",
        );

        if work_item_id.is_some() {
            sql.push_str(" AND work_item_id = ?");
        }
        if from.is_some() {
            sql.push_str(" AND datetime(ts) >= datetime(?)");
        }
        if to.is_some() {
            sql.push_str(" AND datetime(ts) < datetime(?)");
        }
        sql.push_str(" ORDER BY datetime(ts) ASC");

        let mut query = sqlx::query(&sql);
        if let Some(work_item_id) = work_item_id {
            query = query.bind(work_item_id.to_string());
        }
        if let Some(from) = from {
            query = query.bind(from.to_rfc3339());
        }
        if let Some(to) = to {
            query = query.bind(to.to_rfc3339());
        }

        let rows = query.fetch_all(self.pool()).await?;

        rows.iter().map(work_item_event_from_row).collect()
    }

    /// Get a Work Item event by ID.
    pub async fn get_work_item_event(&self, id: Uuid) -> Result<Option<WorkItemEvent>> {
        let row = sqlx::query(
            "SELECT id, ts, work_item_id, kind, payload
             FROM work_item_events
             WHERE id = ?1",
        )
        .bind(id.to_string())
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some(row) => Ok(Some(work_item_event_from_row(&row)?)),
            None => Ok(None),
        }
    }

    /// Update a Work Item event payload.
    pub async fn update_work_item_event(&self, event: &WorkItemEvent) -> Result<()> {
        sqlx::query(
            "UPDATE work_item_events
             SET payload = ?2
             WHERE id = ?1",
        )
        .bind(event.id.to_string())
        .bind(event.payload.as_ref().map(|payload| payload.to_string()))
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Delete a Work Item event.
    pub async fn delete_work_item_event(&self, id: Uuid) -> Result<bool> {
        let result = sqlx::query("DELETE FROM work_item_events WHERE id = ?1")
            .bind(id.to_string())
            .execute(self.pool())
            .await?;

        Ok(result.rows_affected() > 0)
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

    let activity_zone_str: Option<String> = row.try_get("activity_zone").ok();
    let activity_zone = activity_zone_str
        .as_deref()
        .and_then(ActivityZone::from_str)
        .unwrap_or_default();

    let created_at_str: String = row.get("created_at");
    let created_at = DateTime::parse_from_rfc3339(&created_at_str)?.with_timezone(&chrono::Utc);

    let updated_at_str: String = row.get("updated_at");
    let updated_at = DateTime::parse_from_rfc3339(&updated_at_str)?.with_timezone(&chrono::Utc);

    let last_seen_at: Option<chrono::DateTime<chrono::Utc>> = row
        .get::<Option<String>, _>("last_seen_at")
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    let deleted_at: Option<chrono::DateTime<chrono::Utc>> = row
        .get::<Option<String>, _>("deleted_at")
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    Ok(WorkItem {
        id,
        title: row.get("title"),
        item_type,
        activity_zone,
        state,
        pinned: row.get("pinned"),
        note: row.get("note"),
        created_at,
        updated_at,
        last_seen_at,
        deleted_at,
    })
}

fn work_item_event_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<WorkItemEvent> {
    let id_str: String = row.get("id");
    let work_item_id_str: String = row.get("work_item_id");
    let ts_str: String = row.get("ts");
    let kind_str: String = row.get("kind");
    let payload_str: Option<String> = row.get("payload");

    Ok(WorkItemEvent {
        id: Uuid::parse_str(&id_str)?,
        ts: DateTime::parse_from_rfc3339(&ts_str)?.with_timezone(&Utc),
        work_item_id: Uuid::parse_str(&work_item_id_str)?,
        kind: WorkItemEventKind::from_str(&kind_str).unwrap_or(WorkItemEventKind::Updated),
        payload: payload_str
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?,
    })
}
