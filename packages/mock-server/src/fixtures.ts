import type {
  WorkItemView,
  WorkItemState,
  RefView,
  DenylistRule,
  FocusSessionView,
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
    state: "unknown",
    pinned: true,
    note: "Next: finish keyboard navigation, then test on Windows",
    refs_count: 2,
    refs: mockRefs["item-1"],
    created_at: weekAgo,
    updated_at: hourAgo,
    last_seen_at: hourAgo,
  },
  {
    id: "item-2",
    title: "Fix validation error on login form",
    type: "task",
    state: "unknown",
    pinned: false,
    note: "Check PROJ-123 for repro steps",
    refs_count: 1,
    refs: mockRefs["item-2"],
    created_at: twoDaysAgo,
    updated_at: dayAgo,
    last_seen_at: dayAgo,
  },
  {
    id: "item-3",
    title: "Review API documentation",
    type: "task",
    state: "waiting",
    pinned: false,
    note: "Waiting for backend team to finalize endpoints",
    refs_count: 1,
    refs: mockRefs["item-3"],
    created_at: weekAgo,
    updated_at: twoDaysAgo,
    last_seen_at: twoDaysAgo,
  },
  {
    id: "item-4",
    title: "Refactor state management",
    type: "project",
    state: "someday",
    pinned: false,
    note: undefined,
    refs_count: 0,
    refs: [],
    created_at: weekAgo,
    updated_at: weekAgo,
    last_seen_at: undefined,
  },
  {
    id: "item-5",
    title: "Staging environment access",
    type: "task",
    state: "blocked",
    pinned: false,
    note: "Need VPN access from IT",
    refs_count: 1,
    refs: mockRefs["item-5"],
    created_at: twoDaysAgo,
    updated_at: dayAgo,
    last_seen_at: dayAgo,
  },
  {
    id: "item-6",
    title: "Get design feedback",
    type: "question",
    state: "waiting",
    pinned: false,
    note: "Sent designs to designer on Monday",
    refs_count: 1,
    refs: mockRefs["item-6"],
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
  private startTime: number;

  constructor() {
    this.workItems = new Map();
    this.refs = new Map();
    this.denylist = new Map();
    this.focusSessions = new Map();
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

  // Agent methods
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  getWorkItemCount(): number {
    return this.workItems.size;
  }

  // Inventory methods
  listWorkItems(search?: string, stateFilter?: WorkItemState[]): WorkItemView[] {
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

    return items;
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
      state: state || "unknown",
      pinned: false,
      note,
      refs_count: 0,
      refs: [],
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
      workItem = this.findWorkItemByTitle(title) || this.createWorkItem(title, "task", "unknown");
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
}
