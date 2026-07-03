-- Activity zones and day-review totals.
-- Work Items carry the broad activity class used by reports and list totals.

ALTER TABLE work_items
ADD COLUMN activity_zone TEXT NOT NULL DEFAULT 'work'
    CHECK(activity_zone IN ('work', 'coordination', 'recovery', 'idle', 'personal'));

CREATE INDEX IF NOT EXISTS idx_work_items_activity_zone
    ON work_items(activity_zone)
    WHERE deleted_at IS NULL;
