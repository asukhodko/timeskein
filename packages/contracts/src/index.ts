// =============================================================================
// Timeskein Contracts - Shared Types and DTOs
// =============================================================================

// -----------------------------------------------------------------------------
// Work Item Types
// -----------------------------------------------------------------------------

/**
 * Work item state representing the current status of a task
 */
export type WorkItemState =
  | "active"    // Currently working on
  | "waiting"   // Waiting for external input
  | "blocked"   // Blocked by something
  | "done"      // Completed
  | "someday"   // Maybe later
  | "unknown";  // Initial/unclassified state

/**
 * Type of work item
 */
export type WorkItemType = "task" | "project" | "question";

/**
 * Broad activity zone used for day review.
 */
export type ActivityZone = "work" | "coordination" | "recovery" | "idle" | "personal";

/**
 * Type of reference attached to a work item
 */
export type RefKind = "url" | "file_path" | "issue_key" | "custom";

/**
 * Work item view returned by the API
 */
export interface WorkItemView {
  id: string;
  title: string;
  type?: WorkItemType;
  activity_zone: ActivityZone;
  state: WorkItemState;
  pinned: boolean;
  note?: string;
  refs_count: number;
  refs: RefView[];
  today_active_seconds: number;
  total_active_seconds: number;
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
  last_seen_at?: string;  // ISO 8601
}

export type WorkItemEventKind =
  | "created"
  | "touched"
  | "state_changed"
  | "note_changed"
  | "pinned"
  | "unpinned"
  | "ref_attached"
  | "ref_removed"
  | "opened_ref"
  | "updated"
  | "note_added"
  | "deleted";

export interface WorkItemEventView {
  id: string;
  ts: string;  // ISO 8601
  work_item_id: string;
  kind: WorkItemEventKind;
  text?: string;
  focus_session_id?: string;
  payload?: Record<string, unknown>;
}

export type DayEventKind = "note_added";

export interface DayEventView {
  id: string;
  ts: string;  // ISO 8601
  kind: DayEventKind;
  text: string;
  focus_session_id?: string;
  activity_zone?: ActivityZone;
  updated_at: string;  // ISO 8601
}

// -----------------------------------------------------------------------------
// Focus Session Types
// -----------------------------------------------------------------------------

/**
 * Focus session state.
 *
 * Active sessions keep accumulating contact time until the user stops them.
 */
export type FocusSessionState = "active" | "stopped";

/**
 * Focus session view returned by the API.
 */
export interface FocusSessionView {
  id: string;
  title: string;
  work_item_id?: string;
  work_item_title?: string;
  activity_zone: ActivityZone;
  state: FocusSessionState;
  target_seconds: number;
  active_seconds: number;
  over_target_seconds: number;
  note?: string;
  started_at: string;  // ISO 8601
  stopped_at?: string;  // ISO 8601
  updated_at: string;  // ISO 8601
}

// -----------------------------------------------------------------------------
// Capture Inbox Types
// -----------------------------------------------------------------------------

/**
 * Lightweight incoming item that should not interrupt the current focus block.
 */
export type CaptureState = "open" | "resolved" | "converted";

export interface CaptureView {
  id: string;
  text: string;
  state: CaptureState;
  work_item_id?: string;
  focus_session_id?: string;
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
  resolved_at?: string;  // ISO 8601
  converted_at?: string;  // ISO 8601
}

// -----------------------------------------------------------------------------
// App Event Telemetry Types
// -----------------------------------------------------------------------------

export type AppEventSource = "ui" | "agent" | "script" | "system";

export type AppEventKind =
  | "app_started"
  | "agent_started"
  | "agent_reused"
  | "agent_stale_runtime_recovered"
  | "window_shown"
  | "window_hidden"
  | "window_show_requested"
  | "window_hide_requested"
  | "window_drag_started"
  | "focus_start_requested"
  | "focus_started"
  | "focus_start_failed"
  | "focus_switch_requested"
  | "focus_switched"
  | "focus_stop_requested"
  | "focus_stopped"
  | "focus_stop_failed"
  | "focus_correction_requested"
  | "focus_corrected"
  | "focus_correction_reviewed"
  | "focus_correction_failed"
  | "report_copy_requested"
  | "report_copied"
  | "report_copy_failed"
  | "manual_copy_fallback_shown"
  | "capture_create_requested"
  | "capture_created"
  | "capture_create_failed"
  | "capture_resolve_requested"
  | "capture_resolved"
  | "capture_resolve_failed"
  | "capture_update_requested"
  | "capture_updated"
  | "capture_update_failed"
  | "capture_delete_requested"
  | "capture_deleted"
  | "capture_delete_failed"
  | "capture_convert_requested"
  | "capture_converted"
  | "capture_convert_failed"
  | "api_error";

export interface AppEventView {
  id: string;
  ts: string;  // ISO 8601
  source: AppEventSource;
  kind: AppEventKind;
  work_item_id?: string;
  focus_session_id?: string;
  payload?: Record<string, unknown>;
}

export interface AppEventSummary {
  total: number;
  by_kind: Record<string, number>;
  by_source: Record<string, number>;
  start_requests: number;
  switch_requests: number;
  stop_requests: number;
  typed_entry_requests: number;
  selected_entry_requests: number;
  start_failures: number;
  stop_failures: number;
  correction_requests: number;
  corrections: number;
  correction_reviews: number;
  correction_failures: number;
  api_errors: number;
  copy_failures: number;
  manual_copy_fallbacks: number;
  capture_create_requests: number;
  capture_created: number;
  capture_create_failures: number;
  capture_resolve_requests: number;
  capture_resolved: number;
  capture_resolve_failures: number;
  capture_update_requests: number;
  capture_updated: number;
  capture_update_failures: number;
  capture_delete_requests: number;
  capture_deleted: number;
  capture_delete_failures: number;
  capture_convert_requests: number;
  capture_converted: number;
  capture_convert_failures: number;
  window_shown: number;
  window_hidden: number;
  window_show_requested: number;
  window_hide_requested: number;
  window_drag_started: number;
  stale_runtime_recoveries: number;
  already_active_start_attempts: number;
  average_focus_start_latency_ms?: number;
  slow_window_to_focus_count: number;
  updated_at: string;
}

/**
 * Reference view returned by the API
 */
export interface RefView {
  id: string;
  kind: RefKind;
  value: string;
  is_primary: boolean;
}

// -----------------------------------------------------------------------------
// API Request/Response Types
// -----------------------------------------------------------------------------

/**
 * API request envelope
 */
export interface ApiRequest<P = Record<string, unknown>> {
  version: string;
  request_id: string;
  method: string;
  params?: P;
}

/**
 * API response envelope (success case)
 */
export interface ApiSuccessResponse<T = unknown> {
  version: string;
  request_id: string;
  result: T;
}

/**
 * API response envelope (error case)
 */
export interface ApiErrorResponse {
  version: string;
  request_id: string;
  error: ApiError;
}

/**
 * Union type for API response
 */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Type guard to check if response is an error
 */
export function isApiError(response: ApiResponse): response is ApiErrorResponse {
  return 'error' in response;
}

/**
 * API error structure
 */
export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface CaptureListResponse {
  captures: CaptureView[];
  total: number;
  updated_at: string;
}

export interface CaptureConvertResponse {
  capture: CaptureView;
  work_item_id: string;
  reused: boolean;
}

export interface CaptureAppendEventResponse {
  capture: CaptureView;
  event: WorkItemEventView;
  work_item_id: string;
}

export interface CaptureDeleteResponse {
  success: boolean;
  id: string;
}

/**
 * Standard error codes
 */
export type ErrorCode =
  | "validation_error"   // Invalid input data
  | "not_found"          // Resource not found
  | "conflict"           // Conflict (e.g., ref already attached)
  | "privacy_blocked"    // Blocked by privacy policy
  | "internal_error"     // Internal server error
  | "version_mismatch";  // API version incompatibility

// -----------------------------------------------------------------------------
// Agent Status Types
// -----------------------------------------------------------------------------

/**
 * Agent status information
 */
export interface AgentStatus {
  version: string;
  api_version: string;
  uptime_seconds: number;
  work_items_count: number;
  storage_path: string;
  db_ok: boolean;
}

/**
 * Agent version information
 */
export interface VersionInfo {
  agent_version: string;
  api_version: string;
  build_date?: string;
}

// -----------------------------------------------------------------------------
// Settings Types
// -----------------------------------------------------------------------------

/**
 * Application settings
 */
export interface Settings {
  hotkey: string;
  theme?: "light" | "dark" | "system";
}

/**
 * Denylist rule for privacy protection
 */
export interface DenylistRule {
  id: string;
  pattern: string;
  policy: DenylistPolicy;
  created_at: string;
}

/**
 * Denylist policy type
 */
export type DenylistPolicy = "block" | "redact_to_domain";

// -----------------------------------------------------------------------------
// API Method Parameters
// -----------------------------------------------------------------------------

// inventory.list parameters
export interface InventoryListParams {
  filter?: {
    state?: WorkItemState[];
    pinned?: boolean;
    search?: string;
  };
  focus_window?: {
    from?: string;  // ISO 8601
    to?: string;  // ISO 8601
  };
  sort?: {
    field: "last_seen_at" | "created_at" | "updated_at" | "title";
    order: "asc" | "desc";
  };
  pagination?: {
    offset: number;
    limit: number;
  };
}

// work_item.create parameters
export interface WorkItemCreateParams {
  title: string;
  type?: WorkItemType;
  activity_zone?: ActivityZone;
  state?: WorkItemState;
  note?: string;
}

export interface WorkItemCreateResponse {
  id: string;
  focus_session_id?: string;
  reused: boolean;
}

export interface WorkItemDeleteResponse {
  success: boolean;
  stopped_focus_session_id?: string;
}

// work_item.update parameters
export interface WorkItemUpdateParams {
  id: string;
  title?: string;
  type?: WorkItemType;
  activity_zone?: ActivityZone;
  note?: string | null;
}

export interface WorkItemAddEventParams {
  id: string;
  text: string;
  focus_session_id?: string;
}

export interface WorkItemUpdateEventParams {
  id: string;
  text: string;
}

export interface WorkItemDeleteEventResponse {
  success: boolean;
  id: string;
}

export interface WorkItemEventsParams {
  id?: string;
  from?: string;  // ISO 8601
  to?: string;  // ISO 8601
}

export interface WorkItemEventsResponse {
  events: WorkItemEventView[];
  total: number;
  updated_at: string;
}

export interface DayEventAddParams {
  text: string;
  focus_session_id?: string;
  activity_zone?: ActivityZone;
}

export interface DayEventListParams {
  from?: string;  // ISO 8601
  to?: string;  // ISO 8601
}

export interface DayEventUpdateParams {
  id: string;
  text: string;
  activity_zone?: ActivityZone | null;
}

export interface DayEventDeleteResponse {
  success: boolean;
  id: string;
}

export interface DayEventListResponse {
  events: DayEventView[];
  total: number;
  updated_at: string;
}

// focus.start parameters
export interface FocusStartParams {
  title: string;
  work_item_id?: string;
  target_seconds?: number;
  telemetry_action_id?: string;
}

// focus.stop parameters
export interface FocusStopParams {
  id?: string;
  note?: string;
  telemetry_action_id?: string;
}

// focus.update parameters
export interface FocusUpdateParams {
  id: string;
  title?: string;
  work_item_id?: string | null;
  activity_zone?: ActivityZone;
  target_seconds?: number;
  note?: string | null;
  started_at?: string;  // ISO 8601
  stopped_at?: string;  // ISO 8601
}

// focus.create_stopped parameters
export interface FocusCreateStoppedParams {
  title?: string;
  work_item_id?: string;
  activity_zone?: ActivityZone;
  target_seconds?: number;
  note?: string | null;
  started_at: string;  // ISO 8601
  stopped_at: string;  // ISO 8601
}

// focus.split parameters
export interface FocusSplitParams {
  id: string;
  split_at: string;  // ISO 8601
  right_title?: string;
  right_work_item_id?: string | null;
  right_note?: string | null;
}

export interface FocusSplitResponse {
  left: FocusSessionView;
  right: FocusSessionView;
}

// focus.list parameters
export interface FocusListParams {
  from?: string;  // ISO 8601
  to?: string;  // ISO 8601
}

// app_event.log parameters
export interface AppEventLogParams {
  source?: AppEventSource;
  kind: AppEventKind;
  work_item_id?: string;
  focus_session_id?: string;
  payload?: Record<string, unknown>;
}

// app_event.list / app_event.summary parameters
export interface AppEventListParams {
  from?: string;  // ISO 8601
  to?: string;  // ISO 8601
}

// work_item.set_state parameters
export interface WorkItemSetStateParams {
  id: string;
  state: WorkItemState;
}

// work_item.set_note parameters
export interface WorkItemSetNoteParams {
  id: string;
  note: string;
}

// ref.add parameters
export interface RefAddParams {
  work_item_id: string;
  kind: RefKind;
  value: string;
  is_primary?: boolean;
}

// ref.remove parameters
export interface RefRemoveParams {
  work_item_id: string;
  ref_id: string;
}

// ref.open parameters
export interface RefOpenParams {
  work_item_id: string;
  ref_id?: string;  // If not provided, opens primary ref
}

// ref.check_conflict parameters
export interface RefCheckConflictParams {
  kind: RefKind;
  value: string;
}

// settings.add_to_denylist parameters
export interface DenylistAddParams {
  pattern: string;
  policy: DenylistPolicy;
}

// -----------------------------------------------------------------------------
// API Method Responses
// -----------------------------------------------------------------------------

// inventory.list response
export interface InventoryListResponse {
  items: WorkItemView[];
  total: number;
  updated_at: string;  // Watermark for polling
}

// focus.current response
export interface FocusCurrentResponse {
  session?: FocusSessionView;
}

// focus.list response
export interface FocusListResponse {
  sessions: FocusSessionView[];
  total: number;
  active_seconds_total: number;
  updated_at: string;  // Watermark for polling
}

// app_event.list response
export interface AppEventListResponse {
  events: AppEventView[];
  total: number;
  updated_at: string;
}

// ref.add conflict error details
export interface RefConflictDetails {
  conflict_type: "ref_already_attached";
  existing_work_item: {
    id: string;
    title: string;
  };
  options: ("attach_anyway" | "open_existing" | "cancel")[];
}

// ref.check_conflict response
export interface RefCheckConflictResponse {
  exists: boolean;
  existing_work_item?: {
    id: string;
    title: string;
  };
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * Current API version
 */
export const API_VERSION = "1.0";

/**
 * State priority for sorting (lower = higher priority)
 */
export const STATE_PRIORITY: Record<WorkItemState, number> = {
  active: 1,
  blocked: 2,
  waiting: 3,
  unknown: 4,
  someday: 5,
  done: 6,
};

/**
 * State display labels
 */
export const STATE_LABELS: Record<WorkItemState, string> = {
  active: "Active",
  blocked: "Blocked",
  waiting: "Waiting",
  unknown: "Unknown",
  someday: "Someday",
  done: "Done",
};

/**
 * State colors for UI
 */
export const STATE_COLORS: Record<WorkItemState, string> = {
  active: "#22c55e",   // green
  blocked: "#ef4444",  // red
  waiting: "#f59e0b",  // amber
  unknown: "#6b7280",  // gray
  someday: "#8b5cf6",  // purple
  done: "#3b82f6",     // blue
};

/**
 * Default hotkey
 */
export const DEFAULT_HOTKEY = {
  windows: "Ctrl+Shift+Space",
  macos: "Cmd+Shift+Space",
};
