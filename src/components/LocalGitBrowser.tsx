import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import type { LocalSavedCopySourceKind } from '../controller/localGitSavedCopiesCore.ts'
import type { PreparedLocalFileSavedCopy } from '../controller/localFileSavedCopyCore.ts'
import { desktopPdfOcrAvailable } from '../api/desktopPdfOcr.ts'
import { localGitBrowser, useLocalGitBrowser } from '../controller/localGitBrowser.ts'
import { localGitConnections } from '../controller/localGitConnections.ts'
import { localGitUntrackedBrowser, localGitUntrackedOptIn, useLocalGitUntrackedBrowser, useLocalGitUntrackedOptIn } from '../controller/localGitUntrackedBrowser.ts'
import { LocalFileBrowserView } from './LocalFileBrowserView.tsx'
import { CheckboxRow } from './Checkbox.tsx'

export function LocalGitBrowser({ id, name, enabled, intentScope = '', onAttach, isAttached }: {
  id: LocalGitConnectionId
  name: string
  enabled: boolean
  intentScope?: string
  onAttach?: (file: PreparedLocalFileSavedCopy) => void | Promise<unknown>
  isAttached?: (receipt: number, sourceKind?: LocalSavedCopySourceKind) => boolean
}) {
  const state = useLocalGitBrowser(id)
  const untrackedEnabled = useLocalGitUntrackedOptIn(id)
  const untrackedState = useLocalGitUntrackedBrowser(id)
  const untrackedContent = <div className="mt-4 space-y-2 border-t border-line pt-3" data-local-git-untracked-intake>
    <CheckboxRow checked={untrackedEnabled} onToggle={() => localGitUntrackedOptIn.set(id, !untrackedEnabled)} disabled={!enabled} className="text-[13px] text-ink">
      <span>Browse untracked files</span>
    </CheckboxRow>
    {untrackedEnabled && <>
      <p className="text-[12px] leading-relaxed text-ink-soft">Untracked files can include new files and dotfiles with secrets. Ignored candidates are excluded; each ignored directory counts once.</p>
      <LocalFileBrowserView source="git-untracked" connectionId={id} name={name} enabled={enabled} intentScope={intentScope} state={untrackedState} compact headingLevel={3}
        readListing={() => localGitUntrackedBrowser.readListing(id)} readPreview={path => localGitUntrackedBrowser.readPreview(id, path)} dismiss={() => localGitUntrackedBrowser.dismiss(id)}
        processPreview={receipt => localGitUntrackedBrowser.processPreview(id, receipt)} cancelProcessing={() => localGitUntrackedBrowser.cancelProcessing(id)}
        pdfOcrAvailable={desktopPdfOcrAvailable()}
        onAttach={onAttach} isAttached={isAttached} isCurrent={receipt => localGitUntrackedOptIn.get(id) && localGitUntrackedBrowser.get(id).previewReceipt === receipt && !localGitUntrackedBrowser.get(id).pending && localGitConnections.get().status === 'ready' && localGitConnections.get().rows.some(row => row.id === id)}
        subscribeCurrent={listener => localGitUntrackedBrowser.subscribe(id, listener)} title="Untracked files" intro=""
        listLabel="List untracked paths" refreshLabel="Refresh untracked paths" listingNoun="untracked paths"
        loadingStatusCopy="Reading untracked paths…"
        outsideListingPrivacyCopy="It is available to model input when the conversation is next sent; attaching does not send a message or call the model."
        searchPlaceholder="Filter untracked paths" listAria="Untracked repository paths" pageAria="Untracked file pages"
        entryLabel={entry => entry.kind === 'file' ? 'Untracked file' : entry.kind === 'unsupported' ? 'Unsupported' : entry.kind}
        entryMessage={entry => entry.kind === 'unsupported' ? 'This path has a file type or state that this browser cannot preview.' : null}
        listingSummary={(listing, readAt) => <>Read at {readAt ? new Date(readAt).toLocaleString() : 'this session'} · {listing.files.length} untracked paths · {listing.excludedCount} ignored candidate entries excluded (each ignored directory counts once; unseen contents are not counted).</>}
        limitsLabel="Untracked listing limits"
        limitsCopy="The listing fails closed without partial results above 10,000 raw directory entries, 1,024 visited directories, depth 64, or 1 MiB of candidate-path bytes. Ignored candidate entries are excluded; an ignored directory counts once, and its unseen contents are not counted. Indexed paths, Git metadata aliases, and nested repositories are not traversed. Default PDF preview extracts embedded text only; selected PDFs can use separate explicit on-device OCR. Image previews accept PNG, JPEG, GIF, WebP, BMP, ICO, and self-contained static SVG up to 8 MiB; SVG scripts, animation, and external resources are unsupported. Images become normalized PNGs up to 2,000 px per edge, using the first frame or largest ICO image."
        omittedCopy={omission => omission === 'too-large' ? 'This file exceeds the 64 KiB preview limit; no content was returned.' : omission === 'unsupported' ? 'This file is not supported for text preview; no content was returned.' : 'The file could not be read; no content was returned.'} />
    </>}
  </div>

  return <LocalFileBrowserView source="git" connectionId={id} name={name} enabled={enabled} intentScope={intentScope} state={state}
    readListing={() => localGitBrowser.readListing(id)} readPreview={path => localGitBrowser.readPreview(id, path)} dismiss={() => localGitBrowser.dismiss(id)}
    processPreview={receipt => localGitBrowser.processPreview(id, receipt)} cancelProcessing={() => localGitBrowser.cancelProcessing(id)}
    pdfOcrAvailable={desktopPdfOcrAvailable()}
    onAttach={onAttach} isAttached={isAttached} isCurrent={receipt => localGitBrowser.get(id).previewReceipt === receipt && !localGitBrowser.get(id).pending && localGitConnections.get().status === 'ready' && localGitConnections.get().rows.some(row => row.id === id)}
    subscribeCurrent={listener => localGitBrowser.subscribe(id, listener)} title="Browse files"
    intro={`Browse tracked paths in ${name}. Listing reads bounded Git metadata and applicable ignore files to identify tracked paths and exclusions; it does not preview tracked file contents. Choose a path to read that file. Nothing is attached, persisted, or sent by browsing.`}
    listLabel="List tracked paths" refreshLabel="Refresh tracked paths" listingNoun="tracked paths"
    loadingStatusCopy="Reading bounded tracked-path metadata… Dismiss hides prior results; it does not change the repository."
    outsideListingPrivacyCopy="It is available to model input when the conversation is next sent; attaching does not send a message or call the model."
    searchPlaceholder="Filter tracked paths"
    listAria="Tracked repository paths" pageAria="Tracked file pages"
    entryLabel={entry => entry.kind === 'file' ? 'Tracked file' : entry.kind === 'conflict' ? 'Conflict' : entry.kind === 'sparse' ? 'Sparse checkout' : 'Unsupported'}
    entryMessage={entry => entry.kind === 'conflict' ? 'This path has an unresolved merge conflict and cannot be previewed as a single file.' : entry.kind === 'sparse' ? 'This path is outside the populated sparse checkout and has no local file content to preview.' : entry.kind === 'unsupported' ? 'This path has a file type or state that this browser cannot preview.' : null}
    listingSummary={(listing, readAt) => <>Read at {readAt ? new Date(readAt).toLocaleString() : 'this session'} · {listing.files.length} tracked paths · {listing.excludedCount} ignored paths excluded. This is a point-in-time listing; refresh to see later changes.</>}
    limitsCopy="The listing is bounded to 10,000 paths and includes tracked path status and the excluded-path count. Bounded Git metadata and applicable ignore files are read to compute it; tracked file contents are not previewed unless selected. Search and pagination operate over the full returned listing. Selecting a path reads only that file: whole text up to 64 KiB; PDF, DOCX, XLSX and PPTX sources up to 8 MiB with extracted text up to 64 KiB; or PNG, JPEG, GIF, WebP, BMP, ICO and self-contained static SVG images up to 8 MiB. SVG scripts, animation, and external resources are unsupported. Images become normalized PNGs up to 2,000 px per edge, using the first frame or largest ICO image. Default PDF preview extracts embedded text only; selected PDFs can use separate explicit on-device OCR. Other document extraction is text-only, without formula calculation. Original document bytes are never saved. Results stay in memory; Dismiss, Disconnect, changing accounts, reload, or closing the app clears them and cancels selected document or image processing."
    omittedCopy={omission => omission === 'too-large' ? 'This file exceeds the 64 KiB preview limit; no content was returned.' : omission === 'unsupported' ? 'This file is not supported for text preview; no content was returned.' : 'The file could not be read; no content was returned.'}
    afterContent={untrackedContent} />
}
