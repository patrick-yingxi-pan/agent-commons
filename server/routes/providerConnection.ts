/** Validation and merge semantics for the write-only provider connection PATCH.
 * Kept outside the route monolith so absence/clear behavior has one testable
 * owner: absent preserves, `null` clears, and only declared fields
 * may cross into the durable server config. */
import { isEndpointProtocol, type ProviderConnectionPatch } from '../../contract/index.ts'
import { isReplyOutputTokens } from '../../contract/providerReplyLimits.ts'
import { ValidationError } from '../conflict.ts'
import { validApiKeyEnv, type ProviderConfig } from '../data/providers.ts'

const FIELD_LIMITS = {
  protocol: 64,
  baseURL: 2_048,
  apiKeyEnv: 128,
  model: 256,
} as const
const FIELDS = [...Object.keys(FIELD_LIMITS), 'replyOutputTokens'] as Array<keyof ProviderConnectionPatch>

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
  /** Endpoint URL or protocol changes move the provider to another model namespace. */
  endpointChanged: boolean
}

/** Validate the protocol-specific fields without probing or performing I/O. */
export function validateProviderProtocolConfig(config: ProviderConfig): void {
  if (config.replyOutputTokens !== undefined && !isReplyOutputTokens(config.replyOutputTokens)) {
    throw new ValidationError('replyOutputTokens must be an integer from 128 to 65536.')
  }
  if (config.protocol !== undefined && !isEndpointProtocol(config.protocol)) {
    throw new ValidationError(`protocol must be 'anthropic-messages' or 'openai-responses'.`)
  }
  if (config.protocol === 'openai-responses' && (!config.baseURL?.trim() || !config.model?.trim())) {
    throw new ValidationError(`The OpenAI Responses protocol requires an explicit baseURL and model.`)
  }
}

export function providerConnectionUpdate(
  current: ProviderConfig,
  input: ProviderConnectionPatch,
): ProviderConnectionUpdate {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('A provider connection patch is required.')
  }
  const supplied = FIELDS.filter((field) => Object.hasOwn(input, field))
  const unknown = Object.keys(input).filter((field) => !FIELDS.includes(field as keyof ProviderConnectionPatch))
  if (unknown.length) throw new ValidationError(`Unknown provider connection field '${unknown[0]}'.`)
  if (!supplied.length) throw new ValidationError('Name at least one provider connection field to update.')

  const next: ProviderConfig = {
    ...(current.protocol ? { protocol: current.protocol } : {}),
    ...(current.baseURL ? { baseURL: current.baseURL } : {}),
    ...(current.apiKeyEnv ? { apiKeyEnv: current.apiKeyEnv } : {}),
    ...(current.model ? { model: current.model } : {}),
    ...(current.replyOutputTokens !== undefined ? { replyOutputTokens: current.replyOutputTokens } : {}),
    ...(current.capabilities ? { capabilities: { ...current.capabilities } } : {}),
  }
  for (const field of supplied) {
    if (field === 'replyOutputTokens') {
      if (input[field] === null) delete next.replyOutputTokens
      else if (!isReplyOutputTokens(input[field])) throw new ValidationError('replyOutputTokens must be an integer from 128 to 65536.')
      else next.replyOutputTokens = input[field]
      continue
    }
    const value = cleanString(field, input[field])
    if (field === 'protocol') {
      if (value === undefined) delete next.protocol
      else if (!isEndpointProtocol(value)) throw new ValidationError(`protocol must be 'anthropic-messages' or 'openai-responses'.`)
      else next.protocol = value
    } else if (value === undefined) delete next[field]
    else next[field] = value
  }
  assertEndpointUrl(next.baseURL)
  validateProviderProtocolConfig(next)
  if (!validApiKeyEnv(next.apiKeyEnv)) {
    throw new ValidationError(`apiKeyEnv must name a 'PROVIDER_*' environment variable.`)
  }
  const effectiveProtocol = (protocol: ProviderConfig['protocol']) => protocol ?? 'anthropic-messages'
  return {
    config: next,
    endpointChanged:
      next.baseURL !== current.baseURL || effectiveProtocol(next.protocol) !== effectiveProtocol(current.protocol),
  }
}
