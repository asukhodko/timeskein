import { useTaxonomy } from '../hooks/useTaxonomy'

interface SemanticFieldsProps {
  trackId: string
  labelIds: string[]
  onTrackChange: (trackId: string) => void
  onLabelsChange: (labelIds: string[]) => void
}

export default function SemanticFields({
  trackId,
  labelIds,
  onTrackChange,
  onLabelsChange,
}: SemanticFieldsProps) {
  const taxonomy = useTaxonomy(true)
  const tracks = (taxonomy.data?.tracks ?? []).filter((track) => !track.archived || track.id === trackId)
  const labels = (taxonomy.data?.labels ?? []).filter((label) => !label.archived || labelIds.includes(label.id))

  const toggleLabel = (labelId: string) => {
    onLabelsChange(
      labelIds.includes(labelId)
        ? labelIds.filter((id) => id !== labelId)
        : [...labelIds, labelId]
    )
  }

  return (
    <div className="grid gap-3 border-t border-gray-700 pt-3">
      <label className="grid gap-1 text-sm text-gray-300">
        <span>Направление</span>
        <select
          value={trackId}
          onChange={(event) => onTrackChange(event.target.value)}
          className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Без направления</option>
          {tracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.path.map((node) => node.title).join(' / ')}{track.archived ? ' (архив)' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-1 text-sm text-gray-300">
        <span>Метки</span>
        {labels.length > 0 ? (
          <div className="flex min-h-9 flex-wrap gap-2 rounded-md border border-gray-700 bg-gray-900/50 p-2">
            {labels.map((label) => {
              const selected = labelIds.includes(label.id)
              return (
                <button
                  key={label.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleLabel(label.id)}
                  className={selected
                    ? 'rounded border border-cyan-500/60 bg-cyan-500/15 px-2 py-1 text-xs text-cyan-200'
                    : 'rounded border border-gray-600 px-2 py-1 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-200'}
                >
                  {label.title}{label.archived ? ' (архив)' : ''}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="text-xs text-gray-500">Метки ещё не созданы.</div>
        )}
      </div>

      {taxonomy.error && (
        <div className="text-xs text-red-300">
          {taxonomy.error instanceof Error ? taxonomy.error.message : 'Не удалось загрузить направления'}
        </div>
      )}
    </div>
  )
}
