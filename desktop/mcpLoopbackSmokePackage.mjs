import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, cp, lstat, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { createPackageFromStreams, extractAll, extractFile, getRawHeader, uncache } = require('@electron/asar')
const FIXTURE_PREFIX = 'agent-commons-mcp-loopback-'
const STARTUP_PATH = 'scripts/start.mjs'
const SOURCE_SWITCH = 'allowLoopback: false,'
const FIXTURE_SWITCH = 'allowLoopback: true,'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function archiveEntries(files, prefix = '') {
  const entries = []
  for (const [name, entry] of Object.entries(files)) {
    const path = prefix ? `${prefix}/${name}` : name
    if (entry.files) {
      entries.push({ type: 'directory', path, unpacked: entry.unpacked === true })
      entries.push(...archiveEntries(entry.files, path))
    } else if (typeof entry.link === 'string') {
      entries.push({ type: 'link', path, unpacked: entry.unpacked === true, symlink: entry.link })
    } else {
      entries.push({ type: 'file', path, unpacked: entry.unpacked === true })
    }
  }
  return entries
}

async function assertCanonicalDirectory(path) {
  const details = await lstat(path)
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`Expected a real directory at ${path}`)
  const canonical = await realpath(path)
  if (canonical !== path) throw new Error(`Unexpected directory alias at ${path}`)
}

async function resolveSource(executable) {
  if (typeof executable !== 'string' || executable.length === 0) throw new TypeError('A macOS app executable path is required')
  const suppliedPath = resolve(executable)
  const executableInfo = await lstat(suppliedPath)
  if (!executableInfo.isFile() || executableInfo.isSymbolicLink()) throw new Error('The macOS app executable must be a regular file, not a symlink')
  const resolvedExecutable = await realpath(suppliedPath)

  const macOsDirectory = dirname(resolvedExecutable)
  const contentsDirectory = dirname(macOsDirectory)
  const appRoot = dirname(contentsDirectory)
  if (basename(macOsDirectory) !== 'MacOS' || basename(contentsDirectory) !== 'Contents' || !appRoot.endsWith('.app')) {
    throw new Error('Executable must be inside <name>.app/Contents/MacOS')
  }
  await assertCanonicalDirectory(appRoot)
  await assertCanonicalDirectory(contentsDirectory)
  await assertCanonicalDirectory(macOsDirectory)

  const resourcesDirectory = join(contentsDirectory, 'Resources')
  await assertCanonicalDirectory(resourcesDirectory)
  const asarPath = join(resourcesDirectory, 'app.asar')
  const asarInfo = await lstat(asarPath)
  if (!asarInfo.isFile() || asarInfo.isSymbolicLink() || await realpath(asarPath) !== asarPath) {
    throw new Error('The app bundle must contain a regular, non-aliased Contents/Resources/app.asar')
  }
  return { appRoot, executable: resolvedExecutable, asarPath }
}

async function removeOwnedRoot(root, parent) {
  const parentReal = await realpath(parent)
  if (parentReal !== parent) throw new Error('Temporary fixture parent changed identity')
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== root) {
    throw new Error('Generated fixture root changed identity; refusing cleanup')
  }
  if (dirname(root) !== parent || !basename(root).startsWith(FIXTURE_PREFIX)) {
    throw new Error('Refusing cleanup outside the generated fixture root')
  }
  await rm(root, { recursive: true, force: false })
}

/**
 * Build a private unsigned copy of a macOS app whose copied startup script
 * permits the loopback MCP smoke only. The source bundle is read-only here.
 */
export async function createMcpLoopbackSmokePackage(executable) {
  return createMcpFixturePackage(executable, [{ path: STARTUP_PATH, before: SOURCE_SWITCH, after: FIXTURE_SWITCH }])
}

/** Excluded acceptance-only transformations of existing files in an owned copy.
 * No flag, endpoint or injected module is installed in the source package. */
export async function createMcpFixturePackage(executable, patches) {
  if (!Array.isArray(patches) || !patches.length || patches.length > 8 || patches.some(patch =>
    !patch || Object.keys(patch).sort().join(',') !== 'after,before,path' ||
    typeof patch.path !== 'string' || !/^(desktop|server|scripts)\/[A-Za-z0-9_./-]+$/.test(patch.path) ||
    patch.path.split('/').some(part => !part || part === '.' || part === '..') ||
    typeof patch.before !== 'string' || !patch.before || typeof patch.after !== 'string' || !patch.after)) {
    throw new Error('Invalid isolated package patches')
  }
  const source = await resolveSource(executable)
  const originalAsar = await readFile(source.asarPath)
  const sourceAsarSha256 = sha256(originalAsar)
  const changes = new Map()
  for (const patch of patches) {
    const previous = changes.get(patch.path) ?? extractFile(source.asarPath, patch.path).toString('utf8')
    const occurrences = previous.split(patch.before).length - 1
    if (occurrences !== 1) throw new Error(`Expected exactly one ${JSON.stringify(patch.before)} in ${patch.path}; found ${occurrences}`)
    changes.set(patch.path, previous.replace(patch.before, patch.after))
  }

  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, FIXTURE_PREFIX))
  try {
    await chmod(root, 0o700)
    const canonicalRoot = await realpath(root)
    if (canonicalRoot !== root || dirname(root) !== parent || !basename(root).startsWith(FIXTURE_PREFIX)) {
      throw new Error('Generated fixture root failed its identity checks')
    }
    const copiedApp = join(root, basename(source.appRoot))
    await cp(source.appRoot, copiedApp, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
    const copiedExecutable = join(copiedApp, 'Contents', 'MacOS', basename(source.executable))
    const copiedAsar = join(copiedApp, 'Contents', 'Resources', 'app.asar')
    if (sha256(await readFile(source.asarPath)) !== sourceAsarSha256) throw new Error('Source ASAR changed while the fixture was being copied')

    const extracted = join(root, 'asar-work')
    extractAll(copiedAsar, extracted)
    for (const [path, contents] of changes) await writeFile(join(extracted, ...path.split('/')), contents)

    const header = getRawHeader(copiedAsar)
    const streams = []
    for (const entry of archiveEntries(JSON.parse(header.headerString).files)) {
      const extractedPath = join(extracted, ...entry.path.split('/'))
      if (entry.type === 'directory') {
        streams.push({ type: 'directory', path: entry.path, unpacked: entry.unpacked })
      } else if (entry.type === 'link') {
        streams.push({ type: 'link', path: entry.path, unpacked: entry.unpacked, symlink: entry.symlink, stat: await lstat(extractedPath) })
      } else {
        streams.push({
          type: 'file',
          path: entry.path,
          unpacked: entry.unpacked,
          stat: await stat(extractedPath),
          streamGenerator: () => createReadStream(extractedPath),
        })
      }
    }
    await createPackageFromStreams(copiedAsar, streams)
    uncache(copiedAsar)
    await rm(extracted, { recursive: true, force: false })

    for (const [path, contents] of changes) {
      if (extractFile(copiedAsar, path).toString('utf8') !== contents) throw new Error('Fixture ASAR did not receive exactly the expected changes')
    }
    if (sha256(await readFile(source.asarPath)) !== sourceAsarSha256) throw new Error('Source ASAR changed while the fixture was being built')
    await access(copiedExecutable, constants.X_OK)

    let closed = false
    return {
      executable: copiedExecutable,
      sourceAsarSha256,
      fixtureAsarSha256: sha256(await readFile(copiedAsar)),
      async close() {
        if (closed) return
        closed = true
        let sourceError
        try {
          if (sha256(await readFile(source.asarPath)) !== sourceAsarSha256) {
            sourceError = new Error('Source ASAR changed during MCP loopback smoke; source was not modified by fixture cleanup')
          }
        } finally {
          await removeOwnedRoot(root, parent)
        }
        if (sourceError) throw sourceError
      },
    }
  } catch (error) {
    await removeOwnedRoot(root, parent)
    throw error
  }
}
