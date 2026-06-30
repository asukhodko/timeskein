import { useEffect, useMemo, useRef, useState } from 'react'
import type { FocusSessionView, WorkItemView } from '@timeskein/contracts'
import {
  useCurrentFocusSession,
  useStartFocusSession,
  useStopFocusSession,
  useTodayFocusSessions,
} from '../hooks/useFocusSessions'
import { formatClockTime, formatDuration, truncate } from '../utils/formatTime'

interface FocusPanelProps {
  selectedItem?: WorkItemView
}

export default function FocusPanel({ selectedItem }: FocusPanelProps) {
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const currentQuery = useCurrentFocusSession()
  const todayQuery = useTodayFocusSessions()
  const startMutation = useStartFocusSession()
  const stopMutation = useStopFocusSession()

  const current = currentQuery.data?.session
  const sessions = todayQuery.data?.sessions ?? []
  const sessionsWithGaps = useMemo(() => withGaps([...sessions].reverse()), [sessions])
  const activeSecondsTotal = todayQuery.data?.active_seconds_total ?? 0

  useEffect(() => {
    if (!current) {
      titleInputRef.current?.focus()
    }
  }, [current])

  const startFreeSession = () => {
    const trimmed = title.trim()
    if (!trimmed || startMutation.isPending) return

    startMutation.mutate(
      { title: trimmed, target_seconds: 25 * 60 },
      {
        onSuccess: () => {
          setTitle('')
          setNote('')
        },
      }
    )
  }

  const startSelectedSession = () => {
    if (!selectedItem || startMutation.isPending) return

    startMutation.mutate(
      {
        title: selectedItem.title,
        work_item_id: selectedItem.id,
        target_seconds: 25 * 60,
      },
      {
        onSuccess: () => {
          setTitle('')
          setNote('')
        },
      }
    )
  }

  const stopCurrentSession = () => {
    if (stopMutation.isPending) return

    stopMutation.mutate(
      { note },
      {
        onSuccess: () => setNote(''),
      }
    )
  }

  const mutationError = startMutation.error || stopMutation.error

  return (
    <section className="border-b border-gray-700 bg-gray-950/45">
      <div className="px-4 py-3">
        {current ? (
          <ActiveFocusSession session={current} note={note} setNote={setNote} onStop={stopCurrentSession} stopping={stopMutation.isPending} />
        ) : (
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={titleInputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    startFreeSession()
                  }
                }}
                placeholder="What are you focusing on?"
                className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={startFreeSession}
                disabled={!title.trim() || startMutation.isPending}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
              >
                Start
              </button>
            </div>
            {selectedItem && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Selected item</div>
                  <div className="truncate text-xs font-medium text-gray-200">
                    {truncate(selectedItem.title, 80)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={startSelectedSession}
                  disabled={startMutation.isPending}
                  className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
                >
                  Start Item
                </button>
              </div>
            )}
          </div>
        )}

        {mutationError && (
          <div className="mt-2 text-xs text-red-300">
            {mutationError instanceof Error ? mutationError.message : 'Focus action failed'}
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 px-4 py-2">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-gray-300">Today</span>
          <span className="text-gray-400">
            {formatDuration(activeSecondsTotal)} focus · {sessions.length} entrances
          </span>
        </div>

        {todayQuery.isLoading ? (
          <div className="text-xs text-gray-500">Loading focus blocks...</div>
        ) : sessionsWithGaps.length === 0 ? (
          <div className="text-xs text-gray-500">No focus blocks today</div>
        ) : (
          <div className="grid max-h-40 gap-1.5 overflow-auto pr-1">
            {sessionsWithGaps.map(({ session, gapAfterSeconds }) => (
              <FocusSessionRow key={session.id} session={session} gapAfterSeconds={gapAfterSeconds} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ActiveFocusSession({
  session,
  note,
  setNote,
  onStop,
  stopping,
}: {
  session: FocusSessionView
  note: string
  setNote: (value: string) => void
  onStop: () => void
  stopping: boolean
}) {
  const progress = Math.min((session.active_seconds / session.target_seconds) * 100, 100)
  const isOverTarget = session.over_target_seconds > 0

  return (
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-emerald-300">Active focus</div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold text-gray-100">{session.title}</div>
            {session.work_item_id && (
              <span className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                item
              </span>
            )}
          </div>
          {session.work_item_title && session.work_item_title !== session.title && (
            <div className="truncate text-xs text-gray-500">{session.work_item_title}</div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className={isOverTarget ? 'text-2xl font-semibold tabular-nums text-amber-300' : 'text-2xl font-semibold tabular-nums text-gray-100'}>
            {formatDuration(session.active_seconds)}
          </div>
          <div className="text-xs text-gray-500">
            target {formatDuration(session.target_seconds)}
            {isOverTarget ? ` +${formatDuration(session.over_target_seconds)}` : ''}
          </div>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
        <div
          className={isOverTarget ? 'h-full bg-amber-400' : 'h-full bg-emerald-500'}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional stop note"
          className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
        >
          Stop
        </button>
      </div>
    </div>
  )
}

function FocusSessionRow({
  session,
  gapAfterSeconds,
}: {
  session: FocusSessionView
  gapAfterSeconds?: number
}) {
  const range = `${formatClockTime(session.started_at)}-${formatClockTime(session.stopped_at)}`
  const stateClass = session.state === 'active' ? 'text-emerald-300' : 'text-gray-500'
  const title = session.work_item_title ?? session.title
  const detailTitle = session.work_item_title && session.work_item_title !== session.title ? session.title : undefined

  return (
    <div className="rounded bg-gray-900/60 px-2 py-1 text-xs">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <span className="font-mono tabular-nums text-gray-400">{formatDuration(session.active_seconds)}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-gray-200">{title}</span>
          {session.work_item_id && (
            <span className="shrink-0 rounded border border-gray-700 px-1 text-[10px] uppercase tracking-wide text-gray-400">
              item
            </span>
          )}
        </span>
        <span className={stateClass}>{range}</span>
      </div>
      {detailTitle && (
        <div className="mt-0.5 truncate pl-[3.25rem] text-[11px] text-gray-500">{detailTitle}</div>
      )}
      {gapAfterSeconds !== undefined && gapAfterSeconds > 60 && (
        <div className="mt-0.5 text-right text-[11px] text-gray-600">
          gap before this: {formatDuration(gapAfterSeconds)}
        </div>
      )}
    </div>
  )
}

function withGaps(sessionsNewestFirst: FocusSessionView[]) {
  return sessionsNewestFirst.map((session, index) => {
    const nextOlder = sessionsNewestFirst[index + 1]
    if (!nextOlder) {
      return { session }
    }

    const nextStart = new Date(session.started_at).getTime()
    const previousEnd = new Date(nextOlder.stopped_at ?? nextOlder.started_at).getTime()
    const gapAfterSeconds = Math.max(Math.floor((nextStart - previousEnd) / 1000), 0)

    return { session, gapAfterSeconds }
  })
}
