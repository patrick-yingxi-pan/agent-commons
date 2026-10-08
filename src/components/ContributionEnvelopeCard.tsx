import { Fragment, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import type { ContributionEffectRun } from '../../contract/contributionExecution.ts'
import {
  CONTRIBUTION_FIELD_MAX,
  EFFECT_ENVELOPE_CARDINALITY_MAX,
  EFFECT_ENVELOPE_LINE_MAX,
  PROJECT_EFFECT_TYPES,
  type Contribution,
  type ContributionMcpSelection,
  type EnvelopeHarness,
  type Identity,
  type ProjectEffectType,
  type ProposeEnvelopeRequest,
} from '../../contract/index.ts'
import type { Project } from '../data/cowork.ts'
import type {
  enqueueContributionEffectExecution,
  heldContributionEffectExecutionIntent,
} from '../controller/contributionEffectExecutionMutations.ts'
import type {
  enqueueContributionEnvelopeApproval,
  heldContributionEnvelopeApprovalIntent,
} from '../controller/contributionEnvelopeApprovalMutations.ts'
import type {
  enqueueContributionEnvelopeProposal,
  heldContributionEnvelopeProposalIntent,
} from '../controller/contributionEnvelopeProposalMutations.ts'
import { useMcpConnections } from '../api/mcpConnectionHooks.ts'
import { useContributionMcpEffectAttempt } from '../api/hooks.ts'
import {
  beginContributionMcpEffect,
  checkContributionMcpEffectReceipt,
  dismissContributionMcpEffectAttempt,
} from '../controller/contributionMcpEffectMutations.ts'
import type { ContributionMcpAttempt } from '../controller/contributionMcpEffectAttemptState.ts'
import {
  CONTRIBUTION_LEGACY_ENVELOPE_HARNESSES,
  contributionMcpChoiceKey,
  contributionMcpChoices,
  formatContributionMcpArguments,
  parseContributionMcpArguments,
  transitionContributionEffectDraftType,
} from '../lib/contributionMcpDraft.ts'
import { relativeTime } from '../lib/relativeTime.ts'
import {
  CONTRIBUTION_EFFECT_DISCLOSURE_CLASS,
  CONTRIBUTION_EFFECT_DISCLOSURE_HEADING_CLASS,
  CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS,
} from '../lib/contributionEffectPresentation.ts'
import { SOFT_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

type EnvelopeDraftLine = Required<Omit<ProposeEnvelopeRequest['lines'][number], 'mcp'>> & {
  /** The public envelope deliberately hides connection identity; amendments
   * must select the caller-owned connection again before preserving a real call. */
  mcp?: ContributionMcpSelection
  mcpConnectionId: string
  mcpConnectionRevision: number | null
  mcpToolName: string
  mcpArgumentsText: string
}

const emptyEnvelopeDraftLine = (): EnvelopeDraftLine => ({
  type: 'connector.write',
  target: '',
  cardinality: 1,
  harness: 'draft-escrow',
  note: '',
  mcpConnectionId: '',
  mcpConnectionRevision: null,
  mcpToolName: '',
  mcpArgumentsText: '{}',
})

export function EnvelopeCard({
  project, c, lifecycleHeld, me, heldExecution, heldApproval, heldProposal,
  onRun, onApprove, onPropose,
}: {
  project: Project
  c: Contribution
  lifecycleHeld: boolean
  me: Identity | undefined
  heldExecution: ReturnType<typeof heldContributionEffectExecutionIntent>
  heldApproval: ReturnType<typeof heldContributionEnvelopeApprovalIntent>
  heldProposal: ReturnType<typeof heldContributionEnvelopeProposalIntent>
  onRun: typeof enqueueContributionEffectExecution
  onApprove: typeof enqueueContributionEnvelopeApproval
  onPropose: typeof enqueueContributionEnvelopeProposal
}) {
  const own = project.own !== false
  const mayAct = c.mine === true || own
  const env = c.envelope
  const mcpConnections = useMcpConnections()
  const mcpChoices = contributionMcpChoices(mcpConnections.data?.connections ?? [])
  const mcpAttempt = useContributionMcpEffectAttempt(project.id, c.id)
  const unresolvedMcpEffect = c.effects?.some((effect) => effect.status === 'pending') === true ||
    (mcpAttempt !== null && (mcpAttempt.state !== 'receipt' || mcpAttempt.receipt?.status === 'pending'))
  const [confirmMcpLineId, setConfirmMcpLineId] = useState<string | null>(null)
  const [confirmMcpIdentity, setConfirmMcpIdentity] = useState<string | null>(null)
  const confirmedCallMatches = (lineId: string): boolean => {
    const line = env?.lines.find((candidate) => candidate.id === lineId)
    const currentIdentity = line?.mcp && me
      ? JSON.stringify([me.user.id, me.tenant.id, env?.version, line.id, line.mcp.connectionLabel, line.mcp.toolName, line.mcp.arguments])
      : null
    return currentIdentity !== null && currentIdentity === confirmMcpIdentity
  }
  useEffect(() => {
    const receiptId = mcpAttempt?.receipt?.id
    if (receiptId && mcpAttempt?.receipt?.status !== 'pending' && c.effects?.some((receipt) => receipt.id === receiptId)) {
      dismissContributionMcpEffectAttempt(project.id, c.id)
    }
  }, [c.effects, c.id, mcpAttempt?.receipt?.id, mcpAttempt?.receipt?.status, project.id])
  const mayPropose = c.status === 'open' && (env?.status !== 'approved' || mayAct)
  const [composing, setComposing] = useState(false)
  const [draftBaseVersion, setDraftBaseVersion] = useState(0)
  const [draftLines, setDraftLines] = useState<EnvelopeDraftLine[]>([])
  const [error, setError] = useState<string | null>(null)
  // No envelope and nothing left to declare (landed) — nothing to show.
  if (!env && !mayPropose) return null

  const toggleComposer = () => {
    if (lifecycleHeld || unresolvedMcpEffect) return
    if (composing) {
      setComposing(false)
      return
    }
    setDraftBaseVersion(env?.version ?? 0)
    setDraftLines(
      env?.lines.map((line) => ({
        type: line.type,
        target: line.target,
        cardinality: line.cardinality,
        harness: line.harness,
        note: line.note,
        mcpConnectionId: '',
        mcpConnectionRevision: null,
        mcpToolName: line.mcp?.toolName ?? '',
        mcpArgumentsText: line.mcp ? formatContributionMcpArguments(line.mcp.arguments) : '{}',
      })) ?? [emptyEnvelopeDraftLine()],
    )
    setError(null)
    setComposing(true)
  }
  const updateDraftLine = (index: number, patch: Partial<EnvelopeDraftLine>) => {
    if (lifecycleHeld || unresolvedMcpEffect) return
    setDraftLines((current) => current.map((line, candidate) => candidate === index ? { ...line, ...patch } : line))
  }
  const propose = async () => {
    if (lifecycleHeld || unresolvedMcpEffect || !me || draftLines.length === 0) return
    const lines: ProposeEnvelopeRequest['lines'] = []
    for (const line of draftLines) {
      const { mcpConnectionId, mcpToolName, mcpArgumentsText, mcp: _oldPreview, ...wire } = line
      if (line.type === 'mcp.mutate') {
        const choice = mcpChoices.find((candidate) =>
          candidate.connection.id === mcpConnectionId && candidate.toolName === mcpToolName)
        const args = parseContributionMcpArguments(mcpArgumentsText)
        if (!choice) {
          setError('Choose a currently connected, admitted MCP tool for every real call.')
          return
        }
        if (line.mcpConnectionRevision === null || choice.connection.revision !== line.mcpConnectionRevision) {
          setError('The selected MCP connection changed. Choose the connection and tool again to review its current revision.')
          return
        }
        if (!args.ok) {
          setError(args.message)
          return
        }
        lines.push({
          ...wire,
          type: 'mcp.mutate',
          target: choice.toolName,
          cardinality: line.cardinality,
          harness: 'explicit-call',
          mcp: {
            connectionId: choice.connection.id,
            connectionRevision: line.mcpConnectionRevision,
            toolName: choice.toolName,
            arguments: args.value,
          },
        })
      } else {
        lines.push({
          ...wire,
          target: wire.target.trim().slice(0, CONTRIBUTION_FIELD_MAX),
          note: wire.note.trim().slice(0, CONTRIBUTION_FIELD_MAX),
        })
      }
    }
    if (lines.some((line) => !line.target)) return
    const coordinates = lines.map((line) => JSON.stringify([line.type, line.target, line.harness, line.note]))
    if (new Set(coordinates).size !== coordinates.length) {
      setError('Combine duplicate acts by increasing Max acts on one line.')
      return
    }
    setError(null)
    try {
      const outcome = await onPropose({
        tenantId: me.tenant.id,
        sourceUserId: me.via === 'session' ? me.user.id : null,
        projectId: project.id,
        contributionId: c.id,
        expectedVersion: draftBaseVersion,
        lines,
      })
      if (outcome === 'applied') {
        setDraftLines([])
        setComposing(false)
      } else {
        setError('Envelope proposal was dismissed. Your draft is still here for review.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare this envelope proposal for recovery.')
    }
  }
  const run = (lineId: string) => {
    if (lifecycleHeld || unresolvedMcpEffect || !me) return
    setError(null)
    void onRun({
      tenantId: me.tenant.id,
      projectId: project.id,
      contributionId: c.id,
      lineId,
    }).then((outcome) => {
      if (outcome === 'discarded') {
        setError('Effect execution was dismissed. Review the current envelope before trying again.')
      }
    })
  }
  const beginMcpRun = (lineId: string) => {
    if (!env || !me || lifecycleHeld || unresolvedMcpEffect || mcpAttempt || !confirmedCallMatches(lineId)) {
      if (confirmMcpLineId === lineId && !confirmedCallMatches(lineId)) {
        setConfirmMcpLineId(null)
        setConfirmMcpIdentity(null)
        setError('The approved call or signed-in account changed. Review the current saved call before confirming again.')
      }
      return
    }
    const line = env.lines.find((candidate) => candidate.id === lineId)
    if (!line?.mcp || line.mcp.canRun !== true) return
    beginContributionMcpEffect({
      tenantId: me.tenant.id,
      sourceUserId: me.via === 'session' ? me.user.id : null,
      projectId: project.id,
      contributionId: c.id,
      lineId,
      expectedVersion: env.version,
    })
    setConfirmMcpLineId(null)
    setConfirmMcpIdentity(null)
  }
  const approve = () => {
    if (lifecycleHeld || !me || !env) return
    setError(null)
    void onApprove({
      tenantId: me.tenant.id,
      sourceUserId: me.via === 'session' ? me.user.id : null,
      projectId: project.id,
      contributionId: c.id,
      envelopeVersion: env.version,
    }).then((outcome) => {
      if (outcome === 'discarded') {
        setError('Envelope approval was dismissed. Review the current version before trying again.')
      }
    })
  }

  return (
    <div
      data-contribution-envelope-version={env?.version ?? 0}
      className="mt-5 rounded-xl border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Effect envelope{env ? ` · v${env.version}` : ''}
        </div>
        <div className="flex items-center gap-1.5">
          {env &&
            (env.status === 'approved' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ok-strong/10 px-2 py-0.5 text-[11px] font-medium text-ok-text">
                <CheckCircle2 size={12} /> Approved by {env.approvedBy}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-warn-strong/10 px-2 py-0.5 text-[11px] font-medium text-warn-text">
                <AlertCircle size={12} /> Awaiting approval
              </span>
            ))}
          {env && env.status === 'proposed' && own && c.status === 'open' && (
            <button
              onClick={approve}
              disabled={lifecycleHeld}
              title="Approve this envelope as proposed. Real MCP calls still require a separate per-call confirmation."
              className={`${SOFT_BUTTON_CLASS} px-2.5 py-0.5 text-[11px] disabled:opacity-45`}
            >
              {heldApproval?.envelopeVersion === env.version ? 'Approving…' : 'Approve'}
            </button>
          )}
          {mayPropose && (
            <button
              onClick={toggleComposer}
              disabled={lifecycleHeld || unresolvedMcpEffect}
              title={unresolvedMcpEffect ? 'Resolve the saved MCP receipt before amending this envelope' : undefined}
              className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
            >
              {heldProposal ? 'Proposing…' : env ? 'Amend' : 'Declare effects'}
            </button>
          )}
        </div>
      </div>
      <p data-contribution-effect-disclosure className={`${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS} border-b border-line px-3 py-2`}>
        Development-fixture actions are simulation-only and refused in release profiles. Only explicitly confirmed MCP tool calls use the real execution path.
      </p>
      {env ? (
        env.lines.map((l) => (
          <Fragment key={l.id}>
          <div className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
            <div className="min-w-0 flex-1">
              <div className="break-words text-[13px] text-ink [overflow-wrap:anywhere]">
                {l.type} → <span className="font-medium">{l.target}</span>
              </div>
              <div className="break-words text-[11px] text-ink-faint [overflow-wrap:anywhere]">
                ≤{l.cardinality} · {l.harness}
                {l.note ? ` · ${l.note}` : ''}
                {!l.mcp ? ' · Development fixture' : ''}
              </div>
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
              {l.used}/{l.cardinality} used
            </span>
            {env.status === 'approved' && c.status === 'open' && !l.mcp && mayAct && (
              <button
                onClick={() => run(l.id)}
                disabled={lifecycleHeld || unresolvedMcpEffect || l.used >= l.cardinality}
                title={
                  l.used >= l.cardinality
                    ? 'Cardinality exhausted — amend the envelope for more'
                    : `Fire one ${l.type} act on ${l.target} (mechanically matched against this line)`
                }
                className={`shrink-0 ${SOFT_BUTTON_CLASS} px-2.5 py-0.5 text-[11px] disabled:opacity-45`}
              >
                {heldExecution?.lineId === l.id ? 'Running…' : 'Run'}
              </button>
            )}
            {env.status === 'approved' && c.status === 'open' && l.mcp?.canRun === true && (
              <button
                onClick={() => {
                  if (confirmMcpLineId === l.id && confirmedCallMatches(l.id)) {
                    setConfirmMcpLineId(null)
                    setConfirmMcpIdentity(null)
                    return
                  }
                  const currentIdentity = me
                    ? JSON.stringify([me.user.id, me.tenant.id, env.version, l.id, l.mcp?.connectionLabel, l.mcp?.toolName, l.mcp?.arguments])
                    : null
                  setConfirmMcpLineId(l.id)
                  setConfirmMcpIdentity(currentIdentity)
                  setError(null)
                }}
                disabled={lifecycleHeld || l.used >= l.cardinality || mcpAttempt !== null}
                title={l.used >= l.cardinality ? 'Cardinality exhausted — amend the envelope for more' : 'Review the exact call and confirm this one run'}
                className={`shrink-0 ${SOFT_BUTTON_CLASS} px-2.5 py-0.5 text-[11px] disabled:opacity-45`}
              >
                {mcpAttempt?.intent.lineId === l.id ? mcpAttempt.state === 'receipt' ? 'Receipt saved' : 'Checking run…' : 'Review & run'}
              </button>
            )}
          </div>
          {l.mcp && (
            <div className="border-b border-line bg-panel-2 px-3 py-2 last:border-b-0">
              <p data-contribution-effect-disclosure className={`break-words [overflow-wrap:anywhere] ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>
                Saved call · {l.mcp.connectionLabel} · {l.mcp.toolName}
              </p>
              <pre
                tabIndex={0}
                role="region"
                aria-label={`Approved arguments for ${l.mcp.toolName}`}
                className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-md border border-line bg-surface p-2 text-[11px] leading-relaxed text-ink-soft"
              >{formatContributionMcpArguments(l.mcp.arguments)}</pre>
              {env.status === 'approved' && c.status === 'open' && l.mcp.canRun !== true && (
                <p data-contribution-effect-disclosure className={`mt-1 ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>This call is available only to the exact connection owner with a role allowed to run it. Envelope approval alone never sends it.</p>
              )}
              {confirmMcpLineId === l.id && confirmedCallMatches(l.id) && l.mcp.canRun === true && !mcpAttempt && (
                <div role="group" aria-label="Confirm one MCP effect run" className="mt-2 rounded-lg border border-warn-strong/40 bg-warn-strong/5 p-2.5">
                  <p className={CONTRIBUTION_EFFECT_DISCLOSURE_HEADING_CLASS}>Review this exact external call</p>
                  <p data-contribution-effect-disclosure className={`mt-1 ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>
                    Confirming sends these arguments to the selected MCP tool once. The arguments and returned result will be visible to every Project reader; credentials stay private. Envelope approval alone never sends this call.
                  </p>
                  <p data-contribution-effect-disclosure className={`mt-1 font-medium ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>This is a new call. If an earlier result is unknown, running again may duplicate its effects.</p>
                  <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                    <button onClick={() => setConfirmMcpLineId(null)} className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[11px]`}>Cancel</button>
                    <button onClick={() => beginMcpRun(l.id)} className={`${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[11px]`}>Confirm and run once</button>
                  </div>
                </div>
              )}
            </div>
          )}
          </Fragment>
        ))
      ) : (
        <p className="px-3 py-2 text-[12px] text-ink-faint">
          No external acts declared. If this work needs to send, charge, or reach outside the project,
          declare the envelope <em>before</em> acting — approval happens here, not after the fact.
        </p>
      )}
      {c.effects?.map((receipt) => <ContributionMcpEffectReceipt key={receipt.id} receipt={receipt} />)}
      {mcpAttempt && !(mcpAttempt.receipt && mcpAttempt.receipt.status !== 'pending' && c.effects?.some((receipt) => receipt.id === mcpAttempt.receipt?.id)) && (
        <ContributionMcpEffectAttemptPanel
          attempt={mcpAttempt}
          showReceipt={!mcpAttempt.receipt || !c.effects?.some((receipt) => receipt.id === mcpAttempt.receipt?.id)}
          onCheck={() => void checkContributionMcpEffectReceipt(project.id, c.id)}
          onDismiss={() => dismissContributionMcpEffectAttempt(project.id, c.id)}
        />
      )}
      {heldProposal ? (
        <div
          data-contribution-envelope-proposal-draft
          aria-busy="true"
          className="space-y-2 border-t border-line px-3 py-2"
        >
          <p className="text-[11px] text-ink-faint">
            Proposing v{heldProposal.expectedVersion + 1} as one exact envelope — all acts stay frozen until acknowledgement.
          </p>
          {heldProposal.lines.map((line, index) => (
            <div key={`${line.type}:${line.target}:${index}`} className="rounded-lg border border-line bg-panel-2 px-2.5 py-2">
              <div className="text-[12px] text-ink">
                {line.type} → <span className="font-medium">{line.target}</span>
              </div>
              <div className="text-[11px] text-ink-faint">
                ≤{line.cardinality ?? 1} · {line.harness ?? 'draft-escrow'}
                {line.note ? ` · ${line.note}` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : composing && (
        <div data-contribution-envelope-editor className="space-y-2 border-t border-line px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-ink-faint">
              Draft v{draftBaseVersion + 1}. A new version resets usage and needs fresh approval; repeated acts belong in Max acts.
            </p>
            <button
              onClick={() => setDraftLines((current) => [...current, emptyEnvelopeDraftLine()])}
              disabled={lifecycleHeld || unresolvedMcpEffect || draftLines.length >= EFFECT_ENVELOPE_LINE_MAX}
              className="rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-ink-soft transition enabled:hover:border-line-strong enabled:hover:text-ink disabled:opacity-45"
            >
              Add act
            </button>
          </div>
          {draftLines.map((line, index) => (
            <div key={index} className="rounded-lg border border-line bg-panel-2 px-2.5 py-2">
              <div
                data-contribution-envelope-fields
                className="grid gap-1.5"
                style={{ gridTemplateColumns: CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS }}
              >
                <label className="block min-w-0 text-[11px] font-medium text-ink-soft">
                  Effect type
                  <select
                    value={line.type}
                    onChange={(e) => {
                      const type = e.target.value as ProjectEffectType
                      updateDraftLine(index, {
                        ...transitionContributionEffectDraftType(line, type),
                        mcp: undefined,
                        mcpConnectionId: '',
                        mcpConnectionRevision: null,
                        mcpToolName: '',
                        mcpArgumentsText: '{}',
                      })
                    }}
                    disabled={lifecycleHeld || unresolvedMcpEffect}
                    aria-label={`Effect type ${index + 1}`}
                    className="mt-1 block w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
                  >
                    {PROJECT_EFFECT_TYPES.map((candidate) => (
                      <option key={candidate} value={candidate}>{candidate}</option>
                    ))}
                  </select>
                </label>
                {line.type !== 'mcp.mutate' && (
                  <label className="block min-w-0 text-[11px] font-medium text-ink-soft">
                    Target
                    <input
                      autoFocus={index === 0 && draftBaseVersion === 0}
                      value={line.target}
                      onChange={(e) => updateDraftLine(index, { target: e.target.value })}
                      maxLength={CONTRIBUTION_FIELD_MAX}
                      disabled={lifecycleHeld || unresolvedMcpEffect}
                      placeholder="Connector / descriptor…"
                      aria-label={`Effect target ${index + 1}`}
                      className="mt-1 block w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
                    />
                  </label>
                )}
                <label className="block min-w-0 text-[11px] font-medium text-ink-soft">
                  Max acts
                  <input
                    type="number"
                    min={1}
                    max={EFFECT_ENVELOPE_CARDINALITY_MAX}
                    value={line.cardinality}
                    onChange={(e) => updateDraftLine(index, { cardinality: Math.max(1, Math.min(EFFECT_ENVELOPE_CARDINALITY_MAX, Number(e.target.value) || 1)) })}
                    disabled={lifecycleHeld || unresolvedMcpEffect}
                    aria-label={`Max acts ${index + 1}`}
                    title="How many acts this line authorizes (≤)"
                    className="mt-1 block w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
                  />
                </label>
                {line.type !== 'mcp.mutate' && (
                  <label className="block min-w-0 text-[11px] font-medium text-ink-soft">
                    Harness
                    <select
                      value={line.harness}
                      onChange={(e) => updateDraftLine(index, { harness: e.target.value as EnvelopeHarness })}
                      disabled={lifecycleHeld || unresolvedMcpEffect}
                      aria-label={`Safety harness ${index + 1}`}
                      title="The containment this line runs under"
                      className="mt-1 block w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
                    >
                      {CONTRIBUTION_LEGACY_ENVELOPE_HARNESSES.map((candidate) => (
                        <option key={candidate} value={candidate}>{candidate}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block min-w-0 text-[11px] font-medium text-ink-soft">
                  Scope note (optional)
                  <input
                    value={line.note}
                    onChange={(e) => updateDraftLine(index, { note: e.target.value })}
                    maxLength={CONTRIBUTION_FIELD_MAX}
                    disabled={lifecycleHeld || unresolvedMcpEffect}
                    placeholder="Add a bounded scope note…"
                    aria-label={`Scope note ${index + 1}`}
                    className="mt-1 block w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
                  />
                </label>
                <button
                  onClick={() => setDraftLines((current) => current.filter((_, candidate) => candidate !== index))}
                  disabled={lifecycleHeld}
                  aria-label={`Remove effect ${index + 1}`}
                  title="Remove this act from the next envelope version"
                  className="mt-5 flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition enabled:hover:bg-removed-bg enabled:hover:text-removed disabled:opacity-45"
                >
                  <Trash2 size={13} />
                </button>
                {line.type === 'mcp.mutate' && (
                  <div className="col-span-full space-y-2 rounded-lg border border-warn-strong/30 bg-warn-strong/5 p-2.5">
                    <p data-contribution-effect-disclosure className={CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}>
                      This is a real, per-call MCP proposal. It will not run when proposed or approved. The exact arguments and saved result will be visible to every Project reader; credentials remain private.
                    </p>
                    <label className="block min-w-0 text-[11px] font-medium text-ink-soft">
                      Inspected MCP tool
                      <select
                        value={line.mcpConnectionId && line.mcpToolName ? contributionMcpChoiceKey(line.mcpConnectionId, line.mcpToolName) : ''}
                        onChange={(event) => {
                          const choice = mcpChoices.find((candidate) => contributionMcpChoiceKey(candidate.connection.id, candidate.toolName) === event.target.value)
                          updateDraftLine(index, choice ? {
                            mcpConnectionId: choice.connection.id,
                            mcpToolName: choice.toolName,
                            target: choice.toolName,
                            harness: 'explicit-call',
                            mcpConnectionRevision: choice.connection.revision,
                            mcp: undefined,
                          } : { mcpConnectionId: '', mcpConnectionRevision: null, mcpToolName: '', target: '', mcp: undefined })
                        }}
                        disabled={lifecycleHeld || unresolvedMcpEffect}
                        aria-label={`MCP tool ${index + 1}`}
                        className="mt-1 block w-full min-w-0 rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] text-ink focus:border-line-strong"
                      >
                        <option value="">Choose a connected, admitted tool…</option>
                        {mcpChoices.map((choice) => (
                          <option key={contributionMcpChoiceKey(choice.connection.id, choice.toolName)} value={contributionMcpChoiceKey(choice.connection.id, choice.toolName)}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {mcpConnections.status === 'error' && <p data-contribution-effect-disclosure className={`${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS} text-danger-text`}>Couldn’t load MCP connections. Refresh the page data before proposing this call.</p>}
                    {mcpConnections.status === 'loading' && <p data-contribution-effect-disclosure className={CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}>Loading inspected MCP tools…</p>}
                    {mcpConnections.status === 'success' && mcpChoices.length === 0 && (
                      <p data-contribution-effect-disclosure className={CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}>
                        No inspected MCP tools are available. Add and inspect a server in Contexts before proposing a real call.
                      </p>
                    )}
                    {line.mcpConnectionId && line.mcpToolName && (
                      <label className="block min-w-0 text-[11px] font-medium text-ink-soft">
                        Exact JSON arguments
                        <textarea
                          value={line.mcpArgumentsText}
                          onChange={(event) => updateDraftLine(index, { mcpArgumentsText: event.target.value })}
                          disabled={lifecycleHeld || unresolvedMcpEffect}
                          aria-label={`MCP arguments ${index + 1}`}
                          rows={5}
                          spellCheck={false}
                          className="mt-1 block min-h-24 w-full min-w-0 resize-y rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-line-strong"
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {draftLines.length === 0 && (
            <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-ink-faint">
              An envelope needs at least one act. Add one, or Cancel to keep the current version.
            </p>
          )}
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={() => setComposing(false)}
              disabled={lifecycleHeld}
              className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}
            >
              Cancel
            </button>
            <button
              onClick={() => void propose()}
              disabled={lifecycleHeld || unresolvedMcpEffect || !me || draftLines.length === 0 || draftLines.some((line) => !line.target.trim())}
              className={`${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px] disabled:opacity-45`}
            >
              Propose v{draftBaseVersion + 1}
            </button>
          </div>
        </div>
      )}
      {error && <p className="px-3 pb-2 text-[11px] text-danger-text">{error}</p>}
    </div>
  )
}

function ContributionMcpEffectAttemptPanel({
  attempt,
  showReceipt,
  onCheck,
  onDismiss,
}: {
  attempt: ContributionMcpAttempt
  showReceipt: boolean
  onCheck: () => void
  onDismiss: () => void
}) {
  const receipt = attempt.receipt
  const active = attempt.state === 'submitting' || attempt.state === 'checking'
  const unknown = attempt.state === 'uncertain' || receipt?.status === 'uncertain'
  const heading = receipt
    ? receipt.status === 'done' ? 'MCP call completed' : receipt.status === 'failed' ? 'MCP call refused' : receipt.status === 'uncertain' ? 'MCP outcome uncertain' : 'MCP call is pending'
    : attempt.state === 'submitting' ? 'Sending the confirmed call once…' : attempt.state === 'checking' ? 'Checking the saved receipt…' : 'Couldn’t confirm the call receipt.'

  return (
    <section aria-live={active ? 'polite' : undefined} className={`border-t border-line px-3 py-3 ${unknown ? 'bg-warn-strong/5' : 'bg-panel-2'}`} data-contribution-mcp-attempt={attempt.state}>
      <h3 className={CONTRIBUTION_EFFECT_DISCLOSURE_HEADING_CLASS}>{heading}</h3>
      {receipt && showReceipt ? (
        <ContributionMcpEffectReceipt receipt={receipt} />
      ) : receipt ? (
        <p data-contribution-effect-disclosure className={`mt-1 ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>The pending receipt is shown in the saved Project history above.</p>
      ) : (
        <p data-contribution-effect-disclosure className={`mt-1 ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>
          No matching saved receipt is visible yet. Do not send this call again. Check the Project ledger; if no receipt appears, dismiss this attempt and review the envelope before explicitly starting a new run.
        </p>
      )}
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {(attempt.state === 'uncertain' || attempt.state === 'pending' || receipt?.status === 'pending') && (
          <button onClick={onCheck} disabled={active} className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[11px] disabled:opacity-45`}>Check saved receipt</button>
        )}
        {!active && attempt.state !== 'pending' && receipt?.status !== 'pending' && (
          <button onClick={onDismiss} className={`${SECONDARY_BUTTON_CLASS} px-2.5 py-1 text-[11px]`}>
            {unknown ? 'Dismiss and review before a new run' : 'Close receipt'}
          </button>
        )}
      </div>
    </section>
  )
}

function ContributionMcpEffectReceipt({ receipt }: { receipt: ContributionEffectRun }) {
  const uncertain = receipt.status === 'uncertain'
  const pending = receipt.status === 'pending'
  return (
    <article
      data-contribution-effect-status={receipt.status}
      data-contribution-effect-id={receipt.id}
      aria-label={`Saved MCP effect receipt: ${receipt.toolName}, ${receipt.status}`}
      className={`border-t border-line px-3 py-3 ${uncertain ? 'bg-warn-strong/5' : 'bg-panel-2'}`}
    >
      <h3 className={CONTRIBUTION_EFFECT_DISCLOSURE_HEADING_CLASS}>
        {receipt.status === 'done' ? 'MCP call completed' : receipt.status === 'failed' ? 'MCP call refused' : uncertain ? 'MCP outcome uncertain' : 'MCP call pending'}
      </h3>
      <p data-contribution-effect-disclosure className={`mt-1 break-words [overflow-wrap:anywhere] ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>{receipt.connectionLabel} · {receipt.toolName} · {receipt.status}</p>
      <p data-contribution-effect-disclosure className={`mt-1 break-words [overflow-wrap:anywhere] ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>
        <time dateTime={new Date(receipt.startedAt).toISOString()} title={new Date(receipt.startedAt).toISOString()}>
          v{receipt.envelopeVersion} · by {receipt.actor} · {relativeTime(receipt.startedAt)}
        </time>
      </p>
      <p data-contribution-effect-disclosure className={`mt-2 font-medium ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>Exact arguments · visible to Project readers</p>
      <pre
        tabIndex={0}
        role="region"
        aria-label={`Arguments for ${receipt.toolName}`}
        className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-md border border-line bg-surface p-2 text-[11px] leading-relaxed text-ink-soft"
      >{formatContributionMcpArguments(receipt.arguments)}</pre>
      {receipt.result && (
        <>
          <p data-contribution-effect-disclosure className={`mt-2 font-medium ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>Saved result · visible to Project readers</p>
          <pre
            tabIndex={0}
            role="region"
            aria-label={`Saved result for ${receipt.toolName}`}
            className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-md border border-line bg-surface p-2 text-[11px] leading-relaxed text-ink-soft"
          >{JSON.stringify(receipt.result, null, 2)}</pre>
        </>
      )}
      {receipt.status === 'failed' && receipt.result && (
        <p data-contribution-effect-disclosure className={CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}>The tool returned an error; some outside effects may still have occurred.</p>
      )}
      {uncertain && (
        <p data-contribution-effect-disclosure className={CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}>This receipt is terminal. The call will not be repeated automatically.</p>
      )}
      {pending && <p data-contribution-effect-disclosure className={`mt-1 ${CONTRIBUTION_EFFECT_DISCLOSURE_CLASS}`}>Amendment and landing remain unavailable until this receipt settles.</p>}
    </article>
  )
}
