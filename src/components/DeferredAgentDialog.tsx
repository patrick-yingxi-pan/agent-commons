import { lazy, Suspense, type ComponentProps } from 'react'
import { Bot } from 'lucide-react'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { FormDialog } from './FormDialog.tsx'
import { Spinner } from './Spinner.tsx'
import type { AgentDialog } from './AgentDialog.tsx'

const Dialog = lazy(() => import('./AgentDialog.tsx').then(module => ({ default: module.AgentDialog })))
type Props = ComponentProps<typeof AgentDialog>

function LoadState({ failed = false, agent, onClose }: { failed?: boolean; agent: Props['agent']; onClose: () => void }) {
  const title = agent ? 'Edit agent' : 'New agent'
  return <FormDialog title={title} icon={<Bot size={18} className="text-ink-soft" />}
    kind="agent-form-load" submitLabel={failed ? 'Reload app' : 'Loading…'}
    canSubmit={failed} onSubmit={() => window.location.reload()} onClose={onClose}>
    <div role={failed ? 'alert' : 'status'} data-agent-form-load={failed ? 'failed' : 'loading'}
      className="space-y-2 text-[13px] text-ink-soft">
      {failed ? <>
        <p>The Agent form couldn’t be loaded.</p>
        <p className="text-[12px]">Copy unsent workspace text before reloading.</p>
      </> : <p className="flex items-center gap-2"><Spinner size={13} /> Loading Agent options…</p>}
    </div>
  </FormDialog>
}

/** The create/edit surface is optional page content. Its fallback is dismissible,
 * offers no mutation, and keeps chunk failure local until explicit reload. */
export function DeferredAgentDialog(props: Props) {
  return <DeferredLoadBoundary fallback={<LoadState failed agent={props.agent} onClose={props.onClose} />}>
    <Suspense fallback={<LoadState agent={props.agent} onClose={props.onClose} />}>
      <Dialog {...props} />
    </Suspense>
  </DeferredLoadBoundary>
}
