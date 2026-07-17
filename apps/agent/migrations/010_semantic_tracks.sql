-- Long-lived semantic tracks, cross-cutting labels, and immutable classification snapshots.

CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL UNIQUE,
    parent_track_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    FOREIGN KEY (parent_track_id) REFERENCES tracks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_parent
    ON tracks(parent_track_id);

CREATE INDEX IF NOT EXISTS idx_tracks_archived
    ON tracks(archived_at, normalized_title);

CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_labels_archived
    ON labels(archived_at, normalized_title);

CREATE TABLE IF NOT EXISTS work_item_tracks (
    work_item_id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_work_item_tracks_track
    ON work_item_tracks(track_id, work_item_id);

CREATE TABLE IF NOT EXISTS work_item_labels (
    work_item_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (work_item_id, label_id),
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_work_item_labels_label
    ON work_item_labels(label_id, work_item_id);

CREATE TABLE IF NOT EXISTS focus_session_semantic_snapshots (
    focus_session_id TEXT PRIMARY KEY,
    track_id TEXT,
    track_path_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(track_path_json)),
    labels_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(labels_json)),
    captured_at TEXT NOT NULL,
    FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_focus_semantic_track
    ON focus_session_semantic_snapshots(track_id, focus_session_id);

CREATE TABLE IF NOT EXISTS work_item_event_semantic_snapshots (
    work_item_event_id TEXT PRIMARY KEY,
    track_id TEXT,
    track_path_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(track_path_json)),
    labels_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(labels_json)),
    captured_at TEXT NOT NULL,
    FOREIGN KEY (work_item_event_id) REFERENCES work_item_events(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_item_event_semantic_track
    ON work_item_event_semantic_snapshots(track_id, work_item_event_id);

CREATE TABLE IF NOT EXISTS reflection_decision_tracks (
    reflection_decision_id TEXT PRIMARY KEY,
    track_id TEXT,
    track_path_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(track_path_json)),
    FOREIGN KEY (reflection_decision_id) REFERENCES reflection_decisions(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reflection_decision_tracks_track
    ON reflection_decision_tracks(track_id, reflection_decision_id);
