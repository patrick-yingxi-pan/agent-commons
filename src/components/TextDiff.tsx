/** ── The shared Diff primitive (surface-audit S1/S2) ─────────────────────────
 *  A change's payload IS a change, so it belongs in a diff, not prose. `TextDiff`
 *  renders ONE field's change as a labeled side-by-side — current (removed tint) →
 *  proposed (added tint). When `current` is omitted (a CREATE — there is no prior
 *  value), it renders the proposed body alone rather than faking a diff against an
 *  empty column. This one primitive serves every place a change is shown: the
 *  change-proposal review + the proposer's own view (`ProposalFieldDiff`) and the
 *  content-bearing relation-consent cards (description / instructions / prompt bodies).
 *  Extracting it the first time a second entity needs it is form-follows-function —
 *  the diff cue can't drift between copies. */
import { lazy, Suspense } from 'react'
import type { TextDiffSide } from '../lib/textDiff.ts'

const CodeDiff = lazy(() => import('./TextDiffCode.tsx'))

export function TextDiff({
  label,
  current,
  proposed,
  sides,
  presentation = 'code',
}: {
  label?: string
} & ({
  /** The current value (left column). Omit for a create — proposed renders alone. */
  current?: string
  proposed: string
  sides?: never
  presentation?: never
} | {
  current?: never
  proposed?: never
  /** Raw code uses explicit before/after states: absence and unread content
   * must never be rendered as an empty file or a fabricated removal. */
  sides: { before: TextDiffSide; after: TextDiffSide }
  /** Literal structured fields need values, not code-line controls. */
  presentation?: 'code' | 'values'
})) {
  if (sides && presentation === 'values') return <div className="@container min-w-0 space-y-2" data-text-value-comparison>
    {label && <h4 className="text-[12px] font-semibold text-ink [overflow-wrap:anywhere]">{label}</h4>}
    <div className="grid min-w-0 grid-cols-1 gap-2 @min-[34rem]:grid-cols-2">
      {([['before', sides.before], ['after', sides.after]] as const).map(([position, side]) => <div key={position} data-text-diff-side={position}
        className={`min-w-0 rounded-lg border border-line p-2.5 ${position === 'before' ? 'bg-removed-bg/40' : 'bg-ok/5'}`}>
        <p className="mb-1 text-[11px] font-semibold text-ink-soft">{side.label}</p>
        {side.text !== undefined
          ? side.text === '' ? <p className="text-[12px] italic text-ink-soft">Empty value.</p>
            : <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink [overflow-wrap:anywhere]">{side.text}</pre>
          : <p className="text-[12px] italic text-ink-soft">{side.notice}</p>}
      </div>)}
    </div>
  </div>
  if (sides) return <Suspense fallback={<p role="status" className="text-[12px] text-ink-soft">Loading text comparison…</p>}>
    <CodeDiff label={label} sides={sides} />
  </Suspense>
  return (
    <div className="mt-2">
      {label && (
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      )}
      {current !== undefined ? (
        <div className="grid grid-cols-2 gap-1.5">
          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-removed-bg/40 p-2 font-sans text-[11px] leading-snug text-ink-soft">
            {current}
          </pre>
          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-ok/5 p-2 font-sans text-[11px] leading-snug text-ink-soft">
            {proposed}
          </pre>
        </div>
      ) : (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-panel-2 p-2 font-sans text-[11px] leading-snug text-ink-soft">
          {proposed}
        </pre>
      )}
    </div>
  )
}
