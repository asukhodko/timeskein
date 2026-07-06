import { useState, useEffect, useCallback, useMemo } from 'react'
import type { MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { logAppEvent } from '../api/client'
import { 
  useInventory, 
  useSetWorkItemState, 
  useSetWorkItemNote, 
  useAddRef, 
  useRemoveRef,
  useTouchWorkItem,
  useToggleWorkItemPin,
  useDeleteWorkItem,
  useAddWorkItemEvent,
} from '../hooks/useInventory'
import SearchInput from './SearchInput'
import InventoryList from './InventoryList'
import CreateDialog from './CreateDialog'
import FocusPanel from './FocusPanel'
import StateMenu from './StateMenu'
import NoteEditor from './NoteEditor'
import WorkItemEditor from './WorkItemEditor'
import RefsPanel from './RefsPanel'
import ConfirmDialog from './ConfirmDialog'
import type { WorkItemState } from '@timeskein/contracts'
import { useCurrentFocusSession, useStartFocusSession } from '../hooks/useFocusSessions'
import {
  countInventoryModes,
  getVisibleInventoryItems,
  inventoryModes,
  inventoryModeForShortcut,
  modeTitle,
  type InventoryMode,
} from '../utils/inventoryModes'

const todayListHeightStorageKey = 'timeskein.todayListHeightPx'
const defaultTodayListHeightPx = 288
const minTodayListHeightPx = 120
const maxTodayListHeightPx = 520

export default function Palette() {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>('recent')
  const [todayListHeightPx, setTodayListHeightPx] = useState(readTodayListHeight)
  const [showCreate, setShowCreate] = useState(false)
  const [showStateMenu, setShowStateMenu] = useState(false)
  const [showNoteEditor, setShowNoteEditor] = useState(false)
  const [showWorkItemEditor, setShowWorkItemEditor] = useState(false)
  const [showRefsPanel, setShowRefsPanel] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { data, isLoading, error } = useInventory(search || undefined)
  const items = data?.items ?? []
  const searchText = search.trim()
  const visibleItems = useMemo(
    () => getVisibleInventoryItems(items, inventoryMode, searchText),
    [items, inventoryMode, searchText]
  )
  const modeCounts = useMemo(() => countInventoryModes(items), [items])
  const selectedItem = visibleItems[selectedIndex]

  const stateMutation = useSetWorkItemState()
  const noteMutation = useSetWorkItemNote()
  const eventMutation = useAddWorkItemEvent()
  const addRefMutation = useAddRef()
  const removeRefMutation = useRemoveRef()
  const touchMutation = useTouchWorkItem()
  const pinMutation = useToggleWorkItemPin()
  const deleteMutation = useDeleteWorkItem()
  const startFocusMutation = useStartFocusSession()
  const currentFocusQuery = useCurrentFocusSession()
  const currentFocus = currentFocusQuery.data?.session

  const handleHideWindow = async () => {
    try {
      void logAppEvent({
        source: 'ui',
        kind: 'window_hide_requested',
        payload: {
          control: 'hide_button',
        },
      })
      void logAppEvent({
        source: 'ui',
        kind: 'window_hidden',
        payload: {
          control: 'hide_button',
        },
      })
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
      void logAppEvent({
        source: 'ui',
        kind: 'window_drag_started',
      })
      await getCurrentWindow().startDragging()
    } catch {
      // Browser mode has no native window to drag.
    }
  }

  const handleStartTodayResize = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return

    event.preventDefault()
    const startY = event.clientY
    const startHeight = todayListHeightPx

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      setTodayListHeightPx(clampTodayListHeight(startHeight + moveEvent.clientY - startY))
    }

    const handleMouseUp = (upEvent: globalThis.MouseEvent) => {
      const nextHeight = clampTodayListHeight(startHeight + upEvent.clientY - startY)
      setTodayListHeightPx(nextHeight)
      writeTodayListHeight(nextHeight)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const resetTodayHeight = () => {
    setTodayListHeightPx(defaultTodayListHeightPx)
    writeTodayListHeight(defaultTodayListHeightPx)
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

    const actionId = createTelemetryActionId()
    void logAppEvent({
      source: 'ui',
      kind: 'focus_start_requested',
      work_item_id: selectedItem.id,
      payload: {
        action_id: actionId,
        control: 'selected_shortcut',
      },
    })

    startFocusMutation.mutate({
      title: selectedItem.title,
      work_item_id: selectedItem.id,
      target_seconds: 25 * 60,
      telemetry_action_id: actionId,
    }, {
      onSuccess: (session) => {
        void logAppEvent({
          source: 'ui',
          kind: 'focus_started',
          work_item_id: session.work_item_id,
          focus_session_id: session.id,
          payload: {
            action_id: actionId,
            control: 'selected_shortcut',
          },
        })
      },
      onError: (error) => {
        void logAppEvent({
          source: 'ui',
          kind: 'focus_start_failed',
          work_item_id: selectedItem.id,
          payload: {
            action_id: actionId,
            control: 'selected_shortcut',
            error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
          },
        })
      },
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
    } else if (selectedItem) {
      setShowWorkItemEditor(true)
    }
  }

  const handleMoveUp = () => {
    setSelectedIndex((prev) => Math.max(prev - 1, 0))
  }

  const handleMoveDown = () => {
    setSelectedIndex((prev) => Math.min(prev + 1, Math.max(visibleItems.length - 1, 0)))
  }

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [visibleItems.length, search, inventoryMode])

  // Keyboard navigation - use e.code for layout-independent shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if any modal is open
      if (showCreate || showStateMenu || showNoteEditor || showWorkItemEditor || showRefsPanel || showDeleteConfirm) return

      // Ignore item shortcuts while typing in a field.
      const isInput = isEditableElement(e.target)

      if (isInput) {
        return
      }

      // Alt+N or C (when not in input) - create new
      if ((e.code === 'KeyN' && e.altKey) || (e.code === 'KeyC' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault()
        e.stopPropagation()
        setShowCreate(true)
        return
      }

      const shortcutMode = inventoryModeForShortcut(e.code, e.altKey, e.ctrlKey, e.metaKey)
      if (shortcutMode) {
        e.preventDefault()
        e.stopPropagation()
        setInventoryMode(shortcutMode)
        setSelectedIndex(0)
        return
      }

      // Use e.code for layout-independent shortcuts (works with Russian keyboard)
      switch (e.code) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, Math.max(visibleItems.length - 1, 0)))
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
          } else if (selectedItem) {
            setShowWorkItemEditor(true)
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
        case 'KeyE':
          e.preventDefault()
          if (selectedItem) setShowWorkItemEditor(true)
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
    [visibleItems.length, selectedItem, showCreate, showStateMenu, showNoteEditor, showWorkItemEditor, showRefsPanel, showDeleteConfirm, handleFocusSelected]
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

  const handleAppendEvent = async (text: string) => {
    if (!selectedItem) return

    await eventMutation.mutateAsync({
      id: selectedItem.id,
      text,
      focus_session_id: currentFocus?.work_item_id === selectedItem.id ? currentFocus.id : undefined,
    })
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
            {visibleItems.length}{visibleItems.length === items.length ? '' : `/${items.length}`} items
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

      <FocusPanel selectedItem={selectedItem} todayListMaxHeightPx={todayListHeightPx} />

      <button
        type="button"
        data-no-drag
        onMouseDown={handleStartTodayResize}
        onDoubleClick={resetTodayHeight}
        className="group flex h-2 cursor-row-resize items-center justify-center border-b border-gray-700 bg-gray-950/80 hover:bg-gray-800/80"
        title="Drag to resize Today. Double-click to reset."
      >
        <span className="h-0.5 w-12 rounded bg-gray-700 transition-colors group-hover:bg-blue-500/70" />
      </button>

      {/* Search */}
      <div className="px-4 py-2 border-b border-gray-700">
        <SearchInput
          value={search}
          onChange={setSearch}
          onCreateNew={() => setShowCreate(true)}
          autoFocus={false}
        />
        <InventoryModeTabs
          mode={inventoryMode}
          counts={modeCounts}
          onChange={setInventoryMode}
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
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <div>No items in {inventoryMode}</div>
            <button
              className="mt-2 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-blue-500/50 hover:text-blue-300"
              onClick={() => setInventoryMode('all')}
            >
              Show all
            </button>
          </div>
        ) : (
          <InventoryList
            items={visibleItems}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onRequestDelete={handleDelete}
          />
        )}
      </div>

      {/* Footer with clickable shortcuts */}
      <div className="px-4 py-2 border-t border-gray-700 bg-gray-800/50">
        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          <button onClick={handleMoveUp} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Выше">
            <kbd className="px-1 bg-gray-700 rounded">↑</kbd>
          </button>
          <button onClick={handleMoveDown} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Ниже">
            <kbd className="px-1 bg-gray-700 rounded">↓</kbd>
          </button>
          <span className="text-gray-600">|</span>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Создать дело">
            <kbd className="px-1 bg-gray-700 rounded">C</kbd><span>создать</span>
          </button>
          <button onClick={handleOpenPrimaryRef} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Открыть основную ссылку">
            <kbd className="px-1 bg-gray-700 rounded">Enter</kbd><span>открыть</span>
          </button>
          <button onClick={() => selectedItem && setShowWorkItemEditor(true)} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Править дело">
            <kbd className="px-1 bg-gray-700 rounded">E</kbd><span>править</span>
          </button>
          <button onClick={handleFocusSelected} className="flex items-center gap-1 hover:text-emerald-300 transition-colors" title="Начать или переключить фокус на выбранное дело">
            <kbd className="px-1 bg-gray-700 rounded">Space</kbd><span>фокус</span>
          </button>
          <button onClick={handleTouch} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Коснуться дела">
            <kbd className="px-1 bg-gray-700 rounded">T</kbd><span>касание</span>
          </button>
          <button onClick={() => selectedItem && setShowStateMenu(true)} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Изменить состояние">
            <kbd className="px-1 bg-gray-700 rounded">S</kbd><span>статус</span>
          </button>
          <button onClick={() => selectedItem && setShowNoteEditor(true)} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Править заметку">
            <kbd className="px-1 bg-gray-700 rounded">N</kbd><span>заметка</span>
          </button>
          <button onClick={handlePin} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Закрепить или открепить">
            <kbd className="px-1 bg-gray-700 rounded">P</kbd><span>закрепить</span>
          </button>
          <button onClick={() => selectedItem && setShowRefsPanel(true)} className="flex items-center gap-1 hover:text-gray-300 transition-colors" title="Управлять ссылками">
            <kbd className="px-1 bg-gray-700 rounded">R</kbd><span>ссылки</span>
          </button>
          <span className="text-gray-600">|</span>
          <button onClick={() => selectedItem && handleStateSelect('active')} className="flex items-center gap-1 hover:text-green-400 transition-colors" title="Сделать active">
            <kbd className="px-1 bg-gray-700 rounded">1</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('blocked')} className="flex items-center gap-1 hover:text-red-400 transition-colors" title="Сделать blocked">
            <kbd className="px-1 bg-gray-700 rounded">2</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('waiting')} className="flex items-center gap-1 hover:text-amber-400 transition-colors" title="Сделать waiting">
            <kbd className="px-1 bg-gray-700 rounded">3</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('someday')} className="flex items-center gap-1 hover:text-purple-400 transition-colors" title="Сделать someday">
            <kbd className="px-1 bg-gray-700 rounded">4</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('unknown')} className="flex items-center gap-1 hover:text-gray-400 transition-colors" title="Сделать unknown">
            <kbd className="px-1 bg-gray-700 rounded">5</kbd>
          </button>
          <button onClick={() => selectedItem && handleStateSelect('done')} className="flex items-center gap-1 hover:text-blue-400 transition-colors" title="Сделать done">
            <kbd className="px-1 bg-gray-700 rounded">6</kbd>
          </button>
          <span className="text-gray-600">|</span>
          <button onClick={handleDelete} className="flex items-center gap-1 hover:text-red-400 transition-colors" title="Удалить дело">
            <kbd className="px-1 bg-gray-700 rounded">Shift+Del</kbd><span>удалить</span>
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
          onAppendEvent={handleAppendEvent}
          appendPending={eventMutation.isPending}
          appendError={eventMutation.error instanceof Error ? eventMutation.error.message : null}
          onClose={() => setShowNoteEditor(false)}
        />
      )}

      {/* Work Item Editor */}
      {showWorkItemEditor && selectedItem && (
        <WorkItemEditor
          item={selectedItem}
          onClose={() => setShowWorkItemEditor(false)}
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
          title="Удалить Work Item"
          message={`Удалить "${selectedItem.title}"?`}
          confirmLabel="Удалить"
          cancelLabel="Отмена"
          danger={true}
          onConfirm={confirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}

function isEditableElement(target: EventTarget | null) {
  return target instanceof HTMLElement && target.matches('input,textarea,select,[contenteditable="true"]')
}

function createTelemetryActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readTodayListHeight() {
  if (typeof window === 'undefined') return defaultTodayListHeightPx

  const stored = window.localStorage.getItem(todayListHeightStorageKey)
  if (!stored) return defaultTodayListHeightPx

  const parsed = Number.parseInt(stored, 10)
  return Number.isFinite(parsed) ? clampTodayListHeight(parsed) : defaultTodayListHeightPx
}

function writeTodayListHeight(height: number) {
  try {
    window.localStorage.setItem(todayListHeightStorageKey, String(clampTodayListHeight(height)))
  } catch {
    // localStorage can be unavailable in some browser shells.
  }
}

function clampTodayListHeight(height: number) {
  return Math.max(minTodayListHeightPx, Math.min(maxTodayListHeightPx, Math.round(height)))
}

function InventoryModeTabs({
  mode,
  counts,
  onChange,
}: {
  mode: InventoryMode
  counts: Record<InventoryMode, number>
  onChange: (mode: InventoryMode) => void
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      <div className="grid min-w-0 flex-1 grid-cols-4 overflow-hidden rounded border border-gray-700 bg-gray-900/40">
        {inventoryModes.map((item) => {
          const isActive = item.id === mode
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={[
                'flex min-w-0 items-center justify-center gap-1 px-2 py-1 text-xs transition-colors',
                isActive
                  ? 'bg-blue-500/20 text-blue-200'
                  : 'text-gray-500 hover:bg-gray-800/80 hover:text-gray-300',
              ].join(' ')}
              title={`${modeTitle(item.id)} (${item.shortcut})`}
            >
              <span className="truncate">{item.label}</span>
              <span className={isActive ? 'text-blue-300/70' : 'text-gray-600'}>
                {counts[item.id]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
