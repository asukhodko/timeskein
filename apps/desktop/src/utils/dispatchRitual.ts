export const DISPATCH_RITUAL_MODE_LABELS = {
  day_entry: 'Вход в день',
  return_after_break: 'Возврат после перерыва',
} as const

export type DispatchRitualMode = keyof typeof DISPATCH_RITUAL_MODE_LABELS

export interface DispatchRitualDraft {
  mode: DispatchRitualMode
  activeSet: string
  firstFocus: string
  parked: string
  reason: string
}

export const DEFAULT_DISPATCH_RITUAL_MODE: DispatchRitualMode = 'day_entry'

const DISPATCH_RITUAL_MODES = Object.keys(DISPATCH_RITUAL_MODE_LABELS) as DispatchRitualMode[]
const DISPATCH_RITUAL_DRAFT_STORAGE_PREFIX = 'timeskein.dispatch-ritual-draft.v1.'

export function formatDispatchRitualEvent(draft: DispatchRitualDraft) {
  const normalized = normalizeDispatchRitualDraft(draft)
  const parts = [
    ['active set', normalized.activeSet],
    ['первый фокус', normalized.firstFocus],
    ['припарковано', normalized.parked],
    ['почему достаточно важно', normalized.reason],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)

  if (parts.length === 0) return ''

  return `${DISPATCH_RITUAL_MODE_LABELS[normalized.mode]}: ${parts.join('; ')}`
}

export function isDispatchRitualStartReady(draft: DispatchRitualDraft) {
  return Boolean(normalizeDispatchRitualDraft(draft).firstFocus)
}

export function encodeDispatchRitualDraft(draft: DispatchRitualDraft) {
  const normalized = normalizeDispatchRitualDraft(draft)
  if (
    normalized.mode === DEFAULT_DISPATCH_RITUAL_MODE &&
    !normalized.activeSet &&
    !normalized.firstFocus &&
    !normalized.parked &&
    !normalized.reason
  ) {
    return ''
  }

  return JSON.stringify(normalized)
}

export function decodeDispatchRitualDraft(raw: string | null | undefined): DispatchRitualDraft {
  if (!raw) return emptyDispatchRitualDraft()

  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof DispatchRitualDraft, unknown>>
    return normalizeDispatchRitualDraft({
      mode: parsed.mode as DispatchRitualMode,
      activeSet: typeof parsed.activeSet === 'string' ? parsed.activeSet : '',
      firstFocus: typeof parsed.firstFocus === 'string' ? parsed.firstFocus : '',
      parked: typeof parsed.parked === 'string' ? parsed.parked : '',
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    })
  } catch {
    return emptyDispatchRitualDraft()
  }
}

export function dispatchRitualDraftStorageKey(date = new Date()) {
  return `${DISPATCH_RITUAL_DRAFT_STORAGE_PREFIX}${formatLocalDayKey(date)}`
}

export function normalizeDispatchRitualDraft(draft: Partial<DispatchRitualDraft>): DispatchRitualDraft {
  return {
    mode: isDispatchRitualMode(draft.mode) ? draft.mode : DEFAULT_DISPATCH_RITUAL_MODE,
    activeSet: trimLine(draft.activeSet),
    firstFocus: trimLine(draft.firstFocus),
    parked: trimLine(draft.parked),
    reason: trimLine(draft.reason),
  }
}

function emptyDispatchRitualDraft(): DispatchRitualDraft {
  return {
    mode: DEFAULT_DISPATCH_RITUAL_MODE,
    activeSet: '',
    firstFocus: '',
    parked: '',
    reason: '',
  }
}

function isDispatchRitualMode(value: unknown): value is DispatchRitualMode {
  return DISPATCH_RITUAL_MODES.includes(value as DispatchRitualMode)
}

function trimLine(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function formatLocalDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
