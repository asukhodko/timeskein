import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  appendTimestampedEventDraft,
  decodeTimestampedEventDraft,
  encodeTimestampedEventDraft,
  timestampedEventDraftStorageKey,
} from '../apps/desktop/src/utils/timestampedEventEntry'

test('timestamped event entry clears text only after successful append', async () => {
  const submitted: string[] = []

  const result = await appendTimestampedEventDraft('  важная веха  ', (text) => {
    submitted.push(text)
  })

  assert.equal(result.ok, true)
  assert.equal(result.submittedText, 'важная веха')
  assert.equal(result.nextDraft, '')
  assert.deepEqual(submitted, ['важная веха'])
})

test('timestamped event entry keeps typed text intact after append failure', async () => {
  const draft = '  не потерять это событие  '

  const result = await appendTimestampedEventDraft(draft, async () => {
    throw new Error('temporary API failure')
  })

  assert.equal(result.ok, false)
  assert.equal(result.submittedText, 'не потерять это событие')
  assert.equal(result.nextDraft, draft)
})

test('timestamped event entry does not submit blank or pending drafts', async () => {
  let calls = 0

  const blank = await appendTimestampedEventDraft('   ', () => {
    calls += 1
  })
  const pending = await appendTimestampedEventDraft('готовый текст', () => {
    calls += 1
  }, true)

  assert.equal(blank.ok, false)
  assert.equal(blank.nextDraft, '   ')
  assert.equal(pending.ok, false)
  assert.equal(pending.nextDraft, 'готовый текст')
  assert.equal(calls, 0)
})

test('timestamped event draft storage preserves text per local day and work item', () => {
  const draft = '  записать решение перед закрытием  '
  const encoded = encodeTimestampedEventDraft(draft)

  assert.equal(decodeTimestampedEventDraft(encoded), draft)
  assert.equal(decodeTimestampedEventDraft('{"text":42}'), '')
  assert.equal(decodeTimestampedEventDraft('not-json'), '')
  assert.equal(encodeTimestampedEventDraft(''), '')
  assert.equal(
    timestampedEventDraftStorageKey('item-1', new Date('2026-07-08T21:15:00+03:00')),
    'timeskein.work-item-event-draft.v1.2026-07-08.item-1'
  )
  assert.notEqual(
    timestampedEventDraftStorageKey('item-1', new Date('2026-07-08T21:15:00+03:00')),
    timestampedEventDraftStorageKey('item-2', new Date('2026-07-08T21:15:00+03:00'))
  )
  assert.notEqual(
    timestampedEventDraftStorageKey('item-1', new Date('2026-07-08T21:15:00+03:00')),
    timestampedEventDraftStorageKey('item-1', new Date('2026-07-09T09:00:00+03:00'))
  )
})
