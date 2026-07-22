-- Working Memory Bridge v1
-- Historical working-memory entries, stages, focus snapshots, aliases, and
-- explicit overflow beyond the protected day-contract WIP.

CREATE TABLE IF NOT EXISTS work_item_stages (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    position INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'planned'
        CHECK(state IN ('planned', 'active', 'completed', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    deleted_at TEXT,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_item_stages_item
    ON work_item_stages(work_item_id, position, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_item_stages_single_active
    ON work_item_stages(work_item_id)
    WHERE state = 'active' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS work_item_stage_events (
    id TEXT PRIMARY KEY,
    stage_id TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    kind TEXT NOT NULL
        CHECK(kind IN ('created', 'renamed', 'activated', 'completed', 'archived', 'reopened', 'reordered', 'deleted')),
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)),
    FOREIGN KEY (stage_id) REFERENCES work_item_stages(id) ON DELETE CASCADE,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_item_stage_events_stage
    ON work_item_stage_events(stage_id, datetime(recorded_at));

CREATE INDEX IF NOT EXISTS idx_work_item_stage_events_item
    ON work_item_stage_events(work_item_id, datetime(occurred_at));

CREATE TABLE IF NOT EXISTS work_memory_entries (
    id TEXT PRIMARY KEY,
    subject_kind TEXT NOT NULL CHECK(subject_kind IN ('work_item', 'track')),
    subject_id TEXT NOT NULL,
    work_item_id TEXT,
    track_id TEXT,
    work_item_title_snapshot TEXT,
    focus_session_id TEXT,
    stage_id TEXT,
    day_contract_revision_id TEXT,
    local_date TEXT,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('user', 'system', 'legacy', 'import')),
    provenance TEXT NOT NULL
        CHECK(provenance IN ('confirmed', 'observed', 'derived', 'legacy_current', 'imported')),
    origin_kind TEXT NOT NULL DEFAULT 'manual'
        CHECK(origin_kind IN ('manual', 'focus_stop', 'day_contract', 'capture', 'legacy_event', 'import')),
    origin_ref TEXT,
    track_snapshot_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(track_snapshot_json)),
    labels_snapshot_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(labels_snapshot_json)),
    current_revision_number INTEGER NOT NULL DEFAULT 1 CHECK(current_revision_number >= 1),
    deleted_at TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version >= 1),
    CHECK(
        (subject_kind = 'work_item' AND work_item_id IS NOT NULL)
        OR (subject_kind = 'track' AND track_id IS NOT NULL)
    ),
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL,
    FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (stage_id) REFERENCES work_item_stages(id) ON DELETE SET NULL,
    FOREIGN KEY (day_contract_revision_id) REFERENCES day_contract_revisions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_memory_entries_subject
    ON work_memory_entries(subject_kind, subject_id, datetime(occurred_at), datetime(recorded_at));

CREATE INDEX IF NOT EXISTS idx_work_memory_entries_item
    ON work_memory_entries(work_item_id, datetime(occurred_at) DESC);

CREATE INDEX IF NOT EXISTS idx_work_memory_entries_track
    ON work_memory_entries(track_id, datetime(occurred_at) DESC);

CREATE INDEX IF NOT EXISTS idx_work_memory_entries_focus
    ON work_memory_entries(focus_session_id, datetime(occurred_at));

CREATE INDEX IF NOT EXISTS idx_work_memory_entries_stage
    ON work_memory_entries(stage_id, datetime(occurred_at));

CREATE TABLE IF NOT EXISTS work_memory_entry_revisions (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL CHECK(revision_number >= 1),
    change_kind TEXT NOT NULL CHECK(change_kind IN ('create', 'edit', 'delete', 'restore')),
    entry_kind TEXT NOT NULL
        CHECK(entry_kind IN (
            'thought', 'question', 'decision', 'observation', 'result',
            'next_action', 'material', 'state_change'
        )),
    text TEXT,
    material_kind TEXT
        CHECK(material_kind IS NULL OR material_kind IN ('text', 'url', 'file_path')),
    material_value TEXT,
    change_note TEXT,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('user', 'system', 'legacy', 'import')),
    provenance TEXT NOT NULL
        CHECK(provenance IN ('confirmed', 'observed', 'derived', 'legacy_current', 'imported')),
    UNIQUE(entry_id, revision_number),
    FOREIGN KEY (entry_id) REFERENCES work_memory_entries(id) ON DELETE CASCADE,
    CHECK(entry_kind <> 'material' OR material_kind IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_work_memory_revisions_entry
    ON work_memory_entry_revisions(entry_id, revision_number);

CREATE TABLE IF NOT EXISTS focus_session_work_snapshots (
    focus_session_id TEXT PRIMARY KEY,
    work_item_id TEXT,
    work_item_title TEXT,
    stage_id TEXT,
    stage_title TEXT,
    daily_outcome TEXT,
    day_contract_revision_id TEXT,
    captured_at TEXT NOT NULL,
    provenance TEXT NOT NULL DEFAULT 'confirmed'
        CHECK(provenance IN ('confirmed', 'derived', 'legacy_current')),
    FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
    FOREIGN KEY (stage_id) REFERENCES work_item_stages(id) ON DELETE SET NULL,
    FOREIGN KEY (day_contract_revision_id) REFERENCES day_contract_revisions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_focus_work_snapshots_stage
    ON focus_session_work_snapshots(stage_id, focus_session_id);

CREATE TABLE IF NOT EXISTS work_item_aliases (
    source_work_item_id TEXT PRIMARY KEY,
    canonical_work_item_id TEXT NOT NULL,
    source_title_snapshot TEXT NOT NULL,
    merged_at TEXT NOT NULL,
    merge_reason TEXT,
    FOREIGN KEY (source_work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    FOREIGN KEY (canonical_work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
    CHECK(source_work_item_id <> canonical_work_item_id)
);

CREATE INDEX IF NOT EXISTS idx_work_item_aliases_canonical
    ON work_item_aliases(canonical_work_item_id, merged_at);

CREATE TABLE IF NOT EXISTS day_contract_overflow_subjects (
    day_contract_revision_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    subject_snapshot_json TEXT NOT NULL CHECK(json_valid(subject_snapshot_json)),
    PRIMARY KEY (day_contract_revision_id, ordinal),
    FOREIGN KEY (day_contract_revision_id) REFERENCES day_contract_revisions(id) ON DELETE CASCADE
);

-- Import the existing timestamped Work Item journal as legacy working memory.
-- The immutable first revision preserves the text visible when this migration
-- first runs; later edits use explicit revisions.
INSERT OR IGNORE INTO work_memory_entries (
    id, subject_kind, subject_id, work_item_id, track_id,
    work_item_title_snapshot, focus_session_id, local_date,
    occurred_at, recorded_at, updated_at, source, provenance,
    origin_kind, origin_ref, track_snapshot_json, labels_snapshot_json,
    current_revision_number, schema_version
)
SELECT
    wie.id,
    'work_item',
    wie.work_item_id,
    wie.work_item_id,
    wis.track_id,
    wi.title,
    COALESCE(ee.focus_session_id, json_extract(wie.payload, '$.focus_session_id')),
    date(datetime(wie.ts), 'localtime'),
    wie.ts,
    COALESCE(ee.captured_at, wie.ts),
    COALESCE(ee.captured_at, wie.ts),
    'legacy',
    'legacy_current',
    'legacy_event',
    wie.id,
    COALESCE(wis.track_path_json, '[]'),
    COALESCE(wis.labels_json, '[]'),
    1,
    1
FROM work_item_events wie
JOIN work_items wi ON wi.id = wie.work_item_id
LEFT JOIN evidence_entries ee ON ee.work_item_event_id = wie.id
LEFT JOIN work_item_event_semantic_snapshots wis ON wis.work_item_event_id = wie.id
WHERE wie.kind = 'note_added';

INSERT OR IGNORE INTO work_memory_entry_revisions (
    id, entry_id, revision_number, change_kind, entry_kind, text,
    created_at, source, provenance
)
SELECT
    wie.id,
    wie.id,
    1,
    'create',
    CASE ee.evidence_kind
        WHEN 'result' THEN 'result'
        WHEN 'decision' THEN 'decision'
        WHEN 'next_step' THEN 'next_action'
        WHEN 'blocker' THEN 'question'
        ELSE 'observation'
    END,
    json_extract(wie.payload, '$.text'),
    COALESCE(ee.captured_at, wie.ts),
    'legacy',
    'legacy_current'
FROM work_item_events wie
LEFT JOIN evidence_entries ee ON ee.work_item_event_id = wie.id
WHERE wie.kind = 'note_added';
