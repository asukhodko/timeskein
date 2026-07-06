import { useEffect, useRef } from 'react'
import type { WorkItemState } from '@timeskein/contracts'
import { formatWorkItemStateLabel } from '../utils/workItemLabels'

interface StateMenuProps {
  currentState: WorkItemState
  onSelect: (state: WorkItemState) => void
  onClose: () => void
}

const STATES: { state: WorkItemState; label: string; key: string; color: string }[] = [
  { state: 'active', label: formatWorkItemStateLabel('active'), key: '1', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { state: 'blocked', label: formatWorkItemStateLabel('blocked'), key: '2', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { state: 'waiting', label: formatWorkItemStateLabel('waiting'), key: '3', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { state: 'someday', label: formatWorkItemStateLabel('someday'), key: '4', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  { state: 'unknown', label: formatWorkItemStateLabel('unknown'), key: '5', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  { state: 'done', label: formatWorkItemStateLabel('done'), key: '6', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
]

export default function StateMenu({ currentState, onSelect, onClose }: StateMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      const stateEntry = STATES.find(s => s.key === e.key)
      if (stateEntry) {
        e.preventDefault()
        onSelect(stateEntry.state)
        onClose()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onSelect, onClose])

  return (
    <div
      data-timeskein-modal="true"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div
        ref={menuRef}
        className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-xl min-w-[200px]"
      >
        <div className="text-sm text-gray-400 mb-3">Выбрать состояние:</div>
        <div className="space-y-1">
          {STATES.map(({ state, label, key, color }) => (
            <button
              key={state}
              onClick={() => {
                onSelect(state)
                onClose()
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded border transition-colors
                ${state === currentState ? color : 'border-transparent hover:bg-gray-700'}`}
            >
              <span className="text-gray-200">{label}</span>
              <kbd className="px-1.5 py-0.5 text-xs bg-gray-700 rounded text-gray-400">{key}</kbd>
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-500 mt-3 text-center">
          Нажми 1-6 или Esc для отмены
        </div>
      </div>
    </div>
  )
}
