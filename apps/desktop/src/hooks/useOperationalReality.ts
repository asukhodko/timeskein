import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  OperationalRealityFollowUpDecisionParams,
  OperationalRealitySetNextActionParams,
  OperationalRealitySetStateParams,
} from '@timeskein/contracts'

import { operationalRealityApi } from '../api/client'

export const operationalRealityQueryKey = ['operationalReality'] as const

export function useOperationalReality() {
  return useQuery({
    queryKey: operationalRealityQueryKey,
    queryFn: () => operationalRealityApi.list(),
    refetchInterval: 30_000,
  })
}

function useRealityMutation<T>(mutationFn: (params: T) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationalRealityQueryKey })
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['captures'] })
      queryClient.invalidateQueries({ queryKey: ['focus'] })
    },
  })
}

export function useSetOperationalState() {
  return useRealityMutation((params: OperationalRealitySetStateParams) =>
    operationalRealityApi.setState(params)
  )
}

export function useSetOperationalNextAction() {
  return useRealityMutation((params: OperationalRealitySetNextActionParams) =>
    operationalRealityApi.setNextAction(params)
  )
}

export function useFollowUpOperationalDecision() {
  return useRealityMutation((params: OperationalRealityFollowUpDecisionParams) =>
    operationalRealityApi.followUpDecision(params)
  )
}
