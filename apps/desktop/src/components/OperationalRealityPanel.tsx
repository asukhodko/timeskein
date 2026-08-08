import { useEffect, useMemo, useState } from 'react'
import type {
  OperationalRealityItemView,
  OperationalRealityView as OperationalRealityProjection,
  OperationalState,
} from '@timeskein/contracts'

import { logAppEvent } from '../api/client'
import { useConvertCaptureToWorkItem, useResolveCapture } from '../hooks/useCaptures'
import { useStartFocusSession } from '../hooks/useFocusSessions'
import {
  useFollowUpOperationalDecision,
  useOperationalReality,
  useSetOperationalNextAction,
  useSetOperationalState,
} from '../hooks/useOperationalReality'
import { formatContextTimestamp } from '../utils/formatTime'

const STATES: Array<{ id: OperationalState; label: string }> = [
  { id: 'waiting', label: 'ожидает' },
  { id: 'blocked', label: 'заблокировано' },
  { id: 'parked', label: 'припарковано' },
  { id: 'reactive', label: 'реактивное' },
  { id: 'completed', label: 'завершено' },
  { id: 'stale-important', label: 'важное без движения' },
  { id: 'meeting-tail', label: 'хвост встречи' },
  { id: 'unknown', label: 'неясно' },
]

export default function OperationalRealityPanel() {
  const [expanded, setExpanded] = useState(true)
  const query = useOperationalReality()
  const summary = query.data?.summary

  return (
    <section className="border-b border-cyan-900/50 bg-gray-950/45" aria-label="Рабочая реальность">
      <div className="flex flex-col items-stretch gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={expanded ? 'Скрыть рабочую реальность' : 'Показать рабочую реальность'}
        >
          <span className="text-sm font-semibold text-cyan-200">Рабочая реальность</span>
          {summary && (
            <span className="truncate text-xs text-gray-500">
              {summary.requiring_attention} требуют решения · {summary.confirmed} подтверждено · {summary.legacy_current + summary.derived} требуют проверки
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <OperationalRealityView
          reality={query.data}
          isLoading={query.isLoading}
          error={query.error}
          onRefresh={() => void query.refetch()}
        />
      )}
    </section>
  )
}

export function OperationalRealityView({
  reality,
  isLoading = false,
  error,
  onRefresh,
}: {
  reality?: OperationalRealityProjection
  isLoading?: boolean
  error?: unknown
  onRefresh?: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const items = useMemo(() => reality?.items ?? [], [reality?.items])
  const visibleItems = useMemo(
    () => (showAll ? items : items.filter((item) => item.requires_attention)),
    [items, showAll]
  )

  useEffect(() => {
    if (selectedId && visibleItems.some((item) => item.id === selectedId)) return
    setSelectedId(visibleItems[0]?.id ?? null)
  }, [visibleItems, selectedId])

  const selected = visibleItems.find((item) => item.id === selectedId)
  const summary = reality?.summary

  return (
    <div className="border-t border-gray-800">
      <div className="flex flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs text-gray-500">
          {summary
            ? `${summary.total} пунктов · ${summary.requiring_attention} требуют решения · ${summary.confirmed} подтверждено`
            : 'Проекция собирается из сохранённых фактов, решений и фактической работы.'}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center">
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="min-w-0 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-cyan-700 hover:text-cyan-200"
          >
            {showAll ? 'Только требующие решения' : 'Показать всё'}
          </button>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="min-w-0 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-cyan-700 hover:text-cyan-200"
              title="Пересобрать проекцию из сохранённых фактов"
            >
              Обновить факты
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 border-t border-gray-800 lg:h-[24rem] lg:min-h-0 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(24rem,1.35fr)] lg:overflow-hidden">
        <div className="max-h-56 min-w-0 overflow-auto border-b border-gray-800 lg:max-h-none lg:min-h-0 lg:border-b-0 lg:border-r">
          {isLoading ? (
            <div className="px-4 py-4 text-sm text-gray-500">Собираю факты...</div>
          ) : error ? (
            <div className="px-4 py-4 text-sm text-red-300">Не удалось собрать рабочую реальность</div>
          ) : visibleItems.length === 0 ? (
            <div className="px-4 py-4 text-sm text-gray-500">
              {showAll ? 'Рабочая реальность пока пуста.' : 'Сейчас нет пунктов, требующих решения. Можно показать всю реальность.'}
            </div>
          ) : (
            visibleItems.map((item) => (
              <RealityRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={() => setSelectedId(item.id)}
              />
            ))
          )}
        </div>
        <div className="min-w-0 lg:min-h-0 lg:overflow-auto">
          {selected ? (
            <RealityDetails item={selected} />
          ) : (
            <div className="px-5 py-4 text-sm text-gray-500">Выбери пункт, чтобы увидеть основания.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function RealityRow({
  item,
  selected,
  onSelect,
}: {
  item: OperationalRealityItemView
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'block w-full border-b border-gray-800 px-4 py-2 text-left transition-colors',
        selected ? 'bg-cyan-950/35' : 'hover:bg-gray-800/60',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 line-clamp-2 text-sm font-medium text-gray-200">{item.title}</span>
        <StateBadge state={item.state} confirmed={item.state_confirmed} />
      </div>
      <div className="mt-1 line-clamp-2 text-xs text-gray-500">{item.why_visible[0]}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {item.next_action ? (
          <span className="truncate text-emerald-300">Дальше: {item.next_action.text}</span>
        ) : (
          <span className="text-amber-300">Следующий шаг не определён</span>
        )}
        {item.unknowns.length > 0 && <span className="shrink-0 text-gray-600">неизвестно: {item.unknowns.length}</span>}
      </div>
    </button>
  )
}

export function RealityDetails({ item }: { item: OperationalRealityItemView }) {
  const [stateValue, setStateValue] = useState<OperationalState>(item.state)
  const [stateReason, setStateReason] = useState('')
  const [nextActionText, setNextActionText] = useState(item.next_action?.text ?? '')
  const [followupStatus, setFollowupStatus] = useState<'fulfilled' | 'progressed' | 'cancelled' | 'parked' | 'contradicted' | 'no_evidence'>('progressed')
  const stateMutation = useSetOperationalState()
  const nextActionMutation = useSetOperationalNextAction()
  const followupMutation = useFollowUpOperationalDecision()
  const startMutation = useStartFocusSession()
  const resolveCaptureMutation = useResolveCapture()
  const convertCaptureMutation = useConvertCaptureToWorkItem()
  const reflectionDecisionId = item.facts.find((fact) => fact.reflection_decision_id)?.reflection_decision_id

  useEffect(() => {
    setStateValue(item.state)
    setStateReason('')
    setNextActionText(item.next_action?.text ?? '')
  }, [item.id, item.state, item.next_action?.record_id])

  const stateChanged = stateValue !== item.state
  const stateCanBeSaved = !stateMutation.isPending && (!stateChanged || stateReason.trim().length > 0)

  const setState = (confirmation = false) => {
    stateMutation.mutate({
      subject_kind: item.subject_kind,
      subject_id: item.subject_id,
      state: stateValue,
      reason: stateReason.trim() || undefined,
      confirmation,
    })
  }

  const startFocus = () => {
    if (!item.work_item_id || startMutation.isPending) return
    const actionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
    void logAppEvent({
      source: 'ui',
      kind: 'focus_start_requested',
      work_item_id: item.work_item_id,
      payload: { action_id: actionId, control: 'operational_reality' },
    })
    startMutation.mutate({
      title: item.title,
      work_item_id: item.work_item_id,
      target_seconds: 25 * 60,
      telemetry_action_id: actionId,
    })
  }

  return (
    <div className="space-y-4 px-5 py-4 text-sm">
      <div>
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
          <h2 className="min-w-0 break-words text-base font-semibold text-gray-100">{item.title}</h2>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ProvenanceBadge provenance={item.state_provenance} confidence={item.confidence} />
            {item.can_start_focus && item.work_item_id && (
              <button
                type="button"
                onClick={startFocus}
                disabled={startMutation.isPending}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                title="Начать фокус из выбранного пункта; этот старт войдёт в проверку Рабочей реальности"
              >
                Начать отсюда
              </button>
            )}
          </div>
        </div>
        {item.track_path.length > 0 && (
          <div className="mt-1 text-xs text-cyan-400/80">{item.track_path.map((node) => node.title).join(' → ')}</div>
        )}
      </div>

      <DetailList title="Почему здесь" values={item.why_visible} />
      {item.unknowns.length > 0 && <DetailList title="Что неизвестно" values={item.unknowns} warning />}

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">Основания</h3>
        {item.facts.length === 0 ? (
          <div className="text-xs text-gray-600">Подтверждённых изменений и решений пока нет.</div>
        ) : (
          <div className="space-y-1">
            {item.facts.map((fact, index) => (
              <div key={`${fact.causal_record_id ?? fact.evidence_event_id ?? fact.reflection_decision_id}-${index}`} className="border-l border-gray-700 pl-2 text-xs text-gray-400">
                <div className="text-gray-300">{fact.summary}</div>
                <div className="mt-0.5 text-gray-600">
                  {formatContextTimestamp(fact.occurred_at)} · {provenanceLabel(fact.provenance)} · {basisKindLabel(fact.kind)}
                </div>
                {fact.refs.length > 0 && (
                  <div className="mt-1 space-y-0.5 text-cyan-400/80">
                    {fact.refs.map((ref) => (
                      <div key={ref.id} className="break-all">
                        {ref.kind}: {ref.value}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-800 pt-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(10rem,0.45fr)_1fr_auto]">
          <select
            value={stateValue}
            onChange={(event) => setStateValue(event.target.value as OperationalState)}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200"
          >
            {item.state === 'active' && <option value="active">в фокусе</option>}
            {STATES.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}
          </select>
          <input
            value={stateReason}
            onChange={(event) => setStateReason(event.target.value)}
            placeholder={stateChanged ? 'Почему состояние изменилось...' : 'Комментарий к подтверждению...'}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-600"
          />
          {item.state_confirmed && !stateChanged ? (
            <button type="button" disabled className="rounded border border-emerald-900 px-3 py-1.5 text-xs text-emerald-500">Подтверждено</button>
          ) : (
            <button
              type="button"
              onClick={() => setState(!stateChanged)}
              disabled={!stateCanBeSaved}
              className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {stateChanged ? 'Исправить' : 'Подтвердить'}
            </button>
          )}
        </div>
        {stateChanged && stateReason.trim().length === 0 && (
          <div className="mt-1 text-xs text-amber-400">Для исправления укажи причину.</div>
        )}
      </div>

      <div className="border-t border-gray-800 pt-3">
        <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">Следующее действие</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={nextActionText}
            onChange={(event) => setNextActionText(event.target.value)}
            placeholder="Одно физически выполнимое действие..."
            className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-600"
          />
          <button
            type="button"
            disabled={!nextActionText.trim() || nextActionMutation.isPending}
            onClick={() => nextActionMutation.mutate({
              subject_kind: item.subject_kind,
              subject_id: item.subject_id,
              action: 'set',
              text: nextActionText.trim(),
            })}
            className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {item.next_action ? 'Заменить' : 'Зафиксировать'}
          </button>
          {item.next_action && (
            <>
              <button
                type="button"
                onClick={() => nextActionMutation.mutate({ subject_kind: item.subject_kind, subject_id: item.subject_id, action: 'complete' })}
                className="rounded border border-gray-700 px-2 py-1.5 text-xs text-gray-300 hover:border-emerald-700"
              >
                Выполнено
              </button>
              <button
                type="button"
                onClick={() => nextActionMutation.mutate({ subject_kind: item.subject_kind, subject_id: item.subject_id, action: 'dismiss' })}
                className="rounded border border-gray-700 px-2 py-1.5 text-xs text-gray-400 hover:border-amber-700"
              >
                Неактуально
              </button>
            </>
          )}
        </div>
      </div>

      {reflectionDecisionId && (
        <div className="flex flex-col items-stretch gap-2 border-t border-gray-800 pt-3 sm:flex-row sm:items-center">
          <span className="text-xs text-gray-500">Проверить решение прошлого обзора:</span>
          <select
            value={followupStatus}
            onChange={(event) => setFollowupStatus(event.target.value as typeof followupStatus)}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
          >
            <option value="progressed">есть продвижение</option>
            <option value="fulfilled">выполнено</option>
            <option value="parked">припарковано</option>
            <option value="cancelled">отменено</option>
            <option value="contradicted">опровергнуто</option>
            <option value="no_evidence">нет доказательств</option>
          </select>
          <button
            type="button"
            onClick={() => followupMutation.mutate({ decision_id: reflectionDecisionId, status: followupStatus })}
            disabled={followupMutation.isPending}
            className="rounded border border-cyan-800 px-2 py-1 text-xs text-cyan-300 disabled:opacity-40"
          >
            Сохранить follow-up
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-3">
        {item.capture_id && (
          <>
            <button
              type="button"
              onClick={() => convertCaptureMutation.mutate({ id: item.capture_id! })}
              className="rounded border border-blue-800 px-3 py-1.5 text-xs text-blue-300"
            >
              Сделать делом
            </button>
            <button
              type="button"
              onClick={() => resolveCaptureMutation.mutate(item.capture_id!)}
              className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300"
            >
              Закрыть запись
            </button>
          </>
        )}
        {item.state !== 'completed' && item.state !== 'parked' && (
          <button
            type="button"
            onClick={() => stateMutation.mutate({
              subject_kind: item.subject_kind,
              subject_id: item.subject_id,
              state: 'parked',
              reason: 'Пользователь признал пункт неактуальным для текущей рабочей реальности',
            })}
            disabled={stateMutation.isPending}
            className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-amber-800 hover:text-amber-300 disabled:opacity-40"
          >
            Убрать как неактуальное
          </button>
        )}
      </div>

      {(stateMutation.error || nextActionMutation.error || followupMutation.error) && (
        <div className="text-xs text-red-300">Не удалось сохранить изменение. Данные ввода оставлены на месте.</div>
      )}
    </div>
  )
}

function DetailList({ title, values, warning = false }: { title: string; values: string[]; warning?: boolean }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">{title}</h3>
      <ul className="space-y-1 text-xs">
        {values.map((value) => (
          <li key={value} className={warning ? 'text-amber-300' : 'text-gray-300'}>• {value}</li>
        ))}
      </ul>
    </div>
  )
}

function StateBadge({ state, confirmed }: { state: OperationalState; confirmed: boolean }) {
  return (
    <span className={[
      'shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase',
      confirmed ? 'border-emerald-800 text-emerald-300' : 'border-amber-900 text-amber-300',
    ].join(' ')}>
      {stateLabel(state)}
    </span>
  )
}

function ProvenanceBadge({ provenance, confidence }: { provenance: string; confidence: number }) {
  return (
    <span className="shrink-0 rounded border border-gray-700 px-2 py-1 text-xs text-gray-400">
      {provenanceLabel(provenance)}{provenance === 'confirmed' ? '' : ` · ${Math.round(confidence * 100)}%`}
    </span>
  )
}

function stateLabel(state: OperationalState) {
  return state === 'active' ? 'в фокусе' : STATES.find((candidate) => candidate.id === state)?.label ?? state
}

function provenanceLabel(provenance: string) {
  if (provenance === 'confirmed') return 'подтверждено пользователем'
  if (provenance === 'derived') return 'выведено системой'
  if (provenance === 'observed') return 'наблюдал источник'
  return 'восстановлено по текущим данным'
}

function basisKindLabel(kind: string) {
  const labels: Record<string, string> = {
    intent: 'намерение',
    state_assertion: 'состояние',
    result: 'результат',
    decision: 'решение',
    next_action: 'следующий шаг',
    confirmation: 'подтверждение',
    correction: 'исправление',
    reflection_decision: 'решение обзора',
    blocker: 'блокер',
    observation: 'наблюдение',
  }
  return labels[kind] ?? kind
}
