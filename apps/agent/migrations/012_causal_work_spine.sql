-- Append-only causal assertions used to build Operational Reality.

CREATE TABLE IF NOT EXISTS causal_records (
    id TEXT PRIMARY KEY,
    subject_kind TEXT NOT NULL
        CHECK(subject_kind IN ('work_item', 'track', 'capture')),
    subject_id TEXT NOT NULL,
    work_item_id TEXT,
    track_id TEXT,
    capture_id TEXT,
    record_kind TEXT NOT NULL
        CHECK(record_kind IN (
            'intent', 'state_assertion', 'result', 'decision',
            'next_action', 'confirmation', 'correction'
        )),
    operational_state TEXT
        CHECK(operational_state IS NULL OR operational_state IN (
            'active', 'waiting', 'blocked', 'parked', 'reactive',
            'completed', 'stale-important', 'meeting-tail', 'unknown'
        )),
    next_action_status TEXT
        CHECK(next_action_status IS NULL OR next_action_status IN (
            'open', 'completed', 'replaced', 'dismissed'
        )),
    text TEXT,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    source TEXT NOT NULL
        CHECK(source IN ('user', 'system', 'reflection', 'legacy')),
    provenance TEXT NOT NULL
        CHECK(provenance IN ('confirmed', 'observed', 'derived', 'legacy_current')),
    confidence REAL NOT NULL DEFAULT 1.0
        CHECK(confidence >= 0.0 AND confidence <= 1.0),
    schema_version INTEGER NOT NULL DEFAULT 1,
    device_id TEXT NOT NULL DEFAULT 'local',
    correlation_id TEXT,
    supersedes_id TEXT,
    focus_session_id TEXT,
    evidence_event_id TEXT,
    reflection_decision_id TEXT,
    track_snapshot_json TEXT NOT NULL DEFAULT '[]'
        CHECK(json_valid(track_snapshot_json)),
    labels_snapshot_json TEXT NOT NULL DEFAULT '[]'
        CHECK(json_valid(labels_snapshot_json)),
    payload_json TEXT NOT NULL DEFAULT '{}'
        CHECK(json_valid(payload_json)),
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL,
    FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE SET NULL,
    FOREIGN KEY (supersedes_id) REFERENCES causal_records(id) ON DELETE RESTRICT,
    FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (evidence_event_id) REFERENCES work_item_events(id) ON DELETE SET NULL,
    FOREIGN KEY (reflection_decision_id) REFERENCES reflection_decisions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_causal_records_subject
    ON causal_records(subject_kind, subject_id, datetime(occurred_at), datetime(recorded_at));

CREATE INDEX IF NOT EXISTS idx_causal_records_kind
    ON causal_records(record_kind, datetime(occurred_at) DESC);

CREATE INDEX IF NOT EXISTS idx_causal_records_supersedes
    ON causal_records(supersedes_id);

CREATE INDEX IF NOT EXISTS idx_causal_records_work_item
    ON causal_records(work_item_id, datetime(occurred_at) DESC);

CREATE INDEX IF NOT EXISTS idx_causal_records_track
    ON causal_records(track_id, datetime(occurred_at) DESC);

CREATE INDEX IF NOT EXISTS idx_causal_records_evidence
    ON causal_records(evidence_event_id);

CREATE INDEX IF NOT EXISTS idx_causal_records_reflection
    ON causal_records(reflection_decision_id);

-- Preserve existing typed user evidence as explicit legacy causal facts. The
-- text and semantic snapshots stay stable even if the current Work Item is
-- edited or reclassified later.
INSERT OR IGNORE INTO causal_records (
    id, subject_kind, subject_id, work_item_id, track_id, record_kind,
    next_action_status, text, occurred_at, recorded_at, source, provenance,
    confidence, evidence_event_id, track_snapshot_json, labels_snapshot_json,
    payload_json
)
SELECT
    e.work_item_event_id,
    'work_item',
    wie.work_item_id,
    wie.work_item_id,
    wis.track_id,
    CASE e.evidence_kind
        WHEN 'result' THEN 'result'
        WHEN 'decision' THEN 'decision'
        WHEN 'next_step' THEN 'next_action'
    END,
    CASE WHEN e.evidence_kind = 'next_step' THEN 'open' ELSE NULL END,
    json_extract(wie.payload, '$.text'),
    wie.ts,
    e.captured_at,
    'legacy',
    'legacy_current',
    0.70,
    e.work_item_event_id,
    COALESCE(wis.track_path_json, '[]'),
    COALESCE(wis.labels_json, '[]'),
    json_object('migration', '012', 'evidence_kind', e.evidence_kind)
FROM evidence_entries e
JOIN work_item_events wie ON wie.id = e.work_item_event_id
LEFT JOIN work_item_event_semantic_snapshots wis ON wis.work_item_event_id = wie.id
WHERE e.evidence_kind IN ('result', 'decision', 'next_step')
  AND NOT EXISTS (
      SELECT 1 FROM causal_records existing
      WHERE existing.evidence_event_id = e.work_item_event_id
  );

-- Reflection decisions are canonical user decisions even though older rows do
-- not have the full provenance envelope.
INSERT OR IGNORE INTO causal_records (
    id, subject_kind, subject_id, work_item_id, track_id, record_kind, text,
    occurred_at, recorded_at, source, provenance, confidence,
    reflection_decision_id, track_snapshot_json, payload_json
)
SELECT
    d.id,
    CASE WHEN d.work_item_id IS NOT NULL THEN 'work_item' ELSE 'track' END,
    COALESCE(d.work_item_id, rdt.track_id),
    d.work_item_id,
    rdt.track_id,
    'decision',
    CASE
        WHEN d.note IS NULL OR trim(d.note) = '' THEN d.subject
        ELSE d.subject || ': ' || d.note
    END,
    d.created_at,
    d.created_at,
    'reflection',
    'confirmed',
    1.0,
    d.id,
    COALESCE(rdt.track_path_json, '[]'),
    json_object('migration', '012', 'decision', d.decision)
FROM reflection_decisions d
LEFT JOIN reflection_decision_tracks rdt ON rdt.reflection_decision_id = d.id
WHERE (d.work_item_id IS NOT NULL OR rdt.track_id IS NOT NULL)
  AND NOT EXISTS (
      SELECT 1 FROM causal_records existing
      WHERE existing.reflection_decision_id = d.id
  );
