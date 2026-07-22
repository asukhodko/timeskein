import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ContextPackProfile,
  FocusSessionView,
  WorkItemStageView,
  WorkItemView,
  WorkMemoryEntryKind,
  WorkMemoryEntryView,
  WorkMemoryMaterialKind,
} from '@timeskein/contracts'
import { logAppEvent } from '../api/client'
import { useInventory } from '../hooks/useInventory'
import {
  useContextPack,
  useCreateWorkingMemory,
  useCreateWorkItemStage,
  useDeleteWorkingMemory,
  useMergeWorkItems,
  useUpdateWorkingMemory,
  useUpdateWorkItemStage,
  useWorkingMemory,
  useWorkItemStages,
} from '../hooks/useWorkingMemory'
import { formatDuration } from '../utils/formatTime'

interface WorkingMemoryPanelProps {
  item: WorkItemView
  focusSession?: FocusSessionView
  onStart: (stageId?: string) => void
  onClose: () => void
}

const MEMORY_KINDS: Array<{ value: WorkMemoryEntryKind; label: string }> = [
  { value: 'thought', label: 'Мысль' },
  { value: 'question', label: 'Вопрос' },
  { value: 'decision', label: 'Решение' },
  { value: 'observation', label: 'Наблюдение' },
  { value: 'result', label: 'Результат' },
  { value: 'state_change', label: 'Изменение состояния' },
  { value: 'next_action', label: 'Следующий шаг' },
  { value: 'material', label: 'Материал' },
]

const MATERIAL_KINDS: Array<{ value: WorkMemoryMaterialKind; label: string }> = [
  { value: 'text', label: 'Текст' },
  { value: 'url', label: 'URL' },
  { value: 'file_path', label: 'Путь к файлу' },
]

export default function WorkingMemoryPanel({ item, focusSession, onStart, onClose }: WorkingMemoryPanelProps) {
  const [kind, setKind] = useState<WorkMemoryEntryKind>('thought')
  const [text, setText] = useState('')
  const [materialKind, setMaterialKind] = useState<WorkMemoryMaterialKind>('url')
  const [materialValue, setMaterialValue] = useState('')
  const [editing, setEditing] = useState<WorkMemoryEntryView | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<WorkMemoryEntryView | null>(null)
  const [newStageTitle, setNewStageTitle] = useState('')
  const [profile, setProfile] = useState<ContextPackProfile>('work-item-reentry')
  const [mergeSourceId, setMergeSourceId] = useState('')
  const [mergeReason, setMergeReason] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [asOf, setAsOf] = useState(() => new Date().toISOString())
  const loggedPackKeyRef = useRef('')
  const modalRef = useRef<HTMLDivElement>(null)

  const memoryParams = useMemo(() => ({ subject_kind: 'work_item' as const, subject_id: item.id }), [item.id])
  const memoryQuery = useWorkingMemory(memoryParams)
  const stagesQuery = useWorkItemStages(item.id)
  const inventoryQuery = useInventory()
  const packScopeId = profile === 'track-reentry' ? item.track?.id : item.id
  const packParams = useMemo(() => ({
    profile,
    scope_id: packScopeId ?? item.id,
    as_of: asOf,
    format: 'both' as const,
  }), [asOf, item.id, packScopeId, profile])
  const contextQuery = useContextPack(packParams)
  const createMutation = useCreateWorkingMemory()
  const updateMutation = useUpdateWorkingMemory()
  const deleteMutation = useDeleteWorkingMemory()
  const createStageMutation = useCreateWorkItemStage()
  const updateStageMutation = useUpdateWorkItemStage()
  const mergeMutation = useMergeWorkItems()
  const entries = memoryQuery.data?.entries ?? []
  const stages = stagesQuery.data?.stages ?? []
  const activeStage = stages.find((stage) => stage.state === 'active')
  const pack = contextQuery.data?.pack
  const nextAction = pack?.facts.next_actions.at(-1)
  const latestChange = pack?.facts.latest_confirmed_change
  const mergeCandidates = (inventoryQuery.data?.items ?? []).filter((candidate) => candidate.id !== item.id)
  const error = createMutation.error || updateMutation.error || deleteMutation.error || createStageMutation.error || updateStageMutation.error || mergeMutation.error

  useEffect(() => {
    void logAppEvent({ source: 'ui', kind: 'working_memory_opened', work_item_id: item.id, payload: { control: 'memory_panel' } })
  }, [item.id])

  useEffect(() => {
    const key = contextQuery.data?.pack
      ? `${contextQuery.data.pack.profile}:${contextQuery.data.pack.scope.id}:${contextQuery.data.pack.as_of}`
      : ''
    if (!key || loggedPackKeyRef.current === key) return
    loggedPackKeyRef.current = key
    void logAppEvent({
      source: 'ui',
      kind: 'context_pack_built',
      work_item_id: item.id,
      payload: { profile, scope_id: packScopeId },
    })
  }, [contextQuery.data?.pack, item.id, packScopeId, profile])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const clearEditor = () => {
    setEditing(null)
    setKind('thought')
    setText('')
    setMaterialKind('url')
    setMaterialValue('')
  }

  const refreshContext = () => {
    setAsOf(new Date().toISOString())
    setCopyState('idle')
  }

  const submitEntry = async () => {
    const hasContent = kind === 'material' ? materialValue.trim() : text.trim()
    if (!hasContent || createMutation.isPending || updateMutation.isPending) return
    if (editing) {
      await updateMutation.mutateAsync({
        id: editing.id,
        kind,
        text: kind === 'material' ? undefined : text.trim(),
        material_kind: kind === 'material' ? materialKind : undefined,
        material_value: kind === 'material' ? materialValue.trim() : undefined,
        change_note: 'Правка из рабочей памяти',
      })
      void logAppEvent({ source: 'ui', kind: 'working_memory_updated', work_item_id: item.id, payload: { memory_kind: kind } })
    } else {
      await createMutation.mutateAsync({
        subject_kind: 'work_item',
        subject_id: item.id,
        kind,
        text: kind === 'material' ? undefined : text.trim(),
        material_kind: kind === 'material' ? materialKind : undefined,
        material_value: kind === 'material' ? materialValue.trim() : undefined,
        focus_session_id: focusSession?.work_item_id === item.id ? focusSession.id : undefined,
        stage_id: activeStage?.id,
      })
      void logAppEvent({
        source: 'ui',
        kind: 'working_memory_created',
        work_item_id: item.id,
        focus_session_id: focusSession?.work_item_id === item.id ? focusSession.id : undefined,
        payload: { memory_kind: kind, material_kind: kind === 'material' ? materialKind : undefined },
      })
    }
    clearEditor()
    refreshContext()
  }

  const beginEdit = (entry: WorkMemoryEntryView) => {
    setEditing(entry)
    setKind(entry.current_revision.entry_kind)
    setText(entry.current_revision.text ?? '')
    setMaterialKind(entry.current_revision.material_kind ?? 'url')
    setMaterialValue(entry.current_revision.material_value ?? '')
  }

  const deleteEntry = async () => {
    if (!deleteCandidate) return
    await deleteMutation.mutateAsync({ id: deleteCandidate.id, reason: 'Удалено пользователем из рабочей памяти' })
    void logAppEvent({ source: 'ui', kind: 'working_memory_deleted', work_item_id: item.id })
    setDeleteCandidate(null)
    refreshContext()
  }

  const createStage = async () => {
    if (!newStageTitle.trim()) return
    const stage = await createStageMutation.mutateAsync({ work_item_id: item.id, title: newStageTitle.trim(), activate: stages.length === 0 })
    void logAppEvent({ source: 'ui', kind: 'work_item_stage_changed', work_item_id: item.id, payload: { stage_id: stage.id, action: 'create', active: stage.state === 'active' } })
    setNewStageTitle('')
    refreshContext()
  }

  const changeStageState = async (stage: WorkItemStageView, state: WorkItemStageView['state']) => {
    const updated = await updateStageMutation.mutateAsync({ id: stage.id, state })
    void logAppEvent({ source: 'ui', kind: 'work_item_stage_changed', work_item_id: item.id, payload: { stage_id: stage.id, state: updated.state } })
    refreshContext()
  }

  const copyContext = async (format: 'markdown' | 'json') => {
    const value = format === 'markdown' ? contextQuery.data?.markdown : pack ? JSON.stringify(pack, null, 2) : undefined
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      void logAppEvent({
        source: 'ui',
        kind: 'context_pack_exported',
        work_item_id: item.id,
        payload: { profile, scope_id: packScopeId, format },
      })
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const mergeSource = async () => {
    if (!mergeSourceId) return
    await mergeMutation.mutateAsync({ sourceId: mergeSourceId, canonicalId: item.id, reason: mergeReason.trim() || undefined })
    void logAppEvent({ source: 'ui', kind: 'work_item_merged', work_item_id: item.id, payload: { source_id: mergeSourceId } })
    setMergeSourceId('')
    setMergeReason('')
    refreshContext()
  }

  const startFromHere = () => {
    void logAppEvent({
      source: 'ui',
      kind: 'reentry_started',
      work_item_id: item.id,
      payload: { stage_id: activeStage?.id, has_next_action: Boolean(nextAction) },
    })
    onStart(activeStage?.id)
    onClose()
  }

  return (
    <div data-timeskein-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onMouseDown={onClose}>
      <div
        ref={modalRef}
        className="grid max-h-[94vh] w-[min(74rem,96vw)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-700 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-emerald-400">Рабочая память</div>
            <h2 className="mt-1 break-words text-lg font-semibold text-gray-100">{item.title}</h2>
            <div className="mt-1 text-xs text-gray-500">Хронология, этапы, материалы и точка продолжения хранятся вместе с делом.</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={startFromHere} className={primaryButton}>Начать отсюда</button>
            <button type="button" onClick={onClose} className={secondaryButton}>Закрыть</button>
          </div>
        </header>

        <div className="grid min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.85fr)]">
          <main className="grid min-w-0 content-start gap-4">
            <section className="rounded border border-emerald-900/70 bg-emerald-950/15 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Точка возвращения</div>
              <div className="mt-2 grid gap-2 text-sm">
                <ReentryLine label="Последнее изменение" entry={latestChange} empty="Подтверждённое изменение ещё не записано." />
                <div><span className="text-gray-500">Этап:</span> <span className="text-gray-200">{activeStage?.title ?? 'не выбран'}</span></div>
                <ReentryLine label="Следующий шаг" entry={nextAction} empty="Следующий физический шаг ещё не записан." />
              </div>
              {pack?.unknowns.length ? <div className="mt-2 text-xs text-amber-300">Неизвестно: {pack.unknowns.join(' · ')}</div> : null}
            </section>

            <section className="rounded border border-gray-700 bg-gray-950/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-200">{editing ? 'Новая редакция записи' : 'Добавить в память'}</div>
                {editing && <button type="button" onClick={clearEditor} className={smallButton}>Отменить правку</button>}
              </div>
              <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <select value={kind} onChange={(event) => setKind(event.target.value as WorkMemoryEntryKind)} className={fieldClass}>
                  {MEMORY_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {kind === 'material' ? (
                  <div className="grid min-w-0 gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
                    <select value={materialKind} onChange={(event) => setMaterialKind(event.target.value as WorkMemoryMaterialKind)} className={fieldClass}>
                      {MATERIAL_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <input value={materialValue} onChange={(event) => setMaterialValue(event.target.value)} placeholder="Текст, URL или путь к файлу" className={fieldClass} />
                  </div>
                ) : <span className="self-center text-xs text-gray-500">Можно писать подробно. Ctrl+Enter сохраняет.</span>}
              </div>
              {kind !== 'material' && (
                <textarea
                  autoFocus
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      void submitEntry()
                    }
                  }}
                  rows={7}
                  placeholder="Что произошло, что изменилось, какой вопрос остался или с чего продолжить?"
                  className={`${fieldClass} mt-2 min-h-40 resize-y leading-relaxed`}
                />
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-xs text-gray-600">Внешний текст сохраняется как данные и никогда не исполняется как инструкция.</div>
                <button
                  type="button"
                  onClick={() => void submitEntry()}
                  disabled={(kind === 'material' ? !materialValue.trim() : !text.trim()) || createMutation.isPending || updateMutation.isPending}
                  className={primaryButton}
                >
                  {editing ? 'Сохранить редакцию' : 'Записать'}
                </button>
              </div>
            </section>

            <section className="min-w-0 rounded border border-gray-700 bg-gray-950/30">
              <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
                <div className="text-sm font-semibold text-gray-200">Хронология</div>
                <div className="text-xs text-gray-500">{entries.length} записей</div>
              </div>
              {memoryQuery.isLoading ? <div className="p-4 text-sm text-gray-500">Загружаю память...</div> : entries.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">Память пуста. Запиши первый наблюдаемый след работы.</div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {[...entries].reverse().map((entry) => (
                    <MemoryRow key={entry.id} entry={entry} onEdit={() => beginEdit(entry)} onDelete={() => setDeleteCandidate(entry)} />
                  ))}
                </div>
              )}
            </section>
          </main>

          <aside className="grid min-w-0 content-start gap-4">
            <section className="rounded border border-gray-700 bg-gray-950/35 p-3">
              <div className="text-sm font-semibold text-gray-200">Этапы</div>
              <div className="mt-2 flex gap-2">
                <input value={newStageTitle} onChange={(event) => setNewStageTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createStage()} placeholder="Новый этап..." className={fieldClass} />
                <button type="button" onClick={() => void createStage()} disabled={!newStageTitle.trim()} className={secondaryButton}>Добавить</button>
              </div>
              <div className="mt-3 grid gap-2">
                {stages.length === 0 ? <div className="text-xs text-gray-500">Этапов пока нет.</div> : stages.map((stage) => (
                  <div key={stage.id} className="grid gap-1 rounded border border-gray-800 bg-gray-900/60 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 break-words text-sm text-gray-200">{stage.title}</div>
                      <select value={stage.state} onChange={(event) => void changeStageState(stage, event.target.value as WorkItemStageView['state'])} className="rounded border border-gray-700 bg-gray-950 px-1.5 py-1 text-xs text-gray-300">
                        <option value="planned">Запланирован</option>
                        <option value="active">Текущий</option>
                        <option value="completed">Завершён</option>
                        <option value="archived">Архив</option>
                      </select>
                    </div>
                    <div className="text-[11px] text-gray-500">{formatDuration(stage.active_seconds)} · {stage.entrances} входов</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded border border-gray-700 bg-gray-950/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-200">Context Pack</div>
                <div className="flex flex-wrap justify-end gap-1">
                  <button type="button" onClick={() => setProfile('work-item-reentry')} className={profile === 'work-item-reentry' ? activeTab : smallButton}>Дело</button>
                  <button type="button" onClick={() => setProfile('track-reentry')} disabled={!item.track} className={profile === 'track-reentry' ? activeTab : smallButton}>Направление</button>
                  <button type="button" onClick={refreshContext} className={smallButton}>Обновить</button>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Воспроизводимая проекция на {new Date(asOf).toLocaleString('ru-RU')}.
              </div>
              {contextQuery.isLoading ? <div className="mt-3 text-xs text-gray-500">Собираю...</div> : (
                <div className="mt-3 grid gap-2">
                  <div className="rounded border border-gray-800 p-2 text-xs text-gray-300">
                    {pack?.facts.focus.entrances ?? 0} входов · {formatDuration(pack?.facts.focus.active_seconds ?? 0)} · {pack?.facts.memory.length ?? 0} записей
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copyContext('markdown')} className={secondaryButton}>Копировать Markdown</button>
                    <button type="button" onClick={() => void copyContext('json')} className={secondaryButton}>Копировать JSON</button>
                  </div>
                  {copyState === 'copied' && <div className="text-xs text-emerald-300">Скопировано.</div>}
                  {copyState === 'failed' && <div className="text-xs text-red-300">Буфер обмена не принял данные.</div>}
                </div>
              )}
            </section>

            <details className="rounded border border-gray-800 bg-gray-950/25 p-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-300">Объединить дубль с этим делом</summary>
              <div className="mt-3 grid gap-2">
                <select value={mergeSourceId} onChange={(event) => setMergeSourceId(event.target.value)} className={fieldClass}>
                  <option value="">Выбрать дубль...</option>
                  {mergeCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
                </select>
                <textarea value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} rows={2} placeholder="Почему это дубль (необязательно)" className={`${fieldClass} resize-y`} />
                <button type="button" onClick={() => void mergeSource()} disabled={!mergeSourceId || mergeMutation.isPending} className={dangerButton}>Объединить без потери истории</button>
              </div>
            </details>

            {error && <div className="rounded border border-red-900 bg-red-950/20 p-3 text-xs text-red-300">{error instanceof Error ? error.message : 'Не удалось выполнить действие'}</div>}
          </aside>
        </div>
      </div>

      {deleteCandidate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setDeleteCandidate(null)}>
          <div className="w-full max-w-md rounded border border-red-900 bg-gray-900 p-4" onMouseDown={(event) => event.stopPropagation()}>
            <div className="font-semibold text-gray-100">Скрыть запись из текущей памяти?</div>
            <div className="mt-2 text-sm text-gray-400">История и факт удаления сохранятся. Прошлое не будет переписано незаметно.</div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteCandidate(null)} className={secondaryButton}>Отмена</button>
              <button type="button" onClick={() => void deleteEntry()} className={dangerButton}>Удалить с историей</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ReentryLine({ label, entry, empty }: { label: string; entry?: WorkMemoryEntryView; empty: string }) {
  return (
    <div>
      <span className="text-gray-500">{label}:</span>{' '}
      <span className={entry ? 'whitespace-pre-wrap text-gray-200' : 'text-amber-300'}>{entry ? entryContent(entry) : empty}</span>
    </div>
  )
}

function MemoryRow({ entry, onEdit, onDelete }: { entry: WorkMemoryEntryView; onEdit: () => void; onDelete: () => void }) {
  const [showHistory, setShowHistory] = useState(false)
  return (
    <article className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded border border-emerald-900 px-1.5 py-0.5 uppercase text-emerald-300">{memoryKindLabel(entry.current_revision.entry_kind)}</span>
          <span className="text-gray-500">{new Date(entry.occurred_at).toLocaleString('ru-RU')}</span>
          {entry.stage_title && <span className="text-cyan-400">этап: {entry.stage_title}</span>}
          {entry.revisions.length > 1 && <span className="text-amber-300">редакций: {entry.revisions.length}</span>}
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={onEdit} className={smallButton}>Править</button>
          <button type="button" onClick={() => setShowHistory((value) => !value)} className={smallButton}>История</button>
          <button type="button" onClick={onDelete} className="rounded px-2 py-1 text-[11px] text-red-400 hover:bg-red-950/30">Удалить</button>
        </div>
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200">{entryContent(entry)}</div>
      <div className="mt-1 text-[10px] text-gray-600">{entry.source} · {entry.provenance} · {entry.origin_kind}</div>
      {showHistory && (
        <div className="mt-3 grid gap-2 border-l border-gray-700 pl-3">
          {entry.revisions.map((revision) => (
            <div key={revision.id} className="text-xs text-gray-400">
              <div>v{revision.revision_number} · {revision.change_kind} · {new Date(revision.created_at).toLocaleString('ru-RU')}</div>
              <div className="mt-0.5 whitespace-pre-wrap text-gray-300">{revision.text ?? revision.material_value ?? '(без содержимого)'}</div>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function entryContent(entry: WorkMemoryEntryView) {
  return entry.current_revision.text ?? entry.current_revision.material_value ?? '(без содержимого)'
}

function memoryKindLabel(kind: WorkMemoryEntryKind) {
  return MEMORY_KINDS.find((entry) => entry.value === kind)?.label ?? kind
}

const fieldClass = 'min-w-0 rounded border border-gray-700 bg-gray-950 px-2.5 py-2 text-sm text-gray-100 placeholder-gray-600 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600'
const primaryButton = 'rounded bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-600'
const secondaryButton = 'rounded border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:border-gray-500 hover:text-gray-100 disabled:cursor-not-allowed disabled:text-gray-700'
const smallButton = 'rounded border border-gray-800 px-2 py-1 text-[11px] text-gray-400 hover:border-gray-600 hover:text-gray-200'
const activeTab = 'rounded border border-cyan-700 bg-cyan-950/40 px-2 py-1 text-[11px] text-cyan-200'
const dangerButton = 'rounded border border-red-800 px-3 py-2 text-xs text-red-300 hover:bg-red-950/30 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-700'
