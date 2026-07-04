-- App Events
-- Local-only telemetry for dogfooding Timeskein itself.

CREATE TABLE IF NOT EXISTS app_events (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    source TEXT NOT NULL
        CHECK(source IN ('ui', 'agent', 'script', 'system')),
    kind TEXT NOT NULL CHECK(kind IN (
        'app_started',
        'agent_started',
        'agent_reused',
        'agent_stale_runtime_recovered',
        'window_shown',
        'window_hidden',
        'window_show_requested',
        'window_hide_requested',
        'window_drag_started',
        'focus_start_requested',
        'focus_started',
        'focus_start_failed',
        'focus_switch_requested',
        'focus_switched',
        'focus_stop_requested',
        'focus_stopped',
        'focus_stop_failed',
        'focus_correction_requested',
        'focus_corrected',
        'focus_correction_reviewed',
        'focus_correction_failed',
        'report_copy_requested',
        'report_copied',
        'report_copy_failed',
        'manual_copy_fallback_shown',
        'capture_create_requested',
        'capture_created',
        'capture_create_failed',
        'capture_resolve_requested',
        'capture_resolved',
        'capture_resolve_failed',
        'capture_update_requested',
        'capture_updated',
        'capture_update_failed',
        'capture_delete_requested',
        'capture_deleted',
        'capture_delete_failed',
        'capture_convert_requested',
        'capture_converted',
        'capture_convert_failed',
        'capture_followup_reviewed',
        'work_item_time_badges_reviewed',
        'api_error'
    )),
    work_item_id TEXT,
    focus_session_id TEXT,
    payload TEXT,
    FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
    FOREIGN KEY (focus_session_id) REFERENCES focus_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_app_events_ts
    ON app_events(ts DESC);

CREATE INDEX IF NOT EXISTS idx_app_events_kind
    ON app_events(kind);

CREATE INDEX IF NOT EXISTS idx_app_events_work_item
    ON app_events(work_item_id);

CREATE INDEX IF NOT EXISTS idx_app_events_focus_session
    ON app_events(focus_session_id);
