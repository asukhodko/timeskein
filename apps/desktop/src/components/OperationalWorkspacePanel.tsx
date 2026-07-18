import { useEffect, useId, useMemo, useState } from 'react'
import type {
  DayContractRevisionKind,
  DayContractRevisionView,
  DayContractSubjectRef,
  DayContractSubjectSnapshot,
  FocusSessionView,
  OperationalRealityItemView,
  TrackView,
  WorkItemView,
} from '@timeskein/contracts'

import { logAppEvent } from '../api/client'
import {
  useCurrentFocusSession,
  useStartFocusSession,
  useTodayFocusSessions,
} from '../hooks/useFocusSessions'
import { useInventory } from '../hooks/useInventory'
import {
  useOperationalWorkspace,
  useReviseDayContract,
} from '../hooks/useOperationalWorkspace'
import { useTaxonomy } from '../hooks/useTaxonomy'
import { formatDuration } from '../utils/formatTime'
import { RealityDetails } from './OperationalRealityPanel'

type ContractDraft = {
  active: DayContractSubjectRef[]
  firstActionWorkItemId: string
  parked: DayContractSubjectRef[]
  whyNow: string
}

type SubjectCandidate = DayContractSubjectRef & {
  title: string
  detail: string
  workItem?: WorkItemView
  track?: TrackView
  reality?: OperationalRealityItemView
}

const EMPTY_DRAFT: ContractDraft = {
  active: [],
  firstActionWorkItemId: '',
  parked: [],
  whyNow: '',
}

export default function OperationalWorkspacePanel() {
  const localDate = formatLocalDate(new Date())
  const workspaceQuery = useOperationalWorkspace(localDate)
  const inventoryQuery = useInventory()
  const taxonomyQuery = useTaxonomy()
  const focusQuery = useCurrentFocusSession()
  const todayQuery = useTodayFocusSessions()
  const reviseMutation = useReviseDayContract()
  const startMutation = useStartFocusSession()
  const [editingKind, setEditingKind] = useState<DayContractRevisionKind | null>(null)
  const [draft, setDraft] = useState<ContractDraft>(EMPTY_DRAFT)
  const [showHistory, setShowHistory] = useState(false)
  const [showAttention, setShowAttention] = useState(false)
  const [selectedRealityId, setSelectedRealityId] = useState<string | null>(null)
  const [coordinationError, setCoordinationError] = useState<string | null>(null)

  const workspace = workspaceQuery.data
  const contract = workspace?.current_contract
  const workItems = useMemo(() => inventoryQuery.data?.items ?? [], [inventoryQuery.data?.items])
  const tracks = useMemo(() => taxonomyQuery.data?.tracks ?? [], [taxonomyQuery.data?.tracks])
  const candidates = useMemo(
    () => buildCandidates(workItems, tracks, workspace?.reality.items ?? []),
    [workItems, tracks, workspace?.reality.items]
  )
  const candidateByKey = useMemo(
    () => new Map(candidates.map((candidate) => [subjectKey(candidate), candidate])),
    [candidates]
  )
  const firstActionCandidates = useMemo(() => {
    const activeTrackIds = new Set(
      draft.active.filter((subject) => subject.kind === 'track').map((subject) => subject.subject_id)
    )
    return workItems.filter((item) =>
      draft.active.some((subject) => subject.kind === 'work_item' && subject.subject_id === item.id) ||
      item.track?.path.some((node) => activeTrackIds.has(node.id))
    )
  }, [draft.active, workItems])
  const currentFocus = focusQuery.data?.session
  const hasTrackedToday = Boolean(todayQuery.data?.sessions.length)
  const outsideContractToday = useMemo(
    () => contract
      ? workItems
        .filter((item) => item.today_active_seconds > 0 || item.id === currentFocus?.work_item_id)
        .filter((item) => item.activity_zone !== 'coordination')
        .filter((item) => !workItemCoveredByContract(item, contract))
        .sort((left, right) => right.today_active_seconds - left.today_active_seconds)
      : [],
    [contract, currentFocus?.work_item_id, workItems]
  )
  const activeReality = useMemo(
    () => contract?.active_subjects
      .map((snapshot) => liveRealityForSnapshot(workspace?.reality.items ?? [], snapshot))
      .filter((item): item is OperationalRealityItemView => Boolean(item)) ?? [],
    [contract, workspace?.reality.items]
  )
  const attentionItems = workspace?.reality.items.filter((item) => item.requires_attention) ?? []
  const selectedReality = workspace?.reality.items.find((item) => item.id === selectedRealityId)
    ?? activeReality[0]

  useEffect(() => {
    if (!selectedRealityId && activeReality[0]) setSelectedRealityId(activeReality[0].id)
  }, [activeReality, selectedRealityId])

  useEffect(() => {
    if (!editingKind) return
    if (!draft.firstActionWorkItemId || firstActionCandidates.some((item) => item.id === draft.firstActionWorkItemId)) return
    setDraft((value) => ({ ...value, firstActionWorkItemId: '' }))
  }, [draft.active, draft.firstActionWorkItemId, editingKind, firstActionCandidates])

  const beginEdit = (kind: DayContractRevisionKind) => {
    setEditingKind(kind)
    setDraft(contract ? draftFromContract(contract) : EMPTY_DRAFT)
    setCoordinationError(null)
  }

  const saveContract = () => {
    if (!editingKind || reviseMutation.isPending) return
    reviseMutation.mutate({
      local_date: localDate,
      revision_kind: editingKind,
      active_subjects: draft.active,
      first_action_work_item_id: draft.firstActionWorkItemId,
      parked_subjects: draft.parked,
      why_now: draft.whyNow.trim(),
    }, {
      onSuccess: (response) => {
        if (editingKind === 'reentry') {
          void logAppEvent({
            source: 'ui',
            kind: 'day_contract_reentry_reviewed',
            work_item_id: response.revision.first_action_work_item_id,
            payload: {
              revision_number: response.revision.revision_number,
              revised: true,
            },
          })
        }
        setEditingKind(null)
      },
    })
  }

  const startContractCoordination = (kind: DayContractRevisionKind) => {
    if (startMutation.isPending || currentFocus?.activity_zone === 'coordination') return

    const actionId = createActionId()
    const wasSwitch = Boolean(currentFocus)
    const title = coordinationFocusTitle(kind)
    setCoordinationError(null)
    void logAppEvent({
      source: 'ui',
      kind: wasSwitch ? 'focus_switch_requested' : 'focus_start_requested',
      payload: {
        action_id: actionId,
        control: 'day_contract_coordination',
        revision_kind: kind,
      },
    })
    startMutation.mutate({
      title,
      activity_zone: 'coordination',
      target_seconds: 25 * 60,
      telemetry_action_id: actionId,
    }, {
      onSuccess: (session) => {
        void logAppEvent({
          source: 'ui',
          kind: wasSwitch ? 'focus_switched' : 'focus_started',
          work_item_id: session.work_item_id,
          focus_session_id: session.id,
          payload: {
            action_id: actionId,
            control: 'day_contract_coordination',
            revision_kind: kind,
            already_active: session.id === currentFocus?.id,
          },
        })
      },
      onError: (error) => {
        setCoordinationError(error instanceof Error ? error.message : 'Не удалось начать учёт координации')
        void logAppEvent({
          source: 'ui',
          kind: 'focus_start_failed',
          payload: {
            action_id: actionId,
            control: 'day_contract_coordination',
            revision_kind: kind,
            error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
          },
        })
      },
    })
  }

  const startFirstAction = (reentry: boolean) => {
    if (!contract || startMutation.isPending) return
    const actionId = createActionId()
    if (reentry) {
      void logAppEvent({
        source: 'ui',
        kind: 'day_contract_reentry_reviewed',
        work_item_id: contract.first_action_work_item_id,
        payload: {
          revision_number: contract.revision_number,
          revised: false,
        },
      })
    }
    void logAppEvent({
      source: 'ui',
      kind: 'day_contract_start_requested',
      work_item_id: contract.first_action_work_item_id,
      payload: {
        action_id: actionId,
        revision_number: contract.revision_number,
        reentry,
      },
    })
    void logAppEvent({
      source: 'ui',
      kind: currentFocus ? 'focus_switch_requested' : 'focus_start_requested',
      work_item_id: contract.first_action_work_item_id,
      payload: { action_id: actionId, control: 'day_contract' },
    })
    startMutation.mutate({
      title: contract.first_action.title,
      work_item_id: contract.first_action_work_item_id,
      target_seconds: 25 * 60,
      telemetry_action_id: actionId,
    }, {
      onSuccess: (session) => {
        void logAppEvent({
          source: 'ui',
          kind: 'day_contract_started',
          work_item_id: session.work_item_id,
          focus_session_id: session.id,
          payload: {
            action_id: actionId,
            revision_number: contract.revision_number,
            reentry,
          },
        })
        void logAppEvent({
          source: 'ui',
          kind: currentFocus ? 'focus_switched' : 'focus_started',
          work_item_id: session.work_item_id,
          focus_session_id: session.id,
          payload: { action_id: actionId, control: 'day_contract' },
        })
      },
      onError: (error) => {
        void logAppEvent({
          source: 'ui',
          kind: 'day_contract_start_failed',
          work_item_id: contract.first_action_work_item_id,
          payload: {
            action_id: actionId,
            revision_number: contract.revision_number,
            error_code: error instanceof Error && 'code' in error ? String(error.code) : 'unknown',
          },
        })
      },
    })
  }

  if (workspaceQuery.isLoading || inventoryQuery.isLoading || taxonomyQuery.isLoading) {
    return <section className="border-b border-cyan-900/50 px-4 py-4 text-sm text-gray-500">Собираю рабочий контур...</section>
  }
  if (workspaceQuery.error || inventoryQuery.error || taxonomyQuery.error) {
    return <section className="border-b border-red-900/50 px-4 py-4 text-sm text-red-300">Не удалось собрать единое рабочее пространство.</section>
  }

  return (
    <section className="border-b border-cyan-900/50 bg-gray-950/45" aria-label="Оперативное рабочее пространство">
      <header className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-cyan-100">Рабочий контур</h2>
            {contract && (
              <span className="rounded border border-cyan-900 px-1.5 py-0.5 text-[10px] text-cyan-300">
                договор · версия {contract.revision_number}
              </span>
            )}
            {currentFocus && (
              <span className="min-w-0 truncate text-xs text-emerald-300">
                Сейчас: {currentFocus.title} · {formatDuration(currentFocus.active_seconds)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            Что сейчас в игре, почему выбран этот ход и откуда продолжить.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {contract ? (
            <>
              <button type="button" onClick={() => beginEdit('adjustment')} className={secondaryButton}>
                Изменить договор
              </button>
              <button type="button" onClick={() => beginEdit('reentry')} className={secondaryButton}>
                Пересмотреть после перерыва
              </button>
            </>
          ) : (
            <button type="button" onClick={() => beginEdit('morning')} className={primaryButton}>
              Собрать договор дня
            </button>
          )}
        </div>
      </header>

      {editingKind && (
        <ContractEditor
          kind={editingKind}
          draft={draft}
          candidates={candidates}
          candidateByKey={candidateByKey}
          firstActionCandidates={firstActionCandidates}
          pending={reviseMutation.isPending}
          error={reviseMutation.error instanceof Error ? reviseMutation.error.message : undefined}
          currentFocus={currentFocus}
          coordinationPending={startMutation.isPending}
          coordinationError={coordinationError ?? undefined}
          onChange={setDraft}
          onStartCoordination={() => startContractCoordination(editingKind)}
          onSave={saveContract}
          onCancel={() => setEditingKind(null)}
        />
      )}

      {!editingKind && contract && (
        <div className="border-t border-gray-800">
          <div className="grid min-w-0 gap-0 lg:h-[24rem] lg:grid-cols-[minmax(18rem,0.85fr)_minmax(25rem,1.4fr)] lg:overflow-hidden">
            <div className="min-w-0 border-b border-gray-800 px-4 py-3 lg:overflow-auto lg:border-b-0 lg:border-r">
              <div className="mb-2 text-[10px] font-semibold uppercase text-gray-500">Активные направления</div>
              <div className="space-y-1">
                {contract.active_subjects.map((snapshot) => (
                  <ContractSubjectRow
                    key={subjectKey(snapshot)}
                    snapshot={snapshot}
                    live={liveRealityForSnapshot(workspace?.reality.items ?? [], snapshot)}
                    selected={selectedReality?.subject_kind === snapshot.kind && selectedReality.subject_id === snapshot.subject_id}
                    onSelect={(item) => item && setSelectedRealityId(item.id)}
                  />
                ))}
              </div>
              <div className="mt-3 border-t border-gray-800 pt-2">
                <div className="text-[10px] font-semibold uppercase text-gray-500">Первое действие</div>
                <div className="mt-1 break-words text-sm font-medium text-gray-100">{contract.first_action.title}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startFirstAction(contract.revision_kind === 'reentry' || (!currentFocus && hasTrackedToday))}
                    disabled={startMutation.isPending || currentFocus?.work_item_id === contract.first_action_work_item_id}
                    className={primaryButton}
                  >
                    {firstActionButtonLabel(currentFocus?.work_item_id, contract.first_action_work_item_id, hasTrackedToday)}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 border-t border-gray-800 pt-2 text-xs">
                <div>
                  <span className="text-gray-500">Почему сейчас: </span>
                  <span className="text-gray-300">{contract.why_now}</span>
                </div>
                <div>
                  <span className="text-gray-500">Припарковано: </span>
                  <span className="text-gray-400">{contract.parked_subjects.map((item) => item.title).join(' · ')}</span>
                </div>
              </div>
              {outsideContractToday.length > 0 && (
                <div className="mt-3 rounded border border-amber-900/70 bg-amber-950/15 px-2 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-amber-200">Сегодня вне договора · {outsideContractToday.length}</span>
                    <button type="button" onClick={() => beginEdit('adjustment')} className={tertiaryButton}>
                      Пересмотреть договор
                    </button>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    Работа уже состоялась, но не входит в текущий активный набор.
                  </div>
                  <div className="mt-1 space-y-0.5 text-gray-400">
                    {outsideContractToday.slice(0, 5).map((item) => (
                      <div key={item.id} className="flex min-w-0 justify-between gap-2">
                        <span className="truncate">{item.title}</span>
                        <span className="shrink-0 text-gray-600">{formatDuration(item.today_active_seconds)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0 lg:overflow-auto">
              {selectedReality ? (
                <RealityDetails item={selectedReality} />
              ) : (
                <div className="px-5 py-4 text-sm text-gray-500">
                  Текущее состояние направления пока не выведено. Исторический снимок сохранён в договоре.
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 px-4 py-2 text-xs">
            <button type="button" onClick={() => setShowAttention((value) => !value)} className={tertiaryButton}>
              {showAttention ? 'Скрыть требующие решения' : `Требуют решения: ${attentionItems.length}`}
            </button>
            <button type="button" onClick={() => setShowHistory((value) => !value)} className={tertiaryButton}>
              {showHistory ? 'Скрыть историю' : `История договора: ${workspace?.revisions.length ?? 0}`}
            </button>
            <button
              type="button"
              onClick={() => void workspaceQuery.refetch()}
              className={tertiaryButton}
              title="Перечитать сохранённые факты и заново собрать текущее состояние"
            >
              Пересобрать состояние
            </button>
          </div>

          {showAttention && <AttentionList items={attentionItems} onSelect={(item) => setSelectedRealityId(item.id)} />}
          {showHistory && <ContractHistory revisions={workspace?.revisions ?? []} />}
        </div>
      )}

      {!editingKind && !contract && (
        <div className="border-t border-gray-800 px-4 py-4 text-sm text-gray-500">
          На сегодня ещё нет договора. Выбери 2–3 реальных направления и одно уже существующее дело, с которого начнёшь.
        </div>
      )}
    </section>
  )
}

function ContractEditor({
  kind,
  draft,
  candidates,
  candidateByKey,
  firstActionCandidates,
  pending,
  error,
  currentFocus,
  coordinationPending,
  coordinationError,
  onChange,
  onStartCoordination,
  onSave,
  onCancel,
}: {
  kind: DayContractRevisionKind
  draft: ContractDraft
  candidates: SubjectCandidate[]
  candidateByKey: Map<string, SubjectCandidate>
  firstActionCandidates: WorkItemView[]
  pending: boolean
  error?: string
  currentFocus?: FocusSessionView
  coordinationPending: boolean
  coordinationError?: string
  onChange: (draft: ContractDraft) => void
  onStartCoordination: () => void
  onSave: () => void
  onCancel: () => void
}) {
  const activeKeys = new Set(draft.active.map(subjectKey))
  const parkedKeys = new Set(draft.parked.map(subjectKey))
  const canSave = draft.active.length >= 2 && draft.active.length <= 3 &&
    draft.parked.length >= 1 && draft.parked.length <= 3 &&
    Boolean(draft.firstActionWorkItemId) && Boolean(draft.whyNow.trim())

  return (
    <div className="grid gap-3 border-t border-cyan-900/50 bg-cyan-950/10 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-cyan-100">{revisionKindLabel(kind)}</div>
          <div className="text-xs text-gray-500">Выбор делается из существующих дел и направлений; новый список здесь не создаётся.</div>
        </div>
        <button type="button" onClick={onCancel} className={tertiaryButton}>Отмена</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-cyan-900/60 bg-gray-950/45 px-3 py-2 text-xs">
        <div className="min-w-0">
          <div className="font-medium text-gray-300">Учёт времени договора</div>
          {currentFocus?.activity_zone === 'coordination' ? (
            <div className="mt-0.5 truncate text-cyan-300">
              Координация учитывается: {currentFocus.title} · {formatDuration(currentFocus.active_seconds)}
            </div>
          ) : currentFocus ? (
            <div className="mt-0.5 text-gray-500">
              Сейчас учитывается другое дело: {currentFocus.title}. Можно явно переключиться на координацию.
            </div>
          ) : (
            <div className="mt-0.5 text-gray-500">Сбор договора пока не учитывается.</div>
          )}
        </div>
        {currentFocus?.activity_zone !== 'coordination' && (
          <button
            type="button"
            onClick={onStartCoordination}
            disabled={coordinationPending}
            className={secondaryButton}
          >
            {coordinationPending
              ? 'Запускаю...'
              : currentFocus
                ? 'Переключить на координацию'
                : 'Начать учёт координации'}
          </button>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <SubjectPicker
          label="В игре · 2–3 направления"
          selected={draft.active}
          candidates={candidates}
          candidateByKey={candidateByKey}
          blockedKeys={parkedKeys}
          max={3}
          onChange={(active) => onChange({ ...draft, active })}
        />
        <label className="grid min-w-0 gap-1 text-xs">
          <span className="font-medium text-gray-400">Первое действие · одно существующее дело</span>
          <select
            value={draft.firstActionWorkItemId}
            onChange={(event) => onChange({ ...draft, firstActionWorkItemId: event.target.value })}
            className={fieldClass}
          >
            <option value="">Выбрать дело внутри активного направления...</option>
            {firstActionCandidates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          {draft.active.length > 0 && firstActionCandidates.length === 0 && (
            <span className="text-amber-300">В выбранных направлениях нет доступного Work Item.</span>
          )}
        </label>
        <SubjectPicker
          label="Припарковано · 1–3 главных конкурента"
          description="Выбери главное дело или направление, к которому сознательно не возвращаешься сегодня."
          selected={draft.parked}
          candidates={candidates}
          candidateByKey={candidateByKey}
          blockedKeys={activeKeys}
          max={3}
          onChange={(parked) => onChange({ ...draft, parked })}
        />
        <label className="grid min-w-0 gap-1 text-xs">
          <span className="font-medium text-gray-400">Почему сейчас · одно короткое основание</span>
          <textarea
            rows={3}
            value={draft.whyNow}
            onChange={(event) => onChange({ ...draft, whyNow: event.target.value })}
            placeholder="Почему этот набор и первое действие достаточно важны именно сейчас..."
            className={fieldClass}
          />
        </label>
      </div>
      {coordinationError && <div className="text-xs text-red-300">{coordinationError}</div>}
      {error && <div className="text-xs text-red-300">{error}</div>}
      <div className="flex justify-end">
        <button type="button" onClick={onSave} disabled={!canSave || pending || coordinationPending} className={primaryButton}>
          {pending ? 'Сохраняю...' : kind === 'morning' ? 'Сохранить договор' : 'Сохранить новую версию'}
        </button>
      </div>
    </div>
  )
}

function SubjectPicker({
  label,
  description,
  selected,
  candidates,
  candidateByKey,
  blockedKeys,
  max,
  onChange,
}: {
  label: string
  description?: string
  selected: DayContractSubjectRef[]
  candidates: SubjectCandidate[]
  candidateByKey: Map<string, SubjectCandidate>
  blockedKeys: Set<string>
  max: number
  onChange: (subjects: DayContractSubjectRef[]) => void
}) {
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selectedKeys = new Set(selected.map(subjectKey))
  const available = candidates
    .filter((candidate) => !selectedKeys.has(subjectKey(candidate)) && !blockedKeys.has(subjectKey(candidate)))
    .filter((candidate) => candidateMatchesQuery(candidate, query))
    .slice(0, 30)
  const disabled = selected.length >= max

  const selectCandidate = (candidate: SubjectCandidate) => {
    onChange([...selected, { kind: candidate.kind, subject_id: candidate.subject_id }])
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="grid min-w-0 gap-1 text-xs">
      <span className="font-medium text-gray-400">{label}</span>
      {description && <span className="text-[11px] text-gray-600">{description}</span>}
      <div className="relative">
        <input
          type="search"
          role="combobox"
          aria-expanded={open && !disabled}
          aria-controls={listboxId}
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
            if (event.key === 'Enter' && available[0]) {
              event.preventDefault()
              selectCandidate(available[0])
            }
          }}
          placeholder={disabled ? `Выбрано максимум: ${max}` : 'Найти дело или направление...'}
          className={fieldClass}
        />
        {open && !disabled && (
          <div
            id={listboxId}
            role="listbox"
            className="absolute z-30 mt-1 max-h-64 w-full min-w-0 overflow-auto rounded border border-gray-700 bg-gray-950 shadow-xl"
          >
            {available.length === 0 ? (
              <div className="px-3 py-3 text-gray-500">Подходящих дел и направлений не найдено.</div>
            ) : available.map((candidate) => (
              <button
                key={subjectKey(candidate)}
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCandidate(candidate)}
                className="block w-full min-w-0 border-b border-gray-800 px-3 py-2 text-left last:border-b-0 hover:bg-gray-900"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-medium text-gray-200">{candidate.title}</span>
                  <span className={candidate.reality?.requires_attention ? 'shrink-0 text-[10px] text-amber-300' : 'shrink-0 text-[10px] text-gray-600'}>
                    {candidate.kind === 'track' ? 'направление' : 'дело'}
                  </span>
                </div>
                {candidate.detail && <div className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">{candidate.detail}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex min-h-7 flex-wrap gap-1">
        {selected.map((subject) => {
          const candidate = candidateByKey.get(subjectKey(subject))
          return (
            <span key={subjectKey(subject)} className="flex min-w-0 max-w-full items-center gap-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-gray-300">
              <span className="truncate">{candidate?.title ?? subject.subject_id}</span>
              <button
                type="button"
                onClick={() => onChange(selected.filter((item) => subjectKey(item) !== subjectKey(subject)))}
                className="shrink-0 text-gray-500 hover:text-red-300"
                title="Убрать из выбора"
                aria-label="Убрать из выбора"
              >
                ×
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function ContractSubjectRow({
  snapshot,
  live,
  selected,
  onSelect,
}: {
  snapshot: DayContractSubjectSnapshot
  live?: OperationalRealityItemView
  selected: boolean
  onSelect: (item?: OperationalRealityItemView) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(live)}
      disabled={!live}
      className={[
        'block w-full min-w-0 rounded border px-2 py-2 text-left transition-colors',
        selected ? 'border-cyan-700 bg-cyan-950/30' : 'border-gray-800 hover:border-gray-700',
        live ? '' : 'cursor-default',
      ].join(' ')}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words text-sm text-gray-200">{live?.title ?? snapshot.title}</div>
          <div className="mt-0.5 text-[10px] text-gray-500">{snapshot.kind === 'track' ? 'направление' : 'дело'} · {stateLabel(live?.state ?? snapshot.state)}</div>
        </div>
        <span className="shrink-0 rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">
          {provenanceLabel(live?.state_provenance ?? snapshot.state_provenance)}
        </span>
      </div>
      {(live?.next_action ?? snapshot.next_action) && (
        <div className="mt-1 line-clamp-2 text-xs text-emerald-300">
          Дальше: {(live?.next_action ?? snapshot.next_action)?.text}
        </div>
      )}
      {(live?.last_significant_change ?? snapshot.last_significant_change) && (
        <div className="mt-1 line-clamp-2 text-[11px] text-gray-500">
          Изменилось: {(live?.last_significant_change ?? snapshot.last_significant_change)?.summary}
        </div>
      )}
    </button>
  )
}

function AttentionList({ items, onSelect }: { items: OperationalRealityItemView[]; onSelect: (item: OperationalRealityItemView) => void }) {
  return (
    <div className="grid max-h-52 gap-px overflow-auto border-t border-gray-800 bg-gray-800 sm:grid-cols-2 xl:grid-cols-3">
      {items.length === 0 ? (
        <div className="bg-gray-950 px-4 py-3 text-xs text-gray-500">Сейчас нет пунктов, требующих решения.</div>
      ) : items.map((item) => (
        <button key={item.id} type="button" onClick={() => onSelect(item)} className="min-w-0 bg-gray-950 px-3 py-2 text-left hover:bg-gray-900">
          <div className="truncate text-xs text-gray-200">{item.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-amber-300">{stateLabel(item.state)} · {item.unknowns.length} неизвестно</div>
        </button>
      ))}
    </div>
  )
}

function ContractHistory({ revisions }: { revisions: DayContractRevisionView[] }) {
  return (
    <div className="max-h-72 overflow-auto border-t border-gray-800 px-4 py-3">
      <div className="space-y-2">
        {[...revisions].reverse().map((revision) => (
          <details key={revision.id} className="border-b border-gray-800 pb-2 text-xs">
            <summary className="cursor-pointer text-gray-300">
              Версия {revision.revision_number} · {revisionKindLabel(revision.revision_kind)} · {formatTimestamp(revision.created_at)}
            </summary>
            <div className="mt-2 grid gap-1 text-gray-500 sm:grid-cols-2">
              <div><span className="text-gray-600">В игре:</span> {revision.active_subjects.map((item) => item.title).join(' · ')}</div>
              <div><span className="text-gray-600">Первое:</span> {revision.first_action.title}</div>
              <div><span className="text-gray-600">Припарковано:</span> {revision.parked_subjects.map((item) => item.title).join(' · ')}</div>
              <div><span className="text-gray-600">Почему:</span> {revision.why_now}</div>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

function buildCandidates(
  workItems: WorkItemView[],
  tracks: TrackView[],
  realityItems: OperationalRealityItemView[],
): SubjectCandidate[] {
  const realityBySubject = new Map(
    realityItems.map((item) => [`${item.subject_kind}:${item.subject_id}`, item]),
  )
  const trackCandidates: SubjectCandidate[] = tracks
    .filter((track) => !track.archived)
    .map((track) => {
      const reality = realityBySubject.get(`track:${track.id}`)
      return {
        kind: 'track',
        subject_id: track.id,
        title: track.title,
        detail: candidateDetail(reality, track.path.map((node) => node.title).join(' → ')),
        track,
        reality,
      }
    })
  const itemCandidates: SubjectCandidate[] = workItems
    .filter((item) => item.state !== 'done')
    .map((item) => {
      const reality = realityBySubject.get(`work_item:${item.id}`)
      return {
        kind: 'work_item',
        subject_id: item.id,
        title: item.title,
        detail: candidateDetail(reality, item.track?.path.map((node) => node.title).join(' → ') ?? ''),
        workItem: item,
        reality,
      }
    })
  return [...trackCandidates, ...itemCandidates].sort((left, right) => {
    const attention = Number(Boolean(right.reality?.requires_attention)) - Number(Boolean(left.reality?.requires_attention))
    if (attention !== 0) return attention
    return left.title.localeCompare(right.title, 'ru')
  })
}

function candidateDetail(reality: OperationalRealityItemView | undefined, path: string) {
  const details = []
  if (reality) {
    details.push(stateLabel(reality.state))
    if (reality.next_action?.text) details.push(`дальше: ${reality.next_action.text}`)
    if (reality.unknowns.length > 0) details.push(`неизвестно: ${reality.unknowns.length}`)
  }
  if (path) details.push(path)
  return details.join(' · ')
}

function candidateMatchesQuery(candidate: SubjectCandidate, query: string) {
  const normalized = normalizeSearchText(query)
  if (!normalized) return true
  return normalizeSearchText(`${candidate.title} ${candidate.detail}`).includes(normalized)
}

function normalizeSearchText(value: string) {
  const homoglyphs: Record<string, string> = {
    а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  }
  return Array.from(value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU'))
    .map((character) => homoglyphs[character] ?? character)
    .join('')
}

function workItemCoveredByContract(item: WorkItemView, contract: DayContractRevisionView) {
  return contract.active_subjects.some((subject) => {
    if (subject.kind === 'work_item') return subject.subject_id === item.id
    return item.track?.path.some((node) => node.id === subject.subject_id) ?? false
  })
}

function draftFromContract(contract: DayContractRevisionView): ContractDraft {
  return {
    active: contract.active_subjects.map((subject) => ({ kind: subject.kind, subject_id: subject.subject_id })),
    firstActionWorkItemId: contract.first_action_work_item_id,
    parked: contract.parked_subjects.map((subject) => ({ kind: subject.kind, subject_id: subject.subject_id })),
    whyNow: contract.why_now,
  }
}

function liveRealityForSnapshot(items: OperationalRealityItemView[], snapshot: DayContractSubjectSnapshot) {
  return items.find((item) => item.subject_kind === snapshot.kind && item.subject_id === snapshot.subject_id)
}

function subjectKey(subject: Pick<DayContractSubjectRef, 'kind' | 'subject_id'>) {
  return `${subject.kind}:${subject.subject_id}`
}

function revisionKindLabel(kind: DayContractRevisionKind) {
  if (kind === 'morning') return 'Утренний договор'
  if (kind === 'reentry') return 'Пересмотр для возвращения'
  return 'Корректировка договора'
}

function coordinationFocusTitle(kind: DayContractRevisionKind) {
  return kind === 'morning' ? 'Вход в день' : 'Возврат после перерыва'
}

function stateLabel(state: string) {
  const labels: Record<string, string> = {
    active: 'в фокусе', waiting: 'ожидает', blocked: 'заблокировано', parked: 'припарковано',
    reactive: 'реактивное', completed: 'завершено', 'stale-important': 'важное без движения',
    'meeting-tail': 'хвост встречи', unknown: 'неясно',
  }
  return labels[state] ?? state
}

function provenanceLabel(provenance: string) {
  if (provenance === 'confirmed') return 'подтверждено'
  if (provenance === 'observed') return 'наблюдалось'
  if (provenance === 'derived') return 'выведено'
  return 'восстановлено'
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function createActionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function firstActionButtonLabel(
  currentWorkItemId: string | undefined,
  firstActionWorkItemId: string,
  hasTrackedToday: boolean,
) {
  if (currentWorkItemId === firstActionWorkItemId) return 'Уже в фокусе'
  if (currentWorkItemId) return 'Переключиться на первое действие'
  if (hasTrackedToday) return 'Вернуться по договору'
  return 'Начать первое действие'
}

const fieldClass = 'min-w-0 w-full rounded border border-gray-700 bg-gray-950 px-2 py-2 text-xs text-gray-200 placeholder:text-gray-600 focus:border-cyan-600 focus:outline-none'
const primaryButton = 'rounded bg-cyan-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500'
const secondaryButton = 'rounded border border-cyan-800 px-2.5 py-1.5 text-xs text-cyan-200 hover:border-cyan-500 disabled:opacity-40'
const tertiaryButton = 'rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-cyan-800 hover:text-cyan-200'
