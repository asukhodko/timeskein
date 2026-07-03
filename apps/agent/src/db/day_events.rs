//! Day-event repository.

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{ActivityZone, DayEvent, DayEventKind};

impl Database {
    pub async fn create_day_event(&self, event: &DayEvent) -> Result<()> {
        sqlx::query(
            "INSERT INTO day_events (id, ts, kind, text, focus_session_id, activity_zone, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(event.id.to_string())
        .bind(event.ts.to_rfc3339())
        .bind(event.kind.as_str())
        .bind(&event.text)
        .bind(event.focus_session_id.map(|id| id.to_string()))
        .bind(event.activity_zone.map(|zone| zone.as_str().to_string()))
        .bind(event.updated_at.to_rfc3339())
        .execute(self.pool())
        .await?;

        Ok(())
    }

    pub async fn list_day_events(
        &self,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
    ) -> Result<Vec<DayEvent>> {
        let rows = sqlx::query(
            "SELECT id, ts, kind, text, focus_session_id, activity_zone, updated_at
             FROM day_events
             WHERE (?1 IS NULL OR datetime(ts) >= datetime(?1))
               AND (?2 IS NULL OR datetime(ts) < datetime(?2))
             ORDER BY datetime(ts) ASC",
        )
        .bind(from.map(|value| value.to_rfc3339()))
        .bind(to.map(|value| value.to_rfc3339()))
        .fetch_all(self.pool())
        .await?;

        rows.into_iter()
            .map(|row| day_event_from_row(&row))
            .collect()
    }

    pub async fn get_day_event(&self, id: Uuid) -> Result<Option<DayEvent>> {
        let row = sqlx::query(
            "SELECT id, ts, kind, text, focus_session_id, activity_zone, updated_at
             FROM day_events
             WHERE id = ?1",
        )
        .bind(id.to_string())
        .fetch_optional(self.pool())
        .await?;

        row.map(|row| day_event_from_row(&row)).transpose()
    }

    pub async fn update_day_event(&self, event: &DayEvent) -> Result<()> {
        sqlx::query(
            "UPDATE day_events
             SET text = ?2,
                 activity_zone = ?3,
                 updated_at = ?4
             WHERE id = ?1",
        )
        .bind(event.id.to_string())
        .bind(&event.text)
        .bind(event.activity_zone.map(|zone| zone.as_str().to_string()))
        .bind(event.updated_at.to_rfc3339())
        .execute(self.pool())
        .await?;

        Ok(())
    }

    pub async fn delete_day_event(&self, id: Uuid) -> Result<bool> {
        let result = sqlx::query("DELETE FROM day_events WHERE id = ?1")
            .bind(id.to_string())
            .execute(self.pool())
            .await?;

        Ok(result.rows_affected() > 0)
    }
}

fn day_event_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<DayEvent> {
    let id = Uuid::parse_str(&row.get::<String, _>("id"))?;
    let ts = DateTime::parse_from_rfc3339(&row.get::<String, _>("ts"))?.with_timezone(&Utc);
    let updated_at =
        DateTime::parse_from_rfc3339(&row.get::<String, _>("updated_at"))?.with_timezone(&Utc);
    let kind =
        DayEventKind::from_str(&row.get::<String, _>("kind")).unwrap_or(DayEventKind::NoteAdded);
    let focus_session_id = row
        .get::<Option<String>, _>("focus_session_id")
        .and_then(|value| Uuid::parse_str(&value).ok());
    let activity_zone = row
        .get::<Option<String>, _>("activity_zone")
        .and_then(|value| ActivityZone::from_str(&value));

    Ok(DayEvent {
        id,
        ts,
        kind,
        text: row.get("text"),
        focus_session_id,
        activity_zone,
        updated_at,
    })
}
