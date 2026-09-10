import { useState } from 'react'
import { mapArtifactSheetImport, reviewArtifactSheetImport } from './artifactSheetImport.ts'
import { useArtifactFileImport } from './useArtifactFileImport.ts'

/** Header interpretation is a review choice, never content-type inference. */
export function useArtifactSheetImport(enabled: boolean) {
  const intake = useArtifactFileImport(enabled ? 'sheet' : null, reviewArtifactSheetImport)
  const [firstRowHeaders, setFirstRowHeaders] = useState(true)
  const mapping = intake.state.status === 'ready' ? mapArtifactSheetImport(intake.state, firstRowHeaders) : null
  type Candidate = { name: string; body: Extract<NonNullable<typeof mapping>, { status: 'ready' }>['body'] }
  const accept = (apply: (candidate: Candidate) => void) => {
    if (mapping?.status !== 'ready') return
    intake.accept((candidate) => apply({ name: candidate.name, body: mapping.body }))
  }
  return { ...intake, mapping, firstRowHeaders, setFirstRowHeaders, accept }
}
