/** Transport and exact authoritative reconciliation for system-prompt creation. */
import type { SystemPromptEntry } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { invalidate, mutate, peek, setData } from './cache.ts'
import { keys, paths } from './keys.ts'
import { mergeSystemPromptDefinition } from './systemPromptRevision.ts'
import { systemPromptCreationId } from './systemPromptCreationIdentity.ts'
import type { SystemPromptCreationIntent } from './systemPromptCreationRevision.ts'

function remember(entry: SystemPromptEntry): void {
  const cached = peek<SystemPromptEntry[]>(keys.systemPrompts)
  if (cached) {
    mutate<SystemPromptEntry[]>(keys.systemPrompts, (current) => {
      const rows = current ?? []
      const existing = rows.find((candidate) => candidate.id === entry.id)
      if (!existing) return [...rows, entry]
      const merged = mergeSystemPromptDefinition(existing, entry)
      return rows.map((candidate) => candidate.id === entry.id ? merged : candidate)
    })
  }
  // Definition acknowledgement and viewer-default selection have independent
  // ordering. Publish the exact row, then revalidate the whole projection.
  invalidate(keys.systemPrompts)
}

export async function applySystemPromptCreation(
  intent: SystemPromptCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const entry = await apiPost<SystemPromptEntry>(
    paths.systemPrompts,
    intent.request,
    { idempotencyKey },
  )
  remember(entry)
}

/** Prove only the row derived from this tenant and logical form submission. */
export async function reconcileSystemPromptCreation(
  intent: SystemPromptCreationIntent,
  idempotencyKey: string,
): Promise<boolean> {
  const expectedId = await systemPromptCreationId(intent.tenantId, idempotencyKey)
  const incoming = await apiGet<SystemPromptEntry[]>(paths.systemPrompts)
  const represented = incoming.find((entry) => entry.id === expectedId)
  const current = peek<SystemPromptEntry[]>(keys.systemPrompts)
  if (!current) setData(keys.systemPrompts, incoming)
  else if (represented) remember(represented)
  if (!represented) return false
  if (!current) invalidate(keys.systemPrompts)
  return true
}
