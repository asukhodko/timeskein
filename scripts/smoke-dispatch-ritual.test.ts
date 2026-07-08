import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeDispatchRitualDraft,
  dispatchRitualDraftStorageKey,
  encodeDispatchRitualDraft,
  formatDispatchRitualEvent,
  isDispatchRitualStartReady,
} from '../apps/desktop/src/utils/dispatchRitual'

test('dispatch ritual event records active set, first focus, parking and reason', () => {
  const event = formatDispatchRitualEvent({
    mode: 'day_entry',
    activeSet: '  входящие, цели команды, синк  ',
    firstFocus: '  Подготовить цели команды  ',
    parked: '  личные проекты, мелкие чаты  ',
    reason: '  это главный внешний дедлайн  ',
  })

  assert.equal(
    event,
    'Вход в день: active set: входящие, цели команды, синк; первый фокус: Подготовить цели команды; припарковано: личные проекты, мелкие чаты; почему достаточно важно: это главный внешний дедлайн'
  )
})

test('dispatch ritual start requires selected first focus', () => {
  assert.equal(isDispatchRitualStartReady({
    mode: 'return_after_break',
    activeSet: 'надо вернуться после обеда',
    firstFocus: '',
    parked: '',
    reason: '',
  }), false)

  assert.equal(isDispatchRitualStartReady({
    mode: 'return_after_break',
    activeSet: '',
    firstFocus: 'Разобрать хвост',
    parked: '',
    reason: '',
  }), true)
})

test('dispatch ritual draft survives storage roundtrip and bad values normalize', () => {
  const encoded = encodeDispatchRitualDraft({
    mode: 'return_after_break',
    activeSet: 'A\nB',
    firstFocus: '  Следующий блок  ',
    parked: '',
    reason: '  достаточно важно  ',
  })

  assert.deepEqual(decodeDispatchRitualDraft(encoded), {
    mode: 'return_after_break',
    activeSet: 'A B',
    firstFocus: 'Следующий блок',
    parked: '',
    reason: 'достаточно важно',
  })

  assert.deepEqual(decodeDispatchRitualDraft('not json'), {
    mode: 'day_entry',
    activeSet: '',
    firstFocus: '',
    parked: '',
    reason: '',
  })
})

test('dispatch ritual draft key is local-day scoped', () => {
  assert.equal(
    dispatchRitualDraftStorageKey(new Date('2026-07-08T21:00:00+03:00')),
    'timeskein.dispatch-ritual-draft.v1.2026-07-08'
  )
})
