import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveWorkItemOpenAction } from '../apps/desktop/src/utils/workItemOpenAction'

test('Enter always opens the Work Item editor even when a primary URL exists', () => {
  const itemWithPrimaryUrl = {
    id: 'work-item',
    refs: [{
      id: 'ref-url',
      kind: 'url',
      value: 'https://example.test',
      is_primary: true,
    }],
  }
  assert.deepEqual(resolveWorkItemOpenAction(itemWithPrimaryUrl), { kind: 'edit' })
})

test('Enter opens the editor for any selected item and does nothing without selection', () => {
  assert.deepEqual(resolveWorkItemOpenAction({ id: 'work-item' }), { kind: 'edit' })
  assert.deepEqual(resolveWorkItemOpenAction(), { kind: 'none' })
})
