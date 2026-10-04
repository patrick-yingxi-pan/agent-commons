import type { StructuredArtifactBody } from '../../contract/index.ts'
import type { RevisionedMutationOutcome } from './revisionedMutationCore.ts'

export type ArtifactEditDraft =
  | { kind: 'document'; block: number; text: string }
  | { kind: 'structured'; content: StructuredArtifactBody; expectedRevision: number }

export interface ArtifactEditDraftState {
  draft: ArtifactEditDraft
  held: boolean
  error: string | null
}

/** Memory-only editor state, shared by every mounted projection of an artifact.
 * The existing mutation queues still own reconciliation, Retry and write keys.
 * This store owns only draft lifetime: navigation cannot release submitted work,
 * Dismiss preserves editable input, and account disposal fences late outcomes. */
export function createArtifactEditDraftStore(
  write: (id: string, draft: ArtifactEditDraft) => Promise<RevisionedMutationOutcome>,
) {
  const drafts = new Map<string, ArtifactEditDraftState>()
  const saves = new Map<string, { result: Promise<RevisionedMutationOutcome>; settle: (outcome: RevisionedMutationOutcome) => void }>()
  const listeners = new Set<() => void>()
  const publish = () => { for (const listener of listeners) listener() }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const get = (id: string) => drafts.get(id)
  const start = (id: string, draft: ArtifactEditDraft) => {
    if (drafts.has(id)) return
    drafts.set(id, { draft: structuredClone(draft), held: false, error: null })
    publish()
  }
  const update = (id: string, draft: ArtifactEditDraft) => {
    const current = drafts.get(id)
    if (!current || current.held) return
    drafts.set(id, { draft: structuredClone(draft), held: false, error: null })
    publish()
  }
  const cancel = (id: string) => {
    if (drafts.get(id)?.held || !drafts.delete(id)) return
    publish()
  }
  const save = (id: string): Promise<RevisionedMutationOutcome> => {
    const pending = saves.get(id)
    if (pending) return pending.result
    const current = drafts.get(id)
    if (!current) return Promise.resolve('discarded')
    const claim = { ...current, held: true, error: null }
    let settle!: (outcome: RevisionedMutationOutcome) => void
    const result = new Promise<RevisionedMutationOutcome>((resolve) => { settle = resolve })
    saves.set(id, { result, settle })
    drafts.set(id, claim)
    publish()
    // Publish may synchronously dispose the account. Never begin obsolete work.
    if (drafts.get(id) !== claim) return result
    const finish = (outcome: RevisionedMutationOutcome, error?: unknown) => {
      if (drafts.get(id) !== claim) return
      saves.delete(id)
      if (outcome === 'applied') drafts.delete(id)
      else drafts.set(id, {
        draft: claim.draft,
        held: false,
        error: error instanceof Error ? error.message : 'Edit dismissed. Your draft is still here; cancel to review the latest saved content.',
      })
      settle(outcome)
      publish()
    }
    try {
      void write(id, structuredClone(claim.draft)).then(
        (outcome) => finish(outcome),
        (error: unknown) => finish('discarded', error),
      )
    } catch (error) {
      finish('discarded', error)
    }
    return result
  }
  const clearAll = () => {
    drafts.clear()
    for (const pending of saves.values()) pending.settle('discarded')
    saves.clear()
    publish()
  }
  return { get, subscribe, start, update, cancel, save, clearAll }
}
