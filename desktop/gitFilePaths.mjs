import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = dirname(fileURLToPath(import.meta.url))

function assertArchitecture(targetArch) {
  if (targetArch !== 'arm64' && targetArch !== 'x64') {
    throw new Error(`The macOS Git file helper does not support architecture ${targetArch}.`)
  }
}

export function gitFileExecutable({
  packaged = false,
  resourcesPath,
  targetArch = process.arch,
  targetPlatform = process.platform,
} = {}) {
  if (targetPlatform !== 'darwin') return null
  assertArchitecture(targetArch)
  if (packaged) {
    if (typeof resourcesPath !== 'string' || !resourcesPath.startsWith('/')) {
      throw new Error('A packaged macOS Git file helper requires an absolute Resources path.')
    }
    return join(resourcesPath, 'agent-commons-git-file')
  }
  return join(DESKTOP_ROOT, 'bin', `git-file-${targetArch}`, 'agent-commons-git-file')
}
