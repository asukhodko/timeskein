/**
 * Format a relative time string from an ISO date
 */
export function formatRelativeTime(isoDate: string | undefined): string {
  if (!isoDate) return '—'

  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) {
    return 'now'
  } else if (diffMin < 60) {
    return `${diffMin}m`
  } else if (diffHour < 24) {
    return `${diffHour}h`
  } else if (diffDay < 30) {
    return `${diffDay}d`
  } else {
    return date.toLocaleDateString()
  }
}

/**
 * Truncate text to a maximum length
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '…'
}
