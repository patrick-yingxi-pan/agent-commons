/** Validation and merge semantics for the write-only provider connection PATCH.
 * Kept outside the route monolith so absence/clear behavior has one testable
 * owner: absent preserves, `null` clears, and only the three declared fields
 * may cross into the durable server config. */
import type { UpdateProviderConnectionRequest } from '../../contract/index.ts'
import { ValidationError } from '../conflict.ts'
import { validApiKeyEnv, type ProviderConfig } from '../data/providers.ts'

const FIELD_LIMITS = {
  baseURL: 2_048,
  apiKeyEnv: 128,
  model: 256,
} as const
const FIELDS = Object.keys(FIELD_LIMITS) as Array<keyof UpdateProviderConnectionRequest>

function cleanString(field: keyof typeof FIELD_LIMITS, value: unknown): string | undefined {
  if (value === null) return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} must be a non-empty string or null.`)
  }
  const clean = value.trim()
  if (clean.length > FIELD_LIMITS[field]) {
    throw new ValidationError(`${field} is too long.`)
  }
  return clean
}

function assertEndpointUrl(value: string | undefined): void {
  if (!value) return
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ValidationError('baseURL must be a valid HTTP or HTTPS URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('baseURL must be a valid HTTP or HTTPS URL.')
  }
}

export interface ProviderConnectionUpdate {
  config: ProviderConfig
  endpointChanged: boolean
}

export function providerConnectionUpdate(
  current: ProviderConfig,
  input: UpdateProviderConnectionRequest,
): ProviderConnectionUpdate {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('A provider connection patch is required.')
  }
  const supplied = FIELDS.filter((field) => Object.hasOwn(input, field))
  const unknown = Object.keys(input).filter((field) => !FIELDS.includes(field as keyof UpdateProviderConnectionRequest))
  if (unknown.length) throw new ValidationError(`Unknown provider connection field '${unknown[0]}'.`)
  if (!supplied.length) throw new ValidationError('Name at least one provider connection field to update.')

  const next: ProviderConfig = {
    ...(current.baseURL ? { baseURL: current.baseURL } : {}),
    ...(current.apiKeyEnv ? { apiKeyEnv: current.apiKeyEnv } : {}),
    ...(current.model ? { model: current.model } : {}),
    ...(current.capabilities ? { capabilities: { ...current.capabilities } } : {}),
  }
  for (const field of supplied) {
    const value = cleanString(field, input[field])
    if (value === undefined) delete next[field]
    else next[field] = value
  }
  assertEndpointUrl(next.baseURL)
  if (!validApiKeyEnv(next.apiKeyEnv)) {
    throw new ValidationError(`apiKeyEnv must name a 'PROVIDER_*' environment variable.`)
  }
  return { config: next, endpointChanged: next.baseURL !== current.baseURL }
}
