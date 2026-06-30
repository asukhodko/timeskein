import { useState, useEffect, useCallback } from 'react'
import type { MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { 
  useInventory, 
  useSetWorkItemState, 
  useSetWorkItemNote, 
  useAddRef, 
  useRemoveRef,
  useTouchWorkItem,
  useToggleWorkItemPin,
  useDeleteWorkItem,
} from '../hooks/useInventory'
import SearchInput from './SearchInput'
import InventoryList from './InventoryList'
import CreateDialog from './CreateDialog'
import FocusPanel from './FocusPanel'
import StateMenu from './StateMenu'
import NoteEditor from './NoteEditor'
import RefsPanel from './RefsPanel'
import ConfirmDialog from './ConfirmDialog'
import type { WorkItemState } from '@timeskein/contracts'
import { useStartFocusSession } from '../hooks/useFocusSessions'

export default function Palette() {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [showStateMenu, setShowStateMenu] = useState(false)
  const [showNoteEditor, setShowNoteEditor] = useState(false)
  const [showRefsPanel, setShowRefsPanel] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { data, isLoading, error } = useInventory(search || undefined)
  const items = data?.items ?? []
  const selectedItem = items[selectedIndex]

  const stateMutation = useSetWorkItemState()
  const noteMutation = useSetWorkItemNote()
  const addRefMutation = useAddRef()
  const removeRefMutation = useRemoveRef()
  const touchMutation = useTouchWorkItem()
  const pinMutation = useToggleWorkItemPin()
  const deleteMutation = useDeleteWorkItem()
  const startFocusMutation = useStartFocusSession()

  const handleHideWindow = async () => {
    try {
      await getCurrentWindow().hide()
    } catch {
      // Browser mode has no window to hide.
    }
  }

  const handleStartWindowDrag = async (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return

    const target = event.target as HTMLElement
    if (target.closest('button,input,textarea,select,a,[data-no-drag]')) return

    try {
      await getCurrentWindow().startDragging()
    } catch {
      // Browser mode has no native window to drag.
    }
  }

  // Action handlers for clickable shortcuts
  const handleTouch = () => {
    if (selectedItem) touchMutation.mutate(selectedItem.id)
  }

  const handlePin = () => {
    if (selectedItem) pinMutation.mutate(selectedItem.id)
  }

  const handleDelete = () => {
    if (selectedItem) setShowDeleteConfirm(true)
  }

  const handleFocusSelected = useCallback(() => {
    if (!selectedItem || startFocusMutation.isPending) return

    startFocusMutation.mutate({
      title: selectedItem.title,
      work_item_id: selectedItem.id,
      target_seconds: 25 * 60,
    })
  }, [selectedItem, startFocusMutation])

  const confirmDelete = () => {
    if (selectedItem) {
      deleteMutation.mutate({ id: selectedItem.id })
      setShowDeleteConfirm(false)
    }
  }

  const handleOpenPrimaryRef = () => {
    if (selectedItem?.refs?.length) {
      const primaryRef = selectedItem.refs.find(r => r.is_primary) || selectedItem.refs[0]
      if (primaryRef.kind === 'url') {
        window.open(primaryRef.value, '_blank')
      }
    }
  }

  const handleMoveUp = () => {
    setSelectedIndex((prev) => Math.max(prev - 1, 0))
  }

  const handleMoveDown = () => {
    setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1))
  }

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [items.length, search])

  // Keyboard navigation - use e.code for layout-independent shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if any modal is open
      if (showCreate || showStateMenu || showNoteEditor || showRefsPanel || showDeleteConfirm) return

      // Ignore item shortcuts while typing in a field.
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
        case 'Space':
          e.preventDefault()
          handleFocusSelected()
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
    [items, selectedIndex, selectedItem, showCreate, showStateMenu, showNoteEditor, showRefsPanel, showDeleteConfirm, handleFocusSelected]
  )

  useEffect(() => {
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
      <div
        data-tauri-drag-region
        onMouseDown={handleStartWindowDrag}
        className="flex cursor-move select-none items-center justify-between border-b border-gray-700 px-4 py-3"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <span className="text-xl">⟡</span>
          <span className="font-semibold text-gray-200">Timeskein</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {items.length} items
          </span>
          <button
            data-no-drag
            onClick={handleHideWindow}
            className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-bold transition-colors"
            title="Hide window (Esc)"
          >
            −
          </button>
          <button
            data-no-drag
            onClick={() => setShowCreate(true)}
            className="w-6 h-6 flex items-center justify-center rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors"
            title="Create new (Alt+N or C)"
          >
            +
          </button>
        </div>
      </div>

      <FocusPanel selectedItem={selectedItem} />

      {/* Search */}
      <div className="px-4 py-2 border-b border-gray-700">
        <SearchInput
          value={search}
          onChange={setSearch}
          onCreateNew={() => setShowCreate(true)}
          autoFocus={false}
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
            <div className="text-xs mt-1">Press C or Alt+N to create one</div>
          </div>
        ) : (
          <InventoryList
            items={items}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onRequestDelete={handleDelete}
          />
        )}
      </div>

      {/* Footer with clickable shortcuts */}
      <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/50">
        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          <button onClick={handleMoveUp} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Move up">
            <kbd className="px-1 bg-gray-700 rounded">↑</kbd>
          </button>
          <button onClick={handleMoveDown} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Move down">
            <kbd className="px-1 bg-gray-700 rounded">↓</kbd>
          </button>
          <span className="text-gray-600">|</span>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Create new item">
            <kbd className="px-1 bg-gray-700 rounded">C</kbd><span>create</span>
          </button>
          <button onClick={handleOpenPrimaryRef} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Open primary ref">
            <kbd className="px-1 bg-gray-700 rounded">Enter</kbd><span>open</span>
          </button>
          <button onClick={handleFocusSelected} className="flex items-center gap-1 hover:text-emerald-300 transition-colors" title="Start or switch focus to selected item">
            <kbd className="px-1 bg-gray-700 rounded">Space</kbd><span>focus</span>
          </button>
          <button onClick={handleTouch} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Touch (update last seen)">
            <kbd className="px-1 bg-gray-700 rounded">T</kbd><span>touch</span>
          </button>
          <button onClick={() => selectedItem && setShowStateMenu(true)} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Change state">
            <kbd className="px-1 bg-gray-700 rounded">S</kbd><span>state</span>
          </button>
          <button onClick={() => selectedItem && setShowNoteEditor(true)} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Edit note">
            <kbd className="px-1 bg-gray-700 rounded">N</kbd><span>note</span>
          </button>
          <button onClick={handlePin} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Toggle pin">
            <kbd className="px-1 bg-gray-700 rounded">P</kbd><span>pin</span>
          </button>
          <button onClick={() => selectedItem && setShowRefsPanel(true)} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Manage refs">
            <kbd className="px-1 bg-gray-700 rounded">R</kbd><span>refs</span>
          </button>
          <span className="text-gray-600">|</span>
          <button onClick={() => selectedItem && handleStateSelect('active')} className="flex items-center gap-1 hover:text-green-400 transition-colors" title="Set active">
            <kbd className="px-1 bg-gray-700 rounded">1</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('blocked')} className="flex items-center gap-1 hover:text-red-400 transition-colors" title="Set blocked">
            <kbd className="px-1 bg-gray-700 rounded">2</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('waiting')} className="flex items-center gap-1 hover:text-amber-400 transition-colors" title="Set waiting">
            <kbd className="px-1 bg-gray-700 rounded">3</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('someday')} className="flex items-center gap-1 hover:text-purple-400 transition-colors" title="Set someday">
            <kbd className="px-1 bg-gray-700 rounded">4</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('unknown')} className="flex items-center gap-1 hover:text-gray-400 transition-colors" title="Set unknown">
            <kbd className="px-1 bg-gray-700 rounded">5</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('done')} className="flex items-center gap-1 hover:text-blue-400 transition-colors" title="Set done">
            <kbd className="px-1 bg-gray-700 rounded">6</kbd>
          </button>
          <span className="text-gray-600">|</span>
          <button onClick={handleDelete} className="flex items-center gap-1 hover:text-red-400 transition-colors" title="Delete item">
            <kbd className="px-1 bg-gray-700 rounded">Shift+Del</kbd><span>delete</span>
          </button>
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

      {/* Delete Confirmation */}
      {showDeleteConfirm && selectedItem && (
        <ConfirmDialog
          title="Delete work item"
          message={`Are you sure you want to delete "${selectedItem.title}"?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger={true}
          onConfirm={confirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}
