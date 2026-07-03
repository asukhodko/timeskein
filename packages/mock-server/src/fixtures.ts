import type {
  WorkItemView,
  WorkItemState,
  RefView,
  DenylistRule,
  FocusSessionView,
  CaptureState,
  CaptureView,
  AppEventKind,
  AppEventSource,
  AppEventSummary,
  AppEventView,
  ActivityZone,
  WorkItemEventView,
  DayEventView,
} from "@timeskein/contracts";
import { v4 as uuidv4 } from "uuid";

// -----------------------------------------------------------------------------
// Mock Data Store
// -----------------------------------------------------------------------------

const now = new Date().toISOString();
const hourAgo = new Date(Date.now() - 3600000).toISOString();
const dayAgo = new Date(Date.now() - 86400000).toISOString();
const twoDaysAgo = new Date(Date.now() - 172800000).toISOString();
const weekAgo = new Date(Date.now() - 604800000).toISOString();

// Mock refs
const mockRefs: Record<string, RefView[]> = {
  "item-1": [
    { id: "ref-1", kind: "url", value: "https://github.com/timeskein/timeskein/issues/42", is_primary: true },
    { id: "ref-2", kind: "file_path", value: "C:/projects/timeskein/docs/spec.md", is_primary: false },
  ],
  "item-2": [
    { id: "ref-3", kind: "issue_key", value: "PROJ-123", is_primary: true },
  ],
  "item-3": [
    { id: "ref-4", kind: "url", value: "https://docs.example.com/api", is_primary: true },
  ],
  "item-4": [],
  "item-5": [
    { id: "ref-5", kind: "url", value: "https://staging.example.com", is_primary: true },
  ],
  "item-6": [
    { id: "ref-6", kind: "file_path", value: "/Users/dev/design-specs.pdf", is_primary: true },
  ],
};

// Mock work items
export const mockWorkItems: WorkItemView[] = [
  {
    id: "item-1",
    title: "Implement global hotkey palette",
    type: "task",
    activity_zone: "work",
    state: "unknown",
    pinned: true,
    note: "Next: finish keyboard navigation, then test on Windows",
    refs_count: 2,
    refs: mockRefs["item-1"],
    today_active_seconds: 0,
    total_active_seconds: 0,
    created_at: weekAgo,
    updated_at: hourAgo,
    last_seen_at: hourAgo,
  },
  {
    id: "item-2",
    title: "Fix validation error on login form",
    type: "task",
    activity_zone: "work",
    state: "unknown",
    pinned: false,
    note: "Check PROJ-123 for repro steps",
    refs_count: 1,
    refs: mockRefs["item-2"],
    today_active_seconds: 0,
    total_active_seconds: 0,
    created_at: twoDaysAgo,
    updated_at: dayAgo,
    last_seen_at: dayAgo,
  },
  {
    id: "item-3",
    title: "Review API documentation",
    type: "task",
    activity_zone: "coordination",
    state: "waiting",
    pinned: false,
    note: "Waiting for backend team to finalize endpoints",
    refs_count: 1,
    refs: mockRefs["item-3"],
    today_active_seconds: 0,
    total_active_seconds: 0,
    created_at: weekAgo,
    updated_at: twoDaysAgo,
    last_seen_at: twoDaysAgo,
  },
  {
    id: "item-4",
    title: "Refactor state management",
    type: "project",
    activity_zone: "work",
    state: "someday",
    pinned: false,
    note: undefined,
    refs_count: 0,
    refs: [],
    today_active_seconds: 0,
    total_active_seconds: 0,
    created_at: weekAgo,
    updated_at: weekAgo,
    last_seen_at: undefined,
  },
  {
    id: "item-5",
    title: "Staging environment access",
    type: "task",
    activity_zone: "work",
    state: "blocked",
    pinned: false,
    note: "Need VPN access from IT",
    refs_count: 1,
    refs: mockRefs["item-5"],
    today_active_seconds: 0,
    total_active_seconds: 0,
    created_at: twoDaysAgo,
    updated_at: dayAgo,
    last_seen_at: dayAgo,
  },
  {
    id: "item-6",
    title: "Get design feedback",
    type: "question",
    activity_zone: "coordination",
    state: "waiting",
    pinned: false,
    note: "Sent designs to designer on Monday",
    refs_count: 1,
    refs: mockRefs["item-6"],
    today_active_seconds: 0,
    total_active_seconds: 0,
    created_at: weekAgo,
    updated_at: twoDaysAgo,
    last_seen_at: twoDaysAgo,
  },
];

// Mock denylist
export const mockDenylist: DenylistRule[] = [
  {
    id: "deny-1",
    pattern: "mail.google.com",
    policy: "block",
    created_at: weekAgo,
  },
  {
    id: "deny-2",
    pattern: "*.internal.company.com",
    policy: "redact_to_domain",
    created_at: weekAgo,
  },
];

// -----------------------------------------------------------------------------
// Data Store Class
// -----------------------------------------------------------------------------

export class MockDataStore {
  private workItems: Map<string, WorkItemView>;
  private refs: Map<string, RefView>;
  private denylist: Map<string, DenylistRule>;
  private focusSessions: Map<string, FocusSessionView>;
  private captures: Map<string, CaptureView>;
  private appEvents: Map<string, AppEventView>;
  private workItemEvents: Map<string, WorkItemEventView>;
  private dayEvents: Map<string, DayEventView>;
  private startTime: number;

  constructor() {
    this.workItems = new Map();
    this.refs = new Map();
    this.denylist = new Map();
    this.focusSessions = new Map();
    this.captures = new Map();
    this.appEvents = new Map();
    this.workItemEvents = new Map();
    this.dayEvents = new Map();
    this.startTime = Date.now();

    // Initialize with mock data
    for (const item of mockWorkItems) {
      this.workItems.set(item.id, { ...item });
      for (const ref of item.refs) {
        this.refs.set(ref.id, { ...ref });
      }
    }
    for (const rule of mockDenylist) {
      this.denylist.set(rule.id, { ...rule });
    }
  }

  // Capture inbox methods
  createCapture(params: { text: string; focus_session_id?: string }): CaptureView {
    const now = new Date().toISOString();
    const activeFocus = this.getActiveFocusSession();
    const capture: CaptureView = {
      id: uuidv4(),
      text: params.text.trim(),
      state: "open",
      focus_session_id: params.focus_session_id || activeFocus?.id,
      created_at: now,
      updated_at: now,
    };

    this.captures.set(capture.id, capture);
    return capture;
  }

  listCaptures(stateFilter?: CaptureState[]): CaptureView[] {
    let captures = Array.from(this.captures.values());
    if (stateFilter && stateFilter.length > 0) {
      captures = captures.filter((capture) => stateFilter.includes(capture.state));
    }

    return captures.sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    );
  }

  resolveCapture(id: string): CaptureView | undefined {
    const capture = this.captures.get(id);
    if (!capture) return undefined;
    if (capture.state !== "open") return undefined;

    const now = new Date().toISOString();
    capture.state = "resolved";
    capture.updated_at = now;
    capture.resolved_at = now;
    this.captures.set(id, capture);

    return capture;
  }

  updateCapture(id: string, text: string): CaptureView | undefined {
    const capture = this.captures.get(id);
    if (!capture) return undefined;
    if (capture.state !== "open") return undefined;

    capture.text = text.trim();
    capture.updated_at = new Date().toISOString();
    this.captures.set(id, capture);

    return capture;
  }

  deleteCapture(id: string): boolean | undefined {
    const capture = this.captures.get(id);
    if (!capture) return undefined;
    if (capture.state !== "open") return false;

    return this.captures.delete(id);
  }

  convertCaptureToWorkItem(id: string, title?: string): { capture?: CaptureView; workItemId?: string; reused?: boolean } {
    const capture = this.captures.get(id);
    if (!capture) return {};
    if (capture.state !== "open") return { capture };

    const itemTitle = title?.trim() || capture.text;
    const existing = this.findWorkItemByTitle(itemTitle);
    const item = this.createWorkItem(itemTitle, "task", "unknown", "work");
    const now = new Date().toISOString();

    capture.state = "converted";
    capture.work_item_id = item.id;
    capture.updated_at = now;
    capture.converted_at = now;
    this.captures.set(id, capture);

    return {
      capture,
      workItemId: item.id,
      reused: Boolean(existing),
    };
  }

  appendCaptureToWorkItemEvent(id: string, workItemId?: string): { capture?: CaptureView; event?: WorkItemEventView; workItemId?: string } {
    const capture = this.captures.get(id);
    if (!capture) return {};
    if (capture.state !== "open") return { capture };

    const targetWorkItemId = workItemId ?? this.focusSessions.get(capture.focus_session_id ?? "")?.work_item_id;
    if (!targetWorkItemId) return { capture };

    const event = this.addWorkItemEvent({
      id: targetWorkItemId,
      text: capture.text,
      focus_session_id: capture.focus_session_id,
    });
    if (!event) return { capture };

    const now = new Date().toISOString();
    capture.state = "converted";
    capture.work_item_id = targetWorkItemId;
    capture.updated_at = now;
    capture.converted_at = now;
    this.captures.set(id, capture);

    return {
      capture,
      event,
      workItemId: targetWorkItemId,
    };
  }

  // Agent methods
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  getWorkItemCount(): number {
    return this.workItems.size;
  }

  // App event telemetry methods
  logAppEvent(params: {
    source?: AppEventSource;
    kind: AppEventKind;
    work_item_id?: string;
    focus_session_id?: string;
    payload?: Record<string, unknown>;
  }): AppEventView {
    const event: AppEventView = {
      id: uuidv4(),
      ts: new Date().toISOString(),
      source: params.source ?? "ui",
      kind: params.kind,
      work_item_id: params.work_item_id,
      focus_session_id: params.focus_session_id,
      payload: sanitizePayload(params.payload),
    };

    this.appEvents.set(event.id, event);
    return event;
  }

  listAppEvents(from?: string, to?: string): AppEventView[] {
    const fromTime = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
    const toTime = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;

    return Array.from(this.appEvents.values())
      .filter((event) => {
        const eventTime = new Date(event.ts).getTime();
        return eventTime >= fromTime && eventTime < toTime;
      })
      .sort((left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime());
  }

  summarizeAppEvents(from?: string, to?: string): AppEventSummary {
    const events = this.listAppEvents(from, to);
    const byKind: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const pendingStarts = new Map<string, number>();
    const startLatencies: number[] = [];
    const alreadyActiveActionIds = new Set<string>();
    let alreadyActiveWithoutAction = 0;
    let windowShownAt: number | undefined;
    let slowWindowToFocusCount = 0;

    for (const event of events) {
      byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
      bySource[event.source] = (bySource[event.source] ?? 0) + 1;

      if (event.kind === "focus_start_requested" || event.kind === "focus_switch_requested") {
        const actionId = typeof event.payload?.action_id === "string" ? event.payload.action_id : undefined;
        if (actionId) pendingStarts.set(actionId, new Date(event.ts).getTime());
      }

      if (event.kind === "focus_started" || event.kind === "focus_switched") {
        const actionId = typeof event.payload?.action_id === "string" ? event.payload.action_id : undefined;
        if (actionId && pendingStarts.has(actionId)) {
          startLatencies.push(Math.max(new Date(event.ts).getTime() - pendingStarts.get(actionId)!, 0));
          pendingStarts.delete(actionId);
        }

        if (windowShownAt && new Date(event.ts).getTime() - windowShownAt >= 20_000) {
          slowWindowToFocusCount += 1;
        }
        windowShownAt = undefined;
      }

      if (event.kind === "window_shown") {
        windowShownAt = new Date(event.ts).getTime();
      } else if (event.kind === "window_hidden") {
        windowShownAt = undefined;
      }

      if (event.payload?.already_active === true) {
        const actionId = typeof event.payload.action_id === "string" ? event.payload.action_id : undefined;
        if (actionId) {
          alreadyActiveActionIds.add(actionId);
        } else if (event.kind === "focus_start_requested" || event.kind === "focus_switch_requested") {
          alreadyActiveWithoutAction += 1;
        }
      }
    }

    const count = (kind: string) => byKind[kind] ?? 0;
    const averageLatency = startLatencies.length
      ? Math.floor(startLatencies.reduce((sum, value) => sum + value, 0) / startLatencies.length)
      : undefined;

    return {
      total: events.length,
      by_kind: byKind,
      by_source: bySource,
      start_requests: count("focus_start_requested"),
      switch_requests: count("focus_switch_requested"),
      stop_requests: count("focus_stop_requested"),
      start_failures: count("focus_start_failed"),
      stop_failures: count("focus_stop_failed"),
      correction_requests: count("focus_correction_requested"),
      corrections: count("focus_corrected"),
      correction_reviews: count("focus_correction_reviewed"),
      correction_failures: count("focus_correction_failed"),
      api_errors: count("api_error"),
      copy_failures: count("report_copy_failed"),
      manual_copy_fallbacks: count("manual_copy_fallback_shown"),
      capture_create_requests: count("capture_create_requested"),
      capture_created: count("capture_created"),
      capture_create_failures: count("capture_create_failed"),
      capture_resolve_requests: count("capture_resolve_requested"),
      capture_resolved: count("capture_resolved"),
      capture_resolve_failures: count("capture_resolve_failed"),
      capture_update_requests: count("capture_update_requested"),
      capture_updated: count("capture_updated"),
      capture_update_failures: count("capture_update_failed"),
      capture_delete_requests: count("capture_delete_requested"),
      capture_deleted: count("capture_deleted"),
      capture_delete_failures: count("capture_delete_failed"),
      capture_convert_requests: count("capture_convert_requested"),
      capture_converted: count("capture_converted"),
      capture_convert_failures: count("capture_convert_failed"),
      window_shown: count("window_shown"),
      window_hidden: count("window_hidden"),
      window_drag_started: count("window_drag_started"),
      stale_runtime_recoveries: count("agent_stale_runtime_recovered"),
      already_active_start_attempts: alreadyActiveActionIds.size + alreadyActiveWithoutAction,
      average_focus_start_latency_ms: averageLatency,
      slow_window_to_focus_count: slowWindowToFocusCount,
      updated_at: new Date().toISOString(),
    };
  }

  // Inventory methods
  listWorkItems(
    search?: string,
    stateFilter?: WorkItemState[],
    focusWindow?: { from?: string; to?: string }
  ): WorkItemView[] {
    let items = Array.from(this.workItems.values()).filter(
      (item) => !item.id.startsWith("deleted-")
    );

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(searchLower) ||
          (item.note && item.note.toLowerCase().includes(searchLower))
      );
    }

    // Apply state filter
    if (stateFilter && stateFilter.length > 0) {
      items = items.filter((item) => stateFilter.includes(item.state));
    }

    // Sort: pinned first, then by state priority, then by last_seen_at
    const statePriority: Record<WorkItemState, number> = {
      active: 1,
      blocked: 2,
      waiting: 3,
      unknown: 4,
      someday: 5,
      done: 6,
    };

    items.sort((a, b) => {
      // Pinned first
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      // Then by state priority
      if (a.state !== b.state) {
        return statePriority[a.state] - statePriority[b.state];
      }
      // Then by last_seen_at (descending)
      const aTime = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
      const bTime = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0;
      return bTime - aTime;
    });

    const todayTotals = this.aggregateWorkItemFocusSeconds(focusWindow?.from, focusWindow?.to);
    const totalTotals = this.aggregateWorkItemFocusSeconds();

    return items.map((item) => ({
      ...item,
      today_active_seconds: todayTotals.get(item.id) ?? 0,
      total_active_seconds: totalTotals.get(item.id) ?? 0,
    }));
  }

  getWorkItem(id: string): WorkItemView | undefined {
    return this.workItems.get(id);
  }

  findWorkItemByTitle(title: string): WorkItemView | undefined {
    const normalized = title.trim().toLocaleLowerCase();
    if (!normalized) return undefined;

    return Array.from(this.workItems.values()).find(
      (item) => item.title.trim().toLocaleLowerCase() === normalized
    );
  }

  // Work item methods
  createWorkItem(
    title: string,
    type?: "task" | "project" | "question",
    state?: WorkItemState,
    activityZone?: ActivityZone,
    note?: string
  ): WorkItemView {
    const existing = this.findWorkItemByTitle(title);
    if (existing) {
      if (state === "active") {
        this.setWorkItemState(existing.id, "active");
      }
      return existing;
    }

    const now = new Date().toISOString();
    const item: WorkItemView = {
      id: uuidv4(),
      title: title.trim(),
      type: type || "task",
      activity_zone: activityZone || "work",
      state: state || "unknown",
      pinned: false,
      note,
      refs_count: 0,
      refs: [],
      today_active_seconds: 0,
      total_active_seconds: 0,
      created_at: now,
      updated_at: now,
      last_seen_at: now,
    };
    this.workItems.set(item.id, item);

    if (item.state === "active") {
      this.startFocusSession({
        title: item.title,
        work_item_id: item.id,
      });
    }

    return item;
  }

  touchWorkItem(id: string): boolean {
    const item = this.workItems.get(id);
    if (!item) return false;
    const now = new Date().toISOString();
    item.updated_at = now;
    item.last_seen_at = now;
    return true;
  }

  setWorkItemState(id: string, state: WorkItemState): boolean {
    const item = this.workItems.get(id);
    if (!item) return false;
    const now = new Date().toISOString();

    if (state === "active") {
      const current = this.getActiveFocusSession();
      if (current?.work_item_id !== id) {
        this.stopFocusSession();
      }
      this.clearActiveWorkItems(id);
    } else {
      const current = this.getActiveFocusSession();
      if (current?.work_item_id === id) {
        this.stopFocusSession();
      }
    }

    item.state = state;
    item.updated_at = now;
    item.last_seen_at = now;

    if (state === "active" && this.getActiveFocusSession()?.work_item_id !== id) {
      this.startFocusSession({
        title: item.title,
        work_item_id: item.id,
      });
    }

    return true;
  }

  setWorkItemNote(id: string, note: string): boolean {
    const item = this.workItems.get(id);
    if (!item) return false;
    const now = new Date().toISOString();
    item.note = note || undefined;
    item.updated_at = now;
    item.last_seen_at = now;
    return true;
  }

  addWorkItemEvent(params: { id: string; text: string; focus_session_id?: string }): WorkItemEventView | undefined {
    const item = this.workItems.get(params.id);
    const text = params.text.trim();
    if (!item || !text) return undefined;

    const now = new Date().toISOString();
    item.updated_at = now;
    item.last_seen_at = now;

    const payload: Record<string, unknown> = { text };
    if (params.focus_session_id) {
      payload.focus_session_id = params.focus_session_id;
    }

    const event: WorkItemEventView = {
      id: uuidv4(),
      ts: now,
      work_item_id: item.id,
      kind: "note_added",
      text,
      focus_session_id: params.focus_session_id,
      payload,
    };

    this.workItemEvents.set(event.id, event);
    return event;
  }

  updateWorkItemEvent(id: string, text: string): WorkItemEventView | undefined {
    const event = this.workItemEvents.get(id);
    const trimmed = text.trim();
    if (!event || event.kind !== "note_added" || !trimmed) return undefined;

    const payload = { ...(event.payload ?? {}), text: trimmed };
    const updated = {
      ...event,
      text: trimmed,
      payload,
    };

    this.workItemEvents.set(id, updated);
    return updated;
  }

  deleteWorkItemEvent(id: string): boolean {
    const event = this.workItemEvents.get(id);
    if (!event || event.kind !== "note_added") return false;

    return this.workItemEvents.delete(id);
  }

  listWorkItemEvents(params: { id?: string; from?: string; to?: string } = {}): WorkItemEventView[] {
    const fromTime = params.from ? new Date(params.from).getTime() : Number.NEGATIVE_INFINITY;
    const toTime = params.to ? new Date(params.to).getTime() : Number.POSITIVE_INFINITY;

    return Array.from(this.workItemEvents.values())
      .filter((event) => {
        if (params.id && event.work_item_id !== params.id) return false;
        const eventTime = new Date(event.ts).getTime();
        return eventTime >= fromTime && eventTime < toTime;
      })
      .sort((left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime());
  }

  addDayEvent(params: { text: string; focus_session_id?: string; activity_zone?: ActivityZone }): DayEventView | undefined {
    const text = params.text.trim();
    if (!text) return undefined;
    if (params.focus_session_id && !this.focusSessions.has(params.focus_session_id)) return undefined;

    const now = new Date().toISOString();
    const event: DayEventView = {
      id: uuidv4(),
      ts: now,
      kind: "note_added",
      text,
      focus_session_id: params.focus_session_id,
      activity_zone: params.activity_zone,
      updated_at: now,
    };

    this.dayEvents.set(event.id, event);
    return event;
  }

  updateDayEvent(id: string, params: { text: string; activity_zone?: ActivityZone | null }): DayEventView | undefined {
    const event = this.dayEvents.get(id);
    const text = params.text.trim();
    if (!event || !text) return undefined;

    const updated: DayEventView = {
      ...event,
      text,
      activity_zone: params.activity_zone === undefined ? event.activity_zone : params.activity_zone ?? undefined,
      updated_at: new Date().toISOString(),
    };
    this.dayEvents.set(id, updated);
    return updated;
  }

  deleteDayEvent(id: string): boolean {
    return this.dayEvents.delete(id);
  }

  listDayEvents(params: { from?: string; to?: string } = {}): DayEventView[] {
    const fromTime = params.from ? new Date(params.from).getTime() : Number.NEGATIVE_INFINITY;
    const toTime = params.to ? new Date(params.to).getTime() : Number.POSITIVE_INFINITY;

    return Array.from(this.dayEvents.values())
      .filter((event) => {
        const eventTime = new Date(event.ts).getTime();
        return eventTime >= fromTime && eventTime < toTime;
      })
      .sort((left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime());
  }

  hasFocusSession(id: string): boolean {
    return this.focusSessions.has(id);
  }

  updateWorkItem(
    id: string,
    params: { title?: string; type?: "task" | "project" | "question" | null; activity_zone?: ActivityZone; note?: string | null }
  ): WorkItemView | undefined {
    const item = this.workItems.get(id);
    if (!item) return undefined;

    const now = new Date().toISOString();
    if (params.title !== undefined) {
      item.title = params.title.trim();
      for (const session of this.focusSessions.values()) {
        if (session.work_item_id === item.id) {
          session.work_item_title = item.title;
        }
      }
    }
    if (params.type !== undefined) {
      item.type = params.type || undefined;
    }
    if (params.activity_zone !== undefined) {
      item.activity_zone = params.activity_zone;
    }
    if (params.note !== undefined) {
      item.note = params.note?.trim() || undefined;
    }
    item.updated_at = now;
    item.last_seen_at = now;
    this.workItems.set(id, item);
    return item;
  }

  toggleWorkItemPin(id: string): boolean {
    const item = this.workItems.get(id);
    if (!item) return false;
    const now = new Date().toISOString();
    item.pinned = !item.pinned;
    item.updated_at = now;
    return true;
  }

  deleteWorkItem(id: string): { deleted: boolean; stoppedFocusSessionId?: string } {
    const item = this.workItems.get(id);
    if (!item) return { deleted: false };

    const current = this.getActiveFocusSession();
    const stopped = current?.work_item_id === id ? this.stopFocusSession(current.id, "work item deleted") : undefined;

    return {
      deleted: this.workItems.delete(id),
      stoppedFocusSessionId: stopped?.id,
    };
  }

  // Ref methods
  addRef(
    workItemId: string,
    kind: RefView["kind"],
    value: string,
    isPrimary?: boolean
  ): { ref?: RefView; conflict?: { workItemId: string; workItemTitle: string } } {
    const item = this.workItems.get(workItemId);
    if (!item) {
      return {};
    }

    // Check for conflict
    for (const [, workItem] of this.workItems) {
      for (const ref of workItem.refs) {
        if (ref.kind === kind && ref.value.toLowerCase() === value.toLowerCase()) {
          if (workItem.id !== workItemId) {
            return {
              conflict: {
                workItemId: workItem.id,
                workItemTitle: workItem.title,
              },
            };
          }
        }
      }
    }

    const ref: RefView = {
      id: uuidv4(),
      kind,
      value,
      is_primary: isPrimary || item.refs.length === 0,
    };

    item.refs.push(ref);
    item.refs_count = item.refs.length;
    item.updated_at = new Date().toISOString();
    this.refs.set(ref.id, ref);

    return { ref };
  }

  removeRef(workItemId: string, refId: string): boolean {
    const item = this.workItems.get(workItemId);
    if (!item) return false;

    const index = item.refs.findIndex((r) => r.id === refId);
    if (index === -1) return false;

    item.refs.splice(index, 1);
    item.refs_count = item.refs.length;
    item.updated_at = new Date().toISOString();
    this.refs.delete(refId);

    return true;
  }

  checkRefConflict(
    kind: RefView["kind"],
    value: string
  ): { exists: boolean; workItemId?: string; workItemTitle?: string } {
    for (const [, workItem] of this.workItems) {
      for (const ref of workItem.refs) {
        if (ref.kind === kind && ref.value.toLowerCase() === value.toLowerCase()) {
          return {
            exists: true,
            workItemId: workItem.id,
            workItemTitle: workItem.title,
          };
        }
      }
    }
    return { exists: false };
  }

  // Denylist methods
  getDenylist(): DenylistRule[] {
    return Array.from(this.denylist.values());
  }

  addToDenylist(pattern: string, policy: "block" | "redact_to_domain"): DenylistRule {
    const rule: DenylistRule = {
      id: uuidv4(),
      pattern,
      policy,
      created_at: new Date().toISOString(),
    };
    this.denylist.set(rule.id, rule);
    return rule;
  }

  removeFromDenylist(id: string): boolean {
    return this.denylist.delete(id);
  }

  // Focus session methods
  private clearActiveWorkItems(keepId?: string): void {
    const now = new Date().toISOString();

    for (const item of this.workItems.values()) {
      if (item.state === "active" && item.id !== keepId) {
        item.state = "unknown";
        item.updated_at = now;
        item.last_seen_at = now;
      }
    }
  }

  getActiveFocusSession(): FocusSessionView | undefined {
    const session = Array.from(this.focusSessions.values()).find(
      (session) => session.state === "active"
    );
    return session ? this.withLiveTiming(session) : undefined;
  }

  startFocusSession(params: {
    title: string;
    work_item_id?: string;
    target_seconds?: number;
  }): FocusSessionView {
    const title = params.title?.trim();
    let workItem = params.work_item_id
      ? this.workItems.get(params.work_item_id)
      : undefined;

    if (!workItem) {
      if (!title) {
        throw new Error("Title is required");
      }
      workItem = this.findWorkItemByTitle(title) || this.createWorkItem(title, "task", "unknown", "work");
    }

    const current = this.getActiveFocusSession();
    if (current && current.work_item_id === workItem.id) {
      return current;
    }

    if (current) {
      this.stopFocusSession(current.id);
    }

    const now = new Date().toISOString();

    this.clearActiveWorkItems(workItem.id);

    const session: FocusSessionView = {
      id: uuidv4(),
      title: workItem.title,
      work_item_id: workItem.id,
      work_item_title: workItem.title,
      activity_zone: workItem.activity_zone,
      state: "active",
      target_seconds: Math.max(params.target_seconds || 25 * 60, 60),
      active_seconds: 0,
      over_target_seconds: 0,
      started_at: now,
      updated_at: now,
    };

    this.focusSessions.set(session.id, session);

    workItem.state = "active";
    workItem.updated_at = now;
    workItem.last_seen_at = now;

    return this.withLiveTiming(session);
  }

  stopFocusSession(id?: string, note?: string): FocusSessionView | undefined {
    const session = id
      ? this.focusSessions.get(id)
      : Array.from(this.focusSessions.values()).find((item) => item.state === "active");

    if (!session) return undefined;

    const now = new Date().toISOString();
    const wasActive = session.state === "active";
    session.state = "stopped";
    session.stopped_at = session.stopped_at || now;
    session.updated_at = now;
    if (note !== undefined) {
      const trimmed = note.trim();
      session.note = trimmed || undefined;
    }

    this.focusSessions.set(session.id, session);

    if (wasActive && session.work_item_id) {
      const item = this.workItems.get(session.work_item_id);
      if (item?.state === "active") {
        item.state = "unknown";
        item.updated_at = now;
        item.last_seen_at = now;
      }
    }

    return this.withLiveTiming(session);
  }

  updateFocusSession(
    id: string,
    params: {
      title?: string;
      work_item_id?: string | null;
      activity_zone?: ActivityZone;
      target_seconds?: number;
      note?: string | null;
      started_at?: string;
      stopped_at?: string;
    }
  ): FocusSessionView | undefined {
    const session = this.focusSessions.get(id);
    if (!session || session.state === "active") return undefined;

    const assignment = this.resolveFocusAssignment({
      title: params.title,
      work_item_id: params.work_item_id,
      fallbackTitle: session.title,
      fallbackWorkItemId: session.work_item_id,
      fallbackWorkItemTitle: session.work_item_title,
      fallbackActivityZone: session.activity_zone,
    });
    session.title = assignment.title;
    session.work_item_id = assignment.workItemId;
    session.work_item_title = assignment.workItemTitle;
    session.activity_zone = params.activity_zone || assignment.activityZone;

    if (params.target_seconds !== undefined) {
      session.target_seconds = Math.max(params.target_seconds, 60);
    }
    if (params.note !== undefined) {
      session.note = params.note?.trim() || undefined;
    }
    if (params.started_at) {
      session.started_at = params.started_at;
    }
    if (params.stopped_at) {
      session.stopped_at = params.stopped_at;
    }

    if (!session.stopped_at || new Date(session.stopped_at).getTime() <= new Date(session.started_at).getTime()) {
      return undefined;
    }

    session.updated_at = new Date().toISOString();
    this.focusSessions.set(session.id, session);
    return this.withLiveTiming(session);
  }

  createStoppedFocusSession(params: {
    title?: string;
    work_item_id?: string;
    activity_zone?: ActivityZone;
    target_seconds?: number;
    note?: string | null;
    started_at: string;
    stopped_at: string;
  }): FocusSessionView | undefined {
    const assignment = this.resolveFocusAssignment({
      title: params.title,
      work_item_id: params.work_item_id,
      fallbackTitle: "Missed focus block",
      fallbackActivityZone: "work",
    });
    const startedAt = new Date(params.started_at).getTime();
    const stoppedAt = new Date(params.stopped_at).getTime();
    if (Number.isNaN(startedAt) || Number.isNaN(stoppedAt) || stoppedAt <= startedAt) {
      return undefined;
    }

    const now = new Date().toISOString();
    const session: FocusSessionView = {
      id: uuidv4(),
      title: assignment.title,
      work_item_id: assignment.workItemId,
      work_item_title: assignment.workItemTitle,
      activity_zone: params.activity_zone || assignment.activityZone,
      state: "stopped",
      target_seconds: Math.max(params.target_seconds || 25 * 60, 60),
      active_seconds: 0,
      over_target_seconds: 0,
      note: params.note?.trim() || undefined,
      started_at: params.started_at,
      stopped_at: params.stopped_at,
      updated_at: now,
    };
    this.focusSessions.set(session.id, session);

    return this.withLiveTiming(session);
  }

  splitFocusSession(
    id: string,
    params: {
      split_at: string;
      right_title?: string;
      right_work_item_id?: string | null;
      right_note?: string | null;
    }
  ): { left: FocusSessionView; right: FocusSessionView } | undefined {
    const left = this.focusSessions.get(id);
    if (!left || left.state === "active" || !left.stopped_at) return undefined;

    const splitAt = new Date(params.split_at).getTime();
    const startedAt = new Date(left.started_at).getTime();
    const stoppedAt = new Date(left.stopped_at).getTime();
    if (splitAt <= startedAt || splitAt >= stoppedAt) return undefined;

    const assignment = this.resolveFocusAssignment({
      title: params.right_title,
      work_item_id: params.right_work_item_id,
      fallbackTitle: left.title,
      fallbackWorkItemId: left.work_item_id,
      fallbackWorkItemTitle: left.work_item_title,
      fallbackActivityZone: left.activity_zone,
    });
    const now = new Date().toISOString();
    const oldStoppedAt = left.stopped_at;

    left.stopped_at = params.split_at;
    left.updated_at = now;
    this.focusSessions.set(left.id, left);

    const right: FocusSessionView = {
      id: uuidv4(),
      title: assignment.title,
      work_item_id: assignment.workItemId,
      work_item_title: assignment.workItemTitle,
      activity_zone: assignment.activityZone,
      state: "stopped",
      target_seconds: left.target_seconds,
      active_seconds: 0,
      over_target_seconds: 0,
      note: params.right_note?.trim() || undefined,
      started_at: params.split_at,
      stopped_at: oldStoppedAt,
      updated_at: now,
    };
    this.focusSessions.set(right.id, right);

    return {
      left: this.withLiveTiming(left),
      right: this.withLiveTiming(right),
    };
  }

  listFocusSessions(from?: string, to?: string): FocusSessionView[] {
    const fromTime = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
    const toTime = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;
    const now = Date.now();

    return Array.from(this.focusSessions.values())
      .filter((session) => {
        const startedAt = new Date(session.started_at).getTime();
        const stoppedAt = session.stopped_at ? new Date(session.stopped_at).getTime() : now;
        return stoppedAt > fromTime && startedAt < toTime;
      })
      .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
      .map((session) => this.withWindowTiming(session, fromTime, toTime, now));
  }

  private withLiveTiming(session: FocusSessionView): FocusSessionView {
    const end = session.stopped_at ? new Date(session.stopped_at) : new Date();
    const activeSeconds = Math.max(
      Math.floor((end.getTime() - new Date(session.started_at).getTime()) / 1000),
      0
    );

    return {
      ...session,
      active_seconds: activeSeconds,
      over_target_seconds: Math.max(activeSeconds - session.target_seconds, 0),
    };
  }

  private withWindowTiming(
    session: FocusSessionView,
    fromTime: number,
    toTime: number,
    now: number
  ): FocusSessionView {
    const startedAt = new Date(session.started_at).getTime();
    const stoppedAt = session.stopped_at ? new Date(session.stopped_at).getTime() : now;
    const clippedStart = Math.max(startedAt, fromTime);
    const clippedStop = Math.min(stoppedAt, toTime);
    const activeSeconds = Math.max(Math.floor((clippedStop - clippedStart) / 1000), 0);

    return {
      ...session,
      active_seconds: activeSeconds,
      over_target_seconds: Math.max(activeSeconds - session.target_seconds, 0),
    };
  }

  private resolveFocusAssignment(params: {
    title?: string;
    work_item_id?: string | null;
    fallbackTitle: string;
    fallbackWorkItemId?: string;
    fallbackWorkItemTitle?: string;
    fallbackActivityZone?: ActivityZone;
  }): { title: string; workItemId?: string; workItemTitle?: string; activityZone: ActivityZone } {
    if (params.work_item_id !== undefined) {
      if (params.work_item_id === null) {
        const title = params.title?.trim() || params.fallbackTitle;
        return { title, activityZone: "work" };
      }

      const item = this.workItems.get(params.work_item_id);
      if (item) {
        return { title: item.title, workItemId: item.id, workItemTitle: item.title, activityZone: item.activity_zone };
      }
    }

    const title = params.title?.trim();
    if (title) {
      const item = this.findWorkItemByTitle(title) || this.createWorkItem(title, "task", "unknown", "work");
      return { title: item.title, workItemId: item.id, workItemTitle: item.title, activityZone: item.activity_zone };
    }

    return {
      title: params.fallbackTitle,
      workItemId: params.fallbackWorkItemId,
      workItemTitle: params.fallbackWorkItemTitle,
      activityZone: params.fallbackActivityZone || "work",
    };
  }

  private aggregateWorkItemFocusSeconds(from?: string, to?: string): Map<string, number> {
    const totals = new Map<string, number>();
    const fromTime = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
    const toTime = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;
    const now = Date.now();

    for (const session of this.focusSessions.values()) {
      if (!session.work_item_id) continue;
      const startedAt = new Date(session.started_at).getTime();
      const stoppedAt = session.stopped_at ? new Date(session.stopped_at).getTime() : now;
      if (stoppedAt <= fromTime || startedAt >= toTime) continue;

      const clippedStart = Math.max(startedAt, fromTime);
      const clippedStop = Math.min(stoppedAt, toTime);
      const seconds = Math.max(Math.floor((clippedStop - clippedStart) / 1000), 0);
      totals.set(session.work_item_id, (totals.get(session.work_item_id) ?? 0) + seconds);
    }

    return totals;
  }
}

function sanitizePayload(payload?: Record<string, unknown>) {
  if (!payload) return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLocaleLowerCase();
    if (["title", "note", "url", "value", "text", "query", "search"].some((part) => lowerKey.includes(part))) {
      continue;
    }
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      result[key] = typeof value === "string" ? value.slice(0, 120) : value;
    }
  }
  return result;
}
