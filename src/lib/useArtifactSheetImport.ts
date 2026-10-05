import { useState } from 'react'
import { mapArtifactSheetImport, reviewArtifactSheetImport } from './artifactSheetImport.ts'
import { useArtifactFileImport } from './useArtifactFileImport.ts'

/** Header interpretation is a review choice, never content-type inference. */
export function useArtifactSheetImport(enabled: boolean) {
  const intake = useArtifactFileImport(enabled ? 'sheet' : null, reviewArtifactSheetImport)
  const [firstRowHeaders, setFirstRowHeaders] = useState(true)
  const [allVisibleCandidate, setAllVisibleCandidate] = useState<typeof intake.state | null>(null)
  // A selection belongs to the reviewed candidate, never a later file that
  // happens to reuse the same source worksheet index.
  const [selection, setSelection] = useState<{ candidate: typeof intake.state; sourceSheet: number } | null>(null)
  const worksheets = intake.state.status === 'ready' && 'workbook' in intake.state ? intake.state.workbook.worksheets : []
  const importAllVisible = allVisibleCandidate === intake.state && intake.state.status === 'ready' && 'workbook' in intake.state
  const sourceSheet = selection?.candidate === intake.state ? selection.sourceSheet : worksheets[0]?.sourceSheet
  const selectWorksheet = (source: number) => setSelection({ candidate: intake.state, sourceSheet: source })
  const setImportAllVisible = (enabled: boolean) => setAllVisibleCandidate(enabled ? intake.state : null)
  const mapping = intake.state.status === 'ready' ? mapArtifactSheetImport(intake.state, firstRowHeaders, sourceSheet, importAllVisible) : null
  type Candidate = { name: string; body: Extract<NonNullable<typeof mapping>, { status: 'ready' }>['body'] }
  const accept = (apply: (candidate: Candidate) => void) => {
    if (mapping?.status !== 'ready') return
    intake.accept((candidate) => apply({ name: candidate.name, body: mapping.body }))
  }
  return { ...intake, mapping, worksheets, sourceSheet, selectWorksheet, firstRowHeaders, setFirstRowHeaders, importAllVisible, setImportAllVisible, accept }
}
