/** ── The shared Diff primitive (surface-audit S1/S2) ─────────────────────────
 *  A change's payload IS a change, so it belongs in a diff, not prose. `TextDiff`
 *  renders ONE field's change as a labeled side-by-side — current (removed tint) →
 *  proposed (added tint). When `current` is omitted (a CREATE — there is no prior
 *  value), it renders the proposed body alone rather than faking a diff against an
 *  empty column. This one primitive serves every place a change is shown: the
 *  change-proposal review + the proposer's own view (`ProposalFieldDiff`) and the
 *  content-bearing relation-consent cards (README / instructions / prompt bodies).
 *  Extracting it the first time a second entity needs it is form-follows-function —
 *  the diff cue can't drift between copies. */
export function TextDiff({
  label,
  current,
  proposed,
}: {
  label?: string
  /** The current value (left column). Omit for a create — proposed renders alone. */
  current?: string
  proposed: string
}) {
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
