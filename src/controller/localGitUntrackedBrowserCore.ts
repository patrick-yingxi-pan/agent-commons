import type { LocalGitFileListing } from '../../contract/localGitBrowse.mjs'
import type { LocalBrowsePreview } from '../lib/localFilePreview.ts'
import { createLocalFileBrowserCore, type LocalFileBrowserState, type LocalPreviewProcessingResult } from './localFileBrowserCore.ts'

export type LocalGitUntrackedListing = LocalGitFileListing
export type LocalGitUntrackedPreview = LocalBrowsePreview
export type LocalGitUntrackedBrowserState = LocalFileBrowserState<LocalGitUntrackedListing, LocalGitUntrackedPreview>

export function createLocalGitUntrackedBrowserCore(deps: {
  list(id: string, signal: AbortSignal): Promise<LocalGitUntrackedListing>
  preview(id: string, path: string, signal: AbortSignal): Promise<LocalGitUntrackedPreview>
  processPreview?(preview: LocalGitUntrackedPreview, signal: AbortSignal): Promise<LocalPreviewProcessingResult<LocalGitUntrackedPreview>>
  now(): number
}) {
  return createLocalFileBrowserCore({ ...deps, isPreviewable: kind => kind === 'file',
    listingError: 'Could not list untracked repository paths. Check the connection and try again.',
    previewError: 'Could not read this file. Check the connection and try again.',
  })
}
