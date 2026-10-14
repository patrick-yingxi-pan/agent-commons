import { useMemo, useRef, type FormEvent } from 'react'
import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import type { PreparedLocalFileSavedCopy } from '../controller/localFileSavedCopyCore.ts'
import { localGitConnections } from '../controller/localGitConnections.ts'
import { gitComparisonReceipts } from '../controller/localGitReviews.ts'
import { localGitFileComparisons, useLocalGitFileComparison } from '../controller/localGitFileComparisons.ts'
import { GIT_CHANGE_LABELS, gitReviewSide, type GitComparison } from '../lib/localGitReview.ts'
import { prepareGitFileComparisonCopy } from '../lib/gitFileComparisonCopy.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { TextDiff } from './TextDiff.tsx'
import { LocalSavedCopyAction } from './LocalSavedCopyAction.tsx'

const unavailableCopy = {
  ignored: 'This path is ignored by Git and is not compared.',
  'not-tracked': 'This path is not tracked in HEAD or the index. Untracked files are outside this comparison.',
  'not-in-index': 'This path is not present in the index, so an unstaged comparison is unavailable.',
  sparse: 'This path is outside the populated sparse checkout and cannot be compared locally.',
  unmerged: 'This path has unresolved merge stages and cannot be compared as a single file.',
} as const

export function LocalGitFileComparison({ id, name, enabled, intentScope, isAttached, onAttach }: {
  id: LocalGitConnectionId
  name: string
  enabled: boolean
  intentScope?: string
  isAttached?: (receipt: number) => boolean
  onAttach?: (file: PreparedLocalFileSavedCopy) => void | Promise<unknown>
}) {
  const state = useLocalGitFileComparison(id)
  const result = state.result
  const copy = useMemo(() => onAttach && result?.status === 'ready' && state.readAt !== null
    ? prepareGitFileComparisonCopy({ comparison: result, readAt: state.readAt, repositoryName: name })
    : null, [onAttach, result, state.readAt, name])
  const receipt = result?.status === 'ready' ? gitComparisonReceipts.fileReceipt(result) : null
  const selectedReceipt = useRef(receipt)
  selectedReceipt.current = receipt
  const isCurrent = (candidate: number) => {
    const live = localGitFileComparisons.get(id)
    const connections = localGitConnections.get()
    return selectedReceipt.current === candidate && live.result === result && live.status === 'ready' &&
      live.draftPath === result?.path && live.comparison === result?.comparison &&
      connections.status === 'ready' && !connections.busy && connections.rows.some(row => row.id === id)
  }
  const loading = state.status === 'loading'
  const compare = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (enabled && !state.pending) void localGitFileComparisons.read(id)
  }

  return <section data-local-git-file-comparison className="min-w-0 space-y-3 rounded-xl border border-line bg-panel p-3">
    <h3 className="text-[13px] font-semibold text-ink">Compare one tracked file</h3>
    <p className="text-[12px] leading-relaxed text-ink-soft">Enter a complete repository-relative path, then choose staged (HEAD → Index) or unstaged (Index → Working tree). This reads only that selected tracked path, including a staged deletion still present in HEAD. It is a local snapshot; nothing is saved or sent automatically.</p>
    <form className="min-w-0 space-y-2" onSubmit={compare}>
      <label className="block min-w-0 space-y-1 text-[12px] text-ink-soft">Repository-relative path
        <input className={FORM_INPUT_CLASS} value={state.draftPath} onChange={event => localGitFileComparisons.setDraftPath(id, event.target.value)}
          placeholder="src/example.ts" autoComplete="off" spellCheck={false} />
      </label>
      <label className="block min-w-0 space-y-1 text-[12px] text-ink-soft">Comparison direction
        <select className={FORM_INPUT_CLASS} value={state.comparison}
          onChange={event => localGitFileComparisons.setComparison(id, event.target.value as GitComparison)}>
          <option value="staged">Staged · HEAD → Index</option>
          <option value="unstaged">Unstaged · Index → Working tree</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!enabled || state.pending || !state.draftPath.length}
          className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}>
          {loading ? 'Comparing file…' : state.status === 'error' ? 'Retry file comparison' : 'Compare file'}
        </button>
        {(result || state.status === 'error' || state.pending) && <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
          onClick={() => localGitFileComparisons.dismiss(id)}>Dismiss comparison</button>}
      </div>
    </form>
    {loading && <p role="status" className="text-[12px] text-ink-soft">Reading the selected file comparison…</p>}
    {state.status === 'error' && <p role="alert" className="text-[12px] text-danger-text">{state.error}</p>}
    {result && <div data-local-git-file-comparison-result className="min-w-0 space-y-2">
      <p className="break-words text-[12px] text-ink-soft [overflow-wrap:anywhere]">Captured {state.readAt ? new Date(state.readAt).toLocaleString() : 'this session'} · {result.head.ref ? result.head.ref.replace(/^refs\/heads\//, '') : 'Detached HEAD'} · {result.head.oid ? result.head.oid.slice(0, 12) : 'No commit yet'}. This is not live; compare again for later edits.</p>
      <h4 className="break-words font-mono text-[12px] text-ink [overflow-wrap:anywhere]">{result.path} · {result.comparison === 'staged' ? 'Staged' : 'Unstaged'}</h4>
      {result.status === 'unavailable'
        ? <p role="status" className="text-[12px] text-ink-soft">{unavailableCopy[result.reason]}</p>
        : <>
          <TextDiff label={GIT_CHANGE_LABELS[result.change]} sides={{
            before: gitReviewSide(result.before, result.comparison === 'staged' ? 'HEAD' : 'Index'),
            after: gitReviewSide(result.after, result.comparison === 'staged' ? 'Index' : 'Working tree'),
          }} />
          {result.change === 'unchanged' && <p role="status" className="text-[12px] text-ink-soft">This captured path is unchanged in the selected direction.</p>}
          {result.change === 'unavailable' && <p role="status" className="text-[12px] text-ink-soft">The comparison is explicitly unavailable; omitted sides are not empty files.</p>}
          {onAttach && intentScope && copy && receipt !== null && <div data-git-file-comparison-copy className="min-w-0 space-y-2 border-t border-line pt-3">
            <p className="text-[12px] leading-relaxed text-ink-soft">Attach saves this exact captured comparison as ordinary JSON text (including empty, missing, or omitted sides). It does not reread or change the repository, and does not send a message or call the model. The complete copy must fit within 64 KiB.</p>
            {copy.status === 'ready' ? <>
              <details className="min-w-0 text-[12px] text-ink-soft">
                <summary className="cursor-pointer py-1">Saved comparison contents</summary>
                <p className="break-words py-1 [overflow-wrap:anywhere]">{copy.name} · {copy.sizeBytes.toLocaleString()} bytes</p>
                <pre data-git-file-comparison-copy-text tabIndex={0} aria-label="Saved comparison JSON" role="region" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel p-3 font-mono text-[11px] text-ink [overflow-wrap:anywhere]">{copy.text}</pre>
              </details>
              <LocalSavedCopyAction source="git-review" connectionId={id} intentScope={intentScope} receipt={receipt}
                preview={{ version: 1, path: copy.name, sizeBytes: copy.sizeBytes, snapshot: { text: copy.text } }}
                disabled={!enabled || state.pending} isAttached={isAttached?.(receipt) ?? false} isCurrent={isCurrent}
                subscribeCurrent={listener => localGitFileComparisons.subscribe(id, listener)} onAttach={onAttach}
                actionLabel="Attach this comparison" pendingLabel="Saving comparison…" />
            </> : <p role="status" className="text-[12px] text-ink-soft">{copy.status === 'too-large'
              ? 'This comparison exceeds the 64 KiB saved-copy limit. Nothing was truncated or attached.'
              : 'This captured comparison cannot be saved.'}</p>}
          </div>}
        </>}
    </div>}
    <details className="text-[11px] leading-relaxed text-ink-soft">
      <summary className="cursor-pointer py-1">Single-file comparison limits and privacy</summary>
      <p className="py-1">Only the exact selected path is compared. Each text side is limited to 64 KiB and both displayed sides together to 128 KiB. Ignored, untracked, missing-index, sparse, and unresolved paths are reported explicitly; unavailable content is never treated as an empty file. Results remain in account-scoped memory until Dismiss, Disconnect, an account change, reload, or app close.</p>
    </details>
  </section>
}
