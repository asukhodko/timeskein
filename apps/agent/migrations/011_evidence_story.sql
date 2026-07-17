-- Typed Work Item evidence, immutable Ref snapshots, and explicit follow-up checks
-- for decisions saved by earlier Track retrospectives.

CREATE TABLE IF NOT EXISTS evidence_entries (
    work_item_event_id TEXT PRIMARY KEY,
    evidence_kind TEXT NOT NULL
        CHECK(evidence_kind IN ('result', 'decision', 'blocker', 'next_step', 'observation')),
    focus_session_id TEXT,
    captured_at TEXT NOT NULL,
    FOREIGN KEY (work_item_event_id) REFERENCES work_item_events(id) ON DELETE CASCADE,
    FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_entries_kind
    ON evidence_entries(evidence_kind, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_entries_focus
    ON evidence_entries(focus_session_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS evidence_ref_snapshots (
    id TEXT PRIMARY KEY,
    work_item_event_id TEXT NOT NULL,
    ref_id TEXT,
    ref_kind TEXT NOT NULL
        CHECK(ref_kind IN ('url', 'file_path', 'issue_key', 'custom')),
    ref_value TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    FOREIGN KEY (work_item_event_id) REFERENCES work_item_events(id) ON DELETE CASCADE,
    FOREIGN KEY (ref_id) REFERENCES refs(id) ON DELETE SET NULL,
    UNIQUE(work_item_event_id, ref_kind, ref_value)
);

CREATE INDEX IF NOT EXISTS idx_evidence_ref_event
    ON evidence_ref_snapshots(work_item_event_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_evidence_ref_current
    ON evidence_ref_snapshots(ref_id, work_item_event_id);

CREATE TABLE IF NOT EXISTS reflection_decision_followups (
    id TEXT PRIMARY KEY,
    reflection_session_id TEXT NOT NULL,
    prior_decision_id TEXT NOT NULL,
    status TEXT NOT NULL
        CHECK(status IN ('fulfilled', 'progressed', 'cancelled', 'parked', 'contradicted', 'no_evidence')),
    note TEXT,
    evidence_event_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (reflection_session_id) REFERENCES reflection_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (prior_decision_id) REFERENCES reflection_decisions(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_event_id) REFERENCES work_item_events(id) ON DELETE SET NULL,
    UNIQUE(reflection_session_id, prior_decision_id)
);

CREATE INDEX IF NOT EXISTS idx_reflection_followups_prior
    ON reflection_decision_followups(prior_decision_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reflection_followups_session
    ON reflection_decision_followups(reflection_session_id, created_at);
