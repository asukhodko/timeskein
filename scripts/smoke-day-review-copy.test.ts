import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  formatDayReviewItem,
  formatDayReviewNextStep,
  formatDayClosurePrompt,
  formatDogfoodReportState,
  formatGapDayEventDraft,
  buildTrayStatusTitle,
  formatFocusMarkdownForReport,
  formatReportButtonLabel,
  formatReviewChecklistMarkdown,
  formatReviewActionLabel,
  formatShortClosureMarkdown,
  formatTelemetryForReport,
  isOpenGapExplanationText,
  pickNextGapForReview,
  type DayReviewAction,
  type DayReviewItem,
  type Gap,
} from '../apps/desktop/src/components/FocusPanel'
import { CAPTURE_INBOX_LABELS } from '../apps/desktop/src/components/CaptureInbox'
import { FOCUS_CORRECTION_LABELS } from '../apps/desktop/src/components/FocusCorrectionDialog'
import { MISSED_FOCUS_BLOCK_LABELS } from '../apps/desktop/src/components/MissedFocusBlockDialog'
import { APP_UI_LABELS } from '../apps/desktop/src/utils/appUiLabels'
import { formatClockTime, formatRelativeTime } from '../apps/desktop/src/utils/formatTime'
import { ITEM_UI_LABELS, formatCreateItemError } from '../apps/desktop/src/utils/itemUiLabels'

test('capture inbox controls keep interruption handling in Russian', () => {
  assert.equal(CAPTURE_INBOX_LABELS.placeholder, 'Зафиксировать отвлечение...')
  assert.equal(CAPTURE_INBOX_LABELS.submit, 'Записать')
  assert.equal(CAPTURE_INBOX_LABELS.heading, 'Инбокс')
  assert.equal(CAPTURE_INBOX_LABELS.makeItem, 'В дело')
  assert.equal(CAPTURE_INBOX_LABELS.appendEvent, 'В событие')
  assert.equal(CAPTURE_INBOX_LABELS.done, 'Готово')
  assert.equal(CAPTURE_INBOX_LABELS.createError, 'Не удалось записать отвлечение')
  assert.equal(CAPTURE_INBOX_LABELS.processError, 'Не удалось обработать отвлечение')
})

test('item dialogs keep user-facing wording in Russian', () => {
  assert.equal(ITEM_UI_LABELS.createTitle, 'Создать дело')
  assert.equal(ITEM_UI_LABELS.noteDescription, 'Описание дела')
  assert.equal(ITEM_UI_LABELS.deleteTitle, 'Удалить дело')
  assert.equal(formatCreateItemError(new Error('A work item with this title already exists')), 'Дело с таким названием уже есть')
  assert.equal(formatCreateItemError('boom'), 'Не удалось создать дело')

  const labels = Object.values(ITEM_UI_LABELS).join('\n')
  assert(!labels.includes('Work Item'), 'user-facing item dialog labels should not expose the model-side term')
  assert(!labels.includes('work item'), 'user-facing item dialog labels should not expose the model-side term')
})

test('agent unavailable message stays useful during dogfood', () => {
  assert.equal(APP_UI_LABELS.agentUnavailableTitle, 'Агент недоступен')
  assert.equal(APP_UI_LABELS.agentUnavailableHint, 'Перезапусти Timeskein или проверь локальный агент')

  const labels = Object.values(APP_UI_LABELS).join('\n')
  assert(!labels.includes('mock server'), 'runtime UI should not send dogfood users into dev-server wording')
  assert(!labels.includes('mock'), 'runtime UI should not expose mock-only wording')
})

test('clock time stays 24-hour and Russian-facing', () => {
  assert.equal(formatClockTime('2026-07-07T13:14:00'), '13:14')
  assert.equal(formatClockTime(undefined), 'сейчас')
  assert(!formatClockTime('2026-07-07T13:14:00').includes('PM'))
  assert(!formatClockTime('2026-07-07T01:14:00').includes('AM'))
})

test('relative time stays Russian-facing in work item cards', () => {
  const now = new Date('2026-07-07T12:00:00+03:00')

  assert.equal(formatRelativeTime(undefined, now), '—')
  assert.equal(formatRelativeTime('2026-07-07T11:59:30+03:00', now), 'сейчас')
  assert.equal(formatRelativeTime('2026-07-07T11:55:00+03:00', now), '5 мин назад')
  assert.equal(formatRelativeTime('2026-07-07T10:00:00+03:00', now), '2 ч назад')
  assert.equal(formatRelativeTime('2026-07-04T12:00:00+03:00', now), '3 дн назад')
  assert(!formatRelativeTime('2026-07-07T11:55:00+03:00', now).includes('m'))
  assert(!formatRelativeTime('2026-07-07T10:00:00+03:00', now).includes('h'))
  assert(!formatRelativeTime('2026-07-04T12:00:00+03:00', now).includes('d'))
  assert(!formatRelativeTime('2026-07-07T11:59:30+03:00', now).includes('now'))
})

test('tray status labels stay Russian-facing', () => {
  const now = new Date('2026-07-07T10:30:00+03:00')
  assert.equal(buildTrayStatusTitle(undefined, now, 65 * 60), '1 ч 5 мин сегодня')
  assert.equal(
    buildTrayStatusTitle(
      {
        id: 'focus-1',
        title: 'Проверка',
        state: 'active',
        started_at: '2026-07-07T10:10:00+03:00',
        stopped_at: undefined,
        note: undefined,
        target_seconds: 15 * 60,
        active_seconds: 20 * 60,
        over_target_seconds: 5 * 60,
        work_item_id: 'item-1',
        work_item_title: 'Проверка',
        activity_zone: 'work',
      },
      now
    ),
    '20 мин в фокусе +5 мин'
  )
})

test('focus correction labels keep evening fixes calm', () => {
  assert.equal(FOCUS_CORRECTION_LABELS.title, 'Исправить фокус-блок')
  assert.equal(FOCUS_CORRECTION_LABELS.workItem, 'Дело')
  assert.equal(FOCUS_CORRECTION_LABELS.splitAt, 'Граница разделения')
  assert.equal(FOCUS_CORRECTION_LABELS.secondWorkItem, 'Дело после разделения')
  assert.equal(FOCUS_CORRECTION_LABELS.secondNote, 'Заметка для второго блока')
  assert.equal(MISSED_FOCUS_BLOCK_LABELS.title, 'Добавить пропущенный блок')
  assert.equal(MISSED_FOCUS_BLOCK_LABELS.workItem, 'Дело')

  const correctionLabels = Object.values(FOCUS_CORRECTION_LABELS).join('\n')
  const missedBlockLabels = Object.values(MISSED_FOCUS_BLOCK_LABELS).join('\n')
  assert(!correctionLabels.includes('Правый Work Item'), 'split correction should not use model-side wording')
  assert(!correctionLabels.includes('Заметка справа'), 'split correction should not use spatial wording')
  assert(!missedBlockLabels.includes('Work Item'), 'missed-block correction should use user-facing wording')
})

test('day review checklist keeps the evening ritual in Russian', () => {
  const items: DayReviewItem[] = [
    { level: 'blocker', title: 'Stop the active focus block', detail: 'Вход в день' },
    { level: 'blocker', title: 'Clear active Work Item state', detail: '1 дело с активным статусом' },
    { level: 'review', title: 'Classify significant gaps', detail: '1/2 больших разрывов без события дня' },
    { level: 'review', title: 'Resolve, convert, or accept open captures', detail: '1 открыто' },
    {
      level: 'review',
      title: 'Confirm Work Item today/total badges',
      detail: '2 дела были в работе сегодня',
      action: 'accept_work_item_time_badges',
    },
    { level: 'review', title: 'Exercise start and continue paths', detail: '1 вводом, 0 из списка, 1 остановок' },
    { level: 'review', title: 'Test window entrypoints', detail: '1 запросов показа, 0 запросов скрытия' },
    { level: 'review', title: 'Review failed focus corrections', detail: '1 ошибок коррекции' },
    {
      level: 'review',
      title: 'Review Activity Zone coverage',
      detail: 'В отчёте видна только одна зона',
      action: 'accept_activity_zones',
    },
    { level: 'ok', title: 'Ready to copy final report', detail: 'Автоматических замечаний нет' },
  ]

  assert.equal(formatDayReviewItem(items[0]).title, 'Остановить активный фокус-блок')
  assert.equal(formatDayReviewItem(items[1]).title, 'Снять активный статус с дела')
  assert.equal(formatDayReviewItem(items[1]).detail, '1 дело с активным статусом')
  assert.equal(formatDayReviewItem(items[2]).title, 'Объяснить большие разрывы')
  assert.equal(formatDayReviewItem(items[2]).detail, '1 из 2 больших разрывов без события дня')
  assert.equal(formatDayReviewItem(items[3]).title, 'Разобрать открытые отвлечения')
  assert.equal(formatDayReviewItem(items[3]).detail, '1 открытое отвлечение')
  assert.equal(formatDayReviewItem(items[4]).title, 'Проверить время по делам')
  assert.equal(formatDayReviewItem(items[4]).detail, '2 дела были в работе сегодня')
  assert.equal(formatDayReviewItem(items[5]).detail, '1 старт вводом, 0 стартов из списка, 1 остановка')
  assert.equal(formatDayReviewItem(items[6]).detail, '1 запрос на показ, 0 запросов на скрытие')
  assert.equal(formatDayReviewItem(items[7]).detail, '1 ошибка коррекции')
  assert.equal(formatDayReviewItem(items[8]).title, 'Проверить зоны активности')
  assert.equal(formatDayReviewItem(items[9]).title, 'Можно копировать финальный отчёт')

  const markdown = formatReviewChecklistMarkdown(items)
  assert(markdown.includes('## Проверка перед отчётом'), 'review checklist heading should be localized')
  assert(
    markdown.includes('Ближайшее действие: закрыть красный пункт: Остановить активный фокус-блок.'),
    'review checklist should name the next concrete action'
  )
  assert(markdown.includes('### Сначала закрыть'), 'blocker group should be explicit')
  assert(markdown.includes('### Дописать или исправить'), 'fix-up group should be explicit')
  assert(markdown.includes('### Осознанно проверить'), 'accept-as-is group should be explicit')
  assert(markdown.includes('### Готово'), 'ready group should be explicit')
  assert(markdown.includes('Остановить активный фокус-блок'), 'blocker label should be localized')
  assert(markdown.includes('Снять активный статус с дела'), 'active Work Item blocker should be user-facing')
  assert(markdown.includes('Объяснить большие разрывы'), 'review label should be localized')
  assert(markdown.includes('Проверить время по делам'), 'Work Item time review should be user-facing')
  assert(markdown.includes('Проверить зоны активности'), 'optional review label should be localized')
  assert(markdown.includes('Можно копировать финальный отчёт'), 'ready label should be localized')
  assert(!markdown.includes('Review before report'), 'old English heading should not leak into the report')
  assert(!markdown.includes('Stop the active focus block'), 'old English blocker should not leak into the report')
  assert(!markdown.includes('Work Item'), 'model-side Work Item wording should not leak into review checklist')
  assert(!markdown.includes('Work Item с активным статусом'), 'model-side wording should not leak into review details')
})

test('day review next step points to one calm action', () => {
  assert.equal(
    formatDayReviewNextStep([
      { level: 'blocker', title: 'Stop the active focus block', detail: 'Вход в день' },
      { level: 'review', title: 'Classify significant gaps', action: 'stage_significant_gap' },
    ]),
    'закрыть красный пункт: Остановить активный фокус-блок. Нажми «Стоп» у активного фокуса.'
  )

  assert.equal(
    formatDayReviewNextStep([
      { level: 'blocker', title: 'Clear active Work Item state', detail: '1 дело с активным статусом' },
    ]),
    'закрыть красный пункт: Снять активный статус с дела. Выбери активное дело и смени состояние с «Активно».'
  )

  assert.equal(
    formatDayReviewNextStep([
      { level: 'review', title: 'Classify significant gaps', action: 'stage_significant_gap' },
      { level: 'review', title: 'No day or Work Item notes/events', action: 'stage_day_context' },
    ]),
    'дописать или исправить: Объяснить большие разрывы. Ещё 1.'
  )

  assert.equal(
    formatDayReviewNextStep([
      { level: 'review', title: 'Classify significant gaps', action: 'stage_significant_gap' },
    ]),
    'дописать или исправить: Объяснить большие разрывы. Нажми «Объяснить».'
  )

  assert.equal(
    formatDayReviewNextStep([
      { level: 'review', title: 'Confirm Work Item today/total badges', action: 'accept_work_item_time_badges' },
    ]),
    'осознанно проверить: Проверить время по делам. Нажми «Время верно», если данные уже честные.'
  )

  assert.equal(
    formatDayReviewNextStep([
      { level: 'review', title: 'Review Activity Zone coverage', action: 'accept_activity_zones' },
      { level: 'review', title: 'Test window entrypoints', action: 'accept_window_entrypoints' },
    ]),
    'осознанно проверить 2 пункта или нажать «Всё проверено», если данные уже честные.'
  )

  assert.equal(
    formatDayReviewNextStep([{ level: 'ok', title: 'Ready to copy final report' }]),
    'нажать «Копировать отчёт».'
  )
})

test('day review action buttons explain what will happen', () => {
  const labels: Record<DayReviewAction, string> = {
    stage_significant_gap: 'Объяснить',
    stage_open_gap: 'Объяснить',
    accept_open_captures: 'Оставить открытыми',
    accept_work_item_time_badges: 'Время верно',
    accept_activity_zones: 'Зоны верны',
    accept_capture_usage: 'Инбокс проверен',
    accept_entry_paths: 'Пути проверены',
    accept_window_entrypoints: 'Окно проверено',
    accept_tracking_accuracy: 'Трекинг верен',
    stage_day_context: 'Добавить контекст',
  }

  for (const [action, label] of Object.entries(labels) as [DayReviewAction, string][]) {
    assert.equal(formatReviewActionLabel(action), label)
    assert.notEqual(label, 'Принять')
  }
})

test('dogfood report state stays draft until review items are clear', () => {
  assert.equal(
    formatDogfoodReportState({ activeFocus: true, activeWorkItemCount: 0, pendingReviewItemCount: 0 }),
    'черновик — фокус-блок ещё активен'
  )
  assert.equal(
    formatDogfoodReportState({ activeFocus: false, activeWorkItemCount: 1, pendingReviewItemCount: 0 }),
    'черновик — у дела ещё стоит активный статус'
  )
  assert.equal(
    formatDogfoodReportState({ activeFocus: false, activeWorkItemCount: 0, pendingReviewItemCount: 2 }),
    'черновик — осталось 2 проверки перед финальным отчётом'
  )
  assert.equal(
    formatDogfoodReportState({ activeFocus: false, activeWorkItemCount: 0, pendingReviewItemCount: 0 }),
    'финальный — нет активных фокус-блоков, активных дел и незакрытых проверок'
  )
})

test('report button starts the closure ritual before it offers copying', () => {
  assert.equal(
    formatReportButtonLabel({
      copyState: 'idle',
      closureStarted: false,
      reportIsDraft: false,
      reportHasPendingReview: false,
    }),
    'Начать закрытие'
  )
  assert.equal(
    formatReportButtonLabel({
      copyState: 'idle',
      closureStarted: true,
      reportIsDraft: true,
      reportHasPendingReview: false,
    }),
    'Копировать черновик'
  )
  assert.equal(
    formatReportButtonLabel({
      copyState: 'idle',
      closureStarted: true,
      reportIsDraft: false,
      reportHasPendingReview: true,
    }),
    'Копировать черновик'
  )
  assert.equal(
    formatReportButtonLabel({
      copyState: 'idle',
      closureStarted: true,
      reportIsDraft: false,
      reportHasPendingReview: false,
    }),
    'Копировать отчёт'
  )
  assert.equal(
    formatReportButtonLabel({
      copyState: 'copied',
      closureStarted: false,
      reportIsDraft: false,
      reportHasPendingReview: false,
    }),
    'Скопировано'
  )
})

test('day closure start prompt stays small and calm', () => {
  const prompt = formatDayClosurePrompt('not_started', { blockers: 0, reviews: 0 })

  assert.equal(prompt, 'Когда рабочий день закончен, начни закрытие дня: Timeskein измерит, сколько заняло короткое закрытие.')
  assert(!prompt.includes('вечерний разбор'), 'start prompt should not frame closure as another review task')
})

test('gap review helpers keep repeated Explain actions on the next unresolved gap', () => {
  const gaps: Gap[] = [
    { from: '2026-07-07T09:00:00Z', to: '2026-07-07T09:30:00Z', seconds: 30 * 60 },
    { from: '2026-07-07T11:00:00Z', to: '2026-07-07T11:40:00Z', seconds: 40 * 60 },
  ]

  assert.equal(pickNextGapForReview(gaps, []), gaps[0])
  assert.equal(
    pickNextGapForReview(gaps, [{ text: formatGapDayEventDraft(gaps[0]) + 'обед и восстановление' }]),
    gaps[1]
  )
  assert.equal(pickNextGapForReview(gaps, [{ text: 'Открытый разрыв 12:00-12:30: перерыв' }]), gaps[1])
  assert.equal(pickNextGapForReview(gaps, [{ text: 'обычная заметка о ходе дня' }]), gaps[0])
  assert.equal(isOpenGapExplanationText('Открытый разрыв 12:00-12:30: ужин'), true)
  assert.equal(isOpenGapExplanationText('open gap 12:00-12:30: dinner'), true)
})

test('copied report keeps key focus and telemetry sections localized', () => {
  const focusMarkdown = [
    '# Timeskein focus day - 02.07.2026',
    '',
    'Total tracked: 1:00:00',
    'Work focus: 0:50:00',
    'Non-work tracked: 0:10:00',
    'Entrances: 2',
    '',
    '| Time | Duration | Zone | Work Item | Note |',
    '| --- | ---: | --- | --- | --- |',
    '| 12:00-12:50 | 0:50 | Work | Проверка |  |',
    '',
    '## By Work Item',
    '',
    '| Duration | Entrances | Work Item |',
    '| ---: | ---: | --- |',
    '| 0:50 | 1 | Проверка |',
    '',
    '## Day Events',
    '',
    '| Time | Zone | During | Event |',
    '| --- | --- | --- | --- |',
    '| 12:00 | Recovery | day | Перерыв |',
    '',
    '## Work Item Events',
    '',
    '| Time | Work Item | During | Event |',
    '| --- | --- | --- | --- |',
    '| 12:05 | Проверка | Проверка | Следующий шаг |',
  ].join('\n')

  const telemetryMarkdown = [
    '## App Telemetry',
    '',
    'Total events: 3',
    'Start requests: 1',
    'Switch requests: 2',
    'Stop requests: 1',
    'Typed/selected entry requests: 3/4',
    'Start/stop failures: 0/1',
    'Window shown/hidden: 5/6',
    'Window show/hide requests: 7/8',
    'Window drag starts: 9',
    'Copy failures: 0',
    'Manual copy fallbacks: 0',
    'Capture created/resolved/converted: 1/2/3',
    'Capture follow-up reviews: 1',
    'Work Item time badge reviews: 1',
    'Activity Zone reviews: 1',
    'Capture usage reviews: 1',
    'Entry path reviews: 1',
    'Window entrypoint reviews: 1',
    'Capture updated/deleted: 2/1',
    'Capture failures create/resolve/update/delete/convert: 0/0/0/0/0',
    'Corrections requested/applied/reviewed/failed: 1/1/1/0',
    'Day closure started/completed: 1/1',
    'Last day closure duration: 0:07',
    'API errors: 0',
    'Already-active start attempts: 0',
    'Stale runtime recoveries: 0',
    'Average start latency: n/a',
    'Slow window-to-focus gaps: 0',
    '',
    '### Events By Kind',
    '',
    '| Count | Kind |',
    '| ---: | --- |',
    '| 1 | day_closure_completed |',
  ].join('\n')

  const localizedFocus = formatFocusMarkdownForReport(focusMarkdown)
  assert(localizedFocus.includes('# Фокус-день Timeskein — 02.07.2026'))
  assert(localizedFocus.includes('Всего учтено: 1:00:00'))
  assert(localizedFocus.includes('| 12:00-12:50 | 0:50 | Работа | Проверка |  |'))
  assert(localizedFocus.includes('## По делам'))
  assert(localizedFocus.includes('## События дня'))
  assert(localizedFocus.includes('| 12:00 | Восстановление | день | Перерыв |'))
  assert(localizedFocus.includes('## События дел'))
  assert(!localizedFocus.includes('Total tracked:'), 'raw English focus summary should not leak into copied report')
  assert(!localizedFocus.includes('| Work |'), 'raw English Work zone should not leak into copied report')
  assert(!localizedFocus.includes('| Recovery |'), 'raw English Recovery zone should not leak into copied report')
  assert(!localizedFocus.includes('## Day Events'), 'raw English day events heading should not leak into copied report')
  assert(!localizedFocus.includes('## По Work Item'), 'model-side Work Item heading should not leak into copied report')
  assert(!localizedFocus.includes('## События Work Item'), 'model-side Work Item event heading should not leak into copied report')

  const localizedTelemetry = formatTelemetryForReport(telemetryMarkdown)
  assert(localizedTelemetry.includes('## Телеметрия приложения'))
  assert(localizedTelemetry.includes('Всего событий: 3'))
  assert(localizedTelemetry.includes('Запросов переключения: 2'))
  assert(localizedTelemetry.includes('Входов вводом/из списка: 3/4'))
  assert(localizedTelemetry.includes('Ошибок старта/остановки: 0/1'))
  assert(localizedTelemetry.includes('Окно показано/скрыто: 5/6'))
  assert(localizedTelemetry.includes('Запросы показать/скрыть окно: 7/8'))
  assert(localizedTelemetry.includes('Начатых перетаскиваний окна: 9'))
  assert(localizedTelemetry.includes('Закрытий дня начато/завершено: 1/1'))
  assert(localizedTelemetry.includes('Последняя длительность закрытия дня: 0:07'))
  assert(localizedTelemetry.includes('Средняя задержка старта: нет данных'))
  assert(localizedTelemetry.includes('Ошибок API: 0'))
  assert(localizedTelemetry.includes('Восстановлений устаревшего состояния агента: 0'))
  assert(localizedTelemetry.includes('Медленных переходов окно-фокус: 0'))
  assert(localizedTelemetry.includes('Отвлечений создано/закрыто/превращено: 1/2/3'))
  assert(localizedTelemetry.includes('Отвлечений изменено/удалено: 2/1'))
  assert(localizedTelemetry.includes('Ручных копирований вместо буфера: 0'))
  assert(localizedTelemetry.includes('Проверок открытых отвлечений: 1'))
  assert(localizedTelemetry.includes('Проверок использования инбокса: 1'))
  assert(localizedTelemetry.includes('Проверок времени по делам: 1'))
  assert(localizedTelemetry.includes('Проверок зон активности: 1'))
  assert(localizedTelemetry.includes('Проверок путей входа: 1'))
  assert(localizedTelemetry.includes('Проверок входа в окно: 1'))
  assert(!localizedTelemetry.includes('Проверок бейджей времени Work Item:'), 'model-side Work Item telemetry label should not leak into copied report')
  assert(localizedTelemetry.includes('Ошибок отвлечений: создание/закрытие/изменение/удаление/превращение: 0/0/0/0/0'))
  assert(localizedTelemetry.includes('Коррекций запрошено/применено/проверено/ошибок: 1/1/1/0'))
  assert(localizedTelemetry.includes('### События по типам'))
  assert(localizedTelemetry.includes('| 1 | закрытие дня завершено |'))
  assert(!localizedTelemetry.includes('## App Telemetry'), 'raw English telemetry heading should not leak into copied report')
  assert(!localizedTelemetry.includes('Total events:'), 'raw English telemetry counter should not leak into copied report')
  assert(!localizedTelemetry.includes('Window shown'), 'raw English window telemetry should not leak into copied report')
  assert(!localizedTelemetry.includes('Capture created'), 'raw English capture telemetry should not leak into copied report')
  assert(!localizedTelemetry.includes('Corrections requested'), 'raw English correction telemetry should not leak into copied report')
  assert(!localizedTelemetry.includes('API errors:'), 'raw English API telemetry should not leak into copied report')
  assert(!localizedTelemetry.includes('day_closure_completed'), 'raw event kind should not leak into copied report')
  assert(!localizedTelemetry.includes('typed/selected'), 'raw mixed-language entry label should not leak into copied report')
  assert(!localizedTelemetry.includes('n/a'), 'raw unavailable value should not leak into copied report')
  assert(!localizedTelemetry.includes('Проверок follow-up по отвлечениям:'), 'old mixed-language follow-up label should not leak into copied report')
  assert(!localizedTelemetry.includes('Проверок использования Inbox:'), 'old mixed-language Inbox label should not leak into copied report')

  const shortClosure = formatShortClosureMarkdown(telemetryMarkdown)
  assert(shortClosure.includes('## Короткое закрытие'))
  assert(shortClosure.includes('Закрытие уложилось в 10 минут: да (0:07)'))
  assert(shortClosure.includes('Главное наблюдение дня:'))

  const missingClosure = formatShortClosureMarkdown('## App Telemetry\n\nTotal events: 0')
  assert(missingClosure.includes('Закрытие уложилось в 10 минут: нет данных (закрытие не измерено)'))
})
