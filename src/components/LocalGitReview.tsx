import { useMemo, useState } from 'react'
import { localGitReviews, useLocalGitReview } from '../controller/localGitReviews.ts'
import { GIT_CHANGE_LABELS, gitReviewComparison, gitReviewEntries, type GitComparison } from '../lib/localGitReview.ts'
import { findGitRenameSuggestions } from '../lib/gitRenameSuggestions.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { TextDiff } from './TextDiff.tsx'
import { CheckboxRow } from './Checkbox.tsx'
import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import type { LocalGitReview as Review } from '../../contract/localGitReview.mjs'

/** A local, time-bound observation belongs on the repository page, not in a
 * persisted artifact or a model context. Changed lines and full sides share
 * one exact captured input;
 * unknown content is explicit and never becomes a fictitious deletion. */
export function LocalGitReview({ id, enabled }: { id: LocalGitConnectionId; enabled: boolean }) {
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
  const loading = state.status === 'loading'
  return <section data-local-git-review className="mt-6 min-w-0 space-y-3">
    <h2 className="text-[15px] font-semibold text-ink">Changes on this device</h2>
    <p className="text-[13px] leading-relaxed text-ink-soft">Compare staged and unstaged tracked changes. This read-only review is never attached, saved to a conversation, or sent to a model.</p>
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
        <p className="py-1">Results and selection stay in memory, not browser storage. Dismiss, Disconnect, changing accounts, reloading or closing the app clears the review.</p>
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
      </> : <p role="status" className="text-[13px] text-ink-soft">No {state.comparison} changes in the compared paths.</p>}
    </div>}
  </section>
}
