import type { EvidenceKind, RefKind } from '@timeskein/contracts'

export const ACTIVE_FOCUS_JOURNAL_KIND_LABELS = {
  result: 'Результат',
  thought: 'Мысль',
  decision: 'Решение',
  blocker: 'Блокер',
  question: 'Вопрос',
  next_step: 'Следующий шаг',
  observation: 'Наблюдение',
  milestone: 'Веха',
  interruption: 'Отвлечение',
} as const

export type ActiveFocusJournalKind = keyof typeof ACTIVE_FOCUS_JOURNAL_KIND_LABELS

export const ACTIVE_FOCUS_JOURNAL_TARGET_LABELS = {
  work_item: 'К делу',
  day: 'К дню',
} as const

export type ActiveFocusJournalTarget = keyof typeof ACTIVE_FOCUS_JOURNAL_TARGET_LABELS

export interface ActiveFocusJournalDraft {
  text: string
  kind: ActiveFocusJournalKind
  target: ActiveFocusJournalTarget
  refChoice: string
  newRefKind: RefKind
  newRefValue: string
}

export const DEFAULT_ACTIVE_FOCUS_JOURNAL_KIND: ActiveFocusJournalKind = 'thought'
export const DEFAULT_ACTIVE_FOCUS_JOURNAL_TARGET: ActiveFocusJournalTarget = 'work_item'
export const DEFAULT_ACTIVE_FOCUS_JOURNAL_REF_KIND: RefKind = 'url'
export const ACTIVE_FOCUS_JOURNAL_NEW_REF = '__new__'

const KIND_VALUES = Object.keys(ACTIVE_FOCUS_JOURNAL_KIND_LABELS) as ActiveFocusJournalKind[]
const TARGET_VALUES = Object.keys(ACTIVE_FOCUS_JOURNAL_TARGET_LABELS) as ActiveFocusJournalTarget[]
const ACTIVE_FOCUS_JOURNAL_DRAFT_STORAGE_PREFIX = 'timeskein.active-focus-journal-draft.v1.'

export function formatActiveFocusJournalText(kind: ActiveFocusJournalKind, text: string) {
  const trimmed = text.trim()
  if (!trimmed) return ''

  const label = ACTIVE_FOCUS_JOURNAL_KIND_LABELS[isActiveFocusJournalKind(kind) ? kind : DEFAULT_ACTIVE_FOCUS_JOURNAL_KIND]
  return `${label}: ${trimmed}`
}

export function evidenceKindForJournalKind(kind: ActiveFocusJournalKind): EvidenceKind {
  if (kind === 'result' || kind === 'decision' || kind === 'blocker' || kind === 'next_step' || kind === 'observation') {
    return kind
  }
  return 'observation'
}

export function encodeActiveFocusJournalDraft(draft: ActiveFocusJournalDraft) {
  const safeDraft = normalizeActiveFocusJournalDraft(draft)
  if (
    !safeDraft.text
    && safeDraft.kind === DEFAULT_ACTIVE_FOCUS_JOURNAL_KIND
    && safeDraft.target === DEFAULT_ACTIVE_FOCUS_JOURNAL_TARGET
    && !safeDraft.refChoice
    && !safeDraft.newRefValue
  ) {
    return ''
  }

  return JSON.stringify(safeDraft)
}

export function decodeActiveFocusJournalDraft(raw: string | null | undefined): ActiveFocusJournalDraft {
  if (!raw) return emptyActiveFocusJournalDraft()

  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof ActiveFocusJournalDraft, unknown>>
    return normalizeActiveFocusJournalDraft({
      text: typeof parsed.text === 'string' ? parsed.text : '',
      kind: parsed.kind as ActiveFocusJournalKind,
      target: parsed.target as ActiveFocusJournalTarget,
      refChoice: typeof parsed.refChoice === 'string' ? parsed.refChoice : '',
      newRefKind: parsed.newRefKind as RefKind,
      newRefValue: typeof parsed.newRefValue === 'string' ? parsed.newRefValue : '',
    })
  } catch {
    return emptyActiveFocusJournalDraft()
  }
}

export function activeFocusJournalDraftStorageKey(anchor: string, date = new Date()) {
  const keyPart = encodeURIComponent(anchor.trim() || 'day')
  return `${ACTIVE_FOCUS_JOURNAL_DRAFT_STORAGE_PREFIX}${formatLocalDayKey(date)}.${keyPart}`
}

export function normalizeActiveFocusJournalDraft(draft: Partial<ActiveFocusJournalDraft>): ActiveFocusJournalDraft {
  return {
    text: typeof draft.text === 'string' ? draft.text : '',
    kind: isActiveFocusJournalKind(draft.kind) ? draft.kind : DEFAULT_ACTIVE_FOCUS_JOURNAL_KIND,
    target: isActiveFocusJournalTarget(draft.target) ? draft.target : DEFAULT_ACTIVE_FOCUS_JOURNAL_TARGET,
    refChoice: typeof draft.refChoice === 'string' ? draft.refChoice : '',
    newRefKind: isRefKind(draft.newRefKind) ? draft.newRefKind : DEFAULT_ACTIVE_FOCUS_JOURNAL_REF_KIND,
    newRefValue: typeof draft.newRefValue === 'string' ? draft.newRefValue : '',
  }
}

function emptyActiveFocusJournalDraft(): ActiveFocusJournalDraft {
  return {
    text: '',
    kind: DEFAULT_ACTIVE_FOCUS_JOURNAL_KIND,
    target: DEFAULT_ACTIVE_FOCUS_JOURNAL_TARGET,
    refChoice: '',
    newRefKind: DEFAULT_ACTIVE_FOCUS_JOURNAL_REF_KIND,
    newRefValue: '',
  }
}

function isActiveFocusJournalKind(value: unknown): value is ActiveFocusJournalKind {
  return KIND_VALUES.includes(value as ActiveFocusJournalKind)
}

function isActiveFocusJournalTarget(value: unknown): value is ActiveFocusJournalTarget {
  return TARGET_VALUES.includes(value as ActiveFocusJournalTarget)
}

function isRefKind(value: unknown): value is RefKind {
  return ['url', 'file_path', 'issue_key', 'custom'].includes(String(value))
}

function formatLocalDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
