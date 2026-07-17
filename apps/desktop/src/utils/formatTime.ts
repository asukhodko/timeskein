/**
 * Format a relative time string from an ISO date.
 */
export function formatRelativeTime(isoDate: string | undefined, now = new Date()): string {
  if (!isoDate) return '—'

  const date = new Date(isoDate)
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) {
    return 'сейчас'
  } else if (diffMin < 60) {
    return `${diffMin} мин назад`
  } else if (diffHour < 24) {
    return `${diffHour} ч назад`
  } else if (diffDay < 30) {
    return `${diffDay} дн назад`
  } else {
    return date.toLocaleDateString('ru-RU')
  }
}

/**
 * Truncate text to a maximum length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '…'
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(Math.floor(totalSeconds), 0)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }

  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function formatClockTime(isoDate: string | undefined): string {
  if (!isoDate) return 'сейчас'

  return new Date(isoDate).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatContextTimestamp(isoDate: string | undefined, now = new Date()): string {
  if (!isoDate) return 'сейчас'

  const date = new Date(isoDate)
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  if (sameDay) return formatClockTime(isoDate)

  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear() === now.getFullYear() ? '' : `.${date.getFullYear()}`
  return `${day}.${month}${year} · ${formatClockTime(isoDate)}`
}
