import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import { Cpu, Plug } from 'lucide-react'
import type { ProviderDialog as ProviderDialogComponent, ProviderConnectionDialog as ProviderConnectionDialogComponent } from './ProviderDialogs.tsx'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { FormDialog } from './FormDialog.tsx'
import { Spinner } from './Spinner.tsx'

const Dialog = lazy(() => import('./ProviderDialogs.tsx').then(module => ({ default: module.ProviderDialog })))
const ConnectionDialog = lazy(() => import('./ProviderDialogs.tsx').then(module => ({ default: module.ProviderConnectionDialog })))
type DialogProps = ComponentProps<typeof ProviderDialogComponent>
type ConnectionDialogProps = ComponentProps<typeof ProviderConnectionDialogComponent>

function LoadState({ failed = false, title, icon, onClose }: { failed?: boolean; title: string; icon: ReactNode; onClose: () => void }) {
  return <FormDialog title={title} icon={icon} kind="provider-form-load" submitLabel={failed ? 'Reload app' : 'Loading…'}
    canSubmit={failed} onSubmit={() => window.location.reload()} onClose={onClose}>
    <div role={failed ? 'alert' : 'status'} data-provider-form-load={failed ? 'failed' : 'loading'} className="space-y-2 text-[13px] text-ink-soft">
      {failed ? <>
        <p>The provider form couldn’t be loaded. No change was made.</p>
        <p className="text-[12px]">Copy any unsent workspace text before reloading.</p>
      </> : <p className="flex items-center gap-2"><Spinner size={13} /> Loading provider controls…</p>}
    </div>
  </FormDialog>
}

export function DeferredProviderDialog(props: DialogProps) {
  const title = props.provider ? 'Edit provider' : 'New provider'
  const fallback = { title, icon: <Cpu size={18} className="text-ink-soft" />, onClose: props.onClose }
  return <DeferredLoadBoundary fallback={<LoadState {...fallback} failed />}>
    <Suspense fallback={<LoadState {...fallback} />}><Dialog {...props} /></Suspense>
  </DeferredLoadBoundary>
}

export function DeferredProviderConnectionDialog(props: ConnectionDialogProps) {
  const fallback = { title: 'Update connection', icon: <Plug size={18} className="text-ink-soft" />, onClose: props.onClose }
  return <DeferredLoadBoundary fallback={<LoadState {...fallback} failed />}>
    <Suspense fallback={<LoadState {...fallback} />}><ConnectionDialog {...props} /></Suspense>
  </DeferredLoadBoundary>
}
