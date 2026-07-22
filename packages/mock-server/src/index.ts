import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import {
  API_VERSION,
  type ApiSuccessResponse,
  type ApiErrorResponse,
  type ApiError,
  type WorkItemState,
  type RefKind,
  type CaptureState,
  type AppEventKind,
  type AppEventSource,
  type ActivityZone,
  type OperationalState,
  type OperationalSubjectKind,
  type DayContractReviseParams,
  type ContextPackProfile,
  type ContextPackView,
  type WorkMemoryCreateParams,
  type WorkMemoryEntryKind,
  type WorkMemoryListParams,
  type WorkMemoryUpdateParams,
} from "@timeskein/contracts";
import { MockDataStore } from "./fixtures";

// -----------------------------------------------------------------------------
// Server Setup
// -----------------------------------------------------------------------------

const app: Express = express();
const PORT = process.env.PORT || 3456;

app.use(cors());
app.use(express.json());

const store = new MockDataStore();

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

function successResponse<T>(requestId: string, result: T): ApiSuccessResponse<T> {
  return {
    version: API_VERSION,
    request_id: requestId,
    result,
  };
}

function errorResponse(
  requestId: string,
  code: ApiError["code"],
  message: string,
  details?: Record<string, unknown>
): ApiErrorResponse {
  return {
    version: API_VERSION,
    request_id: requestId,
    error: { code, message, details },
  };
}

const APP_EVENT_KINDS = new Set<string>([
  "app_started",
  "agent_started",
  "agent_reused",
  "agent_stale_runtime_recovered",
  "window_shown",
  "window_hidden",
  "window_show_requested",
  "window_hide_requested",
  "window_drag_started",
  "focus_start_requested",
  "focus_started",
  "focus_start_failed",
  "focus_switch_requested",
  "focus_switched",
  "focus_stop_requested",
  "focus_stopped",
  "focus_stop_failed",
  "focus_correction_requested",
  "focus_corrected",
  "focus_correction_reviewed",
  "focus_correction_failed",
  "day_closure_started",
  "day_closure_completed",
  "day_contract_created",
  "day_contract_revised",
  "day_contract_start_requested",
  "day_contract_started",
  "day_contract_start_failed",
  "day_contract_reentry_reviewed",
  "report_copy_requested",
  "report_copied",
  "report_copy_failed",
  "manual_copy_fallback_shown",
  "capture_create_requested",
  "capture_created",
  "capture_create_failed",
  "capture_resolve_requested",
  "capture_resolved",
  "capture_resolve_failed",
  "capture_update_requested",
  "capture_updated",
  "capture_update_failed",
  "capture_delete_requested",
  "capture_deleted",
  "capture_delete_failed",
  "capture_convert_requested",
  "capture_converted",
  "capture_convert_failed",
  "capture_followup_reviewed",
  "work_item_time_badges_reviewed",
  "activity_zone_reviewed",
  "capture_usage_reviewed",
  "entry_paths_reviewed",
  "window_entrypoints_reviewed",
  "working_memory_opened",
  "working_memory_created",
  "working_memory_updated",
  "working_memory_deleted",
  "work_item_stage_changed",
  "context_pack_built",
  "context_pack_exported",
  "reentry_started",
  "work_item_merged",
  "day_contract_outcome_recorded",
  "day_contract_overflow_recorded",
  "api_error",
]);

const APP_EVENT_SOURCES = new Set<string>(["ui", "agent", "script", "system"]);
const ACTIVITY_ZONES = new Set<string>(["work", "coordination", "recovery", "idle", "personal"]);
const OPERATIONAL_SUBJECT_KINDS = new Set<string>(["work_item", "track", "capture"]);
const OPERATIONAL_STATES = new Set<string>([
  "active",
  "waiting",
  "blocked",
  "parked",
  "reactive",
  "completed",
  "stale-important",
  "meeting-tail",
  "unknown",
]);

function isAppEventKind(value: unknown): value is AppEventKind {
  return typeof value === "string" && APP_EVENT_KINDS.has(value);
}

function isAppEventSource(value: unknown): value is AppEventSource {
  return typeof value === "string" && APP_EVENT_SOURCES.has(value);
}

function isActivityZone(value: unknown): value is ActivityZone {
  return typeof value === "string" && ACTIVITY_ZONES.has(value);
}

function isOperationalSubjectKind(value: unknown): value is OperationalSubjectKind {
  return typeof value === "string" && OPERATIONAL_SUBJECT_KINDS.has(value);
}

function isOperationalState(value: unknown): value is OperationalState {
  return typeof value === "string" && OPERATIONAL_STATES.has(value);
}

// -----------------------------------------------------------------------------
// API Route Handler
// -----------------------------------------------------------------------------

interface RpcBody {
  version?: string;
  request_id?: string;
  method: string;
  params?: Record<string, unknown>;
}

app.post("/api", (req: Request, res: Response) => {
  const body = req.body as RpcBody;
  const requestId = body.request_id || uuidv4();
  const method = body.method;

  if (!method) {
    return res.json(errorResponse(requestId, "validation_error", "Method is required"));
  }

  try {
    const result = handleMethod(method, body.params || {}, requestId);
    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.json(errorResponse(requestId, "internal_error", message));
  }
});

function handleMethod(
  method: string,
  params: Record<string, unknown>,
  requestId: string
): ApiSuccessResponse<unknown> | ApiErrorResponse {
  switch (method) {
    // Agent methods
    case "agent.ping":
      return successResponse(requestId, "pong");

    case "agent.status":
      return successResponse(requestId, {
        version: "0.1.0",
        api_version: API_VERSION,
        uptime_seconds: store.getUptime(),
        work_items_count: store.getWorkItemCount(),
        storage_path: "/mock/data/path",
        db_ok: true,
      });

    case "agent.version":
      return successResponse(requestId, {
        agent_version: "0.1.0",
        api_version: API_VERSION,
        build_date: new Date().toISOString().split("T")[0],
      });

    case "app_event.log": {
      if (!isAppEventKind(params.kind)) {
        return errorResponse(requestId, "validation_error", "Valid app event kind is required");
      }

      const source = params.source;
      if (source !== undefined && !isAppEventSource(source)) {
        return errorResponse(requestId, "validation_error", "Valid app event source is required");
      }

      return successResponse(requestId, store.logAppEvent({
        source,
        kind: params.kind,
        work_item_id: params.work_item_id as string | undefined,
        focus_session_id: params.focus_session_id as string | undefined,
        payload: params.payload as Record<string, unknown> | undefined,
      }));
    }

    case "app_event.list": {
      const events = store.listAppEvents(params.from as string | undefined, params.to as string | undefined);
      return successResponse(requestId, {
        events,
        total: events.length,
        updated_at: new Date().toISOString(),
      });
    }

    case "app_event.summary":
      return successResponse(requestId, store.summarizeAppEvents(
        params.from as string | undefined,
        params.to as string | undefined
      ));

    case "capture.create": {
      const text = params.text as string;
      if (!text || text.trim() === "") {
        return errorResponse(requestId, "validation_error", "Capture text is required");
      }

      return successResponse(requestId, store.createCapture({
        text,
        focus_session_id: params.focus_session_id as string | undefined,
      }));
    }

    case "capture.list": {
      const stateFilter = params.state as CaptureState[] | undefined;
      const captures = store.listCaptures(stateFilter);
      return successResponse(requestId, {
        captures,
        total: captures.length,
        updated_at: new Date().toISOString(),
      });
    }

    case "capture.resolve": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Capture ID is required");
      }

      const capture = store.resolveCapture(id);
      if (!capture) {
        return errorResponse(requestId, "not_found", "Open capture not found");
      }

      return successResponse(requestId, capture);
    }

    case "capture.update": {
      const id = params.id as string;
      const text = params.text as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Capture ID is required");
      }
      if (!text || text.trim() === "") {
        return errorResponse(requestId, "validation_error", "Capture text is required");
      }

      const capture = store.updateCapture(id, text);
      if (!capture) {
        return errorResponse(requestId, "not_found", "Open capture not found");
      }

      return successResponse(requestId, capture);
    }

    case "capture.delete": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Capture ID is required");
      }

      const deleted = store.deleteCapture(id);
      if (deleted === undefined) {
        return errorResponse(requestId, "not_found", "Capture not found");
      }
      if (!deleted) {
        return errorResponse(requestId, "validation_error", "Capture is already processed");
      }

      return successResponse(requestId, {
        success: true,
        id,
      });
    }

    case "capture.convert_to_work_item": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Capture ID is required");
      }

      const result = store.convertCaptureToWorkItem(id, params.title as string | undefined);
      if (!result.capture) {
        return errorResponse(requestId, "not_found", "Capture not found");
      }
      if (!result.workItemId) {
        return errorResponse(requestId, "validation_error", "Capture is already processed");
      }

      return successResponse(requestId, {
        capture: result.capture,
        event: result.event,
        work_item_id: result.workItemId,
        reused: result.reused,
      });
    }

    case "capture.append_to_work_item_event": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Capture ID is required");
      }

      const result = store.appendCaptureToWorkItemEvent(id, params.work_item_id as string | undefined);
      if (!result.capture) {
        return errorResponse(requestId, "not_found", "Capture not found");
      }
      if (!result.event || !result.workItemId) {
        return errorResponse(requestId, "validation_error", "Capture cannot be appended without a Work Item");
      }

      return successResponse(requestId, {
        capture: result.capture,
        event: result.event,
        work_item_id: result.workItemId,
      });
    }

    case "day_event.add": {
      const text = params.text as string;
      if (!text || text.trim() === "") {
        return errorResponse(requestId, "validation_error", "Day event text is required");
      }

      const focusSessionId = params.focus_session_id as string | undefined;
      if (focusSessionId && !store.hasFocusSession(focusSessionId)) {
        return errorResponse(requestId, "not_found", "Focus session not found");
      }

      const activityZone = params.activity_zone;
      if (activityZone !== undefined && !isActivityZone(activityZone)) {
        return errorResponse(requestId, "validation_error", "Valid activity zone is required");
      }

      const event = store.addDayEvent({
        text,
        focus_session_id: focusSessionId,
        activity_zone: activityZone,
      });
      if (!event) {
        return errorResponse(requestId, "validation_error", "Day event cannot be created");
      }
      return successResponse(requestId, event);
    }

    case "day_event.list": {
      const events = store.listDayEvents({
        from: params.from as string | undefined,
        to: params.to as string | undefined,
      });
      return successResponse(requestId, {
        events,
        total: events.length,
        updated_at: new Date().toISOString(),
      });
    }

    case "day_event.update": {
      const id = params.id as string;
      const text = params.text as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Day event ID is required");
      }
      if (!text || text.trim() === "") {
        return errorResponse(requestId, "validation_error", "Day event text is required");
      }

      const activityZone = params.activity_zone;
      if (activityZone !== undefined && activityZone !== null && !isActivityZone(activityZone)) {
        return errorResponse(requestId, "validation_error", "Valid activity zone is required");
      }

      const event = store.updateDayEvent(id, {
        text,
        activity_zone: activityZone as ActivityZone | null | undefined,
      });
      if (!event) {
        return errorResponse(requestId, "not_found", "Day event not found");
      }
      return successResponse(requestId, event);
    }

    case "day_event.delete": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Day event ID is required");
      }

      if (!store.deleteDayEvent(id)) {
        return errorResponse(requestId, "not_found", "Day event not found");
      }

      return successResponse(requestId, { success: true, id });
    }

    case "taxonomy.list":
      return successResponse(requestId, store.listTaxonomy(Boolean(params.include_archived)));

    case "track.create": {
      const title = typeof params.title === "string" ? params.title.trim() : "";
      if (!title) return errorResponse(requestId, "validation_error", "Title is required");
      return successResponse(requestId, store.createTrack(title, params.parent_track_id as string | undefined));
    }

    case "track.update": {
      const id = params.id as string;
      const track = store.updateTrack(id, {
        title: typeof params.title === "string" ? params.title : undefined,
        parent_track_id: params.parent_track_id as string | null | undefined,
      });
      return track
        ? successResponse(requestId, track)
        : errorResponse(requestId, "not_found", "Track not found");
    }

    case "track.archive": {
      const track = store.archiveTrack(params.id as string, params.archived !== false);
      return track
        ? successResponse(requestId, track)
        : errorResponse(requestId, "not_found", "Track not found");
    }

    case "label.create": {
      const title = typeof params.title === "string" ? params.title.trim() : "";
      if (!title) return errorResponse(requestId, "validation_error", "Title is required");
      return successResponse(requestId, store.createLabel(title));
    }

    case "label.update": {
      const title = typeof params.title === "string" ? params.title.trim() : "";
      if (!title) return errorResponse(requestId, "validation_error", "Title is required");
      const label = store.updateLabel(params.id as string, title);
      return label
        ? successResponse(requestId, label)
        : errorResponse(requestId, "not_found", "Label not found");
    }

    case "label.archive": {
      const label = store.archiveLabel(params.id as string, params.archived !== false);
      return label
        ? successResponse(requestId, label)
        : errorResponse(requestId, "not_found", "Label not found");
    }

    // Inventory methods
    case "inventory.list": {
      const search = params.filter && typeof params.filter === "object"
        ? (params.filter as Record<string, unknown>).search as string | undefined
        : undefined;
      const stateFilter = params.filter && typeof params.filter === "object"
        ? (params.filter as Record<string, unknown>).state as WorkItemState[] | undefined
        : undefined;
      const focusWindow = params.focus_window && typeof params.focus_window === "object"
        ? params.focus_window as { from?: string; to?: string }
        : undefined;

      const items = store.listWorkItems(search, stateFilter, focusWindow);
      return successResponse(requestId, {
        items,
        total: items.length,
        updated_at: new Date().toISOString(),
      });
    }

    case "inventory.get": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }
      const item = store.getWorkItem(id);
      if (!item) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, item);
    }

    // Work item methods
    case "work_item.create": {
      const title = params.title as string;
      if (!title || title.trim() === "") {
        return errorResponse(requestId, "validation_error", "Title is required");
      }
      const existing = store.findWorkItemByTitle(title);
      const item = store.createWorkItem(
        title,
        params.type as "task" | "project" | "question" | undefined,
        params.state as WorkItemState | undefined,
        params.activity_zone as ActivityZone | undefined,
        params.note as string | undefined,
        params.track_id as string | null | undefined,
        params.label_ids as string[] | undefined
      );
      return successResponse(requestId, {
        id: item.id,
        focus_session_id: params.state === "active" ? store.getActiveFocusSession()?.id : undefined,
        reused: Boolean(existing),
      });
    }

    case "work_item.touch": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }
      if (!store.touchWorkItem(id)) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, { success: true });
    }

    case "work_item.set_state": {
      const id = params.id as string;
      const state = params.state as WorkItemState;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }
      if (!state) {
        return errorResponse(requestId, "validation_error", "State is required");
      }
      if (!store.setWorkItemState(id, state)) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, {
        success: true,
        focus_session_id: state === "active" ? store.getActiveFocusSession()?.id : undefined,
      });
    }

    case "work_item.set_note": {
      const id = params.id as string;
      const note = params.note as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }
      if (!store.setWorkItemNote(id, note || "")) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, { success: true });
    }

    case "work_item.add_event": {
      const id = params.id as string;
      const text = params.text as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }
      if (!text || !text.trim()) {
        return errorResponse(requestId, "validation_error", "Event text is required");
      }

      const event = store.addWorkItemEvent({
        id,
        text,
        focus_session_id: params.focus_session_id as string | undefined,
        evidence_kind: params.evidence_kind as import("@timeskein/contracts").EvidenceKind | undefined,
        ref_ids: params.ref_ids as string[] | undefined,
        new_ref: params.new_ref as import("@timeskein/contracts").WorkItemAddEventParams["new_ref"],
      });
      if (!event) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, event);
    }

    case "work_item.events": {
      const events = store.listWorkItemEvents({
        id: params.id as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
      });
      return successResponse(requestId, {
        events,
        total: events.length,
        updated_at: new Date().toISOString(),
      });
    }

    case "work_item.update_event": {
      const id = params.id as string;
      const text = params.text as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item event ID is required");
      }
      if (!text || !text.trim()) {
        return errorResponse(requestId, "validation_error", "Event text is required");
      }

      const event = store.updateWorkItemEvent(
        id,
        text,
        params.evidence_kind as import("@timeskein/contracts").EvidenceKind | undefined,
      );
      if (!event) {
        return errorResponse(requestId, "not_found", "Editable Work item event not found");
      }
      return successResponse(requestId, event);
    }

    case "work_item.delete_event": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item event ID is required");
      }

      if (!store.deleteWorkItemEvent(id)) {
        return errorResponse(requestId, "not_found", "Editable Work item event not found");
      }
      return successResponse(requestId, { success: true, id });
    }

    case "work_item.update": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }

      const title = typeof params.title === "string" ? params.title.trim() : undefined;
      if (params.title !== undefined && !title) {
        return errorResponse(requestId, "validation_error", "Title cannot be empty");
      }

      const duplicate = title ? store.findWorkItemByTitle(title) : undefined;
      if (duplicate && duplicate.id !== id) {
        return errorResponse(requestId, "validation_error", "A work item with this title already exists");
      }

      const item = store.updateWorkItem(id, {
        title,
        type: params.type as "task" | "project" | "question" | null | undefined,
        activity_zone: params.activity_zone as ActivityZone | undefined,
        note: params.note as string | null | undefined,
        track_id: params.track_id as string | null | undefined,
        label_ids: params.label_ids as string[] | undefined,
      });
      if (!item) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, item);
    }

    case "work_item.set_semantics": {
      const semantics = store.setWorkItemSemantics(
        params.id as string,
        params.track_id as string | null | undefined,
        params.label_ids as string[] | undefined
      );
      return semantics
        ? successResponse(requestId, semantics)
        : errorResponse(requestId, "not_found", "Work item not found");
    }

    case "work_item.toggle_pin": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }
      if (!store.toggleWorkItemPin(id)) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, { success: true });
    }

    case "work_item.delete": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }
      const result = store.deleteWorkItem(id);
      if (!result.deleted) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, {
        success: true,
        stopped_focus_session_id: result.stoppedFocusSessionId,
      });
    }

    case "work_item.merge": {
      const sourceId = params.source_id as string;
      const canonicalId = params.canonical_id as string;
      if (!sourceId || !canonicalId) {
        return errorResponse(requestId, "validation_error", "source_id and canonical_id are required");
      }
      const alias = store.mergeWorkItems(sourceId, canonicalId, params.reason as string | undefined);
      if (!alias) {
        return errorResponse(requestId, "validation_error", "Work Items cannot be merged");
      }
      return successResponse(requestId, alias);
    }

    case "work_item.resolve": {
      const id = params.id as string;
      if (!id) return errorResponse(requestId, "validation_error", "Work Item ID is required");
      const canonicalId = store.resolveWorkItemId(id);
      if (!store.getWorkItem(canonicalId)) {
        return errorResponse(requestId, "not_found", "Work Item not found");
      }
      return successResponse(requestId, {
        requested_id: id,
        canonical_id: canonicalId,
        aliases: store.listWorkItemAliases(canonicalId),
      });
    }

    case "working_memory.create": {
      const entry = store.createWorkMemory(params as unknown as WorkMemoryCreateParams);
      if (!entry) {
        return errorResponse(requestId, "validation_error", "Working-memory entry cannot be created");
      }
      return successResponse(requestId, entry);
    }

    case "working_memory.list": {
      const entries = store.listWorkMemory(params as WorkMemoryListParams);
      return successResponse(requestId, { entries, total: entries.length });
    }

    case "working_memory.update": {
      const entry = store.updateWorkMemory(params as unknown as WorkMemoryUpdateParams);
      if (!entry) {
        return errorResponse(requestId, "validation_error", "Working-memory entry cannot be updated");
      }
      return successResponse(requestId, entry);
    }

    case "working_memory.delete": {
      const id = params.id as string;
      if (!id) return errorResponse(requestId, "validation_error", "Working-memory entry ID is required");
      const entry = store.deleteWorkMemory(id, params.reason as string | undefined);
      return entry
        ? successResponse(requestId, entry)
        : errorResponse(requestId, "not_found", "Working-memory entry not found");
    }

    case "work_item_stage.create": {
      const stage = store.createWorkItemStage(
        params.work_item_id as string,
        params.title as string,
        params.activate as boolean | undefined,
      );
      return stage
        ? successResponse(requestId, stage)
        : errorResponse(requestId, "validation_error", "Work Item stage cannot be created");
    }

    case "work_item_stage.update": {
      const stage = store.updateWorkItemStage(params.id as string, {
        title: params.title as string | undefined,
        state: params.state as import("@timeskein/contracts").WorkItemStageView["state"] | undefined,
        position: params.position as number | undefined,
      });
      return stage
        ? successResponse(requestId, stage)
        : errorResponse(requestId, "not_found", "Work Item stage not found");
    }

    case "work_item_stage.delete": {
      const stage = store.deleteWorkItemStage(params.id as string);
      return stage
        ? successResponse(requestId, stage)
        : errorResponse(requestId, "not_found", "Work Item stage not found");
    }

    case "work_item_stage.list": {
      const workItemId = params.work_item_id as string;
      if (!workItemId) return errorResponse(requestId, "validation_error", "Work Item ID is required");
      return successResponse(requestId, {
        stages: store.listWorkItemStages(workItemId, params.include_archived === true),
      });
    }

    case "context_pack.build": {
      const profile = params.profile as ContextPackProfile;
      const scopeId = params.scope_id as string;
      const format = (params.format as "json" | "markdown" | "both" | undefined) ?? "both";
      if (!(["work-item-reentry", "track-reentry"] as string[]).includes(profile) || !scopeId) {
        return errorResponse(requestId, "validation_error", "Valid profile and scope_id are required");
      }
      if (!(["json", "markdown", "both"] as string[]).includes(format)) {
        return errorResponse(requestId, "validation_error", "format must be json, markdown, or both");
      }
      const pack = store.buildContextPack(profile, scopeId, (params.as_of as string | undefined) ?? new Date().toISOString());
      if (!pack) return errorResponse(requestId, "not_found", "Context Pack scope not found");
      const markdown = renderContextPackMarkdown(pack);
      return successResponse(requestId, {
        pack: format === "markdown" ? undefined : pack,
        markdown: format === "json" ? undefined : markdown,
      });
    }

    // Focus session methods
    case "focus.current": {
      return successResponse(requestId, {
        session: store.getActiveFocusSession(),
      });
    }

    case "focus.start": {
      const title = params.title as string;
      const workItemId = params.work_item_id as string | undefined;

      if ((!title || title.trim() === "") && !workItemId) {
        return errorResponse(requestId, "validation_error", "Title is required");
      }

      const result = store.startFocusSession({
        title: title?.trim(),
        work_item_id: workItemId,
        activity_zone: params.activity_zone as ActivityZone | undefined,
        target_seconds: params.target_seconds as number | undefined,
        stage_id: params.stage_id as string | undefined,
      });

      return successResponse(requestId, result);
    }

    case "focus.stop": {
      const session = store.stopFocusSession(params.id as string | undefined, params.note as string | undefined);
      if (!session) {
        return errorResponse(requestId, "not_found", "No active focus session");
      }

      const semanticEntries: Array<[WorkMemoryEntryKind, unknown]> = [
        ["result", params.result],
        ["state_change", params.state_change],
        ["next_action", params.next_action],
      ];
      for (const [kind, rawText] of semanticEntries) {
        if (typeof rawText !== "string" || !rawText.trim() || !session.work_item_id) continue;
        store.createWorkMemory({
          subject_kind: "work_item",
          subject_id: session.work_item_id,
          kind,
          text: rawText.trim(),
          focus_session_id: session.id,
          stage_id: session.work_context?.stage_id,
          local_date: session.stopped_at?.slice(0, 10),
          origin_kind: "focus_stop",
          origin_ref: session.id,
        });
      }

      return successResponse(requestId, session);
    }

    case "focus.update": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Focus session ID is required");
      }

      const session = store.updateFocusSession(id, {
        title: typeof params.title === "string" ? params.title.trim() : undefined,
        work_item_id: params.work_item_id as string | null | undefined,
        activity_zone: params.activity_zone as ActivityZone | undefined,
        target_seconds: params.target_seconds as number | undefined,
        note: params.note as string | null | undefined,
        started_at: params.started_at as string | undefined,
        stopped_at: params.stopped_at as string | undefined,
      });
      if (!session) {
        return errorResponse(requestId, "not_found", "Focus session not found");
      }
      return successResponse(requestId, session);
    }

    case "focus.create_stopped": {
      const title = typeof params.title === "string" ? params.title.trim() : undefined;
      const workItemId = params.work_item_id as string | undefined;
      const startedAt = params.started_at as string | undefined;
      const stoppedAt = params.stopped_at as string | undefined;
      if ((!title && !workItemId) || !startedAt || !stoppedAt) {
        return errorResponse(
          requestId,
          "validation_error",
          "Title or work_item_id, started_at and stopped_at are required"
        );
      }

      const session = store.createStoppedFocusSession({
        title,
        work_item_id: workItemId,
        activity_zone: params.activity_zone as ActivityZone | undefined,
        target_seconds: params.target_seconds as number | undefined,
        note: params.note as string | null | undefined,
        started_at: startedAt,
        stopped_at: stoppedAt,
      });
      if (!session) {
        return errorResponse(requestId, "validation_error", "Focus block cannot be created");
      }
      return successResponse(requestId, session);
    }

    case "focus.split": {
      const id = params.id as string;
      const splitAt = params.split_at as string;
      if (!id || !splitAt) {
        return errorResponse(requestId, "validation_error", "Focus session ID and split_at are required");
      }

      const result = store.splitFocusSession(id, {
        split_at: splitAt,
        right_title: typeof params.right_title === "string" ? params.right_title.trim() : undefined,
        right_work_item_id: params.right_work_item_id as string | null | undefined,
        right_note: params.right_note as string | null | undefined,
      });
      if (!result) {
        return errorResponse(requestId, "validation_error", "Focus session cannot be split");
      }
      return successResponse(requestId, result);
    }

    case "focus.list": {
      const sessions = store.listFocusSessions(params.from as string | undefined, params.to as string | undefined);
      return successResponse(requestId, {
        sessions,
        total: sessions.length,
        active_seconds_total: sessions.reduce((sum, session) => sum + session.active_seconds, 0),
        updated_at: new Date().toISOString(),
      });
    }

    // Ref methods
    case "ref.add": {
      const workItemId = params.work_item_id as string;
      const kind = params.kind as RefKind;
      const value = params.value as string;

      if (!workItemId) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }
      if (!kind) {
        return errorResponse(requestId, "validation_error", "Ref kind is required");
      }
      if (!value || value.trim() === "") {
        return errorResponse(requestId, "validation_error", "Ref value is required");
      }

      const result = store.addRef(workItemId, kind, value, params.is_primary as boolean);
      
      if (result.conflict) {
        return errorResponse(requestId, "conflict", "Ref already attached to another work item", {
          conflict_type: "ref_already_attached",
          existing_work_item: {
            id: result.conflict.workItemId,
            title: result.conflict.workItemTitle,
          },
          options: ["attach_anyway", "open_existing", "cancel"],
        });
      }

      if (!result.ref) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }

      return successResponse(requestId, { ref_id: result.ref.id });
    }

    case "ref.remove": {
      const workItemId = params.work_item_id as string;
      const refId = params.ref_id as string;

      if (!workItemId || !refId) {
        return errorResponse(requestId, "validation_error", "Work item ID and ref ID are required");
      }

      if (!store.removeRef(workItemId, refId)) {
        return errorResponse(requestId, "not_found", "Ref not found");
      }

      return successResponse(requestId, { success: true });
    }

    case "ref.open": {
      const workItemId = params.work_item_id as string;
      if (!workItemId) {
        return errorResponse(requestId, "validation_error", "Work item ID is required");
      }
      
      const item = store.getWorkItem(workItemId);
      if (!item) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }

      const refId = params.ref_id as string;
      const ref = refId
        ? item.refs.find((r) => r.id === refId)
        : item.refs.find((r) => r.is_primary) || item.refs[0];

      if (!ref) {
        return errorResponse(requestId, "not_found", "No refs to open");
      }

      // Update last_seen
      store.touchWorkItem(workItemId);

      // In mock, just return success (actual opening happens client-side)
      return successResponse(requestId, {
        opened: true,
        ref_id: ref.id,
        kind: ref.kind,
        value: ref.value,
      });
    }

    case "ref.check_conflict": {
      const kind = params.kind as RefKind;
      const value = params.value as string;

      if (!kind || !value) {
        return errorResponse(requestId, "validation_error", "Kind and value are required");
      }

      const result = store.checkRefConflict(kind, value);
      return successResponse(requestId, {
        exists: result.exists,
        existing_work_item: result.exists
          ? { id: result.workItemId, title: result.workItemTitle }
          : undefined,
      });
    }

    case "causal_record.list": {
      if ((params.subject_kind && !params.subject_id) || (!params.subject_kind && params.subject_id)) {
        return errorResponse(requestId, "validation_error", "subject_kind and subject_id must be provided together");
      }
      if (params.subject_kind && !isOperationalSubjectKind(params.subject_kind)) {
        return errorResponse(requestId, "validation_error", "Valid subject kind is required");
      }
      const records = store.listCausalRecords({
        subject_kind: params.subject_kind as OperationalSubjectKind | undefined,
        subject_id: params.subject_id as string | undefined,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
      });
      return successResponse(requestId, {
        records,
        total: records.length,
        updated_at: new Date().toISOString(),
      });
    }

    case "operational_workspace.get": {
      const localDate = typeof params.local_date === "string"
        ? params.local_date
        : new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
        return errorResponse(requestId, "validation_error", "local_date must be YYYY-MM-DD");
      }
      return successResponse(requestId, store.getOperationalWorkspace(localDate));
    }

    case "day_contract.revise": {
      if (
        typeof params.local_date !== "string" ||
        typeof params.revision_kind !== "string" ||
        !Array.isArray(params.active_subjects) ||
        !Array.isArray(params.parked_subjects) ||
        typeof params.first_action_work_item_id !== "string" ||
        typeof params.why_now !== "string"
      ) {
        return errorResponse(requestId, "validation_error", "Complete day contract is required");
      }
      try {
        return successResponse(
          requestId,
          store.reviseDayContract(params as unknown as DayContractReviseParams)
        );
      } catch (error) {
        return errorResponse(
          requestId,
          "validation_error",
          error instanceof Error ? error.message : "Day contract update failed"
        );
      }
    }

    case "day_contract.list": {
      if (typeof params.from !== "string" || typeof params.to !== "string") {
        return errorResponse(requestId, "validation_error", "from and to are required");
      }
      if (params.from >= params.to) {
        return errorResponse(requestId, "validation_error", "to must be later than from");
      }
      return successResponse(requestId, store.listDayContracts(params.from, params.to));
    }

    case "operational_reality.list":
      return successResponse(
        requestId,
        store.getOperationalReality((params.as_of as string | undefined) ?? new Date().toISOString())
      );

    case "operational_reality.set_state": {
      if (!isOperationalSubjectKind(params.subject_kind) || typeof params.subject_id !== "string") {
        return errorResponse(requestId, "validation_error", "Valid operational subject is required");
      }
      if (!isOperationalState(params.state)) {
        return errorResponse(requestId, "validation_error", "Valid operational state is required");
      }
      if (!store.hasOperationalSubject(params.subject_kind, params.subject_id)) {
        return errorResponse(requestId, "not_found", "Operational Reality subject not found");
      }
      try {
        const record = store.setOperationalState({
          subject_kind: params.subject_kind,
          subject_id: params.subject_id,
          state: params.state,
          reason: params.reason as string | undefined,
          confirmation: params.confirmation as boolean | undefined,
          occurred_at: params.occurred_at as string | undefined,
        });
        return successResponse(requestId, { record, reality: store.getOperationalReality() });
      } catch (error) {
        return errorResponse(
          requestId,
          "validation_error",
          error instanceof Error ? error.message : "Operational state update failed"
        );
      }
    }

    case "operational_reality.set_next_action": {
      if (!isOperationalSubjectKind(params.subject_kind) || typeof params.subject_id !== "string") {
        return errorResponse(requestId, "validation_error", "Valid operational subject is required");
      }
      if (!store.hasOperationalSubject(params.subject_kind, params.subject_id)) {
        return errorResponse(requestId, "not_found", "Operational Reality subject not found");
      }
      if (!(["set", "complete", "dismiss"] as unknown[]).includes(params.action)) {
        return errorResponse(requestId, "validation_error", "Next action operation must be set, complete, or dismiss");
      }
      try {
        const record = store.setOperationalNextAction({
          subject_kind: params.subject_kind,
          subject_id: params.subject_id,
          action: params.action as "set" | "complete" | "dismiss",
          text: params.text as string | undefined,
          occurred_at: params.occurred_at as string | undefined,
        });
        return successResponse(requestId, { record, reality: store.getOperationalReality() });
      } catch (error) {
        return errorResponse(
          requestId,
          "validation_error",
          error instanceof Error ? error.message : "Next action update failed"
        );
      }
    }

    case "operational_reality.follow_up_decision": {
      if (typeof params.decision_id !== "string" || typeof params.status !== "string") {
        return errorResponse(requestId, "validation_error", "Decision ID and follow-up status are required");
      }
      return successResponse(requestId, {
        followup_id: uuidv4(),
        reality: store.getOperationalReality(),
      });
    }

    // Settings methods
    case "settings.get":
      return successResponse(requestId, {
        hotkey: "Ctrl+Shift+Space",
        theme: "system",
      });

    case "settings.set":
      // Mock: just return success
      return successResponse(requestId, { success: true });

    case "settings.get_denylist":
      return successResponse(requestId, store.getDenylist());

    case "settings.add_to_denylist": {
      const pattern = params.pattern as string;
      const policy = params.policy as "block" | "redact_to_domain";

      if (!pattern) {
        return errorResponse(requestId, "validation_error", "Pattern is required");
      }
      if (!policy) {
        return errorResponse(requestId, "validation_error", "Policy is required");
      }

      const rule = store.addToDenylist(pattern, policy);
      return successResponse(requestId, { id: rule.id });
    }

    case "settings.remove_from_denylist": {
      const id = params.id as string;
      if (!id) {
        return errorResponse(requestId, "validation_error", "Rule ID is required");
      }
      if (!store.removeFromDenylist(id)) {
        return errorResponse(requestId, "not_found", "Denylist rule not found");
      }
      return successResponse(requestId, { success: true });
    }

    default:
      return errorResponse(requestId, "validation_error", `Unknown method: ${method}`);
  }
}

function renderContextPackMarkdown(pack: ContextPackView): string {
  const lines = [
    `# Context Pack: ${pack.scope.title}`,
    "",
    `- Profile: \`${pack.profile}\``,
    `- Scope: \`${pack.scope.kind}\` / \`${pack.scope.id}\``,
    `- As of: \`${pack.as_of}\``,
    `- Projection: ${pack.provenance.projection}`,
    "",
    "## Current re-entry point",
  ];
  if (pack.facts.latest_confirmed_change) {
    lines.push(`- Latest confirmed change: ${memoryContent(pack.facts.latest_confirmed_change)}`);
  }
  if (pack.facts.current_stage) {
    lines.push(`- Current stage: ${oneLine(pack.facts.current_stage.title)} (\`${pack.facts.current_stage.state}\`)`);
  }
  if (pack.facts.next_actions.length === 0) {
    lines.push("- Next action: not recorded");
  } else {
    for (const entry of [...pack.facts.next_actions].reverse().slice(0, 3)) {
      lines.push(`- Next action: ${memoryContent(entry)}`);
    }
  }
  lines.push("", "## Focus by stage", "", "| Stage | State | Time | Entrances |", "| --- | --- | ---: | ---: |");
  for (const stage of pack.facts.focus.by_stage) {
    lines.push(`| ${markdownCell(stage.title)} | ${markdownCell(stage.state)} | ${formatDuration(stage.active_seconds)} | ${stage.entrances} |`);
  }
  lines.push("", "## Working memory", "");
  if (pack.facts.memory.length === 0) {
    lines.push("No entries.");
  } else {
    for (const entry of pack.facts.memory) {
      lines.push(`- \`${entry.occurred_at}\` \`${entry.current_revision.entry_kind}\` ${memoryContent(entry)}`);
    }
  }
  if (pack.unknowns.length > 0) {
    lines.push("", "## Unknowns", "", ...pack.unknowns.map((value) => `- ${oneLine(value)}`));
  }
  if (pack.warnings.length > 0) {
    lines.push("", "## Warnings", "", ...pack.warnings.map((value) => `- ${oneLine(value)}`));
  }
  lines.push(
    "",
    "## Provenance",
    "",
    `- Source: ${pack.provenance.source}`,
    `- External text policy: ${pack.provenance.external_text_policy}`,
    "",
  );
  return lines.join("\n");
}

function memoryContent(entry: ContextPackView["facts"]["memory"][number]): string {
  return oneLine(entry.current_revision.text ?? entry.current_revision.material_value ?? "(empty)");
}

function oneLine(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

function markdownCell(value: string): string {
  return oneLine(value).replaceAll("|", "\\|");
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Timeskein Mock Server running on http://127.0.0.1:${PORT}`);
  console.log(`API endpoint: POST http://127.0.0.1:${PORT}/api`);
  console.log("");
  console.log("Available methods:");
  console.log("  agent.ping, agent.status, agent.version");
  console.log("  inventory.list, inventory.get");
  console.log("  capture.create, capture.list, capture.resolve, capture.update, capture.delete, capture.convert_to_work_item");
  console.log("  day_event.add, day_event.list, day_event.update, day_event.delete");
  console.log("  taxonomy.list, track.create, track.update, track.archive, label.create, label.update, label.archive");
  console.log("  work_item.create, work_item.touch, work_item.set_state, work_item.set_note, work_item.update, work_item.set_semantics, work_item.toggle_pin, work_item.delete");
  console.log("  focus.current, focus.start, focus.stop, focus.update, focus.create_stopped, focus.split, focus.list");
  console.log("  ref.add, ref.remove, ref.open, ref.check_conflict");
  console.log("  causal_record.list, operational_reality.list, operational_reality.set_state, operational_reality.set_next_action, operational_reality.follow_up_decision");
  console.log("  operational_workspace.get, day_contract.revise, day_contract.list");
  console.log("  settings.get, settings.set, settings.get_denylist, settings.add_to_denylist, settings.remove_from_denylist");
});

export { app };
