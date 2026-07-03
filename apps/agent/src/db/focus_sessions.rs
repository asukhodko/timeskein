//! Focus sessions repository.

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{ActivityZone, FocusSession, FocusSessionState};

impl Database {
    /// Create a focus session. SQLite enforces at most one active session.
    pub async fn create_focus_session(&self, session: &FocusSession) -> Result<()> {
        sqlx::query(
            "INSERT INTO focus_sessions (
                id, title, work_item_id, activity_zone, state, target_seconds, note, started_at, stopped_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        )
        .bind(session.id.to_string())
        .bind(&session.title)
        .bind(session.work_item_id.map(|id| id.to_string()))
        .bind(session.activity_zone.as_str())
        .bind(session.state.as_str())
        .bind(session.target_seconds)
        .bind(&session.note)
        .bind(session.started_at.to_rfc3339())
        .bind(session.stopped_at.map(|dt| dt.to_rfc3339()))
        .bind(session.updated_at.to_rfc3339())
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Return the currently active focus session, if any.
    pub async fn get_active_focus_session(&self) -> Result<Option<(FocusSession, Option<String>)>> {
        let sql = focus_session_select_sql("WHERE fs.state = 'active' LIMIT 1");
        let row = sqlx::query(&sql).fetch_optional(self.pool()).await?;

        row.map(|row| focus_session_from_row(&row)).transpose()
    }

    /// Return a focus session by ID.
    pub async fn get_focus_session(
        &self,
        id: Uuid,
    ) -> Result<Option<(FocusSession, Option<String>)>> {
        let sql = focus_session_select_sql("WHERE fs.id = ?1");
        let row = sqlx::query(&sql)
            .bind(id.to_string())
            .fetch_optional(self.pool())
            .await?;

        row.map(|row| focus_session_from_row(&row)).transpose()
    }

    /// List focus sessions in a time window, oldest first.
    pub async fn list_focus_sessions(
        &self,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Result<Vec<(FocusSession, Option<String>)>> {
        let sql = focus_session_select_sql(
            "WHERE (?1 IS NULL OR julianday(COALESCE(fs.stopped_at, ?3)) > julianday(?1))
             AND (?2 IS NULL OR julianday(fs.started_at) < julianday(?2))
             ORDER BY fs.started_at ASC",
        );
        let rows = sqlx::query(&sql)
            .bind(from.map(|dt| dt.to_rfc3339()))
            .bind(to.map(|dt| dt.to_rfc3339()))
            .bind(now.to_rfc3339())
            .fetch_all(self.pool())
            .await?;

        rows.iter().map(focus_session_from_row).collect()
    }

    /// Persist a stopped focus session.
    pub async fn update_focus_session(&self, session: &FocusSession) -> Result<()> {
        sqlx::query(
            "UPDATE focus_sessions
             SET title = ?2,
                 work_item_id = ?3,
                 activity_zone = ?4,
                 state = ?5,
                 target_seconds = ?6,
                 note = ?7,
                 started_at = ?8,
                 stopped_at = ?9,
                 updated_at = ?10
             WHERE id = ?1",
        )
        .bind(session.id.to_string())
        .bind(&session.title)
        .bind(session.work_item_id.map(|id| id.to_string()))
        .bind(session.activity_zone.as_str())
        .bind(session.state.as_str())
        .bind(session.target_seconds)
        .bind(&session.note)
        .bind(session.started_at.to_rfc3339())
        .bind(session.stopped_at.map(|dt| dt.to_rfc3339()))
        .bind(session.updated_at.to_rfc3339())
        .execute(self.pool())
        .await?;

        Ok(())
    }
}

fn focus_session_select_sql(where_clause: &str) -> String {
    format!(
        "SELECT
            fs.id,
            fs.title,
            fs.work_item_id,
            fs.activity_zone,
            fs.state,
            fs.target_seconds,
            fs.note,
            fs.started_at,
            fs.stopped_at,
            fs.updated_at,
            wi.title AS work_item_title
         FROM focus_sessions fs
         LEFT JOIN work_items wi ON wi.id = fs.work_item_id
         {where_clause}"
    )
}

fn focus_session_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<(FocusSession, Option<String>)> {
    let id = Uuid::parse_str(&row.get::<String, _>("id"))?;
    let work_item_id = row
        .get::<Option<String>, _>("work_item_id")
        .and_then(|value| Uuid::parse_str(&value).ok());

    let state = FocusSessionState::from_str(&row.get::<String, _>("state"))
        .unwrap_or(FocusSessionState::Stopped);
    let activity_zone_str: String = row.get("activity_zone");
    let activity_zone = ActivityZone::from_str(&activity_zone_str).unwrap_or_default();

    let started_at =
        DateTime::parse_from_rfc3339(&row.get::<String, _>("started_at"))?.with_timezone(&Utc);
    let stopped_at = row
        .get::<Option<String>, _>("stopped_at")
        .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
        .map(|dt| dt.with_timezone(&Utc));
    let updated_at =
        DateTime::parse_from_rfc3339(&row.get::<String, _>("updated_at"))?.with_timezone(&Utc);

    let session = FocusSession {
        id,
        title: row.get("title"),
        work_item_id,
        activity_zone,
        state,
        target_seconds: row.get("target_seconds"),
        note: row.get("note"),
        started_at,
        stopped_at,
        updated_at,
    };

    Ok((session, row.get("work_item_title")))
}
