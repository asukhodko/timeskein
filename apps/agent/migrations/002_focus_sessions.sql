-- Focus Sessions
-- Manual contact-time blocks for dogfooding Timeskein as a Session replacement.

CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    work_item_id TEXT,
    state TEXT NOT NULL DEFAULT 'active'
        CHECK(state IN ('active', 'stopped')),
    activity_zone TEXT NOT NULL DEFAULT 'work'
        CHECK(activity_zone IN ('work', 'coordination', 'recovery', 'idle', 'personal')),
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

-- The dogfood model treats Work Item `active` as the UI marker for the single
-- currently timed item. Normalize old rows before adding the SQLite guard.
UPDATE work_items
SET
    state = 'unknown',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE deleted_at IS NULL
  AND state = 'active'
  AND id NOT IN (
      SELECT id
      FROM (
          SELECT wi.id
          FROM work_items wi
          LEFT JOIN focus_sessions fs
            ON fs.work_item_id = wi.id
           AND fs.state = 'active'
          WHERE wi.deleted_at IS NULL
            AND wi.state = 'active'
          ORDER BY
              CASE WHEN fs.id IS NOT NULL THEN 0 ELSE 1 END,
              wi.updated_at DESC
          LIMIT 1
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_items_single_active
    ON work_items(state)
    WHERE deleted_at IS NULL AND state = 'active';
