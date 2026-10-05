import { useRef } from 'react'
import type { useArtifactPresentationImport } from '../lib/useArtifactPresentationImport.ts'
import { ArtifactImportReview } from './ArtifactImportReview.tsx'
import { StructuredArtifactView } from './DeferredStructuredArtifactView.tsx'

export function ArtifactPresentationImport({ intake, hasContent, disabled, onUse }: {
  intake: ReturnType<typeof useArtifactPresentationImport>
  hasContent: boolean
  disabled: boolean
  onUse: () => void
}) {
  const previewRef = useRef<HTMLDivElement>(null)
  const { state } = intake
  return <ArtifactImportReview intake={intake} label="Import presentation slides"
    description="Start from one PowerPoint (.pptx) file. Review a text outline with one entry per visible slide, then edit its titles and bullets. Original layouts and media are not preserved. Nothing is saved until you create the slides."
    summary={state.status === 'ready' ? `Review imported slides. ${state.body.slides.length} slides; your draft is unchanged.` : ''}
    adoptionCopy={hasContent ? 'Using these slides replaces all current slides.' : 'Using these slides fills the presentation content.'}
    useLabel={hasContent ? 'Replace slides with imported slides' : 'Use imported slides'}
    disabled={disabled} onUse={onUse} previewRef={previewRef}>
    {state.status === 'ready' && <>
      <p className="text-[11px] leading-relaxed text-ink-soft">{state.disclosure}</p>
      <div ref={previewRef} role="region" aria-label="Imported slides" tabIndex={0} className="max-h-64 min-w-0 overflow-y-auto rounded-lg">
        <StructuredArtifactView body={state.body} size="compact" />
      </div>
    </>}
  </ArtifactImportReview>
}
