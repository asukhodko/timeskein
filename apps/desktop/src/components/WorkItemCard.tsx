import clsx from 'clsx'
import type { ActivityZone, WorkItemView, WorkItemState } from '@timeskein/contracts'
import { formatRelativeTime, truncate } from '../utils/formatTime'
import { getWorkItemTimeBadges } from '../utils/workItemCardMeta'
import { formatActivityZoneBadge, formatWorkItemStateBadge } from '../utils/workItemLabels'

interface WorkItemCardProps {
  item: WorkItemView
  isSelected: boolean
  onClick: () => void
  onDoubleClick?: () => void
}

const stateColorClasses: Record<WorkItemState, string> = {
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  blocked: 'bg-red-500/20 text-red-400 border-red-500/30',
  waiting: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  someday: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  done: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

const zoneColorClasses: Record<ActivityZone, string> = {
  work: 'border-blue-500/30 text-blue-300',
  coordination: 'border-cyan-500/30 text-cyan-300',
  recovery: 'border-emerald-500/30 text-emerald-300',
  idle: 'border-gray-500/30 text-gray-400',
  personal: 'border-fuchsia-500/30 text-fuchsia-300',
}

export default function WorkItemCard({
  item,
  isSelected,
  onClick,
  onDoubleClick,
}: WorkItemCardProps) {
  const lastSeen = formatRelativeTime(item.last_seen_at)
  const lastSeenLabel = lastSeen === '—' ? lastSeen : lastSeen === 'now' ? 'сейчас' : `${lastSeen} назад`
  const timeBadges = getWorkItemTimeBadges(item)

  return (
    <div
      className={clsx(
        'px-4 py-2 cursor-pointer transition-colors',
        isSelected ? 'bg-blue-500/20' : 'hover:bg-gray-800/50'
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <div className="flex items-start gap-3">
        {/* Pin indicator */}
        <div className="flex-shrink-0 w-4 pt-0.5">
          {item.pinned && (
            <span className="text-yellow-500" title="Pinned">
              📌
            </span>
          )}
        </div>

        {/* State badge */}
        <div
          className={clsx(
            'flex-shrink-0 px-2 py-0.5 text-xs rounded border',
            stateColorClasses[item.state as WorkItemState] || stateColorClasses.unknown
          )}
        >
          {formatWorkItemStateBadge(item.state as WorkItemState)}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="text-gray-200 font-medium truncate">{item.title}</div>

          {/* Note preview */}
          {item.note && (
            <div className="text-gray-500 text-sm truncate mt-0.5">
              {truncate(item.note, 60)}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
            <span
              className={clsx(
                'rounded border px-1.5 py-0.5 uppercase tracking-wide',
                zoneColorClasses[item.activity_zone] || zoneColorClasses.work
              )}
            >
              {formatActivityZoneBadge(item.activity_zone)}
            </span>
            {timeBadges.map((badge) => (
              <span
                key={badge.kind}
                className={clsx(
                  'rounded border px-1.5 py-0.5',
                  badge.kind === 'today'
                    ? 'border-gray-700 text-gray-300'
                    : 'border-gray-800 text-gray-500'
                )}
              >
                {badge.label} {badge.value}
              </span>
            ))}
          </div>
        </div>

        {/* Meta */}
        <div className="flex-shrink-0 flex items-center gap-3 text-xs text-gray-500">
          {/* Refs count */}
          {item.refs_count > 0 && (
            <span title={`${item.refs_count} ref(s)`}>
              📎{item.refs_count}
            </span>
          )}

          {/* Last seen */}
          <span className="w-14 text-right" title={item.last_seen_at || 'Нет касаний'}>
            {lastSeenLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
