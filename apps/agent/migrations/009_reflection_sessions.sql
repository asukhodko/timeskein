-- Saved conclusions and decisions from arbitrary-period reviews.

CREATE TABLE IF NOT EXISTS reflection_sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    profile TEXT NOT NULL,
    filters_json TEXT NOT NULL DEFAULT '{}'
        CHECK(json_valid(filters_json)),
    report_hash TEXT,
    summary TEXT NOT NULL,
    findings_json TEXT NOT NULL DEFAULT '[]'
        CHECK(json_valid(findings_json))
);

CREATE TABLE IF NOT EXISTS reflection_decisions (
    id TEXT PRIMARY KEY,
    reflection_session_id TEXT NOT NULL,
    work_item_id TEXT,
    subject TEXT NOT NULL,
    decision TEXT NOT NULL
        CHECK(decision IN ('continue', 'done-close', 'park', 'reactive', 'noise', 'protect-next-focus')),
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (reflection_session_id) REFERENCES reflection_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reflection_sessions_period
    ON reflection_sessions(period_from, period_to, profile, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reflection_decisions_session
    ON reflection_decisions(reflection_session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reflection_decisions_work_item
    ON reflection_decisions(work_item_id, created_at DESC);
