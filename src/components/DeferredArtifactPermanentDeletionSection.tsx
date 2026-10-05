import { Component, Suspense, lazy, type ReactNode } from 'react'
import type { ArtifactItem } from '../../contract/cowork.ts'
import type { MainPageSectionComponent } from './ProposalsPanel'
import { InlineOperationStatus } from './InlineOperationStatus'

function loadDeletionSection() {
  // The recovery notice must be admitted before the irreversible control is
  // interactive, including after navigation and before the first request.
  return Promise.all([
    import('./ArtifactPermanentDeletionSection'),
    import('./ShellMutationNotices'),
  ]).then(([section]) => ({ default: section.ArtifactPermanentDeletionSection }))
}

const Section = lazy(loadDeletionSection)

class DeletionSectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <InlineOperationStatus tone="alert" message="Couldn’t load permanent deletion controls. Nothing was deleted; reload the app to retry." action={{ label: 'Reload app', onClick: () => window.location.reload() }} />
    return this.props.children
  }
}

export default function DeferredArtifactPermanentDeletionSection({
  Section: FoldSection,
  artifact,
  sourceUserId,
  onDeleted,
}: {
  Section: MainPageSectionComponent
  artifact: ArtifactItem
  sourceUserId: string | null
  onDeleted: () => void
}) {
  return <div data-artifact-permanent-delete-section>
    <DeletionSectionBoundary>
      <Suspense fallback={<p role="status" className="text-[12px] text-ink-faint">Loading deletion controls…</p>}>
        <Section Section={FoldSection} artifact={artifact} sourceUserId={sourceUserId} onDeleted={onDeleted} />
      </Suspense>
    </DeletionSectionBoundary>
  </div>
}
