import type { WorkItemView } from '@timeskein/contracts'

export type InventoryMode = 'recent' | 'today' | 'pinned' | 'all'

export const inventoryModes: Array<{ id: InventoryMode; label: string; shortcut: string; shortcutCode: string }> = [
  { id: 'recent', label: 'Недавние', shortcut: 'Alt+1', shortcutCode: 'Digit1' },
  { id: 'today', label: 'Сегодня', shortcut: 'Alt+2', shortcutCode: 'Digit2' },
  { id: 'pinned', label: 'Закреплённые', shortcut: 'Alt+3', shortcutCode: 'Digit3' },
  { id: 'all', label: 'Все', shortcut: 'Alt+4', shortcutCode: 'Digit4' },
]

const recentWindowMs = 72 * 60 * 60 * 1000

export function getVisibleInventoryItems(
  items: WorkItemView[],
  mode: InventoryMode,
  searchText: string,
  nowMs = Date.now()
) {
  return searchText.trim() ? items : filterInventoryItems(items, mode, nowMs)
}

export function inventoryModeForShortcut(code: string, altKey: boolean, ctrlKey = false, metaKey = false) {
  if (!altKey || ctrlKey || metaKey) return undefined
  return inventoryModes.find((mode) => mode.shortcutCode === code)?.id
}

export function filterInventoryItems(
  items: WorkItemView[],
  mode: InventoryMode,
  nowMs = Date.now()
) {
  switch (mode) {
    case 'today':
      return items.filter(isTodayInventoryItem)
    case 'pinned':
      return items.filter((item) => item.pinned)
    case 'all':
      return items
    case 'recent':
    default:
      return items.filter((item) => isRecentInventoryItem(item, nowMs))
  }
}

export function countInventoryModes(items: WorkItemView[], nowMs = Date.now()): Record<InventoryMode, number> {
  return {
    recent: items.filter((item) => isRecentInventoryItem(item, nowMs)).length,
    today: items.filter(isTodayInventoryItem).length,
    pinned: items.filter((item) => item.pinned).length,
    all: items.length,
  }
}

export function isTodayInventoryItem(item: WorkItemView) {
  return item.pinned || item.state === 'active' || item.today_active_seconds > 0
}

export function isRecentInventoryItem(item: WorkItemView, nowMs = Date.now()) {
  if (isTodayInventoryItem(item)) return true

  const touchedAt = item.last_seen_at || item.updated_at || item.created_at
  const touchedMs = Date.parse(touchedAt)
  if (!Number.isFinite(touchedMs)) return false

  return nowMs - touchedMs <= recentWindowMs
}

export function modeTitle(mode: InventoryMode) {
  switch (mode) {
    case 'today':
      return 'Дела с сегодняшним фокусом, закреплённые и активные'
    case 'pinned':
      return 'Закреплённые дела'
    case 'all':
      return 'Все дела'
    case 'recent':
    default:
      return 'Закреплённые, активные, сегодняшние и недавно затронутые дела'
  }
}
