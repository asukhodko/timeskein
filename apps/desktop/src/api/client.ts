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
  type DayEventAddParams,
  type DayEventDeleteResponse,
  type DayEventListParams,
  type DayEventListResponse,
  type DayEventUpdateParams,
  type DayEventView,
  type WorkItemCreateParams,
  type WorkItemCreateResponse,
  type WorkItemDeleteEventResponse,
  type WorkItemDeleteResponse,
  type WorkItemSemanticsView,
  type WorkItemSetSemanticsParams,
  type TaxonomyListResponse,
  type TrackCreateParams,
  type TrackUpdateParams,
  type TrackView,
  type LabelCreateParams,
  type LabelUpdateParams,
  type LabelView,
  type AgentStatus,
  type Settings,
  type DenylistRule,
  type FocusCurrentResponse,
  type FocusListResponse,
  type FocusSessionView,
  type FocusCreateStoppedParams,
  type FocusSplitParams,
  type FocusSplitResponse,
  type FocusUpdateParams,
  type ActivityZone,
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
  type CausalRecordListParams,
  type CausalRecordListResponse,
  type OperationalRealityFollowUpDecisionParams,
  type OperationalRealityListParams,
  type OperationalRealityMutationResponse,
  type OperationalRealitySetNextActionParams,
  type OperationalRealitySetStateParams,
  type OperationalRealityView,
  type OperationalWorkspaceGetParams,
  type OperationalWorkspaceView,
  type DayContractListParams,
  type DayContractListResponse,
  type DayContractMutationResponse,
  type DayContractReviseParams,
  type ContextPackBuildParams,
  type ContextPackBuildResponse,
  type WorkItemAliasView,
  type WorkItemStageView,
  type WorkMemoryCreateParams,
  type WorkMemoryEntryView,
  type WorkMemoryListParams,
  type WorkMemoryListResponse,
  type WorkMemoryUpdateParams,
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
  setSemantics: (params: WorkItemSetSemanticsParams) =>
    rpc<WorkItemSemanticsView>('work_item.set_semantics', params),
  merge: (sourceId: string, canonicalId: string, reason?: string) =>
    rpc<WorkItemAliasView>('work_item.merge', {
      source_id: sourceId,
      canonical_id: canonicalId,
      reason,
    }),
  resolve: (id: string) =>
    rpc<{ requested_id: string; canonical_id: string; aliases: WorkItemAliasView[] }>(
      'work_item.resolve',
      { id }
    ),
}

export const workingMemoryApi = {
  create: (params: WorkMemoryCreateParams) =>
    rpc<WorkMemoryEntryView>('working_memory.create', params),
  list: (params?: WorkMemoryListParams) =>
    rpc<WorkMemoryListResponse>('working_memory.list', params),
  update: (params: WorkMemoryUpdateParams) =>
    rpc<WorkMemoryEntryView>('working_memory.update', params),
  delete: (id: string, reason?: string) =>
    rpc<WorkMemoryEntryView>('working_memory.delete', { id, reason }),
  createStage: (params: { work_item_id: string; title: string; activate?: boolean }) =>
    rpc<WorkItemStageView>('work_item_stage.create', params),
  updateStage: (params: {
    id: string
    title?: string
    state?: WorkItemStageView['state']
    position?: number
  }) => rpc<WorkItemStageView>('work_item_stage.update', params),
  deleteStage: (id: string) =>
    rpc<WorkItemStageView>('work_item_stage.delete', { id }),
  listStages: (workItemId: string, includeArchived = false) =>
    rpc<{ stages: WorkItemStageView[] }>('work_item_stage.list', {
      work_item_id: workItemId,
      include_archived: includeArchived,
    }),
}

export const contextPackApi = {
  build: (params: ContextPackBuildParams) =>
    rpc<ContextPackBuildResponse>('context_pack.build', params),
}

export const taxonomyApi = {
  list: (includeArchived = false) =>
    rpc<TaxonomyListResponse>('taxonomy.list', { include_archived: includeArchived }),
  createTrack: (params: TrackCreateParams) =>
    rpc<TrackView>('track.create', params),
  updateTrack: (params: TrackUpdateParams) =>
    rpc<TrackView>('track.update', params),
  archiveTrack: (id: string, archived = true) =>
    rpc<TrackView>('track.archive', { id, archived }),
  createLabel: (params: LabelCreateParams) =>
    rpc<LabelView>('label.create', params),
  updateLabel: (params: LabelUpdateParams) =>
    rpc<LabelView>('label.update', params),
  archiveLabel: (id: string, archived = true) =>
    rpc<LabelView>('label.archive', { id, archived }),
}

export const operationalRealityApi = {
  list: (params?: OperationalRealityListParams) =>
    rpc<OperationalRealityView>('operational_reality.list', params),
  records: (params?: CausalRecordListParams) =>
    rpc<CausalRecordListResponse>('causal_record.list', params),
  setState: (params: OperationalRealitySetStateParams) =>
    rpc<OperationalRealityMutationResponse>('operational_reality.set_state', params),
  setNextAction: (params: OperationalRealitySetNextActionParams) =>
    rpc<OperationalRealityMutationResponse>('operational_reality.set_next_action', params),
  followUpDecision: (params: OperationalRealityFollowUpDecisionParams) =>
    rpc<{ followup_id: string; reality: OperationalRealityView }>(
      'operational_reality.follow_up_decision',
      params
    ),
}

export const operationalWorkspaceApi = {
  get: (params?: OperationalWorkspaceGetParams) =>
    rpc<OperationalWorkspaceView>('operational_workspace.get', params),
  reviseContract: (params: DayContractReviseParams) =>
    rpc<DayContractMutationResponse>('day_contract.revise', params),
  listContracts: (params: DayContractListParams) =>
    rpc<DayContractListResponse>('day_contract.list', params),
}

export const dayEventApi = {
  add: (params: DayEventAddParams) =>
    rpc<DayEventView>('day_event.add', params),
  list: (params?: DayEventListParams) =>
    rpc<DayEventListResponse>('day_event.list', params),
  update: (params: DayEventUpdateParams) =>
    rpc<DayEventView>('day_event.update', params),
  delete: (id: string) =>
    rpc<DayEventDeleteResponse>('day_event.delete', { id }),
}

// Focus Session API
export const focusApi = {
  current: () => rpc<FocusCurrentResponse>('focus.current'),
  list: (params?: { from?: string; to?: string }) => rpc<FocusListResponse>('focus.list', params),
  start: (params: { title: string; work_item_id?: string; activity_zone?: ActivityZone; target_seconds?: number; telemetry_action_id?: string; stage_id?: string }) =>
    rpc<FocusSessionView>('focus.start', params),
  stop: (params?: { id?: string; note?: string; telemetry_action_id?: string; result?: string; state_change?: string; next_action?: string }) =>
    rpc<FocusSessionView>('focus.stop', params),
  update: (params: FocusUpdateParams) =>
    rpc<FocusSessionView>('focus.update', params),
  createStopped: (params: FocusCreateStoppedParams) =>
    rpc<FocusSessionView>('focus.create_stopped', params),
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
