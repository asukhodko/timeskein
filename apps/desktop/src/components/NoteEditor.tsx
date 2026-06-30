import { useState, useEffect, useRef } from 'react'

interface NoteEditorProps {
  itemTitle: string
  currentNote: string | null
  onSave: (note: string) => void
  onClose: () => void
}

export default function NoteEditor({ itemTitle, currentNote, onSave, onClose }: NoteEditorProps) {
  const [note, setNote] = useState(currentNote || '')
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
