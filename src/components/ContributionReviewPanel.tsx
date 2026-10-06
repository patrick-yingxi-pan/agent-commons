import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, RotateCw, ShieldCheck } from 'lucide-react'
import type { Contribution } from '../../contract/contributions.ts'
import type { ContributionReviewRun } from '../../contract/contributionReview.ts'
import type { Project } from '../../contract/cowork.ts'
import { useAgents, useMe, useProviders } from '../api/hooks.ts'
import { invalidate } from '../api/cache.ts'
import { keys } from '../api/keys.ts'
import { SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { contributionReviewSelections } from '../lib/contributionReviewSelection.ts'
import {
  enqueueContributionReview,
  heldContributionReviewIntent,
  isContributionReviewHeld,
} from '../controller/contributionReviewMutations.ts'

const statusFace: Record<ContributionReviewRun['status'], { label: string; icon: typeof CheckCircle2; tone: string }> = {
  pending: { label: 'Review running', icon: Clock, tone: 'text-ink-soft' },
  passed: { label: 'Passed', icon: CheckCircle2, tone: 'text-ok-strong' },
  findings: { label: 'Findings', icon: AlertCircle, tone: 'text-warn-strong' },
  failed: { label: 'Failed', icon: AlertCircle, tone: 'text-danger-strong' },
  uncertain: { label: 'Outcome uncertain', icon: AlertCircle, tone: 'text-warn-strong' },
  stale: { label: 'Stale review', icon: RotateCw, tone: 'text-ink-faint' },
}

export function ContributionReviewPanel({
  project,
  contribution,
  latestVersion,
  lifecycleHeld,
}: {
  project: Project
  contribution: Contribution
  latestVersion: number
  lifecycleHeld: boolean
}) {
  const identity = useMe().data
  const agentsQuery = useAgents()
  const providersQuery = useProviders()
  const [agentId, setAgentId] = useState('')
  const agents = agentsQuery.data ?? []
  const providers = providersQuery.data ?? []
  const choices = useMemo(
    () => contributionReviewSelections(agents, providers, identity?.tenant.id),
    [agents, providers, identity?.tenant.id],
  )
  const held = heldContributionReviewIntent(project.id, contribution.id)
  const reviewHeld = isContributionReviewHeld(project.id, contribution.id)
  const selected = choices.find((choice) => choice.agent.id === (held?.reviewer.agentId ?? agentId))
  const currentReviews = (contribution.reviews ?? []).filter((review) => review.version === latestVersion)
  const reviewRuns = contribution.reviews ?? []
  const pending = (contribution.reviews ?? []).some((review) => review.status === 'pending')
  const uncertain = currentReviews.some((review) => review.status === 'uncertain')
  const canReview = project.own !== false && contribution.status === 'open' && latestVersion > 0
  const showComposer = canReview

  const runReview = () => {
    if (!selected || !identity || lifecycleHeld || reviewHeld || pending) return
    void enqueueContributionReview({
      tenantId: identity.tenant.id,
      projectId: project.id,
      contributionId: contribution.id,
      expectedVersion: latestVersion,
      reviewer: {
        agentId: selected.agent.id,
        agentRevision: selected.agent.revision ?? 0,
        providerId: selected.provider.id,
        providerRevision: selected.provider.definitionRevision ?? 0,
        connectionRevision: selected.provider.connectionRevision ?? 0,
      },
      reviewerLabel: selected.agent.label,
      providerLabel: selected.provider.label,
      modelLabel: selected.modelLabel,
      budgetLabel: reviewerBudgetLabel(selected.agent, selected.provider),
    })
  }

  if (!showComposer && reviewRuns.length === 0) return null

  return (
    <section className="mt-5 rounded-xl border border-line bg-surface px-4 py-3" aria-label="Model reviews">
      <div className="flex items-start gap-2.5">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-ink">Model reviews</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
            Reviews are separate from the Contribution discussion. They cannot use Agent tools or land changes automatically.
          </p>
        </div>
      </div>

      {reviewRuns.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {[...(contribution.reviews ?? [])].sort((a, b) => b.startedAt - a.startedAt).map((review) => (
            <ReviewRunCard key={review.id} review={review} contribution={contribution} />
          ))}
        </div>
      )}

      {showComposer && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="min-w-[190px] flex-1 text-[12px] font-medium text-ink-soft">
              Reviewing Agent
              <select
                aria-label="Reviewing Agent"
                value={held?.reviewer.agentId ?? agentId}
                onChange={(event) => setAgentId(event.target.value)}
                disabled={Boolean(held) || lifecycleHeld || pending || choices.length === 0}
                className="mt-1 block w-full min-w-0 max-w-full rounded-md border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink disabled:opacity-60"
              >
                <option value="">Choose an Agent…</option>
                {held && !choices.some((choice) => choice.agent.id === held.reviewer.agentId) && (
                  <option value={held.reviewer.agentId}>{held.reviewerLabel} · held selection</option>
                )}
                {choices.map(({ agent }) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={runReview}
              disabled={!selected || !identity || lifecycleHeld || reviewHeld || pending}
              className={`${SOFT_BUTTON_CLASS} min-w-0 max-w-full whitespace-normal break-words px-3 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-45`}
            >
              {reviewHeld ? 'Reviewing…' : uncertain ? 'Run another review · uses budget again' : 'Run review · uses budget'}
            </button>
          </div>

          {held ? (
            <p className="mt-2 min-w-0 text-[12px] leading-relaxed text-ink-faint [overflow-wrap:anywhere]">
              Reviewing v{held.expectedVersion} with {held.reviewerLabel} · {held.providerLabel} · {held.modelLabel}. The initiating Project owner’s budget is charged for provider usage. {held.budgetLabel}
            </p>
          ) : selected ? (
            <p className="mt-2 min-w-0 text-[12px] leading-relaxed text-ink-faint [overflow-wrap:anywhere]">
              This will review frozen version v{latestVersion} using {selected.agent.label} · {selected.provider.label} · {selected.modelLabel}. The initiating Project owner’s budget is charged for provider usage.{' '}
              {reviewerBudgetLabel(selected.agent, selected.provider)}
            </p>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
              {agentsQuery.status === 'loading' || providersQuery.status === 'loading'
                ? 'Checking available owner/shared Agents and configured endpoint models…'
                : choices.length === 0
                  ? 'No eligible reviewer is available. Choose an owner/shared Agent bound to a configured endpoint provider.'
                  : 'Choose the Agent that will review the currently visible changeset.'}
            </p>
          )}
          {pending && !reviewHeld && (
            <p role="status" className="mt-2 text-[12px] text-ink-soft">
              A review is still pending. Wait for its result before starting another paid review.
            </p>
          )}
          {(agentsQuery.status === 'error' || providersQuery.status === 'error') && !held && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-danger-strong" role="alert">
              <span>Reviewer choices could not be loaded.</span>
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => { invalidate(keys.workerAgents); invalidate(keys.providers) }}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function reviewerBudgetLabel(agent: { budget?: { windows: Array<{ ceiling: number; label: string }> } }, provider: { plan?: { windows: Array<{ ceiling: number; label: string }> } }): string {
  const budget = agent.budget ?? provider.plan
  if (budget?.windows.length) {
    return `Reviewer token budget: ${budget.windows.map((window) => `${window.ceiling.toLocaleString()} / ${window.label}`).join(' · ')}.`
  }
  return agent.budget
    ? 'This Agent has no token window configured; the account plan still applies.'
    : 'This Agent inherits the provider plan; the account plan still applies.'
}

function ReviewRunCard({ review, contribution }: { review: ContributionReviewRun; contribution: Contribution }) {
  const face = statusFace[review.status] ?? statusFace.uncertain
  const Icon = face.icon
  const version = contribution.changeset?.find((candidate) => candidate.version === review.version)
  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-line bg-canvas px-3 py-2.5 [overflow-wrap:anywhere]" data-review-status={review.status}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className={`inline-flex items-center gap-1 font-semibold ${face.tone}`}>
          <Icon size={13} aria-hidden="true" /> {face.label}
        </span>
        <span className="min-w-0 break-words text-ink-faint">v{review.version} · {review.reviewer} · {review.provider} · {review.model}</span>
        <time className="ml-auto max-w-full break-words text-ink-faint">{new Date(review.finishedAt ?? review.startedAt).toLocaleString()}</time>
      </div>
      {review.status === 'uncertain' && (
        <p className="mt-2 break-words text-[12px] text-warn-text">The provider outcome was not confirmed. This is not a passing review; no retry happens automatically, and another run uses the Project owner’s budget again.</p>
      )}
      {review.status === 'failed' && <p className="mt-2 break-words text-[12px] text-warn-text">No valid verdict was recorded. Provider usage may still have been charged; this does not pass the review gate.</p>}
      {review.status === 'stale' && <p className="mt-2 break-words text-[12px] text-ink-faint">The Contribution changed or closed while this review ran. This result does not pass the current review gate.</p>}
      {review.summary && <p className="mt-2 break-words whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{review.summary}</p>}
      {!!review.findings?.length && (
        <ul className="mt-2 space-y-2">
          {review.findings.map((finding, index) => {
            const entry = version?.entries.find((candidate) => candidate.id === finding.entryId)
            return (
              <li key={`${finding.entryId}-${index}`} className="min-w-0 break-words border-l-2 border-warn-strong/35 pl-2.5 text-[12px] leading-relaxed text-ink-soft">
                <span className="font-medium text-ink">{entry?.target ?? 'Changeset entry'}</span>
                <span className="block break-words whitespace-pre-wrap">{finding.body}</span>
              </li>
            )
          })}
        </ul>
      )}
    </article>
  )
}
