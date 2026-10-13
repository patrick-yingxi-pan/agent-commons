import { useMemo, useRef, useState } from 'react'
import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import { localGitBrowser, useLocalGitBrowser } from '../controller/localGitBrowser.ts'
import { useLocalGitSavedCopyPending } from '../controller/localGitSavedCopies.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'

const PAGE_SIZE = 100

export function LocalGitBrowser({ id, name, enabled, intentScope = '', onAttach, isAttached }: {
  id: LocalGitConnectionId
  name: string
  enabled: boolean
  intentScope?: string
  onAttach?: (path: string, text: string, receipt: number) => void | Promise<unknown>
  isAttached?: (receipt: number) => boolean
}) {
  const state = useLocalGitBrowser(id)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [attachingKey, setAttachingKey] = useState<string | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const attachingRef = useRef<string | null>(null)
  const listing = state.listing
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (listing?.files ?? []).filter(file => !needle || file.path.toLocaleLowerCase().includes(needle))
  }, [listing, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageIndex = Math.min(page, pageCount - 1)
  const visible = filtered.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)
  const selected = listing?.files.find(file => file.path === state.selectedPath)
  const previewText = state.preview?.snapshot && 'text' in state.preview.snapshot ? state.preview.snapshot.text : null
  const receipt = state.previewReceipt
  const previewKey = previewText === null || receipt === null ? null : String(receipt)
  const sharedPending = useLocalGitSavedCopyPending(intentScope, id, receipt)
  const previewAttached = previewText !== null && receipt !== null && !!isAttached?.(receipt)
  const attachWaiting = !!previewKey && (attachingKey === previewKey || sharedPending)
  const attachSavedCopy = async () => {
    if (!onAttach || previewText === null || !state.preview || receipt === null || !previewKey || attachingRef.current || previewAttached || sharedPending) return
    const { path } = state.preview
    attachingRef.current = previewKey
    setAttachingKey(previewKey)
    setAttachError(null)
    try {
      await onAttach(path, previewText, receipt)
    } catch {
      setAttachError('Could not confirm this saved copy. Check the context update before trying again.')
    } finally {
      attachingRef.current = null
      setAttachingKey(null)
    }
  }
  return <section data-local-git-browser className="mt-6 min-w-0 space-y-3">
    <h2 className="text-[15px] font-semibold text-ink">Browse files</h2>
    <p className="text-[13px] leading-relaxed text-ink-soft">Browse tracked paths in {name}. Listing reads bounded Git metadata and applicable ignore files to identify tracked paths and exclusions; it does not preview tracked file contents. Choose a path to read that file. Nothing is attached, persisted, or sent by browsing.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!enabled || state.pending} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
        onClick={() => { setQuery(''); setPage(0); void localGitBrowser.readListing(id) }}>
        {state.listingStatus === 'loading' ? 'Listing tracked paths…' : listing ? 'Refresh tracked paths' : state.listingStatus === 'error' ? 'Retry path listing' : 'List tracked paths'}
      </button>
      {(listing || state.listingStatus === 'loading' || state.listingStatus === 'error') && <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
        onClick={() => { localGitBrowser.dismiss(id); setQuery(''); setPage(0) }}>Dismiss</button>}
    </div>
    {state.pending && state.listingStatus === 'idle' && <p role="status" className="text-[12px] text-ink-soft">The previous read is finishing; browse again when ready.</p>}
    {state.listingStatus === 'loading' && <p role="status" className="text-[12px] text-ink-soft">Reading bounded tracked-path metadata… Dismiss hides prior results; it does not change the repository.</p>}
    {state.listingStatus === 'error' && <p role="alert" className="text-[12px] text-danger-text">{state.listingError}</p>}
    <details className="text-[12px] leading-relaxed text-ink-soft">
      <summary className="cursor-pointer py-1">Browse limits and privacy</summary>
      <p className="py-1">The listing is bounded to 10,000 paths and includes tracked path status and the excluded-path count. Bounded Git metadata and applicable ignore files are read to compute it; tracked file contents are not previewed unless selected. Search and pagination operate over the full returned listing. Selecting a path reads only that file, at most 64 KiB. Results stay in memory; Dismiss, Disconnect, changing accounts, reload, or closing the app clears them.</p>
      {onAttach && <p className="py-1">Attach saved copy is a separate choice. It adds only the exact text shown in the preview to conversation context, available to model input when the conversation is next sent; it does not send a message or call the model.</p>}
    </details>
    {listing && <div className="min-w-0 space-y-3" data-local-git-browser-listing>
      <p className="break-words text-[12px] text-ink-soft">Read at {state.listingReadAt ? new Date(state.listingReadAt).toLocaleString() : 'this session'} · {listing.files.length} tracked paths · {listing.excludedCount} ignored paths excluded. This is a point-in-time listing; refresh to see later changes.</p>
      <label className="block min-w-0 space-y-1 text-[12px] text-ink-soft">Search paths
        <input className={FORM_INPUT_CLASS} type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="Filter tracked paths" />
      </label>
      <p role="status" className="text-[12px] text-ink-soft">{filtered.length} matching paths · page {pageIndex + 1} of {pageCount}</p>
      <nav aria-label="Tracked file pages" className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>Previous page</button>
        <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} disabled={pageIndex + 1 >= pageCount} onClick={() => setPage(pageIndex + 1)}>Next page</button>
      </nav>
      {visible.length > 0 ? <ul aria-label="Tracked repository paths" className="max-h-72 space-y-1 overflow-auto rounded-md border border-line p-2">
        {visible.map(file => <li key={file.path}>
          <button type="button" disabled={!enabled || state.pending || file.kind !== 'file'} aria-pressed={state.selectedPath === file.path}
            className={`${SECONDARY_BUTTON_CLASS} flex w-full min-w-0 items-start gap-2 px-2 py-1.5 text-left text-[12px] disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={() => void localGitBrowser.readPreview(id, file.path)}>
            <span className="min-w-0 flex-1 break-all font-mono">{file.path}</span>
            <span className="shrink-0 text-ink-soft">{file.kind === 'file' ? 'Tracked file' : file.kind === 'conflict' ? 'Conflict' : file.kind === 'sparse' ? 'Sparse checkout' : 'Unsupported'}</span>
          </button>
        </li>)}
      </ul> : <p role="status" className="text-[12px] text-ink-soft">{filtered.length === 0 ? 'No tracked paths match this search.' : ''}</p>}
      {selected && selected.kind !== 'file' && <p role="status" className="text-[12px] text-ink-soft">{selected.kind === 'conflict' ? 'This path has an unresolved merge conflict and cannot be previewed as a single file.' : selected.kind === 'sparse' ? 'This path is outside the populated sparse checkout and has no local file content to preview.' : 'This path has a file type or state that this browser cannot preview.'}</p>}
      {state.previewStatus === 'loading' && <p role="status" className="text-[12px] text-ink-soft">Reading {state.selectedPath}…</p>}
      {state.previewStatus === 'error' && <p role="alert" className="text-[12px] text-danger-text">{state.previewError}</p>}
      {state.preview && <div data-local-git-file-preview className="min-w-0 space-y-2">
        <h3 className="break-all font-mono text-[13px] text-ink">{state.preview.path}</h3>
        <p className="text-[12px] text-ink-soft">Read at {state.previewReadAt ? new Date(state.previewReadAt).toLocaleString() : 'this session'} · {state.preview.sizeBytes.toLocaleString()} bytes · whole-file limit 65,536 bytes. This is not live; select the path again after changes.</p>
        {'text' in state.preview.snapshot ? <>
          {state.preview.sizeBytes === 0 && state.preview.snapshot.text === '' && <p role="status" className="text-[12px] text-ink-soft">Empty file (0 bytes).</p>}
          <pre role="region" aria-label={`Preview of ${state.preview.path}`} tabIndex={0} className="max-h-96 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed text-ink" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.preview.snapshot.text}</pre>
          {onAttach && <button type="button" disabled={!enabled || state.pending || attachWaiting || previewAttached} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
            onClick={() => void attachSavedCopy()}>{previewAttached ? 'Added' : attachWaiting ? 'Saving saved copy…' : 'Attach saved copy'}</button>}
          {attachError && <p role="alert" className="text-[12px] text-danger-text">{attachError}</p>}
        </> : <p role="status" className="text-[12px] text-ink-soft">{state.preview.snapshot.omitted === 'too-large' ? 'This file exceeds the 64 KiB preview limit; no content was returned.' : state.preview.snapshot.omitted === 'unsupported' ? 'This file is not supported for text preview; no content was returned.' : 'The file could not be read; no content was returned.'}</p>}
      </div>}
      {onAttach && <p className="text-[12px] leading-relaxed text-ink-soft">Browsing never attaches content. Attach saved copy adds only the exact text shown in this preview to conversation context. It is available to model input when the conversation is next sent; attaching does not send a message or call the model.</p>}
    </div>}
  </section>
}
