import type { ActivityZone, FocusSessionView } from '@timeskein/contracts'

export type ActivityZoneTotal = {
  zone: ActivityZone
  activeSeconds: number
  entrances: number
}

export type ActivityZoneSummary = {
  totalTrackedSeconds: number
  workingOccupancySeconds: number
  executiveWorkSeconds: number
  nonWorkTrackedSeconds: number
  coordinationSeconds: number
}

export const WORKING_OCCUPANCY_ZONES: ActivityZone[] = ['work', 'coordination']

export function aggregateActivityZoneTotals(
  sessions: Array<Pick<FocusSessionView, 'activity_zone' | 'active_seconds'>>
): ActivityZoneTotal[] {
  const totals = new Map<ActivityZone, ActivityZoneTotal>()

  for (const session of sessions) {
    const current = totals.get(session.activity_zone) ?? {
      zone: session.activity_zone,
      activeSeconds: 0,
      entrances: 0,
    }

    current.activeSeconds += session.active_seconds
    current.entrances += 1
    totals.set(session.activity_zone, current)
  }

  return Array.from(totals.values()).sort((left, right) => {
    if (right.activeSeconds !== left.activeSeconds) {
      return right.activeSeconds - left.activeSeconds
    }

    return left.zone.localeCompare(right.zone)
  })
}

export function getZoneActiveSeconds(
  zoneTotals: Array<{ zone: ActivityZone; activeSeconds: number }>,
  zone: ActivityZone
) {
  return zoneTotals.find((item) => item.zone === zone)?.activeSeconds ?? 0
}

export function summarizeActivityZones(
  zoneTotals: Array<{ zone: ActivityZone; activeSeconds: number }>,
  totalTrackedSeconds = zoneTotals.reduce((sum, item) => sum + item.activeSeconds, 0)
): ActivityZoneSummary {
  const executiveWorkSeconds = getZoneActiveSeconds(zoneTotals, 'work')
  const coordinationSeconds = getZoneActiveSeconds(zoneTotals, 'coordination')
  const workingOccupancySeconds = executiveWorkSeconds + coordinationSeconds

  return {
    totalTrackedSeconds,
    workingOccupancySeconds,
    executiveWorkSeconds,
    coordinationSeconds,
    nonWorkTrackedSeconds: Math.max(totalTrackedSeconds - workingOccupancySeconds, 0),
  }
}
