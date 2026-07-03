import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dayEventApi } from '../api/client'
import type { DayEventAddParams, DayEventListParams, DayEventUpdateParams } from '@timeskein/contracts'

export const dayEventQueryKeys = {
  list: (params?: DayEventListParams) => ['dayEvents', params] as const,
}

export function useDayEvents(params?: DayEventListParams) {
  return useQuery({
    queryKey: dayEventQueryKeys.list(params),
    queryFn: () => dayEventApi.list(params),
  })
}

export function useAddDayEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: DayEventAddParams) => dayEventApi.add(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dayEvents'] })
    },
  })
}

export function useUpdateDayEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: DayEventUpdateParams) => dayEventApi.update(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dayEvents'] })
    },
  })
}

export function useDeleteDayEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => dayEventApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dayEvents'] })
    },
  })
}
