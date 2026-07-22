import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ActivityZone, AppEventKind, AppEventSummary, CaptureView, DayContractRevisionView, DayEventView, FocusSessionView, RefKind, WorkItemEventView, WorkItemView } from '@timeskein/contracts'
import {
  useCurrentFocusSession,
  useStartFocusSession,
  useStopFocusSession,
  useTodayFocusSessions,
} from '../hooks/useFocusSessions'
import { useAddWorkItemEvent, useDeleteWorkItemEvent, useInventory, useSetWorkItemState, useUpdateWorkItemEvent, useWorkItemEvents } from '../hooks/useInventory'
import { useCaptureActivity, useOpenCaptures } from '../hooks/useCaptures'
import { useOperationalWorkspace } from '../hooks/useOperationalWorkspace'
import { useAddDayEvent, useDayEvents, useDeleteDayEvent, useUpdateDayEvent } from '../hooks/useDayEvents'
import { appEventApi, logAppEvent, shellApi } from '../api/client'
import { formatClockTime, formatDuration, truncate } from '../utils/formatTime'
import {
  aggregateActivityZoneTotals,
  summarizeActivityZones,
  type ActivityZoneTotal,
} from '../utils/activityZones'
import {
  ACTIVE_FOCUS_JOURNAL_KIND_LABELS,
  ACTIVE_FOCUS_JOURNAL_NEW_REF,
  ACTIVE_FOCUS_JOURNAL_TARGET_LABELS,
  DEFAULT_ACTIVE_FOCUS_JOURNAL_KIND,
  DEFAULT_ACTIVE_FOCUS_JOURNAL_REF_KIND,
  DEFAULT_ACTIVE_FOCUS_JOURNAL_TARGET,
  activeFocusJournalDraftStorageKey,
  decodeActiveFocusJournalDraft,
  encodeActiveFocusJournalDraft,
  evidenceKindForJournalKind,
  formatActiveFocusJournalText,
  type ActiveFocusJournalDraft,
  type ActiveFocusJournalKind,
  type ActiveFocusJournalTarget,
} from '../utils/activeFocusJournal'
import {
  getBulkAcceptableReviewActions,
  getDayClosureStage,
  isBulkAcceptableReviewAction,
  isDayClosureReadyForFinalReport,
  isFinalDayClosureReport,
  shouldCompactAcceptAsIsReviewItems,
  shouldShowDayReviewDetails,
  shouldSummarizeReadyReviewItems,
  type DayClosureStage,
} from '../utils/dayClosure'
import { formatActivityZoneBadge } from '../utils/workItemLabels'
import { findFocusSessionOverlaps } from '../utils/focusSessionOverlaps'
import CaptureInbox from './CaptureInbox'
import FocusCorrectionDialog from './FocusCorrectionDialog'
import MissedFocusBlockDialog from './MissedFocusBlockDialog'

interface FocusPanelProps {
  selectedItem?: WorkItemView
}

const SIGNIFICANT_GAP_SECONDS = 20 * 60
const ACTIVITY_ZONES: ActivityZone[] = ['work', 'coordination', 'recovery', 'idle', 'personal']
const DAY_EVENT_DRAFT_STORAGE_PREFIX = 'timeskein.day-event-draft.v1.'
export const MANUAL_COPY_HINT =
  'Буфер обмена не принял текст. Поле уже выделено: нажми Command+C и вставь отчёт куда нужно.'
export default function FocusPanel({ selectedItem }: FocusPanelProps) {
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [stopResult, setStopResult] = useState('')
  const [stopStateChange, setStopStateChange] = useState('')
  const [stopNextAction, setStopNextAction] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [copyDayState, setCopyDayState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [copyReportState, setCopyReportState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [manualCopy, setManualCopy] = useState<{ label: string; text: string } | null>(null)
  const [correctingSession, setCorrectingSession] = useState<FocusSessionView | null>(null)
  const [addingMissedBlock, setAddingMissedBlock] = useState(false)
  const [dayEventText, setDayEventText] = useState('')
  const [dayEventZone, setDayEventZone] = useState<ActivityZone | ''>('')
  const [activeJournalText, setActiveJournalText] = useState('')
  const [activeJournalKind, setActiveJournalKind] = useState<ActiveFocusJournalKind>(DEFAULT_ACTIVE_FOCUS_JOURNAL_KIND)
  const [activeJournalTarget, setActiveJournalTarget] = useState<ActiveFocusJournalTarget>(DEFAULT_ACTIVE_FOCUS_JOURNAL_TARGET)
  const [activeJournalRefChoice, setActiveJournalRefChoice] = useState('')
  const [activeJournalNewRefKind, setActiveJournalNewRefKind] = useState<RefKind>(DEFAULT_ACTIVE_FOCUS_JOURNAL_REF_KIND)
  const [activeJournalNewRefValue, setActiveJournalNewRefValue] = useState('')
  const [appEventSummary, setAppEventSummary] = useState<AppEventSummary | null>(null)
  const [dayClosureStartedAt, setDayClosureStartedAt] = useState<Date | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const dayEventInputRef = useRef<HTMLInputElement>(null)
  const activeJournalInputRef = useRef<HTMLInputElement>(null)
  const manualCopyRef = useRef<HTMLTextAreaElement>(null)
  const dayClosureActionIdRef = useRef<string | null>(null)
  const dayClosureStartedAtRef = useRef<Date | null>(null)
  const dayClosureCompletedRef = useRef(false)
  const dayEventDraftLoadedKeyRef = useRef<string | null>(null)
  const activeJournalDraftLoadedKeyRef = useRef<string | null>(null)
  const localDayKey = formatLocalDate(now)
  const dayWindow = useMemo(() => {
    const dayStart = startOfLocalDay(now)
    const dayEnd = nextLocalDay(dayStart)
    return {
      from: dayStart.toISOString(),
      to: dayEnd.toISOString(),
    }
  }, [localDayKey])

  const currentQuery = useCurrentFocusSession()
  const todayQuery = useTodayFocusSessions()
  const inventoryQuery = useInventory()
  const workItemEventsQuery = useWorkItemEvents(dayWindow)
  const dayEventsQuery = useDayEvents(dayWindow)
  const capturesQuery = useOpenCaptures()
  const captureActivityQuery = useCaptureActivity()
  const workspaceQuery = useOperationalWorkspace(localDayKey)
  const startMutation = useStartFocusSession()
  const stopMutation = useStopFocusSession()
  const addDayEventMutation = useAddDayEvent()
  const addWorkItemEventMutation = useAddWorkItemEvent()
  const setWorkItemStateMutation = useSetWorkItemState()

  const current = currentQuery.data?.session
  const currentId = current?.id
  const activeJournalDraftKey = useMemo(
    () => activeFocusJournalDraftStorageKey(current ? current.work_item_id ?? current.id : 'day', now),
    [current?.id, current?.work_item_id, localDayKey]
  )
  const sessions = todayQuery.data?.sessions ?? []
  const inventoryItems = useMemo(() => inventoryQuery.data?.items ?? [], [inventoryQuery.data?.items])
  const currentWorkItem = useMemo(
    () => inventoryItems.find((item) => item.id === current?.work_item_id),
    [inventoryItems, current?.work_item_id]
  )
  const activeWorkItems = useMemo(
    () => inventoryItems.filter((item) => item.state === 'active'),
    [inventoryItems]
  )
  const activeSecondsTotal = todayQuery.data?.active_seconds_total ?? 0
  const activityZoneTotals = useMemo(() => aggregateActivityZoneTotals(sessions), [sessions])
  const activityZoneSummary = useMemo(
    () => summarizeActivityZones(activityZoneTotals, activeSecondsTotal),
    [activityZoneTotals, activeSecondsTotal]
  )
  const workFocusSeconds = activityZoneSummary.executiveWorkSeconds
  const openCaptures = capturesQuery.data?.captures ?? []
  const captureActivity = useMemo(
    () => capturesForLocalDay(captureActivityQuery.data?.captures ?? [], now),
    [captureActivityQuery.data?.captures, localDayKey]
  )
  const workItemEvents = useMemo(
    () => noteEventsOnly(workItemEventsQuery.data?.events ?? []),
    [workItemEventsQuery.data?.events]
  )
  const dayEvents = useMemo(
    () => noteDayEventsOnly(dayEventsQuery.data?.events ?? []),
    [dayEventsQuery.data?.events]
  )
  const sessionsWithGaps = useMemo(() => withGaps([...sessions].reverse()), [sessions])
  const openGap = useMemo(
    () => (current ? undefined : openGapAfterLastSession(sessions, now)),
    [current, sessions, now]
  )
  const reviewItems = useMemo(
    () => buildDayReviewItems({
      sessions,
      activeFocus: current,
      activeWorkItems,
      workItems: inventoryItems,
      openCaptures,
      captureActivity,
      workItemEvents,
      dayEvents,
      openGap,
      appTelemetry: appEventSummary,
    }),
    [sessions, current, activeWorkItems, inventoryItems, openCaptures, captureActivity, workItemEvents, dayEvents, openGap, appEventSummary]
  )
  const reportIsFinal = isFinalDayClosureReport({
    activeFocus: current?.state === 'active',
    activeWorkItemCount: activeWorkItems.length,
  })
  const reportIsDraft = !reportIsFinal
  const pendingReviewItemCount = countPendingReviewItems(reviewItems)
  const reportHasPendingReview = pendingReviewItemCount > 0
  const reportCanBeCopied = Boolean(dayClosureStartedAt) && !reportIsDraft && !reportHasPendingReview
  const dayClosureStage = getDayClosureStage({
    activeFocus: current?.state === 'active',
    activeWorkItemCount: activeWorkItems.length,
    pendingReviewItemCount,
    hasFocusBlocks: sessions.length > 0,
    closureStarted: Boolean(dayClosureStartedAt),
  })
  const dayClosureElapsedSeconds = dayClosureStartedAt
    ? Math.max(0, Math.floor((now.getTime() - dayClosureStartedAt.getTime()) / 1000))
    : undefined

  const rememberDayClosureStartedAt = (startedAt: Date | null) => {
    dayClosureStartedAtRef.current = startedAt
    setDayClosureStartedAt(startedAt)
  }

  const restoreOpenDayClosure = (summary: AppEventSummary | null | undefined) => {
    const restored = getOpenDayClosure(summary)
    if (!restored || dayClosureStartedAtRef.current || dayClosureCompletedRef.current) return

    dayClosureActionIdRef.current = restored.actionId
    rememberDayClosureStartedAt(restored.startedAt)
  }
  const trayStatusTitle = useMemo(
    () => buildTrayStatusTitle(current, now, activeSecondsTotal),
    [current, now, activeSecondsTotal]
  )
  const todayMarkdown = useMemo(
    () => buildTodayMarkdown(
      sessions,
      activeSecondsTotal,
      now,
      inventoryItems,
      workItemEvents,
      dayEvents,
      workspaceQuery.data?.revisions ?? []
    ),
    [sessions, activeSecondsTotal, now, inventoryItems, workItemEvents, dayEvents, workspaceQuery.data?.revisions]
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
    const draft = readDayEventDraft(localDayKey)
    dayEventDraftLoadedKeyRef.current = localDayKey
    setDayEventText(draft.text)
    setDayEventZone(draft.zone)
  }, [localDayKey])

  useEffect(() => {
    if (dayEventDraftLoadedKeyRef.current !== localDayKey) return

    writeDayEventDraft(localDayKey, {
      text: dayEventText,
      zone: dayEventZone,
    })
  }, [dayEventText, dayEventZone, localDayKey])

  useEffect(() => {
    if (!activeJournalDraftKey || !current) {
      activeJournalDraftLoadedKeyRef.current = null
      setActiveJournalText('')
      setActiveJournalKind(DEFAULT_ACTIVE_FOCUS_JOURNAL_KIND)
      setActiveJournalTarget(DEFAULT_ACTIVE_FOCUS_JOURNAL_TARGET)
      setActiveJournalRefChoice('')
      setActiveJournalNewRefKind(DEFAULT_ACTIVE_FOCUS_JOURNAL_REF_KIND)
      setActiveJournalNewRefValue('')
      return
    }

    const draft = readActiveFocusJournalDraft(activeJournalDraftKey)
    activeJournalDraftLoadedKeyRef.current = activeJournalDraftKey
    setActiveJournalText(draft.text)
    setActiveJournalKind(draft.kind)
    setActiveJournalTarget(current.work_item_id ? draft.target : 'day')
    setActiveJournalRefChoice(draft.refChoice)
    setActiveJournalNewRefKind(draft.newRefKind)
    setActiveJournalNewRefValue(draft.newRefValue)
  }, [activeJournalDraftKey, current?.work_item_id])

  useEffect(() => {
    if (!activeJournalDraftKey || activeJournalDraftLoadedKeyRef.current !== activeJournalDraftKey) return

    writeActiveFocusJournalDraft(activeJournalDraftKey, {
      text: activeJournalText,
      kind: activeJournalKind,
      target: current?.work_item_id ? activeJournalTarget : 'day',
      refChoice: activeJournalRefChoice,
      newRefKind: activeJournalNewRefKind,
      newRefValue: activeJournalNewRefValue,
    })
  }, [activeJournalDraftKey, activeJournalText, activeJournalKind, activeJournalTarget, activeJournalRefChoice, activeJournalNewRefKind, activeJournalNewRefValue, current?.work_item_id])

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

  useEffect(() => {
    let cancelled = false

    const refreshSummary = () => {
      appEventApi.summary(dayWindow)
        .then((summary) => {
          if (!cancelled) {
            setAppEventSummary(summary)
            restoreOpenDayClosure(summary)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAppEventSummary(null)
          }
        })
    }

    refreshSummary()
    const timer = window.setInterval(refreshSummary, 15000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [dayWindow])

  const startSessionByTitle = (
    rawTitle: string,
    control: string,
    onSuccess?: () => void,
    activityZone?: ActivityZone
  ) => {
    const trimmed = rawTitle.trim()
    if (!trimmed || startMutation.isPending) return

    const actionId = createTelemetryActionId()
    const wasSwitch = Boolean(current)
    void logAppEvent({
      source: 'ui',
      kind: wasSwitch ? 'focus_switch_requested' : 'focus_start_requested',
      payload: {
        action_id: actionId,
        control,
      },
    })

    startMutation.mutate(
      { title: trimmed, activity_zone: activityZone, target_seconds: 25 * 60, telemetry_action_id: actionId },
      {
        onSuccess: (session) => {
          setTitle('')
          setNote('')
          onSuccess?.()
          void logAppEvent({
            source: 'ui',
            kind: wasSwitch ? 'focus_switched' : 'focus_started',
            work_item_id: session.work_item_id,
            focus_session_id: session.id,
            payload: {
              action_id: actionId,
              control,
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
              control,
              error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
            },
          })
        },
      }
    )
  }

  const startTypedSession = () => {
    startSessionByTitle(title, 'typed')
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
      {
        note,
        telemetry_action_id: actionId,
        result: stopResult.trim() || undefined,
        state_change: stopStateChange.trim() || undefined,
        next_action: stopNextAction.trim() || undefined,
      },
      {
        onSuccess: (session) => {
          setNote('')
          const semanticKinds = [
            ['result', stopResult],
            ['state_change', stopStateChange],
            ['next_action', stopNextAction],
          ] as const
          setStopResult('')
          setStopStateChange('')
          setStopNextAction('')
          for (const [memoryKind, value] of semanticKinds) {
            if (!value.trim()) continue
            void logAppEvent({
              source: 'ui',
              kind: 'working_memory_created',
              work_item_id: session.work_item_id,
              focus_session_id: session.id,
              payload: { memory_kind: memoryKind, origin: 'focus_stop' },
            })
          }
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
    const dayMarkdownForCopy = formatFocusMarkdownForReport(todayMarkdown)

    void logAppEvent({
      source: 'ui',
      kind: 'report_copy_requested',
      payload: {
        report_kind: 'day',
      },
    })

    try {
      await copyText(dayMarkdownForCopy)
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
      setManualCopy({ label: 'Дневной Markdown', text: dayMarkdownForCopy })
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

    const reportState = {
      activeFocus: current?.state === 'active',
      activeWorkItemCount: activeWorkItems.length,
    }
    const closureActionId = await ensureDayClosureStarted('copy_report')

    void logAppEvent({
      source: 'ui',
      kind: 'report_copy_requested',
      payload: {
        report_kind: 'dogfood',
      },
    })
    const freshAppEventSummary = await loadAppEventSummary(now)
    const reportReviewItems = buildDayReviewItems({
      sessions,
      activeFocus: current,
      activeWorkItems,
      workItems: inventoryItems,
      openCaptures,
      captureActivity,
      workItemEvents,
      dayEvents,
      openGap,
      appTelemetry: freshAppEventSummary,
    })
    if (
      isDayClosureReadyForFinalReport({
        ...reportState,
        pendingReviewItemCount: countPendingReviewItems(reportReviewItems),
      })
    ) {
      await ensureDayClosureCompleted(closureActionId, 'copy_report')
    }
    const reportMarkdown = await buildDogfoodReportMarkdown(
      todayMarkdown,
      current,
      activeWorkItems,
      openCaptures,
      captureActivity,
      reportReviewItems,
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
      setManualCopy({ label: 'Отчёт Timeskein', text: reportMarkdown })
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

  const ensureDayClosureStarted = async (control: string) => {
    if (dayClosureActionIdRef.current) {
      return dayClosureActionIdRef.current
    }

    const existingSummary = appEventSummary ?? await loadAppEventSummary(now).catch(() => null)
    const restored = getOpenDayClosure(existingSummary)
    if (restored) {
      dayClosureActionIdRef.current = restored.actionId
      rememberDayClosureStartedAt(restored.startedAt)
      if (existingSummary && existingSummary !== appEventSummary) {
        setAppEventSummary(existingSummary)
      }
      return restored.actionId
    }

    const actionId = createTelemetryActionId()
    dayClosureActionIdRef.current = actionId
    const startedAt = new Date()
    rememberDayClosureStartedAt(startedAt)

    await logAppEvent({
      source: 'ui',
      kind: 'day_closure_started',
      payload: {
        action_id: actionId,
        control,
        local_day: localDayKey,
      },
    })

    const summary = await loadAppEventSummary(now)
    setAppEventSummary(summary)

    return actionId
  }

  const ensureDayClosureCompleted = async (actionId: string, control: string) => {
    if (dayClosureCompletedRef.current) return

    dayClosureCompletedRef.current = true
    await logAppEvent({
      source: 'ui',
      kind: 'day_closure_completed',
      payload: {
        action_id: actionId,
        control,
        local_day: localDayKey,
      },
    })
  }

  const addDayEvent = () => {
    const trimmed = dayEventText.trim()
    if (!trimmed || addDayEventMutation.isPending) return

    addDayEventMutation.mutate(
      {
        text: trimmed,
        focus_session_id: current?.id,
        activity_zone: dayEventZone || current?.activity_zone || selectedItem?.activity_zone,
      },
      {
        onSuccess: () => {
          clearDayEventDraft(localDayKey)
          setDayEventText('')
          setDayEventZone('')
        },
      }
    )
  }

  const addActiveJournalEvent = () => {
    const rawText = activeJournalText.trim()
    if (!rawText || addWorkItemEventMutation.isPending || addDayEventMutation.isPending) return

    const target = current?.work_item_id && activeJournalTarget === 'work_item' ? 'work_item' : 'day'
    const clearDraft = () => {
      if (activeJournalDraftKey) clearActiveFocusJournalDraft(activeJournalDraftKey)
      setActiveJournalText('')
      setActiveJournalRefChoice('')
      setActiveJournalNewRefKind(DEFAULT_ACTIVE_FOCUS_JOURNAL_REF_KIND)
      setActiveJournalNewRefValue('')
      window.requestAnimationFrame(() => activeJournalInputRef.current?.focus())
    }

    if (target === 'work_item' && current?.work_item_id) {
      const selectedRefIds = activeJournalRefChoice && activeJournalRefChoice !== ACTIVE_FOCUS_JOURNAL_NEW_REF
        ? [activeJournalRefChoice]
        : []
      const newRef = activeJournalRefChoice === ACTIVE_FOCUS_JOURNAL_NEW_REF && activeJournalNewRefValue.trim()
        ? { kind: activeJournalNewRefKind, value: activeJournalNewRefValue.trim() }
        : undefined
      const evidenceKind = evidenceKindForJournalKind(activeJournalKind)
      const evidenceText = activeJournalKind === evidenceKind
        ? rawText
        : formatActiveFocusJournalText(activeJournalKind, rawText)
      addWorkItemEventMutation.mutate(
        {
          id: current.work_item_id,
          text: evidenceText,
          focus_session_id: current.id,
          evidence_kind: evidenceKind,
          ref_ids: selectedRefIds,
          new_ref: newRef,
        },
        { onSuccess: clearDraft }
      )
      return
    }

    addDayEventMutation.mutate(
      {
        text: formatActiveFocusJournalText(activeJournalKind, rawText),
        focus_session_id: current?.id,
        activity_zone: current?.activity_zone || selectedItem?.activity_zone,
      },
      { onSuccess: clearDraft }
    )
  }

  const stageDayEvent = (text: string, activityZone: ActivityZone | '' = '') => {
    setDayEventText(text)
    setDayEventZone(activityZone)
    window.requestAnimationFrame(() => {
      const input = dayEventInputRef.current
      input?.focus()
      input?.setSelectionRange(input.value.length, input.value.length)
    })
  }

  const stageGapDayEvent = (gap: Gap, label = 'Разрыв', preset?: GapExplanationPreset) => {
    stageDayEvent(formatGapDayEventDraft(gap, label, preset), preset === 'lost_control' ? 'idle' : 'recovery')
  }

  const markActivityZonesGlanced = () => {
    void (async () => {
      await logAppEvent({
        source: 'ui',
        kind: 'activity_zone_glanced',
        payload: {
          control: 'zone_dashboard',
          zone_count: activityZoneTotals.length,
          total_tracked_seconds: activityZoneSummary.totalTrackedSeconds,
        },
      })

      try {
        const summary = await loadAppEventSummary(now)
        if (summary) {
          setAppEventSummary(summary)
        }
      } catch (error) {
        console.warn('Unable to refresh Timeskein app event summary', error)
      }
    })()
  }

  const handleReviewAction = async (action: DayReviewAction) => {
    if (action === 'stop_active_focus') {
      stopCurrentSession()
      return
    }

    if (action === 'clear_active_work_items') {
      await Promise.all(
        activeWorkItems.map((item) => setWorkItemStateMutation.mutateAsync({ id: item.id, state: 'unknown' }))
      )
      return
    }

    if (isSignificantGapStageAction(action)) {
      const gap = pickNextGapForReview(
        gapsBetweenSessions(sessions).filter((item) => item.seconds >= SIGNIFICANT_GAP_SECONDS),
        dayEvents
      )
      if (gap) {
        stageGapDayEvent(gap, 'Разрыв', presetFromReviewAction(action))
      }
      return
    }

    if (isOpenGapStageAction(action)) {
      if (openGap) {
        stageGapDayEvent(openGap, 'Открытый разрыв', presetFromReviewAction(action))
      }
      return
    }

    if (action === 'stage_day_context') {
      stageDayEvent('Контекст дня: ')
      return
    }

    if (action === 'stage_focus_correction') {
      setAddingMissedBlock(true)
      return
    }

    const actionId = createTelemetryActionId()
    const kind = reviewActionEventKind(action)
    const touchedWorkItemIds = new Set(sessions.map((session) => session.work_item_id).filter(Boolean))
    const touchedWorkItemCount = touchedWorkItemIds.size
    const touchedWorkItemNoteCount = inventoryItems.filter((item) => touchedWorkItemIds.has(item.id) && item.note?.trim()).length

    await logAppEvent({
      source: 'ui',
      kind,
      payload: {
        action_id: actionId,
        control: 'review_checklist',
        ...(action === 'accept_open_captures' ? { open_count: openCaptures.length } : {}),
        ...(action === 'accept_day_context'
          ? {
              day_event_count: dayEvents.length,
              work_item_event_count: workItemEvents.length,
              work_item_note_count: touchedWorkItemNoteCount,
            }
          : {}),
        ...(action === 'accept_work_item_time_badges' ? { touched_work_item_count: touchedWorkItemCount } : {}),
        ...(action === 'accept_activity_zones' ? { zone_count: activityZoneTotals.length } : {}),
        ...(action === 'accept_capture_usage' ? { capture_count: captureActivity.length } : {}),
      },
    })

    const summary = await loadAppEventSummary(now)
    setAppEventSummary(summary)
  }

  const mutationError = startMutation.error || stopMutation.error || addDayEventMutation.error || addWorkItemEventMutation.error

  return (
    <section className="border-b border-gray-700 bg-gray-950/45">
      <div className="grid gap-3 px-4 py-3">
        {current && (
          <ActiveFocusSession
            session={current}
            note={note}
            setNote={setNote}
            result={stopResult}
            setResult={setStopResult}
            stateChange={stopStateChange}
            setStateChange={setStopStateChange}
            nextAction={stopNextAction}
            setNextAction={setStopNextAction}
            onStop={stopCurrentSession}
            stopping={stopMutation.isPending}
          />
        )}

        <ActiveFocusJournal
          inputRef={activeJournalInputRef}
          text={activeJournalText}
          kind={activeJournalKind}
          target={current?.work_item_id ? activeJournalTarget : 'day'}
          hasWorkItem={Boolean(current?.work_item_id)}
          refs={currentWorkItem?.refs ?? []}
          refChoice={activeJournalRefChoice}
          newRefKind={activeJournalNewRefKind}
          newRefValue={activeJournalNewRefValue}
          pending={addWorkItemEventMutation.isPending || addDayEventMutation.isPending}
          placeholder={current ? 'Мысль, решение, вопрос или следующий шаг...' : 'Свободная мысль дня, решение, вопрос или следующий шаг...'}
          onTextChange={setActiveJournalText}
          onKindChange={setActiveJournalKind}
          onTargetChange={setActiveJournalTarget}
          onRefChoiceChange={setActiveJournalRefChoice}
          onNewRefKindChange={setActiveJournalNewRefKind}
          onNewRefValueChange={setActiveJournalNewRefValue}
          onSubmit={addActiveJournalEvent}
        />

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
              placeholder={current ? 'Переключиться на...' : 'На чём сейчас фокус?'}
              className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={startTypedSession}
              disabled={!title.trim() || startMutation.isPending}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
            >
              {current ? 'Переключить' : 'Старт'}
            </button>
          </div>
          {selectedItem && selectedItem.id !== current?.work_item_id && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Выбранное дело</div>
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
                {current ? 'Переключиться' : 'Начать'}
              </button>
            </div>
          )}
        </div>

        <CaptureInbox focusSessionId={current?.id} targetWorkItemId={current?.work_item_id ?? selectedItem?.id} />

        <div className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-900/40 px-3 py-2">
          <input
            ref={dayEventInputRef}
            value={dayEventText}
            onChange={(event) => setDayEventText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addDayEvent()
              }
            }}
            placeholder="Добавить событие дня..."
            className="min-w-0 flex-1 rounded border border-gray-800 bg-gray-950 px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
          />
          <select
            value={dayEventZone}
            onChange={(event) => setDayEventZone(event.target.value as ActivityZone | '')}
            className="w-32 rounded border border-gray-800 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            title="Зона события дня"
          >
            <option value="">Контекст</option>
            {ACTIVITY_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {formatActivityZoneLabel(zone)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addDayEvent}
            disabled={!dayEventText.trim() || addDayEventMutation.isPending}
            className="rounded border border-emerald-800 px-2 py-1.5 text-xs font-medium text-emerald-200 hover:border-emerald-500 hover:text-emerald-100 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
          >
            Добавить
          </button>
        </div>

        <DayReviewPanel
          items={reviewItems}
          closureStartedAt={dayClosureStartedAt}
          closureElapsedSeconds={dayClosureElapsedSeconds}
          closureStage={dayClosureStage}
          canStartClosure={sessions.length > 0}
          onAction={handleReviewAction}
          onStartClosure={() => {
            void ensureDayClosureStarted('review_panel')
          }}
        />

        {sessions.length > 0 && (
          <ActivityZoneDashboard
            summary={activityZoneSummary}
            zoneTotals={activityZoneTotals}
            glanceCount={appEventSummary?.activity_zone_glances ?? 0}
            onMarkGlanced={markActivityZonesGlanced}
          />
        )}

        {dayEvents.length > 0 && (
          <DayEventsPanel events={dayEvents} sessions={sessions} />
        )}

        {workItemEvents.length > 0 && (
          <WorkItemEventsPanel
            events={workItemEvents}
            workItems={inventoryItems}
            sessions={sessions}
          />
        )}

        {mutationError && (
          <div className="mt-2 text-xs text-red-300">
            {mutationError instanceof Error ? mutationError.message : 'Не удалось выполнить действие фокуса'}
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 px-4 py-2">
        <div className="mb-2 flex items-center justify-between text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-medium text-gray-300">Сегодня</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setAddingMissedBlock(true)}
                className="rounded border border-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100"
              >
                Добавить пропущенный блок
              </button>
              <button
                type="button"
                onClick={copyTodayMarkdown}
                disabled={sessions.length === 0}
                className="rounded border border-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-gray-100 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
              >
                {copyDayState === 'copied' ? 'Скопировано' : copyDayState === 'failed' ? 'Ошибка' : 'Копировать день'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!dayClosureStartedAt) {
                    void ensureDayClosureStarted('report_button')
                    return
                  }
                  if (reportCanBeCopied) {
                    void copyDogfoodReport()
                  }
                }}
                disabled={sessions.length === 0 || (Boolean(dayClosureStartedAt) && !reportCanBeCopied)}
                title={dayClosureStartedAt && !reportCanBeCopied ? 'Сначала выполни ближайшее действие в проверке перед отчётом' : undefined}
                className="rounded border border-emerald-800 px-2 py-0.5 text-[11px] font-medium text-emerald-200 transition-colors hover:border-emerald-500 hover:text-emerald-100 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
              >
                {formatReportButtonLabel({
                  copyState: copyReportState,
                  closureStarted: Boolean(dayClosureStartedAt),
                  reportIsDraft,
                  reportHasPendingReview,
                })}
              </button>
            </div>
          </div>
          <span className="shrink-0 text-gray-400">
            {formatDuration(activityZoneSummary.workingOccupancySeconds)} рабочей занятости · {formatDuration(workFocusSeconds)} исполнения · {sessions.length} входов
          </span>
        </div>

        {todayQuery.isLoading ? (
          <div className="text-xs text-gray-500">Загружаю фокус-блоки...</div>
        ) : manualCopy ? (
          <div className="mb-2 grid gap-1 rounded border border-amber-700/50 bg-amber-950/20 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-amber-200">{manualCopy.label}</span>
              <button
                type="button"
                onClick={() => setManualCopy(null)}
                className="rounded border border-amber-800 px-1.5 py-0.5 text-[11px] text-amber-200 hover:border-amber-500"
              >
                Закрыть
              </button>
            </div>
            <div className="text-[11px] text-amber-100/80">{MANUAL_COPY_HINT}</div>
            <textarea
              ref={manualCopyRef}
              readOnly
              value={manualCopy.text}
              onFocus={(event) => event.currentTarget.select()}
              className="h-28 resize-y rounded border border-amber-800 bg-gray-950 p-2 font-mono text-[11px] leading-relaxed text-gray-100"
            />
          </div>
        ) : sessionsWithGaps.length === 0 ? (
          <div className="text-xs text-gray-500">Сегодня ещё нет фокус-блоков</div>
        ) : (
          <div className="grid gap-1.5 pr-1">
            {openGap && (
              <OpenGapRow
                gap={openGap}
                explanation={findOpenGapExplanation(dayEvents)}
                onExplain={(preset) => stageGapDayEvent(openGap, 'Открытый разрыв', preset)}
              />
            )}
            {sessionsWithGaps.map(({ session, gapBefore }) => (
              <FocusSessionRow
                key={session.id}
                session={session}
                gapBefore={gapBefore}
                gapExplanation={gapBefore ? findGapExplanation(gapBefore, dayEvents) : undefined}
                onCorrect={() => setCorrectingSession(session)}
                onExplainGap={gapBefore ? (preset) => stageGapDayEvent(gapBefore, 'Разрыв', preset) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {correctingSession && (
        <FocusCorrectionDialog
          session={correctingSession}
          onClose={() => setCorrectingSession(null)}
        />
      )}

      {addingMissedBlock && (
        <MissedFocusBlockDialog
          initialTitle={selectedItem?.title}
          initialActivityZone={selectedItem?.activity_zone}
          onClose={() => setAddingMissedBlock(false)}
        />
      )}
    </section>
  )
}

function reviewActionEventKind(action: DayReviewAction): AppEventKind {
  switch (action) {
    case 'accept_open_captures':
      return 'capture_followup_reviewed'
    case 'accept_day_context':
      return 'day_context_reviewed'
    case 'accept_work_item_time_badges':
      return 'work_item_time_badges_reviewed'
    case 'accept_tracking_accuracy':
      return 'focus_correction_reviewed'
    case 'accept_activity_zones':
      return 'activity_zone_reviewed'
    case 'accept_capture_usage':
      return 'capture_usage_reviewed'
    case 'accept_entry_paths':
      return 'entry_paths_reviewed'
    case 'accept_window_entrypoints':
      return 'window_entrypoints_reviewed'
    case 'stage_significant_gap':
    case 'stage_open_gap':
    case 'stage_significant_gap_lost_control':
    case 'stage_open_gap_lost_control':
    case 'stage_significant_gap_recovery':
    case 'stage_open_gap_recovery':
    case 'stage_day_context':
    case 'stage_focus_correction':
    case 'stop_active_focus':
    case 'clear_active_work_items':
      throw new Error(`Review action does not map to telemetry: ${action}`)
  }
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

export interface DayEventDraft {
  text: string
  zone: ActivityZone | ''
}

export function encodeDayEventDraft(draft: DayEventDraft) {
  if (!draft.text && !draft.zone) return ''

  return JSON.stringify({
    text: draft.text,
    zone: ACTIVITY_ZONES.includes(draft.zone as ActivityZone) ? draft.zone : '',
  })
}

export function decodeDayEventDraft(raw: string | null | undefined): DayEventDraft {
  if (!raw) return { text: '', zone: '' }

  try {
    const parsed = JSON.parse(raw) as Partial<DayEventDraft>
    const zone = ACTIVITY_ZONES.includes(parsed.zone as ActivityZone) ? parsed.zone as ActivityZone : ''

    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      zone,
    }
  } catch {
    return { text: '', zone: '' }
  }
}

function dayEventDraftStorageKey(localDayKey: string) {
  return `${DAY_EVENT_DRAFT_STORAGE_PREFIX}${localDayKey}`
}

function readDayEventDraft(localDayKey: string): DayEventDraft {
  const storage = getLocalStorage()
  if (!storage) return { text: '', zone: '' }

  return decodeDayEventDraft(storage.getItem(dayEventDraftStorageKey(localDayKey)))
}

function writeDayEventDraft(localDayKey: string, draft: DayEventDraft) {
  const storage = getLocalStorage()
  if (!storage) return

  const encoded = encodeDayEventDraft(draft)
  const key = dayEventDraftStorageKey(localDayKey)
  if (!encoded) {
    storage.removeItem(key)
    return
  }

  storage.setItem(key, encoded)
}

function clearDayEventDraft(localDayKey: string) {
  getLocalStorage()?.removeItem(dayEventDraftStorageKey(localDayKey))
}

function readActiveFocusJournalDraft(key: string) {
  const storage = getLocalStorage()
  if (!storage) {
    return {
      text: '',
      kind: DEFAULT_ACTIVE_FOCUS_JOURNAL_KIND,
      target: DEFAULT_ACTIVE_FOCUS_JOURNAL_TARGET,
      refChoice: '',
      newRefKind: DEFAULT_ACTIVE_FOCUS_JOURNAL_REF_KIND,
      newRefValue: '',
    }
  }

  return decodeActiveFocusJournalDraft(storage.getItem(key))
}

function writeActiveFocusJournalDraft(key: string, draft: ActiveFocusJournalDraft) {
  const storage = getLocalStorage()
  if (!storage) return

  const encoded = encodeActiveFocusJournalDraft(draft)
  if (!encoded) {
    storage.removeItem(key)
    return
  }

  storage.setItem(key, encoded)
}

function clearActiveFocusJournalDraft(key: string) {
  getLocalStorage()?.removeItem(key)
}

function getLocalStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function buildTodayMarkdown(
  sessionsOldestFirst: FocusSessionView[],
  activeSecondsTotal: number,
  now: Date,
  workItems: WorkItemView[] = [],
  workItemEvents: WorkItemEventView[] = [],
  dayEvents: DayEventView[] = [],
  dayContractRevisions: DayContractRevisionView[] = []
) {
  const dayStart = startOfLocalDay(now)
  const dayEnd = nextLocalDay(dayStart)
  const workItemNotes = new Map(
    workItems
      .filter((item) => item.note?.trim())
      .map((item) => [item.id, item.note?.trim() ?? ''])
  )
  const dateTitle = now.toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const zoneTotals = aggregateActivityZoneTotals(sessionsOldestFirst)
  const zoneSummary = summarizeActivityZones(zoneTotals, activeSecondsTotal)

  const lines = [
    `# Timeskein focus day - ${dateTitle}`,
    '',
    `Total tracked: ${formatDuration(activeSecondsTotal)}`,
    `Working occupancy: ${formatDuration(zoneSummary.workingOccupancySeconds)}`,
    `Executive work: ${formatDuration(zoneSummary.executiveWorkSeconds)}`,
    `Non-work tracked: ${formatDuration(zoneSummary.nonWorkTrackedSeconds)}`,
    `Entrances: ${sessionsOldestFirst.length}`,
    '',
    '| Time | Duration | Zone | Work Item | Note |',
    '| --- | ---: | --- | --- | --- |',
  ]

  for (const session of sessionsOldestFirst) {
    const title = session.work_item_title ?? session.title
    const range = `${formatClockTime(session.started_at)}-${formatClockTime(session.stopped_at)}`
    lines.push(
      `| ${escapeMarkdownTable(range)} | ${escapeMarkdownTable(formatDuration(session.active_seconds))} | ${escapeMarkdownTable(formatActivityZoneLabel(session.activity_zone))} | ${escapeMarkdownTable(title)} | ${escapeMarkdownTable(session.note ?? '')} |`
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

  if (zoneTotals.length > 0) {
    lines.push('', '## By Activity Zone', '', '| Duration | Entrances | Zone |', '| ---: | ---: | --- |')
    for (const zone of zoneTotals) {
      lines.push(
        `| ${escapeMarkdownTable(formatDuration(zone.activeSeconds))} | ${zone.entrances} | ${escapeMarkdownTable(formatActivityZoneLabel(zone.zone))} |`
      )
    }
  }

  appendWorkItemNotes(lines, workItemTotals)
  appendDayEvents(lines, dayEvents, sessionsOldestFirst)
  appendWorkItemEvents(lines, workItemEvents, sessionsOldestFirst, workItems)
  appendDayContract(lines, dayContractRevisions)

  const gaps = gapsBetweenSessions(sessionsOldestFirst).filter(
    (gap) => gap.seconds >= SIGNIFICANT_GAP_SECONDS
  )
  if (gaps.length > 0) {
    lines.push('', `## Gaps >= ${formatDuration(SIGNIFICANT_GAP_SECONDS)}`)
    for (const gap of gaps) {
      const explanation = findGapExplanation(gap, dayEvents)
      const suffix = explanation ? ` — ${formatGapClassificationLabel(explanation.classification)}` : ''
      lines.push(
        `- ${formatClockTime(gap.from)}-${formatClockTime(gap.to)}: ${formatDuration(gap.seconds)}${suffix}`
      )
    }
  }

  const openGap = openGapAfterLastSession(sessionsOldestFirst, now, dayStart, dayEnd)
  if (openGap && openGap.seconds >= SIGNIFICANT_GAP_SECONDS) {
    const explanation = findOpenGapExplanation(dayEvents)
    const suffix = explanation ? ` — ${formatGapClassificationLabel(explanation.classification)}` : ''
    lines.push('', '## Open Gap')
    lines.push(
      `- ${formatClockTime(openGap.from)}-${formatClockTime(openGap.to)}: ${formatDuration(openGap.seconds)} since last stopped block${suffix}`
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
  reviewItems: DayReviewItem[] = [],
  sessions: FocusSessionView[] = [],
  workItems: WorkItemView[] = [],
  now = new Date()
) {
  const pendingReviewItemCount = countPendingReviewItems(reviewItems)
  const hasActiveWorkItems = activeWorkItems.length > 0
  const reportState = formatDogfoodReportState({
    activeFocus: Boolean(activeFocus),
    activeWorkItemCount: activeWorkItems.length,
    pendingReviewItemCount,
  })

  const lines = [
    `# Отчёт закрытия дня Timeskein - ${formatLocalDate(now)}`,
    '',
    `Статус отчёта: ${reportState}`,
    '',
  ]

  if (activeFocus) {
    lines.push(
      '## Что мешает финальному отчёту',
      '',
      `- Активное дело: ${activeFocus.work_item_title ?? activeFocus.title}`,
      `- Старт: ${formatClockTime(activeFocus.started_at)}`,
      `- Текущая длительность: ${formatDuration(activeFocus.active_seconds)}`,
      '- Останови активный блок перед финальным отчётом.',
      ''
    )
  }

  if (!activeFocus && hasActiveWorkItems) {
    lines.push(
      '## Что мешает финальному отчёту',
      '',
      ...activeWorkItems.map((item) => `- Дело с активным статусом: ${item.title}`),
      '- Сними активный статус с дела перед финальным отчётом.',
      ''
    )
  }

  const appTelemetryMarkdown = await buildAppTelemetryMarkdown(now)
  const reportFocusMarkdown = formatFocusMarkdownForReport(todayMarkdown)
  const reportTelemetryMarkdown = formatTelemetryForReport(appTelemetryMarkdown)

  lines.push(
    formatShortClosureMarkdown(appTelemetryMarkdown, {
      reportReady: isDayClosureReadyForFinalReport({
        activeFocus: Boolean(activeFocus),
        activeWorkItemCount: activeWorkItems.length,
        pendingReviewItemCount,
      }),
    }).trim(),
    ''
  )

  lines.push(
    formatReviewChecklistMarkdown(reviewItems).trim(),
    '',
    formatDailyControlGoalAuditMarkdown({
      activeFocus,
      activeWorkItems,
      openCaptures,
      captureActivity,
      todayMarkdown,
      appTelemetryMarkdown,
      reviewItems,
    }).trim(),
    '',
  )

  if (openCaptures.length > 0) {
    lines.push(
      '## Открытые отвлечения',
      '',
      ...openCaptures.map((capture) => `- ${formatClockTime(capture.created_at)} ${formatMarkdownListText(capture.text)}`),
      '- Разбери их: закрыть, превратить в дело, добавить событием или явно оставить открытыми.',
      ''
    )
  }

  if (captureActivity.length > 0) {
    lines.push(
      formatCaptureActivityMarkdown(captureActivity, sessions, workItems).trim(),
      ''
    )
  }

  lines.push(
    '## Данные фокуса',
    '',
    reportFocusMarkdown.trim(),
    '',
    reportTelemetryMarkdown.trim(),
    '',
    formatAdditionalReviewMarkdown().trim(),
  )

  return `${lines.join('\n')}\n`
}

export function formatAdditionalReviewMarkdown() {
  return [
    '## Дополнительный разбор',
    '',
    'Не нужен для закрытия дня. Оставь пустым, если короткого закрытия достаточно.',
    '',
    '- Что разобрать позже:',
    '- Наблюдение про вход, возврат или восстановление:',
    '- Трение Timeskein:',
  ].join('\n')
}

export function formatFocusMarkdownForReport(markdown: string) {
  return localizeActivityZoneCells(markdown)
    .replace(/^# Timeskein focus day - (.+)$/m, '# Фокус-день Timeskein — $1')
    .replace(/^Total tracked:/gm, 'Всего учтено:')
    .replace(/^Working occupancy:/gm, 'Рабочая занятость:')
    .replace(/^Executive work:/gm, 'Исполнительная работа:')
    .replace(/^Work focus:/gm, 'Исполнительная работа:')
    .replace(/^Non-work tracked:/gm, 'Нерабочее учтено:')
    .replace(/^Entrances:/gm, 'Входов:')
    .replace(/^\| Time \| Duration \| Zone \| Work Item \| Note \|$/gm, '| Время | Длительность | Зона | Дело | Заметка |')
    .replace(/^## Day-Boundary Blocks$/gm, '## Блоки на границе дня')
    .replace(/: counted as ([^\n]+) inside this day/g, ': учтено как $1 внутри этого дня')
    .replace(/^## By Work Item$/gm, '## По делам')
    .replace(/^\| Duration \| Entrances \| Work Item \|$/gm, '| Длительность | Входов | Дело |')
    .replace(/^## By Activity Zone$/gm, '## По зонам активности')
    .replace(/^\| Duration \| Entrances \| Zone \|$/gm, '| Длительность | Входов | Зона |')
    .replace(/^## Work Item Notes$/gm, '## Заметки дел')
    .replace(/^## Day Events$/gm, '## События дня')
    .replace(/^\| Time \| Zone \| During \| Event \|$/gm, '| Время | Зона | Во время | Событие |')
    .replace(/\| day \|/g, '| день |')
    .replace(/\| linked focus block \|/g, '| связанный фокус-блок |')
    .replace(/^## Work Item Events$/gm, '## События дел')
    .replace(/^\| Time \| Work Item \| During \| Event \|$/gm, '| Время | Дело | Во время | Событие |')
    .replace(/^## Day Contract$/gm, '## Договор дня')
    .replace(/^No day contract was recorded\.$/gm, 'Договор дня не сформирован.')
    .replace(/^\| Revision \| Time \| Kind \| Active \| First Action \| Parked \| Why Now \|$/gm, '| Версия | Время | Тип | В игре | Первое действие | Припарковано | Почему сейчас |')
    .replace(/\| morning \|/g, '| утро |')
    .replace(/\| reentry \|/g, '| возвращение |')
    .replace(/\| adjustment \|/g, '| корректировка |')
    .replace(/^## Gaps >=/gm, '## Разрывы >=')
    .replace(/^## Open Gap$/gm, '## Текущий открытый разрыв')
    .replace(/ since last stopped block$/gm, ' после последнего остановленного блока')
}

function localizeActivityZoneCells(markdown: string) {
  const englishZoneLabels: Record<string, string> = {
    Work: formatActivityZoneBadge('work'),
    Coordination: formatActivityZoneBadge('coordination'),
    Recovery: formatActivityZoneBadge('recovery'),
    Idle: formatActivityZoneBadge('idle'),
    Personal: formatActivityZoneBadge('personal'),
  }
  let zoneColumnIndex: number | null = null

  return markdown
    .split('\n')
    .map((line) => {
      if (!line.startsWith('|')) {
        zoneColumnIndex = null
        return line
      }

      const rawCells = line.split('|')
      const cells = rawCells.slice(1, -1).map((cell) => cell.trim())
      const headerZoneIndex = cells.findIndex((cell) => cell === 'Zone')
      if (headerZoneIndex !== -1) {
        zoneColumnIndex = headerZoneIndex
        return line
      }

      if (zoneColumnIndex == null) {
        return line
      }

      const rawCellIndex = zoneColumnIndex + 1
      const current = rawCells[rawCellIndex]?.trim()
      const label = current ? englishZoneLabels[current] : undefined
      if (!label) {
        return line
      }

      rawCells[rawCellIndex] = ` ${label} `
      return rawCells.join('|')
    })
    .join('\n')
}

const APP_EVENT_KIND_LABELS: Record<string, string> = {
  app_started: 'приложение запущено',
  agent_started: 'агент запущен',
  agent_reused: 'агент переиспользован',
  agent_stale_runtime_recovered: 'устаревшее состояние агента восстановлено',
  api_error: 'ошибка API',
  window_shown: 'окно показано',
  window_hidden: 'окно скрыто',
  window_drag_started: 'перетаскивание окна начато',
  window_show_requested: 'запрошен показ окна',
  window_hide_requested: 'запрошено скрытие окна',
  window_entrypoints_reviewed: 'входы в окно проверены',
  focus_start_requested: 'запрошен старт фокуса',
  focus_started: 'фокус начат',
  focus_switch_requested: 'запрошено переключение фокуса',
  focus_switched: 'фокус переключён',
  focus_stop_requested: 'запрошена остановка фокуса',
  focus_stopped: 'фокус остановлен',
  focus_start_failed: 'старт фокуса не удался',
  focus_stop_failed: 'остановка фокуса не удалась',
  focus_correction_requested: 'запрошена коррекция фокуса',
  focus_corrected: 'фокус скорректирован',
  focus_correction_reviewed: 'коррекция фокуса проверена',
  focus_correction_failed: 'коррекция фокуса не удалась',
  capture_create_requested: 'запрошено создание отвлечения',
  capture_created: 'отвлечение создано',
  capture_resolve_requested: 'запрошено закрытие отвлечения',
  capture_resolved: 'отвлечение закрыто',
  capture_update_requested: 'запрошено исправление отвлечения',
  capture_updated: 'отвлечение исправлено',
  capture_delete_requested: 'запрошено удаление отвлечения',
  capture_deleted: 'отвлечение удалено',
  capture_convert_requested: 'запрошено превращение отвлечения в дело',
  capture_converted: 'отвлечение превращено в дело',
  capture_create_failed: 'создание отвлечения не удалось',
  capture_resolve_failed: 'закрытие отвлечения не удалось',
  capture_update_failed: 'исправление отвлечения не удалось',
  capture_delete_failed: 'удаление отвлечения не удалось',
  capture_convert_failed: 'превращение отвлечения не удалось',
  capture_followup_reviewed: 'открытые отвлечения проверены',
  day_context_reviewed: 'контекст дня проверен',
  capture_usage_reviewed: 'инбокс отвлечений проверен',
  work_item_time_badges_reviewed: 'время по делам проверено',
  activity_zone_glanced: 'зоны активности учтены',
  activity_zone_reviewed: 'зоны активности проверены',
  entry_paths_reviewed: 'пути входа проверены',
  day_closure_started: 'закрытие дня начато',
  day_closure_completed: 'закрытие дня завершено',
  day_contract_created: 'договор дня создан',
  day_contract_revised: 'договор дня пересмотрен',
  day_contract_start_requested: 'запрошен старт из договора',
  day_contract_started: 'старт из договора выполнен',
  day_contract_start_failed: 'старт из договора не удался',
  day_contract_reentry_reviewed: 'договор просмотрен при возвращении',
  report_copy_requested: 'запрошено копирование отчёта',
  report_copied: 'отчёт скопирован',
  report_copy_failed: 'копирование отчёта не удалось',
  manual_copy_fallback_shown: 'показано ручное копирование',
}

function formatAppEventKind(kind: string) {
  return APP_EVENT_KIND_LABELS[kind] ?? kind
}

export function formatTelemetryForReport(markdown: string) {
  return markdown
    .replace(/^## App Telemetry$/m, '## Телеметрия приложения')
    .replace(/^Total events:/gm, 'Всего событий:')
    .replace(/^Start requests:/gm, 'Запросов старта:')
    .replace(/^Switch requests:/gm, 'Запросов переключения:')
    .replace(/^Stop requests:/gm, 'Запросов остановки:')
    .replace(/^Typed\/selected\/dispatch entry requests:/gm, 'Входов вводом/из списка/через диспетчеризацию:')
    .replace(/^Typed\/selected entry requests:/gm, 'Входов вводом/из списка:')
    .replace(/^Start\/stop failures:/gm, 'Ошибок старта/остановки:')
    .replace(/^Window shown\/hidden:/gm, 'Окно показано/скрыто:')
    .replace(/^Window show\/hide requests:/gm, 'Запросы показать/скрыть окно:')
    .replace(/^Window drag starts:/gm, 'Начатых перетаскиваний окна:')
    .replace(/^Copy failures:/gm, 'Ошибок копирования:')
    .replace(/^Manual copy fallbacks:/gm, 'Ручных копирований вместо буфера:')
    .replace(/^Capture created\/resolved\/converted:/gm, 'Отвлечений создано/закрыто/превращено:')
    .replace(/^Capture follow-up reviews:/gm, 'Проверок открытых отвлечений:')
    .replace(/^Day context reviews:/gm, 'Проверок контекста дня:')
    .replace(/^Work Item time badge reviews:/gm, 'Проверок времени по делам:')
    .replace(/^Activity Zone glances:/gm, 'Просмотров зон активности:')
    .replace(/^Activity Zone reviews:/gm, 'Проверок зон активности:')
    .replace(/^Capture usage reviews:/gm, 'Проверок использования инбокса:')
    .replace(/^Entry path reviews:/gm, 'Проверок путей входа:')
    .replace(/^Window entrypoint reviews:/gm, 'Проверок входа в окно:')
    .replace(/^Capture updated\/deleted:/gm, 'Отвлечений изменено/удалено:')
    .replace(/^Capture failures create\/resolve\/update\/delete\/convert:/gm, 'Ошибок отвлечений: создание/закрытие/изменение/удаление/превращение:')
    .replace(/^Corrections requested\/applied\/reviewed\/failed:/gm, 'Коррекций запрошено/применено/проверено/ошибок:')
    .replace(/^Day contract created\/revised\/start requests\/starts\/failures\/reentries:/gm, 'Договор дня создан/пересмотрен/запрошено стартов/стартов/ошибок/возвратов:')
    .replace(/^Day closure started\/completed:/gm, 'Закрытий дня начато/завершено:')
    .replace(/^Last day closure duration:/gm, 'Последняя длительность закрытия дня:')
    .replace(/^API errors:/gm, 'Ошибок API:')
    .replace(/^Already-active start attempts:/gm, 'Попыток старта уже активного дела:')
    .replace(/^Stale runtime recoveries:/gm, 'Восстановлений устаревшего состояния агента:')
    .replace(/^Average start latency:/gm, 'Средняя задержка старта:')
    .replace(/^Slow window-to-focus gaps:/gm, 'Медленных переходов окно-фокус:')
    .replace(/^### Events By Kind$/m, '### События по типам')
    .replace(/^\| Count \| Kind \|$/gm, '| Кол-во | Тип |')
    .replace(/: n\/a$/gm, ': нет данных')
    .replace(/(\d+)ms\b/g, '$1 мс')
    .replace(/^\| (\d+) \| ([a-z_]+) \|$/gm, (_line, count, kind) => `| ${count} | ${formatAppEventKind(kind)} |`)
}

export function formatShortClosureMarkdown(
  appTelemetryMarkdown: string,
  { reportReady = false }: { reportReady?: boolean } = {}
) {
  return [
    '## Короткое закрытие',
    '',
    formatShortClosureStatusLine(appTelemetryMarkdown),
    formatShortClosureTrustLine(reportReady),
    formatShortClosureDurationLine(appTelemetryMarkdown),
    '- Главное наблюдение дня (если нужно):',
    '- Следующий шаг после закрытия (если уже ясен):',
  ].join('\n')
}

function formatShortClosureStatusLine(appTelemetryMarkdown: string) {
  const closureCounts = parseCountPair(extractLineValue(appTelemetryMarkdown, 'Day closure started/completed'))

  if (!closureCounts || closureCounts.left === 0) {
    return '- Статус закрытия: не начато'
  }

  if (closureCounts.left > closureCounts.right) {
    return '- Статус закрытия: идёт (заверши через «Копировать отчёт»)'
  }

  return '- Статус закрытия: завершено'
}

function formatShortClosureTrustLine(reportReady: boolean) {
  if (reportReady) return '- Данным можно доверять: да (проверки закрыты)'
  return '- Данным можно доверять: пока нет (см. «Проверка перед отчётом»)'
}

function formatShortClosureDurationLine(appTelemetryMarkdown: string) {
  const closureCounts = parseCountPair(extractLineValue(appTelemetryMarkdown, 'Day closure started/completed'))
  const lastClosureDuration = parseDurationSeconds(extractLineValue(appTelemetryMarkdown, 'Last day closure duration'))

  if (!closureCounts?.right || lastClosureDuration == null) {
    return '- Закрытие уложилось в 10 минут: нет данных (закрытие не измерено)'
  }

  const verdict = lastClosureDuration <= 10 * 60 ? 'да' : 'нет'
  return `- Закрытие уложилось в 10 минут: ${verdict} (${formatDuration(lastClosureDuration)})`
}

export type Gap = {
  from: string
  to: string
  seconds: number
}

export type DayReviewItem = {
  level: 'blocker' | 'review' | 'ok'
  title: string
  detail?: string
  action?: DayReviewAction
  secondaryActions?: DayReviewAction[]
}

export type DayReviewAction =
  | 'stage_focus_correction'
  | 'accept_tracking_accuracy'
  | 'accept_open_captures'
  | 'accept_day_context'
  | 'accept_work_item_time_badges'
  | 'accept_activity_zones'
  | 'accept_capture_usage'
  | 'accept_entry_paths'
  | 'accept_window_entrypoints'
  | 'stage_significant_gap'
  | 'stage_open_gap'
  | 'stage_significant_gap_lost_control'
  | 'stage_open_gap_lost_control'
  | 'stage_significant_gap_recovery'
  | 'stage_open_gap_recovery'
  | 'stage_day_context'
  | 'stop_active_focus'
  | 'clear_active_work_items'

function isSignificantGapStageAction(action: DayReviewAction) {
  return (
    action === 'stage_significant_gap' ||
    action === 'stage_significant_gap_lost_control' ||
    action === 'stage_significant_gap_recovery'
  )
}

function isOpenGapStageAction(action: DayReviewAction) {
  return (
    action === 'stage_open_gap' ||
    action === 'stage_open_gap_lost_control' ||
    action === 'stage_open_gap_recovery'
  )
}

function presetFromReviewAction(action: DayReviewAction): GapExplanationPreset | undefined {
  if (action === 'stage_significant_gap_lost_control' || action === 'stage_open_gap_lost_control') {
    return 'lost_control'
  }

  if (action === 'stage_significant_gap_recovery' || action === 'stage_open_gap_recovery') {
    return 'recovery'
  }

  return undefined
}

function countPendingReviewItems(items: DayReviewItem[]) {
  return items.filter((item) => item.level !== 'ok').length
}

function isAcceptReviewAction(action?: DayReviewAction) {
  return Boolean(action?.startsWith('accept_'))
}

function ActivityZoneDashboard({
  summary,
  zoneTotals,
  glanceCount,
  onMarkGlanced,
}: {
  summary: ReturnType<typeof summarizeActivityZones>
  zoneTotals: ActivityZoneTotal[]
  glanceCount: number
  onMarkGlanced: () => void
}) {
  const visibleZones = zoneTotals.filter((item) => item.activeSeconds > 0)

  return (
    <div className="grid gap-2 rounded-md border border-gray-800 bg-gray-900/45 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-300">Зоны сегодня</span>
        <span className="flex items-center gap-2 text-[11px] text-gray-500">
          <span>всего {formatDuration(summary.totalTrackedSeconds)}</span>
          <button
            type="button"
            onClick={onMarkGlanced}
            className="rounded border border-gray-700 px-1.5 py-0.5 text-gray-300 hover:border-cyan-700 hover:text-cyan-200"
            title="Нажми после осознанного просмотра распределения зон. Дневной ориентир — два просмотра."
          >
            Отметить просмотр · {glanceCount}/2
          </button>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ActivityZoneMetric label="Рабочая занятость" value={summary.workingOccupancySeconds} tone="cyan" />
        <ActivityZoneMetric label="Исполнение" value={summary.executiveWorkSeconds} tone="blue" />
        <ActivityZoneMetric label="Вне работы" value={summary.nonWorkTrackedSeconds} tone="gray" />
      </div>
      {visibleZones.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleZones.map((zone) => (
            <span
              key={zone.zone}
              className="rounded border border-gray-800 bg-gray-950/40 px-1.5 py-0.5 text-[11px] text-gray-300"
              title={`${formatActivityZoneLabel(zone.zone)}: ${zone.entrances} ${pluralRu(zone.entrances, 'вход', 'входа', 'входов')}`}
            >
              {formatActivityZoneLabel(zone.zone)} {formatDuration(zone.activeSeconds)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ActivityZoneMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'blue' | 'cyan' | 'gray'
}) {
  const toneClass = tone === 'blue'
    ? 'border-blue-900/60 bg-blue-950/20 text-blue-200'
    : tone === 'cyan'
      ? 'border-cyan-900/60 bg-cyan-950/20 text-cyan-200'
      : 'border-gray-800 bg-gray-950/30 text-gray-300'

  return (
    <div className={`rounded border px-2 py-1 ${toneClass}`}>
      <div className="truncate text-[11px] text-gray-500">{label}</div>
      <div className="font-mono text-sm tabular-nums">{formatDuration(value)}</div>
    </div>
  )
}

function buildDayReviewItems({
  sessions,
  activeFocus,
  activeWorkItems,
  workItems,
  openCaptures,
  captureActivity,
  workItemEvents,
  dayEvents,
  openGap,
  appTelemetry,
}: {
  sessions: FocusSessionView[]
  activeFocus?: FocusSessionView
  activeWorkItems: WorkItemView[]
  workItems: WorkItemView[]
  openCaptures: CaptureView[]
  captureActivity: CaptureView[]
  workItemEvents: WorkItemEventView[]
  dayEvents: DayEventView[]
  openGap?: Gap
  appTelemetry?: AppEventSummary | null
}): DayReviewItem[] {
  const items: DayReviewItem[] = []
  const gaps = gapsBetweenSessions(sessions).filter((gap) => gap.seconds >= SIGNIFICANT_GAP_SECONDS)
  const overlaps = findFocusSessionOverlaps(sessions)
  const zoneTotals = aggregateActivityZoneTotals(sessions)
  const activeSecondsTotal = sessions.reduce((sum, session) => sum + session.active_seconds, 0)
  const nonWorkSeconds = summarizeActivityZones(zoneTotals, activeSecondsTotal).nonWorkTrackedSeconds
  const touchedWorkItemIds = new Set(sessions.map((session) => session.work_item_id).filter(Boolean))
  const touchedWorkItemNoteCount = workItems.filter((item) => touchedWorkItemIds.has(item.id) && item.note?.trim()).length
  const gapExplanationCount = countClassifiedGaps(gaps, dayEvents)
  const unexplainedGapCount = Math.max(gaps.length - gapExplanationCount, 0)
  const activityZoneReviewed = (appTelemetry?.by_kind.activity_zone_reviewed ?? 0) > 0
  const activityZoneGlances = appTelemetry?.activity_zone_glances ?? 0
  const dayContextReviewed = (appTelemetry?.by_kind.day_context_reviewed ?? 0) > 0
  const captureUsageReviewed = (appTelemetry?.by_kind.capture_usage_reviewed ?? 0) > 0
  const entryPathsReviewed = (appTelemetry?.by_kind.entry_paths_reviewed ?? 0) > 0
  const windowEntrypointsReviewed = (appTelemetry?.by_kind.window_entrypoints_reviewed ?? 0) > 0

  if (activeFocus) {
    items.push({
      level: 'blocker',
      title: 'Stop the active focus block',
      detail: activeFocus.work_item_title ?? activeFocus.title,
      action: 'stop_active_focus',
    })
  }

  if (!activeFocus && activeWorkItems.length > 0) {
    items.push({
      level: 'blocker',
      title: 'Clear active Work Item state',
      detail: `${formatCount(activeWorkItems.length, 'дело', 'дела', 'дел')} с активным статусом`,
      action: 'clear_active_work_items',
    })
  }

  if (overlaps.length > 0) {
    const overlap = overlaps[0]
    const firstTitle = overlap.first.work_item_title ?? overlap.first.title
    const secondTitle = overlap.second.work_item_title ?? overlap.second.title
    items.push({
      level: 'blocker',
      title: 'Resolve overlapping focus blocks',
      detail: `${formatCount(overlaps.length, 'пересечение', 'пересечения', 'пересечений')}; «${firstTitle}» и «${secondTitle}» одновременно ${formatClockTime(overlap.from.toISOString())}-${formatClockTime(overlap.to.toISOString())} (${formatDuration(overlap.seconds)})`,
    })
  }

  if (openCaptures.length > 0 && (appTelemetry?.capture_followup_reviews ?? 0) === 0) {
    items.push({
      level: 'review',
      title: 'Resolve, convert, or accept open captures',
      detail: `${openCaptures.length} открыто`,
      action: 'accept_open_captures',
    })
  }

  if (unexplainedGapCount > 0) {
    const nextGap = pickNextGapForReview(gaps, dayEvents)
    items.push({
      level: 'review',
      title: 'Classify significant gaps',
      detail: formatSignificantGapReviewDetail(unexplainedGapCount, gaps.length, nextGap),
      action: 'stage_significant_gap',
      secondaryActions: ['stage_significant_gap_lost_control', 'stage_significant_gap_recovery'],
    })
  }

  if (openGap && openGap.seconds >= SIGNIFICANT_GAP_SECONDS && !findOpenGapExplanation(dayEvents)) {
    items.push({
      level: 'review',
      title: 'Explain current open gap',
      detail: `${formatDuration(openGap.seconds)} после последнего остановленного блока`,
      action: 'stage_open_gap',
      secondaryActions: ['stage_open_gap_lost_control', 'stage_open_gap_recovery'],
    })
  }

  if (sessions.length > 0 && zoneTotals.length <= 1 && !activityZoneReviewed) {
    items.push({
      level: 'review',
      title: 'Review Activity Zone coverage',
      detail: 'В отчёте видна только одна зона',
      action: 'accept_activity_zones',
    })
  }

  if (sessions.length > 0 && nonWorkSeconds === 0 && !activityZoneReviewed) {
    items.push({
      level: 'review',
      title: 'Confirm non-work tracked time',
      detail: 'Перерывы, восстановление, простой или личные дела могли потеряться',
      action: 'accept_activity_zones',
    })
  }

  if (sessions.length > 0 && activityZoneGlances < 2 && !activityZoneReviewed) {
    items.push({
      level: 'review',
      title: 'Check zones during the day',
      detail: `распределение зон просмотрено ${activityZoneGlances} раз; дневной ориентир — 2`,
      action: 'accept_activity_zones',
    })
  }

  if (sessions.length > 0 && touchedWorkItemIds.size > 0 && (appTelemetry?.work_item_time_badge_reviews ?? 0) === 0) {
    items.push({
      level: 'review',
      title: 'Confirm Work Item today/total badges',
      detail: `${formatCount(touchedWorkItemIds.size, 'дело было', 'дела были', 'дел было')} в работе сегодня`,
      action: 'accept_work_item_time_badges',
    })
  }

  if (sessions.length > 0 && captureActivity.length === 0 && !captureUsageReviewed) {
    items.push({
      level: 'review',
      title: 'Capture Inbox untested today',
      detail: 'За день не было ни одного отвлечения',
      action: 'accept_capture_usage',
    })
  }

  if (captureActivity.length > 0 && captureActivity.every((capture) => !capture.focus_session_id) && !captureUsageReviewed) {
    items.push({
      level: 'review',
      title: 'Captures were not linked to active focus',
      detail: 'Обработка отвлечений в фокусе сегодня не проверена',
      action: 'accept_capture_usage',
    })
  }

  if (sessions.length > 0 && dayEvents.length === 0 && workItemEvents.length === 0 && touchedWorkItemNoteCount === 0 && !dayContextReviewed) {
    items.push({
      level: 'review',
      title: 'No day or Work Item notes/events',
      detail: 'Если отчёт требует памяти, добавь одну фразу; если всё ясно, прими как есть',
      action: 'accept_day_context',
      secondaryActions: ['stage_day_context'],
    })
  }

  if (sessions.length > 0 && appTelemetry) {
    if (
      appTelemetry.typed_entry_requests === 0 ||
      appTelemetry.selected_entry_requests === 0 ||
      appTelemetry.dispatch_ritual_entry_requests === 0 ||
      appTelemetry.stop_requests === 0
    ) {
      if (!entryPathsReviewed) {
        items.push({
      level: 'review',
      title: 'Exercise start and continue paths',
      detail: `${appTelemetry.typed_entry_requests} вводом, ${appTelemetry.selected_entry_requests} из списка, ${appTelemetry.dispatch_ritual_entry_requests} через диспетчеризацию, ${appTelemetry.stop_requests} остановок`,
      action: 'accept_entry_paths',
    })
      }
    }

    if (appTelemetry.window_show_requested === 0 || appTelemetry.window_hide_requested === 0) {
      if (!windowEntrypointsReviewed) {
      items.push({
        level: 'review',
        title: 'Test window entrypoints',
        detail: `${appTelemetry.window_show_requested} запросов показа, ${appTelemetry.window_hide_requested} запросов скрытия`,
        action: 'accept_window_entrypoints',
      })
      }
    }

    if (appTelemetry.unreviewed_correction_failures > 0) {
      items.push({
        level: 'review',
        title: 'Review failed focus corrections',
        detail: formatCorrectionFailureReviewDetail(appTelemetry),
        action: 'accept_tracking_accuracy',
        secondaryActions: ['stage_focus_correction'],
      })
    } else if (appTelemetry.corrections === 0 && appTelemetry.correction_reviews === 0) {
      items.push({
        level: 'review',
        title: 'Confirm tracking accuracy or test correction',
        detail: 'Сегодня не было коррекций фокус-блоков',
        action: 'accept_tracking_accuracy',
        secondaryActions: ['stage_focus_correction'],
      })
    }
  }

  if (sessions.length === 0) {
    items.push({
      level: 'review',
      title: 'No focus blocks yet',
      detail: 'Сначала запусти хотя бы один блок',
    })
  }

  if (items.length === 0) {
    items.push({
      level: 'ok',
      title: 'Ready to copy final report',
      detail: 'Автоматических замечаний нет',
    })
  }

  return items
}

function DayReviewPanel({
  items,
  closureStartedAt,
  closureElapsedSeconds,
  closureStage,
  canStartClosure,
  onAction,
  onStartClosure,
}: {
  items: DayReviewItem[]
  closureStartedAt?: Date | null
  closureElapsedSeconds?: number
  closureStage: DayClosureStage
  canStartClosure?: boolean
  onAction?: (action: DayReviewAction) => void | Promise<void>
  onStartClosure?: () => void
}) {
  const blockers = items.filter((item) => item.level === 'blocker')
  const reviews = items.filter((item) => item.level === 'review')
  const actionReviews = reviews.filter((item) => !isAcceptReviewAction(item.action))
  const acceptReviews = reviews.filter((item) => isAcceptReviewAction(item.action))
  const readyItems = items.filter((item) => item.level === 'ok')
  const bulkAcceptReviewActions = getBulkAcceptableReviewActions(items) as DayReviewAction[]
  const compactAcceptReviews = shouldCompactAcceptAsIsReviewItems(items)
  const showReviewDetails = shouldShowDayReviewDetails(closureStage)
  const summarizedReadyItems = shouldSummarizeReadyReviewItems({
    blockerCount: blockers.length,
    reviewCount: reviews.length,
    readyCount: readyItems.length,
  })
  const statusClass = !showReviewDetails
    ? 'border-gray-800 bg-gray-950/20'
    : blockers.length > 0
      ? 'border-red-900/70 bg-red-950/20'
      : reviews.length > 0
        ? 'border-amber-900/70 bg-amber-950/20'
        : 'border-emerald-900/70 bg-emerald-950/20'
  const statusText = closureStage === 'no_data'
    ? 'нет данных'
    : closureStage === 'not_started'
      ? 'не начато'
      : blockers.length > 0
        ? `${blockers.length} ${pluralRu(blockers.length, 'красный пункт', 'красных пункта', 'красных пунктов')}`
        : reviews.length > 0
          ? `${reviews.length} ${pluralRu(reviews.length, 'проверка', 'проверки', 'проверок')}`
          : 'готово'
  const nextStep = closureStage === 'no_data'
    ? 'дождаться первых фокус-блоков за день.'
    : closureStage === 'not_started'
      ? 'вечером нажать «Начать закрытие дня», когда день правда пора закрывать.'
      : formatDayReviewNextStep(items)
  const prompt = formatDayClosurePrompt(closureStage, {
    blockers: blockers.length,
    reviews: reviews.length,
    fixups: actionReviews.length,
    accepts: acceptReviews.length,
    closureElapsedSeconds,
  })
  const reviewSummary = showReviewDetails ? formatDayReviewSummary(items) : ''
  const acceptAllReviews = async () => {
    for (const action of bulkAcceptReviewActions) {
      await onAction?.(action)
    }
  }

  return (
    <div className={`grid gap-2 rounded-md border px-3 py-2 text-xs ${statusClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-200">Проверка перед отчётом</span>
        <span className="flex items-center gap-2">
          <span className="text-gray-500">{statusText}</span>
          {closureStartedAt && closureElapsedSeconds != null && (
            <span className="rounded border border-gray-800 px-1.5 py-0.5 text-[11px] text-gray-400">
              закрытие {formatDuration(closureElapsedSeconds)}
            </span>
          )}
          {showReviewDetails && bulkAcceptReviewActions.length > 0 && !compactAcceptReviews && onAction && (
            <button
              type="button"
              onClick={() => {
                void acceptAllReviews()
              }}
              className="rounded border border-amber-800 px-1.5 py-0.5 text-[11px] font-medium text-amber-100 hover:border-amber-500"
              title="Отметить все оставшиеся жёлтые проверки как осознанно проверенные"
            >
              Всё проверено
            </button>
          )}
          {onStartClosure && (
            <button
              type="button"
              onClick={onStartClosure}
              disabled={!canStartClosure || Boolean(closureStartedAt)}
              className="rounded border border-emerald-800 px-1.5 py-0.5 text-[11px] font-medium text-emerald-100 hover:border-emerald-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
            >
              {closureStartedAt ? `Закрытие начато ${formatClockTime(closureStartedAt.toISOString())}` : 'Начать закрытие дня'}
            </button>
          )}
        </span>
      </div>
      {prompt && (
        <div className="rounded border border-gray-800/80 bg-gray-950/30 px-2 py-1 text-[11px] text-gray-300">
          {prompt}
        </div>
      )}
      <div className="rounded border border-gray-800/80 bg-gray-950/20 px-2 py-1 text-[11px] text-gray-300">
        <span className="font-medium text-gray-200">Ближайшее действие:</span> {nextStep}
        {reviewSummary && (
          <span className="mt-0.5 block text-gray-500">{reviewSummary}</span>
        )}
      </div>
      {showReviewDetails && blockers.length > 0 && (
        <DayReviewGroup title="Сначала закрыть" items={blockers} onAction={onAction} />
      )}
      {showReviewDetails && actionReviews.length > 0 && (
        <DayReviewGroup title="Дописать или исправить" items={actionReviews} onAction={onAction} />
      )}
      {showReviewDetails && acceptReviews.length > 0 && compactAcceptReviews && (
        <CompactAcceptReviewGroup items={acceptReviews} onAcceptAll={acceptAllReviews} canAccept={Boolean(onAction)} />
      )}
      {showReviewDetails && acceptReviews.length > 0 && !compactAcceptReviews && (
        <DayReviewGroup title="Проверить качество данных" items={acceptReviews} onAction={onAction} />
      )}
      {showReviewDetails && summarizedReadyItems && (
        <div className="text-[11px] text-gray-500">
          Уже чисто: {readyItems.length} {pluralRu(readyItems.length, 'пункт', 'пункта', 'пунктов')}.
        </div>
      )}
      {showReviewDetails && !summarizedReadyItems && readyItems.length > 0 && blockers.length === 0 && reviews.length === 0 && (
        <DayReviewGroup title="Готово" items={readyItems} onAction={onAction} />
      )}
    </div>
  )
}

function CompactAcceptReviewGroup({
  items,
  onAcceptAll,
  canAccept,
}: {
  items: DayReviewItem[]
  onAcceptAll: () => Promise<void>
  canAccept: boolean
}) {
  const labels = items.map((item) => formatDayReviewItem(item))

  return (
    <div className="rounded border border-amber-900/60 bg-amber-950/10 px-2 py-1 text-[11px] text-amber-100">
      <div className="flex items-center justify-between gap-2">
        <span>
          <span className="font-medium">Проверить качество данных:</span>{' '}
          это {items.length} {pluralRu(items.length, 'контрольный пункт', 'контрольных пункта', 'контрольных пунктов')}, а не найденные ошибки дня.
        </span>
        <button
          type="button"
          onClick={() => {
            void onAcceptAll()
          }}
          disabled={!canAccept}
          className="shrink-0 rounded border border-amber-800 px-1.5 py-0.5 text-[11px] font-medium text-amber-100 hover:border-amber-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500"
        >
          Подтвердить все {items.length}
        </button>
      </div>
      <ul className="mt-1 grid gap-0.5 text-gray-400">
        {labels.map((label) => (
          <li key={`${label.title}:${label.detail ?? ''}`} className="flex gap-1.5">
            <span aria-hidden>•</span>
            <span>
              <span className="text-gray-300">{label.title}</span>
              {label.detail && <span className="text-gray-500"> — {label.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function formatDayClosurePrompt(
  stage: DayClosureStage,
  {
    blockers,
    reviews,
    fixups,
    accepts,
    closureElapsedSeconds,
  }: {
    blockers: number
    reviews: number
    fixups?: number
    accepts?: number
    closureElapsedSeconds?: number
  }
) {
  if (stage === 'no_data') {
    return 'Сегодня ещё нет фокус-блоков. Когда появятся данные, здесь будет короткий ритуал закрытия.'
  }

  if (stage === 'not_started') {
    return 'Когда рабочий день закончен, начни закрытие дня: Timeskein измерит, сколько заняло короткое закрытие.'
  }

  if (stage === 'blocked') {
    return `Сначала закрой красные пункты: осталось ${blockers} ${pluralRu(blockers, 'пункт', 'пункта', 'пунктов')} перед финальным отчётом.${formatClosureElapsedHint(closureElapsedSeconds)}`
  }

  if (stage === 'review') {
    if (fixups && accepts) {
      return `Осталось: ${formatCount(fixups, 'пункт дописать', 'пункта дописать', 'пунктов дописать')}, ${formatCount(accepts, 'пункт только проверить', 'пункта только проверить', 'пунктов только проверить')}. Сначала выполни ближайшее действие ниже.${formatClosureElapsedHint(closureElapsedSeconds)}`
    }
    if (fixups) {
      return `Осталось ${formatCount(fixups, 'пункт дописать или исправить', 'пункта дописать или исправить', 'пунктов дописать или исправить')}: запиши недостающий контекст.${formatClosureElapsedHint(closureElapsedSeconds)}`
    }
    if (accepts) {
      return `Осталось ${formatCount(accepts, 'пункт осознанно проверить', 'пункта осознанно проверить', 'пунктов осознанно проверить')}: отметь их, если данные уже достаточно честные.${formatClosureElapsedHint(closureElapsedSeconds)}`
    }
    return `Осталось ${reviews} ${pluralRu(reviews, 'проверка', 'проверки', 'проверок')}: запиши недостающий контекст или отметь пункт как проверенный, если данные уже достаточно честные.${formatClosureElapsedHint(closureElapsedSeconds)}`
  }

  const elapsedText = formatClosureElapsedHint(closureElapsedSeconds)
  return `Проверки чистые.${elapsedText} Кнопка «Копировать отчёт» завершит закрытие дня. После этого ` +
    '`pnpm dogfood:finish:save` сохранит доказательства.'
}

function formatClosureElapsedHint(closureElapsedSeconds?: number) {
  if (closureElapsedSeconds == null) {
    return ''
  }

  const elapsed = formatDuration(closureElapsedSeconds)
  if (closureElapsedSeconds <= 10 * 60) {
    return ` Закрытие идёт ${elapsed}, цель — до 10:00.`
  }

  return ` Закрытие идёт ${elapsed}: этот день уже не докажет цель 10 минут, но данные всё равно стоит спокойно закрыть.`
}

function DayReviewGroup({
  title,
  items,
  onAction,
}: {
  title: string
  items: DayReviewItem[]
  onAction?: (action: DayReviewAction) => void | Promise<void>
}) {
  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{title}</div>
      {items.map((item) => {
        const label = formatDayReviewItem(item)
        const actions = [item.action, ...(item.secondaryActions ?? [])].filter(Boolean) as DayReviewAction[]
        const actionHint = formatReviewItemActionHint(item)

        return (
          <div key={`${item.level}:${item.title}:${item.detail ?? ''}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
            <span className={reviewItemDotClass(item.level)} />
            <span className="min-w-0 text-gray-300">
              <span className="font-medium text-gray-200">{label.title}</span>
              {label.detail && <span className="text-gray-500"> · {truncate(label.detail, 100)}</span>}
              {actionHint && <span className="mt-0.5 block text-gray-500">{actionHint}</span>}
            </span>
            {actions.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1">
                {actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => {
                      void onAction?.(action)
                    }}
                    className="rounded border border-amber-800 px-1.5 py-0.5 text-[11px] font-medium text-amber-100 hover:border-amber-500"
                  >
                    {formatReviewActionLabel(action)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function formatReviewActionLabel(action: DayReviewAction) {
  switch (action) {
    case 'stage_significant_gap':
    case 'stage_open_gap':
      return 'Объяснить'
    case 'stage_significant_gap_lost_control':
    case 'stage_open_gap_lost_control':
      return 'Управляемость'
    case 'stage_significant_gap_recovery':
    case 'stage_open_gap_recovery':
      return 'Восстановление'
    case 'stage_day_context':
      return 'Добавить контекст'
    case 'stage_focus_correction':
      return 'Добавить блок'
    case 'accept_day_context':
      return 'Контекст не нужен'
    case 'stop_active_focus':
      return 'Стоп'
    case 'clear_active_work_items':
      return 'Снять активность'
    case 'accept_open_captures':
      return 'Оставить как хвост'
    case 'accept_work_item_time_badges':
      return 'Время верно'
    case 'accept_activity_zones':
      return 'Зоны верны'
    case 'accept_capture_usage':
      return 'Инбокс проверен'
    case 'accept_entry_paths':
      return 'Пути проверены'
    case 'accept_window_entrypoints':
      return 'Окно проверено'
    case 'accept_tracking_accuracy':
      return 'Трекинг верен'
  }
}

function reviewItemDotClass(level: DayReviewItem['level']) {
  const color = level === 'blocker'
    ? 'bg-red-400'
    : level === 'review'
      ? 'bg-amber-300'
      : 'bg-emerald-400'

  return `mt-1.5 h-1.5 w-1.5 rounded-full ${color}`
}

export function formatDayReviewItem(item: DayReviewItem) {
  return {
    title: REVIEW_TITLE_LABELS[item.title] ?? item.title,
    detail: formatDayReviewDetail(item.detail),
  }
}

function formatDayReviewDetail(detail?: string) {
  if (!detail) return detail

  const openCapturesMatch = detail.match(/^(\d+) открыто$/)
  if (openCapturesMatch) {
    const count = Number(openCapturesMatch[1])
    return formatCount(count, 'открытое отвлечение', 'открытых отвлечения', 'открытых отвлечений')
  }

  const unexplainedGapsMatch = detail.match(/^(\d+)\/(\d+) больших разрывов без события дня(?:; следующий: (.+))?$/)
  if (unexplainedGapsMatch) {
    const missing = Number(unexplainedGapsMatch[1])
    const total = Number(unexplainedGapsMatch[2])
    const nextGap = unexplainedGapsMatch[3]
    const gapLabel = formatCount(missing, 'большой разрыв', 'больших разрыва', 'больших разрывов')
    const base = missing === total ? `${gapLabel} без события дня` : `${missing} из ${total} больших разрывов без события дня`
    return nextGap ? `${base}; следующий: ${nextGap}` : base
  }

  const activeWorkItemMatch = detail.match(/^(\d+) Work Item с активным статусом$/)
  if (activeWorkItemMatch) {
    const count = Number(activeWorkItemMatch[1])
    return `${formatCount(count, 'дело', 'дела', 'дел')} с активным статусом`
  }

  const touchedWorkItemMatch = detail.match(/^(\d+) Work Item были в работе сегодня$/)
  if (touchedWorkItemMatch) {
    const count = Number(touchedWorkItemMatch[1])
    return `${formatCount(count, 'дело было', 'дела были', 'дел было')} в работе сегодня`
  }

  const zoneGlanceMatch = detail.match(/^распределение зон просмотрено (\d+) раз; дневной ориентир — 2$/)
  if (zoneGlanceMatch) {
    return `распределение зон просмотрено ${zoneGlanceMatch[1]} раз; дневной ориентир — 2`
  }

  const entryPathMatch = detail.match(/^(\d+) вводом, (\d+) из списка, (?:(\d+) через диспетчеризацию, )?(\d+) остановок$/)
  if (entryPathMatch) {
    const typed = Number(entryPathMatch[1])
    const selected = Number(entryPathMatch[2])
    const dispatch = entryPathMatch[3] == null ? 0 : Number(entryPathMatch[3])
    const stops = Number(entryPathMatch[4])
    const parts = [
      formatCount(typed, 'старт вводом', 'старта вводом', 'стартов вводом'),
      formatCount(selected, 'старт из списка', 'старта из списка', 'стартов из списка'),
    ]
    if (entryPathMatch[3] != null) {
      parts.push(formatCount(dispatch, 'старт через диспетчеризацию', 'старта через диспетчеризацию', 'стартов через диспетчеризацию'))
    }
    parts.push(formatCount(stops, 'остановка', 'остановки', 'остановок'))
    return parts.join(', ')
  }

  const windowRequestMatch = detail.match(/^(\d+) запросов показа, (\d+) запросов скрытия$/)
  if (windowRequestMatch) {
    const show = Number(windowRequestMatch[1])
    const hide = Number(windowRequestMatch[2])
    return [
      formatCount(show, 'запрос на показ', 'запроса на показ', 'запросов на показ'),
      formatCount(hide, 'запрос на скрытие', 'запроса на скрытие', 'запросов на скрытие'),
    ].join(', ')
  }

  const correctionFailuresMatch = detail.match(/^(\d+) ошибок коррекции$/)
  if (correctionFailuresMatch) {
    const count = Number(correctionFailuresMatch[1])
    return formatCount(count, 'ошибка коррекции', 'ошибки коррекции', 'ошибок коррекции')
  }

  return detail
}

function formatCorrectionFailureReviewDetail(summary: AppEventSummary) {
  const count = summary.unreviewed_correction_failures
  const parts = [formatCount(count, 'неудачная попытка', 'неудачные попытки', 'неудачных попыток')]
  if (summary.latest_correction_failure_control) {
    const controls: Record<string, string> = {
      add_missed_block: 'добавить пропущенный блок',
      edit_block: 'изменить блок',
      split_block: 'разделить блок',
    }
    parts.push(controls[summary.latest_correction_failure_control] ?? summary.latest_correction_failure_control)
  }
  if (summary.latest_correction_failure_error_code) {
    const errors: Record<string, string> = {
      validation_error: 'данные не прошли проверку',
      client_error: 'запрос был отклонён',
    }
    parts.push(errors[summary.latest_correction_failure_error_code] ?? summary.latest_correction_failure_error_code)
  }
  if (summary.corrections > 0) {
    parts.push(`успешно применено: ${summary.corrections}`)
  }
  return parts.join(' · ')
}

function formatCount(value: number, one: string, few: string, many: string) {
  return `${value} ${pluralRu(value, one, few, many)}`
}

function formatSignificantGapReviewDetail(missing: number, total: number, nextGap?: Gap) {
  const base = `${missing}/${total} больших разрывов без события дня`
  if (!nextGap) return base
  return `${base}; следующий: ${formatGapInterval(nextGap)}`
}

function formatGapInterval(gap: Gap) {
  return `${formatClockTime(gap.from)}-${formatClockTime(gap.to)} (${formatDuration(gap.seconds)})`
}

const REVIEW_TITLE_LABELS: Record<string, string> = {
  'Stop the active focus block': 'Остановить активный фокус-блок',
  'Clear active Work Item state': 'Снять активный статус с дела',
  'Resolve overlapping focus blocks': 'Исправить пересекающиеся фокус-блоки',
  'Resolve, convert, or accept open captures': 'Разобрать открытые отвлечения',
  'Classify significant gaps': 'Объяснить большие разрывы',
  'Explain current open gap': 'Объяснить текущий открытый разрыв',
  'Review Activity Zone coverage': 'Проверить зоны активности',
  'Confirm non-work tracked time': 'Проверить нерабочее время',
  'Check zones during the day': 'Отметить просмотр зон',
  'Confirm Work Item today/total badges': 'Проверить время по делам',
  'Capture Inbox untested today': 'Инбокс отвлечений сегодня не проверен',
  'Captures were not linked to active focus': 'Отвлечения не были связаны с активным фокусом',
  'No day or Work Item notes/events': 'Нет событий дня или дел',
  'Exercise start and continue paths': 'Проверить старт и продолжение',
  'Test window entrypoints': 'Проверить входы в окно',
  'Review failed focus corrections': 'Проверить ошибки коррекции фокуса',
  'Confirm tracking accuracy or test correction': 'Подтвердить точность трекинга',
  'No focus blocks yet': 'Пока нет фокус-блоков',
  'Ready to copy final report': 'Можно копировать финальный отчёт',
}
const DAILY_CONTROL_REQUIREMENT_LABELS: Record<string, string> = {
  'Final state clean': 'Финальное состояние чистое',
  'Focus blocks visible': 'Фокус-блоки видны',
  'Work Item totals available': 'Итоги по делам есть',
  'Activity Zones separated': 'Зоны активности разделены',
  'Day and Work Item context present': 'Контекст дня и дел сохранён',
  'Gaps and captures visible': 'Разрывы и отвлечения видны',
  'Window and menubar friction evidenced': 'Окно и строка меню проверены',
  'Start and continue paths evidenced': 'Старт и продолжение проверены',
  'Tracking correction or review evidenced': 'Коррекция трекинга проверена',
  'Day closure duration measured': 'Длительность закрытия измерена',
  'Hard blockers absent': 'Красных пунктов нет',
}
const DAILY_CONTROL_STATUS_LABELS: Record<string, string> = {
  block: 'красный пункт',
  pass: 'ок',
  review: 'проверить',
  manual: 'вручную',
}

function pluralRu(value: number, one: string, few: string, many: string) {
  const abs = Math.abs(value)
  const mod10 = abs % 10
  const mod100 = abs % 100

  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function formatDogfoodReportState({
  activeFocus,
  activeWorkItemCount,
  pendingReviewItemCount,
}: {
  activeFocus: boolean
  activeWorkItemCount: number
  pendingReviewItemCount: number
}) {
  if (activeFocus) return 'черновик — фокус-блок ещё активен'
  if (activeWorkItemCount > 0) return 'черновик — у дела ещё стоит активный статус'
  if (pendingReviewItemCount > 0) {
    return `черновик — осталось ${pendingReviewItemCount} ${pluralRu(pendingReviewItemCount, 'проверка', 'проверки', 'проверок')} перед финальным отчётом`
  }
  return 'финальный — нет активных фокус-блоков, активных дел и незакрытых проверок'
}

export function formatReportButtonLabel({
  copyState,
  closureStarted,
  reportIsDraft,
  reportHasPendingReview,
}: {
  copyState: 'idle' | 'copied' | 'failed'
  closureStarted: boolean
  reportIsDraft: boolean
  reportHasPendingReview: boolean
}) {
  if (copyState === 'copied') return 'Скопировано'
  if (copyState === 'failed') return 'Ошибка'
  if (!closureStarted) return 'Начать закрытие'
  if (reportIsDraft || reportHasPendingReview) return 'Закрыть проверки'
  return 'Копировать отчёт'
}

export function formatReviewChecklistMarkdown(items: DayReviewItem[]) {
  const lines = ['## Проверка перед отчётом', '', `Ближайшее действие: ${formatDayReviewNextStep(items)}`]
  const summary = formatDayReviewSummary(items)
  if (summary) {
    lines.push(summary)
  }
  lines.push('')
  const blockers = items.filter((item) => item.level === 'blocker')
  const reviews = items.filter((item) => item.level === 'review')
  const fixups = reviews.filter((item) => !isAcceptReviewAction(item.action))
  const accepts = reviews.filter((item) => isAcceptReviewAction(item.action))
  const ready = items.filter((item) => item.level === 'ok')

  appendReviewChecklistGroup(lines, 'Сначала закрыть', blockers)
  appendReviewChecklistGroup(lines, 'Дописать или исправить', fixups)
  appendReviewChecklistGroup(lines, 'Осознанно проверить', accepts)
  appendBulkAcceptAsIsHint(lines, items)
  appendReviewChecklistGroup(lines, 'Готово', ready)

  return `${lines.join('\n')}\n`
}

export function formatDayReviewSummary(items: DayReviewItem[]) {
  const blockers = items.filter((item) => item.level === 'blocker')
  const reviews = items.filter((item) => item.level === 'review')
  const fixups = reviews.filter((item) => !isAcceptReviewAction(item.action))
  const accepts = reviews.filter((item) => isAcceptReviewAction(item.action))

  if (blockers.length > 0) {
    const tail = reviews.length > 0
      ? `, затем ${formatCount(reviews.length, 'проверка', 'проверки', 'проверок')}`
      : ''
    return `Сводка: ${formatCount(blockers.length, 'красный пункт', 'красных пункта', 'красных пунктов')}${tail}.`
  }

  if (fixups.length > 0 && accepts.length > 0) {
    return `Сводка: ${formatCount(fixups.length, 'пункт дописать или исправить', 'пункта дописать или исправить', 'пунктов дописать или исправить')}, ${formatCount(accepts.length, 'пункт осознанно проверить', 'пункта осознанно проверить', 'пунктов осознанно проверить')}.`
  }

  if (fixups.length > 0) {
    return `Сводка: ${formatCount(fixups.length, 'пункт дописать или исправить', 'пункта дописать или исправить', 'пунктов дописать или исправить')}.`
  }

  if (accepts.length > 0) {
    return `Сводка: ${formatCount(accepts.length, 'пункт осознанно проверить', 'пункта осознанно проверить', 'пунктов осознанно проверить')}.`
  }

  if (items.some((item) => item.level === 'ok')) {
    return 'Сводка: проверка чистая.'
  }

  return ''
}

export function formatDayReviewNextStep(items: DayReviewItem[]) {
  const blockers = items.filter((item) => item.level === 'blocker')
  if (blockers.length > 0) {
    return formatNextStep('закрыть красный пункт', blockers)
  }

  const reviews = items.filter((item) => item.level === 'review')
  const fixups = reviews.filter((item) => !isAcceptReviewAction(item.action))
  if (fixups.length > 0) {
    return formatNextStep('дописать или исправить', fixups)
  }

  const accepts = reviews.filter((item) => isAcceptReviewAction(item.action))
  const bulkAcceptActionCount = getBulkAcceptableReviewActions(items).length
  if (accepts.length > 1 && bulkAcceptActionCount > 0 && accepts.every((item) => isBulkAcceptableReviewAction(item.action))) {
    return `осознанно проверить ${accepts.length} ${pluralRu(accepts.length, 'пункт', 'пункта', 'пунктов')} или нажать «Всё проверено», если данные уже честные.`
  }

  if (accepts.length > 0) {
    return formatNextStep('осознанно проверить', accepts)
  }

  if (items.some((item) => item.level === 'ok')) {
    return 'нажать «Копировать отчёт».'
  }

  return 'дождаться первых фокус-блоков за день.'
}

function formatNextStep(prefix: string, items: DayReviewItem[]) {
  const label = formatDayReviewItem(items[0])
  const title = formatNextStepTitle(items[0], label)
  const actionHint = formatNextStepHint(items[0])
  const rest = items.length > 1 ? ` Ещё ${items.length - 1}.` : ''
  return `${prefix}: ${title}.${actionHint}${rest}`
}

function formatNextStepTitle(item: DayReviewItem, label: { title: string; detail?: string }) {
  const nextGap = extractNextGapDetail(label.detail)
  if (item.title === 'Classify significant gaps' && nextGap) {
    return `${label.title} — ${nextGap}`
  }

  if (item.title === 'Explain current open gap' && label.detail) {
    return `${label.title} — ${label.detail}`
  }

  return label.title
}

function extractNextGapDetail(detail?: string) {
  return detail?.match(/(?:^|;\s*)следующий: (.+)$/)?.[1]
}

function formatNextStepHint(item: DayReviewItem) {
  if (!item.action) return formatNextStepBlockerHint(item)

  const actionLabel = formatReviewActionLabel(item.action)
  if (item.action === 'stop_active_focus') {
    return ` Нажми «${actionLabel}» у активного фокуса.`
  }

  if (item.action === 'clear_active_work_items') {
    return ` Нажми «${actionLabel}», если фокус уже остановлен.`
  }

  if (item.action === 'accept_open_captures') {
    return ` Разбери записи в Инбоксе или нажми «${actionLabel}», если запись должна остаться видимым хвостом.`
  }

  if (item.title === 'No day or Work Item notes/events') {
    return ' Нажми «Добавить контекст», если отчёт требует памяти, или «Контекст не нужен», если всё ясно.'
  }

  if (item.title === 'Confirm tracking accuracy or test correction') {
    return ' Нажми «Добавить блок», если в трекинге пропуск, или «Трекинг верен», если всё честно.'
  }

  if (item.title === 'Review failed focus corrections') {
    return ' Проверь итоговую шкалу времени: нажми «Трекинг верен» или исправь её через «Добавить блок».'
  }

  if (isAcceptReviewAction(item.action)) {
    return ` Нажми «${actionLabel}», если данные уже честные.`
  }

  if (item.secondaryActions?.length) {
    const labels = [actionLabel, ...item.secondaryActions.map((action) => formatReviewActionLabel(action))]
    return ` Нажми ${formatQuotedListRu(labels)}.`
  }

  if (item.action === 'stage_day_context') {
    return ` Нажми «${actionLabel}», допиши одну фразу и нажми «Добавить» в строке события дня.`
  }

  return ` Нажми «${actionLabel}».`
}

function formatQuotedListRu(labels: string[]) {
  const quoted = labels.map((label) => `«${label}»`)
  if (quoted.length <= 1) return quoted[0] ?? ''
  if (quoted.length === 2) return `${quoted[0]} или ${quoted[1]}`
  return `${quoted.slice(0, -1).join(', ')} или ${quoted[quoted.length - 1]}`
}

function formatNextStepBlockerHint(item: DayReviewItem) {
  if (item.title === 'Stop the active focus block') {
    return ' Нажми «Стоп» у активного фокуса.'
  }

  if (item.title === 'Clear active Work Item state') {
    return ' Нажми «Снять активность», если фокус уже остановлен.'
  }

  return ''
}

function appendReviewChecklistGroup(lines: string[], title: string, items: DayReviewItem[]) {
  if (items.length === 0) return
  if (lines.length > 2 && lines[lines.length - 1] !== '') {
    lines.push('')
  }

  lines.push(`### ${title}`, '')

  for (const item of items) {
    const marker = item.level === 'ok' ? '[x]' : '[ ]'
    const label = formatDayReviewItem(item)
    const suffix = label.detail ? ` - ${formatMarkdownListText(label.detail)}` : ''
    const actionHint = formatChecklistActionHint(item)
    lines.push(`- ${marker} ${formatMarkdownListText(label.title)}${suffix}${actionHint}`)
  }
}

function appendBulkAcceptAsIsHint(lines: string[], items: DayReviewItem[]) {
  const bulkAccepts = getBulkAcceptableReviewActions(items)
  if (bulkAccepts.length === 0) return

  if (lines.length > 0 && lines[lines.length - 1] !== '') {
    lines.push('')
  }
  lines.push(
    `- Подсказка: ${formatCount(bulkAccepts.length, 'проверочный пункт', 'проверочных пункта', 'проверочных пунктов')} можно закрыть одной кнопкой «Всё проверено», если данные уже честные.`
  )
}

function formatChecklistActionHint(item: DayReviewItem) {
  const hint = formatReviewItemActionHint(item)
  return hint ? `. ${hint}` : ''
}

export function formatReviewItemActionHint(item: DayReviewItem) {
  if (item.level === 'ok') return ''

  return formatNextStepHint(item).trim()
}

function formatDailyControlGoalAuditMarkdown({
  activeFocus,
  activeWorkItems,
  openCaptures,
  captureActivity,
  todayMarkdown,
  appTelemetryMarkdown,
  reviewItems,
}: {
  activeFocus?: FocusSessionView
  activeWorkItems: WorkItemView[]
  openCaptures: CaptureView[]
  captureActivity: CaptureView[]
  todayMarkdown: string
  appTelemetryMarkdown: string
  reviewItems: DayReviewItem[]
}) {
  const hasReview = (title: string) => reviewItems.some((item) => item.title === title)
  const hasFocusBlocks = todayMarkdown.includes('| Time | Duration | Zone | Work Item | Note |')
  const totalTracked = extractLineValue(todayMarkdown, 'Total tracked') ?? 'n/a'
  const workingOccupancy = extractLineValue(todayMarkdown, 'Working occupancy') ?? extractLineValue(todayMarkdown, 'Work focus') ?? 'n/a'
  const workFocus = extractLineValue(todayMarkdown, 'Executive work') ?? extractLineValue(todayMarkdown, 'Work focus') ?? 'n/a'
  const nonWorkTracked = extractLineValue(todayMarkdown, 'Non-work tracked') ?? 'n/a'
  const entrances = extractLineValue(todayMarkdown, 'Entrances') ?? '0'
  const windowEvidence = extractLineValue(appTelemetryMarkdown, 'Window shown/hidden') ?? 'n/a'
  const windowRequestEvidence = extractLineValue(appTelemetryMarkdown, 'Window show/hide requests') ?? 'n/a'
  const apiErrors = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'API errors'))
  const copyFailures = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'Copy failures'))
  const startStopFailures = extractLineValue(appTelemetryMarkdown, 'Start/stop failures') ?? 'n/a'
  const entryPathEvidence = extractLineValue(appTelemetryMarkdown, 'Typed/selected/dispatch entry requests')
    ?? extractLineValue(appTelemetryMarkdown, 'Typed/selected entry requests')
    ?? 'n/a'
  const entryTelemetry = parseEntryTelemetryMarkdown(appTelemetryMarkdown)
  const captureFollowupReviews = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'Capture follow-up reviews'))
  const dayContextReviews = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'Day context reviews'))
  const workItemTimeBadgeReviews = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'Work Item time badge reviews'))
  const activityZoneGlances = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'Activity Zone glances'))
  const activityZoneReviews = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'Activity Zone reviews'))
  const captureUsageReviews = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'Capture usage reviews'))
  const entryPathReviews = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'Entry path reviews'))
  const windowEntrypointReviews = parseLeadingNumber(extractLineValue(appTelemetryMarkdown, 'Window entrypoint reviews'))
  const closureCounts = parseCountPair(extractLineValue(appTelemetryMarkdown, 'Day closure started/completed'))
  const lastClosureDuration = parseDurationSeconds(extractLineValue(appTelemetryMarkdown, 'Last day closure duration'))
  const telemetryAvailable = appTelemetryMarkdown.includes('Total events:')
  const entryPathsCovered =
    entryTelemetry &&
    entryTelemetry.typedEntryRequests > 0 &&
    entryTelemetry.selectedEntryRequests > 0 &&
    entryTelemetry.dispatchRitualEntryRequests > 0 &&
    entryTelemetry.stopRequests > 0
  const windowRequestPair = parseCountPair(windowRequestEvidence)
  const windowRequestsCovered = Boolean(windowRequestPair && windowRequestPair.left > 0 && windowRequestPair.right > 0)
  const correctionTelemetry = parseCorrectionTelemetryMarkdown(appTelemetryMarkdown)
  const workItemTimeReviewEvidence = workItemTimeBadgeReviews > 0
    ? formatCount(workItemTimeBadgeReviews, 'проверка времени по карточкам', 'проверки времени по карточкам', 'проверок времени по карточкам')
    : hasReview('Confirm Work Item today/total badges')
      ? 'проверка времени по карточкам не отмечена'
      : 'время по делам есть в отчёте'
  const activityZoneReviewEvidence = activityZoneReviews > 0
    ? formatCount(activityZoneReviews, 'проверка зон', 'проверки зон', 'проверок зон')
    : hasReview('Review Activity Zone coverage') || hasReview('Confirm non-work tracked time') || hasReview('Check zones during the day')
      ? 'проверка зон не отмечена'
      : 'зоны подтверждены отчётом'
  const activityZoneGlanceEvidence = activityZoneGlances > 0
    ? formatCount(activityZoneGlances, 'дневной просмотр зон', 'дневных просмотра зон', 'дневных просмотров зон')
    : hasReview('Check zones during the day')
      ? 'дневные просмотры зон не отмечены'
      : 'дневные просмотры зон не требовались'
  const entryPathReviewEvidence = entryPathReviews > 0
    ? formatCount(entryPathReviews, 'проверка пути входа', 'проверки путей входа', 'проверок путей входа')
    : entryPathsCovered
      ? 'пути входа покрыты телеметрией'
      : 'пути входа не проверены'
  const windowEntrypointReviewEvidence = windowEntrypointReviews > 0
    ? formatCount(windowEntrypointReviews, 'проверка окна', 'проверки окна', 'проверок окна')
    : windowRequestsCovered
      ? 'входы через окно покрыты телеметрией'
      : 'входы через окно не проверены'
  const workItemTotalsEvidence = todayMarkdown.includes('## By Work Item')
    ? `раздел «По делам» есть; ${workItemTimeReviewEvidence}`
    : 'раздела «По делам» нет'
  const activityZoneEvidence = `${workingOccupancy} рабочая занятость, ${workFocus} исполнение, ${nonWorkTracked} вне работы; ${activityZoneGlanceEvidence}; ${activityZoneReviewEvidence}`
  const gapsAndCapturesEvidence = [
    todayMarkdown.includes('## Gaps >=') ? 'раздел разрывов есть' : 'больших разрывов нет',
    openCaptures.length > 0
      ? formatCount(openCaptures.length, 'открытое отвлечение', 'открытых отвлечения', 'открытых отвлечений')
      : 'открытых отвлечений нет',
    captureActivity.length > 0
      ? formatCount(captureActivity.length, 'отвлечение за день', 'отвлечения за день', 'отвлечений за день')
      : 'отвлечений за день нет',
    formatReviewEvidence(captureFollowupReviews, 'открытые отвлечения не проверены', 'проверка открытых отвлечений', 'проверки открытых отвлечений', 'проверок открытых отвлечений'),
    formatReviewEvidence(captureUsageReviews, 'инбокс не проверен', 'проверка инбокса', 'проверки инбокса', 'проверок инбокса'),
  ].join('; ')
  const windowEvidenceText = [
    formatWindowVisibilityEvidence(windowEvidence),
    formatWindowRequestEvidence(windowRequestEvidence),
    windowEntrypointReviewEvidence,
    apiErrors > 0 ? formatCount(apiErrors, 'ошибка API', 'ошибки API', 'ошибок API') : 'ошибок API нет',
    formatStartStopFailureEvidence(startStopFailures),
  ].join('; ')
  const entryPathEvidenceText = entryTelemetry
    ? [
        formatCount(entryTelemetry.typedEntryRequests, 'старт вводом', 'старта вводом', 'стартов вводом'),
        formatCount(entryTelemetry.selectedEntryRequests, 'старт из списка', 'старта из списка', 'стартов из списка'),
        formatCount(entryTelemetry.dispatchRitualEntryRequests, 'старт через диспетчеризацию', 'старта через диспетчеризацию', 'стартов через диспетчеризацию'),
        formatCount(entryTelemetry.stopRequests, 'остановка', 'остановки', 'остановок'),
        entryPathReviewEvidence,
      ].join('; ')
    : 'пути входа: нет телеметрии'
  const correctionEvidenceText = formatCorrectionEvidence(correctionTelemetry)
  const closureEvidenceText = formatClosureEvidence(closureCounts, lastClosureDuration)
  const rows = [
    {
      requirement: 'Final state clean',
      status: activeFocus || activeWorkItems.length > 0 ? 'block' : 'pass',
      evidence: `${formatCount(activeFocus ? 1 : 0, 'активный фокус-блок', 'активных фокус-блока', 'активных фокус-блоков')}, ${formatCount(activeWorkItems.length, 'дело', 'дела', 'дел')} с активным статусом`,
    },
    {
      requirement: 'Focus blocks visible',
      status: hasFocusBlocks ? 'pass' : 'block',
      evidence: `${formatCount(Number(entrances), 'вход', 'входа', 'входов')}, ${totalTracked} учтено`,
    },
    {
      requirement: 'Work Item totals available',
      status: todayMarkdown.includes('## By Work Item') && !hasReview('Confirm Work Item today/total badges') ? 'pass' : 'review',
      evidence: workItemTotalsEvidence,
    },
    {
      requirement: 'Activity Zones separated',
      status:
        hasFocusBlocks &&
        ((!hasReview('Review Activity Zone coverage') && !hasReview('Confirm non-work tracked time') && !hasReview('Check zones during the day')) ||
          activityZoneReviews > 0)
          ? 'pass'
          : 'review',
      evidence: activityZoneEvidence,
    },
    {
      requirement: 'Day and Work Item context present',
      status: hasReview('No day or Work Item notes/events') && dayContextReviews === 0 ? 'review' : 'pass',
      evidence: [
        todayMarkdown.includes('## Day Events') ? 'события дня' : '',
        todayMarkdown.includes('## Work Item Events') ? 'события дел' : '',
        todayMarkdown.includes('## Work Item Notes') ? 'заметки дел' : '',
        dayContextReviews > 0 ? formatReviewEvidence(dayContextReviews, '', 'проверка контекста', 'проверки контекста', 'проверок контекста') : '',
      ].filter(Boolean).join(', ') || 'контекстных секций нет',
    },
    {
      requirement: 'Gaps and captures visible',
      status:
        hasReview('Classify significant gaps') ||
        (hasReview('Capture Inbox untested today') && captureUsageReviews === 0) ||
        (hasReview('Captures were not linked to active focus') && captureUsageReviews === 0) ||
        hasReview('Resolve, convert, or accept open captures')
          ? 'review'
          : 'pass',
      evidence: gapsAndCapturesEvidence,
    },
    {
      requirement: 'Window and menubar friction evidenced',
      status:
        !telemetryAvailable ||
        apiErrors > 0 ||
        copyFailures > 0 ||
        startStopFailures !== '0/0' ||
        (hasReview('Test window entrypoints') && windowEntrypointReviews === 0)
          ? 'review'
          : 'pass',
      evidence: windowEvidenceText,
    },
    {
      requirement: 'Start and continue paths evidenced',
      status:
        !telemetryAvailable ||
        !entryTelemetry ||
        (!entryPathsCovered && entryPathReviews === 0) ||
        entryPathEvidence === 'n/a'
          ? 'review'
          : 'pass',
      evidence: entryPathEvidenceText,
    },
    {
      requirement: 'Tracking correction or review evidenced',
      status:
        hasReview('Confirm tracking accuracy or test correction') ||
        hasReview('Review failed focus corrections')
          ? 'review'
          : 'pass',
      evidence: correctionEvidenceText,
    },
    {
      requirement: 'Day closure duration measured',
      status:
        closureCounts?.right && lastClosureDuration != null && lastClosureDuration <= 10 * 60
          ? 'pass'
          : 'review',
      evidence: closureEvidenceText,
    },
    {
      requirement: 'Hard blockers absent',
      status: reviewItems.some((item) => item.level === 'blocker') ? 'block' : 'pass',
      evidence: formatCount(reviewItems.filter((item) => item.level === 'blocker').length, 'красный пункт', 'красных пункта', 'красных пунктов'),
    },
  ]

  return [
    '## Проверка закрытия дня',
    '',
    '| Проверка | Статус | Доказательство |',
    '| --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${escapeMarkdownTable(formatDailyControlRequirement(row.requirement))} | ${escapeMarkdownTable(formatDailyControlStatus(row.status))} | ${escapeMarkdownTable(row.evidence)} |`
    ),
  ].join('\n')
}

function formatDailyControlRequirement(requirement: string) {
  return DAILY_CONTROL_REQUIREMENT_LABELS[requirement] ?? requirement
}

function formatDailyControlStatus(status: string) {
  return DAILY_CONTROL_STATUS_LABELS[status] ?? status
}

function extractLineValue(markdown: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = markdown.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, 'm'))
  return match?.[1]?.trim()
}

function parseLeadingNumber(value?: string) {
  if (!value) return 0
  const match = value.match(/^\d+/)
  return match ? Number(match[0]) : 0
}

function parseEntryTelemetryMarkdown(markdown: string) {
  const entryMatch = markdown.match(/Typed\/selected\/dispatch entry requests:\s*(\d+)\/(\d+)\/(\d+)/)
    ?? markdown.match(/Typed\/selected entry requests:\s*(\d+)\/(\d+)/)
  const stopMatch = markdown.match(/Stop requests:\s*(\d+)/)
  if (!entryMatch || !stopMatch) return undefined

  return {
    typedEntryRequests: Number(entryMatch[1]),
    selectedEntryRequests: Number(entryMatch[2]),
    dispatchRitualEntryRequests: entryMatch[3] == null ? 0 : Number(entryMatch[3]),
    stopRequests: Number(stopMatch[1]),
  }
}

function parseCountPair(value?: string) {
  const match = value?.match(/^(\d+)\/(\d+)/)
  if (!match) return undefined

  return {
    left: Number(match[1]),
    right: Number(match[2]),
  }
}

function formatReviewEvidence(value: number, emptyText: string, one: string, few: string, many: string) {
  return value > 0 ? formatCount(value, one, few, many) : emptyText
}

function formatWindowVisibilityEvidence(value: string) {
  const pair = parseCountPair(value)
  if (!pair) return 'окно: нет телеметрии'

  return `окно показывалось ${pair.left} раз, скрывалось ${pair.right} раз`
}

function formatWindowRequestEvidence(value: string) {
  const pair = parseCountPair(value)
  if (!pair) return 'запросов показать или скрыть окно: нет данных'

  return `${formatCount(pair.left, 'запрос на показ', 'запроса на показ', 'запросов на показ')}, ${formatCount(pair.right, 'запрос на скрытие', 'запроса на скрытие', 'запросов на скрытие')}`
}

function formatStartStopFailureEvidence(value: string) {
  const pair = parseCountPair(value)
  if (!pair) return 'ошибок старта и остановки: нет данных'
  if (pair.left + pair.right === 0) return 'ошибок старта и остановки нет'

  return `${formatCount(pair.left, 'ошибка старта', 'ошибки старта', 'ошибок старта')}, ${formatCount(pair.right, 'ошибка остановки', 'ошибки остановки', 'ошибок остановки')}`
}

function parseCorrectionTelemetryMarkdown(markdown: string) {
  const match = markdown.match(/Corrections requested\/applied\/reviewed\/failed:\s*(\d+)\/(\d+)\/(\d+)\/(\d+)/)
  if (!match) return undefined

  return {
    requested: Number(match[1]),
    applied: Number(match[2]),
    reviewed: Number(match[3]),
    failures: Number(match[4]),
  }
}

function formatCorrectionEvidence(
  telemetry?: { requested: number; applied: number; reviewed: number; failures: number }
) {
  if (!telemetry) return 'коррекции трекинга: нет телеметрии'
  const parts = [
    telemetry.requested > 0
      ? formatCount(telemetry.requested, 'запрос коррекции', 'запроса коррекции', 'запросов коррекции')
      : 'запросов коррекции не было',
    telemetry.applied > 0
      ? formatCount(telemetry.applied, 'применённая коррекция', 'применённые коррекции', 'применённых коррекций')
      : 'коррекций не было',
    formatReviewEvidence(telemetry.reviewed, 'проверка трекинга не отмечена', 'проверка трекинга', 'проверки трекинга', 'проверок трекинга'),
    telemetry.failures > 0
      ? formatCount(telemetry.failures, 'ошибка коррекции', 'ошибки коррекции', 'ошибок коррекции')
      : 'ошибок коррекции нет',
  ]

  return parts.join('; ')
}

function formatClosureEvidence(
  closureCounts: { left: number; right: number } | undefined,
  lastClosureDuration?: number
) {
  if (!closureCounts || (closureCounts.left === 0 && closureCounts.right === 0)) {
    return 'закрытие дня ещё не измерялось'
  }

  const durationText = lastClosureDuration == null ? 'длительность пока не зафиксирована' : `длительность ${formatDuration(lastClosureDuration)}`
  return `закрытие начато ${closureCounts.left} раз, завершено ${closureCounts.right} раз; ${durationText}`
}

function parseDurationSeconds(value?: string) {
  if (!value || value === 'n/a') return undefined
  const parts = value.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return undefined

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]
  }

  return undefined
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

function noteEventsOnly(events: WorkItemEventView[]) {
  return events
    .filter((event) => event.kind === 'note_added' && event.text?.trim())
    .sort((left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime())
}

function noteDayEventsOnly(events: DayEventView[]) {
  return events
    .filter((event) => event.kind === 'note_added' && event.text?.trim())
    .sort((left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime())
}

function DayEventsPanel({
  events,
  sessions,
}: {
  events: DayEventView[]
  sessions: FocusSessionView[]
}) {
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [editingZone, setEditingZone] = useState<ActivityZone | ''>('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const updateEventMutation = useUpdateDayEvent()
  const deleteEventMutation = useDeleteDayEvent()
  const ordered = [...events].sort((left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime())
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  const mutationError = updateEventMutation.error || deleteEventMutation.error

  const startEditing = (event: DayEventView) => {
    setEditingEventId(event.id)
    setEditingText(event.text)
    setEditingZone(event.activity_zone ?? '')
    setDeleteConfirmId(null)
  }

  const saveEditing = () => {
    const trimmed = editingText.trim()
    if (!editingEventId || !trimmed || updateEventMutation.isPending) return

    updateEventMutation.mutate(
      { id: editingEventId, text: trimmed, activity_zone: editingZone || null },
      {
        onSuccess: () => {
          setEditingEventId(null)
          setEditingText('')
          setEditingZone('')
        },
      }
    )
  }

  const deleteEvent = (eventId: string) => {
    if (deleteEventMutation.isPending) return

    deleteEventMutation.mutate(eventId, {
      onSuccess: () => {
        setDeleteConfirmId(null)
        if (editingEventId === eventId) {
          setEditingEventId(null)
          setEditingText('')
          setEditingZone('')
        }
      },
    })
  }

  return (
    <div className="grid gap-1 rounded-md border border-gray-800 bg-gray-900/50 px-3 py-2 text-xs">
      <div className="flex items-center justify-between text-gray-400">
        <span className="font-medium text-gray-300">События дня</span>
        <span>{events.length}</span>
      </div>
      <div className="grid max-h-28 gap-1 overflow-auto pr-1">
        {ordered.map((event) => {
          const isEditing = editingEventId === event.id
          const isDeleteConfirming = deleteConfirmId === event.id

          return (
            <div key={event.id} className="grid gap-1 rounded border border-gray-800/80 bg-gray-950/30 px-2 py-1 text-gray-300">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
                <span className="font-mono text-gray-500">{formatClockTime(event.ts)}</span>
                <span className="min-w-0 truncate">
                  <span>{truncate(event.text, 90)}</span>
                  <span className="text-gray-500"> · </span>
                  <span className="text-gray-500">
                    {event.activity_zone ? formatActivityZoneLabel(event.activity_zone) : 'Без зоны'}
                  </span>
                  <span className="text-gray-500"> · </span>
                  <span className="text-gray-500">{truncate(formatDayEventDuring(event, sessionsById), 40)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEditing(event)}
                    className="rounded border border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-300 hover:border-gray-500 hover:text-gray-100"
                  >
                    Править
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirmId(isDeleteConfirming ? null : event.id)
                      setEditingEventId(null)
                    }}
                    className="rounded border border-red-900/80 px-1.5 py-0.5 text-[11px] text-red-200 hover:border-red-600"
                  >
                    Удалить
                  </button>
                </span>
              </div>

              {isEditing && (
                <div className="grid gap-1">
                  <textarea
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault()
                        saveEditing()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setEditingEventId(null)
                        setEditingText('')
                      }
                    }}
                    rows={2}
                    className="w-full resize-none rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                  <select
                    value={editingZone}
                    onChange={(event) => setEditingZone(event.target.value as ActivityZone | '')}
                    className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Без зоны</option>
                    {ACTIVITY_ZONES.map((zone) => (
                      <option key={zone} value={zone}>
                        {formatActivityZoneLabel(zone)}
                      </option>
                    ))}
                  </select>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEventId(null)
                        setEditingText('')
                        setEditingZone('')
                      }}
                      className="rounded px-2 py-0.5 text-[11px] text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={saveEditing}
                      disabled={!editingText.trim() || updateEventMutation.isPending}
                      className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
                    >
                      Сохранить
                    </button>
                  </div>
                </div>
              )}

              {isDeleteConfirming && (
                <div className="flex items-center justify-end gap-1 text-[11px] text-red-200">
                  <span>Удалить событие дня?</span>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(null)}
                    className="rounded border border-gray-700 px-1.5 py-0.5 text-gray-300 hover:border-gray-500"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteEvent(event.id)}
                    disabled={deleteEventMutation.isPending}
                    className="rounded border border-red-700 px-1.5 py-0.5 text-red-100 hover:border-red-500 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500"
                  >
                    Удалить
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {mutationError && (
        <div className="text-[11px] text-red-300">
          {mutationError instanceof Error ? mutationError.message : 'Не удалось обновить событие дня'}
        </div>
      )}
    </div>
  )
}

function WorkItemEventsPanel({
  events,
  workItems,
  sessions,
}: {
  events: WorkItemEventView[]
  workItems: WorkItemView[]
  sessions: FocusSessionView[]
}) {
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const updateEventMutation = useUpdateWorkItemEvent()
  const deleteEventMutation = useDeleteWorkItemEvent()
  const ordered = [...events]
    .sort((left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime())
  const workItemsById = new Map(workItems.map((item) => [item.id, item]))
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  const mutationError = updateEventMutation.error || deleteEventMutation.error

  const startEditing = (event: WorkItemEventView) => {
    setEditingEventId(event.id)
    setEditingText(event.text ?? '')
    setDeleteConfirmId(null)
  }

  const saveEditing = () => {
    const trimmed = editingText.trim()
    if (!editingEventId || !trimmed || updateEventMutation.isPending) return

    updateEventMutation.mutate(
      { id: editingEventId, text: trimmed },
      {
        onSuccess: () => {
          setEditingEventId(null)
          setEditingText('')
        },
      }
    )
  }

  const deleteEvent = (eventId: string) => {
    if (deleteEventMutation.isPending) return

    deleteEventMutation.mutate(eventId, {
      onSuccess: () => {
        setDeleteConfirmId(null)
        if (editingEventId === eventId) {
          setEditingEventId(null)
          setEditingText('')
        }
      },
    })
  }

  return (
    <div className="grid gap-1 rounded-md border border-gray-800 bg-gray-900/50 px-3 py-2 text-xs">
      <div className="flex items-center justify-between text-gray-400">
        <span className="font-medium text-gray-300">События дел</span>
        <span>{events.length}</span>
      </div>
      <div className="grid max-h-32 gap-1 overflow-auto pr-1">
        {ordered.map((event) => {
          const isEditing = editingEventId === event.id
          const isDeleteConfirming = deleteConfirmId === event.id

          return (
            <div key={event.id} className="grid gap-1 rounded border border-gray-800/80 bg-gray-950/30 px-2 py-1 text-gray-300">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
                <span className="font-mono text-gray-500">{formatClockTime(event.ts)}</span>
                <span className="min-w-0 truncate">
                  <span className="font-medium text-gray-200">{truncate(formatEventWorkItemTitle(event, workItemsById, sessionsById), 40)}</span>
                  {event.evidence && (
                    <span className="ml-2 rounded border border-emerald-800/80 px-1 py-0.5 text-[10px] uppercase text-emerald-300">
                      {formatEvidenceKindLabel(event.evidence.kind)}
                    </span>
                  )}
                  <span className="text-gray-500"> · </span>
                  <span>{truncate(event.text ?? '', 80)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEditing(event)}
                    className="rounded border border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-300 hover:border-gray-500 hover:text-gray-100"
                  >
                    Править
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirmId(isDeleteConfirming ? null : event.id)
                      setEditingEventId(null)
                    }}
                    className="rounded border border-red-900/80 px-1.5 py-0.5 text-[11px] text-red-200 hover:border-red-600"
                  >
                    Удалить
                  </button>
                </span>
              </div>

              {(event.evidence?.refs.length ?? 0) > 0 && (
                <div className="truncate pl-14 text-[11px] text-cyan-300">
                  evidence: {event.evidence?.refs.map((ref) => `${ref.kind}: ${ref.value}`).join(' · ')}
                </div>
              )}

              {isEditing && (
                <div className="grid gap-1">
                  <textarea
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault()
                        saveEditing()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setEditingEventId(null)
                        setEditingText('')
                      }
                    }}
                    rows={2}
                    className="w-full resize-none rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEventId(null)
                        setEditingText('')
                      }}
                      className="rounded px-2 py-0.5 text-[11px] text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={saveEditing}
                      disabled={!editingText.trim() || updateEventMutation.isPending}
                      className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
                    >
                      Сохранить
                    </button>
                  </div>
                </div>
              )}

              {isDeleteConfirming && (
                <div className="flex items-center justify-end gap-1 text-[11px] text-red-200">
                  <span>Удалить событие?</span>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(null)}
                    className="rounded border border-gray-700 px-1.5 py-0.5 text-gray-300 hover:border-gray-500"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteEvent(event.id)}
                    disabled={deleteEventMutation.isPending}
                    className="rounded border border-red-700 px-1.5 py-0.5 text-red-100 hover:border-red-500 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500"
                  >
                    Удалить
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {mutationError && (
        <div className="text-[11px] text-red-300">
          {mutationError instanceof Error ? mutationError.message : 'Не удалось обновить событие дела'}
        </div>
      )}
    </div>
  )
}

function formatCaptureActivityMarkdown(
  captures: CaptureView[],
  sessions: FocusSessionView[],
  workItems: WorkItemView[]
) {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  const workItemsById = new Map(workItems.map((item) => [item.id, item]))
  const lines = [
    '## История отвлечений',
    '',
    '| Время | Статус | Отвлечение | Во время | Итог |',
    '| --- | --- | --- | --- | --- |',
  ]

  for (const capture of captures) {
    lines.push(
      `| ${escapeMarkdownTable(formatClockTime(capture.created_at))} | ${escapeMarkdownTable(formatCaptureState(capture.state))} | ${escapeMarkdownTable(capture.text)} | ${escapeMarkdownTable(formatCaptureDuring(capture, sessionsById))} | ${escapeMarkdownTable(formatCaptureOutcome(capture, workItemsById))} |`
    )
  }

  return `${lines.join('\n')}\n`
}

function formatCaptureDuring(capture: CaptureView, sessionsById: Map<string, FocusSessionView>) {
  if (!capture.focus_session_id) {
    return 'без активного фокуса'
  }

  const session = sessionsById.get(capture.focus_session_id)
  return session?.work_item_title ?? session?.title ?? 'связанный фокус-блок'
}

function formatCaptureOutcome(capture: CaptureView, workItemsById: Map<string, WorkItemView>) {
  if (capture.state === 'resolved') {
    return `закрыто ${formatClockTime(capture.resolved_at ?? capture.updated_at)}`
  }

  if (capture.state === 'converted') {
    const item = capture.work_item_id ? workItemsById.get(capture.work_item_id) : undefined
    const itemTitle = item ? ` -> ${item.title}` : ''
    return `создано ${formatClockTime(capture.converted_at ?? capture.updated_at)}${itemTitle}`
  }

  return 'открыто'
}

function formatCaptureState(state: CaptureView['state']) {
  const labels: Record<CaptureView['state'], string> = {
    open: 'открыто',
    resolved: 'закрыто',
    converted: 'превращено',
  }
  return labels[state] ?? state
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
      '## Телеметрия приложения',
      '',
      'Телеметрия недоступна в UI-отчёте. После дня запусти `pnpm dogfood:metrics`.',
    ].join('\n')
  }
}

async function loadAppEventSummary(now: Date) {
  try {
    const dayStart = startOfLocalDay(now)
    const dayEnd = nextLocalDay(dayStart)
    return await appEventApi.summary({
      from: dayStart.toISOString(),
      to: dayEnd.toISOString(),
    })
  } catch {
    return null
  }
}

function getOpenDayClosure(summary: AppEventSummary | null | undefined) {
  if (!summary?.open_day_closure_started_at || !summary.open_day_closure_action_id) {
    return undefined
  }

  const startedAt = new Date(summary.open_day_closure_started_at)
  if (Number.isNaN(startedAt.getTime())) {
    return undefined
  }

  return {
    actionId: summary.open_day_closure_action_id,
    startedAt,
  }
}

function formatAppTelemetryMarkdown(summary: AppEventSummary) {
  const latestCorrectionFailure = summary.latest_correction_failure_at
    ? [
        summary.latest_correction_failure_at,
        summary.latest_correction_failure_control ?? 'unknown',
        summary.latest_correction_failure_error_code ?? 'unknown',
      ].join(' · ')
    : 'n/a'
  const lines = [
    '## Телеметрия приложения',
    '',
    `Total events: ${summary.total}`,
    `Start requests: ${summary.start_requests}`,
    `Switch requests: ${summary.switch_requests}`,
    `Stop requests: ${summary.stop_requests}`,
    `Typed/selected/dispatch entry requests: ${summary.typed_entry_requests}/${summary.selected_entry_requests}/${summary.dispatch_ritual_entry_requests}`,
    `Start/stop failures: ${summary.start_failures}/${summary.stop_failures}`,
    `Window shown/hidden: ${summary.window_shown}/${summary.window_hidden}`,
    `Window show/hide requests: ${summary.window_show_requested}/${summary.window_hide_requested}`,
    `Window drag starts: ${summary.window_drag_started}`,
    `Copy failures: ${summary.copy_failures}`,
    `Manual copy fallbacks: ${summary.manual_copy_fallbacks}`,
    `Capture created/resolved/converted: ${summary.capture_created}/${summary.capture_resolved}/${summary.capture_converted}`,
    `Capture follow-up reviews: ${summary.capture_followup_reviews}`,
    `Day context reviews: ${summary.day_context_reviews}`,
    `Work Item time badge reviews: ${summary.work_item_time_badge_reviews}`,
    `Activity Zone glances: ${summary.activity_zone_glances}`,
    `Activity Zone reviews: ${summary.activity_zone_reviews}`,
    `Capture usage reviews: ${summary.capture_usage_reviews}`,
    `Entry path reviews: ${summary.entry_path_reviews}`,
    `Window entrypoint reviews: ${summary.window_entrypoint_reviews}`,
    `Capture updated/deleted: ${summary.capture_updated}/${summary.capture_deleted}`,
    `Capture failures create/resolve/update/delete/convert: ${summary.capture_create_failures}/${summary.capture_resolve_failures}/${summary.capture_update_failures}/${summary.capture_delete_failures}/${summary.capture_convert_failures}`,
    `Corrections requested/applied/reviewed/failed: ${summary.correction_requests}/${summary.corrections}/${summary.correction_reviews}/${summary.correction_failures}`,
    `Unreviewed correction failures: ${summary.unreviewed_correction_failures}`,
    `Latest correction failure: ${latestCorrectionFailure}`,
    `Day contract created/revised/start requests/starts/failures/reentries: ${summary.day_contract_created}/${summary.day_contract_revisions}/${summary.day_contract_start_requests}/${summary.day_contract_starts}/${summary.day_contract_start_failures}/${summary.day_contract_reentries}`,
    `Day closure started/completed: ${summary.day_closure_starts}/${summary.day_closure_completions}`,
    `Last day closure duration: ${summary.last_day_closure_duration_seconds == null ? 'n/a' : formatDuration(summary.last_day_closure_duration_seconds)}`,
    `API errors: ${summary.api_errors}`,
    `Already-active start attempts: ${summary.already_active_start_attempts}`,
    `Stale runtime recoveries: ${summary.stale_runtime_recoveries}`,
    `Average start latency: ${summary.average_focus_start_latency_ms == null ? 'n/a' : `${summary.average_focus_start_latency_ms}ms`}`,
    `Slow window-to-focus gaps: ${summary.slow_window_to_focus_count}`,
  ]

  const byKind = Object.entries(summary.by_kind)
  if (byKind.length > 0) {
    lines.push('', '### События по типам', '', '| Count | Kind |', '| ---: | --- |')
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

export type GapExplanationPreset = 'lost_control' | 'recovery'
export type GapClassification = 'recovery' | 'unmanaged' | 'idle' | 'explained'

export interface GapExplanation {
  classification: GapClassification
  text: string
}

export function formatGapDayEventDraft(gap: Gap, label = 'Разрыв', preset?: GapExplanationPreset) {
  const prefix = `${label} ${formatClockTime(gap.from)}-${formatClockTime(gap.to)} (${formatDuration(gap.seconds)}): `

  if (preset === 'lost_control') {
    return `${prefix}потеря управляемости; не удалось восстановить управляемость; необходимые дела воспринимались как недоступные.`
  }

  if (preset === 'recovery') {
    return `${prefix}восстановление/перерыв; рабочий контур был временно закрыт.`
  }

  return prefix
}

export function countGapExplanationTexts(dayEvents: Array<{ text?: string }>) {
  return dayEvents.filter((event) => isGapExplanationText(event.text)).length
}

export function countClassifiedGaps(gaps: Gap[], dayEvents: Array<{ text?: string; activity_zone?: ActivityZone }>) {
  return gaps.filter((gap) => Boolean(findGapExplanation(gap, dayEvents))).length
}

export function pickNextGapForReview(gaps: Gap[], dayEvents: Array<{ text?: string; activity_zone?: ActivityZone }>) {
  return gaps.find((gap) => !findGapExplanation(gap, dayEvents))
}

export function findGapExplanation(gap: Gap, dayEvents: Array<{ text?: string; activity_zone?: ActivityZone }>): GapExplanation | undefined {
  const event = dayEvents.find((item) => isGapExplanationText(item.text) && gapExplanationMatches(gap, item.text))
  if (!event?.text) return undefined

  return {
    classification: classifyGapExplanation(event),
    text: event.text,
  }
}

export function findOpenGapExplanation(dayEvents: Array<{ text?: string; activity_zone?: ActivityZone }>): GapExplanation | undefined {
  const event = [...dayEvents].reverse().find((item) => isOpenGapExplanationText(item.text))
  if (!event?.text) return undefined

  return {
    classification: classifyGapExplanation(event),
    text: event.text,
  }
}

export function classifyGapExplanation(event: { text?: string; activity_zone?: ActivityZone }): GapClassification {
  const text = (event.text ?? '').toLocaleLowerCase('ru-RU')

  if (text.includes('потеря управляемости') || text.includes('не удалось восстановить управляемость')) {
    return 'unmanaged'
  }

  if (event.activity_zone === 'recovery' || text.includes('восстанов') || text.includes('recovery')) {
    return 'recovery'
  }

  if (event.activity_zone === 'idle' || text.includes('простой') || text.includes('обед') || text.includes('ужин') || text.includes('быт')) {
    return 'idle'
  }

  return 'explained'
}

export function formatGapClassificationLabel(classification: GapClassification) {
  switch (classification) {
    case 'recovery':
      return 'восстановление'
    case 'unmanaged':
      return 'потеря управляемости'
    case 'idle':
      return 'простой'
    case 'explained':
      return 'объяснён'
  }
}

function isGapExplanationText(text: string | undefined) {
  return /\bopen\s+gap\b|\bgap\b|разрыв|перерыв|буфер|recovery|восстановлен/i.test(text ?? '')
}

export function isOpenGapExplanationText(text: string | undefined) {
  return /\bopen\s+gap\b|открыт[а-яё]*\s+разрыв/i.test(text ?? '')
}

function formatGapRange(gap: Gap) {
  return `${formatClockTime(gap.from)}-${formatClockTime(gap.to)}`
}

function gapExplanationMatches(gap: Gap, text: string | undefined) {
  if (!text) return false

  const exactRange = formatGapRange(gap)
  if (text.includes(exactRange)) return true

  const textRange = text.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)
  if (!textRange) return false

  const textStart = parseClockMinutes(textRange[1])
  const textEnd = parseClockMinutes(textRange[2])
  const gapStart = parseClockMinutes(formatClockTime(gap.from))
  const gapEnd = parseClockMinutes(formatClockTime(gap.to))
  if (textStart == null || textEnd == null || gapStart == null || gapEnd == null) return false

  const toleranceMinutes = 2
  return Math.abs(textStart - gapStart) <= toleranceMinutes && Math.abs(textEnd - gapEnd) <= toleranceMinutes
}

function parseClockMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return undefined

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined

  return hours * 60 + minutes
}

function appendDayContract(lines: string[], revisions: DayContractRevisionView[]) {
  lines.push('', '## Day Contract')
  if (revisions.length === 0) {
    lines.push('', 'No day contract was recorded.')
    return
  }

  lines.push(
    '',
    '| Revision | Time | Kind | Active | First Action | Parked | Why Now |',
    '| ---: | --- | --- | --- | --- | --- | --- |'
  )
  for (const revision of revisions) {
    lines.push(
      `| ${revision.revision_number} | ${escapeMarkdownTable(formatClockTime(revision.created_at))} | ${escapeMarkdownTable(revision.revision_kind)} | ${escapeMarkdownTable(revision.active_subjects.map((item) => item.title).join(' · '))} | ${escapeMarkdownTable(revision.first_action.title)} | ${escapeMarkdownTable(revision.parked_subjects.map((item) => item.title).join(' · '))} | ${escapeMarkdownTable(revision.why_now)} |`
    )
  }
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

function appendDayEvents(
  lines: string[],
  events: DayEventView[],
  sessions: FocusSessionView[]
) {
  const noteEvents = noteDayEventsOnly(events)
  if (noteEvents.length === 0) {
    return
  }

  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  lines.push('', '## Day Events', '', '| Time | Zone | During | Event |', '| --- | --- | --- | --- |')
  for (const event of noteEvents) {
    lines.push(
      `| ${escapeMarkdownTable(formatClockTime(event.ts))} | ${escapeMarkdownTable(event.activity_zone ? formatActivityZoneLabel(event.activity_zone) : '')} | ${escapeMarkdownTable(formatDayEventDuring(event, sessionsById))} | ${escapeMarkdownTable(event.text)} |`
    )
  }
}

function appendWorkItemEvents(
  lines: string[],
  events: WorkItemEventView[],
  sessions: FocusSessionView[],
  workItems: WorkItemView[]
) {
  const noteEvents = noteEventsOnly(events)
  if (noteEvents.length === 0) {
    return
  }

  const workItemsById = new Map(workItems.map((item) => [item.id, item]))
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  lines.push('', '## Work Item Events', '', '| Time | Work Item | During | Type | Event | Evidence |', '| --- | --- | --- | --- | --- | --- |')
  for (const event of noteEvents) {
    const refs = event.evidence?.refs.map((ref) => `${ref.kind}: ${ref.value}`).join('; ') ?? ''
    lines.push(
      `| ${escapeMarkdownTable(formatClockTime(event.ts))} | ${escapeMarkdownTable(formatEventWorkItemTitle(event, workItemsById, sessionsById))} | ${escapeMarkdownTable(formatEventDuring(event, sessionsById))} | ${escapeMarkdownTable(event.evidence ? formatEvidenceKindLabel(event.evidence.kind) : 'legacy')} | ${escapeMarkdownTable(event.text ?? '')} | ${escapeMarkdownTable(refs)} |`
    )
  }
}

function formatDayEventDuring(event: DayEventView, sessionsById: Map<string, FocusSessionView>) {
  if (!event.focus_session_id) {
    return 'день'
  }

  const session = sessionsById.get(event.focus_session_id)
  return session?.work_item_title ?? session?.title ?? 'связанный фокус-блок'
}

function formatEventWorkItemTitle(
  event: WorkItemEventView,
  workItemsById: Map<string, WorkItemView>,
  sessionsById: Map<string, FocusSessionView>
) {
  return workItemsById.get(event.work_item_id)?.title
    ?? (event.focus_session_id ? sessionsById.get(event.focus_session_id)?.work_item_title : undefined)
    ?? (event.focus_session_id ? sessionsById.get(event.focus_session_id)?.title : undefined)
    ?? 'неизвестное дело'
}

function formatEvidenceKindLabel(kind: string) {
  return {
    result: 'результат',
    decision: 'решение',
    blocker: 'блокер',
    next_step: 'следующий шаг',
    observation: 'наблюдение',
  }[kind] ?? kind
}

function formatEventDuring(event: WorkItemEventView, sessionsById: Map<string, FocusSessionView>) {
  if (!event.focus_session_id) {
    return ''
  }

  const session = sessionsById.get(event.focus_session_id)
  return session?.work_item_title ?? session?.title ?? 'связанный фокус-блок'
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

function formatActivityZoneLabel(zone: ActivityZone) {
  return formatActivityZoneBadge(zone)
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

export function buildTrayStatusTitle(session: FocusSessionView | undefined, now: Date, activeSecondsTotal = 0) {
  if (!session || session.state !== 'active') {
    return activeSecondsTotal > 0 ? `${formatTrayDuration(activeSecondsTotal)} сегодня` : undefined
  }

  const elapsedSeconds = Math.max(
    session.active_seconds,
    Math.floor((now.getTime() - new Date(session.started_at).getTime()) / 1000)
  )
  const overTargetSeconds = Math.max(0, elapsedSeconds - session.target_seconds)
  const elapsed = formatTrayDuration(elapsedSeconds)
  if (overTargetSeconds > 0) {
    return `${elapsed} в фокусе +${formatTrayDuration(overTargetSeconds)}`
  }

  return `${elapsed} в фокусе`
}

function formatTrayDuration(totalSeconds: number) {
  const minutes = Math.max(Math.floor(totalSeconds / 60), 0)
  if (minutes < 60) {
    return `${minutes} мин`
  }

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`
}

function ActiveFocusJournal({
  inputRef,
  text,
  kind,
  target,
  hasWorkItem,
  refs,
  refChoice,
  newRefKind,
  newRefValue,
  pending,
  placeholder,
  onTextChange,
  onKindChange,
  onTargetChange,
  onRefChoiceChange,
  onNewRefKindChange,
  onNewRefValueChange,
  onSubmit,
}: {
  inputRef: RefObject<HTMLInputElement>
  text: string
  kind: ActiveFocusJournalKind
  target: ActiveFocusJournalTarget
  hasWorkItem: boolean
  refs: WorkItemView['refs']
  refChoice: string
  newRefKind: RefKind
  newRefValue: string
  pending: boolean
  placeholder: string
  onTextChange: (value: string) => void
  onKindChange: (value: ActiveFocusJournalKind) => void
  onTargetChange: (value: ActiveFocusJournalTarget) => void
  onRefChoiceChange: (value: string) => void
  onNewRefKindChange: (value: RefKind) => void
  onNewRefValueChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="grid gap-2 rounded-md border border-emerald-900/70 bg-emerald-950/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onSubmit()
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded border border-emerald-900/70 bg-gray-950 px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
        <select
          value={kind}
          onChange={(event) => onKindChange(event.target.value as ActiveFocusJournalKind)}
          className="w-32 rounded border border-emerald-900/70 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          title="Тип записи"
        >
          {Object.entries(ACTIVE_FOCUS_JOURNAL_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={target}
          onChange={(event) => onTargetChange(event.target.value as ActiveFocusJournalTarget)}
          disabled={!hasWorkItem}
          className="w-24 rounded border border-emerald-900/70 bg-gray-950 px-2 py-1.5 text-xs text-gray-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
          title="Куда сохранить"
        >
          {Object.entries(ACTIVE_FOCUS_JOURNAL_TARGET_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!text.trim() || pending}
          className="rounded border border-emerald-700 px-2 py-1.5 text-xs font-medium text-emerald-200 hover:border-emerald-400 hover:text-emerald-100 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
        >
          Записать
        </button>
      </div>
      {hasWorkItem && target === 'work_item' && (
        <div className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-gray-500">Подтверждение</span>
          <select
            value={refChoice}
            onChange={(event) => onRefChoiceChange(event.target.value)}
            className="min-w-0 flex-1 rounded border border-emerald-950 bg-gray-950 px-2 py-1 text-gray-300 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Без Ref</option>
            {refs.map((ref) => (
              <option key={ref.id} value={ref.id}>{ref.kind}: {ref.value}</option>
            ))}
            <option value={ACTIVE_FOCUS_JOURNAL_NEW_REF}>Новый Ref...</option>
          </select>
          {refChoice === ACTIVE_FOCUS_JOURNAL_NEW_REF && (
            <>
              <select
                value={newRefKind}
                onChange={(event) => onNewRefKindChange(event.target.value as RefKind)}
                className="w-28 rounded border border-emerald-950 bg-gray-950 px-2 py-1 text-gray-300 focus:border-emerald-500"
                title="Тип нового Ref"
              >
                <option value="url">URL</option>
                <option value="file_path">Файл</option>
                <option value="issue_key">Ключ задачи</option>
                <option value="custom">Другое</option>
              </select>
              <input
                value={newRefValue}
                onChange={(event) => onNewRefValueChange(event.target.value)}
                placeholder="URL, путь или ключ"
                className="min-w-0 flex-[2] rounded border border-emerald-950 bg-gray-950 px-2 py-1 text-gray-200 placeholder-gray-600 focus:border-emerald-500"
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ActiveFocusSession({
  session,
  note,
  setNote,
  result,
  setResult,
  stateChange,
  setStateChange,
  nextAction,
  setNextAction,
  onStop,
  stopping,
}: {
  session: FocusSessionView
  note: string
  setNote: (value: string) => void
  result: string
  setResult: (value: string) => void
  stateChange: string
  setStateChange: (value: string) => void
  nextAction: string
  setNextAction: (value: string) => void
  onStop: () => void
  stopping: boolean
}) {
  const progress = Math.min((session.active_seconds / session.target_seconds) * 100, 100)
  const isOverTarget = session.over_target_seconds > 0

  return (
    <div className="grid gap-2 rounded border border-emerald-900/70 bg-emerald-950/25 px-3 py-2 shadow-inner shadow-emerald-950/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-emerald-300">Активный фокус</div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold text-gray-100">{session.title}</div>
            {session.work_item_id && (
              <span className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                дело
              </span>
            )}
          </div>
          {session.work_item_title && session.work_item_title !== session.title && (
            <div className="truncate text-xs text-gray-500">{session.work_item_title}</div>
          )}
          {(session.work_context?.stage_title || session.work_context?.daily_outcome) && (
            <div className="mt-1 grid gap-0.5 text-[11px] text-gray-500">
              {session.work_context.stage_title && <div>Этап: <span className="text-cyan-300">{session.work_context.stage_title}</span></div>}
              {session.work_context.daily_outcome && <div>Результат дня: <span className="text-gray-300">{session.work_context.daily_outcome}</span></div>}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className={isOverTarget ? 'text-2xl font-semibold tabular-nums text-amber-300' : 'text-2xl font-semibold tabular-nums text-gray-100'}>
            {formatDuration(session.active_seconds)}
          </div>
          <div className="text-xs text-gray-500">
            цель {formatDuration(session.target_seconds)}
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
          placeholder="Заметка при остановке"
          className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
        >
          Стоп
        </button>
      </div>
      {session.work_item_id && (
        <details className="rounded border border-gray-800 bg-gray-950/35 px-3 py-2">
          <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-200">
            Зафиксировать след блока: сделал → изменилось → дальше
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <textarea
              value={result}
              onChange={(event) => setResult(event.target.value)}
              rows={2}
              placeholder="Что сделал или получил"
              className="min-h-16 resize-y rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:border-emerald-600"
            />
            <textarea
              value={stateChange}
              onChange={(event) => setStateChange(event.target.value)}
              rows={2}
              placeholder="Как изменилось состояние"
              className="min-h-16 resize-y rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:border-emerald-600"
            />
            <textarea
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              rows={2}
              placeholder="Следующий физический шаг"
              className="min-h-16 resize-y rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:border-emerald-600"
            />
          </div>
        </details>
      )}
    </div>
  )
}

function FocusSessionRow({
  session,
  gapBefore,
  gapExplanation,
  onCorrect,
  onExplainGap,
}: {
  session: FocusSessionView
  gapBefore?: {
    from: string
    to: string
    seconds: number
  }
  gapExplanation?: GapExplanation
  onCorrect: () => void
  onExplainGap?: (preset?: GapExplanationPreset) => void
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
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2">
        <span className="font-mono tabular-nums text-gray-400">{formatDuration(session.active_seconds)}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-gray-200">{title}</span>
          {session.work_item_id && (
            <span className="shrink-0 rounded border border-gray-700 px-1 text-[10px] uppercase tracking-wide text-gray-400">
              дело
            </span>
          )}
          <span className="shrink-0 rounded border border-gray-700 px-1 text-[10px] uppercase tracking-wide text-gray-500">
            {formatActivityZoneLabel(session.activity_zone)}
          </span>
        </span>
        <span className={stateClass}>{range}</span>
        <button
          type="button"
          onClick={onCorrect}
          disabled={session.state === 'active'}
          className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400 hover:border-gray-500 hover:text-gray-200 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-700"
        >
          Править
        </button>
      </div>
      {detailTitle && (
        <div className="mt-0.5 truncate pl-[3.25rem] text-[11px] text-gray-500">{detailTitle}</div>
      )}
      {session.note && (
        <div className="mt-0.5 truncate pl-[3.25rem] text-[11px] text-gray-400">
          заметка: {session.note}
        </div>
      )}
      {dayClipped && (
        <div className="mt-0.5 truncate pl-[3.25rem] text-[11px] text-amber-300/80">
          блок пересекает границу дня: показана доля этого дня
        </div>
      )}
      {gapBefore !== undefined && gapBefore.seconds >= SIGNIFICANT_GAP_SECONDS && (
        <div className="mt-0.5 flex items-center justify-end gap-2 text-[11px] text-gray-600">
          <span>
            разрыв до блока: {formatClockTime(gapBefore.from)}-{formatClockTime(gapBefore.to)} · {formatDuration(gapBefore.seconds)}
          </span>
          {gapExplanation && <GapClassificationBadge classification={gapExplanation.classification} />}
          {onExplainGap && !gapExplanation && <GapExplainActions onExplain={onExplainGap} />}
        </div>
      )}
    </div>
  )
}

function OpenGapRow({
  gap,
  explanation,
  onExplain,
}: {
  gap: {
    from: string
    to: string
    seconds: number
  }
  explanation?: GapExplanation
  onExplain: (preset?: GapExplanationPreset) => void
}) {
  return (
    <div className="rounded border border-amber-800/50 bg-amber-950/20 px-2 py-1 text-xs">
      <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2">
        <span className="font-mono tabular-nums text-amber-200">{formatDuration(gap.seconds)}</span>
        <span className="min-w-0 truncate text-amber-100">открытый разрыв после последнего блока</span>
        <span className="text-amber-300/80">
          {formatClockTime(gap.from)}-{formatClockTime(gap.to)}
        </span>
        {explanation ? (
          <GapClassificationBadge classification={explanation.classification} />
        ) : (
          <GapExplainActions onExplain={onExplain} />
        )}
      </div>
    </div>
  )
}

function GapClassificationBadge({ classification }: { classification: GapClassification }) {
  return (
    <span className="rounded border border-amber-700/70 bg-amber-950/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-100">
      {formatGapClassificationLabel(classification)}
    </span>
  )
}

function GapExplainActions({ onExplain }: { onExplain: (preset?: GapExplanationPreset) => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <button
        type="button"
        onClick={() => onExplain()}
        className="rounded border border-amber-800 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 hover:border-amber-500 hover:text-amber-100"
      >
        Объяснить
      </button>
      <button
        type="button"
        onClick={() => onExplain('lost_control')}
        className="rounded border border-amber-800 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 hover:border-amber-500 hover:text-amber-100"
      >
        Управляемость
      </button>
      <button
        type="button"
        onClick={() => onExplain('recovery')}
        className="rounded border border-amber-800 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 hover:border-amber-500 hover:text-amber-100"
      >
        Восстановление
      </button>
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
