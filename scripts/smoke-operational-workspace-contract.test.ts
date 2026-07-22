import assert from 'node:assert/strict'
import test from 'node:test'

import {
  contractEditRevisionKind,
  dayContractValidationIssues,
  type ContractDraft,
} from '../apps/desktop/src/components/OperationalWorkspacePanel'

const item = (subject_id: string) => ({ kind: 'work_item' as const, subject_id })

function draft(overrides: Partial<ContractDraft> = {}): ContractDraft {
  return {
    active: [item('a'), item('b'), item('c')],
    firstActionWorkItemId: 'a',
    parked: [item('p')],
    overflow: [],
    whyNow: 'Это достаточно важный набор на сейчас.',
    ...overrides,
  }
}

test('complete contract revision is saveable', () => {
  assert.deepEqual(dayContractValidationIssues(draft(), ['a', 'b', 'c']), [])
})

test('removing the old first action explains the required replacement', () => {
  const issues = dayContractValidationIssues(
    draft({ active: [item('b'), item('c')], firstActionWorkItemId: '' }),
    ['b', 'c']
  )

  assert.deepEqual(issues, ['выбери первое действие внутри активного набора'])
})

test('disabled save names every missing contract condition', () => {
  const issues = dayContractValidationIssues(
    draft({ active: [item('a')], firstActionWorkItemId: 'a', parked: [], whyNow: ' ' }),
    ['a']
  )

  assert.deepEqual(issues, [
    'оставь в игре 2–3 направления',
    'укажи хотя бы один явно припаркованный конкурент',
    'кратко запиши, почему этот выбор важен сейчас',
  ])
})

test('contract keeps overflow visible without turning it into unlimited WIP', () => {
  const overflow = Array.from({ length: 21 }, (_, index) => item(`overflow-${index}`))

  assert.deepEqual(dayContractValidationIssues(draft({ overflow }), ['a', 'b', 'c']), [
    'оставь не больше двадцати пунктов переполнения',
  ])
})

test('one contract review action records reentry only after tracked work stopped', () => {
  assert.equal(contractEditRevisionKind(false, false), 'adjustment')
  assert.equal(contractEditRevisionKind(true, true), 'adjustment')
  assert.equal(contractEditRevisionKind(false, true), 'reentry')
})
