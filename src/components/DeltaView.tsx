/** ── The DeltaView registry (social S3) ──────────────────────────────────────
 *  One proposal delta, rendered by kind — the per-kind half of the otherwise
 *  kind-generic Proposal primitive (`docs/design/social-layer.md` §3.1: "renders
 *  a proposal's delta per kind — diff / op card / before-after / fork chip").
 *
 *  ONE home, because there were two. The Improvements panel and the project's
 *  merged Changes panel each rendered a delta inline, by hand, and they had
 *  already drifted: one labelled EVERY row "routine change", including graph
 *  edits and prose suggestions. A third kind would have been a third divergence,
 *  so the renderings are unified here first (the form-follows-function rule —
 *  same role, same look, one primitive) and every caller reads this.
 *
 *  The switch is exhaustive over `ProposalDelta`: a new delta kind is a compile
 *  error here, which is the point — a kind that lands a real change must decide
 *  how a reviewer SEES it in the same edit that teaches the server to apply it. */
import type { ProposalDelta, SocialProposal } from '../../contract/index.ts'
import { describeOp, describeSchedulePatch } from '../../contract/index.ts'

/** The kind cue every delta row leads with — the same chip shape across kinds,
 *  so the label is the only thing that varies. */
function DeltaTag({ children }: { children: string }) {
  return (
    <span className="mr-1.5 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-faint">{children}</span>
  )
}

/** A prose before→after, in the diff language the code panel already speaks
 *  (the semantic added/removed ramps). Wrapped rather than monospaced: an
 *  artifact block is prose, and a reviewer reads it as prose.
 *
 *  The base is the server's serve-time answer (`SocialProposal.deltaBase`) — what
 *  landing would ACTUALLY replace, not what the text said when it was offered.
 *  Absent means the address stopped resolving, so the after-line stands alone
 *  rather than the card inventing a before (INV-9). */
function ProseDiff({ before, after }: { before?: string; after: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line text-[12px] leading-snug">
      {before !== undefined && (
        <div className="flex gap-1.5 bg-removed-bg px-2 py-1 text-removed">
          <span aria-hidden className="select-none font-medium">
            −
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap line-through decoration-removed/40">{before}</span>
        </div>
      )}
      <div className={`flex gap-1.5 bg-added-bg px-2 py-1 text-added ${before !== undefined ? 'border-t border-line' : ''}`}>
        <span aria-hidden className="select-none font-medium">
          +
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap">{after}</span>
      </div>
    </div>
  )
}

export function DeltaView({ delta, base }: { delta: ProposalDelta; base?: string }) {
  switch (delta.kind) {
    case 'suggestion':
      return <p className="whitespace-pre-wrap text-[13px] text-ink-soft">{delta.text}</p>
    case 'schedule-patch':
      // A field-by-field read of what landing would change — the consent has to be
      // to something specific, not to "a routine change".
      return (
        <p className="text-[13px] text-ink-soft">
          <DeltaTag>routine change</DeltaTag>
          {describeSchedulePatch(delta.patch)}
        </p>
      )
    case 'artifact-patch':
      // A body edit IS a change, so it wears the form a change wants: a diff.
      // The one-line `describeArtifactPatch` exists for surfaces with no room
      // for one (a bell's sentence) — a review panel has the room.
      return (
        <div className="space-y-1">
          <p className="text-[13px] text-ink-soft">
            <DeltaTag>body edit</DeltaTag>
            <span className="text-ink-faint">block {delta.block + 1}</span>
          </p>
          <ProseDiff before={base} after={delta.text} />
        </div>
      )
    case 'relation-op':
      return (
        <p className="text-[13px] text-ink-soft">
          <DeltaTag>graph edit</DeltaTag>
          {describeOp(delta.op).text}
        </p>
      )
    default: {
      // Exhaustiveness guard: a new ProposalDelta variant is a compile error here.
      const _exhaustive: never = delta
      return _exhaustive
    }
  }
}

/** The panel-facing form: a proposal renders its own delta, so callers can't
 *  forget to pass the server's serve-time base alongside it. */
export function ProposalDeltaView({ proposal }: { proposal: SocialProposal }) {
  return <DeltaView delta={proposal.delta} base={proposal.deltaBase} />
}
