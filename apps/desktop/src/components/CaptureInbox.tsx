import { useState } from 'react'
import type { CaptureView } from '@timeskein/contracts'
import {
  useAppendCaptureToWorkItemEvent,
  useConvertCaptureToWorkItem,
  useCreateCapture,
  useOpenCaptures,
  useResolveCapture,
} from '../hooks/useCaptures'
import { logAppEvent } from '../api/client'
import { formatClockTime, truncate } from '../utils/formatTime'

interface CaptureInboxProps {
  focusSessionId?: string
  targetWorkItemId?: string
}

export default function CaptureInbox({ focusSessionId, targetWorkItemId }: CaptureInboxProps) {
  const [text, setText] = useState('')
  const capturesQuery = useOpenCaptures()
  const createMutation = useCreateCapture()
  const resolveMutation = useResolveCapture()
  const convertMutation = useConvertCaptureToWorkItem()
  const appendEventMutation = useAppendCaptureToWorkItemEvent()

  const captures = capturesQuery.data?.captures ?? []
  const trimmed = text.trim()

  const createCapture = () => {
    if (!trimmed || createMutation.isPending) return

    const actionId = createTelemetryActionId()
    void logAppEvent({
      source: 'ui',
      kind: 'capture_create_requested',
      focus_session_id: focusSessionId,
      payload: {
        action_id: actionId,
        control: 'capture_input',
        has_active_focus: Boolean(focusSessionId),
      },
    })

    createMutation.mutate(
      { text: trimmed, focus_session_id: focusSessionId },
      {
        onSuccess: (capture) => {
          setText('')
          void logAppEvent({
            source: 'ui',
            kind: 'capture_created',
            focus_session_id: capture.focus_session_id,
            payload: {
              action_id: actionId,
              control: 'capture_input',
              has_active_focus: Boolean(capture.focus_session_id),
            },
          })
        },
        onError: (error) => {
          void logAppEvent({
            source: 'ui',
            kind: 'capture_create_failed',
            focus_session_id: focusSessionId,
            payload: {
              action_id: actionId,
              control: 'capture_input',
              error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
            },
          })
        },
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
                onResolve={() => {
                  const actionId = createTelemetryActionId()
                  void logAppEvent({
                    source: 'ui',
                    kind: 'capture_resolve_requested',
                    work_item_id: capture.work_item_id,
                    focus_session_id: capture.focus_session_id,
                    payload: {
                      action_id: actionId,
                      control: 'done_button',
                      had_focus_link: Boolean(capture.focus_session_id),
                    },
                  })
                  resolveMutation.mutate(capture.id, {
                    onSuccess: (resolved) => {
                      void logAppEvent({
                        source: 'ui',
                        kind: 'capture_resolved',
                        work_item_id: resolved.work_item_id,
                        focus_session_id: resolved.focus_session_id,
                        payload: {
                          action_id: actionId,
                          control: 'done_button',
                          had_focus_link: Boolean(resolved.focus_session_id),
                        },
                      })
                    },
                    onError: (error) => {
                      void logAppEvent({
                        source: 'ui',
                        kind: 'capture_resolve_failed',
                        work_item_id: capture.work_item_id,
                        focus_session_id: capture.focus_session_id,
                        payload: {
                          action_id: actionId,
                          control: 'done_button',
                          error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
                        },
                      })
                    },
                  })
                }}
                onConvert={() => {
                  const actionId = createTelemetryActionId()
                  void logAppEvent({
                    source: 'ui',
                    kind: 'capture_convert_requested',
                    work_item_id: capture.work_item_id,
                    focus_session_id: capture.focus_session_id,
                    payload: {
                      action_id: actionId,
                      control: 'make_item_button',
                      had_focus_link: Boolean(capture.focus_session_id),
                    },
                  })
                  convertMutation.mutate({ id: capture.id }, {
                    onSuccess: (result) => {
                      void logAppEvent({
                        source: 'ui',
                        kind: 'capture_converted',
                        work_item_id: result.work_item_id,
                        focus_session_id: result.capture.focus_session_id,
                        payload: {
                          action_id: actionId,
                          control: 'make_item_button',
                          had_focus_link: Boolean(result.capture.focus_session_id),
                          reused: result.reused,
                        },
                      })
                    },
                    onError: (error) => {
                      void logAppEvent({
                        source: 'ui',
                        kind: 'capture_convert_failed',
                        work_item_id: capture.work_item_id,
                        focus_session_id: capture.focus_session_id,
                        payload: {
                          action_id: actionId,
                          control: 'make_item_button',
                          error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
                        },
                      })
                    },
                  })
                }}
                onAppendEvent={() => {
                  const actionId = createTelemetryActionId()
                  void logAppEvent({
                    source: 'ui',
                    kind: 'capture_convert_requested',
                    work_item_id: targetWorkItemId,
                    focus_session_id: capture.focus_session_id,
                    payload: {
                      action_id: actionId,
                      control: 'append_event_button',
                      had_focus_link: Boolean(capture.focus_session_id),
                      has_target_work_item: Boolean(targetWorkItemId),
                    },
                  })
                  appendEventMutation.mutate(
                    { id: capture.id, work_item_id: targetWorkItemId },
                    {
                      onSuccess: (result) => {
                        void logAppEvent({
                          source: 'ui',
                          kind: 'capture_converted',
                          work_item_id: result.work_item_id,
                          focus_session_id: result.capture.focus_session_id,
                          payload: {
                            action_id: actionId,
                            control: 'append_event_button',
                            had_focus_link: Boolean(result.capture.focus_session_id),
                          },
                        })
                      },
                      onError: (error) => {
                        void logAppEvent({
                          source: 'ui',
                          kind: 'capture_convert_failed',
                          work_item_id: targetWorkItemId,
                          focus_session_id: capture.focus_session_id,
                          payload: {
                            action_id: actionId,
                            control: 'append_event_button',
                            error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
                          },
                        })
                      },
                    }
                  )
                }}
                busy={resolveMutation.isPending || convertMutation.isPending || appendEventMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function createTelemetryActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function CaptureRow({
  capture,
  onResolve,
  onConvert,
  onAppendEvent,
  busy,
}: {
  capture: CaptureView
  onResolve: () => void
  onConvert: () => void
  onAppendEvent: () => void
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
        onClick={onAppendEvent}
        disabled={busy}
        className="shrink-0 rounded border border-emerald-800 px-1.5 py-0.5 text-[11px] text-emerald-200 hover:border-emerald-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
      >
        Event
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
