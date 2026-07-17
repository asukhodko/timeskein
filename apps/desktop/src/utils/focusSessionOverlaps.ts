import type { FocusSessionView } from '@timeskein/contracts'

export interface FocusSessionOverlap {
  first: FocusSessionView
  second: FocusSessionView
  from: Date
  to: Date
  seconds: number
}

export function findFocusSessionOverlaps(sessions: FocusSessionView[]): FocusSessionOverlap[] {
  const stopped = sessions
    .filter((session) => session.stopped_at)
    .map((session) => ({
      session,
      from: new Date(session.started_at),
      to: new Date(session.stopped_at!),
    }))
    .filter(({ from, to }) => Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && to > from)
    .sort((left, right) => left.from.getTime() - right.from.getTime())

  const overlaps: FocusSessionOverlap[] = []
  for (let firstIndex = 0; firstIndex < stopped.length; firstIndex += 1) {
    const first = stopped[firstIndex]
    for (let secondIndex = firstIndex + 1; secondIndex < stopped.length; secondIndex += 1) {
      const second = stopped[secondIndex]
      if (second.from >= first.to) break

      const from = second.from > first.from ? second.from : first.from
      const to = second.to < first.to ? second.to : first.to
      if (to > from) {
        overlaps.push({
          first: first.session,
          second: second.session,
          from,
          to,
          seconds: Math.floor((to.getTime() - from.getTime()) / 1000),
        })
      }
    }
  }

  return overlaps
}
