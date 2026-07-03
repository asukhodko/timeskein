-- Extend Work Item event kinds for user-visible timestamped notes.
-- SQLite cannot ALTER a CHECK constraint, so preserve events through a table rebuild.

PRAGMA foreign_keys=OFF;

ALTER TABLE work_item_events RENAME TO work_item_events_old;
DROP INDEX IF EXISTS idx_events_work_item;
DROP INDEX IF EXISTS idx_events_ts;

CREATE TABLE work_item_events (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN (
        'created', 'touched', 'state_changed', 'note_changed',
        'pinned', 'unpinned', 'ref_attached', 'ref_removed',
        'opened_ref', 'updated', 'note_added', 'deleted'
    )),
    payload TEXT,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

INSERT INTO work_item_events (id, ts, work_item_id, kind, payload)
SELECT id, ts, work_item_id, kind, payload
FROM work_item_events_old;

DROP TABLE work_item_events_old;

CREATE INDEX idx_events_work_item ON work_item_events(work_item_id);
CREATE INDEX idx_events_ts ON work_item_events(ts DESC);

PRAGMA foreign_keys=ON;
