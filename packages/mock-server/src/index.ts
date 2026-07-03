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
  "window_drag_started",
  "focus_start_requested",
  "focus_started",
  "focus_start_failed",
  "focus_switch_requested",
  "focus_switched",
  "focus_stop_requested",
  "focus_stopped",
  "focus_stop_failed",
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
  "capture_convert_requested",
  "capture_converted",
  "capture_convert_failed",
  "api_error",
]);

const APP_EVENT_SOURCES = new Set<string>(["ui", "agent", "script", "system"]);

function isAppEventKind(value: unknown): value is AppEventKind {
  return typeof value === "string" && APP_EVENT_KINDS.has(value);
}

function isAppEventSource(value: unknown): value is AppEventSource {
  return typeof value === "string" && APP_EVENT_SOURCES.has(value);
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
        params.note as string | undefined
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

      const event = store.updateWorkItemEvent(id, text);
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
      });
      if (!item) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, item);
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
        target_seconds: params.target_seconds as number | undefined,
      });

      return successResponse(requestId, result);
    }

    case "focus.stop": {
      const session = store.stopFocusSession(params.id as string | undefined, params.note as string | undefined);
      if (!session) {
        return errorResponse(requestId, "not_found", "No active focus session");
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
  console.log("  work_item.create, work_item.touch, work_item.set_state, work_item.set_note, work_item.update, work_item.toggle_pin, work_item.delete");
  console.log("  focus.current, focus.start, focus.stop, focus.update, focus.create_stopped, focus.split, focus.list");
  console.log("  ref.add, ref.remove, ref.open, ref.check_conflict");
  console.log("  settings.get, settings.set, settings.get_denylist, settings.add_to_denylist, settings.remove_from_denylist");
});

export { app };
