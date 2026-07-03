import { useState } from 'react'
import type { FormEvent } from 'react'
import type { FocusSessionView } from '@timeskein/contracts'
import { useSplitFocusSession, useUpdateFocusSession } from '../hooks/useFocusSessions'
import { formatClockTime } from '../utils/formatTime'

interface FocusCorrectionDialogProps {
  session: FocusSessionView
  onClose: () => void
}

export default function FocusCorrectionDialog({ session, onClose }: FocusCorrectionDialogProps) {
  const [title, setTitle] = useState(session.work_item_title ?? session.title)
  const [startedAt, setStartedAt] = useState(toLocalInputValue(session.started_at))
  const [stoppedAt, setStoppedAt] = useState(toLocalInputValue(session.stopped_at ?? session.started_at))
  const [note, setNote] = useState(session.note ?? '')
  const [splitAt, setSplitAt] = useState(toLocalInputValue(midpointIso(session)))
  const [rightTitle, setRightTitle] = useState(session.work_item_title ?? session.title)
  const [rightNote, setRightNote] = useState('')
  const updateMutation = useUpdateFocusSession()
  const splitMutation = useSplitFocusSession()
  const mutationError = updateMutation.error || splitMutation.error

  const handleSave = (event: FormEvent) => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle || !startedAt || !stoppedAt || updateMutation.isPending) return

    updateMutation.mutate(
      {
        id: session.id,
        title: trimmedTitle,
        started_at: fromLocalInputValue(startedAt),
        stopped_at: fromLocalInputValue(stoppedAt),
        note: note.trim() || null,
      },
      {
        onSuccess: onClose,
      }
    )
  }

  const handleSplit = () => {
    if (!splitAt || splitMutation.isPending) return

    const trimmedRightTitle = rightTitle.trim()
    splitMutation.mutate(
      {
        id: session.id,
        split_at: fromLocalInputValue(splitAt),
        right_title: trimmedRightTitle || undefined,
        right_note: rightNote.trim() || undefined,
      },
      {
        onSuccess: onClose,
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
        className="w-full max-w-2xl rounded-lg border border-gray-700 bg-gray-800 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSave}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-gray-100">Correct Focus Block</div>
            <div className="text-xs text-gray-500">
              {formatClockTime(session.started_at)}-{formatClockTime(session.stopped_at)}
            </div>
          </div>
          <span className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-400">
            {session.state}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm text-gray-300 md:col-span-2">
            <span>Work Item</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="grid gap-1 text-sm text-gray-300">
            <span>Start</span>
            <input
              type="datetime-local"
              step="1"
              value={startedAt}
              onChange={(event) => setStartedAt(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="grid gap-1 text-sm text-gray-300">
            <span>End</span>
            <input
              type="datetime-local"
              step="1"
              value={stoppedAt}
              onChange={(event) => setStoppedAt(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="grid gap-1 text-sm text-gray-300 md:col-span-2">
            <span>Note</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>
        </div>

        <div className="my-4 border-t border-gray-700" />

        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1 text-sm text-gray-300">
            <span>Split At</span>
            <input
              type="datetime-local"
              step="1"
              value={splitAt}
              onChange={(event) => setSplitAt(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <label className="grid gap-1 text-sm text-gray-300">
            <span>Right Item</span>
            <input
              value={rightTitle}
              onChange={(event) => setRightTitle(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>

          <button
            type="button"
            onClick={handleSplit}
            disabled={!splitAt || splitMutation.isPending}
            className="self-end rounded-md border border-amber-700 px-3 py-2 text-sm font-semibold text-amber-200 hover:border-amber-500 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500"
          >
            Split
          </button>

          <label className="grid gap-1 text-sm text-gray-300 md:col-span-3">
            <span>Right Note</span>
            <input
              value={rightNote}
              onChange={(event) => setRightNote(event.target.value)}
              className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </label>
        </div>

        {mutationError && (
          <div className="mt-3 text-xs text-red-300">
            {mutationError instanceof Error ? mutationError.message : 'Correction failed'}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || !startedAt || !stoppedAt || updateMutation.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}

function toLocalInputValue(value: string) {
  const date = new Date(value)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 19)
}

function fromLocalInputValue(value: string) {
  return new Date(value).toISOString()
}

function midpointIso(session: FocusSessionView) {
  const start = new Date(session.started_at).getTime()
  const stop = new Date(session.stopped_at ?? session.started_at).getTime()
  return new Date(start + Math.max(Math.floor((stop - start) / 2), 0)).toISOString()
}
