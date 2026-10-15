import { useEffect, useMemo, useState } from 'react'
import { accountGeneration, onAccountSwitch } from '../api/account.ts'
import { useRelations } from '../controller/useRelations.tsx'
import type { ArtifactDocumentImportResult } from '../lib/artifactDocumentImport.ts'
import { localPreviewDocumentImport } from '../lib/localPreviewDocumentImport.ts'
import { localPreviewStructuredImport, type LocalStructuredImport } from '../lib/localPreviewStructuredImport.ts'
import type { LocalBrowsePreview } from '../lib/localFilePreview.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { DeferredNewArtifactDialog } from './DeferredNewArtifactDialog.tsx'

type Candidate = Extract<ArtifactDocumentImportResult, { status: 'ready' }>
type Draft = { sourceName: string; generation: number } &
  ({ candidate: Candidate; structured?: never } | { structured: LocalStructuredImport; candidate?: never })

/** Adoption detaches reviewed content into an ordinary account-local authoring
 * draft. It carries no source capability or bytes, and does not save anything. */
export function LocalPreviewArtifactAction({ preview, receipt, disabled, isCurrent }: {
  preview: LocalBrowsePreview | null
  receipt: number | null
  disabled: boolean
  isCurrent?: (receipt: number) => boolean
}) {
  const rel = useRelations()
  const [draft, setDraft] = useState<Draft | null>(null)
  useEffect(() => onAccountSwitch(() => setDraft(null)), [])
  const candidate = useMemo(() => localPreviewDocumentImport(preview), [preview])
  const structured = useMemo(() => localPreviewStructuredImport(preview), [preview])
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
    {preview && structured && <div data-local-preview-structured className="space-y-2">
      <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
        disabled={disabled || receipt === null || !isCurrent}
        onClick={() => {
          if (disabled || receipt === null || !isCurrent?.(receipt)) return
          setDraft({ structured, sourceName: preview.path, generation: accountGeneration() })
        }}>Review as new {structured.kind === 'sheet' ? 'sheet' : 'slides'}</button>
      <p className="text-[12px] leading-relaxed text-ink-soft">Review the captured {structured.kind === 'sheet' ? 'worksheet values' : 'slide outline'}, then choose Use to start an editable draft. No file is reread or changed. Create saves your draft; sharing is separate.</p>
    </div>}
    {draft && draft.generation === accountGeneration() && <DeferredNewArtifactDialog
      projects={rel.allProjects()}
      initialDocument={draft.candidate ? { ...draft.candidate, sourceName: draft.sourceName, generation: draft.generation } : undefined}
      initialStructured={draft.structured ? { ...draft.structured, sourceName: draft.sourceName, generation: draft.generation } : undefined}
      onClose={() => setDraft(null)} onCreated={id => {
        if (draft.generation !== accountGeneration()) return
        setDraft(null)
        rel.navigate('artifacts', id)
      }} />}
  </>
}
