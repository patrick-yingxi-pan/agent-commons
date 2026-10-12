import { spreadsheetSheets, type EditableArtifactBody } from '../../contract/index.ts'
import type { RevisionedMutationOutcome } from './revisionedMutationCore.ts'
import { createDraftHistory, type DraftHistory } from '../lib/draftHistory.ts'

export type ArtifactEditDraft =
  | { kind: 'document'; block: number; text: string; blockId?: string; expectedRevision?: number }
  | { kind: 'structured'; content: EditableArtifactBody; expectedRevision: number }

/** Transient per-worksheet rename input. It is not authored body content and
 * never enters Undo history or the server write payload. */
export type WorksheetRenameDraft = { baseName: string; value: string }

export interface ArtifactEditDraftState {
  draft: ArtifactEditDraft
  held: boolean
  error: string | null
  worksheetRenames?: Record<string, WorksheetRenameDraft>
}

function sameHistoryScope(before: ArtifactEditDraft, after: ArtifactEditDraft): boolean {
  if (before.kind !== 'structured' || after.kind !== 'structured' || before.expectedRevision !== after.expectedRevision) return false
  const family = (body: EditableArtifactBody) => body.type === 'workbook' ? 'sheet' : body.type
  return family(before.content) === family(after.content)
}

function validWorksheetRenames(draft: ArtifactEditDraft, renames: Record<string, WorksheetRenameDraft> | undefined) {
  if (draft.kind !== 'structured' || (draft.content.type !== 'sheet' && draft.content.type !== 'workbook') || !renames) return undefined
  const names = new Map(spreadsheetSheets(draft.content).map(sheet => [sheet.id, sheet.name]))
  const valid = Object.fromEntries(Object.entries(renames).filter(([id, rename]) =>
    names.get(id) === rename.baseName && rename.value !== rename.baseName,
  ))
  return Object.keys(valid).length ? valid : undefined
}

/** Memory-only editor state, shared by every mounted projection of an artifact.
 * The existing mutation queues still own reconciliation, Retry and write keys.
 * This store owns only draft lifetime: navigation cannot release submitted work,
 * Dismiss preserves editable input, and account disposal fences late outcomes. */
export function createArtifactEditDraftStore(
  write: (id: string, draft: ArtifactEditDraft) => Promise<RevisionedMutationOutcome>,
  canStart: (id: string) => boolean = () => true,
) {
  const drafts = new Map<string, ArtifactEditDraftState>()
  const histories = new Map<string, DraftHistory<ArtifactEditDraft>>()
  const saves = new Map<string, { result: Promise<RevisionedMutationOutcome>; settle: (outcome: RevisionedMutationOutcome) => void }>()
  const listeners = new Set<() => void>()
  const publish = () => { for (const listener of listeners) listener() }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const get = (id: string) => drafts.get(id)
  const start = (id: string, draft: ArtifactEditDraft) => {
    if (!canStart(id) || drafts.has(id)) return
    if (draft.kind === 'structured') histories.set(id, createDraftHistory<ArtifactEditDraft>())
    drafts.set(id, { draft: structuredClone(draft), held: false, error: null })
    publish()
  }
  const update = (id: string, draft: ArtifactEditDraft, group?: symbol) => {
    const current = drafts.get(id)
    if (!current || current.held) return
    if (sameHistoryScope(current.draft, draft)) histories.get(id)?.record(current.draft, draft, group)
    else {
      histories.delete(id)
      if (draft.kind === 'structured') histories.set(id, createDraftHistory<ArtifactEditDraft>())
    }
    const next: ArtifactEditDraftState = { ...current, draft: structuredClone(draft), held: false, error: null }
    const renames = validWorksheetRenames(draft, current.worksheetRenames)
    if (renames) next.worksheetRenames = structuredClone(renames)
    else delete next.worksheetRenames
    drafts.set(id, next)
    publish()
  }
  const setWorksheetRename = (id: string, sheetId: string, rename: WorksheetRenameDraft | undefined) => {
    const current = drafts.get(id)
    if (!current || current.held || current.draft.kind !== 'structured') return
    const worksheetRenames = { ...(current.worksheetRenames ?? {}), ...(rename ? { [sheetId]: structuredClone(rename) } : {}) }
    if (!rename) delete worksheetRenames[sheetId]
    const next: ArtifactEditDraftState = { ...current }
    const validRenames = validWorksheetRenames(current.draft, worksheetRenames)
    if (validRenames) next.worksheetRenames = validRenames
    else delete next.worksheetRenames
    drafts.set(id, next)
    publish()
  }
  const canSave = (id: string) => {
    const current = drafts.get(id)
    return Boolean(current && !current.held && canStart(id) && !Object.keys(current.worksheetRenames ?? {}).length)
  }
  const canTraverse = (id: string) => Boolean(drafts.has(id) && !drafts.get(id)!.held && canStart(id))
  const canUndo = (id: string) => canTraverse(id) && (histories.get(id)?.canUndo() ?? false)
  const canRedo = (id: string) => canTraverse(id) && (histories.get(id)?.canRedo() ?? false)
  const traverse = (id: string, direction: 'undo' | 'redo') => {
    const current = drafts.get(id)
    if (!current || !canTraverse(id)) return
    const restored = histories.get(id)?.[direction](current.draft)
    if (!restored) return
    const currentState = drafts.get(id)
    if (!currentState) return
    const next: ArtifactEditDraftState = { ...currentState, draft: restored, held: false, error: null }
    const renames = validWorksheetRenames(restored, currentState.worksheetRenames)
    if (renames) next.worksheetRenames = structuredClone(renames)
    else delete next.worksheetRenames
    drafts.set(id, next)
    publish()
  }
  const undo = (id: string) => traverse(id, 'undo')
  const redo = (id: string) => traverse(id, 'redo')
  const cancel = (id: string) => {
    if (drafts.get(id)?.held || !drafts.delete(id)) return
    histories.delete(id)
    publish()
  }
  const save = (id: string): Promise<RevisionedMutationOutcome> => {
    const pending = saves.get(id)
    if (pending) return pending.result
    const current = drafts.get(id)
    if (!current || !canSave(id)) return Promise.resolve('discarded')
    histories.get(id)?.closeGroup()
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
      if (outcome === 'applied') {
        drafts.delete(id)
        histories.delete(id)
      }
      else drafts.set(id, {
        ...claim,
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
    histories.clear()
    for (const pending of saves.values()) pending.settle('discarded')
    saves.clear()
    publish()
  }
  return { get, subscribe, start, update, setWorksheetRename, canSave, undo, redo, canUndo, canRedo, cancel, save, clearAll }
}
