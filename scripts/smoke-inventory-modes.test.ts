import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkItemView } from '@timeskein/contracts'
import {
  countInventoryModes,
  filterInventoryItems,
  getVisibleInventoryItems,
  inventoryModeForShortcut,
  isRecentInventoryItem,
  isTodayInventoryItem,
} from '../apps/desktop/src/utils/inventoryModes'

const now = Date.parse('2026-07-03T12:00:00.000Z')

test('inventory modes keep daily entry cheap on a multi-day inventory', () => {
  const items = [
    item('active-now', { state: 'active', updated_at: hoursAgo(240) }),
    item('today-focus', { today_active_seconds: 600, updated_at: hoursAgo(240) }),
    item('pinned-old', { pinned: true, updated_at: hoursAgo(240) }),
    item('recent-touch', { last_seen_at: hoursAgo(12), updated_at: hoursAgo(240) }),
    item('old-archive', { updated_at: hoursAgo(240) }),
  ]

  assert.deepEqual(titles(filterInventoryItems(items, 'today', now)), [
    'active-now',
    'today-focus',
    'pinned-old',
  ])
  assert.deepEqual(titles(filterInventoryItems(items, 'pinned', now)), ['pinned-old'])
  assert.deepEqual(titles(filterInventoryItems(items, 'recent', now)), [
    'active-now',
    'today-focus',
    'pinned-old',
    'recent-touch',
  ])
  assert.deepEqual(titles(filterInventoryItems(items, 'all', now)), [
    'active-now',
    'today-focus',
    'pinned-old',
    'recent-touch',
    'old-archive',
  ])
  assert.deepEqual(countInventoryModes(items, now), {
    recent: 4,
    today: 3,
    pinned: 1,
    all: 5,
  })
})

test('recent mode uses last_seen before updated or created timestamps', () => {
  const staleUpdatedButTouched = item('touched-recently', {
    last_seen_at: hoursAgo(1),
    updated_at: hoursAgo(200),
    created_at: hoursAgo(300),
  })
  const staleEverywhere = item('old', {
    last_seen_at: hoursAgo(100),
    updated_at: hoursAgo(90),
    created_at: hoursAgo(120),
  })

  assert.equal(isRecentInventoryItem(staleUpdatedButTouched, now), true)
  assert.equal(isRecentInventoryItem(staleEverywhere, now), false)
})

test('active search bypasses the current mode filter', () => {
  const items = [
    item('today-focus', { today_active_seconds: 600 }),
    item('old-archive', { updated_at: hoursAgo(240) }),
  ]

  assert.deepEqual(titles(getVisibleInventoryItems(items, 'today', '', now)), ['today-focus'])
  assert.deepEqual(titles(getVisibleInventoryItems(items, 'today', 'archive', now)), [
    'today-focus',
    'old-archive',
  ])
})

test('today mode includes pinned and active items even before today focus time exists', () => {
  assert.equal(isTodayInventoryItem(item('pinned', { pinned: true })), true)
  assert.equal(isTodayInventoryItem(item('active', { state: 'active' })), true)
  assert.equal(isTodayInventoryItem(item('fresh-but-idle', { updated_at: hoursAgo(1) })), false)
})

test('inventory mode shortcuts use Alt plus digits without stealing plain state digits', () => {
  assert.equal(inventoryModeForShortcut('Digit1', true), 'recent')
  assert.equal(inventoryModeForShortcut('Digit2', true), 'today')
  assert.equal(inventoryModeForShortcut('Digit3', true), 'pinned')
  assert.equal(inventoryModeForShortcut('Digit4', true), 'all')

  assert.equal(inventoryModeForShortcut('Digit1', false), undefined)
  assert.equal(inventoryModeForShortcut('Digit1', true, true), undefined)
  assert.equal(inventoryModeForShortcut('Digit1', true, false, true), undefined)
  assert.equal(inventoryModeForShortcut('Digit5', true), undefined)
})

function titles(items: WorkItemView[]) {
  return items.map((item) => item.title)
}

function hoursAgo(hours: number) {
  return new Date(now - hours * 60 * 60 * 1000).toISOString()
}

function item(title: string, overrides: Partial<WorkItemView> = {}): WorkItemView {
  return {
    id: title,
    title,
    type: 'task',
    activity_zone: 'work',
    state: 'unknown',
    pinned: false,
    refs_count: 0,
    refs: [],
    today_active_seconds: 0,
    total_active_seconds: 0,
    created_at: hoursAgo(240),
    updated_at: hoursAgo(240),
    ...overrides,
  }
}
