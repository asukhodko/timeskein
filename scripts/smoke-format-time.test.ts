import test from 'node:test'
import assert from 'node:assert/strict'
import { formatContextTimestamp } from '../apps/desktop/src/utils/formatTime'

test('context timestamps include a date for facts from another day', () => {
  const now = new Date(2026, 6, 16, 22, 0)
  const today = new Date(2026, 6, 16, 10, 15).toISOString()
  const yesterday = new Date(2026, 6, 15, 10, 15).toISOString()
  const previousYear = new Date(2025, 11, 31, 23, 45).toISOString()

  assert.equal(formatContextTimestamp(today, now), '10:15')
  assert.equal(formatContextTimestamp(yesterday, now), '15.07 · 10:15')
  assert.equal(formatContextTimestamp(previousYear, now), '31.12.2025 · 23:45')
})
