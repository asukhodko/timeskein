//! App-event telemetry repository.

use anyhow::Result;
use chrono::DateTime;
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{AppEvent, AppEventKind, AppEventSource};

impl Database {
    pub async fn log_app_event(&self, event: &AppEvent) -> Result<()> {
        sqlx::query(
            "INSERT INTO app_events (id, ts, source, kind, work_item_id, focus_session_id, payload)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(event.id.to_string())
        .bind(event.ts.to_rfc3339())
        .bind(event.source.as_str())
        .bind(event.kind.as_str())
        .bind(event.work_item_id.map(|id| id.to_string()))
        .bind(event.focus_session_id.map(|id| id.to_string()))
        .bind(event.payload.as_ref().map(|payload| payload.to_string()))
        .execute(self.pool())
        .await?;

        Ok(())
    }

    pub async fn list_app_events(
        &self,
        from: Option<DateTime<chrono::Utc>>,
        to: Option<DateTime<chrono::Utc>>,
    ) -> Result<Vec<AppEvent>> {
        let rows = sqlx::query(
            "SELECT id, ts, source, kind, work_item_id, focus_session_id, payload
             FROM app_events
             WHERE (?1 IS NULL OR datetime(ts) >= datetime(?1))
               AND (?2 IS NULL OR datetime(ts) < datetime(?2))
             ORDER BY datetime(ts) ASC",
        )
        .bind(from.map(|value| value.to_rfc3339()))
        .bind(to.map(|value| value.to_rfc3339()))
        .fetch_all(self.pool())
        .await?;

        rows.into_iter()
            .map(|row| app_event_from_row(&row))
            .collect()
    }
}

fn app_event_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<AppEvent> {
    let id = Uuid::parse_str(&row.get::<String, _>("id"))?;
    let ts = DateTime::parse_from_rfc3339(&row.get::<String, _>("ts"))?.with_timezone(&chrono::Utc);
    let source =
        AppEventSource::from_str(&row.get::<String, _>("source")).unwrap_or(AppEventSource::System);
    let kind =
        AppEventKind::from_str(&row.get::<String, _>("kind")).unwrap_or(AppEventKind::ApiError);
    let work_item_id = row
        .get::<Option<String>, _>("work_item_id")
        .and_then(|value| Uuid::parse_str(&value).ok());
    let focus_session_id = row
        .get::<Option<String>, _>("focus_session_id")
        .and_then(|value| Uuid::parse_str(&value).ok());
    let payload = row
        .get::<Option<String>, _>("payload")
        .and_then(|value| serde_json::from_str(&value).ok());

    Ok(AppEvent {
        id,
        ts,
        source,
        kind,
        work_item_id,
        focus_session_id,
        payload,
    })
}
