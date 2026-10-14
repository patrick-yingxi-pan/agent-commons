import type { LocalGitFilePreview } from './localGitBrowse.mjs'

export type LocalGitUntrackedFilesRequest = { scope: 'untracked'; operationId: string }
export type LocalGitUntrackedFileRequest = { scope: 'untracked'; path: string; operationId: string }
export type LocalGitUntrackedFileListing = {
  scope: 'untracked'
  version: 1
  files: Array<{ path: string; kind: 'file' | 'unsupported' }>
  excludedCount: number
}
export type LocalGitUntrackedFilePreview = LocalGitFilePreview & { scope: 'untracked' }
export function parseLocalGitUntrackedFilesRequest(value: unknown): LocalGitUntrackedFilesRequest | undefined
export function parseLocalGitUntrackedFileRequest(value: unknown): LocalGitUntrackedFileRequest | undefined
export function parseLocalGitUntrackedFileListing(value: unknown): LocalGitUntrackedFileListing | undefined
export function parseLocalGitUntrackedFilePreview(value: unknown): LocalGitUntrackedFilePreview | undefined
