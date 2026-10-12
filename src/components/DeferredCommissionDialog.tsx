import { lazy, Suspense, type ComponentProps } from 'react'
import { Cpu } from 'lucide-react'
import type { CommissionDialog } from './CommissionDialog.tsx'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { FormDialog } from './FormDialog.tsx'
import { Spinner } from './Spinner.tsx'

const Dialog = lazy(() => import('./CommissionDialog.tsx').then((module) => ({ default: module.CommissionDialog })))
type Props = ComponentProps<typeof CommissionDialog>

function LoadState({ failed = false, onClose }: { failed?: boolean; onClose: () => void }) {
  return <FormDialog title="Edit contributor" icon={<Cpu size={18} className="text-ink-soft" />}
    kind="commission-form-load" submitLabel={failed ? 'Reload app' : 'Loading…'}
    canSubmit={failed} onSubmit={() => window.location.reload()} onClose={onClose}>
    <div role={failed ? 'alert' : 'status'} data-commission-form-load={failed ? 'failed' : 'loading'} className="space-y-2 text-[13px] text-ink-soft">
      {failed ? <>
        <p>The contributor form couldn’t be loaded. No change was made.</p>
        <p className="text-[12px]">Copy any unsent workspace text before reloading.</p>
      </> : <p className="flex items-center gap-2"><Spinner size={13} /> Loading contributor options…</p>}
    </div>
  </FormDialog>
}

/** The edit form is optional row content; its shell stays dismissible while
 * loading and gives a clear no-mutation recovery face if its chunk fails. */
export function DeferredCommissionDialog(props: Props) {
  return <DeferredLoadBoundary fallback={<LoadState failed onClose={props.onClose} />}>
    <Suspense fallback={<LoadState onClose={props.onClose} />}>
      <Dialog {...props} />
    </Suspense>
  </DeferredLoadBoundary>
}
