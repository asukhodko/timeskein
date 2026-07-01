-- Captures
-- Lightweight inbox entries for interruptions that should not stop the current
-- focus block.

CREATE TABLE IF NOT EXISTS captures (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open'
        CHECK(state IN ('open', 'resolved', 'converted')),
    work_item_id TEXT,
    focus_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    converted_at TEXT,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
    FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_captures_state_created
    ON captures(state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_captures_focus_session
    ON captures(focus_session_id);

CREATE INDEX IF NOT EXISTS idx_captures_work_item
    ON captures(work_item_id);
