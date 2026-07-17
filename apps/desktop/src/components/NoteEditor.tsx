import { useState, useEffect, useRef } from 'react'
import type { EvidenceKind, RefKind, RefView, WorkItemAddEventParams } from '@timeskein/contracts'
import {
  appendTimestampedEventDraft,
  decodeTimestampedEventDraft,
  encodeTimestampedEventDraft,
  timestampedEventDraftStorageKey,
} from '../utils/timestampedEventEntry'
import { ITEM_UI_LABELS } from '../utils/itemUiLabels'

interface NoteEditorProps {
  itemId: string
  itemTitle: string
  currentNote: string | null
  onSave: (note: string) => void
  itemRefs?: RefView[]
  onAppendEvent?: (params: Omit<WorkItemAddEventParams, 'id' | 'focus_session_id'>) => Promise<void> | void
  appendPending?: boolean
  appendError?: string | null
  onClose: () => void
}

export default function NoteEditor({
  itemId,
  itemTitle,
  currentNote,
  onSave,
  itemRefs = [],
  onAppendEvent,
  appendPending = false,
  appendError,
  onClose,
}: NoteEditorProps) {
  const [note, setNote] = useState(currentNote || '')
  const [eventText, setEventText] = useState('')
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>('observation')
  const [refChoice, setRefChoice] = useState('')
  const [newRefKind, setNewRefKind] = useState<RefKind>('url')
  const [newRefValue, setNewRefValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const eventDraftStorageKey = timestampedEventDraftStorageKey(itemId)
  const eventDraftLoadedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }, [])

  useEffect(() => {
    eventDraftLoadedKeyRef.current = eventDraftStorageKey
    setEventText(readTimestampedEventDraft(eventDraftStorageKey))
  }, [eventDraftStorageKey])

  useEffect(() => {
    if (eventDraftLoadedKeyRef.current !== eventDraftStorageKey) return

    writeTimestampedEventDraft(eventDraftStorageKey, eventText)
  }, [eventDraftStorageKey, eventText])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        onSave(note)
        onClose()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [note, onSave, onClose])

  const appendEvent = async () => {
    const trimmed = eventText.trim()
    if (!trimmed || !onAppendEvent || appendPending) return

    const result = await appendTimestampedEventDraft(
      eventText,
      (text) => onAppendEvent({
        text,
        evidence_kind: evidenceKind,
        ref_ids: refChoice && refChoice !== '__new__' ? [refChoice] : [],
        new_ref: refChoice === '__new__' && newRefValue.trim()
          ? { kind: newRefKind, value: newRefValue.trim() }
          : undefined,
      }),
      appendPending,
    )
    if (result.ok) {
      clearTimestampedEventDraft(eventDraftStorageKey)
      setRefChoice('')
      setNewRefKind('url')
      setNewRefValue('')
    }
    setEventText(result.nextDraft)
  }

  return (
    <div
      data-timeskein-modal="true"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div
        ref={modalRef}
        className="bg-gray-800 border border-gray-600 rounded-lg p-4 shadow-xl w-[400px] max-w-[90vw]"
      >
        <div className="text-sm text-gray-400 mb-1">Править заметку для:</div>
        <div className="text-gray-200 font-medium mb-3 truncate">{itemTitle}</div>

        <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">{ITEM_UI_LABELS.noteDescription}</div>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Добавить описание..."
          rows={4}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg 
                     text-gray-200 placeholder-gray-500 resize-none
                     focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />

        {onAppendEvent && (
          <div className="mt-4 grid gap-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">Событие с отметкой времени</div>
            <textarea
              value={eventText}
              onChange={(e) => setEventText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  e.stopPropagation()
                  void appendEvent()
                }
              }}
              placeholder="Что изменилось или произошло?"
              rows={3}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg
                         text-gray-200 placeholder-gray-500 resize-none
                         focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
            <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
              <select
                value={evidenceKind}
                onChange={(event) => setEvidenceKind(event.target.value as EvidenceKind)}
                className="rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 focus:border-emerald-500"
                title="Тип смысловой записи"
              >
                <option value="result">Результат</option>
                <option value="decision">Решение</option>
                <option value="blocker">Блокер</option>
                <option value="next_step">Следующий шаг</option>
                <option value="observation">Наблюдение</option>
              </select>
              <select
                value={refChoice}
                onChange={(event) => setRefChoice(event.target.value)}
                className="min-w-0 rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 focus:border-emerald-500"
                title="Подтверждающий Ref"
              >
                <option value="">Без Ref</option>
                {itemRefs.map((ref) => (
                  <option key={ref.id} value={ref.id}>{ref.kind}: {ref.value}</option>
                ))}
                <option value="__new__">Новый Ref...</option>
              </select>
            </div>
            {refChoice === '__new__' && (
              <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
                <select
                  value={newRefKind}
                  onChange={(event) => setNewRefKind(event.target.value as RefKind)}
                  className="rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 focus:border-emerald-500"
                >
                  <option value="url">URL</option>
                  <option value="file_path">Файл</option>
                  <option value="issue_key">Ключ задачи</option>
                  <option value="custom">Другое</option>
                </select>
                <input
                  value={newRefValue}
                  onChange={(event) => setNewRefValue(event.target.value)}
                  placeholder="URL, путь или ключ"
                  className="min-w-0 rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:border-emerald-500"
                />
              </div>
            )}
            {appendError && (
              <div className="text-xs text-red-300">{appendError}</div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void appendEvent()}
                disabled={!eventText.trim() || appendPending}
                className="px-3 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 text-white rounded transition-colors disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
              >
                {appendPending ? 'Добавляю...' : 'Добавить событие'}
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mt-3">
          <div className="text-xs text-gray-500">
            Ctrl+Enter — сохранить, Esc — отменить
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={() => {
                onSave(note)
                onClose()
              }}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function readTimestampedEventDraft(key: string) {
  const storage = getLocalStorage()
  if (!storage) return ''

  return decodeTimestampedEventDraft(storage.getItem(key))
}

function writeTimestampedEventDraft(key: string, draft: string) {
  const storage = getLocalStorage()
  if (!storage) return

  const encoded = encodeTimestampedEventDraft(draft)
  if (!encoded) {
    storage.removeItem(key)
    return
  }

  storage.setItem(key, encoded)
}

function clearTimestampedEventDraft(key: string) {
  getLocalStorage()?.removeItem(key)
}

function getLocalStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
