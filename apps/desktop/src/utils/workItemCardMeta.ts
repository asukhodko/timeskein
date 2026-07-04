import type { WorkItemView } from '@timeskein/contracts'
import { formatDuration } from './formatTime'

export interface WorkItemTimeBadge {
  kind: 'today' | 'total'
  label: string
  value: string
}

type WorkItemTimeFields = Pick<WorkItemView, 'today_active_seconds' | 'total_active_seconds'>

export function getWorkItemTimeBadges(item: WorkItemTimeFields): WorkItemTimeBadge[] {
  const badges: WorkItemTimeBadge[] = []

  if (item.today_active_seconds > 0) {
    badges.push({
      kind: 'today',
      label: 'today',
      value: formatDuration(item.today_active_seconds),
    })
  }

  if (item.total_active_seconds > 0) {
    badges.push({
      kind: 'total',
      label: 'total',
      value: formatDuration(item.total_active_seconds),
    })
  }

  return badges
}
