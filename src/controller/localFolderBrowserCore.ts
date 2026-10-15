import type { LocalFolderFileListing } from '../../contract/localFolderBrowse.mjs'
import type { LocalBrowsePreview } from '../lib/localFilePreview.ts'
import { createLocalFileBrowserCore, type LocalFileBrowserState, type LocalPreviewProcessingResult } from './localFileBrowserCore.ts'

export type LocalFolderBrowseListing = LocalFolderFileListing
export type LocalFolderBrowsePreview = LocalBrowsePreview
export type LocalFolderBrowserState = LocalFileBrowserState<LocalFolderBrowseListing, LocalFolderBrowsePreview>

export function createLocalFolderBrowserCore(deps: {
  list(id: string): Promise<LocalFolderBrowseListing>
  preview(id: string, path: string, signal: AbortSignal): Promise<LocalFolderBrowsePreview>
  processPreview?(preview: LocalFolderBrowsePreview, signal: AbortSignal): Promise<LocalPreviewProcessingResult<LocalFolderBrowsePreview>>
  now(): number
}) {
  return createLocalFileBrowserCore({ ...deps, isPreviewable: kind => kind === 'file',
    listingError: 'Could not list folder paths. Check the connection and try again.',
    previewError: 'Could not read this file. Check the connection and try again.',
  })
}
