import test from 'node:test'
import assert from 'node:assert/strict'
import type { FocusSessionView } from '../packages/contracts/src/index'
import { findFocusSessionOverlaps } from '../apps/desktop/src/utils/focusSessionOverlaps'

function session(id: string, from: string, to: string): FocusSessionView {
  return {
    id,
    title: id,
    activity_zone: 'work',
    state: 'stopped',
    target_seconds: 1500,
    active_seconds: (new Date(to).getTime() - new Date(from).getTime()) / 1000,
    over_target_seconds: 0,
    started_at: from,
    stopped_at: to,
    updated_at: to,
  }
}

test('detects overlapping focus sessions and calculates the shared interval', () => {
  const overlaps = findFocusSessionOverlaps([
    session('ППП', '2026-07-16T14:18:00.000Z', '2026-07-16T14:35:00.000Z'),
    session('Второй блок', '2026-07-16T14:26:00.000Z', '2026-07-16T14:51:00.000Z'),
  ])

  assert.equal(overlaps.length, 1)
  assert.equal(overlaps[0].first.id, 'ППП')
  assert.equal(overlaps[0].second.id, 'Второй блок')
  assert.equal(overlaps[0].from.toISOString(), '2026-07-16T14:26:00.000Z')
  assert.equal(overlaps[0].to.toISOString(), '2026-07-16T14:35:00.000Z')
  assert.equal(overlaps[0].seconds, 9 * 60)
})

test('does not treat touching boundaries or an active block as a closed overlap', () => {
  const first = session('one', '2026-07-16T10:00:00.000Z', '2026-07-16T10:30:00.000Z')
  const second = session('two', '2026-07-16T10:30:00.000Z', '2026-07-16T11:00:00.000Z')
  const active = { ...second, id: 'active', state: 'active' as const, stopped_at: undefined }

  assert.deepEqual(findFocusSessionOverlaps([first, second, active]), [])
})
