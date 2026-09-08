import { arch, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Shared artifact lookup, independent of either executable acceptance harness. */
export function packagedExecutable(root = ROOT, targetPlatform = platform(), targetArch = arch()) {
  const artifact = join(root, 'out', `Agent Commons-${targetPlatform}-${targetArch}`)
  if (targetPlatform === 'darwin') return join(artifact, 'Agent Commons.app', 'Contents', 'MacOS', 'Agent Commons')
  if (targetPlatform === 'win32') return join(artifact, 'Agent Commons.exe')
  return join(artifact, 'Agent Commons')
}
