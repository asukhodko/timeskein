//! Capture inbox repository.

use anyhow::Result;
use chrono::DateTime;
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{Capture, CaptureState};

impl Database {
    pub async fn create_capture(&self, capture: &Capture) -> Result<()> {
        sqlx::query(
            "INSERT INTO captures (
                id, text, state, work_item_id, focus_session_id,
                created_at, updated_at, resolved_at, converted_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .bind(capture.id.to_string())
        .bind(&capture.text)
        .bind(capture.state.as_str())
        .bind(capture.work_item_id.map(|id| id.to_string()))
        .bind(capture.focus_session_id.map(|id| id.to_string()))
        .bind(capture.created_at.to_rfc3339())
        .bind(capture.updated_at.to_rfc3339())
        .bind(capture.resolved_at.map(|value| value.to_rfc3339()))
        .bind(capture.converted_at.map(|value| value.to_rfc3339()))
        .execute(self.pool())
        .await?;

        Ok(())
    }

    pub async fn get_capture(&self, id: Uuid) -> Result<Option<Capture>> {
        let row = sqlx::query(
            "SELECT id, text, state, work_item_id, focus_session_id,
                    created_at, updated_at, resolved_at, converted_at
             FROM captures
             WHERE id = ?1",
        )
        .bind(id.to_string())
        .fetch_optional(self.pool())
        .await?;

        row.map(|row| capture_from_row(&row)).transpose()
    }

    pub async fn list_captures(&self, states: Option<&[CaptureState]>) -> Result<Vec<Capture>> {
        let mut sql = String::from(
            "SELECT id, text, state, work_item_id, focus_session_id,
                    created_at, updated_at, resolved_at, converted_at
             FROM captures",
        );

        if let Some(states) = states {
            if !states.is_empty() {
                let state_list = states
                    .iter()
                    .map(|state| format!("'{}'", state.as_str()))
                    .collect::<Vec<_>>()
                    .join(",");
                sql.push_str(&format!(" WHERE state IN ({})", state_list));
            }
        }

        sql.push_str(" ORDER BY datetime(created_at) DESC");

        let rows = sqlx::query(&sql).fetch_all(self.pool()).await?;

        rows.into_iter().map(|row| capture_from_row(&row)).collect()
    }

    pub async fn update_capture(&self, capture: &Capture) -> Result<()> {
        sqlx::query(
            "UPDATE captures
             SET text = ?2,
                 state = ?3,
                 work_item_id = ?4,
                 focus_session_id = ?5,
                 updated_at = ?6,
                 resolved_at = ?7,
                 converted_at = ?8
             WHERE id = ?1",
        )
        .bind(capture.id.to_string())
        .bind(&capture.text)
        .bind(capture.state.as_str())
        .bind(capture.work_item_id.map(|id| id.to_string()))
        .bind(capture.focus_session_id.map(|id| id.to_string()))
        .bind(capture.updated_at.to_rfc3339())
        .bind(capture.resolved_at.map(|value| value.to_rfc3339()))
        .bind(capture.converted_at.map(|value| value.to_rfc3339()))
        .execute(self.pool())
        .await?;

        Ok(())
    }

    pub async fn delete_capture(&self, id: Uuid) -> Result<bool> {
        let result = sqlx::query("DELETE FROM captures WHERE id = ?1")
            .bind(id.to_string())
            .execute(self.pool())
            .await?;

        Ok(result.rows_affected() > 0)
    }
}

fn capture_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Capture> {
    let id = Uuid::parse_str(&row.get::<String, _>("id"))?;
    let state =
        CaptureState::from_str(&row.get::<String, _>("state")).unwrap_or(CaptureState::Open);
    let work_item_id = row
        .get::<Option<String>, _>("work_item_id")
        .and_then(|value| Uuid::parse_str(&value).ok());
    let focus_session_id = row
        .get::<Option<String>, _>("focus_session_id")
        .and_then(|value| Uuid::parse_str(&value).ok());
    let created_at = DateTime::parse_from_rfc3339(&row.get::<String, _>("created_at"))?
        .with_timezone(&chrono::Utc);
    let updated_at = DateTime::parse_from_rfc3339(&row.get::<String, _>("updated_at"))?
        .with_timezone(&chrono::Utc);
    let resolved_at = row
        .get::<Option<String>, _>("resolved_at")
        .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
        .map(|value| value.with_timezone(&chrono::Utc));
    let converted_at = row
        .get::<Option<String>, _>("converted_at")
        .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
        .map(|value| value.with_timezone(&chrono::Utc));

    Ok(Capture {
        id,
        text: row.get("text"),
        state,
        work_item_id,
        focus_session_id,
        created_at,
        updated_at,
        resolved_at,
        converted_at,
    })
}
