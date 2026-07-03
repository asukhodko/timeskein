-- Day-level timestamped notes for evening review.

CREATE TABLE IF NOT EXISTS day_events (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'note_added'
        CHECK(kind IN ('note_added')),
    text TEXT NOT NULL,
    focus_session_id TEXT,
    activity_zone TEXT CHECK(activity_zone IN ('work', 'coordination', 'recovery', 'idle', 'personal')),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_day_events_ts
    ON day_events(ts DESC);

CREATE INDEX IF NOT EXISTS idx_day_events_focus_session
    ON day_events(focus_session_id);
