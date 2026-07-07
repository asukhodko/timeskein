import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ActivityZone, WorkItemType, WorkItemView } from '@timeskein/contracts'
import { useUpdateWorkItem } from '../hooks/useInventory'

interface WorkItemEditorProps {
  item: WorkItemView
  onClose: () => void
}

const itemTypes: WorkItemType[] = ['task', 'project', 'question']
const activityZones: ActivityZone[] = ['work', 'coordination', 'recovery', 'idle', 'personal']
const itemTypeLabels: Record<WorkItemType, string> = {
  task: 'Задача',
  project: 'Проект',
  question: 'Вопрос',
}
const activityZoneLabels: Record<ActivityZone, string> = {
  work: 'Работа',
  coordination: 'Координация',
  recovery: 'Восстановление',
  idle: 'Простой',
  personal: 'Личное',
}

export default function WorkItemEditor({ item, onClose }: WorkItemEditorProps) {
  const [title, setTitle] = useState(item.title)
  const [type, setType] = useState<WorkItemType>(item.type ?? 'task')
  const [activityZone, setActivityZone] = useState<ActivityZone>(item.activity_zone)
  const [note, setNote] = useState(item.note ?? '')
  const updateMutation = useUpdateWorkItem()

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle || updateMutation.isPending) return

    updateMutation.mutate(
      {
        id: item.id,
        title: trimmedTitle,
        type,
        activity_zone: activityZone,
        note: note.trim() || null,
      },
      {
        onSuccess: onClose,
      }
    )
  }

  return (
    <div
      data-timeskein-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <form
        className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-800 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="mb-4 text-lg font-semibold text-gray-100">Править дело</div>

        <label className="mb-3 grid gap-1 text-sm text-gray-300">
          <span>Название</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="mb-3 grid gap-1 text-sm text-gray-300">
          <span>Тип</span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as WorkItemType)}
            className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {itemTypes.map((itemType) => (
              <option key={itemType} value={itemType}>
                {itemTypeLabels[itemType]}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-3 grid gap-1 text-sm text-gray-300">
          <span>Зона</span>
          <select
            value={activityZone}
            onChange={(event) => setActivityZone(event.target.value as ActivityZone)}
            className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {activityZones.map((zone) => (
              <option key={zone} value={zone}>
                {activityZoneLabels[zone]}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 grid gap-1 text-sm text-gray-300">
          <span>Заметка</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="h-24 resize-y rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </label>

        {updateMutation.error && (
          <div className="mb-3 text-xs text-red-300">
            {updateMutation.error instanceof Error ? updateMutation.error.message : 'Не удалось сохранить изменения'}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={!title.trim() || updateMutation.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
          >
            Сохранить
          </button>
        </div>
      </form>
    </div>
  )
}
