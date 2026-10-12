import type { WorkspaceFolder } from '../../contract/index.ts'

/** Saved scope controls disclosure and full-path wrapping in every folder view. */
export function isRecursiveFolder(folder?: WorkspaceFolder): boolean {
  return folder?.localSnapshot?.version === 2 || folder?.snapshot?.version === 2
}

/** Catalogs count only direct files; intake scope never widens that metadata read. */
export function servedFolderFileCount(count: number): string {
  return `${count} top-level file${count === 1 ? '' : 's'}`
}
