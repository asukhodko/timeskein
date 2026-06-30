import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { focusApi } from '../api/client'
import { queryKeys } from './useInventory'

export const focusQueryKeys = {
  current: ['focus', 'current'] as const,
  today: ['focus', 'today'] as const,
}

function todayWindow() {
  const from = new Date()
  from.setHours(0, 0, 0, 0)

  const to = new Date(from)
  to.setDate(to.getDate() + 1)

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  }
}

export function useCurrentFocusSession() {
  return useQuery({
    queryKey: focusQueryKeys.current,
    queryFn: () => focusApi.current(),
    refetchInterval: 1000,
  })
}

export function useTodayFocusSessions() {
  return useQuery({
    queryKey: focusQueryKeys.today,
    queryFn: () => focusApi.list(todayWindow()),
    refetchInterval: 1000,
  })
}

export function useStartFocusSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { title: string; work_item_id?: string; target_seconds?: number }) =>
      focusApi.start(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: focusQueryKeys.current })
      queryClient.invalidateQueries({ queryKey: focusQueryKeys.today })
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
    },
  })
}

export function useStopFocusSession() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params?: { id?: string; note?: string }) => focusApi.stop(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: focusQueryKeys.current })
      queryClient.invalidateQueries({ queryKey: focusQueryKeys.today })
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
    },
  })
}
