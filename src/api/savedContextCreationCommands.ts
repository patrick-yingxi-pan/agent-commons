/** Transport and addressed authoritative recovery for reusable Context setup. */
import type { SavedContext, SavedContextsSnapshot } from '../../contract/index.ts'
import { apiGet, apiPost } from './client.ts'
import { keys, paths } from './keys.ts'
import { mutate, peek, setData } from './cache.ts'
import { mergeSavedContextCreationSnapshot } from './savedContextRevision.ts'

export interface SavedContextCreationIntent {
  tenantId: string
  context: SavedContext
  intentId: string
}

export const savedContextCreationResourceId = (intent: SavedContextCreationIntent): string =>
  intent.context.id

const sameSetupIdentity = (left: SavedContext, right: SavedContext): boolean =>
  left.id === right.id && left.kind === right.kind

/** Publish only the addressed server row. A crossed response cannot replace
 * sibling setup or rewind a newer connection transition on this context. */
export function rememberSavedContextCreation(context: SavedContext): void {
  mutate<SavedContextsSnapshot>(keys.savedContexts, (current) =>
    current
      ? mergeSavedContextCreationSnapshot(current, context.id, context)
      : current as unknown as SavedContextsSnapshot,
  )
}

export async function applySavedContextCreation(
  intent: SavedContextCreationIntent,
  idempotencyKey: string,
): Promise<void> {
  const acknowledged = await apiPost<SavedContext>(
    paths.savedContexts,
    { context: intent.context },
    { idempotencyKey },
  )
  if (!sameSetupIdentity(acknowledged, intent.context)) {
    throw new Error('The server acknowledged a different saved context than this request.')
  }
  rememberSavedContextCreation(acknowledged)
}

/** A saved Context's tenant-scoped id is its durable natural identity. Read the
 * registry after uncertainty and settle only when that exact id and kind exist. */
export async function reconcileSavedContextCreation(
  intent: SavedContextCreationIntent,
): Promise<boolean> {
  const incoming = await apiGet<SavedContextsSnapshot>(paths.savedContexts)
  const represented = incoming.contexts.find((context) => sameSetupIdentity(context, intent.context))
  const current = peek<SavedContextsSnapshot>(keys.savedContexts)
  if (!current) setData(keys.savedContexts, incoming)
  else {
    mutate<SavedContextsSnapshot>(keys.savedContexts, (snapshot) =>
      snapshot
        ? mergeSavedContextCreationSnapshot(snapshot, intent.context.id, represented)
        : snapshot as unknown as SavedContextsSnapshot,
    )
  }
  return represented !== undefined
}
