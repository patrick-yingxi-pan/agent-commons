import { useState } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  FilePlus2,
  FolderInput,
  Gauge,
  Link2,
  Plug,
  Repeat,
  RotateCcw,
  ScrollText,
  Sparkles,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { describeOp, opKey, relationContentPreview, type RelationContentPreview, type RelationOp } from '../data/relations'
import { useRelations } from '../controller/useRelations'
import { useSessionContextCommands } from '../controller/useSessionContextCommands'
import { retryContextMutation } from '../controller/contextMutations'
import { useConversation } from '../controller/conversationStore'
import { recordRelationVerdict } from '../controller/relationMutations'
import { SOFT_BUTTON_CLASS } from '../lib/button'
import { DRAFT_ID } from '../data/liveSession'
import { SECTION_LABELS } from '../lib/nav'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { renderRich } from '../lib/rich'
import { TextDiff } from './TextDiff'
import { InlineOperationStatus } from './InlineOperationStatus'
import { Spinner } from './Spinner'

/** The lead glyph for an op, by the relationship it edits. */
const RELATION_ICON: Record<string, LucideIcon> = {
  'session-project': FolderInput,
  'project-artifact': FolderInput,
  'session-artifact': FilePlus2,
  'session-context': Plug,
  'project-context': Plug,
  'project-schedule': Link2,
  'artifact-context': Link2,
  'session-schedule': Repeat,
  'artifact-schedule': Repeat,
  'context-schedule': Repeat,
  // Agent Commons CRUD (D6/D9/D10/D7) — managed through the same card.
  'agent-provider': Cpu,
  'agent-prompt': ScrollText,
  'agent-worker': Bot,
  'agent-commission': UserPlus,
  'session-agent': ArrowLeftRight, // D16 — hand a Conversation off to another Agent
  'agent-commission-cap': Gauge, // D13 — set a Project's per-commissioner abuse cap
}

/** The inline confirmation prompt: Claude proposes one or more relation edits,
 *  and the user confirms (or declines) each, right inside the conversation.
 *  Per-action edits confirm one-off; a recurring schedule's effect is a standing
 *  approval ("approve for all runs") that then executes unprompted.
 *
 *  A resolution is HISTORY, so it lives on the record: when the card knows its
 *  message (`sessionId` + `messageId`), each confirm / "not now" also writes the
 *  verdict to the message (`relationsResolved`, keyed by `opKey`) — the graph
 *  derivation alone reads the CURRENT relation, so a later op that moves it on
 *  (refile elsewhere, a newer filing) flipped an already-confirmed card back to
 *  pending on reload. The verdict can't be un-happened by later edits. */
export function RelationActionCard({
  ops,
  sessionId,
  messageId,
  resolved,
}: {
  ops: RelationOp[]
  /** The message the proposal rode in on — enables the persisted verdict. */
  sessionId?: string
  messageId?: string
  /** The persisted verdicts (`Message.relationsResolved`), when loaded. */
  resolved?: Record<string, 'confirmed' | 'skipped'>
}) {
  const {
    applyOp,
    mutation,
    retryMutation,
    discardMutation,
    navigate,
    isStandingApproved,
    appliedInGraph,
    descriptionForProject,
    instructionsForProject,
  } = useRelations()
  // An attach-context op attaches to THIS card's session (the message it rode
  // in on names it) through the session-parametric funnel — the pre-split root
  // bridge attached to "the active session", an authority the equal-panes model
  // dissolved (universal split Phase 6). A card always rides a real message,
  // so sessionId is present in practice; DRAFT_ID only anchors the hook call.
  const { addContext } = useSessionContextCommands(sessionId ?? DRAFT_ID)
  const contextMutation = useConversation(sessionId ?? DRAFT_ID).contextMutation
  const [done, setDone] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [decisions, setDecisions] = useState<Record<string, { verdict: 'confirmed' | 'skipped'; error?: string }>>({})

  const clearDecision = (key: string) => {
    setDecisions((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }
  const persistVerdict = (key: string, verdict: 'confirmed' | 'skipped') => {
    setDecisions((current) => ({ ...current, [key]: { verdict } }))
    const committed = () => {
      if (verdict === 'confirmed') setDone((current) => new Set(current).add(key))
      else setSkipped((current) => new Set(current).add(key))
      clearDecision(key)
    }
    if (!sessionId || !messageId) {
      committed()
      return
    }
    void recordRelationVerdict(sessionId, messageId, key, verdict).then(committed, () => {
      setDecisions((current) => ({
        ...current,
        [key]: { verdict, error: 'Couldn’t record your decision. Retry when the connection recovers.' },
      }))
    })
  }
  const confirm = (op: RelationOp) => {
    const key = opKey(op)
    setDecisions((current) => ({ ...current, [key]: { verdict: 'confirmed' } }))
    let result: Promise<'applied' | 'discarded'>
    if (op.kind === 'attach-context' && sessionId) {
      result = addContext({ kind: op.connectorKind === 'mcp' ? 'mcp' : 'connector', connector: { id: op.connectorId, label: op.connectorLabel, kind: op.connectorKind } })
    } else {
      result = applyOp(op)
    }
    void result.then((outcome) => {
      if (outcome === 'applied') persistVerdict(key, 'confirmed')
      else clearDecision(key)
    })
  }
  const skip = (key: string) => {
    persistVerdict(key, 'skipped')
  }

  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-panel-2/30">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <Sparkles size={13} className="text-accent" />
        Proposed changes
        <span className="font-normal normal-case tracking-normal text-ink-faint">· approve to apply</span>
      </div>

      <div className="divide-y divide-line">
        {ops.map((op) => {
          const key = opKey(op)
          const desc = describeOp(op)
          const Icon = RELATION_ICON[desc.relationId] ?? Link2
          const standing = desc.approval === 'standing'
          const decision = decisions[key]
          // A standing approval lives in the store, so an already-approved
          // recurring op renders as done even in a freshly-mounted card —
          // "approved once, then unprompted" holds across re-proposals. One-off
          // ops derive the same remount-proof state from the GRAPH (the record of
          // what was applied): a reopened thread must not re-offer a confirmed
          // edit as pending. Non-derivable ops keep the in-memory fallback.
          // The persisted verdict (the record of what the user resolved) wins over
          // the graph derivation (the current relation): a confirmed edit stays
          // confirmed after reloads AND after later ops move the relation on.
          const isDone =
            resolved?.[key] === 'confirmed' ||
            done.has(key) ||
            (!decision && ((standing && isStandingApproved(key)) || appliedInGraph(op) === true))
          const isSkipped = !isDone && (resolved?.[key] === 'skipped' || skipped.has(key))
          const effectFailure =
            decision?.verdict === 'confirmed'
              ? op.kind === 'attach-context'
                ? contextMutation.error
                : mutation.failedKey === key
                  ? mutation.error
                  : null
              : null
          const decisionFailure = decision?.error ?? effectFailure
          const cadence = 'cadence' in op ? op.cadence : ''
          // S2 — for a content-bearing op (description / instructions / prompt / agent /
          // project body), the actual text being written, so consent isn't given blind.
          const preview = relationContentPreview(op, descriptionForProject, instructionsForProject)

          return (
            <div key={key} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                    isDone ? 'bg-ok-tint text-ok-strong' : 'bg-surface text-ink-soft'
                  }`}
                >
                  {isDone ? <Check size={14} /> : <Icon size={14} />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-snug text-ink-soft">
                    {isDone ? (
                      <span className="font-medium text-ink">{desc.done}</span>
                    ) : (
                      renderRich(desc.text)
                    )}
                  </div>

                  {standing && !isDone && !isSkipped && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-warn-tint px-1.5 py-0.5 text-[11px] font-medium text-warn-text">
                      <Repeat size={11} />
                      Runs on {cadence} — approved once, then unprompted
                    </div>
                  )}
                  {isDone && standing && (
                    <div className="mt-0.5 text-[11px] text-ink-faint">Approved for all runs · runs unprompted</div>
                  )}
                </div>
              </div>

              {/* S2 — see the text you're approving BEFORE you approve it (default
                  collapsed so the card stays scannable). */}
              {preview && !isDone && !isSkipped && <ProposedBody preview={preview} />}

              {/* The confirmation controls — the prompt itself. */}
              {!isDone && !isSkipped && !decision && (
                <div className="flex items-center gap-2 pl-[34px]">
                  <button
                    onClick={() => confirm(op)}
                    className={`${SOFT_BUTTON_CLASS} px-2.5 py-1 text-[12px]`}
                  >
                    {standing ? 'Approve for all runs' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => skip(key)}
                    className="rounded-lg px-2 py-1 text-[12px] font-medium text-ink-faint transition hover:text-ink-soft"
                  >
                    Not now
                  </button>
                </div>
              )}

              {!isDone && !isSkipped && decision && (
                <div className="pl-[22px]">
                  {decisionFailure ? (
                    <InlineOperationStatus
                      tone="alert"
                      message={decisionFailure}
                      action={{
                        label:
                          decision.error || op.kind === 'attach-context' || mutation.retryable
                            ? 'Retry'
                            : 'Dismiss',
                        icon:
                          decision.error || op.kind === 'attach-context' || mutation.retryable
                            ? <RotateCcw size={12} />
                            : <X size={12} />,
                        onClick: () => {
                          if (decision.error) persistVerdict(key, decision.verdict)
                          else if (op.kind === 'attach-context' && sessionId) retryContextMutation(sessionId)
                          else if (mutation.retryable) retryMutation()
                          else discardMutation()
                        },
                      }}
                      secondaryAction={
                        !decision.error && op.kind !== 'attach-context' && mutation.retryable
                          ? { label: 'Dismiss', icon: <X size={12} />, onClick: discardMutation }
                          : undefined
                      }
                    />
                  ) : (
                    <InlineOperationStatus
                      tone="status"
                      message={decision.verdict === 'confirmed' ? 'Applying change…' : 'Recording “Not now”…'}
                      leading={<Spinner size={12} />}
                    />
                  )}
                </div>
              )}

              {isDone && desc.section && (
                <button
                  onClick={() => navigate(desc.section!, desc.projectId)}
                  className="ml-[34px] inline-flex w-fit items-center gap-1 text-[12px] font-medium text-accent-strong transition hover:gap-1.5"
                >
                  View in {SECTION_LABELS[desc.section]}
                  <ArrowRight size={13} />
                </button>
              )}

              {isSkipped && (
                <div className="ml-[34px] inline-flex items-center gap-1 text-[12px] text-ink-faint">
                  <X size={12} />
                  Not now — nothing changed
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The default-collapsed disclosure that reveals the body a content-bearing op would
 *  write (S2) — an old→new diff when there's a current value (description / instructions),
 *  the proposed body alone for a create. Uses the shared TextDiff primitive so the diff
 *  cue matches the change-proposal review. */
function ProposedBody({ preview }: { preview: RelationContentPreview }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pl-[34px]">
      <button onClick={() => setOpen((v) => !v)} className={INLINE_ACTION_CLASS} aria-expanded={open}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {open ? 'Hide' : 'Review'} {preview.label}
      </button>
      {open && <TextDiff current={preview.current} proposed={preview.proposed} />}
    </div>
  )
}
