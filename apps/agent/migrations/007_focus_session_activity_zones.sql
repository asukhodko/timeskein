-- Store Activity Zone as a focus-block snapshot/override.
-- Existing blocks are backfilled from their linked Work Item where possible.

ALTER TABLE focus_sessions
ADD COLUMN activity_zone TEXT NOT NULL DEFAULT 'work'
    CHECK(activity_zone IN ('work', 'coordination', 'recovery', 'idle', 'personal'));

UPDATE focus_sessions
SET activity_zone = COALESCE((
    SELECT wi.activity_zone
    FROM work_items wi
    WHERE wi.id = focus_sessions.work_item_id
), 'work');

CREATE INDEX IF NOT EXISTS idx_focus_sessions_activity_zone
    ON focus_sessions(activity_zone);
