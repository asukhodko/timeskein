import type {
  WorkItemView,
  WorkItemState,
  RefView,
  DenylistRule,
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
    state: "active",
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
    state: "active",
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
  private startTime: number;

  constructor() {
    this.workItems = new Map();
    this.refs = new Map();
    this.denylist = new Map();
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

  // Work item methods
  createWorkItem(
    title: string,
    type?: "task" | "project" | "question",
    state?: WorkItemState,
    note?: string
  ): WorkItemView {
    const now = new Date().toISOString();
    const item: WorkItemView = {
      id: uuidv4(),
      title,
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
    item.state = state;
    item.updated_at = now;
    item.last_seen_at = now;
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

  deleteWorkItem(id: string): boolean {
    return this.workItems.delete(id);
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
}
