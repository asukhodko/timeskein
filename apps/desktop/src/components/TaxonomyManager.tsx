import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { LabelView, TrackView } from '@timeskein/contracts'
import {
  useArchiveLabel,
  useArchiveTrack,
  useCreateLabel,
  useCreateTrack,
  useTaxonomy,
  useUpdateLabel,
  useUpdateTrack,
} from '../hooks/useTaxonomy'

interface TaxonomyManagerProps {
  onClose: () => void
}

export default function TaxonomyManager({ onClose }: TaxonomyManagerProps) {
  const taxonomy = useTaxonomy(true)
  const createTrack = useCreateTrack()
  const createLabel = useCreateLabel()
  const [trackTitle, setTrackTitle] = useState('')
  const [parentTrackId, setParentTrackId] = useState('')
  const [labelTitle, setLabelTitle] = useState('')

  const submitTrack = async (event: FormEvent) => {
    event.preventDefault()
    if (!trackTitle.trim()) return
    await createTrack.mutateAsync({
      title: trackTitle.trim(),
      parent_track_id: parentTrackId || undefined,
    })
    setTrackTitle('')
    setParentTrackId('')
  }

  const submitLabel = async (event: FormEvent) => {
    event.preventDefault()
    if (!labelTitle.trim()) return
    await createLabel.mutateAsync({ title: labelTitle.trim() })
    setLabelTitle('')
  }

  const error = taxonomy.error ?? createTrack.error ?? createLabel.error

  return (
    <div
      data-timeskein-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Направления и метки</h2>
            <p className="mt-1 text-xs text-gray-500">Направление задаёт основной долгий контекст, метки дают поперечные срезы.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded text-xl text-gray-400 hover:bg-gray-700 hover:text-gray-100"
            aria-label="Закрыть"
            title="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-2">
          <section className="min-w-0">
            <h3 className="mb-3 text-sm font-semibold uppercase text-cyan-300">Направления</h3>
            <form onSubmit={submitTrack} className="mb-4 grid gap-2 border-b border-gray-700 pb-4">
              <input
                value={trackTitle}
                onChange={(event) => setTrackTitle(event.target.value)}
                placeholder="Новое направление"
                className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500"
              />
              <select
                value={parentTrackId}
                onChange={(event) => setParentTrackId(event.target.value)}
                className="rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500"
              >
                <option value="">Без родителя</option>
                {(taxonomy.data?.tracks ?? []).filter((track) => !track.archived).map((track) => (
                  <option key={track.id} value={track.id}>{formatTrackPath(track)}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!trackTitle.trim() || createTrack.isPending}
                className="rounded-md bg-cyan-700 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:bg-gray-700 disabled:text-gray-500"
              >
                Добавить направление
              </button>
            </form>
            <div className="grid gap-2">
              {(taxonomy.data?.tracks ?? []).map((track) => (
                <TrackRow key={track.id} track={track} tracks={taxonomy.data?.tracks ?? []} />
              ))}
            </div>
          </section>

          <section className="min-w-0">
            <h3 className="mb-3 text-sm font-semibold uppercase text-fuchsia-300">Метки</h3>
            <form onSubmit={submitLabel} className="mb-4 flex gap-2 border-b border-gray-700 pb-4">
              <input
                value={labelTitle}
                onChange={(event) => setLabelTitle(event.target.value)}
                placeholder="Новая метка"
                className="min-w-0 flex-1 rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-fuchsia-500"
              />
              <button
                type="submit"
                disabled={!labelTitle.trim() || createLabel.isPending}
                className="rounded-md bg-fuchsia-700 px-3 py-2 text-sm font-semibold text-white hover:bg-fuchsia-600 disabled:bg-gray-700 disabled:text-gray-500"
              >
                Добавить
              </button>
            </form>
            <div className="grid gap-2">
              {(taxonomy.data?.labels ?? []).map((label) => (
                <LabelRow key={label.id} label={label} />
              ))}
            </div>
          </section>
        </div>

        {error && (
          <div className="border-t border-red-900/50 bg-red-950/30 px-5 py-3 text-xs text-red-300">
            {error instanceof Error ? error.message : 'Не удалось сохранить изменения'}
          </div>
        )}
      </div>
    </div>
  )
}

function TrackRow({ track, tracks }: { track: TrackView; tracks: TrackView[] }) {
  const updateTrack = useUpdateTrack()
  const archiveTrack = useArchiveTrack()
  const [title, setTitle] = useState(track.title)
  const [parentTrackId, setParentTrackId] = useState(track.parent_track_id ?? '')

  useEffect(() => {
    setTitle(track.title)
    setParentTrackId(track.parent_track_id ?? '')
  }, [track])

  const save = () => updateTrack.mutate({
    id: track.id,
    title: title.trim(),
    parent_track_id: parentTrackId || null,
  })

  return (
    <div className={track.archived ? 'grid gap-2 border-b border-gray-800 pb-2 opacity-55' : 'grid gap-2 border-b border-gray-800 pb-2'}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100"
      />
      <select
        value={parentTrackId}
        onChange={(event) => setParentTrackId(event.target.value)}
        className="rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-300"
      >
        <option value="">Без родителя</option>
        {tracks.filter((candidate) => candidate.id !== track.id && !candidate.archived).map((candidate) => (
          <option key={candidate.id} value={candidate.id}>{formatTrackPath(candidate)}</option>
        ))}
      </select>
      <div className="flex justify-between gap-2">
        <span className="truncate text-xs text-gray-500">{formatTrackPath(track)}</span>
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={!title.trim() || updateTrack.isPending} className="text-xs text-cyan-300 hover:text-cyan-200 disabled:text-gray-600">Сохранить</button>
          <button type="button" onClick={() => archiveTrack.mutate({ id: track.id, archived: !track.archived })} className="text-xs text-amber-300 hover:text-amber-200">
            {track.archived ? 'Вернуть' : 'В архив'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LabelRow({ label }: { label: LabelView }) {
  const updateLabel = useUpdateLabel()
  const archiveLabel = useArchiveLabel()
  const [title, setTitle] = useState(label.title)

  useEffect(() => setTitle(label.title), [label.title])

  return (
    <div className={label.archived ? 'flex items-center gap-2 border-b border-gray-800 pb-2 opacity-55' : 'flex items-center gap-2 border-b border-gray-800 pb-2'}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100"
      />
      <button type="button" onClick={() => updateLabel.mutate({ id: label.id, title: title.trim() })} disabled={!title.trim() || updateLabel.isPending} className="text-xs text-fuchsia-300 hover:text-fuchsia-200 disabled:text-gray-600">Сохранить</button>
      <button type="button" onClick={() => archiveLabel.mutate({ id: label.id, archived: !label.archived })} className="text-xs text-amber-300 hover:text-amber-200">
        {label.archived ? 'Вернуть' : 'В архив'}
      </button>
    </div>
  )
}

function formatTrackPath(track: TrackView) {
  return track.path.map((node) => node.title).join(' / ')
}
