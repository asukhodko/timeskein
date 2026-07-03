import {
  API_VERSION,
  type ApiRequest,
  type ApiResponse,
  type InventoryListResponse,
  type InventoryListParams,
  type WorkItemView,
  type WorkItemAddEventParams,
  type WorkItemEventView,
  type WorkItemEventsParams,
  type WorkItemEventsResponse,
  type WorkItemUpdateEventParams,
  type WorkItemUpdateParams,
  type WorkItemCreateParams,
  type WorkItemCreateResponse,
  type WorkItemDeleteEventResponse,
  type WorkItemDeleteResponse,
  type AgentStatus,
  type Settings,
  type DenylistRule,
  type FocusCurrentResponse,
  type FocusListResponse,
  type FocusSessionView,
  type FocusSplitParams,
  type FocusSplitResponse,
  type FocusUpdateParams,
  type CaptureConvertResponse,
  type CaptureAppendEventResponse,
  type CaptureDeleteResponse,
  type CaptureListResponse,
  type CaptureState,
  type CaptureView,
  type AppEventKind,
  type AppEventListResponse,
  type AppEventSource,
  type AppEventSummary,
  type AppEventView,
  isApiError,
} from '@timeskein/contracts'

// Simple UUID generator for browser
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const MOCK_API_URL = 'http://127.0.0.1:3456/api'

type TauriWindow = Window &
  typeof globalThis & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }

const isTauriRuntime = (): boolean => {
  if (typeof window === 'undefined') return false

  const tauriWindow = window as TauriWindow
  return Boolean(
    tauriWindow.__TAURI__ ||
      tauriWindow.__TAURI_INTERNALS__ ||
      window.location.protocol === 'tauri:' ||
      window.location.hostname === 'tauri.localhost'
  )
}

let apiUrlPromise: Promise<string> | null = null

// Get API base URL: mock server in browser, embedded Rust agent in Tauri.
const getApiUrl = async (): Promise<string> => {
  if (!isTauriRuntime()) {
    return MOCK_API_URL
  }

  apiUrlPromise ??= import('@tauri-apps/api/core').then(({ invoke }) =>
    invoke<string>('get_api_url')
  )

  return apiUrlPromise
}

// Make an RPC call
async function rpc<T>(method: string, params?: object): Promise<T> {
  const request: ApiRequest<object> = {
    version: API_VERSION,
    request_id: generateUuid(),
    method,
    params,
  }

  const response = await fetch(await getApiUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`)
  }

  const data: ApiResponse<T> = await response.json()

  if (isApiError(data)) {
    const error = new Error(data.error.message) as Error & { code: string; details?: unknown }
    error.code = data.error.code
    error.details = data.error.details
    throw error
  }

  return data.result as T
}

// Agent API
export const agentApi = {
  ping: () => rpc<string>('agent.ping'),
  status: () => rpc<AgentStatus>('agent.status'),
  version: () => rpc<{ agent_version: string; api_version: string }>('agent.version'),
}

// Inventory API
export const inventoryApi = {
  list: (params?: InventoryListParams) =>
    rpc<InventoryListResponse>('inventory.list', params),
  get: (id: string) => rpc<WorkItemView>('inventory.get', { id }),
}

// Work Item API
export const workItemApi = {
  create: (params: WorkItemCreateParams) =>
    rpc<WorkItemCreateResponse>('work_item.create', params),
  update: (params: WorkItemUpdateParams) =>
    rpc<WorkItemView>('work_item.update', params),
  touch: (id: string) => rpc<{ success: boolean }>('work_item.touch', { id }),
  setState: (id: string, state: string) =>
    rpc<{ success: boolean }>('work_item.set_state', { id, state }),
  setNote: (id: string, note: string) =>
    rpc<{ success: boolean }>('work_item.set_note', { id, note }),
  addEvent: (params: WorkItemAddEventParams) =>
    rpc<WorkItemEventView>('work_item.add_event', params),
  events: (params?: WorkItemEventsParams) =>
    rpc<WorkItemEventsResponse>('work_item.events', params),
  updateEvent: (params: WorkItemUpdateEventParams) =>
    rpc<WorkItemEventView>('work_item.update_event', params),
  deleteEvent: (id: string) =>
    rpc<WorkItemDeleteEventResponse>('work_item.delete_event', { id }),
  togglePin: (id: string) =>
    rpc<{ success: boolean; pinned: boolean }>('work_item.toggle_pin', { id }),
  delete: (id: string, mode?: 'soft' | 'hard') =>
    rpc<WorkItemDeleteResponse>('work_item.delete', { id, mode }),
}

// Focus Session API
export const focusApi = {
  current: () => rpc<FocusCurrentResponse>('focus.current'),
  list: (params?: { from?: string; to?: string }) => rpc<FocusListResponse>('focus.list', params),
  start: (params: { title: string; work_item_id?: string; target_seconds?: number; telemetry_action_id?: string }) =>
    rpc<FocusSessionView>('focus.start', params),
  stop: (params?: { id?: string; note?: string; telemetry_action_id?: string }) =>
    rpc<FocusSessionView>('focus.stop', params),
  update: (params: FocusUpdateParams) =>
    rpc<FocusSessionView>('focus.update', params),
  split: (params: FocusSplitParams) =>
    rpc<FocusSplitResponse>('focus.split', params),
}

export const appEventApi = {
  log: (params: {
    source?: AppEventSource
    kind: AppEventKind
    work_item_id?: string
    focus_session_id?: string
    payload?: Record<string, unknown>
  }) => rpc<AppEventView>('app_event.log', params),
  list: (params?: { from?: string; to?: string }) => rpc<AppEventListResponse>('app_event.list', params),
  summary: (params?: { from?: string; to?: string }) => rpc<AppEventSummary>('app_event.summary', params),
}

export const captureApi = {
  create: (params: { text: string; focus_session_id?: string }) =>
    rpc<CaptureView>('capture.create', params),
  list: (params?: { state?: CaptureState[] }) =>
    rpc<CaptureListResponse>('capture.list', params),
  resolve: (id: string) => rpc<CaptureView>('capture.resolve', { id }),
  update: (params: { id: string; text: string }) =>
    rpc<CaptureView>('capture.update', params),
  delete: (id: string) => rpc<CaptureDeleteResponse>('capture.delete', { id }),
  convertToWorkItem: (params: { id: string; title?: string }) =>
    rpc<CaptureConvertResponse>('capture.convert_to_work_item', params),
  appendToWorkItemEvent: (params: { id: string; work_item_id?: string }) =>
    rpc<CaptureAppendEventResponse>('capture.append_to_work_item_event', params),
}

export async function logAppEvent(params: {
  source?: AppEventSource
  kind: AppEventKind
  work_item_id?: string
  focus_session_id?: string
  payload?: Record<string, unknown>
}) {
  try {
    await appEventApi.log(params)
  } catch (error) {
    console.warn('Unable to log Timeskein app event', error)
  }
}

// Desktop shell API
export const shellApi = {
  setTrayStatusTitle: async (title?: string) => {
    if (!isTauriRuntime()) return

    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_tray_status_title', { title })
  },
}

// Ref API
export const refApi = {
  add: (params: { work_item_id: string; kind: string; value: string; is_primary?: boolean }) =>
    rpc<{ ref_id: string }>('ref.add', params),
  remove: (work_item_id: string, ref_id: string) =>
    rpc<{ success: boolean }>('ref.remove', { work_item_id, ref_id }),
  open: (work_item_id: string, ref_id?: string) =>
    rpc<{ opened: boolean; ref_id: string; kind: string; value: string }>('ref.open', {
      work_item_id,
      ref_id,
    }),
  checkConflict: (kind: string, value: string) =>
    rpc<{ exists: boolean; existing_work_item?: { id: string; title: string } }>('ref.check_conflict', {
      kind,
      value,
    }),
}

// Settings API
export const settingsApi = {
  get: () => rpc<Settings>('settings.get'),
  set: (params: Record<string, unknown>) => rpc<{ success: boolean }>('settings.set', params),
  getDenylist: () => rpc<DenylistRule[]>('settings.get_denylist'),
  addToDenylist: (pattern: string, policy: 'block' | 'redact_to_domain') =>
    rpc<{ id: string }>('settings.add_to_denylist', { pattern, policy }),
  removeFromDenylist: (id: string) =>
    rpc<{ success: boolean }>('settings.remove_from_denylist', { id }),
}
