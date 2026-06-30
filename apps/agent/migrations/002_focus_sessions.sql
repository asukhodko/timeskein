-- Focus Sessions
-- Manual contact-time blocks for dogfooding Timeskein as a Session replacement.

CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    work_item_id TEXT,
    state TEXT NOT NULL DEFAULT 'active'
        CHECK(state IN ('active', 'stopped')),
    target_seconds INTEGER NOT NULL DEFAULT 1500,
    note TEXT,
    started_at TEXT NOT NULL,
    stopped_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_sessions_single_active
    ON focus_sessions(state)
    WHERE state = 'active';

CREATE INDEX IF NOT EXISTS idx_focus_sessions_started_at
    ON focus_sessions(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_work_item
    ON focus_sessions(work_item_id);
