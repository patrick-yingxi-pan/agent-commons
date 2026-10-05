import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitFileExecutable } from './gitFilePaths.mjs'

const DESKTOP_ROOT = dirname(fileURLToPath(import.meta.url))
const SOURCE_PATH = join(DESKTOP_ROOT, 'native', 'git-file.c')
const MACOS_MINIMUM_VERSION = '13.0'

function compilerArchitecture(targetArch) {
  if (targetArch === 'arm64') return 'arm64'
  if (targetArch === 'x64') return 'x86_64'
  throw new Error(`The macOS Git file helper does not support architecture ${targetArch}.`)
}

export function gitFileBuildPlan({
  targetPlatform = process.platform,
  targetArch = process.arch,
  outputPath = gitFileExecutable({ targetPlatform, targetArch }),
  testHooks = false,
} = {}) {
  if (targetPlatform !== 'darwin') return null
  const architecture = compilerArchitecture(targetArch)
  if (typeof outputPath !== 'string' || !outputPath.startsWith('/')) {
    throw new Error('The macOS Git file helper output path must be absolute.')
  }
  return {
    compiler: '/usr/bin/clang',
    outputPath,
    architecture,
    args: [
      '-std=c11',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O2',
      `-mmacosx-version-min=${MACOS_MINIMUM_VERSION}`,
      '-arch',
      architecture,
      ...(testHooks ? ['-DAGENT_COMMONS_GIT_FILE_TEST_HOOKS=1'] : []),
      SOURCE_PATH,
      '-o',
      outputPath,
    ],
  }
}

/** Build the descriptor-relative file reader before Electron or Packager starts. */
export function buildGitFileHelper({
  targetPlatform = process.platform,
  targetArch = process.arch,
  outputPath = gitFileExecutable({ targetPlatform, targetArch }),
  testHooks = false,
} = {}) {
  const plan = gitFileBuildPlan({ targetPlatform, targetArch, outputPath, testHooks })
  if (!plan) return null
  if (process.platform !== 'darwin') {
    throw new Error('Building the macOS Git file helper requires a macOS host with /usr/bin/clang.')
  }
  if (!existsSync(SOURCE_PATH)) throw new Error('The macOS Git file helper source is missing.')

  mkdirSync(dirname(outputPath), { recursive: true })
  const result = spawnSync(plan.compiler, plan.args, {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 128 * 1024,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TMPDIR: '/private/tmp' },
  })
  if (result.error) throw new Error('Could not run /usr/bin/clang to build the macOS Git file helper.', { cause: result.error })
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || '').trim()
    throw new Error(`Could not build the macOS Git file helper${diagnostic ? `: ${diagnostic}` : '.'}`)
  }
  chmodSync(outputPath, 0o755)
  return outputPath
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildGitFileHelper()
