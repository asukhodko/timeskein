-- Operational Workspace v1
-- Append-only, item-backed day contracts with immutable historical snapshots.

CREATE TABLE IF NOT EXISTS day_contract_revisions (
    id TEXT PRIMARY KEY,
    local_date TEXT NOT NULL,
    revision_number INTEGER NOT NULL CHECK(revision_number >= 1),
    revision_kind TEXT NOT NULL
        CHECK(revision_kind IN ('morning', 'reentry', 'adjustment')),
    active_subjects_json TEXT NOT NULL CHECK(json_valid(active_subjects_json)),
    first_action_work_item_id TEXT NOT NULL,
    first_action_snapshot_json TEXT NOT NULL CHECK(json_valid(first_action_snapshot_json)),
    parked_subjects_json TEXT NOT NULL CHECK(json_valid(parked_subjects_json)),
    why_now TEXT NOT NULL CHECK(length(trim(why_now)) > 0),
    created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('user', 'system')),
    provenance TEXT NOT NULL DEFAULT 'confirmed'
        CHECK(provenance IN ('confirmed', 'derived')),
    supersedes_id TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version >= 1),
    UNIQUE(local_date, revision_number),
    FOREIGN KEY (supersedes_id) REFERENCES day_contract_revisions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_day_contract_revisions_date
    ON day_contract_revisions(local_date, revision_number DESC);

CREATE INDEX IF NOT EXISTS idx_day_contract_revisions_supersedes
    ON day_contract_revisions(supersedes_id);
