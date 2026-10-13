import type { LocalGitFileListing, LocalGitFilePreview } from '../../contract/localGitBrowse.mjs'
import { createLocalFileBrowserCore, type LocalFileBrowserState } from './localFileBrowserCore.ts'

export type LocalGitBrowseEntry = LocalGitFileListing['files'][number]
export type LocalGitBrowseListing = LocalGitFileListing
export type LocalGitBrowsePreview = LocalGitFilePreview
export type LocalGitBrowserState = LocalFileBrowserState<LocalGitBrowseListing, LocalGitBrowsePreview>

export function createLocalGitBrowserCore(deps: {
  list(id: string): Promise<LocalGitBrowseListing>
  preview(id: string, path: string): Promise<LocalGitBrowsePreview>
  now(): number
}) {
  return createLocalFileBrowserCore({ ...deps, isPreviewable: kind => kind === 'file',
    listingError: 'Could not list tracked repository paths. Check the connection and try again.',
    previewError: 'Could not read this file. Check the connection and try again.',
  })
}
