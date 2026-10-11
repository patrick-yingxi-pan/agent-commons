import { lazy, Suspense, type ComponentProps } from 'react'
import { SendHorizontal } from 'lucide-react'
import { FormDialog } from './FormDialog.tsx'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import type { NewDispatchDialog } from './NewDispatchDialog.tsx'

const Dialog = lazy(() => import('./NewDispatchDialog.tsx').then((module) => ({ default: module.NewDispatchDialog })))
type Props = ComponentProps<typeof NewDispatchDialog>

function LoadState({ failed = false, onClose }: { failed?: boolean; onClose: () => void }) {
  return <FormDialog title="New dispatch" icon={<SendHorizontal size={18} className="text-cap-workspace" />}
    kind="dispatch-form-load" submitLabel={failed ? 'Reload app' : 'Loading…'}
    canSubmit={failed} onSubmit={() => window.location.reload()} onClose={onClose}>
    <div role={failed ? 'alert' : 'status'} data-dispatch-form-load={failed ? 'failed' : 'loading'} className="space-y-2 text-[13px] text-ink-soft">
      <p>{failed ? 'The Dispatch form could not be loaded.' : 'Loading Dispatch form…'}</p>
      {failed && <p className="text-[12px]">The app may have updated, or the connection was interrupted. Copy any unsent workspace text before reloading.</p>}
    </div>
  </FormDialog>
}

export function DeferredNewDispatchDialog(props: Props) {
  return <DeferredLoadBoundary fallback={<LoadState failed onClose={props.onClose} />}>
    <Suspense fallback={<LoadState onClose={props.onClose} />}>
      <Dialog {...props} />
    </Suspense>
  </DeferredLoadBoundary>
}
