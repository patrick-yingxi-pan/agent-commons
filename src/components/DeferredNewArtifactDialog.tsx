import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { FormDialog } from './FormDialog.tsx'
import type { NewArtifactDialog } from './NewArtifactDialog.tsx'
import { prepareArtifactCreation } from '../controller/artifactCreationMutations.ts'

// The editable surface and its save/recovery code form one admission boundary.
// Fetch both concurrently, but expose no draft fields until both are ready.
const Dialog = lazy(() => Promise.all([
  import('./NewArtifactDialog.tsx'),
  prepareArtifactCreation(),
]).then(([module]) => ({ default: module.NewArtifactDialog })))
type Props = ComponentProps<typeof NewArtifactDialog>

/** Admission is before the first editable field. A rejected browser module URL
 * needs a real navigation; closing never accepts intent or opens a late form. */
function LoadState({ failed = false, onClose }: { failed?: boolean; onClose: () => void }) {
  return <FormDialog title="New artifact" icon={<FileText size={18} className="text-cap-workspace" />}
    kind="artifact-form-load" submitLabel={failed ? 'Reload app' : 'Loading…'}
    canSubmit={failed} onSubmit={() => window.location.reload()} onClose={onClose}>
    <div role={failed ? 'alert' : 'status'} data-artifact-form-load={failed ? 'failed' : 'loading'} className="space-y-2 text-[13px] text-ink-soft">
      <p>{failed ? 'The artifact form could not be loaded.' : 'Loading artifact form…'}</p>
      {failed && <p className="text-[12px]">The app may have updated, or the connection was interrupted. Copy any unsent workspace text before reloading.</p>}
    </div>
  </FormDialog>
}

class LoadBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <LoadState failed onClose={this.props.onClose} /> : this.props.children
  }
}

export function DeferredNewArtifactDialog(props: Props) {
  return <LoadBoundary onClose={props.onClose}>
    <Suspense fallback={<LoadState onClose={props.onClose} />}>
      <Dialog {...props} />
    </Suspense>
  </LoadBoundary>
}
