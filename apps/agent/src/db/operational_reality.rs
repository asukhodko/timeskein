//! Persistence and deterministic projection for the causal work spine.

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::{anyhow, Result};
use chrono::{DateTime, Duration, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{
    CaptureState, CausalProvenance, CausalRecord, CausalRecordKind, CausalRecordView, CausalSource,
    EvidenceRefSnapshotView, LabelView, NewCausalRecord, NextActionStatus,
    OperationalNextActionView, OperationalRealityBasisView, OperationalRealityItemView,
    OperationalRealitySummaryView, OperationalRealityView, OperationalState,
    OperationalSubjectKind, TrackPathNode, WorkItemState,
};

#[derive(Debug, Clone)]
struct EvidenceFact {
    work_item_id: Uuid,
    event_id: Uuid,
    kind: String,
    text: String,
    occurred_at: DateTime<Utc>,
    refs: Vec<EvidenceRefSnapshotView>,
}

#[derive(Debug, Clone)]
struct ReflectionFact {
    id: Uuid,
    work_item_id: Option<Uuid>,
    track_id: Option<Uuid>,
    subject: String,
    decision: String,
    note: Option<String>,
    occurred_at: DateTime<Utc>,
    track_path: Vec<TrackPathNode>,
}

impl Database {
    pub async fn create_causal_record(&self, draft: NewCausalRecord) -> Result<CausalRecord> {
        if !(0.0..=1.0).contains(&draft.confidence) {
            return Err(anyhow!("Causal confidence must be between 0 and 1"));
        }

        if let Some(supersedes_id) = draft.supersedes_id {
            let previous = self
                .get_causal_record(supersedes_id)
                .await?
                .ok_or_else(|| anyhow!("Superseded causal record not found"))?;
            if previous.subject_kind != draft.subject_kind
                || previous.subject_id != draft.subject_id
            {
                return Err(anyhow!(
                    "A causal record can only supersede the same subject"
                ));
            }
        }

        let (track_id, track_snapshot, labels_snapshot) =
            if let Some(work_item_id) = draft.work_item_id {
                let semantics = self.get_work_item_semantics(work_item_id).await?;
                (
                    draft
                        .track_id
                        .or_else(|| semantics.track.as_ref().map(|track| track.id)),
                    semantics.track.map(|track| track.path).unwrap_or_default(),
                    semantics.labels,
                )
            } else if let Some(track_id) = draft.track_id {
                (Some(track_id), self.track_path(track_id).await?, Vec::new())
            } else {
                (None, Vec::new(), Vec::new())
            };

        let id = Uuid::new_v4();
        let recorded_at = Utc::now();
        sqlx::query(
            "INSERT INTO causal_records (
                id, subject_kind, subject_id, work_item_id, track_id, capture_id,
                record_kind, operational_state, next_action_status, text,
                occurred_at, recorded_at, source, provenance, confidence,
                schema_version, device_id, correlation_id, supersedes_id,
                focus_session_id, evidence_event_id, reflection_decision_id,
                track_snapshot_json, labels_snapshot_json, payload_json
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, 1, 'local', ?16, ?17,
                ?18, ?19, ?20, ?21, ?22, ?23
             )",
        )
        .bind(id.to_string())
        .bind(draft.subject_kind.as_str())
        .bind(draft.subject_id.to_string())
        .bind(draft.work_item_id.map(|id| id.to_string()))
        .bind(track_id.map(|id| id.to_string()))
        .bind(draft.capture_id.map(|id| id.to_string()))
        .bind(draft.record_kind.as_str())
        .bind(draft.operational_state.map(|state| state.as_str()))
        .bind(draft.next_action_status.map(|status| status.as_str()))
        .bind(&draft.text)
        .bind(draft.occurred_at.to_rfc3339())
        .bind(recorded_at.to_rfc3339())
        .bind(draft.source.as_str())
        .bind(draft.provenance.as_str())
        .bind(draft.confidence)
        .bind(&draft.correlation_id)
        .bind(draft.supersedes_id.map(|id| id.to_string()))
        .bind(draft.focus_session_id.map(|id| id.to_string()))
        .bind(draft.evidence_event_id.map(|id| id.to_string()))
        .bind(draft.reflection_decision_id.map(|id| id.to_string()))
        .bind(serde_json::to_string(&track_snapshot)?)
        .bind(serde_json::to_string(&labels_snapshot)?)
        .bind(serde_json::to_string(&draft.payload)?)
        .execute(self.pool())
        .await?;

        self.get_causal_record(id)
            .await?
            .ok_or_else(|| anyhow!("Inserted causal record not found"))
    }

    pub async fn get_causal_record(&self, id: Uuid) -> Result<Option<CausalRecord>> {
        let row = sqlx::query("SELECT * FROM causal_records WHERE id = ?1")
            .bind(id.to_string())
            .fetch_optional(self.pool())
            .await?;
        row.map(|row| causal_record_from_row(&row)).transpose()
    }

    pub async fn list_causal_records(
        &self,
        subject: Option<(OperationalSubjectKind, Uuid)>,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
    ) -> Result<Vec<CausalRecord>> {
        let mut sql = String::from("SELECT * FROM causal_records WHERE 1 = 1");
        if subject.is_some() {
            sql.push_str(" AND subject_kind = ? AND subject_id = ?");
        }
        if from.is_some() {
            sql.push_str(" AND julianday(occurred_at) >= julianday(?)");
        }
        if to.is_some() {
            sql.push_str(" AND julianday(occurred_at) <= julianday(?)");
        }
        sql.push_str(" ORDER BY julianday(occurred_at), julianday(recorded_at), id");

        let mut query = sqlx::query(&sql);
        if let Some((kind, id)) = subject {
            query = query.bind(kind.as_str()).bind(id.to_string());
        }
        if let Some(from) = from {
            query = query.bind(from.to_rfc3339());
        }
        if let Some(to) = to {
            query = query.bind(to.to_rfc3339());
        }

        query
            .fetch_all(self.pool())
            .await?
            .iter()
            .map(causal_record_from_row)
            .collect()
    }

    pub async fn latest_active_causal_record(
        &self,
        subject_kind: OperationalSubjectKind,
        subject_id: Uuid,
        record_kind: CausalRecordKind,
        as_of: DateTime<Utc>,
    ) -> Result<Option<CausalRecord>> {
        let records = self
            .list_causal_records(Some((subject_kind, subject_id)), None, Some(as_of))
            .await?;
        Ok(latest_unsuperseded(&records, |record| record.record_kind == record_kind).cloned())
    }

    pub async fn latest_operational_state_record(
        &self,
        subject_kind: OperationalSubjectKind,
        subject_id: Uuid,
        as_of: DateTime<Utc>,
    ) -> Result<Option<CausalRecord>> {
        let records = self
            .list_causal_records(Some((subject_kind, subject_id)), None, Some(as_of))
            .await?;
        Ok(latest_unsuperseded(&records, |record| record.operational_state.is_some()).cloned())
    }

    pub async fn causal_record_for_evidence_event(
        &self,
        evidence_event_id: Uuid,
    ) -> Result<Option<CausalRecord>> {
        let row = sqlx::query(
            "SELECT * FROM causal_records
             WHERE evidence_event_id = ?1
             ORDER BY julianday(recorded_at) DESC
             LIMIT 1",
        )
        .bind(evidence_event_id.to_string())
        .fetch_optional(self.pool())
        .await?;
        row.map(|row| causal_record_from_row(&row)).transpose()
    }

    pub async fn delete_work_item_event_with_causal_correction(
        &self,
        event_id: Uuid,
        work_item_id: Uuid,
        previous: Option<&CausalRecord>,
    ) -> Result<bool> {
        let now = Utc::now();
        let correction_id = Uuid::new_v4();
        let mut transaction = self.pool().begin().await?;
        let deleted = sqlx::query("DELETE FROM work_item_events WHERE id = ?1")
            .bind(event_id.to_string())
            .execute(&mut *transaction)
            .await?;

        if deleted.rows_affected() > 0 {
            if let Some(previous) = previous {
                if previous.subject_kind != OperationalSubjectKind::WorkItem
                    || previous.subject_id != work_item_id
                {
                    return Err(anyhow!(
                        "Deleted evidence correction must target the same Work Item"
                    ));
                }
                sqlx::query(
                    "INSERT INTO causal_records (
                        id, subject_kind, subject_id, work_item_id, track_id,
                        record_kind, text, occurred_at, recorded_at, source,
                        provenance, confidence, schema_version, device_id,
                        supersedes_id, track_snapshot_json, labels_snapshot_json,
                        payload_json
                     ) VALUES (
                        ?1, 'work_item', ?2, ?2, ?3, 'correction', ?4, ?5, ?5,
                        'user', 'confirmed', 1.0, 1, 'local', ?6, ?7, ?8, ?9
                     )",
                )
                .bind(correction_id.to_string())
                .bind(work_item_id.to_string())
                .bind(previous.track_id.map(|id| id.to_string()))
                .bind("User removed the source event from the visible journal")
                .bind(now.to_rfc3339())
                .bind(previous.id.to_string())
                .bind(serde_json::to_string(&previous.track_snapshot)?)
                .bind(serde_json::to_string(&previous.labels_snapshot)?)
                .bind(serde_json::to_string(&serde_json::json!({
                    "deleted": true,
                    "deleted_event_id": event_id,
                }))?)
                .execute(&mut *transaction)
                .await?;
            }
        }

        transaction.commit().await?;
        Ok(deleted.rows_affected() > 0)
    }

    pub async fn operational_reality(
        &self,
        as_of: DateTime<Utc>,
    ) -> Result<OperationalRealityView> {
        let work_items = self.list_work_items(None, None).await?;
        let records = self.list_causal_records(None, None, Some(as_of)).await?;
        let evidence = self.load_evidence_facts(as_of).await?;
        let reflections = self.load_unresolved_reflection_facts(as_of).await?;
        let active_focus_work_item_id = self.active_focus_work_item_at(as_of).await?;
        let focus_totals = self
            .work_item_focus_totals(Some(as_of - Duration::days(14)), Some(as_of), as_of)
            .await?;

        let evidence_refs_by_event = evidence
            .iter()
            .map(|fact| (fact.event_id, fact.refs.clone()))
            .collect::<HashMap<_, _>>();
        let mut related_records_by_track: HashMap<Uuid, Vec<CausalRecord>> = HashMap::new();
        for record in &records {
            if record.subject_kind != OperationalSubjectKind::WorkItem
                || !matches!(
                    record.record_kind,
                    CausalRecordKind::Result
                        | CausalRecordKind::Decision
                        | CausalRecordKind::Correction
                )
            {
                continue;
            }

            let mut related_track_ids = record
                .track_snapshot
                .iter()
                .map(|track| track.id)
                .collect::<HashSet<_>>();
            if related_track_ids.is_empty() {
                related_track_ids.extend(record.track_id);
            }
            for track_id in related_track_ids {
                related_records_by_track
                    .entry(track_id)
                    .or_default()
                    .push(record.clone());
            }
        }

        let mut records_by_subject: HashMap<(OperationalSubjectKind, Uuid), Vec<CausalRecord>> =
            HashMap::new();
        for record in records {
            records_by_subject
                .entry((record.subject_kind, record.subject_id))
                .or_default()
                .push(record);
        }
        let mut evidence_by_item: HashMap<Uuid, Vec<EvidenceFact>> = HashMap::new();
        for fact in evidence {
            evidence_by_item
                .entry(fact.work_item_id)
                .or_default()
                .push(fact);
        }
        let mut reflections_by_item: HashMap<Uuid, Vec<ReflectionFact>> = HashMap::new();
        let mut reflections_by_track: HashMap<Uuid, Vec<ReflectionFact>> = HashMap::new();
        for fact in reflections {
            if let Some(work_item_id) = fact.work_item_id {
                reflections_by_item
                    .entry(work_item_id)
                    .or_default()
                    .push(fact.clone());
            } else if let Some(track_id) = fact.track_id {
                reflections_by_track
                    .entry(track_id)
                    .or_default()
                    .push(fact.clone());
            }
        }

        let mut items = Vec::new();
        for work_item in work_items {
            let item_records = records_by_subject
                .get(&(OperationalSubjectKind::WorkItem, work_item.id))
                .cloned()
                .unwrap_or_default();
            let item_evidence = evidence_by_item.remove(&work_item.id).unwrap_or_default();
            let item_reflections = reflections_by_item
                .remove(&work_item.id)
                .unwrap_or_default();
            let semantics = self.get_work_item_semantics(work_item.id).await?;
            let focus_seconds = focus_totals.get(&work_item.id).copied().unwrap_or(0);
            let is_active_focus = active_focus_work_item_id == Some(work_item.id);
            let projected = project_work_item(
                &work_item,
                &item_records,
                &item_evidence,
                &item_reflections,
                semantics.track.map(|track| track.path).unwrap_or_default(),
                semantics.labels,
                focus_seconds,
                is_active_focus,
                as_of,
            );
            if let Some(item) = projected {
                items.push(item);
            }
        }

        let mut projected_track_ids = reflections_by_track.keys().copied().collect::<HashSet<_>>();
        projected_track_ids.extend(records_by_subject.iter().filter_map(
            |((kind, id), track_records)| {
                if *kind != OperationalSubjectKind::Track {
                    return None;
                }
                active_records(track_records)
                    .iter()
                    .any(|record| {
                        record.operational_state.is_some()
                            || record.record_kind == CausalRecordKind::Decision
                            || (record.record_kind == CausalRecordKind::NextAction
                                && record.next_action_status == Some(NextActionStatus::Open))
                    })
                    .then_some(*id)
            },
        ));
        let recent_track_cutoff = as_of - Duration::days(14);
        projected_track_ids.extend(related_records_by_track.iter().filter_map(
            |(track_id, related_records)| {
                active_records(related_records)
                    .iter()
                    .any(|record| record.occurred_at >= recent_track_cutoff)
                    .then_some(*track_id)
            },
        ));
        for track_id in projected_track_ids {
            let Some(track) = self.get_track(track_id).await? else {
                continue;
            };
            let track_reflections = reflections_by_track.remove(&track_id).unwrap_or_default();
            let track_records = records_by_subject
                .get(&(OperationalSubjectKind::Track, track_id))
                .cloned()
                .unwrap_or_default();
            let related_records = related_records_by_track
                .remove(&track_id)
                .unwrap_or_default();
            let historical_path = track_reflections
                .last()
                .map(|fact| fact.track_path.clone())
                .filter(|path| !path.is_empty());
            items.push(project_track(
                track.id,
                track.title,
                historical_path.unwrap_or(self.track_path(track.id).await?),
                &track_records,
                &related_records,
                &evidence_refs_by_event,
                &track_reflections,
                as_of,
            ));
        }

        let open_captures = self.list_captures(Some(&[CaptureState::Open])).await?;
        for capture in open_captures {
            let capture_records = records_by_subject
                .get(&(OperationalSubjectKind::Capture, capture.id))
                .cloned()
                .unwrap_or_default();
            items.push(project_capture(&capture, &capture_records));
        }

        items.sort_by(|left, right| {
            let left_state =
                OperationalState::from_str(&left.state).unwrap_or(OperationalState::Unknown);
            let right_state =
                OperationalState::from_str(&right.state).unwrap_or(OperationalState::Unknown);
            left_state
                .priority()
                .cmp(&right_state.priority())
                .then_with(|| right.requires_attention.cmp(&left.requires_attention))
                .then_with(|| right.last_touched_at.cmp(&left.last_touched_at))
        });
        let summary = summarize_operational_reality(&items);

        Ok(OperationalRealityView {
            as_of: as_of.to_rfc3339(),
            items,
            summary,
            updated_at: Utc::now().to_rfc3339(),
        })
    }

    async fn active_focus_work_item_at(&self, as_of: DateTime<Utc>) -> Result<Option<Uuid>> {
        let value: Option<String> = sqlx::query_scalar(
            "SELECT work_item_id
             FROM focus_sessions
             WHERE work_item_id IS NOT NULL
               AND julianday(started_at) <= julianday(?1)
               AND (stopped_at IS NULL OR julianday(stopped_at) > julianday(?1))
             ORDER BY julianday(started_at) DESC
             LIMIT 1",
        )
        .bind(as_of.to_rfc3339())
        .fetch_optional(self.pool())
        .await?;
        value
            .map(|id| Uuid::parse_str(&id).map_err(Into::into))
            .transpose()
    }

    async fn load_evidence_facts(&self, as_of: DateTime<Utc>) -> Result<Vec<EvidenceFact>> {
        let rows = sqlx::query(
            "SELECT wie.work_item_id, wie.id, wie.ts, ee.evidence_kind,
                    COALESCE(json_extract(wie.payload, '$.text'), '') AS text
             FROM evidence_entries ee
             JOIN work_item_events wie ON wie.id = ee.work_item_event_id
             WHERE julianday(wie.ts) <= julianday(?1)
             ORDER BY julianday(wie.ts)",
        )
        .bind(as_of.to_rfc3339())
        .fetch_all(self.pool())
        .await?;
        let ref_rows = sqlx::query(
            "SELECT ers.work_item_event_id, ers.id, ers.ref_id, ers.ref_kind,
                    ers.ref_value, ers.captured_at
             FROM evidence_ref_snapshots ers
             JOIN work_item_events wie ON wie.id = ers.work_item_event_id
             WHERE julianday(wie.ts) <= julianday(?1)
             ORDER BY julianday(ers.captured_at), ers.id",
        )
        .bind(as_of.to_rfc3339())
        .fetch_all(self.pool())
        .await?;
        let mut refs_by_event: HashMap<Uuid, Vec<EvidenceRefSnapshotView>> = HashMap::new();
        for row in ref_rows {
            refs_by_event
                .entry(parse_uuid(row.get("work_item_event_id"))?)
                .or_default()
                .push(EvidenceRefSnapshotView {
                    id: parse_uuid(row.get("id"))?,
                    ref_id: parse_optional_uuid(row.get("ref_id")),
                    kind: row.get("ref_kind"),
                    value: row.get("ref_value"),
                    captured_at: row.get("captured_at"),
                    provenance: "captured".to_string(),
                });
        }
        rows.iter()
            .map(|row| {
                let event_id = parse_uuid(row.get("id"))?;
                Ok(EvidenceFact {
                    work_item_id: parse_uuid(row.get("work_item_id"))?,
                    event_id,
                    kind: row.get("evidence_kind"),
                    text: row.get("text"),
                    occurred_at: parse_datetime(row.get("ts"))?,
                    refs: refs_by_event.remove(&event_id).unwrap_or_default(),
                })
            })
            .collect()
    }

    async fn load_unresolved_reflection_facts(
        &self,
        as_of: DateTime<Utc>,
    ) -> Result<Vec<ReflectionFact>> {
        let followed_up = sqlx::query(
            "SELECT prior_decision_id, created_at
             FROM reflection_decision_followups
             WHERE julianday(created_at) <= julianday(?1)",
        )
        .bind(as_of.to_rfc3339())
        .fetch_all(self.pool())
        .await?
        .iter()
        .filter_map(|row| {
            let created_at = parse_datetime(row.get("created_at")).ok()?;
            (created_at <= as_of).then(|| parse_optional_uuid(row.get("prior_decision_id")))
        })
        .flatten()
        .collect::<HashSet<_>>();
        let rows = sqlx::query(
            "SELECT d.id, d.work_item_id, d.subject, d.decision, d.note, d.created_at,
                    rdt.track_id, COALESCE(rdt.track_path_json, '[]') AS track_path_json
             FROM reflection_decisions d
             LEFT JOIN reflection_decision_tracks rdt ON rdt.reflection_decision_id = d.id
             WHERE julianday(d.created_at) <= julianday(?1)
             ORDER BY julianday(d.created_at)",
        )
        .bind(as_of.to_rfc3339())
        .fetch_all(self.pool())
        .await?;
        rows.iter()
            .map(|row| {
                Ok(ReflectionFact {
                    id: parse_uuid(row.get("id"))?,
                    work_item_id: parse_optional_uuid(row.get("work_item_id")),
                    track_id: parse_optional_uuid(row.get("track_id")),
                    subject: row.get("subject"),
                    decision: row.get("decision"),
                    note: row.get("note"),
                    occurred_at: parse_datetime(row.get("created_at"))?,
                    track_path: serde_json::from_str(&row.get::<String, _>("track_path_json"))?,
                })
            })
            .collect::<Result<Vec<_>>>()
            .map(|facts| {
                facts
                    .into_iter()
                    .filter(|fact| fact.occurred_at <= as_of && !followed_up.contains(&fact.id))
                    .collect()
            })
    }

    pub async fn create_operational_decision_followup(
        &self,
        prior_decision_id: Uuid,
        status: &str,
        note: Option<&str>,
        evidence_event_id: Option<Uuid>,
    ) -> Result<Uuid> {
        if !matches!(
            status,
            "fulfilled" | "progressed" | "cancelled" | "parked" | "contradicted" | "no_evidence"
        ) {
            return Err(anyhow!("Unknown reflection follow-up status"));
        }
        let decision_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM reflection_decisions WHERE id = ?1)")
                .bind(prior_decision_id.to_string())
                .fetch_one(self.pool())
                .await?;
        if !decision_exists {
            return Err(anyhow!("Reflection decision not found"));
        }

        let prior_causal = sqlx::query(
            "SELECT * FROM causal_records
             WHERE reflection_decision_id = ?1
             ORDER BY julianday(recorded_at) DESC, id DESC
             LIMIT 1",
        )
        .bind(prior_decision_id.to_string())
        .fetch_optional(self.pool())
        .await?
        .map(|row| causal_record_from_row(&row))
        .transpose()?;

        let now = Utc::now();
        let session_id = Uuid::new_v4();
        let followup_id = Uuid::new_v4();
        let day = now.date_naive().format("%Y-%m-%d").to_string();
        let mut transaction = self.pool().begin().await?;
        sqlx::query(
            "INSERT INTO reflection_sessions (
                id, created_at, period_from, period_to, profile,
                filters_json, summary, findings_json
             ) VALUES (?1, ?2, ?3, ?3, 'operational-reality', '{}', ?4, '[]')",
        )
        .bind(session_id.to_string())
        .bind(now.to_rfc3339())
        .bind(day)
        .bind("Operational Reality follow-up")
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO reflection_decision_followups (
                id, reflection_session_id, prior_decision_id, status,
                note, evidence_event_id, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(followup_id.to_string())
        .bind(session_id.to_string())
        .bind(prior_decision_id.to_string())
        .bind(status)
        .bind(note)
        .bind(evidence_event_id.map(|id| id.to_string()))
        .bind(now.to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        if let Some(previous) = prior_causal {
            sqlx::query(
                "INSERT INTO causal_records (
                    id, subject_kind, subject_id, work_item_id, track_id,
                    capture_id, record_kind, text, occurred_at, recorded_at,
                    source, provenance, confidence, schema_version, device_id,
                    supersedes_id, evidence_event_id, reflection_decision_id,
                    track_snapshot_json, labels_snapshot_json, payload_json
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, 'confirmation', ?7, ?8, ?8,
                    'reflection', 'confirmed', 1.0, 1, 'local', ?9, ?10, ?11,
                    ?12, ?13, ?14
                 )",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(previous.subject_kind.as_str())
            .bind(previous.subject_id.to_string())
            .bind(previous.work_item_id.map(|id| id.to_string()))
            .bind(previous.track_id.map(|id| id.to_string()))
            .bind(previous.capture_id.map(|id| id.to_string()))
            .bind(note.unwrap_or(status))
            .bind(now.to_rfc3339())
            .bind(previous.id.to_string())
            .bind(evidence_event_id.map(|id| id.to_string()))
            .bind(prior_decision_id.to_string())
            .bind(serde_json::to_string(&previous.track_snapshot)?)
            .bind(serde_json::to_string(&previous.labels_snapshot)?)
            .bind(serde_json::to_string(&serde_json::json!({
                "followup_id": followup_id,
                "status": status,
            }))?)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(followup_id)
    }
}

fn project_work_item(
    work_item: &crate::domain::WorkItem,
    records: &[CausalRecord],
    evidence: &[EvidenceFact],
    reflections: &[ReflectionFact],
    track_path: Vec<TrackPathNode>,
    labels: Vec<LabelView>,
    focus_seconds: i64,
    is_active_focus: bool,
    as_of: DateTime<Utc>,
) -> Option<OperationalRealityItemView> {
    let current_records = active_records(records);
    let active_state_record =
        latest_unsuperseded(records, |record| record.operational_state.is_some());
    let active_next_action = latest_unsuperseded(records, |record| {
        record.record_kind == CausalRecordKind::NextAction
    });

    let (state, state_provenance, state_confirmed, confidence, state_record_id) = if is_active_focus
    {
        (
            OperationalState::Active,
            "confirmed",
            true,
            1.0,
            active_state_record.map(|record| record.id),
        )
    } else if let Some(record) = active_state_record {
        (
            record
                .operational_state
                .unwrap_or(OperationalState::Unknown),
            record.provenance.as_str(),
            record.provenance == CausalProvenance::Confirmed,
            record.confidence,
            Some(record.id),
        )
    } else if let Some(reflection) = reflections.last() {
        (
            state_from_reflection(&reflection.decision),
            "derived",
            false,
            0.75,
            None,
        )
    } else if work_item.state == WorkItemState::Unknown
        && work_item.pinned
        && work_item
            .last_seen_at
            .is_some_and(|last_seen| last_seen < as_of - Duration::days(7))
    {
        (
            OperationalState::StaleImportant,
            "derived",
            false,
            0.65,
            None,
        )
    } else {
        (
            state_from_work_item(work_item.state),
            "legacy_current",
            false,
            0.70,
            None,
        )
    };

    let recent_cutoff = as_of - Duration::days(7);
    let last_touched = work_item.last_seen_at.unwrap_or(work_item.updated_at);
    let has_open_next_action = active_next_action
        .is_some_and(|record| record.next_action_status == Some(NextActionStatus::Open));
    let should_include = !matches!(
        state,
        OperationalState::Completed | OperationalState::Parked
    ) || last_touched >= recent_cutoff
        || work_item.pinned
        || !reflections.is_empty()
        || has_open_next_action;
    if !should_include {
        return None;
    }

    let mut why_visible = Vec::new();
    why_visible.push(match state {
        OperationalState::Active => "Сейчас идёт фокус по этому делу".to_string(),
        OperationalState::Blocked => "Дело явно заблокировано".to_string(),
        OperationalState::Waiting => "Дело ожидает внешнего события".to_string(),
        OperationalState::MeetingTail => "После встречи остался незакрытый хвост".to_string(),
        OperationalState::StaleImportant => {
            "Важное дело давно не получало подтверждённого движения".to_string()
        }
        OperationalState::Reactive => "Дело отмечено как реактивная работа".to_string(),
        OperationalState::Completed => {
            "Недавно завершённое дело оставлено для проверки истории".to_string()
        }
        OperationalState::Parked => "Припаркованное дело оставлено в текущем контексте".to_string(),
        OperationalState::Unknown => "Состояние дела ещё не подтверждено".to_string(),
    });
    if !reflections.is_empty() {
        why_visible.push("Есть решение прошлого обзора без follow-up".to_string());
    }
    let has_result = evidence.iter().any(|fact| fact.kind == "result")
        || current_records
            .iter()
            .any(|record| record.record_kind == CausalRecordKind::Result);
    let high_effort_without_result = focus_seconds >= 2 * 60 * 60 && !has_result;
    if high_effort_without_result {
        why_visible.push(format!(
            "За 14 дней учтено {} мин работы без зафиксированного результата",
            focus_seconds / 60
        ));
    }

    let evidence_refs = evidence
        .iter()
        .map(|fact| (fact.event_id, fact.refs.clone()))
        .collect::<HashMap<_, _>>();
    let mut facts = current_records
        .iter()
        .filter(|record| {
            matches!(
                record.record_kind,
                CausalRecordKind::Result
                    | CausalRecordKind::Decision
                    | CausalRecordKind::StateAssertion
                    | CausalRecordKind::Confirmation
                    | CausalRecordKind::Correction
            )
        })
        .map(|record| {
            basis_from_record(
                record,
                record
                    .evidence_event_id
                    .and_then(|event_id| evidence_refs.get(&event_id))
                    .cloned()
                    .unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>();
    if let Some(intent) = current_records
        .iter()
        .filter(|record| record.record_kind == CausalRecordKind::Intent)
        .max_by_key(|record| (record.occurred_at, record.recorded_at, record.id))
    {
        facts.push(basis_from_record(intent, Vec::new()));
    }
    let represented_evidence = current_records
        .iter()
        .filter(|record| record.record_kind != CausalRecordKind::Correction)
        .filter_map(|record| record.evidence_event_id)
        .collect::<HashSet<_>>();
    let represented_reflections = current_records
        .iter()
        .filter_map(|record| record.reflection_decision_id)
        .collect::<HashSet<_>>();
    facts.extend(
        evidence
            .iter()
            .filter(|fact| !represented_evidence.contains(&fact.event_id))
            .map(basis_from_evidence),
    );
    facts.extend(
        reflections
            .iter()
            .filter(|fact| !represented_reflections.contains(&fact.id))
            .map(basis_from_reflection),
    );
    facts.sort_by(|left, right| right.occurred_at.cmp(&left.occurred_at));
    facts.truncate(6);

    let next_action = active_next_action
        .filter(|record| record.next_action_status == Some(NextActionStatus::Open))
        .and_then(next_action_from_record);
    let mut unknowns = Vec::new();
    if !state_confirmed {
        unknowns.push(
            "Состояние восстановлено или выведено, но не подтверждено пользователем".to_string(),
        );
    }
    if next_action.is_none()
        && !matches!(
            state,
            OperationalState::Completed | OperationalState::Parked
        )
    {
        unknowns.push("Не зафиксировано следующее действие".to_string());
    }
    if high_effort_without_result {
        unknowns.push("Не зафиксировано, что изменилось после вложенного времени".to_string());
    }
    if track_path.is_empty() {
        unknowns.push("Дело не отнесено к долгому направлению".to_string());
    }

    let last_significant_change = facts.first().cloned();
    let needs_next_action = next_action.is_none()
        && !matches!(
            state,
            OperationalState::Completed | OperationalState::Parked
        );
    let state_requires_attention = matches!(
        state,
        OperationalState::Active
            | OperationalState::Waiting
            | OperationalState::Blocked
            | OperationalState::Reactive
            | OperationalState::StaleImportant
            | OperationalState::MeetingTail
    ) || (state == OperationalState::Unknown
        && state_record_id.is_some());
    let requires_attention = state_requires_attention
        || has_open_next_action
        || !reflections.is_empty()
        || high_effort_without_result
        || (work_item.pinned && needs_next_action);
    Some(OperationalRealityItemView {
        id: format!("work_item:{}", work_item.id),
        subject_kind: OperationalSubjectKind::WorkItem.as_str().to_string(),
        subject_id: work_item.id,
        title: work_item.title.clone(),
        work_item_id: Some(work_item.id),
        track_id: track_path.last().map(|track| track.id),
        capture_id: None,
        state: state.as_str().to_string(),
        state_provenance: state_provenance.to_string(),
        state_confirmed,
        confidence,
        state_record_id,
        why_visible,
        facts,
        unknowns,
        last_significant_change,
        next_action,
        track_path,
        labels,
        can_start_focus: !matches!(state, OperationalState::Completed),
        requires_attention,
        last_touched_at: last_touched.to_rfc3339(),
    })
}

fn project_track(
    track_id: Uuid,
    title: String,
    track_path: Vec<TrackPathNode>,
    records: &[CausalRecord],
    related_records: &[CausalRecord],
    evidence_refs_by_event: &HashMap<Uuid, Vec<EvidenceRefSnapshotView>>,
    reflections: &[ReflectionFact],
    as_of: DateTime<Utc>,
) -> OperationalRealityItemView {
    let current_records = active_records(records);
    let current_related_records = active_records(related_records);
    let state_record = latest_unsuperseded(records, |record| record.operational_state.is_some());
    let next_action_record = latest_unsuperseded(records, |record| {
        record.record_kind == CausalRecordKind::NextAction
    });
    let reflection = reflections.last();
    let state = state_record
        .and_then(|record| record.operational_state)
        .unwrap_or_else(|| {
            reflection
                .map(|fact| state_from_reflection(&fact.decision))
                .unwrap_or(OperationalState::Unknown)
        });
    let state_provenance = state_record
        .map(|record| record.provenance.as_str())
        .unwrap_or("derived");
    let state_confirmed =
        state_record.is_some_and(|record| record.provenance == CausalProvenance::Confirmed);
    let mut facts = current_records
        .iter()
        .map(|record| {
            basis_from_record(
                record,
                record
                    .evidence_event_id
                    .and_then(|event_id| evidence_refs_by_event.get(&event_id))
                    .cloned()
                    .unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>();
    facts.extend(current_related_records.iter().map(|record| {
        basis_from_record(
            record,
            record
                .evidence_event_id
                .and_then(|event_id| evidence_refs_by_event.get(&event_id))
                .cloned()
                .unwrap_or_default(),
        )
    }));
    let represented_reflections = current_records
        .iter()
        .filter_map(|record| record.reflection_decision_id)
        .collect::<HashSet<_>>();
    facts.extend(
        reflections
            .iter()
            .filter(|fact| !represented_reflections.contains(&fact.id))
            .map(basis_from_reflection),
    );
    facts.sort_by(|left, right| right.occurred_at.cmp(&left.occurred_at));
    facts.truncate(6);
    let next_action = next_action_record
        .filter(|record| record.next_action_status == Some(NextActionStatus::Open))
        .and_then(next_action_from_record);
    let mut unknowns = Vec::new();
    if !state_confirmed {
        unknowns.push("Состояние направления ещё не подтверждено".to_string());
    }
    if next_action.is_none() {
        unknowns.push("Не зафиксировано следующее действие по направлению".to_string());
    }
    let mut why_visible = Vec::new();
    if !reflections.is_empty() {
        why_visible.push("Есть решение прошлого обзора по направлению без follow-up".to_string());
    }
    if state_record.is_some() {
        why_visible.push("Состояние направления сохранено в причинной истории".to_string());
    }
    if next_action.is_some() {
        why_visible.push("По направлению зафиксировано следующее действие".to_string());
    }
    if !current_related_records.is_empty() {
        why_visible
            .push("По направлению есть недавние результаты или решения связанных дел".to_string());
    }
    let state_requires_attention = state_record.is_some()
        && matches!(
            state,
            OperationalState::Active
                | OperationalState::Waiting
                | OperationalState::Blocked
                | OperationalState::Reactive
                | OperationalState::StaleImportant
                | OperationalState::MeetingTail
                | OperationalState::Unknown
        );
    let requires_attention =
        state_requires_attention || next_action.is_some() || !reflections.is_empty();
    let last_touched_at = records
        .iter()
        .map(|record| record.occurred_at)
        .chain(related_records.iter().map(|record| record.occurred_at))
        .chain(reflections.iter().map(|fact| fact.occurred_at))
        .max()
        .unwrap_or(as_of);

    OperationalRealityItemView {
        id: format!("track:{track_id}"),
        subject_kind: OperationalSubjectKind::Track.as_str().to_string(),
        subject_id: track_id,
        title,
        work_item_id: None,
        track_id: Some(track_id),
        capture_id: None,
        state: state.as_str().to_string(),
        state_provenance: state_provenance.to_string(),
        state_confirmed,
        confidence: state_record.map(|record| record.confidence).unwrap_or(0.75),
        state_record_id: state_record.map(|record| record.id),
        why_visible,
        last_significant_change: facts.first().cloned(),
        facts,
        unknowns,
        next_action,
        track_path,
        labels: Vec::new(),
        can_start_focus: false,
        requires_attention,
        last_touched_at: last_touched_at.to_rfc3339(),
    }
}

fn project_capture(
    capture: &crate::domain::Capture,
    records: &[CausalRecord],
) -> OperationalRealityItemView {
    let current_records = active_records(records);
    let state_record = latest_unsuperseded(records, |record| record.operational_state.is_some());
    let state = state_record
        .and_then(|record| record.operational_state)
        .unwrap_or(OperationalState::Unknown);
    let next_action_record = latest_unsuperseded(records, |record| {
        record.record_kind == CausalRecordKind::NextAction
    });
    let next_action = next_action_record
        .filter(|record| record.next_action_status == Some(NextActionStatus::Open))
        .and_then(next_action_from_record);
    let facts = current_records
        .iter()
        .map(|record| basis_from_record(record, Vec::new()))
        .collect::<Vec<_>>();
    OperationalRealityItemView {
        id: format!("capture:{}", capture.id),
        subject_kind: OperationalSubjectKind::Capture.as_str().to_string(),
        subject_id: capture.id,
        title: capture.text.clone(),
        work_item_id: capture.work_item_id,
        track_id: None,
        capture_id: Some(capture.id),
        state: state.as_str().to_string(),
        state_provenance: state_record
            .map(|record| record.provenance.as_str())
            .unwrap_or("legacy_current")
            .to_string(),
        state_confirmed: state_record
            .is_some_and(|record| record.provenance == CausalProvenance::Confirmed),
        confidence: state_record.map(|record| record.confidence).unwrap_or(0.70),
        state_record_id: state_record.map(|record| record.id),
        why_visible: vec!["Незавершённая запись во входящих отвлечениях".to_string()],
        last_significant_change: facts.first().cloned(),
        facts,
        unknowns: if next_action.is_none() {
            vec!["Нужно обработать, превратить в дело или закрыть".to_string()]
        } else {
            Vec::new()
        },
        next_action,
        track_path: Vec::new(),
        labels: Vec::new(),
        can_start_focus: capture.work_item_id.is_some(),
        requires_attention: true,
        last_touched_at: capture.updated_at.to_rfc3339(),
    }
}

fn basis_from_record(
    record: &CausalRecord,
    refs: Vec<EvidenceRefSnapshotView>,
) -> OperationalRealityBasisView {
    OperationalRealityBasisView {
        kind: record.record_kind.as_str().to_string(),
        summary: record.text.clone().unwrap_or_else(|| {
            record
                .operational_state
                .map(|state| format!("Состояние: {}", state.as_str()))
                .unwrap_or_else(|| "Причинная запись".to_string())
        }),
        occurred_at: record.occurred_at.to_rfc3339(),
        source: record.source.as_str().to_string(),
        provenance: record.provenance.as_str().to_string(),
        confidence: record.confidence,
        refs,
        causal_record_id: Some(record.id),
        evidence_event_id: record.evidence_event_id,
        reflection_decision_id: record.reflection_decision_id,
    }
}

fn basis_from_evidence(fact: &EvidenceFact) -> OperationalRealityBasisView {
    OperationalRealityBasisView {
        kind: fact.kind.clone(),
        summary: fact.text.clone(),
        occurred_at: fact.occurred_at.to_rfc3339(),
        source: "user".to_string(),
        provenance: "legacy_current".to_string(),
        confidence: 0.70,
        refs: fact.refs.clone(),
        causal_record_id: None,
        evidence_event_id: Some(fact.event_id),
        reflection_decision_id: None,
    }
}

fn basis_from_reflection(fact: &ReflectionFact) -> OperationalRealityBasisView {
    OperationalRealityBasisView {
        kind: "reflection_decision".to_string(),
        summary: fact
            .note
            .as_ref()
            .map(|note| format!("{}: {note}", fact.subject))
            .unwrap_or_else(|| fact.subject.clone()),
        occurred_at: fact.occurred_at.to_rfc3339(),
        source: "reflection".to_string(),
        provenance: "confirmed".to_string(),
        confidence: 1.0,
        refs: Vec::new(),
        causal_record_id: None,
        evidence_event_id: None,
        reflection_decision_id: Some(fact.id),
    }
}

fn next_action_from_record(record: &CausalRecord) -> Option<OperationalNextActionView> {
    Some(OperationalNextActionView {
        record_id: record.id,
        text: record.text.clone()?,
        status: record.next_action_status?.as_str().to_string(),
        occurred_at: record.occurred_at.to_rfc3339(),
        provenance: record.provenance.as_str().to_string(),
        confidence: record.confidence,
    })
}

fn latest_unsuperseded<F>(records: &[CausalRecord], predicate: F) -> Option<&CausalRecord>
where
    F: Fn(&CausalRecord) -> bool,
{
    let superseded = records
        .iter()
        .filter_map(|record| record.supersedes_id)
        .collect::<HashSet<_>>();
    records
        .iter()
        .filter(|record| predicate(record) && !superseded.contains(&record.id))
        .max_by_key(|record| (record.occurred_at, record.recorded_at, record.id))
}

fn active_records(records: &[CausalRecord]) -> Vec<&CausalRecord> {
    let superseded = records
        .iter()
        .filter_map(|record| record.supersedes_id)
        .collect::<HashSet<_>>();
    records
        .iter()
        .filter(|record| !superseded.contains(&record.id))
        .collect()
}

fn state_from_work_item(state: WorkItemState) -> OperationalState {
    match state {
        WorkItemState::Active => OperationalState::Active,
        WorkItemState::Waiting => OperationalState::Waiting,
        WorkItemState::Blocked => OperationalState::Blocked,
        WorkItemState::Done => OperationalState::Completed,
        WorkItemState::Someday => OperationalState::Parked,
        WorkItemState::Unknown => OperationalState::Unknown,
    }
}

fn state_from_reflection(decision: &str) -> OperationalState {
    match decision {
        "done-close" => OperationalState::Completed,
        "park" | "noise" => OperationalState::Parked,
        "reactive" => OperationalState::Reactive,
        "protect-next-focus" => OperationalState::StaleImportant,
        _ => OperationalState::Unknown,
    }
}

fn summarize_operational_reality(
    items: &[OperationalRealityItemView],
) -> OperationalRealitySummaryView {
    let mut by_state = BTreeMap::new();
    for item in items {
        *by_state.entry(item.state.clone()).or_insert(0) += 1;
    }
    OperationalRealitySummaryView {
        total: items.len(),
        requiring_attention: items.iter().filter(|item| item.requires_attention).count(),
        confirmed: items
            .iter()
            .filter(|item| item.state_provenance == "confirmed")
            .count(),
        derived: items
            .iter()
            .filter(|item| item.state_provenance == "derived")
            .count(),
        legacy_current: items
            .iter()
            .filter(|item| item.state_provenance == "legacy_current")
            .count(),
        without_next_action: items
            .iter()
            .filter(|item| item.next_action.is_none())
            .count(),
        by_state,
    }
}

fn causal_record_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<CausalRecord> {
    let subject_kind_value: String = row.get("subject_kind");
    let record_kind_value: String = row.get("record_kind");
    let source_value: String = row.get("source");
    let provenance_value: String = row.get("provenance");
    Ok(CausalRecord {
        id: parse_uuid(row.get("id"))?,
        subject_kind: OperationalSubjectKind::from_str(&subject_kind_value)
            .ok_or_else(|| anyhow!("Unknown causal subject kind: {subject_kind_value}"))?,
        subject_id: parse_uuid(row.get("subject_id"))?,
        work_item_id: parse_optional_uuid(row.get("work_item_id")),
        track_id: parse_optional_uuid(row.get("track_id")),
        capture_id: parse_optional_uuid(row.get("capture_id")),
        record_kind: CausalRecordKind::from_str(&record_kind_value)
            .ok_or_else(|| anyhow!("Unknown causal record kind: {record_kind_value}"))?,
        operational_state: row
            .get::<Option<String>, _>("operational_state")
            .as_deref()
            .and_then(OperationalState::from_str),
        next_action_status: row
            .get::<Option<String>, _>("next_action_status")
            .as_deref()
            .and_then(NextActionStatus::from_str),
        text: row.get("text"),
        occurred_at: parse_datetime(row.get("occurred_at"))?,
        recorded_at: parse_datetime(row.get("recorded_at"))?,
        source: CausalSource::from_str(&source_value)
            .ok_or_else(|| anyhow!("Unknown causal source: {source_value}"))?,
        provenance: CausalProvenance::from_str(&provenance_value)
            .ok_or_else(|| anyhow!("Unknown causal provenance: {provenance_value}"))?,
        confidence: row.get("confidence"),
        schema_version: row.get("schema_version"),
        device_id: row.get("device_id"),
        correlation_id: row.get("correlation_id"),
        supersedes_id: parse_optional_uuid(row.get("supersedes_id")),
        focus_session_id: parse_optional_uuid(row.get("focus_session_id")),
        evidence_event_id: parse_optional_uuid(row.get("evidence_event_id")),
        reflection_decision_id: parse_optional_uuid(row.get("reflection_decision_id")),
        track_snapshot: serde_json::from_str(&row.get::<String, _>("track_snapshot_json"))?,
        labels_snapshot: serde_json::from_str(&row.get::<String, _>("labels_snapshot_json"))?,
        payload: serde_json::from_str(&row.get::<String, _>("payload_json"))?,
    })
}

fn parse_uuid(value: String) -> Result<Uuid> {
    Ok(Uuid::parse_str(&value)?)
}

fn parse_optional_uuid(value: Option<String>) -> Option<Uuid> {
    value.and_then(|value| Uuid::parse_str(&value).ok())
}

fn parse_datetime(value: String) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(&value)?.with_timezone(&Utc))
}

pub fn causal_record_views(records: Vec<CausalRecord>) -> Vec<CausalRecordView> {
    records.into_iter().map(Into::into).collect()
}
