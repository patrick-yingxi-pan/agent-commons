import { useEffect, useState } from 'react'
import { Plus, Pencil, X } from 'lucide-react'
import type { Project } from '../data/cowork'
import { useAgents, useDelegations, useMe } from '../api'
import { enqueueDelegationCreation, isDelegationCreationHeld, useDelegationCreationStatus } from '../controller/delegationCreationMutations.ts'
import {
  enqueueDelegationRevocation,
  heldDelegationRevocations,
  isDelegationRevocationHeld,
  useDelegationRevocationStatus,
} from '../controller/delegationRevocationMutations.ts'
import { hasDelegationPolicyDraft } from '../controller/delegationPolicyDrafts.ts'
import { isDelegationPolicyHeld } from '../controller/delegationPolicyHolds.ts'
import { useDelegationPolicyStatus } from '../controller/delegationPolicyMutations.ts'
import { DeferredDelegationPolicyEditor } from './DeferredDelegationPolicyEditor.tsx'
import { CheckboxRow } from './Checkbox'
import { Spinner } from './Spinner'
import { SectionAction } from './SectionAction'
import { ResourcePageSection as FoldSection } from './ResourcePage'
import { SOFT_BUTTON_CLASS } from '../lib/button'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import type { DelegatedActKind, EscalationTrigger } from '../../contract/index.ts'

function useDelegationClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function parseLocalDateTime(value: string): number | null {
  if (!value) return null
  const milliseconds = new Date(value).getTime()
  if (!Number.isFinite(milliseconds)) return Number.NaN
  const date = new Date(milliseconds)
  const pad = (part: number) => String(part).padStart(2, '0')
  const normalized = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  return normalized === value ? milliseconds : Number.NaN
}

function delegationTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local time zone'
}

function formatDelegationTime(milliseconds?: number): string {
  if (milliseconds == null) return 'No expiry'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(milliseconds))
}

export function DelegationPanel({ project }: { project: Project }) {
  const currentList = useDelegations(project.id).data ?? []
  const delegationNow = useDelegationClock()
  useDelegationRevocationStatus()
  useDelegationPolicyStatus()
  const list = [...currentList, ...heldDelegationRevocations(project.id).filter(
    (held) => !currentList.some((delegation) => delegation.id === held.id),
  )].sort((a, b) => a.createdAt - b.createdAt)
  const agents = useAgents().data ?? []
  const tenantId = useMe().data?.tenant.id
  useDelegationCreationStatus()
  const [composing, setComposing] = useState(false)
  const [agentId, setAgentId] = useState('')
  const [actKind, setActKind] = useState<DelegatedActKind>('approve-envelope')
  const [mode, setMode] = useState<'draft' | 'decide'>('draft')
  const [policy, setPolicy] = useState('')
  const [extraTriggers, setExtraTriggers] = useState<Set<EscalationTrigger>>(new Set())
  const [expiry, setExpiry] = useState('')
  const [editingDelegationId, setEditingDelegationId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const held = isDelegationCreationHeld(project.id)
  useEffect(() => {
    if (editingDelegationId || project.own === false) return
    const resumable = list.find((delegation) => delegation.mine === true && hasDelegationPolicyDraft(delegation))
    if (resumable) setEditingDelegationId(resumable.id)
  }, [editingDelegationId, list, project.own])
  const mint = async () => {
    const agent = agentId || agents[0]?.id
    if (project.own === false || held || !tenantId || !agent || !policy.trim()) return
    const expiresAt = parseLocalDateTime(expiry)
    if (Number.isNaN(expiresAt)) {
      setError(`Choose a valid local time in ${delegationTimeZone()}.`)
      return
    }
    if (expiresAt != null && expiresAt <= Date.now()) {
      setError('Expiry must be a future time.')
      return
    }
    setError(null)
    try {
      const outcome = await enqueueDelegationCreation({
        tenantId,
        projectId: project.id,
        request: {
          agentId: agent,
          actKind,
          policy: policy.trim(),
          mode,
          escalation: [...extraTriggers],
          ...(expiresAt == null ? {} : { expiresAt }),
        },
      })
      if (outcome === 'applied') {
        setPolicy('')
        setExpiry('')
        setComposing(false)
      } else setError('Your Delegation is still here. Review it, then delegate again when ready.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delegate.')
    }
  }
  return (
    <FoldSection
      title="Delegation"
      defaultFolded
      heldOpen={held || editingDelegationId !== null}
      summary={list.length === 0
        ? 'No judgment delegated'
        : `${list.length} standing ${list.length === 1 ? 'policy' : 'policies'}`}
      actions={project.own !== false ? (
        <SectionAction
          label="Delegate judgment"
          icon={<Plus size={14} />}
          onClick={() => {
            if (!held) setComposing((v) => !v)
          }}
          expanded={composing}
          disabled={held || !tenantId}
          disabledReason={held ? 'Waiting for server acknowledgement' : 'Waiting for your account'}
        />
      ) : undefined}
    >
      {list.length === 0 ? (
        <p className="text-[12px] text-ink-faint">
          {project.own !== false
            ? <>
                No judgment delegated. An Agent of yours can approve envelopes or land contributions under your written
                policy — irreversible acts always escalate back to you.
              </>
            : 'No Delegations yet.'}
        </p>
      ) : (
        <div className="space-y-2.5">
          {list.map((d) => {
            const revoking = isDelegationRevocationHeld(d.id)
            const policyHeld = isDelegationPolicyHeld(d.id)
            const expired = d.expired === true || (d.expiresAt != null && d.expiresAt <= delegationNow)
            return (
              <div
                key={d.id}
                className="group rounded-md border border-line/70 p-2"
                aria-busy={revoking || policyHeld}
                data-delegation-revocation={revoking || undefined}
                data-delegation-policy-held={policyHeld || undefined}
                data-delegation-id={d.id}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 flex h-2.5 w-2.5 shrink-0 items-center justify-center text-accent">
                    {revoking || policyHeld
                      ? <Spinner size={10} />
                      : <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-medium text-ink">
                      <span className="break-words [overflow-wrap:anywhere]">
                        {d.agentLabel} · {d.actKind === 'land' ? 'lands' : 'approves envelopes'}
                      </span>
                      {expired && (
                        <span className="rounded bg-removed-bg px-1 py-0.5 text-[10px] font-medium text-removed">
                          Expired · Ask unavailable
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-faint">
                      {d.mode === 'draft' ? 'recommend only' : 'decides within policy'} · escalates on {d.escalation.join(', ')}
                    </div>
                    {d.expiresAt != null && (
                      <div className={`text-[11px] ${expired ? 'text-removed' : 'text-ink-faint'}`}>
                        {expired ? 'Expired' : 'Expires'} {formatDelegationTime(d.expiresAt)}
                      </div>
                    )}
                    {d.mine === true && d.policy && (
                      <div className="truncate text-[11px] italic text-ink-faint" title={d.policy}>
                        “{d.policy}”
                      </div>
                    )}
                    {d.mine === true && (d.versions?.length ?? 0) > 0 && (
                      <details className="mt-1 text-[11px] text-ink-soft">
                        <summary className="cursor-pointer text-ink-faint">
                          Version history ({d.versions!.length})
                        </summary>
                        <ol className="mt-1 space-y-1.5 border-l border-line pl-2">
                          {[...d.versions!].reverse().map((version) => (
                            <li key={version.revision} data-delegation-policy-version={version.revision}>
                              <div className="font-medium text-ink">
                                Policy version {version.revision} · {formatDelegationTime(version.updatedAt)}
                              </div>
                              <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                {version.policy}
                              </div>
                              <div className="break-words [overflow-wrap:anywhere]">
                                {version.mode === 'draft' ? 'recommend only' : 'decides within policy'} · escalates on{' '}
                                {version.escalation.join(', ')} · {formatDelegationTime(version.expiresAt)}
                              </div>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </div>
                  {(d.mine === true || project.own !== false) && (
                    <div className="flex shrink-0 items-center gap-1">
                      {d.mine === true && project.own !== false && <button
                        type="button"
                        onClick={() => setEditingDelegationId(editingDelegationId === d.id ? null : d.id)}
                        disabled={revoking || policyHeld}
                        aria-label={`Edit ${d.agentLabel}'s delegation policy`}
                        title="Create a new policy version"
                        className={[
                          'flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-ink-faint hover:bg-panel-2 hover:text-ink disabled:opacity-50',
                          HOVER_REVEAL,
                        ].join(' ')}
                      >
                        <Pencil size={12} /> Edit
                      </button>}
                      <button
                        onClick={() => {
                          if (!revoking && !policyHeld) void enqueueDelegationRevocation(d)
                        }}
                        disabled={revoking || policyHeld}
                        aria-label={`${revoking ? 'Revoking' : 'Revoke'} ${d.agentLabel}'s delegation`}
                        title={
                          policyHeld
                            ? 'Wait for the policy edit to be confirmed'
                            : 'Revoke — descent is always one tap'
                        }
                        className={[
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint',
                          'hover:bg-removed-bg hover:text-removed focus-visible:opacity-100 disabled:opacity-60',
                          revoking ? 'opacity-100' : HOVER_REVEAL,
                        ].join(' ')}
                      >
                        {revoking ? <Spinner size={12} /> : <X size={13} />}
                      </button>
                    </div>
                  )}
                </div>
                {editingDelegationId === d.id && d.mine === true && project.own !== false && tenantId && (
                  <DeferredDelegationPolicyEditor
                    projectId={project.id}
                    tenantId={tenantId}
                    delegation={d}
                    onCancel={() => setEditingDelegationId(null)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
      {composing && project.own !== false && (
        <div data-delegation-creation-form className="mt-2.5 space-y-2" aria-busy={held}>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Choose what this Agent may judge and write the rule it must follow. Labor moves; liability stays yours.
          </p>
          <select
            value={agentId || agents[0]?.id || ''}
            onChange={(e) => setAgentId(e.target.value)}
            aria-label="Delegate agent"
            disabled={held}
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
          >
            {agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <select
              value={actKind}
              onChange={(e) => setActKind(e.target.value as DelegatedActKind)}
              aria-label="Delegated act"
              disabled={held}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
            >
              <option value="approve-envelope">approve envelopes</option>
              <option value="land">land contributions</option>
            </select>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'draft' | 'decide')}
              aria-label="Autonomy rung"
              title="A recommendation waits for you; an automatic decision acts as you when the policy fits"
              disabled={held}
              className="rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
            >
              <option value="draft">recommend only</option>
              <option value="decide">decide within policy</option>
            </select>
          </div>
          <input
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            maxLength={2000}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void mint()
              if (e.key === 'Escape' && !held) setComposing(false)
            }}
            placeholder="Your policy, in your words (required)…"
            aria-label="Delegation policy"
            disabled={held}
            className={
              'w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong'
            }
          />
          <label className="block space-y-1 text-[11px] text-ink-soft">
            <span>Expiry (optional)</span>
            <input
              type="datetime-local"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              disabled={held}
              aria-label="New Delegation expiry"
              className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink"
            />
            <span className="block text-ink-faint">
              Times use {delegationTimeZone()} and are sent as UTC. Leave blank for no expiry.
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
            <span className="text-ink-faint" title="The floor is not delegable">
              ✓ Irreversible action (always asks you)
            </span>
            {(['unreviewed', 'stranger'] as EscalationTrigger[]).map((trigger) => (
              <CheckboxRow
                key={trigger}
                checked={extraTriggers.has(trigger)}
                disabled={held}
                onToggle={() => setExtraTriggers((selected) => {
                  const next = new Set(selected)
                  if (next.has(trigger)) next.delete(trigger)
                  else next.add(trigger)
                  return next
                })}
              >
                {trigger === 'unreviewed' ? 'No adversarial review' : 'Outside contributor'}
              </CheckboxRow>
            ))}
            <button
              onClick={() => void mint()}
              disabled={held || !tenantId || !policy.trim() || agents.length === 0}
              className={`ml-auto ${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}
            >
              {held ? 'Establishing…' : 'Delegate'}
            </button>
          </div>
          {error && <p className="text-[11px] text-removed">{error}</p>}
        </div>
      )}
    </FoldSection>
  )
}
