import type { WorkItemView } from '@timeskein/contracts'

export type WorkItemOpenAction =
  | { kind: 'edit' }
  | { kind: 'none' }

export function resolveWorkItemOpenAction(item?: Pick<WorkItemView, 'id'>): WorkItemOpenAction {
  if (!item) return { kind: 'none' }
  return { kind: 'edit' }
}
