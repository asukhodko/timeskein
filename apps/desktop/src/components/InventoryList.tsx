import { useCallback, useEffect } from 'react'
import type { WorkItemView } from '@timeskein/contracts'
import WorkItemCard from './WorkItemCard'
import {
  useTouchWorkItem,
  useSetWorkItemState,
  useToggleWorkItemPin,
  useDeleteWorkItem,
} from '../hooks/useInventory'

interface InventoryListProps {
  items: WorkItemView[]
  selectedIndex: number
  onSelect: (index: number) => void
}

export default function InventoryList({ items, selectedIndex, onSelect }: InventoryListProps) {
  const touchMutation = useTouchWorkItem()
  const stateMutation = useSetWorkItemState()
  const pinMutation = useToggleWorkItemPin()
  const deleteMutation = useDeleteWorkItem()

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
            if (confirm('Delete this work item?')) {
              deleteMutation.mutate({ id: selectedItem.id })
            }
          }
          break
      }
    },
    [selectedItem, touchMutation, stateMutation, pinMutation, deleteMutation]
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
        />
      ))}
    </div>
  )
}
