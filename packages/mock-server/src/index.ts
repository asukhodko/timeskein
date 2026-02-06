import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import {
  API_VERSION,
  type ApiRequest,
  type ApiSuccessResponse,
  type ApiErrorResponse,
  type ApiError,
  type WorkItemState,
  type RefKind,
} from "@timeskein/contracts";
import { MockDataStore } from "./fixtures";

// -----------------------------------------------------------------------------
// Server Setup
// -----------------------------------------------------------------------------

const app = express();
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

    // Inventory methods
    case "inventory.list": {
      const search = params.filter && typeof params.filter === "object"
        ? (params.filter as Record<string, unknown>).search as string | undefined
        : undefined;
      const stateFilter = params.filter && typeof params.filter === "object"
        ? (params.filter as Record<string, unknown>).state as WorkItemState[] | undefined
        : undefined;

      const items = store.listWorkItems(search, stateFilter);
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
      const item = store.createWorkItem(
        title,
        params.type as "task" | "project" | "question" | undefined,
        params.state as WorkItemState | undefined,
        params.note as string | undefined
      );
      return successResponse(requestId, { id: item.id });
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
      return successResponse(requestId, { success: true });
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
      if (!store.deleteWorkItem(id)) {
        return errorResponse(requestId, "not_found", "Work item not found");
      }
      return successResponse(requestId, { success: true });
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
  console.log("  work_item.create, work_item.touch, work_item.set_state, work_item.set_note, work_item.toggle_pin, work_item.delete");
  console.log("  ref.add, ref.remove, ref.open, ref.check_conflict");
  console.log("  settings.get, settings.set, settings.get_denylist, settings.add_to_denylist, settings.remove_from_denylist");
});

export { app };
