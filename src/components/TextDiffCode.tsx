import type { TextDiffSide } from '../lib/textDiff.ts'

/** Optional raw-code variant of the shared TextDiff. Deferred so ordinary
 * proposal prose does not load the native review presentation at startup. */
export default function TextDiffCode({ label, sides }: { label?: string; sides: { before: TextDiffSide; after: TextDiffSide } }) {
  return <div data-text-comparison className="@container min-w-0">
    {label && <p className="mb-2 text-[12px] text-ink-soft">{label}</p>}
    <div className="grid min-w-0 grid-cols-1 gap-3 @min-[34rem]:grid-cols-2">
      {([['before', sides.before], ['after', sides.after]] as const).map(([position, side]) => <div key={position} className="min-w-0">
        <p className="mb-1 text-[12px] font-semibold text-ink">{side.label}</p>
        {side.text !== undefined
          ? side.text === '' ? <p className="py-2 text-[12px] text-ink-soft">Empty file (0 bytes).</p>
          : <pre aria-label={side.label} tabIndex={0} className={`max-h-64 overflow-auto whitespace-pre rounded-lg border border-line p-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus-visible:ring-2 focus-visible:ring-co ${position === 'before' ? 'bg-removed-bg/40' : 'bg-ok/5'}`}>{side.text}</pre>
          : <p className="py-2 text-[12px] text-ink-soft">{side.notice}</p>}
      </div>)}
    </div>
  </div>
}
