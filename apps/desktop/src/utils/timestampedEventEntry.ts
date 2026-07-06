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
