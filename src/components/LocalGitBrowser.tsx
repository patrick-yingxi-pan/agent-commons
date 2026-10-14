import type { LocalGitConnectionId } from '../../contract/localGitCapture.ts'
import type { DocumentImportOutcome } from '../../contract/documentImport.mjs'
import { localGitBrowser, useLocalGitBrowser } from '../controller/localGitBrowser.ts'
import { LocalFileBrowserView } from './LocalFileBrowserView.tsx'

export function LocalGitBrowser({ id, name, enabled, intentScope = '', onAttach, isAttached }: {
  id: LocalGitConnectionId
  name: string
  enabled: boolean
  intentScope?: string
  onAttach?: (path: string, text: string, receipt: number, documentImport?: DocumentImportOutcome) => void | Promise<unknown>
  isAttached?: (receipt: number) => boolean
}) {
  const state = useLocalGitBrowser(id)
  return <LocalFileBrowserView source="git" connectionId={id} name={name} enabled={enabled} intentScope={intentScope} state={state}
    readListing={() => localGitBrowser.readListing(id)} readPreview={path => localGitBrowser.readPreview(id, path)} dismiss={() => localGitBrowser.dismiss(id)}
    onAttach={onAttach} isAttached={isAttached} title="Browse files"
    intro={`Browse tracked paths in ${name}. Listing reads bounded Git metadata and applicable ignore files to identify tracked paths and exclusions; it does not preview tracked file contents. Choose a path to read that file. Nothing is attached, persisted, or sent by browsing.`}
    listLabel="List tracked paths" refreshLabel="Refresh tracked paths" listingNoun="tracked paths"
    loadingStatusCopy="Reading bounded tracked-path metadata… Dismiss hides prior results; it does not change the repository."
    outsideListingPrivacyCopy="It is available to model input when the conversation is next sent; attaching does not send a message or call the model."
    searchPlaceholder="Filter tracked paths"
    listAria="Tracked repository paths" pageAria="Tracked file pages"
    entryLabel={entry => entry.kind === 'file' ? 'Tracked file' : entry.kind === 'conflict' ? 'Conflict' : entry.kind === 'sparse' ? 'Sparse checkout' : 'Unsupported'}
    entryMessage={entry => entry.kind === 'conflict' ? 'This path has an unresolved merge conflict and cannot be previewed as a single file.' : entry.kind === 'sparse' ? 'This path is outside the populated sparse checkout and has no local file content to preview.' : entry.kind === 'unsupported' ? 'This path has a file type or state that this browser cannot preview.' : null}
    listingSummary={(listing, readAt) => <>Read at {readAt ? new Date(readAt).toLocaleString() : 'this session'} · {listing.files.length} tracked paths · {listing.excludedCount} ignored paths excluded. This is a point-in-time listing; refresh to see later changes.</>}
    limitsCopy="The listing is bounded to 10,000 paths and includes tracked path status and the excluded-path count. Bounded Git metadata and applicable ignore files are read to compute it; tracked file contents are not previewed unless selected. Search and pagination operate over the full returned listing. Selecting a path reads only that file: whole text up to 64 KiB, or PDF, DOCX, XLSX and PPTX sources up to 8 MiB with extracted text up to 64 KiB. Document extraction is text-only, without OCR or formula calculation. Original document bytes are never saved. Results stay in memory; Dismiss, Disconnect, changing accounts, reload, or closing the app clears them and cancels document extraction."
    omittedCopy={omission => omission === 'too-large' ? 'This file exceeds the 64 KiB preview limit; no content was returned.' : omission === 'unsupported' ? 'This file is not supported for text preview; no content was returned.' : 'The file could not be read; no content was returned.'} />
}
