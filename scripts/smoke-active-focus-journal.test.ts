import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  ACTIVE_FOCUS_JOURNAL_KIND_LABELS,
  activeFocusJournalDraftStorageKey,
  decodeActiveFocusJournalDraft,
  encodeActiveFocusJournalDraft,
  evidenceKindForJournalKind,
  formatActiveFocusJournalText,
} from '../apps/desktop/src/utils/activeFocusJournal'

test('active focus journal prefixes user thoughts with a calm Russian kind', () => {
  assert.equal(formatActiveFocusJournalText('thought', '  проверить гипотезу  '), 'Мысль: проверить гипотезу')
  assert.equal(formatActiveFocusJournalText('decision', 'делаем сейчас'), 'Решение: делаем сейчас')
  assert.equal(formatActiveFocusJournalText('question', 'что дальше?'), 'Вопрос: что дальше?')
  assert.equal(formatActiveFocusJournalText('next_step', 'написать Диме'), 'Следующий шаг: написать Диме')
  assert.equal(formatActiveFocusJournalText('milestone', 'черновик готов'), 'Веха: черновик готов')
  assert.equal(formatActiveFocusJournalText('interruption', 'написали в мессенджер'), 'Отвлечение: написали в мессенджер')
  assert.equal(evidenceKindForJournalKind('result'), 'result')
  assert.equal(evidenceKindForJournalKind('blocker'), 'blocker')
  assert.equal(evidenceKindForJournalKind('thought'), 'observation')
  assert.equal(formatActiveFocusJournalText('thought', '   '), '')

  const labels = Object.values(ACTIVE_FOCUS_JOURNAL_KIND_LABELS).join('\n')
  assert(!labels.includes('Work Item'), 'active journal kind labels should stay user-facing')
})

test('active focus journal draft survives reloads without unsafe values', () => {
  const encoded = encodeActiveFocusJournalDraft({
    text: 'Нужно записать решение',
    kind: 'decision',
    target: 'work_item',
    refChoice: 'ref-1',
    newRefKind: 'issue_key',
    newRefValue: '',
  })

  assert.deepEqual(decodeActiveFocusJournalDraft(encoded), {
    text: 'Нужно записать решение',
    kind: 'decision',
    target: 'work_item',
    refChoice: 'ref-1',
    newRefKind: 'issue_key',
    newRefValue: '',
  })

  assert.deepEqual(decodeActiveFocusJournalDraft('{"text":"x","kind":"bad","target":"bad"}'), {
    text: 'x',
    kind: 'thought',
    target: 'work_item',
    refChoice: '',
    newRefKind: 'url',
    newRefValue: '',
  })

  assert.deepEqual(decodeActiveFocusJournalDraft('not json'), {
    text: '',
    kind: 'thought',
    target: 'work_item',
    refChoice: '',
    newRefKind: 'url',
    newRefValue: '',
  })
})

test('active focus journal draft key is scoped to day and active anchor', () => {
  const date = new Date('2026-07-08T21:15:00+03:00')

  assert.equal(
    activeFocusJournalDraftStorageKey('item-1', date),
    'timeskein.active-focus-journal-draft.v1.2026-07-08.item-1'
  )
  assert.notEqual(
    activeFocusJournalDraftStorageKey('item-1', date),
    activeFocusJournalDraftStorageKey('item-2', date)
  )
  assert.notEqual(
    activeFocusJournalDraftStorageKey('item-1', date),
    activeFocusJournalDraftStorageKey('item-1', new Date('2026-07-09T09:00:00+03:00'))
  )
})
