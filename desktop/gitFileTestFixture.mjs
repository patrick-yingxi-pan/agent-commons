import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
import { buildGitFileHelper } from './gitFileBuild.mjs'

/** Each suite owns its executable; concurrent compilers must never replace a
 * helper another suite (or the development app) is currently executing. */
export function buildGitFileTestHelper() {
  if (process.platform !== 'darwin') return undefined
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-git-test-helper-'))
  after(() => rmSync(directory, { recursive: true, force: true }))
  return buildGitFileHelper({ outputPath: join(directory, 'agent-commons-git-file') })
}
