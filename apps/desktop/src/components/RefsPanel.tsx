import { useState, useEffect, useRef } from 'react'
import type { RefView } from '@timeskein/contracts'

interface RefsPanelProps {
  itemTitle: string
  refs: RefView[]
  onAddRef: (kind: string, value: string) => void
  onRemoveRef: (refId: string) => void
  onOpenRef: (refId: string) => void
  onClose: () => void
}

const REF_KINDS = [
  { kind: 'url', label: 'URL', placeholder: 'https://...' },
  { kind: 'file_path', label: 'File', placeholder: 'C:/path/to/file.txt' },
  { kind: 'issue_key', label: 'Issue', placeholder: 'PROJ-123' },
]

export default function RefsPanel({ itemTitle, refs, onAddRef, onRemoveRef, onOpenRef, onClose }: RefsPanelProps) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [newKind, setNewKind] = useState('url')
  const [newValue, setNewValue] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (showAddForm) {
          setShowAddForm(false)
          setNewValue('')
        } else {
          onClose()
        }
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
  }, [showAddForm, onClose])

  useEffect(() => {
    if (showAddForm) {
      inputRef.current?.focus()
    }
  }, [showAddForm])

  const handleAdd = () => {
    if (newValue.trim()) {
      onAddRef(newKind, newValue.trim())
      setNewValue('')
      setShowAddForm(false)
    }
  }

  const getRefIcon = (kind: string) => {
    switch (kind) {
      case 'url': return '🔗'
      case 'file_path': return '📄'
      case 'issue_key': return '🎫'
      default: return '📎'
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-xl w-[450px] max-w-[90vw]"
      >
        <div className="text-sm text-gray-400 mb-1">Refs for:</div>
        <div className="text-gray-200 font-medium mb-3 truncate">{itemTitle}</div>

        {/* Existing refs */}
        <div className="space-y-1 mb-3 max-h-[200px] overflow-auto">
          {refs.length === 0 ? (
            <div className="text-gray-500 text-sm py-2 text-center">No refs attached</div>
          ) : (
            refs.map((ref) => (
              <div
                key={ref.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-700/50 group"
              >
                <span>{getRefIcon(ref.kind)}</span>
                <span
                  className="flex-1 text-sm text-gray-300 truncate cursor-pointer hover:text-blue-400"
                  onClick={() => onOpenRef(ref.id)}
                  title={ref.value}
                >
                  {ref.value}
                </span>
                {ref.is_primary && (
                  <span className="text-xs text-yellow-500" title="Primary ref">★</span>
                )}
                <button
                  onClick={() => onRemoveRef(ref.id)}
                  className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove ref"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add form */}
        {showAddForm ? (
          <div className="border-t border-gray-700 pt-3">
            <div className="flex gap-2 mb-2">
              {REF_KINDS.map(({ kind, label }) => (
                <button
                  key={kind}
                  onClick={() => setNewKind(kind)}
                  className={`px-2 py-1 text-xs rounded transition-colors
                    ${kind === newKind 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-700 text-gray-400 hover:text-gray-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAdd()
                  }
                }}
                placeholder={REF_KINDS.find(r => r.kind === newKind)?.placeholder}
                className="flex-1 px-3 py-1.5 text-sm bg-gray-900 border border-gray-600 rounded
                           text-gray-200 placeholder-gray-500
                           focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleAdd}
                disabled={!newValue.trim()}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 
                           disabled:cursor-not-allowed text-white rounded transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full py-2 text-sm text-gray-400 hover:text-gray-200 
                       border border-dashed border-gray-600 rounded hover:border-gray-500 transition-colors"
          >
            + Add ref
          </button>
        )}

        <div className="text-xs text-gray-500 mt-3 text-center">
          Click ref to open, Esc to close
        </div>
      </div>
    </div>
  )
}
