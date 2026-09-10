/** One acknowledgement-owned personal setting, available before any picker opens. */
import { DEFAULT_MODEL_PREFERENCES, type ModelPreferences, type ViewerModelPreferences } from '../../contract/modelPreferences.ts'
import { accountGeneration as currentAccountGeneration, onAccountSwitch } from '../api/account.ts'
import { useViewerModelPreferences } from '../api/hooks.ts'
import { cachedModelPreferences } from '../api/modelPreferences.ts'
import { AccountSwitchedError, ApiRequestError } from '../api/client.ts'
import {
  cachedModelPreferencesForMutation,
  modelPreferenceMutationResourceId,
  patchModelPreferences,
  reconcileModelPreferences,
  type ModelPreferenceMutationIntent,
} from '../api/modelPreferenceCommands.ts'
import { applyModelPreferencePatch } from '../lib/modelPrefs.ts'
import { createMutationStatusStore } from './mutationStatusStore.ts'
import {
  createRevisionedMutationController,
  type RevisionedMutationFailure,
  type RevisionedMutationOutcome,
} from './revisionedMutationCore.ts'

interface HeldPreference {
  intent: ModelPreferenceMutationIntent
  preferences: ModelPreferences
  result: Promise<RevisionedMutationOutcome>
}

const status = createMutationStatusStore()
let held: HeldPreference | null = null
function describeFailure(error: unknown): RevisionedMutationFailure {
  if (error instanceof AccountSwitchedError) {
    return { message: 'This model preference belongs to a different account or workspace. Dismiss it and reload to continue.', retryable: false }
  }
  if (error instanceof ApiRequestError && error.status === 409) {
    return { message: 'Your model preference changed elsewhere. Retry to apply your choice to the latest settings, or dismiss to keep them.', retryable: true }
  }
  const retryable = !(error instanceof ApiRequestError) || ![400, 401, 403, 404].includes(error.status)
  return { message: 'Couldn’t save your model preference. Your choice is still here; retry or dismiss to keep the saved setting.', retryable }
}

// The core setting is eager: browsers may cache a rejected dynamic-import URL
// even when its Promise is reset. Defer picker display, not an accepted edit.
const controller = createRevisionedMutationController<ViewerModelPreferences, ModelPreferenceMutationIntent['patch']>({
  snapshot: cachedModelPreferencesForMutation,
  reconcile: reconcileModelPreferences,
  revision: (record) => record.revision,
  mutate: patchModelPreferences,
  mintIdempotencyKey: () => crypto.randomUUID(),
  setStatus: status.publish,
  describeFailure,
})

onAccountSwitch(() => {
  held = null
  controller.clearAll()
})

const samePatch = (left: Readonly<Partial<ModelPreferences>>, right: Partial<ModelPreferences>): boolean => {
  const fields = Object.keys(right) as (keyof ModelPreferences)[]
  return fields.length === Object.keys(left).length &&
    fields.every((field) => Object.hasOwn(left, field) && left[field] === right[field])
}

export function updateModelPreferences(patch: Partial<ModelPreferences>): Promise<RevisionedMutationOutcome> {
  if (held) return samePatch(held.intent.patch, patch) ? held.result : Promise.resolve('discarded')
  const record = cachedModelPreferences()
  if (!record) return Promise.resolve('discarded')
  const frozenPatch = Object.freeze({ ...patch })
  const intent = Object.freeze({
    tenantId: record.tenantId,
    userId: record.userId,
    accountGeneration: currentAccountGeneration(),
    patch: frozenPatch,
  })
  const result = controller.enqueue(modelPreferenceMutationResourceId(intent), frozenPatch, record.revision)
  const entry: HeldPreference = {
    intent,
    preferences: applyModelPreferencePatch(record.preferences, patch),
    result,
  }
  held = entry
  status.refresh()
  void result.then(() => {
    if (held !== entry) return
    held = null
    status.refresh()
  })
  return result
}

export function useModelPreferences() {
  const query = useViewerModelPreferences()
  const mutation = status.useStatus()
  return {
    preferences: held?.preferences ?? query.data?.preferences ?? DEFAULT_MODEL_PREFERENCES,
    held: held !== null || mutation.busy,
  }
}

export const useModelPreferenceStatus = status.useStatus
export const retryModelPreference = controller.retry
export const discardModelPreference = controller.discard
