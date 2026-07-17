import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { captureApi } from '../api/client'
import { queryKeys } from './useInventory'

export const captureQueryKeys = {
  open: ['captures', 'open'] as const,
  activity: ['captures', 'activity'] as const,
}

export function useOpenCaptures() {
  return useQuery({
    queryKey: captureQueryKeys.open,
    queryFn: () => captureApi.list({ state: ['open'] }),
    refetchInterval: 5000,
  })
}

export function useCaptureActivity() {
  return useQuery({
    queryKey: captureQueryKeys.activity,
    queryFn: () => captureApi.list({ state: ['open', 'resolved', 'converted'] }),
    refetchInterval: 5000,
  })
}

export function useCreateCapture() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { text: string; focus_session_id?: string }) => captureApi.create(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.open })
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.activity })
      queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
    },
  })
}

export function useResolveCapture() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => captureApi.resolve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.open })
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.activity })
      queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
    },
  })
}

export function useUpdateCapture() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { id: string; text: string }) => captureApi.update(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.open })
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.activity })
      queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
    },
  })
}

export function useDeleteCapture() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => captureApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.open })
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.activity })
      queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
    },
  })
}

export function useConvertCaptureToWorkItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { id: string; title?: string }) => captureApi.convertToWorkItem(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.open })
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.activity })
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
      queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
    },
  })
}

export function useAppendCaptureToWorkItemEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { id: string; work_item_id?: string }) =>
      captureApi.appendToWorkItemEvent(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.open })
      queryClient.invalidateQueries({ queryKey: captureQueryKeys.activity })
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory })
      queryClient.invalidateQueries({ queryKey: ['workItemEvents'] })
      queryClient.invalidateQueries({ queryKey: ['operationalReality'] })
    },
  })
}
