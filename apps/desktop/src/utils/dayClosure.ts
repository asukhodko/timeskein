export interface DayClosureState {
  activeFocus?: boolean
  activeWorkItemCount?: number
}

export function isFinalDayClosureReport(state: DayClosureState) {
  return !state.activeFocus && (state.activeWorkItemCount ?? 0) === 0
}
