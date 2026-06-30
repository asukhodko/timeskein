import {
  API_VERSION,
  type ApiRequest,
  type ApiResponse,
  type InventoryListResponse,
  type WorkItemView,
  type AgentStatus,
  type Settings,
  type DenylistRule,
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
async function rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const request: ApiRequest = {
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
  list: (params?: { filter?: { search?: string; state?: string[] } }) =>
    rpc<InventoryListResponse>('inventory.list', params),
  get: (id: string) => rpc<WorkItemView>('inventory.get', { id }),
}

// Work Item API
export const workItemApi = {
  create: (params: { title: string; type?: string; state?: string; note?: string }) =>
    rpc<{ id: string }>('work_item.create', params),
  touch: (id: string) => rpc<{ success: boolean }>('work_item.touch', { id }),
  setState: (id: string, state: string) =>
    rpc<{ success: boolean }>('work_item.set_state', { id, state }),
  setNote: (id: string, note: string) =>
    rpc<{ success: boolean }>('work_item.set_note', { id, note }),
  togglePin: (id: string) =>
    rpc<{ success: boolean; pinned: boolean }>('work_item.toggle_pin', { id }),
  delete: (id: string, mode?: 'soft' | 'hard') =>
    rpc<{ success: boolean }>('work_item.delete', { id, mode }),
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
