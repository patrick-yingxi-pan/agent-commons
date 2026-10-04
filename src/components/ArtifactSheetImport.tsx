import { useId, useRef } from 'react'
import type { useArtifactSheetImport } from '../lib/useArtifactSheetImport.ts'
import { ArtifactImportReview } from './ArtifactImportReview.tsx'
import { CheckboxRow } from './Checkbox.tsx'
import { StructuredArtifactView } from './StructuredArtifactView.tsx'
import { FormField } from './FormDialog.tsx'
import { FORM_INPUT_CLASS } from '../lib/formInput'

export function ArtifactSheetImport({ intake, hasContent, disabled, onUse }: {
  intake: ReturnType<typeof useArtifactSheetImport>
  hasContent: boolean
  disabled: boolean
  onUse: () => void
}) {
  const previewRef = useRef<HTMLDivElement>(null)
  const worksheetId = useId()
  const { state, mapping } = intake
  const workbook = state.status === 'ready' && 'workbook' in state ? state.workbook : undefined
  return <ArtifactImportReview intake={intake} label="Import spreadsheet data"
    description="Start from one Excel (.xlsx), UTF-8 CSV or TSV file. For Excel, choose one visible worksheet. Choose whether the first row names the columns, then review the complete result. Values stay literal; formulas are not calculated. Nothing is saved until you create the sheet."
    summary={state.status === 'ready' ? `Review imported sheet. ${'records' in state ? `${state.records.length} source rows` : `${state.workbook.worksheets.length} visible worksheets`}; your draft is unchanged.` : ''}
    adoptionCopy={hasContent ? 'Using this sheet replaces all current columns, rows and notes.' : 'Using this sheet fills the spreadsheet content.'}
    useLabel={hasContent ? 'Replace sheet with imported sheet' : 'Use imported sheet'}
    disabled={disabled || mapping?.status === 'error'} onUse={onUse} previewRef={previewRef}>
    {state.status === 'ready' && <>
      {workbook && <>
        <FormField label="Worksheet" controlId={worksheetId}>
          <select id={worksheetId} className={FORM_INPUT_CLASS} value={intake.sourceSheet} onChange={event => intake.selectWorksheet(Number(event.target.value))} disabled={disabled}>
            {intake.worksheets.map(sheet => <option key={sheet.sourceSheet} value={sheet.sourceSheet}>{sheet.name}</option>)}
          </select>
        </FormField>
        <p className="text-[11px] leading-relaxed text-ink-soft">{workbook.totalSheets} source sheets; {workbook.hiddenSheets} hidden and {workbook.unsupportedSheets} chart/dialog sheets excluded. Hidden rows and columns are omitted. Only the selected worksheet is imported.</p>
      </>}
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
