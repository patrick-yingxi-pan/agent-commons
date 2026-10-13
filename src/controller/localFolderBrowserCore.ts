import type { LocalFolderFileListing, LocalFolderFilePreview } from '../../contract/localFolderBrowse.mjs'
import { createLocalFileBrowserCore, type LocalFileBrowserState } from './localFileBrowserCore.ts'

export type LocalFolderBrowseListing = LocalFolderFileListing
export type LocalFolderBrowsePreview = LocalFolderFilePreview
export type LocalFolderBrowserState = LocalFileBrowserState<LocalFolderBrowseListing, LocalFolderBrowsePreview>

export function createLocalFolderBrowserCore(deps: {
  list(id: string): Promise<LocalFolderBrowseListing>
  preview(id: string, path: string): Promise<LocalFolderBrowsePreview>
  now(): number
}) {
  return createLocalFileBrowserCore({ ...deps, isPreviewable: kind => kind === 'file',
    listingError: 'Could not list folder paths. Check the connection and try again.',
    previewError: 'Could not read this file. Check the connection and try again.',
  })
}
