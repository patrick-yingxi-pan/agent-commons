import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Delegation, EscalationTrigger, PatchDelegationRequest } from '../../contract/index.ts'
import {
  clearDelegationPolicyDraft,
  readDelegationPolicyDraft,
  hasDelegationPolicyDraft,
  writeDelegationPolicyDraft,
  subscribeDelegationPolicyDrafts,
  delegationPolicyDraftGeneration,
  type DelegationPolicyDraft,
} from '../controller/delegationPolicyDrafts.ts'
import { CheckboxRow } from './Checkbox.tsx'
import { delegationPolicyAccountGeneration, enqueueDelegationPolicy, isDelegationPolicyHeld, useDelegationPolicyStatus } from '../controller/delegationPolicyMutations.ts'

export interface DelegationPolicyEditorProps {
  projectId: string
  tenantId: string
  delegation: Delegation
  onCancel: () => void
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

export function DelegationPolicyEditor({ projectId, tenantId, delegation, onCancel }: DelegationPolicyEditorProps) {
  useSyncExternalStore(subscribeDelegationPolicyDrafts, delegationPolicyDraftGeneration)
  const draft = readDelegationPolicyDraft(delegation)
  const [error, setError] = useState<string | null>(null)
  useDelegationPolicyStatus()
  const held = isDelegationPolicyHeld(delegation.id)
  const wasHeld = useRef(held)
  useEffect(() => {
    if (wasHeld.current && !held && !hasDelegationPolicyDraft(delegation)) onCancel()
    wasHeld.current = held
  }, [held, delegation, onCancel])
  const update = (patch: Partial<DelegationPolicyDraft>) => {
    const next = { ...draft, ...patch }
    writeDelegationPolicyDraft(delegation, next)
  }
  const reviewCurrent = () => update({ expectedRevision: delegation.revision ?? 0, needsReview: false })
  const save = async () => {
    if (held || draft.needsReview || !draft.policy.trim()) return
    const submittedGeneration = delegationPolicyAccountGeneration()
    const expiresAt = draft.expiryChanged ? parseLocalDateTime(draft.expiryInput) : draft.expiryAt ?? null
    if (Number.isNaN(expiresAt)) {
      setError(`Choose a valid local time in ${delegationTimeZone()}.`)
      return
    }
    if (expiresAt != null && expiresAt <= Date.now()) {
      setError('Choose a future expiry or clear it. No policy update has been sent.')
      return
    }
    setError(null)
    const escalation = (['effectful', 'unreviewed', 'stranger'] as EscalationTrigger[])
      .filter((trigger) => draft.escalation.includes(trigger))
    const request: PatchDelegationRequest = {
      expectedRevision: draft.expectedRevision,
      policy: draft.policy.trim(),
      escalation,
      mode: draft.mode,
      expiresAt,
    }
    try {
      writeDelegationPolicyDraft(delegation, draft)
      const outcome = await enqueueDelegationPolicy({
        tenantId, projectId, delegationId: delegation.id, request,
      })
      if (submittedGeneration !== delegationPolicyAccountGeneration()) return
      if (outcome === 'applied') {
        onCancel()
      }
    } catch (e) {
      if (submittedGeneration !== delegationPolicyAccountGeneration()) return
      setError(e instanceof Error ? e.message : 'Could not save this policy version.')
    }
  }
  const toggleTrigger = (trigger: EscalationTrigger) => {
    if (trigger === 'effectful') return
    const selected = new Set(draft.escalation)
    if (selected.has(trigger)) selected.delete(trigger)
    else selected.add(trigger)
    update({ escalation: (['effectful', 'unreviewed', 'stranger'] as EscalationTrigger[]).filter((item) => selected.has(item)) })
  }

  return (
    <div data-delegation-policy-editor className="mt-2.5 space-y-2 rounded-md border border-line bg-panel-2/50 p-2.5" aria-busy={held}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-ink">Edit policy · reviewing version {draft.expectedRevision}</div>
        <button type="button" onClick={() => { clearDelegationPolicyDraft(delegation); onCancel() }} disabled={held} className="rounded-md p-1 text-ink-faint hover:bg-panel-2 disabled:opacity-50" aria-label="Close policy editor">
          Close
        </button>
      </div>
      {draft.needsReview && (
        <div role="alert" className="space-y-1.5 rounded-md border border-line bg-surface p-2 text-[11px] text-ink-soft">
          <p>Review the current policy before saving again. Your draft is kept below.</p>
          <p>Current saved version {delegation.revision ?? 0}: “{delegation.policy ?? 'Policy text unavailable'}” · {delegation.mode === 'draft' ? 'recommend only' : 'decide within policy'} · escalates on {delegation.escalation.join(', ')} · {formatDelegationTime(delegation.expiresAt)}</p>
          <button type="button" onClick={reviewCurrent} className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-soft hover:bg-panel-2">
            Review current version and keep my draft
          </button>
        </div>
      )}
      <textarea
        value={draft.policy}
        onChange={(event) => update({ policy: event.target.value })}
        aria-label="Delegation policy"
        maxLength={2000}
        rows={3}
        disabled={held}
        className="w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select value={draft.mode} onChange={(event) => update({ mode: event.target.value as 'draft' | 'decide' })} aria-label="Delegation autonomy" disabled={held} className="rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink">
          <option value="draft">recommend only</option>
          <option value="decide">decide within policy</option>
        </select>
        {(['unreviewed', 'stranger'] as EscalationTrigger[]).map((trigger) => (
          <CheckboxRow key={trigger} checked={draft.escalation.includes(trigger)} disabled={held} onToggle={() => toggleTrigger(trigger)}>
            {trigger === 'unreviewed' ? 'No adversarial review' : 'Outside contributor'}
          </CheckboxRow>
        ))}
        <span className="text-[11px] text-ink-faint">✓ Irreversible action always asks you</span>
      </div>
      <label className="block space-y-1 text-[11px] text-ink-soft">
        <span>Expiry (optional)</span>
        <input type="datetime-local" value={draft.expiryInput} onChange={(event) => update({ expiryInput: event.target.value, expiryChanged: true })} disabled={held} aria-label="Delegation expiry" className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink" />
        <span className="block text-ink-faint">Times use {delegationTimeZone()} and are sent as UTC. Leave blank to remove the expiry.</span>
      </label>
      {error && <p role="alert" className="text-[11px] text-removed">{error}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={() => void save()} disabled={held || draft.needsReview || !draft.policy.trim()} className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-soft hover:bg-panel-2 disabled:opacity-45">
          {held ? 'Saving exact version…' : 'Save policy version'}
        </button>
      </div>
    </div>
  )
}
