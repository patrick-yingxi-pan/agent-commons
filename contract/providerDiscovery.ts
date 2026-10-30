/** Explicit pre-save listing input. No model, raw credential or saved identity. */
import type { EndpointProtocol, ModelInfo } from './providers.ts'

export interface DiscoverProviderModelsRequest {
  protocol: EndpointProtocol
  baseURL: string
  apiKeyEnv?: string
}

/** Transient endpoint-owned choices, never readiness or a persisted catalog. */
export interface DiscoverProviderModelsResult {
  models: ModelInfo[]
}
