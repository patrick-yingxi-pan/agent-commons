import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { LocalFileBrowserState } from '../controller/localFileBrowserCore.ts'
import { useLocalGitSavedCopyPending } from '../controller/localGitSavedCopies.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'

const PAGE_SIZE = 100
type Entry = { path: string; kind: string }
type Listing = { files: Entry[] }
type Preview = { path: string; sizeBytes: number; snapshot: { text: string } | { omitted: string } }

export function LocalFileBrowserView<L extends Listing, P extends Preview>({
  source, connectionId, name, enabled, intentScope, state, readListing, readPreview, dismiss, onAttach, isAttached,
  title, intro, listLabel, refreshLabel, listingNoun, loadingStatusCopy, outsideListingPrivacyCopy, searchPlaceholder, listAria, pageAria,
  entryLabel, entryMessage, listingSummary, limitsCopy, omittedCopy, headingLevel = 2,
}: {
  source: 'git' | 'folder'
  connectionId: string
  name: string
  enabled: boolean
  intentScope: string
  state: LocalFileBrowserState<L, P>
  readListing: () => unknown
  readPreview: (path: string) => unknown
  dismiss: () => void
  onAttach?: (path: string, text: string, receipt: number) => void | Promise<unknown>
  isAttached?: (receipt: number) => boolean
  title: string
  intro: string
  listLabel: string
  refreshLabel: string
  listingNoun: string
  loadingStatusCopy: string
  outsideListingPrivacyCopy: string
  searchPlaceholder: string
  listAria: string
  pageAria: string
  entryLabel: (entry: Entry) => string
  entryMessage: (entry: Entry) => string | null
  listingSummary: (listing: L, readAt: number | null) => ReactNode
  limitsCopy: string
  omittedCopy: (omission: string) => string
  headingLevel?: 2 | 3
}) {
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
  const sharedPending = useLocalGitSavedCopyPending(intentScope, connectionId, receipt, source)
  const previewAttached = previewText !== null && receipt !== null && !!isAttached?.(receipt)
  const attachWaiting = !!previewKey && (attachingKey === previewKey || sharedPending)
  const attachSavedCopy = async () => {
    if (!onAttach || previewText === null || !state.preview || receipt === null || !previewKey || attachingRef.current || previewAttached || sharedPending) return
    const { path } = state.preview
    attachingRef.current = previewKey
    setAttachingKey(previewKey)
    setAttachError(null)
    try { await onAttach(path, previewText, receipt) }
    catch { setAttachError('Could not confirm this saved copy. Check the context update before trying again.') }
    finally { attachingRef.current = null; setAttachingKey(null) }
  }
  const Header = headingLevel === 2 ? 'h2' : 'h3'
  const folder = source === 'folder'

  return <section {...(folder ? { 'data-local-folder-browser': '' } : { 'data-local-git-browser': '' })} className="mt-4 min-w-0 space-y-3">
    <Header className="text-[15px] font-semibold text-ink">{title}</Header>
    <p className="text-[13px] leading-relaxed text-ink-soft">{intro}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!enabled || state.pending} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
        onClick={() => { setQuery(''); setPage(0); void readListing() }}>
        {state.listingStatus === 'loading' ? `Listing ${listingNoun}…` : listing ? refreshLabel : state.listingStatus === 'error' ? 'Retry path listing' : listLabel}
      </button>
      {(listing || state.listingStatus === 'loading' || state.listingStatus === 'error') && <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
        onClick={() => { dismiss(); setQuery(''); setPage(0) }}>Dismiss</button>}
    </div>
    {state.pending && state.listingStatus === 'idle' && <p role="status" className="text-[12px] text-ink-soft">The previous read is finishing; browse again when ready.</p>}
    {state.listingStatus === 'loading' && <p role="status" className="text-[12px] text-ink-soft">{loadingStatusCopy}</p>}
    {state.listingStatus === 'error' && <p role="alert" className="text-[12px] text-danger-text">{state.listingError}</p>}
    <details className="text-[12px] leading-relaxed text-ink-soft">
      <summary className="cursor-pointer py-1">Browse limits and privacy</summary>
      <p className="py-1">{limitsCopy}</p>
    </details>
    {onAttach && <p className="text-[12px] leading-relaxed text-ink-soft">Browsing never attaches content. Attach saved copy adds exactly the text shown in this preview to conversation context. {outsideListingPrivacyCopy}</p>}
    {listing && <div className="min-w-0 space-y-3" data-local-folder-browser-listing={folder ? '' : undefined} data-local-git-browser-listing={!folder ? '' : undefined}>
      <p className="break-words text-[12px] text-ink-soft">{listingSummary(listing, state.listingReadAt)}</p>
      <label className="block min-w-0 space-y-1 text-[12px] text-ink-soft">Search paths
        <input className={FORM_INPUT_CLASS} type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder={searchPlaceholder} />
      </label>
      <p role="status" className="text-[12px] text-ink-soft">{filtered.length} matching paths · page {pageIndex + 1} of {pageCount}</p>
      <nav aria-label={pageAria} className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>Previous page</button>
        <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-2 py-1 text-[12px]`} disabled={pageIndex + 1 >= pageCount} onClick={() => setPage(pageIndex + 1)}>Next page</button>
      </nav>
      {visible.length > 0 ? <ul aria-label={listAria} className="max-h-72 space-y-1 overflow-auto rounded-md border border-line p-2">
        {visible.map(file => <li key={file.path}>
          <button type="button" disabled={!enabled || state.pending || file.kind !== 'file'} aria-pressed={state.selectedPath === file.path}
            className={`${SECONDARY_BUTTON_CLASS} flex w-full min-w-0 items-start gap-2 px-2 py-1.5 text-left text-[12px] disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={() => void readPreview(file.path)}>
            <span className="min-w-0 flex-1 break-all font-mono">{file.path}</span>
            <span className="shrink-0 text-ink-soft">{entryLabel(file)}</span>
          </button>
        </li>)}
      </ul> : <p role="status" className="text-[12px] text-ink-soft">{filtered.length === 0 ? `No ${listingNoun} match this search.` : ''}</p>}
      {selected && selected.kind !== 'file' && <p role="status" className="text-[12px] text-ink-soft">{entryMessage(selected)}</p>}
      {state.previewStatus === 'loading' && <p role="status" className="text-[12px] text-ink-soft">Reading {state.selectedPath}…</p>}
      {state.previewStatus === 'error' && <p role="alert" className="text-[12px] text-danger-text">{state.previewError}</p>}
      {state.preview && <div {...(folder ? { 'data-local-folder-file-preview': '' } : { 'data-local-git-file-preview': '' })} className="min-w-0 space-y-2">
        <h3 className="break-all font-mono text-[13px] text-ink">{state.preview.path}</h3>
        <p className="text-[12px] text-ink-soft">Read at {state.previewReadAt ? new Date(state.previewReadAt).toLocaleString() : 'this session'} · {state.preview.sizeBytes.toLocaleString()} bytes · whole-file limit 65,536 bytes. This is not live; select the path again after changes.</p>
        {'text' in state.preview.snapshot ? <>
          {state.preview.sizeBytes === 0 && state.preview.snapshot.text === '' && <p role="status" className="text-[12px] text-ink-soft">Empty file (0 bytes).</p>}
          <pre role="region" aria-label={`Preview of ${state.preview.path}`} tabIndex={0} className="max-h-96 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed text-ink" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.preview.snapshot.text}</pre>
          {onAttach && <button type="button" disabled={!enabled || state.pending || attachWaiting || previewAttached} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`}
            onClick={() => void attachSavedCopy()}>{previewAttached ? 'Added' : attachWaiting ? 'Saving saved copy…' : 'Attach saved copy'}</button>}
          {attachError && <p role="alert" className="text-[12px] text-danger-text">{attachError}</p>}
        </> : <p role="status" className="text-[12px] text-ink-soft">{omittedCopy(state.preview.snapshot.omitted)}</p>}
      </div>}
    </div>}
  </section>
}
