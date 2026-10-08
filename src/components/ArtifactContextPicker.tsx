import { useState } from 'react'
import { Check, FileText, RotateCw } from 'lucide-react'
import { useArtifacts } from '../api/hooks.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { artifactContextId } from '../../contract/artifactSnapshot.ts'
import type { AddedContext, Attachment } from '../types'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

/** A source-read projection is the only candidate registry. Confirmation is a
 *  disclosure step: real sessions save through onAdd, while drafts keep only a
 *  target that the first send will capture after rechecking source access. */
export function ArtifactContextPicker({
  onAdd,
  onClose,
  addedIds,
  isDraft,
}: {
  onAdd: (ctx: AddedContext) => void
  onClose: () => void
  addedIds: readonly string[]
  isDraft: boolean
}) {
  const query = useArtifacts()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const artifacts = query.status === 'success' ? query.data ?? [] : []
  const selected = artifacts.find((artifact) => artifact.id === selectedId)

  if (query.status === 'loading' || query.status === 'idle') {
    return <InlineOperationStatus tone="status" message="Loading readable artifacts…" action={{ label: 'Done', onClick: onClose }} />
  }
  if (query.status === 'error') {
    return <InlineOperationStatus tone="alert" message="Couldn’t load readable artifacts. Nothing was added." action={{ label: 'Retry', onClick: () => invalidate(keys.artifacts) }} secondaryAction={{ label: 'Done', onClick: onClose }} />
  }

  if (selected) {
    const title = selected.name
    return (
      <div className="space-y-2 px-1 pb-1" data-artifact-context-confirm>
        <p className="break-words text-[13px] font-medium text-ink">{title}</p>
        <div className="rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-[12px] leading-relaxed text-ink-soft">
          <p>Attach a saved copy? Everyone with access to the destination conversation can read it. Revoking access to the source later won’t erase this copy or earlier replies. It won’t update live. The complete saved text and data must fit within 64 KB. Unsupported or oversized bodies are not copied.</p>
          {isDraft && <p className="mt-1.5">This draft will capture the copy on its first send, after checking that you can still read the source. No copy is saved yet.</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[12px]`} onClick={() => setSelectedId(null)}>Cancel</button>
          <button
            type="button"
            className={`${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px]`}
            onClick={() => {
              // The selected row came from the caller's current readable list.
              // Mint intent only after affirmative acknowledgement; the server
              // rechecks readability when a draft reaches its first send.
              const attachment: Attachment = {
                id: artifactContextId(selected.id),
                kind: 'artifact',
                label: title,
                artifactCaptureId: crypto.randomUUID(),
              }
              onAdd({ kind: 'artifact', attachment })
              setSelectedId(null)
            }}
          >
            {isDraft ? 'Add to draft' : 'Attach saved copy'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 px-1 pb-1" data-artifact-context-picker>
      {artifacts.length === 0 ? (
        <p className="px-1 py-3 text-[12px] text-ink-soft">No readable artifacts are available to attach.</p>
      ) : (
        <div className="max-h-64 space-y-0.5 overflow-y-auto" aria-label="Readable artifacts">
          {artifacts.map((artifact) => {
            const id = artifactContextId(artifact.id)
            const added = addedIds.includes(id)
            const title = artifact.name
            return (
              <button
                key={artifact.id}
                type="button"
                disabled={added}
                onClick={() => setSelectedId(artifact.id)}
                className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-panel-2 disabled:cursor-default disabled:opacity-65"
                aria-label={`${title}${added ? ', Added' : ''}`}
              >
                <FileText size={15} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={title}>{title}</span>
                {added ? <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-faint"><Check size={13} />Added</span> : <span className="shrink-0 text-[11px] text-ink-faint">{artifact.kind}</span>}
              </button>
            )
          })}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-line px-1 pt-2">
        <button type="button" onClick={() => invalidate(keys.artifacts)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-faint transition hover:bg-panel-2 hover:text-ink" aria-label="Refresh artifacts">
          <RotateCw size={12} />Refresh
        </button>
        <button type="button" onClick={onClose} className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`}>Done</button>
      </div>
    </div>
  )
}
