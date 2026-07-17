import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DayContractReviseParams } from '@timeskein/contracts'

import { operationalWorkspaceApi } from '../api/client'

export const operationalWorkspaceQueryRoot = ['operationalWorkspace'] as const
export const operationalWorkspaceQueryKey = (localDate: string) => [
  ...operationalWorkspaceQueryRoot,
  localDate,
] as const

export function useOperationalWorkspace(localDate: string) {
  return useQuery({
    queryKey: operationalWorkspaceQueryKey(localDate),
    queryFn: () => operationalWorkspaceApi.get({ local_date: localDate }),
    refetchInterval: 30_000,
  })
}

export function useReviseDayContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: DayContractReviseParams) =>
      operationalWorkspaceApi.reviseContract(params),
    onSuccess: (_response, params) => {
      queryClient.invalidateQueries({ queryKey: operationalWorkspaceQueryKey(params.local_date) })
      queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['focus'] })
    },
  })
}
