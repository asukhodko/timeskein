import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  getBulkAcceptableReviewActions,
  getDayClosureStage,
  isBulkAcceptableReviewAction,
  isDayClosureReadyForFinalReport,
  isFinalDayClosureReport,
  shouldCompactAcceptAsIsReviewItems,
  shouldShowDayReviewDetails,
  shouldSummarizeReadyReviewItems,
} from '../apps/desktop/src/utils/dayClosure'

test('day closure completes only for a final report', () => {
  assert.equal(isFinalDayClosureReport({}), true)
  assert.equal(isFinalDayClosureReport({ activeFocus: false, activeWorkItemCount: 0 }), true)
})

test('draft reports do not complete day closure', () => {
  assert.equal(isFinalDayClosureReport({ activeFocus: true, activeWorkItemCount: 0 }), false)
  assert.equal(isFinalDayClosureReport({ activeFocus: false, activeWorkItemCount: 1 }), false)
  assert.equal(isFinalDayClosureReport({ activeFocus: true, activeWorkItemCount: 1 }), false)
})

test('day closure is ready only after review items are clear', () => {
  assert.equal(isDayClosureReadyForFinalReport({ activeFocus: false, activeWorkItemCount: 0 }), true)
  assert.equal(
    isDayClosureReadyForFinalReport({ activeFocus: false, activeWorkItemCount: 0, pendingReviewItemCount: 0 }),
    true
  )
  assert.equal(
    isDayClosureReadyForFinalReport({ activeFocus: false, activeWorkItemCount: 0, pendingReviewItemCount: 1 }),
    false
  )
  assert.equal(
    isDayClosureReadyForFinalReport({ activeFocus: true, activeWorkItemCount: 0, pendingReviewItemCount: 0 }),
    false
  )
})

test('day closure stage guides the evening review ritual', () => {
  assert.equal(getDayClosureStage({ hasFocusBlocks: false }), 'no_data')
  assert.equal(getDayClosureStage({ hasFocusBlocks: true, closureStarted: false }), 'not_started')
  assert.equal(
    getDayClosureStage({
      hasFocusBlocks: true,
      closureStarted: true,
      activeFocus: true,
      activeWorkItemCount: 0,
      pendingReviewItemCount: 0,
    }),
    'blocked'
  )
  assert.equal(
    getDayClosureStage({
      hasFocusBlocks: true,
      closureStarted: true,
      activeFocus: false,
      activeWorkItemCount: 0,
      pendingReviewItemCount: 1,
    }),
    'review'
  )
  assert.equal(
    getDayClosureStage({
      hasFocusBlocks: true,
      closureStarted: true,
      activeFocus: false,
      activeWorkItemCount: 0,
      pendingReviewItemCount: 0,
    }),
    'ready'
  )
})

test('day review details stay hidden until the evening closure ritual starts', () => {
  assert.equal(shouldShowDayReviewDetails('no_data'), false)
  assert.equal(shouldShowDayReviewDetails('not_started'), false)
  assert.equal(shouldShowDayReviewDetails('blocked'), true)
  assert.equal(shouldShowDayReviewDetails('review'), true)
  assert.equal(shouldShowDayReviewDetails('ready'), true)
})

test('ready review items stay compact while unresolved checks remain', () => {
  assert.equal(
    shouldSummarizeReadyReviewItems({ blockerCount: 1, reviewCount: 0, readyCount: 2 }),
    true
  )
  assert.equal(
    shouldSummarizeReadyReviewItems({ blockerCount: 0, reviewCount: 1, readyCount: 2 }),
    true
  )
  assert.equal(
    shouldSummarizeReadyReviewItems({ blockerCount: 0, reviewCount: 0, readyCount: 1 }),
    false
  )
  assert.equal(
    shouldSummarizeReadyReviewItems({ blockerCount: 1, reviewCount: 1, readyCount: 0 }),
    false
  )
})

test('bulk accept is available for safe accept-as-is review checks', () => {
  assert.deepEqual(
    getBulkAcceptableReviewActions([
      { level: 'review', action: 'accept_activity_zones' },
      { level: 'review', action: 'accept_entry_paths' },
      { level: 'ok' },
    ]),
    ['accept_activity_zones', 'accept_entry_paths']
  )
  assert.deepEqual(
    getBulkAcceptableReviewActions([
      { level: 'review', action: 'accept_activity_zones' },
      { level: 'review', action: 'accept_activity_zones' },
    ]),
    ['accept_activity_zones']
  )
  assert.deepEqual(
    getBulkAcceptableReviewActions([
      { level: 'blocker' },
      { level: 'review', action: 'accept_activity_zones' },
      { level: 'review', action: 'accept_entry_paths' },
    ]),
    []
  )
  assert.deepEqual(
    getBulkAcceptableReviewActions([
      { level: 'review', action: 'accept_activity_zones' },
      { level: 'review', action: 'stage_significant_gap' },
      { level: 'review', action: 'accept_entry_paths' },
    ]),
    ['accept_activity_zones', 'accept_entry_paths']
  )
  assert.deepEqual(
    getBulkAcceptableReviewActions([
      { level: 'review', action: 'accept_open_captures' },
      { level: 'review', action: 'accept_activity_zones' },
    ]),
    []
  )
  assert.deepEqual(
    getBulkAcceptableReviewActions([
      { level: 'review', action: 'accept_activity_zones' },
      { level: 'review' },
    ]),
    []
  )
  assert.deepEqual(
    getBulkAcceptableReviewActions([
      { level: 'review', action: 'accept_activity_zones' },
    ]),
    []
  )
  assert.equal(isBulkAcceptableReviewAction('accept_activity_zones'), true)
  assert.equal(isBulkAcceptableReviewAction('accept_open_captures'), false)
  assert.equal(isBulkAcceptableReviewAction('stage_significant_gap'), false)
  assert.equal(isBulkAcceptableReviewAction('stage_day_context'), false)
})

test('safe accept-as-is review groups can be collapsed into one calm action', () => {
  assert.equal(
    shouldCompactAcceptAsIsReviewItems([
      { level: 'review', action: 'accept_activity_zones' },
      { level: 'review', action: 'accept_entry_paths' },
    ]),
    true
  )
  assert.equal(
    shouldCompactAcceptAsIsReviewItems([
      { level: 'review', action: 'accept_activity_zones' },
      { level: 'review', action: 'stage_significant_gap' },
      { level: 'review', action: 'accept_entry_paths' },
    ]),
    true
  )
  assert.equal(
    shouldCompactAcceptAsIsReviewItems([
      { level: 'blocker' },
      { level: 'review', action: 'accept_activity_zones' },
      { level: 'review', action: 'accept_entry_paths' },
    ]),
    false
  )
  assert.equal(
    shouldCompactAcceptAsIsReviewItems([
      { level: 'review', action: 'accept_open_captures' },
      { level: 'review', action: 'accept_activity_zones' },
    ]),
    false
  )
  assert.equal(
    shouldCompactAcceptAsIsReviewItems([
      { level: 'review', action: 'accept_activity_zones' },
    ]),
    false
  )
})
