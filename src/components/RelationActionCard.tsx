import { useState } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  Bot,
  Check,
  Cpu,
  FilePlus2,
  FolderInput,
  Gauge,
  Link2,
  Plug,
  Repeat,
  ScrollText,
  Sparkles,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { describeOp, opKey, type RelationOp } from '../data/relations'
import { useRelations } from '../controller/useRelations'
import { SECTION_LABELS } from '../lib/nav'
import { renderRich } from '../lib/rich'

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
 *  approval ("approve for all runs") that then executes unprompted. */
export function RelationActionCard({ ops }: { ops: RelationOp[] }) {
  const { applyOp, navigate, isStandingApproved } = useRelations()
  const [done, setDone] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState<Set<string>>(new Set())

  const confirm = (op: RelationOp) => {
    applyOp(op)
    setDone((prev) => new Set(prev).add(opKey(op)))
  }
  const skip = (key: string) => setSkipped((prev) => new Set(prev).add(key))

  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-line bg-panel-2/30 shadow-sm">
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
          // A standing approval lives in the store, so an already-approved
          // recurring op renders as done even in a freshly-mounted card —
          // "approved once, then unprompted" holds across re-proposals.
          const isDone = done.has(key) || (standing && isStandingApproved(key))
          const isSkipped = skipped.has(key)
          const cadence = 'cadence' in op ? op.cadence : ''

          return (
            <div key={key} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                    isDone ? 'bg-emerald-50 text-emerald-600' : 'bg-surface text-ink-soft'
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
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                      <Repeat size={11} />
                      Runs on {cadence} — approved once, then unprompted
                    </div>
                  )}
                  {isDone && standing && (
                    <div className="mt-0.5 text-[11px] text-ink-faint">Approved for all runs · runs unprompted</div>
                  )}
                </div>
              </div>

              {/* The confirmation controls — the prompt itself. */}
              {!isDone && !isSkipped && (
                <div className="flex items-center gap-2 pl-[34px]">
                  <button
                    onClick={() => confirm(op)}
                    className="rounded-lg bg-accent px-2.5 py-1 text-[12px] font-semibold text-white shadow-sm transition hover:bg-accent-strong"
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
