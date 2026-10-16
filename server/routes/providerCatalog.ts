/** Strict normalization for a caller-authored static model catalog. The store's
 * shared replacement funnel still owns id uniqueness, ordering, and stale-pick
 * cleanup for registration, declaration, and endpoint listing alike. */
import type {
  ModelInfo,
  RefreshProviderModelsRequest,
  UpdateProviderModelsRequest,
} from '../../contract/index.ts'
import { ValidationError } from '../conflict.ts'

export type ProviderCatalogUpdate = UpdateProviderModelsRequest
export type ProviderCatalogRefresh = RefreshProviderModelsRequest

const MODEL_FIELDS = [
  'id',
  'label',
  'blurb',
  'contextWindow',
  'maxOutputTokens',
  'capabilities',
  'effortLevels',
  'pricing',
  'deprecated',
] as const
const CAPABILITY_FIELDS = ['toolUse', 'vision', 'thinking', 'adaptiveThinking'] as const
const MAX_MODELS = 512
const MAX_TEXT = 512

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(message)
  return value as Record<string, unknown>
}

function unknownField(input: Record<string, unknown>, allowed: readonly string[], subject: string): void {
  const unknown = Object.keys(input).find((field) => !allowed.includes(field))
  if (unknown) throw new ValidationError(`Unknown ${subject} field '${unknown}'.`)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} must be a non-empty string.`)
  const clean = value.trim()
  if (clean.length > MAX_TEXT) throw new ValidationError(`${field} is too long.`)
  return clean
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ValidationError(`${field} must be a positive safe integer.`)
  }
  return value as number
}

/** Normalize every caller-authored model entry so unknown JSON cannot become
 * durable merely because TypeScript described a narrower request. */
export function providerCatalogModels(value: unknown): ModelInfo[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('models must be a non-empty array.')
  }
  if (value.length > MAX_MODELS) throw new ValidationError('models has too many entries.')
  return value.map((raw, index) => {
    const input = object(raw, `models[${index}] must be an object.`)
    unknownField(input, MODEL_FIELDS, `models[${index}]`)
    const model: ModelInfo = {
      id: text(input.id, `models[${index}].id`),
      label: text(input.label, `models[${index}].label`),
    }
    if (Object.hasOwn(input, 'blurb')) model.blurb = text(input.blurb, `models[${index}].blurb`)
    if (Object.hasOwn(input, 'contextWindow')) model.contextWindow = positiveInteger(input.contextWindow, `models[${index}].contextWindow`)
    if (Object.hasOwn(input, 'maxOutputTokens')) model.maxOutputTokens = positiveInteger(input.maxOutputTokens, `models[${index}].maxOutputTokens`)
    if (Object.hasOwn(input, 'deprecated')) {
      if (typeof input.deprecated !== 'boolean') throw new ValidationError(`models[${index}].deprecated must be a boolean.`)
      model.deprecated = input.deprecated
    }
    if (Object.hasOwn(input, 'effortLevels')) {
      if (!Array.isArray(input.effortLevels)) throw new ValidationError(`models[${index}].effortLevels must be an array.`)
      model.effortLevels = input.effortLevels.map((level) => text(level, `models[${index}].effortLevels`))
    }
    if (Object.hasOwn(input, 'capabilities')) {
      const capabilities = object(input.capabilities, `models[${index}].capabilities must be an object.`)
      unknownField(capabilities, CAPABILITY_FIELDS, `models[${index}].capabilities`)
      model.capabilities = {}
      for (const field of CAPABILITY_FIELDS) {
        if (!Object.hasOwn(capabilities, field)) continue
        if (typeof capabilities[field] !== 'boolean') throw new ValidationError(`models[${index}].capabilities.${field} must be a boolean.`)
        model.capabilities[field] = capabilities[field]
      }
      if (model.capabilities.thinking === false && model.capabilities.adaptiveThinking === true) {
        throw new ValidationError(`models[${index}].capabilities cannot support adaptive thinking while disabling thinking.`)
      }
    }
    if (Object.hasOwn(input, 'pricing')) {
      const pricing = object(input.pricing, `models[${index}].pricing must be an object.`)
      unknownField(pricing, ['inputPerMTok', 'outputPerMTok'], `models[${index}].pricing`)
      for (const field of ['inputPerMTok', 'outputPerMTok'] as const) {
        if (typeof pricing[field] !== 'number' || !Number.isFinite(pricing[field]) || (pricing[field] as number) < 0) {
          throw new ValidationError(`models[${index}].pricing.${field} must be a non-negative finite number.`)
        }
      }
      model.pricing = {
        inputPerMTok: pricing.inputPerMTok as number,
        outputPerMTok: pricing.outputPerMTok as number,
      }
    }
    return model
  })
}

export function providerCatalogUpdate(value: unknown): ProviderCatalogUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('A provider model catalog is required.')
  }
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).find((field) => field !== 'models' && field !== 'expectedRevision')
  if (unknown) throw new ValidationError(`Unknown provider catalog field '${unknown}'.`)
  if (!Object.hasOwn(input, 'models')) throw new ValidationError('models is required.')

  let expectedRevision: number | undefined
  if (Object.hasOwn(input, 'expectedRevision')) {
    if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
      throw new ValidationError('expectedRevision must be a non-negative safe integer.')
    }
    expectedRevision = input.expectedRevision as number
  }

  return {
    models: providerCatalogModels(input.models),
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
  }
}

/** Normalize the interactive endpoint refresh precondition. Undefined and an
 * empty object retain the legacy behavior where the route snapshots the latest
 * connection revision immediately before its outbound list request. */
export function providerCatalogRefresh(value: unknown): ProviderCatalogRefresh {
  if (value === undefined) return {}
  const input = object(value, 'A provider model-catalog refresh must be an object.')
  unknownField(input, ['expectedRevision'], 'provider catalog refresh')
  if (!Object.hasOwn(input, 'expectedRevision')) return {}
  if (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
    throw new ValidationError('expectedRevision must be a non-negative safe integer.')
  }
  return { expectedRevision: input.expectedRevision as number }
}
