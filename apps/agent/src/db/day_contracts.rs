//! Persistence for append-only day-contract revisions.

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{
    DayContractRevision, DayContractRevisionKind, DayContractSubjectSnapshot,
    NewDayContractRevision,
};

impl Database {
    pub async fn append_day_contract_revision(
        &self,
        draft: NewDayContractRevision,
    ) -> Result<DayContractRevision> {
        let mut transaction = self.pool().begin().await?;
        let previous = sqlx::query(
            "SELECT id, revision_number
             FROM day_contract_revisions
             WHERE local_date = ?1
             ORDER BY revision_number DESC
             LIMIT 1",
        )
        .bind(&draft.local_date)
        .fetch_optional(&mut *transaction)
        .await?;
        let supersedes_id = previous
            .as_ref()
            .map(|row| Uuid::parse_str(&row.get::<String, _>("id")))
            .transpose()?;
        let revision_number = previous
            .as_ref()
            .map(|row| row.get::<i64, _>("revision_number") + 1)
            .unwrap_or(1);
        let id = Uuid::new_v4();
        let created_at = Utc::now();

        sqlx::query(
            "INSERT INTO day_contract_revisions (
                id, local_date, revision_number, revision_kind,
                active_subjects_json, first_action_work_item_id,
                first_action_snapshot_json, parked_subjects_json, why_now,
                created_at, source, provenance, supersedes_id, schema_version
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'user', 'confirmed', ?11, 1)",
        )
        .bind(id.to_string())
        .bind(&draft.local_date)
        .bind(revision_number)
        .bind(draft.revision_kind.as_str())
        .bind(serde_json::to_string(&draft.active_subjects)?)
        .bind(draft.first_action_work_item_id.to_string())
        .bind(serde_json::to_string(&draft.first_action)?)
        .bind(serde_json::to_string(&draft.parked_subjects)?)
        .bind(&draft.why_now)
        .bind(created_at.to_rfc3339())
        .bind(supersedes_id.map(|value| value.to_string()))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;

        Ok(DayContractRevision {
            id,
            local_date: draft.local_date,
            revision_number,
            revision_kind: draft.revision_kind,
            active_subjects: draft.active_subjects,
            first_action_work_item_id: draft.first_action_work_item_id,
            first_action: draft.first_action,
            parked_subjects: draft.parked_subjects,
            why_now: draft.why_now,
            created_at,
            source: "user".to_string(),
            provenance: "confirmed".to_string(),
            supersedes_id,
            schema_version: 1,
        })
    }

    pub async fn list_day_contract_revisions(
        &self,
        local_date: &str,
    ) -> Result<Vec<DayContractRevision>> {
        let rows = sqlx::query(
            "SELECT id, local_date, revision_number, revision_kind,
                    active_subjects_json, first_action_work_item_id,
                    first_action_snapshot_json, parked_subjects_json, why_now,
                    created_at, source, provenance, supersedes_id, schema_version
             FROM day_contract_revisions
             WHERE local_date = ?1
             ORDER BY revision_number ASC",
        )
        .bind(local_date)
        .fetch_all(self.pool())
        .await?;
        rows.iter().map(day_contract_from_row).collect()
    }

    pub async fn list_day_contract_revisions_range(
        &self,
        from: &str,
        to: &str,
    ) -> Result<Vec<DayContractRevision>> {
        let rows = sqlx::query(
            "SELECT id, local_date, revision_number, revision_kind,
                    active_subjects_json, first_action_work_item_id,
                    first_action_snapshot_json, parked_subjects_json, why_now,
                    created_at, source, provenance, supersedes_id, schema_version
             FROM day_contract_revisions
             WHERE local_date >= ?1 AND local_date < ?2
             ORDER BY local_date ASC, revision_number ASC",
        )
        .bind(from)
        .bind(to)
        .fetch_all(self.pool())
        .await?;
        rows.iter().map(day_contract_from_row).collect()
    }
}

fn day_contract_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<DayContractRevision> {
    Ok(DayContractRevision {
        id: Uuid::parse_str(&row.get::<String, _>("id"))?,
        local_date: row.get("local_date"),
        revision_number: row.get("revision_number"),
        revision_kind: DayContractRevisionKind::from_str(&row.get::<String, _>("revision_kind"))
            .ok_or_else(|| anyhow::anyhow!("Invalid day-contract revision kind"))?,
        active_subjects: serde_json::from_str::<Vec<DayContractSubjectSnapshot>>(
            &row.get::<String, _>("active_subjects_json"),
        )?,
        first_action_work_item_id: Uuid::parse_str(
            &row.get::<String, _>("first_action_work_item_id"),
        )?,
        first_action: serde_json::from_str::<DayContractSubjectSnapshot>(
            &row.get::<String, _>("first_action_snapshot_json"),
        )?,
        parked_subjects: serde_json::from_str::<Vec<DayContractSubjectSnapshot>>(
            &row.get::<String, _>("parked_subjects_json"),
        )?,
        why_now: row.get("why_now"),
        created_at: parse_datetime(row.get("created_at"))?,
        source: row.get("source"),
        provenance: row.get("provenance"),
        supersedes_id: row
            .get::<Option<String>, _>("supersedes_id")
            .map(|value| Uuid::parse_str(&value))
            .transpose()?,
        schema_version: row.get("schema_version"),
    })
}

fn parse_datetime(value: String) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(&value)?.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::domain::{DayContractSubjectKind, WorkItemState};

    fn snapshot(id: Uuid, title: &str) -> DayContractSubjectSnapshot {
        DayContractSubjectSnapshot {
            kind: DayContractSubjectKind::WorkItem,
            subject_id: id,
            title: title.to_string(),
            work_item_id: Some(id),
            track_id: None,
            state: WorkItemState::Unknown.as_str().to_string(),
            state_provenance: "legacy_current".to_string(),
            state_record_id: None,
            next_action: None,
            last_significant_change: None,
            track_path: vec![],
            labels: vec![],
            captured_at: Utc::now().to_rfc3339(),
        }
    }

    #[tokio::test]
    async fn appends_revisions_without_rewriting_previous_snapshot() {
        let directory = tempdir().unwrap();
        let database = Database::new(&directory.path().join("timeskein.db"))
            .await
            .unwrap();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let parked = Uuid::new_v4();

        let revision_one = database
            .append_day_contract_revision(NewDayContractRevision {
                local_date: "2026-07-17".to_string(),
                revision_kind: DayContractRevisionKind::Morning,
                active_subjects: vec![snapshot(first, "One"), snapshot(second, "Two")],
                first_action_work_item_id: first,
                first_action: snapshot(first, "One"),
                parked_subjects: vec![snapshot(parked, "Parked")],
                why_now: "Morning choice".to_string(),
            })
            .await
            .unwrap();
        database
            .append_day_contract_revision(NewDayContractRevision {
                local_date: "2026-07-17".to_string(),
                revision_kind: DayContractRevisionKind::Adjustment,
                active_subjects: vec![snapshot(first, "One renamed"), snapshot(second, "Two")],
                first_action_work_item_id: second,
                first_action: snapshot(second, "Two"),
                parked_subjects: vec![snapshot(parked, "Parked")],
                why_now: "Changed after new evidence".to_string(),
            })
            .await
            .unwrap();

        let revisions = database
            .list_day_contract_revisions("2026-07-17")
            .await
            .unwrap();
        assert_eq!(revisions.len(), 2);
        assert_eq!(revisions[0].id, revision_one.id);
        assert_eq!(revisions[0].active_subjects[0].title, "One");
        assert_eq!(revisions[1].revision_number, 2);
        assert_eq!(revisions[1].supersedes_id, Some(revision_one.id));
    }
}
