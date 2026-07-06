import { strict as assert } from 'node:assert'
import test from 'node:test'

import { isDayClosureReadyForFinalReport, isFinalDayClosureReport } from '../apps/desktop/src/utils/dayClosure'

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
