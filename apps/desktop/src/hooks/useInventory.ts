import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { inventoryApi, workItemApi, refApi } from '../api/client'
import type { WorkItemState, WorkItemUpdateParams } from '@timeskein/contracts'

// Query keys
export const queryKeys = {
  inventory: ['inventory'] as const,
  workItem: (id: string) => ['workItem', id] as const,
}

// Inventory hook
export function useInventory(search?: string) {
  return useQuery({
    queryKey: [...queryKeys.inventory, search],
    queryFn: () => inventoryApi.list({ filter: search ? { search } : undefined }),
  })
}

// Work item mutations
export function useCreateWorkItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { title: string; type?: string; state?: string; note?: string }) =>
      workItemApi.create(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
      queryClient.invalidateQueries({ queryKey: ['focus'] })
    },
  })
}

export function useTouchWorkItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => workItemApi.touch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
    },
  })
}

export function useSetWorkItemState() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: WorkItemState }) =>
      workItemApi.setState(id, state),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
      queryClient.invalidateQueries({ queryKey: ['focus'] })
    },
  })
}

export function useSetWorkItemNote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => workItemApi.setNote(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
    },
  })
}

export function useUpdateWorkItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: WorkItemUpdateParams) => workItemApi.update(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
      queryClient.invalidateQueries({ queryKey: ['focus'] })
    },
  })
}

export function useToggleWorkItemPin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => workItemApi.togglePin(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
    },
  })
}

export function useDeleteWorkItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode?: 'soft' | 'hard' }) =>
      workItemApi.delete(id, mode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
    },
  })
}

// Ref mutations
export function useOpenRef() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ workItemId, refId }: { workItemId: string; refId?: string }) =>
      refApi.open(workItemId, refId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
    },
  })
}

export function useAddRef() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { work_item_id: string; kind: string; value: string; is_primary?: boolean }) =>
      refApi.add(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
    },
  })
}

export function useRemoveRef() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ workItemId, refId }: { workItemId: string; refId: string }) =>
      refApi.remove(workItemId, refId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
    },
  })
}
