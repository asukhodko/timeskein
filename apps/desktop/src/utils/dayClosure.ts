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
