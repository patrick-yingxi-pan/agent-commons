import { Suspense, lazy, useState } from 'react'
import type { ArtifactKind } from '../types'
import type { ArtifactItem } from '../data/cowork'
import type { MainPageSectionComponent } from './ProposalsPanel'
import { SECONDARY_BUTTON_CLASS } from '../lib/button'
import type { ArtifactSearchTarget } from '../../contract/artifactSearch.ts'

function loadHistoryPanel() {
  // The recovery notice shares the shell chunk. Admit restore controls only
  // after that exact module is known to be available to the mounted workspace.
  return Promise.all([
    import('./ArtifactHistoryPanel'),
    import('./ShellMutationNotices'),
  ]).then(([panel]) => panel)
}

const Panel = lazy(loadHistoryPanel)

export default function ArtifactHistorySection({
  Section,
  artifact,
  sourceUserId,
  allowRestore,
  restoreBlocked,
  addressedRevision,
  searchTarget,
}: {
  Section: MainPageSectionComponent
  artifact: ArtifactItem
  sourceUserId: string | null
  allowRestore: boolean
  restoreBlocked?: boolean
  addressedRevision?: number
  searchTarget?: ArtifactSearchTarget
}) {
  const [opened, setOpened] = useState(false)
  return <Section title="History" summary="Saved versions" heldOpen={addressedRevision !== undefined} persist={addressedRevision === undefined}>
    {!opened && addressedRevision === undefined
      ? <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => setOpened(true)}>Load history</button>
      : <Suspense fallback={<p role="status" className="text-[12px] text-ink-faint">Loading history…</p>}><Panel artifactId={artifact.id} artifactName={artifact.name} artifactKind={artifact.kind as ArtifactKind} sourceUserId={sourceUserId} allowRestore={allowRestore} restoreBlocked={restoreBlocked} addressedRevision={addressedRevision} searchTarget={searchTarget} /></Suspense>}
  </Section>
}
