import { useState, useRef, useEffect } from 'react'
import { useCreateWorkItem } from '../hooks/useInventory'
import type { ActivityZone, WorkItemState, WorkItemType } from '@timeskein/contracts'

interface CreateDialogProps {
  onClose: () => void
  initialTitle?: string
}

export default function CreateDialog({ onClose, initialTitle = '' }: CreateDialogProps) {
  const [title, setTitle] = useState(initialTitle)
  const [note, setNote] = useState('')
  const [state, setState] = useState<WorkItemState>('unknown')
  const [type, setType] = useState<WorkItemType>('task')
  const [activityZone, setActivityZone] = useState<ActivityZone>('work')
  const [error, setError] = useState<string | null>(null)
  
  const titleRef = useRef<HTMLInputElement>(null)
  const createMutation = useCreateWorkItem()

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!title.trim()) return

    try {
      setError(null)
      await createMutation.mutateAsync({
        title: title.trim(),
        type,
        activity_zone: activityZone,
        state,
        note: note.trim() || undefined,
      })
      onClose()
    } catch (error) {
      console.error('Failed to create work item:', error)
      setError(error instanceof Error ? error.message : 'Failed to create work item')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      data-timeskein-modal="true"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-gray-800 rounded-lg border border-gray-700 p-4 w-96 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Создать Work Item</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Название *</label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded
                         text-gray-200 placeholder-gray-500
                         focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Чем занимаешься?"
            />
          </div>

          {/* Type & State row */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Тип</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as WorkItemType)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded
                           text-gray-200 focus:border-blue-500"
              >
                <option value="task">Задача</option>
                <option value="project">Проект</option>
                <option value="question">Вопрос</option>
              </select>
            </div>

            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Состояние</label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value as WorkItemState)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded
                           text-gray-200 focus:border-blue-500"
              >
                <option value="unknown">Неясно</option>
                <option value="active">Активно</option>
                <option value="waiting">Ждёт</option>
                <option value="blocked">Заблокировано</option>
                <option value="someday">Когда-нибудь</option>
                <option value="done">Готово</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Зона</label>
            <select
              value={activityZone}
              onChange={(e) => setActivityZone(e.target.value as ActivityZone)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded
                         text-gray-200 focus:border-blue-500"
            >
              <option value="work">Работа</option>
              <option value="coordination">Координация</option>
              <option value="recovery">Восстановление</option>
              <option value="idle">Простой</option>
              <option value="personal">Личное</option>
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Заметка</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded
                         text-gray-200 placeholder-gray-500 resize-none
                         focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Следующий шаг или дополнительный контекст..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            {error && (
              <div className="mr-auto max-w-48 text-xs text-red-300">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-gray-200 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!title.trim() || createMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {createMutation.isPending ? 'Создаю...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
