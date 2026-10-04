import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = join(DESKTOP_ROOT, 'native', 'profile-acl.c')
const DEFAULT_OUTPUT_PATH = join(DESKTOP_ROOT, 'bin', 'profile-acl')
const MACOS_MINIMUM_VERSION = '13.0'

function compilerArchitecture(targetArch) {
  if (targetArch === 'arm64') return 'arm64'
  if (targetArch === 'x64') return 'x86_64'
  throw new Error(`The macOS profile ACL helper does not support architecture ${targetArch}.`)
}

export function profileHelperBuildPlan({
  targetPlatform = process.platform,
  targetArch = process.arch,
  outputPath = DEFAULT_OUTPUT_PATH,
} = {}) {
  if (targetPlatform !== 'darwin') return null
  const arch = compilerArchitecture(targetArch)
  return {
    compiler: '/usr/bin/clang',
    outputPath,
    args: [
      '-std=c11',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O2',
      `-mmacosx-version-min=${MACOS_MINIMUM_VERSION}`,
      '-arch',
      arch,
      SOURCE_PATH,
      '-o',
      outputPath,
    ],
  }
}

/** Build the tiny native ACL inspector before an Electron process starts. */
export function buildDesktopProfileHelper({
  targetPlatform = process.platform,
  targetArch = process.arch,
  outputPath = DEFAULT_OUTPUT_PATH,
} = {}) {
  const plan = profileHelperBuildPlan({ targetPlatform, targetArch, outputPath })
  if (!plan) return null
  if (process.platform !== 'darwin') {
    throw new Error('Building the macOS profile ACL helper requires a macOS host with /usr/bin/clang.')
  }
  if (!existsSync(SOURCE_PATH)) {
    throw new Error('The macOS profile ACL helper source is missing.')
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  const result = spawnSync(plan.compiler, plan.args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024 })
  if (result.error) {
    throw new Error('Could not run /usr/bin/clang to build the macOS profile ACL helper.', { cause: result.error })
  }
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || '').trim()
    throw new Error(`Could not build the macOS profile ACL helper${diagnostic ? `: ${diagnostic}` : '.'}`)
  }
  chmodSync(outputPath, 0o755)
  return outputPath
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildDesktopProfileHelper()
