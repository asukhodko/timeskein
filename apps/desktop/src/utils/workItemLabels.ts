import type { ActivityZone, WorkItemState } from '@timeskein/contracts'

export const workItemStateLabels: Record<WorkItemState, string> = {
  active: 'Активно',
  blocked: 'Заблокировано',
  waiting: 'Ждёт',
  someday: 'Когда-нибудь',
  unknown: 'Неясно',
  done: 'Готово',
}

export const workItemStateBadgeLabels: Record<WorkItemState, string> = {
  active: 'активно',
  blocked: 'блок',
  waiting: 'ждёт',
  someday: 'потом',
  unknown: 'неясно',
  done: 'готово',
}

export const activityZoneLabels: Record<ActivityZone, string> = {
  work: 'Работа',
  coordination: 'Координация',
  recovery: 'Восстановление',
  idle: 'Простой',
  personal: 'Личное',
}

export function formatWorkItemStateLabel(state: WorkItemState) {
  return workItemStateLabels[state] ?? state
}

export function formatWorkItemStateBadge(state: WorkItemState) {
  return workItemStateBadgeLabels[state] ?? state
}

export function formatActivityZoneBadge(zone: ActivityZone) {
  return activityZoneLabels[zone] ?? zone
}
