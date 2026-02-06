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
  state: WorkItemState;
  pinned: boolean;
  note?: string;
  refs_count: number;
  refs: RefView[];
  created_at: string;  // ISO 8601
  updated_at: string;  // ISO 8601
  last_seen_at?: string;  // ISO 8601
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
  state?: WorkItemState;
  note?: string;
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
