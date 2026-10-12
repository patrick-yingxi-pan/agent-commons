import { useState } from 'react'
import { Cpu, Plus } from 'lucide-react'
import type { Agent, ProjectRole } from '../../contract/index.ts'
import { useMe } from '../api/hooks.ts'
import { enqueueCommissionCreation, isCommissionCreationHeld } from '../controller/commissionCreationMutations.ts'
import { POPOVER_SURFACE } from '../lib/popover.ts'
import { useDismissable } from '../lib/useDismissable.ts'
import { usePopoverShift } from '../lib/usePopoverShift.ts'
import { SectionAction } from './SectionAction.tsx'
import { Spinner } from './Spinner.tsx'

/** An exact Agent/Project/role assignment remains visible until acknowledged.
 * The Project's default role is only a picker shortcut, never a server default. */
export function CommissionAdd({ projectId, available, joinRole }: { projectId: string; available: Agent[]; joinRole: ProjectRole }) {
  const tenantId = useMe().data?.tenant.id
  const [open, setOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (isCommissionCreationHeld(projectId)) return
    setOpen(false)
    setSelectedAgent(null)
    setError(null)
  }
  const ref = useDismissable<HTMLDivElement>(open, close)
  const popRef = usePopoverShift<HTMLDivElement>(open)
  // A roster refresh may expose the commit before its response settles.
  const choices = selectedAgent && !available.some((agent) => agent.id === selectedAgent.id)
    ? [selectedAgent, ...available]
    : available

  const commission = async (agent: Agent) => {
    if (pending || !tenantId) return
    setSelectedAgent(agent)
    setPending(agent.id)
    setError(null)
    try {
      const outcome = await enqueueCommissionCreation({
        tenantId,
        request: { agentId: agent.id, projectId, role: joinRole },
      })
      if (outcome === 'discarded') {
        setError('Your Contributor choice is still here. Review it, then commission again when ready.')
        return
      }
      setOpen(false)
      setSelectedAgent(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not commission this Agent.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div ref={ref} className="relative">
      <SectionAction
        label="Commission an agent"
        icon={<Plus size={14} />}
        onClick={() => {
          if (open) close()
          else if (!isCommissionCreationHeld(projectId)) setOpen(true)
        }}
        open={open}
        disabled={!tenantId || pending !== null}
        disabledReason={pending ? 'Waiting for server acknowledgement' : 'Waiting for your account'}
      />
      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Commission an agent"
          aria-busy={pending !== null}
          className={`absolute right-0 top-full z-30 mt-1.5 w-[280px] p-2 ${POPOVER_SURFACE}`}
        >
          {choices.length === 0 ? (
            <p className="px-1.5 py-1 text-[12px] text-ink-faint">Every agent is already a Contributor.</p>
          ) : (
            <>
              {choices.map((a) => (
                <button
                  key={a.id}
                  onClick={() => commission(a)}
                  disabled={pending !== null}
                  data-pending={pending === a.id || undefined}
                  className={`group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2 disabled:opacity-50 ${pending === a.id ? 'bg-accent/10 ring-1 ring-accent/30' : ''}`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-ink-soft"><Cpu size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{a.label}</span>
                    <span className="block truncate text-[11px] text-ink-faint">{a.tools.length} tool{a.tools.length === 1 ? '' : 's'}</span>
                  </span>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint transition group-hover:bg-accent-solid group-hover:text-on-solid">
                    {pending === a.id ? <Spinner size={13} /> : <Plus size={13} />}
                  </span>
                </button>
              ))}
              <p className="mt-1 border-t border-line px-1.5 pt-1.5 text-[11px] text-ink-faint">
                Joins as <span className="font-medium text-ink-soft">{joinRole}</span> — change per contributor via its Edit.
              </p>
              {error && <p role="alert" className="px-1.5 pt-1.5 text-[11px] text-danger">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
