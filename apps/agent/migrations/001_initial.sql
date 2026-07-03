-- Timeskein MVP Database Schema
-- Version: 001_initial

-- =============================================================================
-- Work Items
-- =============================================================================

CREATE TABLE work_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('task', 'project', 'question')),
    state TEXT NOT NULL DEFAULT 'unknown' 
        CHECK(state IN ('active', 'waiting', 'blocked', 'done', 'someday', 'unknown')),
    pinned INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen_at TEXT,
    deleted_at TEXT
);

-- Indexes for common queries
CREATE INDEX idx_work_items_state ON work_items(state) WHERE deleted_at IS NULL;
CREATE INDEX idx_work_items_pinned ON work_items(pinned DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_work_items_last_seen ON work_items(last_seen_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_work_items_deleted ON work_items(deleted_at);

-- =============================================================================
-- Refs (References to external resources)
-- =============================================================================

CREATE TABLE refs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('url', 'file_path', 'issue_key', 'custom')),
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Unique constraint for conflict detection
CREATE UNIQUE INDEX idx_refs_normalized ON refs(kind, normalized_value);

-- =============================================================================
-- Work Item Refs (Junction table)
-- =============================================================================

CREATE TABLE work_item_refs (
    work_item_id TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (work_item_id, ref_id),
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (ref_id) REFERENCES refs(id) ON DELETE CASCADE
);

CREATE INDEX idx_work_item_refs_work_item ON work_item_refs(work_item_id);
CREATE INDEX idx_work_item_refs_ref ON work_item_refs(ref_id);

-- =============================================================================
-- Work Item Events (Append-only audit log)
-- =============================================================================

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

CREATE INDEX idx_events_work_item ON work_item_events(work_item_id);
CREATE INDEX idx_events_ts ON work_item_events(ts DESC);

-- =============================================================================
-- Settings (Key-value store)
-- =============================================================================

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Insert default settings
INSERT INTO settings (key, value) VALUES ('hotkey', '"Ctrl+Shift+Space"');
INSERT INTO settings (key, value) VALUES ('theme', '"system"');

-- =============================================================================
-- Denylist Rules (Privacy protection)
-- =============================================================================

CREATE TABLE denylist_rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    policy TEXT NOT NULL CHECK(policy IN ('block', 'redact_to_domain')),
    created_at TEXT NOT NULL
);

CREATE INDEX idx_denylist_pattern ON denylist_rules(pattern);
