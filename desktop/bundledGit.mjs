import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join, posix } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

// Pin changes require source, license, build and both native-architecture review.
export const BUNDLED_GIT = Object.freeze({
  version: '2.56.0',
  sourceArchive: 'git-2.56.0.tar.gz',
  sourceUrl: 'https://www.kernel.org/pub/software/scm/git/git-2.56.0.tar.gz',
  sourceSha256: '826817fd3671b8565586d6d49f688298de8354ab11db829c02720e5c74b9b39f',
})

export function bundledGitArchitecture(targetArch) {
  if (targetArch === 'arm64') return 'arm64'
  if (targetArch === 'x64') return 'x86_64'
  throw new Error(`Bundled Git requires arm64 or x64, received ${targetArch}.`)
}

export function bundledGitBuildPlan({ targetPlatform = process.platform, targetArch = process.arch } = {}) {
  if (targetPlatform !== 'darwin') return null
  const architecture = bundledGitArchitecture(targetArch)
  return {
    command: '/usr/bin/make', architecture,
    args: [
      '-j4', 'git', 'CC=/usr/bin/clang',
      `CFLAGS=-O2 -arch ${architecture} -mmacosx-version-min=13.0`,
      `LDFLAGS=-arch ${architecture} -mmacosx-version-min=13.0`,
      'NO_HOMEBREW=YesPlease', 'NO_FINK=YesPlease', 'NO_DARWIN_PORTS=YesPlease',
      'NO_CURL=YesPlease', 'NO_OPENSSL=YesPlease', 'NO_GETTEXT=YesPlease',
      'NO_RUST=YesPlease',
      'NO_PERL=YesPlease', 'NO_PYTHON=YesPlease', 'NO_TCLTK=YesPlease',
      'NO_EXPAT=YesPlease', 'NO_INSTALL_HARDLINKS=YesPlease',
      'USE_LIBPCRE2=', 'RUNTIME_PREFIX=YesPlease', 'prefix=/agent-commons-git',
    ],
  }
}

/** Native host/build-only resolution: never PATH or an environment override. */
export function bundledGitDirectory({
  packaged, resourcesPath, targetPlatform = process.platform, targetArch = process.arch,
}) {
  if (targetPlatform !== 'darwin') return null
  bundledGitArchitecture(targetArch)
  if (packaged) {
    if (typeof resourcesPath !== 'string' || !isAbsolute(resourcesPath)) throw new Error('Bundled Git resources are unavailable.')
    return join(resourcesPath, 'agent-commons-git')
  }
  return fileURLToPath(new URL(`./bin/git-${targetArch}/agent-commons-git`, import.meta.url))
}

export function assertGitSourceArchive(bytes) {
  if (bytes?.byteLength > 16 * 1024 * 1024) throw new Error('Bundled Git source exceeds the 16 MiB size bound.')
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength ||
    createHash('sha256').update(bytes).digest('hex') !== BUNDLED_GIT.sourceSha256) {
    throw new Error('Bundled Git source archive does not match its pinned SHA-256.')
  }
}

/** This environment is also used by build and acceptance probes. It deliberately
 * does not inherit GIT_*, DYLD_*, HOME, PATH, credentials or caller configuration.
 * Repository operations need a separate closed operation API; this module grants
 * no renderer/HTTP authority and never opens a user's repository. */
export function bundledGitProbeEnvironment() {
  return {
    PATH: '/usr/bin:/bin', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null', GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
  }
}

async function regularFile(path, maxBytes) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > maxBytes) {
    throw new Error('Bundled Git has a missing, unsafe or oversized resource.')
  }
  return info
}

function checkedProbe(command, args, run) {
  const result = run(command, args, {
    env: bundledGitProbeEnvironment(), cwd: '/', encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, maxBuffer: 64 * 1024,
  })
  if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error('Bundled Git verification failed.')
  }
  return result.stdout.trim()
}

export function assertBundledGitProbes({ architectures, libraries, version }, targetArch, { execute = true } = {}) {
  if (architectures !== bundledGitArchitecture(targetArch)) throw new Error('Bundled Git architecture does not match the target.')
  const linked = libraries.split('\n').slice(1)
  if (linked.length === 0 || linked.some((line) => {
    const path = /^\s+(\/(?:usr\/lib|System\/Library\/Frameworks)\/[^\s]+) \(/.exec(line)?.[1]
    return !path || posix.normalize(path) !== path
  })) {
    throw new Error('Bundled Git must link only macOS system libraries.')
  }
  if (execute && version !== `git version ${BUNDLED_GIT.version}`) throw new Error('Bundled Git version does not match the pin.')
}

/** Used before packaging and on the actual extracted artifact. Code signing may
 * change executable bytes, so architecture, load commands, version and source
 * identity are checked independently; this is not a substitute for codesign. */
export async function verifyBundledGitDirectory(directory, { targetArch = process.arch, run = spawnSync, execute = true } = {}) {
  const architecture = bundledGitArchitecture(targetArch)
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('Bundled Git directory must be absolute.')
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Bundled Git directory is unsafe.')
  const executable = join(directory, 'git')
  const binary = await regularFile(executable, 64 * 1024 * 1024)
  if (!(binary.mode & 0o111)) throw new Error('Bundled Git is not executable.')
  const source = join(directory, BUNDLED_GIT.sourceArchive)
  await regularFile(source, 16 * 1024 * 1024)
  assertGitSourceArchive(await readFile(source))
  for (const [license, hash] of [
    ['COPYING', '5b2198d1645f767585e8a88ac0499b04472164c0d2da22e75ecf97ef443ab32e'],
    ['LGPL-2.1', '1922f45d2c49e390032c9c0ba6d7cac904087f7cec51af30c2b2ad022ce0e76a'],
  ]) {
    await regularFile(join(directory, license), 128 * 1024)
    if (createHash('sha256').update(await readFile(join(directory, license))).digest('hex') !== hash) {
      throw new Error('Bundled Git license does not match the pinned source.')
    }
  }
  await regularFile(join(directory, 'build-recipe.json'), 16 * 1024)
  const recipe = JSON.parse(await readFile(join(directory, 'build-recipe.json'), 'utf8'))
  const plan = bundledGitBuildPlan({ targetPlatform: 'darwin', targetArch })
  if (recipe.version !== BUNDLED_GIT.version || recipe.sourceSha256 !== BUNDLED_GIT.sourceSha256 ||
    recipe.sourceUrl !== BUNDLED_GIT.sourceUrl || recipe.architecture !== architecture ||
    recipe.command !== plan.command || !isDeepStrictEqual(recipe.args, plan.args)) {
    throw new Error('Bundled Git build recipe does not match the target.')
  }
  assertBundledGitProbes({
    architectures: checkedProbe('/usr/bin/lipo', ['-archs', executable], run),
    libraries: checkedProbe('/usr/bin/otool', ['-L', executable], run),
    version: execute ? checkedProbe(executable, ['--version'], run) : undefined,
  }, targetArch, { execute })
  return executable
}
