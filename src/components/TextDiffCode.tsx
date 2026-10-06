import { Fragment, useMemo, useState } from 'react'
import { diffLines } from '../lib/lineDiff.ts'
import { textDiffInput, textDiffPages, type TextDiffSide } from '../lib/textDiff.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

/** Deferred raw-code presentation. Both views use only captured input: changing
 * view, file or page never asks the native host for another read. */
export default function TextDiffCode({ label, sides }: { label?: string; sides: { before: TextDiffSide; after: TextDiffSide } }) {
  const [view, setView] = useState('changes')
  const [page, setPage] = useState(0)
  const result = useMemo(() => {
    const input = textDiffInput(sides)
    return input ? diffLines(...input) : undefined
  }, [sides.before.text, sides.before.missing, sides.after.text, sides.after.missing])
  const pages = useMemo(() => result?.status === 'ready' ? textDiffPages(result.hunks) : [], [result])
  const activePage = Math.min(page, Math.max(0, pages.length - 1))
  const changes = view === 'changes' && result?.status === 'ready'
  const buttonClass = `${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-co disabled:opacity-50`

  return <div data-text-comparison className="@container min-w-0 space-y-3">
    {label && <p className="text-[12px] text-ink-soft">{label}</p>}
    {result?.status === 'ready' && <label className="block space-y-1 text-[12px] text-ink-soft">Review view
      <select className={FORM_INPUT_CLASS} value={view} onChange={event => setView(event.target.value)}>
        <option value="changes">Changed lines</option>
        <option value="full">Full files</option>
      </select>
    </label>}
    <div className="grid min-w-0 grid-cols-1 gap-3 @min-[34rem]:grid-cols-2">
      {([['before', sides.before], ['after', sides.after]] as const).map(([position, side]) => <div key={position} className="min-w-0">
        <p className="mb-1 text-[12px] font-semibold text-ink">{side.label}</p>
        {side.text !== undefined
          ? side.text === '' ? <p className="py-2 text-[12px] text-ink-soft">Empty file (0 bytes).</p>
          : !changes && <pre aria-label={side.label} tabIndex={0} className={`max-h-64 overflow-auto whitespace-pre rounded-lg border border-line p-2 font-mono text-[12px] leading-relaxed text-ink outline-none focus-visible:ring-2 focus-visible:ring-co ${position === 'before' ? 'bg-removed-bg/40' : 'bg-ok/5'}`}>{side.text}</pre>
          : <p className="py-2 text-[12px] text-ink-soft">{side.notice}</p>}
      </div>)}
    </div>
    {!result && <p className="text-[12px] text-ink-soft">Changed lines are unavailable because a comparison side was not read. Available full text is shown above.</p>}
    {result?.status === 'too-complex' && <p className="text-[12px] text-ink-soft">This comparison exceeds the changed-line review limit. Full files are shown above; no changes have been summarized or omitted from those captured files.</p>}
    {changes && result?.status === 'ready' && <>
      <p data-diff-summary className="text-[12px] text-ink-soft">{result.added} added · {result.deleted} removed</p>
      {pages.length === 0 ? <p className="text-[13px] text-ink-soft">No text changes. File presence and executable mode are shown above.</p> : <>
        <p className="text-[12px] text-ink-soft">Three lines of context surround each change; other unchanged lines are hidden. Old line numbers refer to {sides.before.label}; new line numbers refer to {sides.after.label}.</p>
        {pages.length > 1 && <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass} disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous diff page</button>
          <p role="status" className="text-[12px] text-ink-soft">Page {activePage + 1} of {pages.length}</p>
          <button type="button" className={buttonClass} disabled={activePage === pages.length - 1} onClick={() => setPage(activePage + 1)}>Next diff page</button>
        </div>}
        <div key={activePage} data-diff-lines role="region" aria-label={`Changed lines · page ${activePage + 1} of ${pages.length}`} tabIndex={0}
          className="max-h-80 overflow-auto rounded-lg border border-line outline-none focus-visible:ring-2 focus-visible:ring-co">
          <table className="min-w-full border-collapse whitespace-pre font-mono text-[12px] leading-relaxed text-ink">
            <caption className="sr-only">Changed lines with old and new line numbers</caption>
            <thead><tr className="bg-panel-2 text-left text-ink-soft">
              <th scope="col" className="px-2 py-1 font-normal">Old</th><th scope="col" className="px-2 py-1 font-normal">New</th>
              <th scope="col" className="px-2 py-1 font-normal"><span className="sr-only">Change</span></th><th scope="col" className="px-2 py-1 font-normal">Text</th>
            </tr></thead>
            <tbody>{pages[activePage].map(part => <Fragment key={`${part.hunk.oldStart}:${part.hunk.newStart}:${part.offset}`}>
              <tr data-diff-hunk><td colSpan={4} className="bg-panel-2 px-2 py-1 text-ink-soft">@@ −{part.hunk.oldStart},{part.hunk.oldCount} +{part.hunk.newStart},{part.hunk.newCount} @@{part.offset > 0 ? ' · continued' : ''}</td></tr>
              {part.rows.map((row, index) => <tr key={part.offset + index} data-diff-kind={row.kind}
                className={row.kind === 'delete' ? 'bg-removed-bg/40' : row.kind === 'add' ? 'bg-ok/5' : ''}>
                <td className="px-2 text-right align-top text-ink-soft">{row.oldLine ?? ''}</td>
                <td className="px-2 text-right align-top text-ink-soft">{row.newLine ?? ''}</td>
                <td className="px-2 align-top"><span className="sr-only">{row.kind === 'delete' ? 'Removed' : row.kind === 'add' ? 'Added' : 'Unchanged'}</span><span aria-hidden="true">{row.kind === 'delete' ? '−' : row.kind === 'add' ? '+' : ' '}</span></td>
                <td className="px-2"><code>{row.text || ' '}</code>{row.eol !== '\n' && <span className="ml-3 text-ink-soft">{row.eol === '\r\n' ? 'CRLF' : 'No newline at end of file'}</span>}</td>
              </tr>)}
            </Fragment>)}</tbody>
          </table>
        </div>
      </>}
    </>}
  </div>
}
