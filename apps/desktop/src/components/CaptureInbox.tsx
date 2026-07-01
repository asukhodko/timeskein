import { useState } from 'react'
import type { CaptureView } from '@timeskein/contracts'
import {
  useConvertCaptureToWorkItem,
  useCreateCapture,
  useOpenCaptures,
  useResolveCapture,
} from '../hooks/useCaptures'
import { formatClockTime, truncate } from '../utils/formatTime'

interface CaptureInboxProps {
  focusSessionId?: string
}

export default function CaptureInbox({ focusSessionId }: CaptureInboxProps) {
  const [text, setText] = useState('')
  const capturesQuery = useOpenCaptures()
  const createMutation = useCreateCapture()
  const resolveMutation = useResolveCapture()
  const convertMutation = useConvertCaptureToWorkItem()

  const captures = capturesQuery.data?.captures ?? []
  const trimmed = text.trim()

  const createCapture = () => {
    if (!trimmed || createMutation.isPending) return

    createMutation.mutate(
      { text: trimmed, focus_session_id: focusSessionId },
      {
        onSuccess: () => setText(''),
      }
    )
  }

  return (
    <div className="grid gap-2 rounded-md border border-gray-800 bg-gray-900/50 p-2">
      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              createCapture()
            }
          }}
          placeholder="Capture interruption..."
          className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
        />
        <button
          type="button"
          onClick={createCapture}
          disabled={!trimmed || createMutation.isPending}
          className="rounded border border-amber-700 px-2 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:border-amber-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
        >
          Capture
        </button>
      </div>

      {createMutation.error && (
        <div className="text-[11px] text-red-300">
          {createMutation.error instanceof Error ? createMutation.error.message : 'Capture failed'}
        </div>
      )}

      {captures.length > 0 && (
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase text-gray-500">
            Inbox · {captures.length}
          </div>
          <div className="grid max-h-28 gap-1 overflow-auto pr-1">
            {captures.map((capture) => (
              <CaptureRow
                key={capture.id}
                capture={capture}
                onResolve={() => resolveMutation.mutate(capture.id)}
                onConvert={() => convertMutation.mutate({ id: capture.id })}
                busy={resolveMutation.isPending || convertMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CaptureRow({
  capture,
  onResolve,
  onConvert,
  busy,
}: {
  capture: CaptureView
  onResolve: () => void
  onConvert: () => void
  busy: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/70 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-gray-200">{truncate(capture.text, 100)}</div>
        <div className="text-[11px] text-gray-500">{formatClockTime(capture.created_at)}</div>
      </div>
      <button
        type="button"
        onClick={onConvert}
        disabled={busy}
        className="shrink-0 rounded border border-blue-800 px-1.5 py-0.5 text-[11px] text-blue-200 hover:border-blue-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
      >
        Make Item
      </button>
      <button
        type="button"
        onClick={onResolve}
        disabled={busy}
        className="shrink-0 rounded border border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-300 hover:border-gray-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
      >
        Done
      </button>
    </div>
  )
}
