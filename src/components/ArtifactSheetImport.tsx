import { useRef } from 'react'
import type { useArtifactSheetImport } from '../lib/useArtifactSheetImport.ts'
import { ArtifactImportReview } from './ArtifactImportReview.tsx'
import { CheckboxRow } from './Checkbox.tsx'
import { StructuredArtifactView } from './StructuredArtifactView.tsx'

export function ArtifactSheetImport({ intake, hasContent, disabled, onUse }: {
  intake: ReturnType<typeof useArtifactSheetImport>
  hasContent: boolean
  disabled: boolean
  onUse: () => void
}) {
  const previewRef = useRef<HTMLDivElement>(null)
  const { state, mapping } = intake
  return <ArtifactImportReview intake={intake} label="Import spreadsheet data"
    description="Start from one UTF-8 CSV (comma-separated) or TSV (tab-separated) file. Choose whether the first row names the columns, then review the complete sheet. Values stay literal, including dates, leading zeros and formulas. Nothing is saved until you create the sheet."
    summary={state.status === 'ready' ? `Review imported sheet. ${state.records.length} source rows; your draft is unchanged.` : ''}
    adoptionCopy={hasContent ? 'Using this sheet replaces all current columns, rows and notes.' : 'Using this sheet fills the spreadsheet content.'}
    useLabel={hasContent ? 'Replace sheet with imported sheet' : 'Use imported sheet'}
    disabled={disabled || mapping?.status === 'error'} onUse={onUse} previewRef={previewRef}>
    {state.status === 'ready' && <>
      <CheckboxRow checked={intake.firstRowHeaders} onToggle={() => intake.setFirstRowHeaders(!intake.firstRowHeaders)} disabled={disabled} className="text-[12px] text-ink-soft">
        First row contains column names
      </CheckboxRow>
      <div ref={previewRef} role="region" aria-label="Imported sheet" tabIndex={0} className="max-h-64 min-w-0 overflow-y-auto rounded-lg">
        {mapping?.status === 'ready' ? <>
          <p className="mb-2 text-[11px] leading-relaxed text-ink-soft">{mapping.disclosure}</p>
          <StructuredArtifactView body={mapping.body} size="compact" />
        </> : mapping?.status === 'error' && <p role="alert" className="text-[12px] text-danger-text">{mapping.message}</p>}
      </div>
    </>}
  </ArtifactImportReview>
}
