export interface DayClosureState {
  activeFocus?: boolean
  activeWorkItemCount?: number
  pendingReviewItemCount?: number
}

export type DayClosureStage = 'no_data' | 'not_started' | 'blocked' | 'review' | 'ready'

export interface DayClosureFlowState extends DayClosureState {
  closureStarted?: boolean
  hasFocusBlocks?: boolean
}

export interface DayClosureReviewCounts {
  blockerCount: number
  reviewCount: number
  readyCount: number
}

export interface BulkAcceptableReviewItem {
  level: string
  action?: string
}

export function isFinalDayClosureReport(state: DayClosureState) {
  return !state.activeFocus && (state.activeWorkItemCount ?? 0) === 0
}

export function isDayClosureReadyForFinalReport(state: DayClosureState) {
  return isFinalDayClosureReport(state) && (state.pendingReviewItemCount ?? 0) === 0
}

export function getDayClosureStage(state: DayClosureFlowState): DayClosureStage {
  if (!state.hasFocusBlocks) return 'no_data'
  if (!state.closureStarted) return 'not_started'
  if (!isFinalDayClosureReport(state)) return 'blocked'
  if ((state.pendingReviewItemCount ?? 0) > 0) return 'review'

  return 'ready'
}

export function shouldSummarizeReadyReviewItems(counts: DayClosureReviewCounts) {
  return counts.readyCount > 0 && (counts.blockerCount > 0 || counts.reviewCount > 0)
}

export function shouldCompactAcceptAsIsReviewItems(items: BulkAcceptableReviewItem[]) {
  return getBulkAcceptableReviewActions(items).length > 0
}

export function getBulkAcceptableReviewActions(items: BulkAcceptableReviewItem[]) {
  if (items.some((item) => item.level === 'blocker')) return []

  const reviewItems = items.filter((item) => item.level === 'review')
  if (reviewItems.length <= 1) return []

  const actions = reviewItems.map((item) => item.action)
  if (actions.some((action) => !isBulkAcceptableReviewAction(action))) {
    return []
  }

  return [...new Set(actions)] as string[]
}

export function isBulkAcceptableReviewAction(action?: string) {
  return Boolean(action?.startsWith('accept_'))
}
