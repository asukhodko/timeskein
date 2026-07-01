import { useCallback, useEffect } from 'react'
import type { WorkItemView } from '@timeskein/contracts'
import WorkItemCard from './WorkItemCard'
import {
  useTouchWorkItem,
  useSetWorkItemState,
  useToggleWorkItemPin,
} from '../hooks/useInventory'
import { useStartFocusSession } from '../hooks/useFocusSessions'
import { logAppEvent } from '../api/client'

interface InventoryListProps {
  items: WorkItemView[]
  selectedIndex: number
  onSelect: (index: number) => void
  onRequestDelete: () => void
}

export default function InventoryList({ items, selectedIndex, onSelect, onRequestDelete }: InventoryListProps) {
  const touchMutation = useTouchWorkItem()
  const stateMutation = useSetWorkItemState()
  const pinMutation = useToggleWorkItemPin()
  const startFocusMutation = useStartFocusSession()

  const selectedItem = items[selectedIndex]

  // Keyboard shortcuts for selected item - use e.code for layout-independent
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!selectedItem) return

      // Don't handle if in an input
      if ((e.target as HTMLElement).tagName === 'INPUT' || 
          (e.target as HTMLElement).tagName === 'TEXTAREA') {
        return
      }

      // Use e.code for layout-independent shortcuts (works with Russian keyboard)
      switch (e.code) {
        case 'KeyT':
          e.preventDefault()
          touchMutation.mutate(selectedItem.id)
          break
        case 'KeyP':
          e.preventDefault()
          pinMutation.mutate(selectedItem.id)
          break
        case 'Digit1':
          e.preventDefault()
          stateMutation.mutate({ id: selectedItem.id, state: 'active' })
          break
        case 'Digit2':
          e.preventDefault()
          stateMutation.mutate({ id: selectedItem.id, state: 'blocked' })
          break
        case 'Digit3':
          e.preventDefault()
          stateMutation.mutate({ id: selectedItem.id, state: 'waiting' })
          break
        case 'Digit4':
          e.preventDefault()
          stateMutation.mutate({ id: selectedItem.id, state: 'someday' })
          break
        case 'Digit5':
          e.preventDefault()
          stateMutation.mutate({ id: selectedItem.id, state: 'unknown' })
          break
        case 'Digit6':
          e.preventDefault()
          stateMutation.mutate({ id: selectedItem.id, state: 'done' })
          break
        case 'Delete':
        case 'Backspace':
          if (e.shiftKey) {
            e.preventDefault()
            onRequestDelete()
          }
          break
      }
    },
    [selectedItem, touchMutation, stateMutation, pinMutation, onRequestDelete]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="divide-y divide-gray-700/50">
      {items.map((item, index) => (
        <WorkItemCard
          key={item.id}
          item={item}
          isSelected={index === selectedIndex}
          onClick={() => onSelect(index)}
          onDoubleClick={() => {
            if (startFocusMutation.isPending) return
            const actionId = createTelemetryActionId()
            void logAppEvent({
              source: 'ui',
              kind: 'focus_start_requested',
              work_item_id: item.id,
              payload: {
                action_id: actionId,
                control: 'double_click',
              },
            })
            startFocusMutation.mutate({
              title: item.title,
              work_item_id: item.id,
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
                    control: 'double_click',
                  },
                })
              },
              onError: (error) => {
                void logAppEvent({
                  source: 'ui',
                  kind: 'focus_start_failed',
                  work_item_id: item.id,
                  payload: {
                    action_id: actionId,
                    control: 'double_click',
                    error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
                  },
                })
              },
            })
          }}
        />
      ))}
    </div>
  )
}

function createTelemetryActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
