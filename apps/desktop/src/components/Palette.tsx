import { useState, useEffect, useCallback } from 'react'
import { useInventory, useSetWorkItemState, useSetWorkItemNote, useAddRef, useRemoveRef } from '../hooks/useInventory'
import SearchInput from './SearchInput'
import InventoryList from './InventoryList'
import CreateDialog from './CreateDialog'
import StateMenu from './StateMenu'
import NoteEditor from './NoteEditor'
import RefsPanel from './RefsPanel'
import type { WorkItemState } from '@timeskein/contracts'

export default function Palette() {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [showStateMenu, setShowStateMenu] = useState(false)
  const [showNoteEditor, setShowNoteEditor] = useState(false)
  const [showRefsPanel, setShowRefsPanel] = useState(false)

  const { data, isLoading, error } = useInventory(search || undefined)
  const items = data?.items ?? []
  const selectedItem = items[selectedIndex]

  const stateMutation = useSetWorkItemState()
  const noteMutation = useSetWorkItemNote()
  const addRefMutation = useAddRef()
  const removeRefMutation = useRemoveRef()

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [items.length, search])

  // Keyboard navigation - use e.code for layout-independent shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if any modal is open
      if (showCreate || showStateMenu || showNoteEditor || showRefsPanel) return

      // Ignore if in an input (except for Ctrl+N)
      const isInput = (e.target as HTMLElement).tagName === 'INPUT' || 
                      (e.target as HTMLElement).tagName === 'TEXTAREA'

      // Alt+N or C (when not in input) - create new
      if ((e.code === 'KeyN' && e.altKey) || (e.code === 'KeyC' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault()
        e.stopPropagation()
        setShowCreate(true)
        return
      }

      if (isInput) return

      // Use e.code for layout-independent shortcuts (works with Russian keyboard)
      switch (e.code) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (selectedItem && selectedItem.refs && selectedItem.refs.length > 0) {
            const primaryRef = selectedItem.refs.find(r => r.is_primary) || selectedItem.refs[0]
            if (primaryRef.kind === 'url') {
              window.open(primaryRef.value, '_blank')
            }
          }
          break
        case 'KeyS':
          e.preventDefault()
          if (selectedItem) setShowStateMenu(true)
          break
        case 'KeyN':
          e.preventDefault()
          if (selectedItem) setShowNoteEditor(true)
          break
        case 'KeyR':
          e.preventDefault()
          if (selectedItem) setShowRefsPanel(true)
          break
        case 'KeyT':
          // Touch is handled in InventoryList
          break
        case 'KeyP':
          // Pin is handled in InventoryList
          break
      }
    },
    [items, selectedIndex, selectedItem, showCreate, showStateMenu, showNoteEditor, showRefsPanel]
  )

  useEffect(() => {
    // Use capture phase to intercept Ctrl+N before browser
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  const handleStateSelect = (state: WorkItemState) => {
    if (selectedItem) {
      stateMutation.mutate({ id: selectedItem.id, state })
    }
  }

  const handleNoteSave = (note: string) => {
    if (selectedItem) {
      noteMutation.mutate({ id: selectedItem.id, note })
    }
  }

  const handleAddRef = (kind: string, value: string) => {
    if (selectedItem) {
      addRefMutation.mutate({ work_item_id: selectedItem.id, kind, value })
    }
  }

  const handleRemoveRef = (refId: string) => {
    if (selectedItem) {
      removeRefMutation.mutate({ workItemId: selectedItem.id, refId })
    }
  }

  const handleOpenRef = (refId: string) => {
    if (selectedItem) {
      const ref = selectedItem.refs?.find(r => r.id === refId)
      if (ref && ref.kind === 'url') {
        window.open(ref.value, '_blank')
      }
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-xl">⟡</span>
          <span className="font-semibold text-gray-200">Timeskein</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {items.length} items
          </span>
          <button
            onClick={() => setShowCreate(true)}
            className="w-6 h-6 flex items-center justify-center rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors"
            title="Create new (Alt+N or C)"
          >
            +
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-gray-700">
        <SearchInput
          value={search}
          onChange={setSearch}
          onCreateNew={() => setShowCreate(true)}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-gray-500">
            Loading...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <div className="text-red-400">Agent offline</div>
            <div className="text-xs mt-1">Start the mock server or agent</div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <div>{search ? 'No matching items' : 'No work items yet'}</div>
            <div className="text-xs mt-1">Press Ctrl+N to create one</div>
          </div>
        ) : (
          <InventoryList
            items={items}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
        )}
      </div>

      {/* Footer with shortcuts */}
      <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/50">
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <span><kbd className="px-1 bg-gray-700 rounded">C</kbd> create</span>
          <span><kbd className="px-1 bg-gray-700 rounded">Enter</kbd> open</span>
          <span><kbd className="px-1 bg-gray-700 rounded">T</kbd> touch</span>
          <span><kbd className="px-1 bg-gray-700 rounded">S</kbd> state</span>
          <span><kbd className="px-1 bg-gray-700 rounded">N</kbd> note</span>
          <span><kbd className="px-1 bg-gray-700 rounded">P</kbd> pin</span>
          <span><kbd className="px-1 bg-gray-700 rounded">R</kbd> refs</span>
        </div>
      </div>

      {/* Create Dialog */}
      {showCreate && (
        <CreateDialog
          onClose={() => setShowCreate(false)}
          initialTitle={search}
        />
      )}

      {/* State Menu */}
      {showStateMenu && selectedItem && (
        <StateMenu
          currentState={selectedItem.state as WorkItemState}
          onSelect={handleStateSelect}
          onClose={() => setShowStateMenu(false)}
        />
      )}

      {/* Note Editor */}
      {showNoteEditor && selectedItem && (
        <NoteEditor
          itemTitle={selectedItem.title}
          currentNote={selectedItem.note || null}
          onSave={handleNoteSave}
          onClose={() => setShowNoteEditor(false)}
        />
      )}

      {/* Refs Panel */}
      {showRefsPanel && selectedItem && (
        <RefsPanel
          itemTitle={selectedItem.title}
          refs={selectedItem.refs || []}
          onAddRef={handleAddRef}
          onRemoveRef={handleRemoveRef}
          onOpenRef={handleOpenRef}
          onClose={() => setShowRefsPanel(false)}
        />
      )}
    </div>
  )
}
