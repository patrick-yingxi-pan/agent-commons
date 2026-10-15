import { useMemo, useState, type ReactNode } from 'react'
import type { LocalFileBrowserState } from '../controller/localFileBrowserCore.ts'
import type { LocalSavedCopySourceKind } from '../controller/localGitSavedCopiesCore.ts'
import { FORM_INPUT_CLASS } from '../lib/formInput.ts'
import { SECONDARY_BUTTON_CLASS, SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { documentImportCopy } from '../../contract/documentImport.mjs'
import type { LocalBrowsePreview } from '../lib/localFilePreview.ts'
import type { PreparedLocalFileSavedCopy } from '../controller/localFileSavedCopyCore.ts'
import { IMAGE_ORIGINAL_PRIVACY_COPY } from '../lib/imageOriginalDownload.ts'
import { LocalSavedCopyAction } from './LocalSavedCopyAction.tsx'

const PAGE_SIZE = 100
type Entry = { path: string; kind: string }
type Listing = { files: Entry[] }
type Preview = LocalBrowsePreview

export function LocalFileBrowserView<L extends Listing, P extends Preview>({
  source, connectionId, name, enabled, intentScope, state, readListing, readPreview, processPreview, cancelProcessing, pdfOcrAvailable = false, dismiss, onAttach, isAttached, isCurrent, subscribeCurrent, compact = false,
  title, intro, listLabel, refreshLabel, listingNoun, loadingStatusCopy, outsideListingPrivacyCopy, searchPlaceholder, listAria, pageAria, limitsLabel, afterContent,
  entryLabel, entryMessage, listingSummary, limitsCopy, omittedCopy, headingLevel = 2,
}: {
  source: 'git' | 'git-untracked' | 'folder'
  connectionId: string
  name: string
  enabled: boolean
  intentScope: string
  state: LocalFileBrowserState<L, P>
  readListing: () => unknown
  readPreview: (path: string) => unknown
  processPreview?: (receipt: number) => unknown
  cancelProcessing?: () => unknown
  pdfOcrAvailable?: boolean
  dismiss: () => void
  onAttach?: (file: PreparedLocalFileSavedCopy) => void | Promise<unknown>
  isAttached?: (receipt: number, sourceKind?: LocalSavedCopySourceKind) => boolean
  isCurrent?: (receipt: number) => boolean
  subscribeCurrent?: (listener: () => void) => () => void
  compact?: boolean
  limitsLabel?: string
  afterContent?: ReactNode
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
  const previewImage = state.preview?.snapshot && 'image' in state.preview.snapshot ? state.preview.snapshot.image : null
  const previewIsImage = !!previewImage || state.preview?.imageFailure !== undefined || state.preview?.snapshot.omitted === 'image-import'
  const receipt = state.previewReceipt
  const sourceKind = source
  const previewAttached = (previewText !== null || previewImage !== null) && receipt !== null && !!isAttached?.(receipt, sourceKind)
  const canRecognizePdf = Boolean(state.preview?.pdfOcrInput && pdfOcrAvailable && processPreview && cancelProcessing)
  const isOcrPreview = state.preview?.documentImport?.format === 'pdf' && state.preview.documentImport.method === 'ocr'
  const showPdfOcrDisclosure = receipt !== null && (canRecognizePdf || isOcrPreview)
  const Header = headingLevel === 2 ? 'h2' : 'h3'
  const folder = source === 'folder'
  const dataSource = source === 'git-untracked' ? { 'data-local-git-untracked-browser': '' }
    : folder ? { 'data-local-folder-browser': '' } : { 'data-local-git-browser': '' }

  return <section {...dataSource} className="mt-4 min-w-0 space-y-3">
    <Header className="text-[15px] font-semibold text-ink">{title}</Header>
    {!compact && <p className="text-[13px] leading-relaxed text-ink-soft">{intro}</p>}
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
    {(!compact || limitsLabel) && <details className="text-[12px] leading-relaxed text-ink-soft">
      <summary className="cursor-pointer py-1">{limitsLabel ?? 'Browse limits and privacy'}</summary>
      <p className="py-1">{limitsCopy}</p>
    </details>}
    {onAttach && !compact && <p className="text-[12px] leading-relaxed text-ink-soft">Browsing never attaches content. Attach saved copy adds the exact selected preview to conversation context. Images are normalized to a PNG of at most 2,000 px per edge. {IMAGE_ORIGINAL_PRIVACY_COPY} Nothing uploads until you choose Attach. {outsideListingPrivacyCopy}</p>}
    {listing && <div className="min-w-0 space-y-3" data-local-folder-browser-listing={folder ? '' : undefined} data-local-git-browser-listing={source === 'git' ? '' : undefined} data-local-git-untracked-browser-listing={source === 'git-untracked' ? '' : undefined}>
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
      {state.preview && <div {...(folder ? { 'data-local-folder-file-preview': '' } : source === 'git-untracked' ? { 'data-local-git-untracked-file-preview': '' } : { 'data-local-git-file-preview': '' })} className="min-w-0 space-y-2">
        <h3 className="break-all font-mono text-[13px] text-ink">{state.preview.path}</h3>
        <p className="text-[12px] text-ink-soft">Read at {state.previewReadAt ? new Date(state.previewReadAt).toLocaleString() : 'this session'} · {state.preview.sizeBytes.toLocaleString()} {previewIsImage ? 'source bytes · image import limit 8 MiB. Preview shows the normalized first frame; ICO uses its largest image.' : state.preview.documentImport ? 'source bytes · extracted-text limit 65,536 bytes. Original document bytes are not saved.' : 'bytes · whole-file limit 65,536 bytes.'} This is not live; select the path again after changes.</p>
        {state.preview.documentImport && <p data-local-document-preview={state.preview.documentImport.format} role="status" className="text-[12px] leading-relaxed text-ink-soft">{canRecognizePdf && state.preview.documentImport.format === 'pdf' && state.preview.documentImport.status === 'no-text' ? 'No embedded PDF text was found. Recognize scanned text on this Mac, then review it below.' : documentImportCopy(state.preview.documentImport)}</p>}
        {showPdfOcrDisclosure && <div className="space-y-2">
          <p className="text-[12px] leading-relaxed text-ink-soft">On supported macOS desktop, OCR uses the already-read PDF bytes. Limits: 8 MiB, 100 pages, 64 KiB of text, and 120 seconds. Recognition replaces the preview with text for review; it does not save, upload, or send anything. Attach is separate.</p>
          {canRecognizePdf && receipt !== null && processPreview && cancelProcessing && <div className="flex flex-wrap items-center gap-2">
            {state.processingStatus === 'loading'
              ? <button type="button" className={`${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => cancelProcessing()}>Cancel recognition</button>
              : <button type="button" disabled={!enabled || state.pending} className={`${SOFT_BUTTON_CLASS} px-3 py-1.5 text-[12px]`} onClick={() => { void processPreview(receipt) }}>Recognize scanned text</button>}
            {state.processingStatus === 'loading' && <span role="status" className="text-[12px] text-ink-soft">Recognizing PDF text…</span>}
          </div>}
          {canRecognizePdf && state.processingStatus === 'error' && <p role="alert" className="text-[12px] text-danger-text">{state.processingError ?? 'Could not recognize PDF text. Your preview is unchanged; try again.'}</p>}
        </div>}
        {previewImage && <div className="flex max-h-96 min-h-24 min-w-0 items-center justify-center overflow-hidden rounded-md border border-line bg-canvas p-2">
          <img src={`data:image/png;base64,${previewImage.data}`} alt={`Preview of ${state.preview.path}`} width={previewImage.width} height={previewImage.height} className="max-h-80 max-w-full object-contain" />
          <p className="sr-only">{previewImage.width} by {previewImage.height} pixels, normalized PNG.</p>
        </div>}
        {previewImage && onAttach && <p className="text-[12px] leading-relaxed text-ink-soft">{IMAGE_ORIGINAL_PRIVACY_COPY} The exact original is retained only after you choose Attach.</p>}
        {'text' in state.preview.snapshot ? <>
          {state.preview.sizeBytes === 0 && state.preview.snapshot.text === '' && <p role="status" className="text-[12px] text-ink-soft">Empty file (0 bytes).</p>}
          <pre role="region" aria-label={`Preview of ${state.preview.path}`} tabIndex={0} className="max-h-96 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed text-ink" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.preview.snapshot.text}</pre>
        </> : 'omitted' in state.preview.snapshot && !state.preview.documentImport && <p role="status" className="text-[12px] text-ink-soft">{state.preview.snapshot.omitted === 'image-import' ? imageFailureCopy(state.preview.imageFailure) : omittedCopy(state.preview.snapshot.omitted ?? 'unreadable')}</p>}
        {(previewImage || previewText !== null) && onAttach && state.preview && receipt !== null && isCurrent && subscribeCurrent &&
          <LocalSavedCopyAction source={sourceKind} connectionId={connectionId} intentScope={intentScope} receipt={receipt}
            preview={state.preview} disabled={!enabled || state.pending} isAttached={previewAttached}
            isCurrent={isCurrent} subscribeCurrent={subscribeCurrent} onAttach={onAttach} />}
      </div>}
    </div>}
    {afterContent}
  </section>
}

function imageFailureCopy(reason: LocalBrowsePreview['imageFailure']): string {
  switch (reason) {
    case 'too-large': return 'This image exceeds the 8 MiB source limit; no image was returned.'
    case 'decode-failed': return 'This image could not be decoded safely; no image was returned.'
    case 'timeout': return 'Image normalization did not finish in time; no image was returned.'
    case 'unavailable': return 'Image normalization is unavailable on this device; no image was returned.'
    default: return 'This image could not be imported; no image was returned.'
  }
}
