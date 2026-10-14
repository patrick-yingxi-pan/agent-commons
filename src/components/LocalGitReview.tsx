import { useMemo, useRef, useState } from 'react'
import { gitComparisonReceipts, localGitReviews, useLocalGitReview } from '../controller/localGitReviews.ts'
import { localGitConnections } from '../controller/localGitConnections.ts'
import type { PreparedLocalFileSavedCopy } from '../controller/localFileSavedCopyCore.ts'
import { GIT_CHANGE_LABELS, gitReviewComparison, gitReviewEntries, type GitComparison } from '../lib/localGitReview.ts'
import { prepareGitComparisonCopy } from '../lib/gitComparisonCopy.ts'
import { findGitRenameSuggestions } from '../lib/gitRenameSuggestions.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { TextDiff } from './TextDiff.tsx'
import { CheckboxRow } from './Checkbox.tsx'
import { LocalSavedCopyAction } from './LocalSavedCopyAction.tsx'
import { LocalGitFileComparison } from './LocalGitFileComparison.tsx'
import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import type { LocalGitReview as Review } from '../../contract/localGitReview.mjs'

/** A passive review is a local, time-bound observation. A conversation can
 * explicitly save one captured comparison through the ordinary context funnel.
 * Changed lines, full sides and saved copies share one exact captured input;
 * unknown content is explicit and never becomes a fictitious deletion. */
export function LocalGitReview({ id, name, enabled, intentScope, isAttached, onAttach }: {
  id: LocalGitConnectionId
  name: string
  enabled: boolean
  intentScope?: string
  isAttached?: (receipt: number) => boolean
  onAttach?: (file: PreparedLocalFileSavedCopy) => void | Promise<unknown>
}) {
  const state = useLocalGitReview(id)
  const result = state.result
  const suggestions = useMemo(() => findGitRenameSuggestions(result?.files ?? []), [result])
  const [grouping, setGrouping] = useState<{ result: Review | null; enabled: boolean }>({ result: null, enabled: false })
  // A new read or Dismiss drops both the choice and the previous captured body.
  // Adjust during render rather than retaining dismissed file text in local state.
  if (grouping.result !== result) setGrouping({ result, enabled: false })
  const grouped = result !== null && grouping.result === result && grouping.enabled
  const pairs = grouped ? suggestions.pairs : []
  const entries = gitReviewEntries(result?.files ?? [], state.comparison, pairs)
  const entry = entries.find(item => item.file.path === state.path || item.previous?.path === state.path) ?? entries[0]
  const file = entry?.file
  const path = file?.path
  const previousPath = entry?.previous?.path
  const copy = useMemo(() => onAttach && result && path && state.readAt !== null
    ? prepareGitComparisonCopy({ review: result, comparison: state.comparison, path, previousPath, readAt: state.readAt, repositoryName: name })
    : null, [onAttach, result, path, previousPath, state.readAt, state.comparison, name])
  const receipt = result && path ? gitComparisonReceipts.receipt(result, state.comparison, path, previousPath) : null
  const selectedReceipt = useRef(receipt)
  selectedReceipt.current = receipt
  // Consult live stores, not a closure over the rendered selection. Dismiss,
  // reread, disconnect and selection changes fence preparation before onAttach.
  const isCurrent = (candidate: number) => {
    const live = localGitReviews.get(id)
    const connections = localGitConnections.get()
    return selectedReceipt.current === candidate && live.result === result && live.status === 'ready' &&
      live.comparison === state.comparison && live.path === state.path &&
      connections.status === 'ready' && !connections.busy && connections.rows.some(row => row.id === id)
  }
  const loading = state.status === 'loading'
  return <section data-local-git-review className="mt-6 min-w-0 space-y-3">
    <h2 className="text-[15px] font-semibold text-ink">Changes on this device</h2>
    <p className="text-[13px] leading-relaxed text-ink-soft">Compare staged and unstaged tracked changes. Reading and selecting stay local; nothing is saved or sent automatically.{onAttach ? ' Attach this comparison saves only the selected captured sides as conversation context. Send remains a separate action.' : ' To save a comparison, open this repository from a conversation’s Add context menu.'}</p>
    <LocalGitFileComparison id={id} name={name} enabled={enabled} intentScope={intentScope} isAttached={isAttached} onAttach={onAttach} />
    <h3 data-local-git-whole-review className="pt-2 text-[13px] font-semibold text-ink">Whole-repository review</h3>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!enabled || state.pending} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
        onClick={() => void localGitReviews.read(id)}>{loading ? 'Reading changes…' : result ? 'Read changes again' : state.status === 'error' ? 'Retry review' : 'Review changes'}</button>
      {state.status !== 'idle' && <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
        onClick={() => localGitReviews.dismiss(id)}>Dismiss review</button>}
    </div>
    {loading && <p role="status" className="text-[12px] text-ink-soft">Reading bounded local changes… Dismiss hides this read; it does not change the repository.</p>}
    {state.status === 'idle' && state.pending && <p role="status" className="text-[12px] text-ink-soft">Previous read is finishing; review again when ready.</p>}
    {state.status === 'error' && <p role="alert" className="text-[12px] text-danger-text">{state.error}</p>}
    {result && <div data-local-git-review-result className="min-w-0 space-y-3">
      <p className="break-words text-[12px] text-ink-soft [overflow-wrap:anywhere]">Read at {state.readAt ? new Date(state.readAt).toLocaleString() : 'this session'} · {result.head.ref ? result.head.ref.replace(/^refs\/heads\//, '') : 'Detached HEAD'} · {result.head.oid ? result.head.oid.slice(0, 12) : 'No commit yet'}. This is not live; read again for later edits.</p>
      <details className="text-[12px] leading-relaxed text-ink-soft">
        <summary className="cursor-pointer py-1">Review limits and privacy</summary>
        <p className="py-1">Raw bytes and executable mode only; Git filters, attributes, Git’s rename detection, and global configuration are not applied. Untracked and ignored files are excluded. Up to 500 HEAD/index paths, 24 working files, 64 KiB per file and 128 KiB total displayed text. Omitted comparisons are not evidence of a clean repository.</p>
        <p className="py-1">Optional rename suggestions compare only captured staged deletions and additions. Identical text must match uniquely. Edited matches need at least three shared nonblank lines, 80% shared line bytes, and a unique best match in both directions with a 10-point margin. Line order is not part of this score; line endings are. Ambiguous and unread files stay separate. These are possible moves, not recorded Git operations; copy-and-delete can look the same. Matching is capped at 4,096 candidate pairs and 250,000 line checks.</p>
        <p className="py-1">Changed-line review supports up to 8,000 lines per side within a bounded comparison budget. More complex comparisons show full files instead. Pagination limits what is rendered at once, not which captured changes can be read.</p>
        <p className="py-1">Results and selection stay in memory, not browser storage. Dismiss, Disconnect, changing accounts, reloading or closing the app clears the review. Explicitly attached copies remain in their conversation until removed.</p>
      </details>
      <p className="text-[12px] text-ink-soft">{result.unchangedCount} compared unchanged · {result.excludedCount} ignored paths excluded</p>
      <label className="block min-w-0 space-y-1 text-[12px] text-ink-soft">Compare
        <select className={FORM_INPUT_CLASS} value={state.comparison} onChange={event => localGitReviews.select(id, event.target.value as GitComparison, null)}>
          <option value="staged">Staged · HEAD → Index ({gitReviewEntries(result.files, 'staged', pairs).length})</option>
          <option value="unstaged">Unstaged · Index → Working tree ({result.files.filter(item => item.unstaged !== 'unchanged').length})</option>
        </select>
      </label>
      {state.comparison === 'staged' && suggestions.pairs.length > 0 && <CheckboxRow checked={grouped}
        onToggle={() => setGrouping({ result, enabled: !grouped })} className="min-h-6 py-1 text-[12px] text-ink-soft">
        Group possible renames ({suggestions.pairs.length})
      </CheckboxRow>}
      {state.comparison === 'staged' && suggestions.limited && <p role="status" className="text-[12px] text-ink-soft">Rename matching reached its comparison limit. Only unique identical-text matches are suggested; other additions and deletions stay separate.</p>}
      {file ? <>
        <label className="block min-w-0 space-y-1 text-[12px] text-ink-soft">Changed file
          <select className={FORM_INPUT_CLASS} value={file.path} onChange={event => localGitReviews.select(id, state.comparison, event.target.value)}>
            {entries.map(item => <option key={item.file.path} value={item.file.path}>{item.previous ? `${item.previous.path} → ${item.file.path} · Possible rename` : `${item.file.path} · ${GIT_CHANGE_LABELS[item.file[state.comparison]]}`}</option>)}
          </select>
        </label>
        <h3 className="break-words font-mono text-[13px] text-ink [overflow-wrap:anywhere]">{entry.previous ? `Possible rename: ${entry.previous.path} → ${file.path}` : file.path}</h3>
        {entry.suggestion && <p data-git-rename-match className="text-[12px] text-ink-soft">{entry.suggestion.match === 'exact' ? 'Identical captured text' : `${entry.suggestion.sharedPercent}% shared line bytes`}. A comparison hint, not proof of a move. Turn off grouping to review the original addition and deletion.</p>}
        <TextDiff key={`${file.path}:${state.comparison}:${entry.previous?.path ?? ''}`} label={entry.previous ? 'Possible rename' : GIT_CHANGE_LABELS[file[state.comparison]]} sides={entry.previous ? gitReviewComparison(file, state.comparison, entry.previous) : gitReviewComparison(file, state.comparison)} />
        {onAttach && intentScope && <div data-git-comparison-copy className="min-w-0 space-y-2 border-t border-line pt-3">
          <p className="text-[12px] leading-relaxed text-ink-soft">Save this comparison as a JSON text attachment: captured paths, time, commit, exact sides and any omissions. This does not reread or change the repository. The complete copy must fit within 64 KiB.</p>
          {copy?.status === 'ready' && receipt !== null ? <>
            <details className="min-w-0 text-[12px] text-ink-soft">
              <summary className="cursor-pointer py-1">Saved comparison contents</summary>
              <p className="break-words py-1 [overflow-wrap:anywhere]">{copy.name} · {copy.sizeBytes.toLocaleString()} bytes</p>
              <pre data-git-comparison-copy-text tabIndex={0} aria-label="Saved comparison JSON" role="region" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel p-3 font-mono text-[11px] text-ink [overflow-wrap:anywhere]">{copy.text}</pre>
            </details>
            <LocalSavedCopyAction source="git-review" connectionId={id} intentScope={intentScope} receipt={receipt}
              preview={{ version: 1, path: copy.name, sizeBytes: copy.sizeBytes, snapshot: { text: copy.text } }}
              disabled={!enabled || state.pending} isAttached={isAttached?.(receipt) ?? false} isCurrent={isCurrent}
              subscribeCurrent={listener => localGitReviews.subscribe(id, listener)} onAttach={onAttach}
              actionLabel="Attach this comparison" pendingLabel="Saving comparison…" />
          </> : <p role="status" className="text-[12px] text-ink-soft">{copy?.status === 'too-large' ? 'This comparison exceeds the 64 KiB saved-copy limit. Nothing was truncated or attached; choose a smaller comparison.' : 'This selection cannot be saved. Choose a changed file to review.'}</p>}
        </div>}
      </> : <p role="status" className="text-[13px] text-ink-soft">No {state.comparison} changes in the compared paths.</p>}
    </div>}
  </section>
}
