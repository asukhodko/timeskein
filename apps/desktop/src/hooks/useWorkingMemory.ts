import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ContextPackBuildParams,
  WorkMemoryCreateParams,
  WorkMemoryListParams,
  WorkMemoryUpdateParams,
} from '@timeskein/contracts'
import { contextPackApi, workingMemoryApi, workItemApi } from '../api/client'

export const workingMemoryKeys = {
  entries: (params: WorkMemoryListParams) => ['workingMemory', 'entries', params] as const,
  stages: (workItemId: string) => ['workingMemory', 'stages', workItemId] as const,
  context: (params: ContextPackBuildParams) => ['workingMemory', 'context', params] as const,
}

function useInvalidateWorkingMemory() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['workingMemory'] })
    queryClient.invalidateQueries({ queryKey: ['workItemEvents'] })
    queryClient.invalidateQueries({ queryKey: ['inventory'] })
    queryClient.invalidateQueries({ queryKey: ['focus'] })
    queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
    queryClient.invalidateQueries({ queryKey: ['operationalWorkspace'] })
  }
}

export function useWorkingMemory(params: WorkMemoryListParams) {
  return useQuery({
    queryKey: workingMemoryKeys.entries(params),
    queryFn: () => workingMemoryApi.list(params),
  })
}

export function useCreateWorkingMemory() {
  const invalidate = useInvalidateWorkingMemory()
  return useMutation({ mutationFn: (params: WorkMemoryCreateParams) => workingMemoryApi.create(params), onSuccess: invalidate })
}

export function useUpdateWorkingMemory() {
  const invalidate = useInvalidateWorkingMemory()
  return useMutation({ mutationFn: (params: WorkMemoryUpdateParams) => workingMemoryApi.update(params), onSuccess: invalidate })
}

export function useDeleteWorkingMemory() {
  const invalidate = useInvalidateWorkingMemory()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => workingMemoryApi.delete(id, reason),
    onSuccess: invalidate,
  })
}

export function useWorkItemStages(workItemId: string) {
  return useQuery({
    queryKey: workingMemoryKeys.stages(workItemId),
    queryFn: () => workingMemoryApi.listStages(workItemId),
  })
}

export function useCreateWorkItemStage() {
  const invalidate = useInvalidateWorkingMemory()
  return useMutation({
    mutationFn: workingMemoryApi.createStage,
    onSuccess: invalidate,
  })
}

export function useUpdateWorkItemStage() {
  const invalidate = useInvalidateWorkingMemory()
  return useMutation({ mutationFn: workingMemoryApi.updateStage, onSuccess: invalidate })
}

export function useDeleteWorkItemStage() {
  const invalidate = useInvalidateWorkingMemory()
  return useMutation({ mutationFn: workingMemoryApi.deleteStage, onSuccess: invalidate })
}

export function useContextPack(params: ContextPackBuildParams) {
  return useQuery({
    queryKey: workingMemoryKeys.context(params),
    queryFn: () => contextPackApi.build(params),
  })
}

export function useMergeWorkItems() {
  const invalidate = useInvalidateWorkingMemory()
  return useMutation({
    mutationFn: ({ sourceId, canonicalId, reason }: { sourceId: string; canonicalId: string; reason?: string }) =>
      workItemApi.merge(sourceId, canonicalId, reason),
    onSuccess: invalidate,
  })
}
