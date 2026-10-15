import type { LocalFolderConnectionId } from '../../contract/localFolderCapture.ts'
import type { PreparedLocalFileSavedCopy } from '../controller/localFileSavedCopyCore.ts'
import { desktopPdfOcrAvailable } from '../api/desktopPdfOcr.ts'
import { localFolderBrowser, useLocalFolderBrowser } from '../controller/localFolderBrowser.ts'
import { localFolderConnections } from '../controller/localFolderConnections.ts'
import { LocalFileBrowserView } from './LocalFileBrowserView.tsx'

export function LocalFolderBrowser({ id, name, enabled, intentScope = '', onAttach, isAttached, headingLevel = 2 }: {
  id: LocalFolderConnectionId
  name: string
  enabled: boolean
  intentScope?: string
  onAttach?: (file: PreparedLocalFileSavedCopy) => void | Promise<unknown>
  isAttached?: (receipt: number) => boolean
  headingLevel?: 2 | 3
}) {
  const state = useLocalFolderBrowser(id)
  return <LocalFileBrowserView source="folder" connectionId={id} name={name} enabled={enabled} intentScope={intentScope} state={state}
    readListing={() => localFolderBrowser.readListing(id)} readPreview={path => localFolderBrowser.readPreview(id, path)} dismiss={() => localFolderBrowser.dismiss(id)}
    processPreview={receipt => localFolderBrowser.processPreview(id, receipt)} cancelProcessing={() => localFolderBrowser.cancelProcessing(id)}
    pdfOcrAvailable={desktopPdfOcrAvailable()}
    onAttach={onAttach} isAttached={isAttached} isCurrent={receipt => localFolderBrowser.get(id).previewReceipt === receipt && !localFolderBrowser.get(id).pending && localFolderConnections.get().status === 'ready' && localFolderConnections.get().rows.some(row => row.id === id)}
    subscribeCurrent={listener => localFolderBrowser.subscribe(id, listener)} headingLevel={headingLevel} title="Browse folder paths"
    intro={`List visible paths in ${name}. Listing reads bounded folder metadata; it does not read file contents. Choose one path to preview that file. Browsing does not attach, persist, or send content.`}
    listLabel="List folder paths" refreshLabel="Refresh folder paths" listingNoun="folder paths"
    loadingStatusCopy="Listing folder paths… Reading bounded folder metadata; Dismiss hides results without changing the folder."
    outsideListingPrivacyCopy="It is available to model input when the conversation is next sent; attaching does not send a message or call the model."
    searchPlaceholder="Filter folder paths"
    listAria="Folder paths" pageAria="Folder path pages"
    entryLabel={entry => entry.kind === 'file' ? 'File' : 'Unsupported'}
    entryMessage={entry => entry.kind === 'unsupported' ? 'This entry is unsupported for text preview.' : null}
    listingSummary={(listing, readAt) => <>Read at {readAt ? new Date(readAt).toLocaleString() : 'this session'} · {listing.files.length} visible paths · visited {listing.visited} entries · {listing.directoryCount} directories · {listing.hiddenCount} hidden paths excluded.</>}
    limitsCopy="Listing is bounded to 16 levels, 64 directories, and 500 entries. Hidden paths are excluded and counted. Search and pagination operate over the full returned listing. Selecting a supported file reads only that file: whole text up to 64 KiB; PDF, DOCX, XLSX and PPTX sources up to 8 MiB with extracted text up to 64 KiB; or PNG, JPEG, GIF, WebP, BMP, ICO and self-contained static SVG images up to 8 MiB. SVG scripts, animation, and external resources are unsupported. Images become normalized PNGs up to 2,000 px per edge, using the first frame or largest ICO image. Default PDF preview extracts embedded text only; selected PDFs can use separate explicit on-device OCR. Other document extraction is text-only, without formula calculation. Results are point-in-time, not live. Original document bytes are never saved. Results stay in memory; Dismiss, Disconnect, changing accounts, reload, or closing the app clears them and cancels document extraction or image processing."
    omittedCopy={omission => omission === 'too-large' ? 'This file exceeds the 64 KiB preview limit; no content was returned.' : omission === 'unsupported' ? 'This file is not supported for text preview; no content was returned.' : 'The file could not be read; no content was returned.'} />
}
