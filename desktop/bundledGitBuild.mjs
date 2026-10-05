import { spawn } from 'node:child_process'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_GIT, assertGitSourceArchive, bundledGitBuildPlan, bundledGitDirectory,
  bundledGitProbeEnvironment, verifyBundledGitDirectory,
} from './bundledGit.mjs'

export { assertGitSourceArchive, bundledGitBuildPlan } from './bundledGit.mjs'
const BIN_ROOT = fileURLToPath(new URL('./bin/', import.meta.url))

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: bundledGitProbeEnvironment(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const terminate = () => {
      if (!child.pid) return
      try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL') }
    }
    let output = ''
    let bytes = 0
    let failure
    const collect = (chunk) => {
      bytes += chunk.length
      output = `${output}${chunk}`.slice(-8_192)
      if (bytes > 4 * 1024 * 1024) { failure = new Error('Bundled Git build output exceeded its bound.'); terminate() }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => { failure = new Error('Bundled Git build exceeded its deadline.'); terminate() }, 180_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      if (failure) reject(failure)
      else if (signal || code !== 0) reject(new Error(`Bundled Git build failed (${signal ?? code}).\n${output}`))
      else resolve()
    })
  })
}

async function sourceBytes() {
  const cache = join(BIN_ROOT, BUNDLED_GIT.sourceArchive)
  try {
    const info = await lstat(cache)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error('Unsafe cached Git source.')
    const bytes = await readFile(cache)
    assertGitSourceArchive(bytes)
    return bytes
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  console.log(`[bundled-git] downloading pinned Git ${BUNDLED_GIT.version} source`)
  const response = await fetch(BUNDLED_GIT.sourceUrl, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
  if (!response.ok || !response.body) throw new Error('Could not download pinned Git source.')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > 16 * 1024 * 1024) throw new Error('Git source download exceeded its byte bound.')
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  assertGitSourceArchive(bytes)
  // Exclusive creation cannot overwrite an independently created/corrupt cache.
  await writeFile(cache, bytes, { flag: 'wx', mode: 0o644 })
  return bytes
}

/** Build only the native Git executable (no remote helpers or credential tools).
 * Full, unmodified corresponding source and this exact recipe travel with it.
 * Download/extraction/build inputs never become renderer or backend authority. */
export async function buildBundledGit({ targetPlatform = process.platform, targetArch = process.arch } = {}) {
  const plan = bundledGitBuildPlan({ targetPlatform, targetArch })
  if (!plan) return null
  if (process.platform !== 'darwin') throw new Error('Bundled macOS Git requires a macOS build host.')
  await mkdir(BIN_ROOT, { recursive: true })
  const bytes = await sourceBytes()
  const staging = await mkdtemp(join(BIN_ROOT, '.git-build-'))
  try {
    const archive = join(staging, BUNDLED_GIT.sourceArchive)
    await writeFile(archive, bytes)
    await run('/usr/bin/tar', ['-xzf', archive, '-C', staging], staging)
    const source = join(staging, `git-${BUNDLED_GIT.version}`)
    console.log(`[bundled-git] building ${BUNDLED_GIT.version} for ${targetArch}`)
    await run(plan.command, plan.args, source)
    const bundle = join(staging, 'agent-commons-git')
    await mkdir(bundle)
    for (const name of ['git', 'COPYING', 'LGPL-2.1']) await copyFile(join(source, name), join(bundle, name))
    await chmod(join(bundle, 'git'), 0o755)
    await copyFile(archive, join(bundle, BUNDLED_GIT.sourceArchive))
    await writeFile(join(bundle, 'build-recipe.json'), `${JSON.stringify({
      version: BUNDLED_GIT.version, sourceUrl: BUNDLED_GIT.sourceUrl,
      sourceSha256: BUNDLED_GIT.sourceSha256, ...plan,
      instructions: 'Extract the adjacent source archive on macOS with Apple command-line tools, then run command with args in the extracted source directory. Only git is built; link dependencies are macOS system libraries.',
    }, null, 2)}\n`)
    await verifyBundledGitDirectory(bundle, { targetArch, execute: targetArch === process.arch })
    const destination = bundledGitDirectory({ packaged: false, targetPlatform, targetArch })
    await mkdir(dirname(destination), { recursive: true })
    // Preserve a prior successful build until the new artifact has passed all
    // checks. Refuse to move a foreign directory or symlink from this location.
    let hadPrevious = false
    try {
      const previous = await lstat(destination)
      if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error('Unsafe previous Git build.')
      const recipe = JSON.parse(await readFile(join(destination, 'build-recipe.json'), 'utf8'))
      if (recipe.sourceUrl !== BUNDLED_GIT.sourceUrl || recipe.architecture !== plan.architecture) throw new Error('Unrecognized previous Git build.')
      await rename(destination, join(staging, 'previous'))
      hadPrevious = true
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    try { await rename(bundle, destination) }
    catch (error) {
      if (hadPrevious) await rename(join(staging, 'previous'), destination)
      throw error
    }
    console.log(`[bundled-git] verified ${BUNDLED_GIT.version} ${targetArch}, source + licenses included`)
    return destination
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildBundledGit()
