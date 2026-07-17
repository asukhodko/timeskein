import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  LabelCreateParams,
  LabelUpdateParams,
  TrackCreateParams,
  TrackUpdateParams,
  WorkItemSetSemanticsParams,
} from '@timeskein/contracts'
import { taxonomyApi, workItemApi } from '../api/client'
import { queryKeys } from './useInventory'

export const taxonomyQueryKey = ['taxonomy'] as const

export function useTaxonomy(includeArchived = false) {
  return useQuery({
    queryKey: [...taxonomyQueryKey, includeArchived],
    queryFn: () => taxonomyApi.list(includeArchived),
  })
}

function useTaxonomyMutation<T>(mutationFn: (params: T) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taxonomyQueryKey })
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
      queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
    },
  })
}

export function useCreateTrack() {
  return useTaxonomyMutation((params: TrackCreateParams) => taxonomyApi.createTrack(params))
}

export function useUpdateTrack() {
  return useTaxonomyMutation((params: TrackUpdateParams) => taxonomyApi.updateTrack(params))
}

export function useArchiveTrack() {
  return useTaxonomyMutation(({ id, archived }: { id: string; archived: boolean }) =>
    taxonomyApi.archiveTrack(id, archived))
}

export function useCreateLabel() {
  return useTaxonomyMutation((params: LabelCreateParams) => taxonomyApi.createLabel(params))
}

export function useUpdateLabel() {
  return useTaxonomyMutation((params: LabelUpdateParams) => taxonomyApi.updateLabel(params))
}

export function useArchiveLabel() {
  return useTaxonomyMutation(({ id, archived }: { id: string; archived: boolean }) =>
    taxonomyApi.archiveLabel(id, archived))
}

export function useSetWorkItemSemantics() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: WorkItemSetSemanticsParams) => workItemApi.setSemantics(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
      queryClient.invalidateQueries({ queryKey: taxonomyQueryKey })
      queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
    },
  })
}
