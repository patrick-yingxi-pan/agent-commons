/** Personal model-composer intent. These values are deliberately references,
 * not authority: a later send still validates the selected provider/model and
 * effort against the live registry. */
export interface ModelPreferences {
  providerId?: string
  modelId?: string
  effort?: string
  ultracode: boolean
  fast: boolean
}

export const MODEL_PREFERENCE_STRING_MAX = 256

export const DEFAULT_MODEL_PREFERENCES: Readonly<ModelPreferences> = Object.freeze({
  effort: 'High',
  ultracode: false,
  fast: false,
})

export interface ViewerModelPreferences {
  tenantId: string
  userId: string
  revision: number
  preferences: ModelPreferences
}

export interface UpdateModelPreferencesRequest {
  expectedTenantId: string
  expectedUserId: string
  expectedRevision: number
  preferences: ModelPreferences
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function preferenceString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MODEL_PREFERENCE_STRING_MAX && value.trim() === value
}

/** Strict detached parser shared by HTTP and persistence. Optional references
 * retain exact stale values; no registry lookup or default selection occurs. */
export function parseModelPreferences(value: unknown): ModelPreferences | undefined {
  if (!record(value)) return undefined
  const allowed = ['providerId', 'modelId', 'effort', 'ultracode', 'fast']
  if (Object.keys(value).some((key) => !allowed.includes(key)) ||
      !Object.hasOwn(value, 'ultracode') || !Object.hasOwn(value, 'fast') ||
      typeof value.ultracode !== 'boolean' || typeof value.fast !== 'boolean') return undefined
  for (const key of ['providerId', 'modelId', 'effort'] as const) {
    if (Object.hasOwn(value, key) && !preferenceString(value[key])) return undefined
  }
  return {
    ...(Object.hasOwn(value, 'providerId') ? { providerId: value.providerId as string } : {}),
    ...(Object.hasOwn(value, 'modelId') ? { modelId: value.modelId as string } : {}),
    ...(Object.hasOwn(value, 'effort') ? { effort: value.effort as string } : {}),
    ultracode: value.ultracode,
    fast: value.fast,
  }
}

export function parseUpdateModelPreferencesRequest(value: unknown): UpdateModelPreferencesRequest | undefined {
  if (!record(value) || Object.keys(value).length !== 4 ||
      !['expectedTenantId', 'expectedUserId', 'expectedRevision', 'preferences'].every((key) => Object.hasOwn(value, key)) ||
      !preferenceString(value.expectedTenantId) || !preferenceString(value.expectedUserId) ||
      !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) return undefined
  const preferences = parseModelPreferences(value.preferences)
  return preferences ? {
    expectedTenantId: value.expectedTenantId,
    expectedUserId: value.expectedUserId,
    expectedRevision: value.expectedRevision as number,
    preferences,
  } : undefined
}
