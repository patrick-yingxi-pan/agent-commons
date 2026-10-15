import { useEffect, useState } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { useRelations } from '../controller/useRelations.tsx'
import type { ArtifactDocumentImportResult } from '../lib/artifactDocumentImport.ts'
import { localPreviewDocumentImport } from '../lib/localPreviewDocumentImport.ts'
import type { LocalBrowsePreview } from '../lib/localFilePreview.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { DeferredNewArtifactDialog } from './DeferredNewArtifactDialog.tsx'

type Candidate = Extract<ArtifactDocumentImportResult, { status: 'ready' }>

/** Adoption detaches reviewed text into an ordinary account-local authoring
 * draft. It carries no source capability or bytes, and does not save anything. */
export function LocalPreviewDocumentAction({ preview, receipt, disabled, isCurrent }: {
  preview: LocalBrowsePreview | null
  receipt: number | null
  disabled: boolean
  isCurrent?: (receipt: number) => boolean
}) {
  const rel = useRelations()
  const [draft, setDraft] = useState<{ candidate: Candidate; sourceName: string; generation: number } | null>(null)
  useEffect(() => onAccountSwitch(() => setDraft(null)), [])
  const candidate = localPreviewDocumentImport(preview)
  return <>
    {preview && candidate && <div data-local-preview-document className="space-y-2">
      <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
        disabled={disabled || receipt === null || !isCurrent || candidate.status !== 'ready'}
        onClick={() => {
          if (disabled || receipt === null || !isCurrent?.(receipt) || candidate.status !== 'ready') return
          setDraft({ candidate, sourceName: preview.path, generation: accountGeneration() })
        }}>Use text in new document</button>
      <p className="text-[12px] leading-relaxed text-ink-soft">Copy the reviewed text into an editable Document draft. No file is reread or changed. Nothing is saved until you choose Create document; sharing is a separate action.</p>
      {candidate.status === 'error' && <p role="status" className="text-[12px] text-ink-soft">{candidate.message}</p>}
    </div>}
    {draft && draft.generation === accountGeneration() && <DeferredNewArtifactDialog
      projects={rel.allProjects()} initialDocument={{ ...draft.candidate, sourceName: draft.sourceName, generation: draft.generation }}
      onClose={() => setDraft(null)} onCreated={id => {
        if (draft.generation !== accountGeneration()) return
        setDraft(null)
        rel.navigate('artifacts', id)
      }} />}
  </>
}
