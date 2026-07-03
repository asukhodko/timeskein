import { useState, useEffect, useRef } from 'react'

interface NoteEditorProps {
  itemTitle: string
  currentNote: string | null
  onSave: (note: string) => void
  onAppendEvent?: (text: string) => Promise<void> | void
  appendPending?: boolean
  appendError?: string | null
  onClose: () => void
}

export default function NoteEditor({
  itemTitle,
  currentNote,
  onSave,
  onAppendEvent,
  appendPending = false,
  appendError,
  onClose,
}: NoteEditorProps) {
  const [note, setNote] = useState(currentNote || '')
  const [eventText, setEventText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        onSave(note)
        onClose()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [note, onSave, onClose])

  const appendEvent = async () => {
    const trimmed = eventText.trim()
    if (!trimmed || !onAppendEvent || appendPending) return

    try {
      await onAppendEvent(trimmed)
      setEventText('')
    } catch {
      // The parent mutation exposes the error state; keep typed text intact.
    }
  }

  return (
    <div
      data-timeskein-modal="true"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div
        ref={modalRef}
        className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-xl w-[400px] max-w-[90vw]"
      >
        <div className="text-sm text-gray-400 mb-1">Edit note for:</div>
        <div className="text-gray-200 font-medium mb-3 truncate">{itemTitle}</div>

        <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Description</div>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note..."
          rows={4}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg 
                     text-gray-200 placeholder-gray-500 resize-none
                     focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />

        {onAppendEvent && (
          <div className="mt-4 grid gap-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">Timestamped event</div>
            <textarea
              value={eventText}
              onChange={(e) => setEventText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  e.stopPropagation()
                  void appendEvent()
                }
              }}
              placeholder="What changed or happened?"
              rows={3}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg
                         text-gray-200 placeholder-gray-500 resize-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
            {appendError && (
              <div className="text-xs text-red-300">{appendError}</div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void appendEvent()}
                disabled={!eventText.trim() || appendPending}
                className="px-3 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 text-white rounded transition-colors disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
              >
                {appendPending ? 'Adding...' : 'Add Event'}
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mt-3">
          <div className="text-xs text-gray-500">
            Ctrl+Enter to save, Esc to cancel
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onSave(note)
                onClose()
              }}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
