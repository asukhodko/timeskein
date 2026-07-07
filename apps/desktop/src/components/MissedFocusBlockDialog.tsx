import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ActivityZone } from '@timeskein/contracts'
import { useCreateStoppedFocusSession } from '../hooks/useFocusSessions'
import { logAppEvent } from '../api/client'
import { formatActivityZoneBadge } from '../utils/workItemLabels'

const activityZones: ActivityZone[] = ['work', 'coordination', 'recovery', 'idle', 'personal']

export const MISSED_FOCUS_BLOCK_LABELS = {
  title: 'Добавить пропущенный блок',
  subtitle: 'Коррекция задним числом',
  state: 'остановлен',
  workItem: 'Дело',
  startedAt: 'Начало',
  stoppedAt: 'Конец',
  activityZone: 'Зона активности',
  note: 'Заметка',
  cancel: 'Отмена',
  submit: 'Добавить',
  error: 'Не удалось добавить блок',
} as const

interface MissedFocusBlockDialogProps {
  initialTitle?: string
  initialActivityZone?: ActivityZone
  onClose: () => void
}

export default function MissedFocusBlockDialog({
  initialTitle = '',
  initialActivityZone = 'work',
  onClose,
}: MissedFocusBlockDialogProps) {
  const defaults = defaultInterval()
  const [title, setTitle] = useState(initialTitle)
  const [startedAt, setStartedAt] = useState(toLocalInputValue(defaults.startedAt))
  const [stoppedAt, setStoppedAt] = useState(toLocalInputValue(defaults.stoppedAt))
  const [activityZone, setActivityZone] = useState<ActivityZone>(initialActivityZone)
  const [note, setNote] = useState('')
  const createMutation = useCreateStoppedFocusSession()

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle || !startedAt || !stoppedAt || createMutation.isPending) return
    const actionId = createTelemetryActionId()

    void logAppEvent({
      kind: 'focus_correction_requested',
      payload: {
        action_id: actionId,
        control: 'add_missed_block',
      },
    })

    createMutation.mutate(
      {
        title: trimmedTitle,
        started_at: fromLocalInputValue(startedAt),
        stopped_at: fromLocalInputValue(stoppedAt),
        activity_zone: activityZone,
        note: note.trim() || null,
      },
      {
        onSuccess: (session) => {
          void logAppEvent({
            kind: 'focus_corrected',
            focus_session_id: session.id,
            payload: {
              action_id: actionId,
              control: 'add_missed_block',
            },
          })
          onClose()
        },
        onError: (error) => {
          void logAppEvent({
            kind: 'focus_correction_failed',
            payload: {
              action_id: actionId,
              control: 'add_missed_block',
              error_code: error instanceof Error ? 'client_error' : 'unknown',
            },
          })
        },
      }
    )
  }

  return (
    <div
      data-timeskein-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <form
        className="w-full max-w-xl rounded-lg border border-gray-700 bg-gray-800 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-gray-100">{MISSED_FOCUS_BLOCK_LABELS.title}</div>
            <div className="text-xs text-gray-500">{MISSED_FOCUS_BLOCK_LABELS.subtitle}</div>
          </div>
          <span className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-400">
            {MISSED_FOCUS_BLOCK_LABELS.state}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm text-gray-300 md:col-span-2">
            <span>{MISSED_FOCUS_BLOCK_LABELS.workItem}</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="grid gap-1 text-sm text-gray-300">
            <span>{MISSED_FOCUS_BLOCK_LABELS.startedAt}</span>
            <input
              type="datetime-local"
              step="1"
              value={startedAt}
              onChange={(event) => setStartedAt(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="grid gap-1 text-sm text-gray-300">
            <span>{MISSED_FOCUS_BLOCK_LABELS.stoppedAt}</span>
            <input
              type="datetime-local"
              step="1"
              value={stoppedAt}
              onChange={(event) => setStoppedAt(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="grid gap-1 text-sm text-gray-300 md:col-span-2">
            <span>{MISSED_FOCUS_BLOCK_LABELS.activityZone}</span>
            <select
              value={activityZone}
              onChange={(event) => setActivityZone(event.target.value as ActivityZone)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              {activityZones.map((zone) => (
                <option key={zone} value={zone}>
                  {formatZoneLabel(zone)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-gray-300 md:col-span-2">
            <span>{MISSED_FOCUS_BLOCK_LABELS.note}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>
        </div>

        {createMutation.error && (
          <div className="mt-3 text-xs text-red-300">
            {createMutation.error instanceof Error ? createMutation.error.message : MISSED_FOCUS_BLOCK_LABELS.error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            {MISSED_FOCUS_BLOCK_LABELS.cancel}
          </button>
          <button
            type="submit"
            disabled={!title.trim() || !startedAt || !stoppedAt || createMutation.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            {MISSED_FOCUS_BLOCK_LABELS.submit}
          </button>
        </div>
      </form>
    </div>
  )
}

function defaultInterval() {
  const stoppedAt = new Date()
  const startedAt = new Date(stoppedAt.getTime() - 25 * 60_000)
  return {
    startedAt: startedAt.toISOString(),
    stoppedAt: stoppedAt.toISOString(),
  }
}

function toLocalInputValue(value: string) {
  const date = new Date(value)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 19)
}

function fromLocalInputValue(value: string) {
  return new Date(value).toISOString()
}

function formatZoneLabel(zone: ActivityZone) {
  return formatActivityZoneBadge(zone)
}

function createTelemetryActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
