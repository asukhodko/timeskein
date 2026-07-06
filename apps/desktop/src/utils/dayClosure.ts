export interface DayClosureState {
  activeFocus?: boolean
  activeWorkItemCount?: number
  pendingReviewItemCount?: number
}

export function isFinalDayClosureReport(state: DayClosureState) {
  return !state.activeFocus && (state.activeWorkItemCount ?? 0) === 0
}

export function isDayClosureReadyForFinalReport(state: DayClosureState) {
  return isFinalDayClosureReport(state) && (state.pendingReviewItemCount ?? 0) === 0
}
