export type AppendTimestampedEventResult = {
  ok: boolean
  submittedText?: string
  nextDraft: string
}

export async function appendTimestampedEventDraft(
  draft: string,
  appendEvent: (text: string) => Promise<void> | void,
  pending = false
): Promise<AppendTimestampedEventResult> {
  const submittedText = draft.trim()
  if (!submittedText || pending) {
    return { ok: false, nextDraft: draft }
  }

  try {
    await appendEvent(submittedText)
    return { ok: true, submittedText, nextDraft: '' }
  } catch {
    return { ok: false, submittedText, nextDraft: draft }
  }
}

export function encodeTimestampedEventDraft(draft: string) {
  if (!draft) return ''

  return JSON.stringify({ text: draft })
}

export function decodeTimestampedEventDraft(raw: string | null | undefined) {
  if (!raw) return ''

  try {
    const parsed = JSON.parse(raw) as { text?: unknown }
    return typeof parsed.text === 'string' ? parsed.text : ''
  } catch {
    return ''
  }
}

export function timestampedEventDraftStorageKey(workItemId: string, date = new Date()) {
  return `timeskein.work-item-event-draft.v1.${formatLocalDayKey(date)}.${workItemId}`
}

function formatLocalDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
