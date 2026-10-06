import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, RotateCw, ShieldCheck } from 'lucide-react'
import type {
  Contribution,
  DelegatedJudgmentRun,
  Project,
} from '../../contract/index.ts'
import { useAgents, useDelegations, useMe, useProviders } from '../api/hooks.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { isDelegationPolicyHeld } from '../controller/delegationPolicyHolds.ts'
import {
  enqueueDelegatedJudgment,
  heldDelegatedJudgmentIntent,
  isDelegatedJudgmentHeld,
} from '../controller/delegatedJudgmentMutations.ts'
import { isDelegationRevocationHeld } from '../controller/delegationRevocationMutations.ts'
import { SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { contributionReviewSelections } from '../lib/contributionReviewSelection.ts'
import { isProjectEffectMonotonic } from '../../contract/coordination.ts'

const statusFace: Record<DelegatedJudgmentRun['status'], { label: string; icon: typeof CheckCircle2; tone: string }> = {
  pending: { label: 'Judgment running', icon: Clock, tone: 'text-ink-soft' },
  draft: { label: 'Draft recommendation', icon: ShieldCheck, tone: 'text-accent' },
  decided: { label: 'Decided within policy', icon: CheckCircle2, tone: 'text-ok-strong' },
  declined: { label: 'Declined', icon: AlertCircle, tone: 'text-ink-soft' },
  escalated: { label: 'Escalated to owner', icon: AlertCircle, tone: 'text-warn-strong' },
  failed: { label: 'Failed', icon: AlertCircle, tone: 'text-danger-strong' },
  uncertain: { label: 'Outcome uncertain', icon: AlertCircle, tone: 'text-warn-strong' },
  stale: { label: 'Stale judgment', icon: RotateCw, tone: 'text-ink-faint' },
}

function useJudgmentClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function DelegatedJudgmentPanel({
  project,
  contribution,
  lifecycleHeld,
}: {
  project: Project
  contribution: Contribution
  lifecycleHeld: boolean
}) {
  const identity = useMe().data
  const delegationsQuery = useDelegations(project.id)
  const agentsQuery = useAgents()
  const providersQuery = useProviders()
  const [selectedDelegationId, setSelectedDelegationId] = useState('')
  const now = useJudgmentClock()
  const delegations = delegationsQuery.data ?? []
  const held = heldDelegatedJudgmentIntent(project.id, contribution.id)
  const judgmentHeld = isDelegatedJudgmentHeld(project.id, contribution.id)
  const agents = agentsQuery.data ?? []
  const providers = providersQuery.data ?? []
  const ownerSelections = useMemo(
    () => contributionReviewSelections(agents, providers, identity?.tenant.id)
      .filter(({ agent }) => agent.tenantId === undefined || agent.tenantId === identity?.tenant.id),
    [agents, providers, identity?.tenant.id],
  )
  const selectionByAgent = new Map(ownerSelections.map((selection) => [selection.agent.id, selection]))
  const versions = {
    expectedChangesetVersion: contribution.changeset?.at(-1)?.version ?? null,
    expectedEnvelopeVersion: contribution.envelope?.version ?? null,
  }
  const noEffectfulContribution = contribution.effectsFired !== true &&
    (contribution.envelope?.lines ?? []).every((line) => isProjectEffectMonotonic(line.type))
  const applicable = project.own === true && contribution.status === 'open'
    ? delegations.filter((delegation) => {
        if (delegation.mine !== true || delegation.expired === true || (delegation.expiresAt != null && delegation.expiresAt <= now)) return false
        if (delegation.actKind === 'land') return versions.expectedChangesetVersion !== null && contribution.envelope?.status !== 'proposed' && noEffectfulContribution
        return delegation.actKind === 'approve-envelope' &&
          contribution.envelope?.status === 'proposed' && noEffectfulContribution
      })
    : []
  const pendingRun = (contribution.judgments ?? []).find((run) => run.status === 'pending')
  const effectiveSelectedDelegationId = applicable.some((candidate) => candidate.id === selectedDelegationId)
    ? selectedDelegationId
    : ''
  const chosenId = held?.delegationId ?? effectiveSelectedDelegationId
  const delegation = applicable.find((candidate) => candidate.id === chosenId)
  const chosenSelection = delegation ? selectionByAgent.get(delegation.agentId) : undefined
  const selected = held ? undefined : delegation
  useEffect(() => {
    if (
      selectedDelegationId &&
      delegationsQuery.data !== undefined &&
      !applicable.some((candidate) => candidate.id === selectedDelegationId)
    ) setSelectedDelegationId('')
  }, [selectedDelegationId, delegationsQuery.data, applicable])
  const selectedGrantHeld = !!selected && (isDelegationRevocationHeld(selected.id) || isDelegationPolicyHeld(selected.id))
  const heldRunOrPending = judgmentHeld || pendingRun !== undefined
  const canStart = project.own === true && contribution.status === 'open' && !!identity &&
    !!selected && !!chosenSelection && applicable.some((candidate) => candidate.id === selected.id) &&
    !selectedGrantHeld && !heldRunOrPending && !lifecycleHeld
  const runs = [...(contribution.judgments ?? [])].sort((a, b) => b.startedAt - a.startedAt)
  const shouldRender = (project.own === true && contribution.status === 'open') || runs.length > 0

  const runJudgment = () => {
    if (!canStart || !selected || !chosenSelection || !identity) return
    const { agent, provider, modelId } = chosenSelection
    void enqueueDelegatedJudgment({
      tenantId: identity.tenant.id,
      projectId: project.id,
      contributionId: contribution.id,
      delegationId: selected.id,
      delegationLabel: selected.agentLabel,
      actKind: selected.actKind,
      mode: selected.mode,
      policy: selected.policy ?? '',
      escalation: [...selected.escalation],
      judgment: {
        expectedDelegationRevision: selected.revision ?? 0,
        ...versions,
        reviewer: {
          agentId: agent.id,
          agentRevision: agent.revision ?? 0,
          providerId: provider.id,
          providerRevision: provider.definitionRevision ?? 0,
          connectionRevision: provider.connectionRevision ?? 0,
        },
      },
      reviewerLabel: agent.label,
      providerLabel: provider.label,
      modelId,
      modelLabel: chosenSelection.modelLabel || modelId,
      budgetLabel: reviewerBudgetLabel(agent, provider),
    })
  }

  if (!shouldRender) return null
  return (
    <section
      className="mt-5 min-w-0 rounded-xl border border-line bg-surface px-4 py-3 [overflow-wrap:anywhere]"
      aria-label="Delegated judgments"
      data-delegated-judgment-panel
    >
      <div className="flex items-start gap-2.5">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-ink">Delegated judgments</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
            Each run uses the exact current policy and versions shown here. The Agent has no tools: it cannot execute external effects or retry a provider call automatically. The Project owner’s configured provider budget is charged.
          </p>
        </div>
      </div>

      {runs.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {runs.map((run) => (
            <JudgmentRunCard key={run.id} run={run} owner={project.own === true} />
          ))}
        </div>
      )}

      {project.own === true && contribution.status === 'open' && (
        <div className="mt-4 border-t border-line pt-3" data-delegated-judgment-controls>
          {applicable.length > 0 && !held && (
            <label className="block max-w-full text-[12px] font-medium text-ink-soft">
              Current Delegation
              <select
                aria-label="Current Delegation"
                value={effectiveSelectedDelegationId}
                onChange={(event) => setSelectedDelegationId(event.target.value)}
                disabled={judgmentHeld || lifecycleHeld}
                className="mt-1 block w-full min-w-0 max-w-full rounded-md border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink disabled:opacity-60"
              >
                <option value="">Choose an applicable policy…</option>
                {applicable.map((candidate) => {
                  const reviewer = selectionByAgent.get(candidate.agentId)
                  return (
                    <option key={candidate.id} value={candidate.id} disabled={!reviewer || isDelegationRevocationHeld(candidate.id) || isDelegationPolicyHeld(candidate.id)}>
                      {candidate.agentLabel} · {candidate.mode === 'draft' ? 'draft' : 'decide'}
                      {!reviewer ? ' · no configured owner endpoint' : isDelegationRevocationHeld(candidate.id) ? ' · revocation pending' : isDelegationPolicyHeld(candidate.id) ? ' · policy update pending' : ''}
                    </option>
                  )
                })}
              </select>
            </label>
          )}

          {held ? (
            <div className="mt-2 rounded-md border border-line bg-canvas px-3 py-2" data-delegated-judgment-held>
              <p className="text-[12px] font-medium text-ink">
                {held.mode === 'draft' ? 'Draft' : 'Decide'} · {held.delegationLabel} · policy v{held.judgment.expectedDelegationRevision}
              </p>
              <p className="mt-1 text-[12px] text-ink-faint">
                Frozen changeset {versionLabel(held.judgment.expectedChangesetVersion)} · envelope {versionLabel(held.judgment.expectedEnvelopeVersion)} · {held.reviewerLabel} · {held.providerLabel} · {held.modelLabel}. {held.budgetLabel}
              </p>
              <p className="mt-1 text-[12px] text-ink-faint">
                {held.mode === 'draft'
                  ? 'Draft mode records a recommendation only; it does not perform the lifecycle act.'
                  : 'Decide mode can perform only this pinned non-effectful act when current policy permits; authority is rechecked by the server.'}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[12px] text-ink-soft">Policy: {held.policy || 'No private policy text was available.'}</p>
              <p className="mt-1 text-[12px] text-ink-faint">Escalates on {held.escalation.join(', ')}. The request stays pinned; recovery controls are in the workspace notice.</p>
            </div>
          ) : selected && chosenSelection ? (
            <div className="mt-2 rounded-md border border-line bg-canvas px-3 py-2" data-delegated-judgment-preview>
              <p className="text-[12px] font-medium text-ink">
                {selected.mode === 'draft' ? 'Draft recommendation only' : 'Decide within policy'} · {selected.agentLabel} · policy v{selected.revision ?? 0}
              </p>
              <p className="mt-1 text-[12px] text-ink-faint">
                Frozen changeset {versionLabel(versions.expectedChangesetVersion)} · envelope {versionLabel(versions.expectedEnvelopeVersion)} · {chosenSelection.agent.label} · {chosenSelection.provider.label} · {chosenSelection.modelLabel}. The initiating Project owner’s budget is charged. {reviewerBudgetLabel(chosenSelection.agent, chosenSelection.provider)}
              </p>
              <p className="mt-1 text-[12px] text-ink-faint">
                {selected.mode === 'draft'
                  ? 'Draft mode records a recommendation only; it does not perform the lifecycle act.'
                  : 'Decide mode can perform only this pinned non-effectful act when current policy permits; authority is rechecked by the server.'}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[12px] text-ink-soft">Policy: {selected.policy || 'No private policy text was available.'}</p>
              <p className="mt-1 text-[12px] text-ink-faint">Escalates on {selected.escalation.join(', ')}. Mechanical escalation is checked against current state when the run completes.</p>
              <p className="mt-1 text-[12px] text-warn-text">This starts a paid provider request. If the result is uncertain, this run will not be replayed automatically; starting another run is a new paid request.</p>
            </div>
          ) : null}

          {selectedGrantHeld && !held && (
            <p className="mt-2 text-[12px] text-ink-soft" role="status">This current grant is held while its policy or revocation is being confirmed.</p>
          )}

          {pendingRun && (
            <p className="mt-2 text-[12px] text-warn-text" role="status" data-delegated-judgment-pending>
              A judgment run is still pending. Wait for its durable result before starting another provider request.
              {' '}<button type="button" className="underline underline-offset-2" onClick={() => invalidate(keys.contributions(project.id))}>Refresh status</button>
            </p>
          )}
          {judgmentHeld && !held && (
            <p className="mt-2 text-[12px] text-ink-soft" role="status">This exact judgment is being confirmed. Retry or Dismiss is available in the workspace notice.</p>
          )}

          {applicable.length > 0 ? (
            <button
              type="button"
              onClick={runJudgment}
              disabled={!canStart}
              className={`${SOFT_BUTTON_CLASS} mt-3 min-w-0 max-w-full whitespace-normal break-words px-3 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-45`}
              data-delegated-judgment-run
            >
              {judgmentHeld ? 'Judgment held…' : 'Run judgment · uses budget'}
            </button>
          ) : delegationsQuery.status === 'loading' ? (
            <p className="mt-3 text-[12px] text-ink-faint" role="status">Checking current Delegation policies…</p>
          ) : delegationsQuery.status !== 'error' ? (
            <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
              {contribution.envelope?.status !== 'proposed' && versions.expectedChangesetVersion === null && delegations.some((candidate) => candidate.mine === true && candidate.actKind === 'land' && candidate.expired !== true && (candidate.expiresAt == null || candidate.expiresAt > now))
                ? 'Crystallize a changeset before delegated land judgment so the request can pin its exact version.'
                : 'No current owner Delegation can act on this open Contribution. Only non-effectful landings and read-only envelopes can be delegated; effectful work remains with you.'}
            </p>
          ) : null}
          {delegationsQuery.status === 'error' && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-danger-strong" role="alert">
              <span>Current Delegation policies could not be loaded.</span>
              <button type="button" className="underline underline-offset-2" onClick={() => invalidate(keys.delegations(project.id))}>Retry</button>
            </div>
          )}

          {(agentsQuery.status === 'error' || providersQuery.status === 'error') && !held && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-danger-strong" role="alert">
              <span>Configured owner Agent/provider choices could not be loaded.</span>
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => { invalidate(keys.workerAgents); invalidate(keys.providers) }}
              >
                Retry
              </button>
            </div>
          )}
          {agentsQuery.status !== 'error' && providersQuery.status !== 'error' && applicable.length > 0 && !chosenSelection && !held && (
            <p className="mt-2 text-[12px] text-ink-faint">Choose a Delegation whose owner Agent is bound to a configured endpoint provider.</p>
          )}
        </div>
      )}
    </section>
  )
}

function JudgmentRunCard({ run, owner }: { run: DelegatedJudgmentRun; owner: boolean }) {
  const face = statusFace[run.status]
  const Icon = face.icon
  return (
    <article
      className="min-w-0 overflow-hidden rounded-lg border border-line bg-canvas px-3 py-2.5 [overflow-wrap:anywhere]"
      data-delegated-judgment-status={run.status}
      data-delegated-judgment-run-id={run.id}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className={`inline-flex items-center gap-1 font-semibold ${face.tone}`}>
          <Icon size={13} aria-hidden="true" /> {face.label}
        </span>
        <span className="min-w-0 break-words text-ink-faint">
          {run.reviewer} · {run.provider} · {run.model} · {run.actKind} · {run.mode} · policy v{run.delegationRevision} · changeset {versionLabel(run.changesetVersion)} · envelope {versionLabel(run.envelopeVersion)}
        </span>
        <time className="ml-auto max-w-full break-words text-ink-faint">{new Date(run.finishedAt ?? run.startedAt).toLocaleString()}</time>
      </div>
      {run.status === 'pending' && <p className="mt-2 text-[12px] text-ink-faint">This durable attempt is pending. It will not be started again automatically.</p>}
      {run.status === 'uncertain' && <p className="mt-2 text-[12px] text-warn-text">The provider outcome was not confirmed. No automatic retry will run. A new judgment is a separate paid request.</p>}
      {run.status === 'failed' && <p className="mt-2 text-[12px] text-warn-text">No valid decision was recorded. Provider usage may still have been charged; this is not a pass.</p>}
      {run.status === 'stale' && <p className="mt-2 text-[12px] text-ink-faint">The authority or Contribution changed while this run was in progress. It does not apply to current work.</p>}
      {run.summary && owner && <p className="mt-2 break-words whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{run.summary}</p>}
    </article>
  )
}

function versionLabel(version: number | null): string {
  return version == null ? 'none' : `v${version}`
}

function reviewerBudgetLabel(
  agent: { budget?: { windows: Array<{ ceiling: number; label: string }> } },
  provider: { plan?: { windows: Array<{ ceiling: number; label: string }> } },
): string {
  const budget = agent.budget ?? provider.plan
  if (budget?.windows.length) {
    return `Reviewer token budget: ${budget.windows.map((window) => `${window.ceiling.toLocaleString()} / ${window.label}`).join(' · ')}.`
  }
  return agent.budget
    ? 'This Agent has no token window configured; the account plan still applies.'
    : 'This Agent inherits the provider plan; the account plan still applies.'
}
