import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppEventSummary, CaptureView, FocusSessionView, WorkItemView } from '@timeskein/contracts'
import {
  useCurrentFocusSession,
  useStartFocusSession,
  useStopFocusSession,
  useTodayFocusSessions,
} from '../hooks/useFocusSessions'
import { useInventory } from '../hooks/useInventory'
import { useCaptureActivity, useOpenCaptures } from '../hooks/useCaptures'
import { appEventApi, logAppEvent, shellApi } from '../api/client'
import { formatClockTime, formatDuration, truncate } from '../utils/formatTime'
import CaptureInbox from './CaptureInbox'

interface FocusPanelProps {
  selectedItem?: WorkItemView
}

const SIGNIFICANT_GAP_SECONDS = 20 * 60

export default function FocusPanel({ selectedItem }: FocusPanelProps) {
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [copyDayState, setCopyDayState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [copyReportState, setCopyReportState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [manualCopy, setManualCopy] = useState<{ label: string; text: string } | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const manualCopyRef = useRef<HTMLTextAreaElement>(null)

  const currentQuery = useCurrentFocusSession()
  const todayQuery = useTodayFocusSessions()
  const inventoryQuery = useInventory()
  const capturesQuery = useOpenCaptures()
  const captureActivityQuery = useCaptureActivity()
  const startMutation = useStartFocusSession()
  const stopMutation = useStopFocusSession()

  const current = currentQuery.data?.session
  const currentId = current?.id
  const sessions = todayQuery.data?.sessions ?? []
  const inventoryItems = useMemo(() => inventoryQuery.data?.items ?? [], [inventoryQuery.data?.items])
  const activeWorkItems = useMemo(
    () => inventoryItems.filter((item) => item.state === 'active'),
    [inventoryItems]
  )
  const activeSecondsTotal = todayQuery.data?.active_seconds_total ?? 0
  const openCaptures = capturesQuery.data?.captures ?? []
  const captureActivity = useMemo(
    () => capturesForLocalDay(captureActivityQuery.data?.captures ?? [], now),
    [captureActivityQuery.data?.captures, now]
  )
  const sessionsWithGaps = useMemo(() => withGaps([...sessions].reverse()), [sessions])
  const openGap = useMemo(
    () => (current ? undefined : openGapAfterLastSession(sessions, now)),
    [current, sessions, now]
  )
  const reportIsDraft = current?.state === 'active' || activeWorkItems.length > 0
  const trayStatusTitle = useMemo(() => buildTrayStatusTitle(current), [current])
  const todayMarkdown = useMemo(
    () => buildTodayMarkdown(sessions, activeSecondsTotal, now, inventoryItems),
    [sessions, activeSecondsTotal, now, inventoryItems]
  )
  const focusTitleInput = ({ force = false } = {}) => {
    window.requestAnimationFrame(() => {
      const activeElement = document.activeElement
      if (!force && isEditableElement(activeElement) && activeElement !== titleInputRef.current) {
        return
      }

      titleInputRef.current?.focus()
    })
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const handleWindowFocus = () => {
      focusTitleInput()
    }

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        focusTitleInput()
      }
    }

    focusTitleInput({ force: true })
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    focusTitleInput({ force: true })
  }, [currentId])

  useEffect(() => {
    if (!current) {
      setNote('')
    }
  }, [current])

  useEffect(() => {
    let cancelled = false

    shellApi.setTrayStatusTitle(trayStatusTitle).catch((error) => {
      if (!cancelled) {
        console.warn('Unable to update Timeskein tray status title', error)
      }
    })

    return () => {
      cancelled = true
    }
  }, [trayStatusTitle])

  useEffect(() => {
    if (!manualCopy) return

    window.requestAnimationFrame(() => {
      manualCopyRef.current?.focus()
      manualCopyRef.current?.select()
    })
  }, [manualCopy])

  const startTypedSession = () => {
    const trimmed = title.trim()
    if (!trimmed || startMutation.isPending) return

    const actionId = createTelemetryActionId()
    const wasSwitch = Boolean(current)
    void logAppEvent({
      source: 'ui',
      kind: wasSwitch ? 'focus_switch_requested' : 'focus_start_requested',
      payload: {
        action_id: actionId,
        control: 'typed',
      },
    })

    startMutation.mutate(
      { title: trimmed, target_seconds: 25 * 60, telemetry_action_id: actionId },
      {
        onSuccess: (session) => {
          setTitle('')
          setNote('')
          void logAppEvent({
            source: 'ui',
            kind: wasSwitch ? 'focus_switched' : 'focus_started',
            work_item_id: session.work_item_id,
            focus_session_id: session.id,
            payload: {
              action_id: actionId,
              control: 'typed',
              already_active: session.id === current?.id,
            },
          })
        },
        onError: (error) => {
          void logAppEvent({
            source: 'ui',
            kind: 'focus_start_failed',
            payload: {
              action_id: actionId,
              control: 'typed',
              error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
            },
          })
        },
      }
    )
  }

  const startSelectedSession = () => {
    if (!selectedItem || startMutation.isPending) return

    const actionId = createTelemetryActionId()
    const wasSwitch = Boolean(current)
    void logAppEvent({
      source: 'ui',
      kind: wasSwitch ? 'focus_switch_requested' : 'focus_start_requested',
      work_item_id: selectedItem.id,
      payload: {
        action_id: actionId,
        control: 'selected_item',
      },
    })

    startMutation.mutate(
      {
        title: selectedItem.title,
        work_item_id: selectedItem.id,
        target_seconds: 25 * 60,
        telemetry_action_id: actionId,
      },
      {
        onSuccess: (session) => {
          setTitle('')
          setNote('')
          void logAppEvent({
            source: 'ui',
            kind: wasSwitch ? 'focus_switched' : 'focus_started',
            work_item_id: session.work_item_id,
            focus_session_id: session.id,
            payload: {
              action_id: actionId,
              control: 'selected_item',
              already_active: session.id === current?.id,
            },
          })
        },
        onError: (error) => {
          void logAppEvent({
            source: 'ui',
            kind: 'focus_start_failed',
            work_item_id: selectedItem.id,
            payload: {
              action_id: actionId,
              control: 'selected_item',
              error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
            },
          })
        },
      }
    )
  }

  const stopCurrentSession = () => {
    if (stopMutation.isPending) return

    const actionId = createTelemetryActionId()
    void logAppEvent({
      source: 'ui',
      kind: 'focus_stop_requested',
      work_item_id: current?.work_item_id,
      focus_session_id: current?.id,
      payload: {
        action_id: actionId,
        control: 'stop_button_or_enter',
      },
    })

    stopMutation.mutate(
      { note, telemetry_action_id: actionId },
      {
        onSuccess: (session) => {
          setNote('')
          void logAppEvent({
            source: 'ui',
            kind: 'focus_stopped',
            work_item_id: session.work_item_id,
            focus_session_id: session.id,
            payload: {
              action_id: actionId,
              control: 'stop_button_or_enter',
            },
          })
        },
        onError: (error) => {
          void logAppEvent({
            source: 'ui',
            kind: 'focus_stop_failed',
            work_item_id: current?.work_item_id,
            focus_session_id: current?.id,
            payload: {
              action_id: actionId,
              control: 'stop_button_or_enter',
              error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
            },
          })
        },
      }
    )
  }

  const copyTodayMarkdown = async () => {
    if (sessions.length === 0) return

    void logAppEvent({
      source: 'ui',
      kind: 'report_copy_requested',
      payload: {
        report_kind: 'day',
      },
    })

    try {
      await copyText(todayMarkdown)
      setCopyDayState('copied')
      setManualCopy(null)
      void logAppEvent({
        source: 'ui',
        kind: 'report_copied',
        payload: {
          report_kind: 'day',
        },
      })
    } catch {
      setCopyDayState('failed')
      setManualCopy({ label: 'Day Markdown', text: todayMarkdown })
      void logAppEvent({
        source: 'ui',
        kind: 'report_copy_failed',
        payload: {
          report_kind: 'day',
        },
      })
      void logAppEvent({
        source: 'ui',
        kind: 'manual_copy_fallback_shown',
        payload: {
          report_kind: 'day',
        },
      })
    }

    window.setTimeout(() => setCopyDayState('idle'), 1600)
  }

  const copyDogfoodReport = async () => {
    if (sessions.length === 0) return

    void logAppEvent({
      source: 'ui',
      kind: 'report_copy_requested',
      payload: {
        report_kind: 'dogfood',
      },
    })

    const reportMarkdown = await buildDogfoodReportMarkdown(
      todayMarkdown,
      current,
      activeWorkItems,
      openCaptures,
      captureActivity,
      sessions,
      inventoryItems,
      now
    )

    try {
      await copyText(reportMarkdown)
      setCopyReportState('copied')
      setManualCopy(null)
      void logAppEvent({
        source: 'ui',
        kind: 'report_copied',
        payload: {
          report_kind: 'dogfood',
        },
      })
    } catch {
      setCopyReportState('failed')
      setManualCopy({ label: 'Dogfood Report', text: reportMarkdown })
      void logAppEvent({
        source: 'ui',
        kind: 'report_copy_failed',
        payload: {
          report_kind: 'dogfood',
        },
      })
      void logAppEvent({
        source: 'ui',
        kind: 'manual_copy_fallback_shown',
        payload: {
          report_kind: 'dogfood',
        },
      })
    }

    window.setTimeout(() => setCopyReportState('idle'), 1600)
  }

  const mutationError = startMutation.error || stopMutation.error

  return (
    <section className="border-b border-gray-700 bg-gray-950/45">
      <div className="grid gap-3 px-4 py-3">
        {current && (
          <ActiveFocusSession session={current} note={note} setNote={setNote} onStop={stopCurrentSession} stopping={stopMutation.isPending} />
        )}

        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  startTypedSession()
                } else if (event.code === 'Space' && !title.trim() && selectedItem) {
                  event.preventDefault()
                  startSelectedSession()
                }
              }}
              placeholder={current ? 'Switch to...' : 'What are you focusing on?'}
              className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={startTypedSession}
              disabled={!title.trim() || startMutation.isPending}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
            >
              {current ? 'Switch' : 'Start'}
            </button>
          </div>
          {selectedItem && selectedItem.id !== current?.work_item_id && (
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
                {current ? 'Switch Item' : 'Start Item'}
              </button>
            </div>
          )}
        </div>

        <CaptureInbox focusSessionId={current?.id} />

        {mutationError && (
          <div className="mt-2 text-xs text-red-300">
            {mutationError instanceof Error ? mutationError.message : 'Focus action failed'}
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 px-4 py-2">
        <div className="mb-2 flex items-center justify-between text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-medium text-gray-300">Today</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={copyTodayMarkdown}
                disabled={sessions.length === 0}
                className="rounded border border-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
              >
                {copyDayState === 'copied' ? 'Copied' : copyDayState === 'failed' ? 'Failed' : 'Copy MD'}
              </button>
              <button
                type="button"
                onClick={copyDogfoodReport}
                disabled={sessions.length === 0}
                className="rounded border border-emerald-800 px-2 py-0.5 text-[11px] font-medium text-emerald-200 transition-colors hover:border-emerald-500 hover:text-emerald-100 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
              >
                {copyReportState === 'copied' ? 'Copied' : copyReportState === 'failed' ? 'Failed' : reportIsDraft ? 'Copy Draft' : 'Copy Report'}
              </button>
            </div>
          </div>
          <span className="shrink-0 text-gray-400">
            {formatDuration(activeSecondsTotal)} focus · {sessions.length} entrances
          </span>
        </div>

        {todayQuery.isLoading ? (
          <div className="text-xs text-gray-500">Loading focus blocks...</div>
        ) : manualCopy ? (
          <div className="mb-2 grid gap-1 rounded border border-amber-700/50 bg-amber-950/20 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-amber-200">{manualCopy.label}</span>
              <button
                type="button"
                onClick={() => setManualCopy(null)}
                className="rounded border border-amber-800 px-1.5 py-0.5 text-[11px] text-amber-200 hover:border-amber-500"
              >
                Close
              </button>
            </div>
            <textarea
              ref={manualCopyRef}
              readOnly
              value={manualCopy.text}
              onFocus={(event) => event.currentTarget.select()}
              className="h-28 resize-y rounded border border-amber-800 bg-gray-950 p-2 font-mono text-[11px] leading-relaxed text-gray-100"
            />
          </div>
        ) : sessionsWithGaps.length === 0 ? (
          <div className="text-xs text-gray-500">No focus blocks today</div>
        ) : (
          <div className="grid max-h-72 gap-1.5 overflow-auto pr-1">
            {openGap && <OpenGapRow gap={openGap} />}
            {sessionsWithGaps.map(({ session, gapBefore }) => (
              <FocusSessionRow key={session.id} session={session} gapBefore={gapBefore} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some browser shells expose navigator.clipboard but reject writes.
      // Fall through to the explicit textarea copy path.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    const copied = document.execCommand('copy')
    if (!copied) throw new Error('Copy command failed')
  } finally {
    document.body.removeChild(textarea)
  }
}

function isEditableElement(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.matches('input,textarea,select,[contenteditable="true"]')
}

function createTelemetryActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function buildTodayMarkdown(
  sessionsOldestFirst: FocusSessionView[],
  activeSecondsTotal: number,
  now: Date,
  workItems: WorkItemView[] = []
) {
  const dayStart = startOfLocalDay(now)
  const dayEnd = nextLocalDay(dayStart)
  const workItemNotes = new Map(
    workItems
      .filter((item) => item.note?.trim())
      .map((item) => [item.id, item.note?.trim() ?? ''])
  )
  const dateTitle = now.toLocaleDateString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const lines = [
    `# Timeskein focus day - ${dateTitle}`,
    '',
    `Total focus: ${formatDuration(activeSecondsTotal)}`,
    `Entrances: ${sessionsOldestFirst.length}`,
    '',
    '| Time | Duration | Work Item | Note |',
    '| --- | ---: | --- | --- |',
  ]

  for (const session of sessionsOldestFirst) {
    const title = session.work_item_title ?? session.title
    const range = `${formatClockTime(session.started_at)}-${formatClockTime(session.stopped_at)}`
    lines.push(
      `| ${escapeMarkdownTable(range)} | ${escapeMarkdownTable(formatDuration(session.active_seconds))} | ${escapeMarkdownTable(title)} | ${escapeMarkdownTable(session.note ?? '')} |`
    )
  }

  const dayBoundaryBlocks = sessionsOldestFirst.filter((session) =>
    sessionCrossesWindow(session, dayStart, dayEnd, now)
  )
  if (dayBoundaryBlocks.length > 0) {
    lines.push('', '## Day-Boundary Blocks')
    for (const session of dayBoundaryBlocks) {
      const title = session.work_item_title ?? session.title
      const range = `${formatClockTime(session.started_at)}-${formatClockTime(session.stopped_at)}`
      lines.push(
        `- ${range} ${title}: counted as ${formatDuration(session.active_seconds)} inside this day`
      )
    }
  }

  const workItemTotals = aggregateWorkItemTotals(sessionsOldestFirst, workItemNotes)
  if (workItemTotals.length > 0) {
    lines.push('', '## By Work Item', '', '| Duration | Entrances | Work Item |', '| ---: | ---: | --- |')
    for (const item of workItemTotals) {
      lines.push(
        `| ${escapeMarkdownTable(formatDuration(item.activeSeconds))} | ${item.entrances} | ${escapeMarkdownTable(item.title)} |`
      )
    }
  }

  appendWorkItemNotes(lines, workItemTotals)

  const gaps = gapsBetweenSessions(sessionsOldestFirst).filter(
    (gap) => gap.seconds >= SIGNIFICANT_GAP_SECONDS
  )
  if (gaps.length > 0) {
    lines.push('', `## Gaps >= ${formatDuration(SIGNIFICANT_GAP_SECONDS)}`)
    for (const gap of gaps) {
      lines.push(
        `- ${formatClockTime(gap.from)}-${formatClockTime(gap.to)}: ${formatDuration(gap.seconds)}`
      )
    }
  }

  const openGap = openGapAfterLastSession(sessionsOldestFirst, now, dayStart, dayEnd)
  if (openGap && openGap.seconds >= SIGNIFICANT_GAP_SECONDS) {
    lines.push('', '## Open Gap')
    lines.push(
      `- ${formatClockTime(openGap.from)}-${formatClockTime(openGap.to)}: ${formatDuration(openGap.seconds)} since last stopped block`
    )
  }

  return `${lines.join('\n')}\n`
}

async function buildDogfoodReportMarkdown(
  todayMarkdown: string,
  activeFocus?: FocusSessionView,
  activeWorkItems: WorkItemView[] = [],
  openCaptures: CaptureView[] = [],
  captureActivity: CaptureView[] = [],
  sessions: FocusSessionView[] = [],
  workItems: WorkItemView[] = [],
  now = new Date()
) {
  const hasActiveWorkItems = activeWorkItems.length > 0
  const reportState = activeFocus
    ? 'draft - focus block still active'
    : hasActiveWorkItems
      ? 'draft - active Work Item still marked active'
      : 'final - no active focus block or active Work Item'

  const lines = [
    `# Timeskein dogfood report - ${formatLocalDate(now)}`,
    '',
    `Report state: ${reportState}`,
    '',
  ]

  if (activeFocus) {
    lines.push(
      '## Active Block Warning',
      '',
      `- Active Work Item: ${activeFocus.work_item_title ?? activeFocus.title}`,
      `- Started: ${formatClockTime(activeFocus.started_at)}`,
      `- Current duration: ${formatDuration(activeFocus.active_seconds)}`,
      '- Stop the active block before treating this as the final day report.',
      ''
    )
  }

  if (!activeFocus && hasActiveWorkItems) {
    lines.push(
      '## Active Work Item Warning',
      '',
      ...activeWorkItems.map((item) => `- Active Work Item: ${item.title}`),
      '- Clear active Work Items before treating this as the final day report.',
      ''
    )
  }

  if (openCaptures.length > 0) {
    lines.push(
      '## Open Captures',
      '',
      ...openCaptures.map((capture) => `- ${formatClockTime(capture.created_at)} ${formatMarkdownListText(capture.text)}`),
      '- Resolve or convert these captures during review.',
      ''
    )
  }

  if (captureActivity.length > 0) {
    lines.push(
      formatCaptureActivityMarkdown(captureActivity, sessions, workItems).trim(),
      ''
    )
  }

  const appTelemetryMarkdown = await buildAppTelemetryMarkdown(now)

  lines.push(
    '## Focus Data',
    '',
    todayMarkdown.trim(),
    '',
    appTelemetryMarkdown.trim(),
    '',
    '## Review',
    '',
    '### Coverage',
    '',
    '- Missing focus blocks:',
    '- Blocks with unclear or wrong Work Item:',
    '- Duplicate or too-broad Work Items:',
    '',
    '### Gaps and Switching',
    '',
    '- Long gaps explained by real breaks:',
    '- Long gaps that look like lost tracking:',
    '- Switches that felt expensive:',
    '',
    '### Entry Cost',
    '',
    '- Where starting the next block required noticeable effort:',
    '- What made the effort easier to pay:',
    '- What Timeskein should make cheaper before daily use:',
    '',
    '### Product Friction',
    '',
    '- Start/switch/stop friction:',
    '- Window/tray friction:',
    '- Data trust issues:',
    '',
    '## Verdict',
    '',
    '- Enough data to discuss the day: yes/no',
    '- Good enough to replace Session tomorrow: yes/no',
    '- Next product fix:',
  )

  return `${lines.join('\n')}\n`
}

function capturesForLocalDay(captures: CaptureView[], now: Date) {
  const dayStart = startOfLocalDay(now).getTime()
  const dayEnd = nextLocalDay(startOfLocalDay(now)).getTime()

  return captures
    .filter((capture) => {
      const createdAt = new Date(capture.created_at).getTime()
      return createdAt >= dayStart && createdAt < dayEnd
    })
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
}

function formatCaptureActivityMarkdown(
  captures: CaptureView[],
  sessions: FocusSessionView[],
  workItems: WorkItemView[]
) {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  const workItemsById = new Map(workItems.map((item) => [item.id, item]))
  const lines = [
    '## Capture Activity',
    '',
    '| Time | State | Capture | During | Outcome |',
    '| --- | --- | --- | --- | --- |',
  ]

  for (const capture of captures) {
    lines.push(
      `| ${escapeMarkdownTable(formatClockTime(capture.created_at))} | ${escapeMarkdownTable(capture.state)} | ${escapeMarkdownTable(capture.text)} | ${escapeMarkdownTable(formatCaptureDuring(capture, sessionsById))} | ${escapeMarkdownTable(formatCaptureOutcome(capture, workItemsById))} |`
    )
  }

  return `${lines.join('\n')}\n`
}

function formatCaptureDuring(capture: CaptureView, sessionsById: Map<string, FocusSessionView>) {
  if (!capture.focus_session_id) {
    return 'no active focus'
  }

  const session = sessionsById.get(capture.focus_session_id)
  return session?.work_item_title ?? session?.title ?? 'linked focus block'
}

function formatCaptureOutcome(capture: CaptureView, workItemsById: Map<string, WorkItemView>) {
  if (capture.state === 'resolved') {
    return `resolved ${formatClockTime(capture.resolved_at ?? capture.updated_at)}`
  }

  if (capture.state === 'converted') {
    const item = capture.work_item_id ? workItemsById.get(capture.work_item_id) : undefined
    const itemTitle = item ? ` -> ${item.title}` : ''
    return `converted ${formatClockTime(capture.converted_at ?? capture.updated_at)}${itemTitle}`
  }

  return 'open'
}

async function buildAppTelemetryMarkdown(now: Date) {
  try {
    const dayStart = startOfLocalDay(now)
    const dayEnd = nextLocalDay(dayStart)
    const summary = await appEventApi.summary({
      from: dayStart.toISOString(),
      to: dayEnd.toISOString(),
    })

    return formatAppTelemetryMarkdown(summary)
  } catch {
    return [
      '## App Telemetry',
      '',
      'Telemetry unavailable in UI report. Run `pnpm dogfood:metrics` after the day.',
    ].join('\n')
  }
}

function formatAppTelemetryMarkdown(summary: AppEventSummary) {
  const lines = [
    '## App Telemetry',
    '',
    `Total events: ${summary.total}`,
    `Start requests: ${summary.start_requests}`,
    `Switch requests: ${summary.switch_requests}`,
    `Stop requests: ${summary.stop_requests}`,
    `Window shown/hidden: ${summary.window_shown}/${summary.window_hidden}`,
    `Window drag starts: ${summary.window_drag_started}`,
    `Copy failures: ${summary.copy_failures}`,
    `Manual copy fallbacks: ${summary.manual_copy_fallbacks}`,
    `API errors: ${summary.api_errors}`,
    `Already-active start attempts: ${summary.already_active_start_attempts}`,
    `Stale runtime recoveries: ${summary.stale_runtime_recoveries}`,
    `Average start latency: ${summary.average_focus_start_latency_ms == null ? 'n/a' : `${summary.average_focus_start_latency_ms}ms`}`,
    `Slow window-to-focus gaps: ${summary.slow_window_to_focus_count}`,
  ]

  const byKind = Object.entries(summary.by_kind)
  if (byKind.length > 0) {
    lines.push('', '### Events By Kind', '', '| Count | Kind |', '| ---: | --- |')
    for (const [kind, count] of byKind.sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )) {
      lines.push(`| ${count} | ${escapeMarkdownTable(kind)} |`)
    }
  }

  return `${lines.join('\n')}\n`
}

function aggregateWorkItemTotals(sessions: FocusSessionView[], workItemNotes = new Map<string, string>()) {
  const totals = new Map<string, { title: string; note?: string; activeSeconds: number; entrances: number }>()

  for (const session of sessions) {
    const key = session.work_item_id ?? `title:${session.title}`
    const title = session.work_item_title ?? session.title
    const note = session.work_item_id ? workItemNotes.get(session.work_item_id) : undefined
    const current = totals.get(key) ?? { title, note, activeSeconds: 0, entrances: 0 }

    current.title = title
    if (note) {
      current.note = note
    }
    current.activeSeconds += session.active_seconds
    current.entrances += 1
    totals.set(key, current)
  }

  return Array.from(totals.values()).sort((left, right) => {
    if (right.activeSeconds !== left.activeSeconds) {
      return right.activeSeconds - left.activeSeconds
    }

    return left.title.localeCompare(right.title)
  })
}

function appendWorkItemNotes(
  lines: string[],
  workItemTotals: Array<{ title: string; note?: string }>
) {
  const itemsWithNotes = workItemTotals.filter((item) => item.note?.trim())
  if (itemsWithNotes.length === 0) {
    return
  }

  lines.push('', '## Work Item Notes')
  for (const item of itemsWithNotes) {
    lines.push(`- ${formatMarkdownListText(item.title)}: ${formatMarkdownListText(item.note ?? '')}`)
  }
}

function gapsBetweenSessions(sessionsOldestFirst: FocusSessionView[]) {
  return sessionsOldestFirst.slice(1).map((session, index) => {
    const previous = sessionsOldestFirst[index]
    const previousEnd = previous.stopped_at ?? previous.started_at
    const seconds = Math.max(
      Math.floor((new Date(session.started_at).getTime() - new Date(previousEnd).getTime()) / 1000),
      0
    )

    return {
      from: previousEnd,
      to: session.started_at,
      seconds,
    }
  })
}

function openGapAfterLastSession(
  sessionsOldestFirst: FocusSessionView[],
  now: Date,
  dayStart = startOfLocalDay(now),
  dayEnd = nextLocalDay(dayStart)
) {
  const latest = sessionsOldestFirst[sessionsOldestFirst.length - 1]
  if (!latest || latest.state === 'active') {
    return undefined
  }

  const latestEnd = latest.stopped_at ?? latest.started_at
  const from = new Date(latestEnd)
  const to = new Date(Math.min(now.getTime(), dayEnd.getTime()))

  if (
    now.getTime() < dayStart.getTime() ||
    now.getTime() >= dayEnd.getTime() ||
    to.getTime() <= from.getTime()
  ) {
    return undefined
  }

  const seconds = Math.max(Math.floor((to.getTime() - from.getTime()) / 1000), 0)
  if (seconds < SIGNIFICANT_GAP_SECONDS) {
    return undefined
  }

  return {
    from: latestEnd,
    to: to.toISOString(),
    seconds,
  }
}

function escapeMarkdownTable(value: string) {
  return value.replaceAll('|', '\\|').replace(/\s+/g, ' ').trim()
}

function formatMarkdownListText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function startOfLocalDay(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function nextLocalDay(date: Date) {
  const result = new Date(date)
  result.setDate(result.getDate() + 1)
  return result
}

function sessionCrossesWindow(session: FocusSessionView, from: Date, to: Date, now: Date) {
  const startedAt = new Date(session.started_at).getTime()
  const stoppedAt = session.stopped_at ? new Date(session.stopped_at).getTime() : now.getTime()

  return startedAt < from.getTime() || stoppedAt > to.getTime()
}

function buildTrayStatusTitle(session?: FocusSessionView) {
  if (!session || session.state !== 'active') {
    return undefined
  }

  const minutes = Math.floor(session.active_seconds / 60)
  const overMinutes = Math.floor(session.over_target_seconds / 60)
  if (overMinutes > 0) {
    return `${minutes}m Focus +${overMinutes}m`
  }

  return `${minutes}m Focus`
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
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onStop()
            }
          }}
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
  gapBefore,
}: {
  session: FocusSessionView
  gapBefore?: {
    from: string
    to: string
    seconds: number
  }
}) {
  const range = `${formatClockTime(session.started_at)}-${formatClockTime(session.stopped_at)}`
  const stateClass = session.state === 'active' ? 'text-emerald-300' : 'text-gray-500'
  const title = session.work_item_title ?? session.title
  const detailTitle = session.work_item_title && session.work_item_title !== session.title ? session.title : undefined
  const now = new Date()
  const dayStart = startOfLocalDay(now)
  const dayEnd = nextLocalDay(dayStart)
  const dayClipped = sessionCrossesWindow(session, dayStart, dayEnd, now)

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
      {session.note && (
        <div className="mt-0.5 truncate pl-[3.25rem] text-[11px] text-gray-400">
          note: {session.note}
        </div>
      )}
      {dayClipped && (
        <div className="mt-0.5 truncate pl-[3.25rem] text-[11px] text-amber-300/80">
          day-boundary block: duration is this day's share
        </div>
      )}
      {gapBefore !== undefined && gapBefore.seconds >= SIGNIFICANT_GAP_SECONDS && (
        <div className="mt-0.5 text-right text-[11px] text-gray-600">
          gap before: {formatClockTime(gapBefore.from)}-{formatClockTime(gapBefore.to)} · {formatDuration(gapBefore.seconds)}
        </div>
      )}
    </div>
  )
}

function OpenGapRow({
  gap,
}: {
  gap: {
    from: string
    to: string
    seconds: number
  }
}) {
  return (
    <div className="rounded border border-amber-800/50 bg-amber-950/20 px-2 py-1 text-xs">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <span className="font-mono tabular-nums text-amber-200">{formatDuration(gap.seconds)}</span>
        <span className="min-w-0 truncate text-amber-100">open gap since last stopped block</span>
        <span className="text-amber-300/80">
          {formatClockTime(gap.from)}-{formatClockTime(gap.to)}
        </span>
      </div>
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
    const previousEndAt = nextOlder.stopped_at ?? nextOlder.started_at
    const previousEnd = new Date(previousEndAt).getTime()
    const gapAfterSeconds = Math.max(Math.floor((nextStart - previousEnd) / 1000), 0)

    return {
      session,
      gapBefore: {
        from: previousEndAt,
        to: session.started_at,
        seconds: gapAfterSeconds,
      },
    }
  })
}
