import type { LocalGitFileListing } from '../../contract/localGitBrowse.mjs'
import type { LocalBrowsePreview } from '../lib/localFilePreview.ts'
import { createLocalFileBrowserCore, type LocalFileBrowserState } from './localFileBrowserCore.ts'

export type LocalGitBrowseEntry = LocalGitFileListing['files'][number]
export type LocalGitBrowseListing = LocalGitFileListing
export type LocalGitBrowsePreview = LocalBrowsePreview
export type LocalGitBrowserState = LocalFileBrowserState<LocalGitBrowseListing, LocalGitBrowsePreview>

export function createLocalGitBrowserCore(deps: {
  list(id: string): Promise<LocalGitBrowseListing>
  preview(id: string, path: string, signal: AbortSignal): Promise<LocalGitBrowsePreview>
  now(): number
}) {
  return createLocalFileBrowserCore({ ...deps, isPreviewable: kind => kind === 'file',
    listingError: 'Could not list tracked repository paths. Check the connection and try again.',
    previewError: 'Could not read this file. Check the connection and try again.',
  })
}
