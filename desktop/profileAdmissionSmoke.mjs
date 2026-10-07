/** Packaged macOS profile admission acceptance. Every profile is a disposable
 * mkdtemp fixture. Inspector pauses before the packaged main module runs only
 * long enough to replace the blocking native error dialog with a captured
 * message; the real guard, executable and exit path remain in use. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAvailableLoopbackPort } from './runtime.mjs'
import { packagedExecutable } from './smokePaths.mjs'
import { AUTH_ROOT_FILE } from './authRoot.mjs'
import { createProcess, installStartupFixture, stopChild, waitForChildExit, waitForInspectorUrl } from './startupSmokeInspector.mjs'

const STARTUP_TIMEOUT_MS = 25_000
const DIALOG_MARKER = '[profile-admission-smoke-dialog] '
const SENTINEL = '.profile-admission-smoke-sentinel'
const SENTINEL_BYTES = Buffer.from('preserve this disposable profile exactly\0\x01')

async function launchRefused(executable, userDataPath) {
  const inspectorPort = await findAvailableLoopbackPort()
  const run = createProcess(executable, [
    `--inspect-brk=${inspectorPort}`,
    `--user-data-dir=${userDataPath}`,
  ])
  let inspector
  try {
    inspector = await installStartupFixture(await waitForInspectorUrl(run), `(() => {
      const moduleApi = process.getBuiltinModule('module')
      const electron = moduleApi.createRequire(process.resourcesPath + '/app.asar/package.json')('electron')
      if (electron.app.isReady()) throw new Error('Startup already reached ready')
      electron.dialog.showErrorBox = (title, content) => {
        process.getBuiltinModule('fs').writeSync(2, ${JSON.stringify(DIALOG_MARKER)} + JSON.stringify({ title, content }) + '\\n')
      }
      return typeof electron.app.exit === 'function'
    })()`)
    const exit = await waitForChildExit(run.child, STARTUP_TIMEOUT_MS, 'Refused packaged app')
    const marker = run.output().split(/\r?\n/).find(line => line.startsWith(DIALOG_MARKER))
    assert.ok(marker, `The packaged app did not show its native profile error.\n\n${run.output()}`)
    assert.equal(exit.code, 1, `Unsafe profile refusal should exit with status 1.\n\n${run.output()}`)
    assert.equal(exit.signal, null)
    assert.doesNotMatch(run.output(), /\[desktop\] ready /, 'a refused profile must not become ready')
    return JSON.parse(marker.slice(DIALOG_MARKER.length))
  } catch (error) {
    throw new Error(`Packaged profile refusal failed.\n${run.output()}`, { cause: error })
  } finally {
    inspector?.close()
    await stopChild(run.child)
  }
}

async function launchReady(executable, userDataPath) {
  const run = createProcess(executable, [`--user-data-dir=${userDataPath}`])
  try {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (Date.now() < deadline) {
      const match = run.output().match(/\[desktop\] ready (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) return { child: run.child, output: run.output, origin: match[1] }
      if (run.child.exitCode !== null || run.child.signalCode !== null) {
        throw new Error(`Repaired profile app exited before readiness.\n\n${run.output()}`)
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Repaired profile app did not become ready.\n\n${run.output()}`)
  } catch (error) {
    await stopChild(run.child)
    throw error
  }
}

async function withReadyProfile(executable, userDataPath, operation) {
  const run = await launchReady(executable, userDataPath)
  try { await operation(run) } finally { await stopChild(run.child) }
}

function aclListing(profilePath) {
  return execFileSync('/bin/ls', ['-lde', profilePath], { encoding: 'utf8' })
}

async function directorySnapshot(profilePath) {
  const info = await lstat(profilePath)
  const names = (await readdir(profilePath)).sort()
  const entries = []
  async function visit(directory, prefix = '') {
    const children = (await readdir(directory)).sort()
    for (const name of children) {
      const path = join(directory, name)
      const relativePath = prefix ? `${prefix}/${name}` : name
      const child = await lstat(path)
      const item = {
        path: relativePath,
        type: child.isDirectory() ? 'directory' : child.isFile() ? 'file' : child.isSymbolicLink() ? 'symlink' : 'other',
        mode: child.mode & 0o7777,
        size: child.size,
        mtimeMs: child.mtimeMs,
        ctimeMs: child.ctimeMs,
      }
      if (child.isFile()) item.sha256 = createHash('sha256').update(await readFile(path)).digest('hex')
      if (child.isSymbolicLink()) item.target = await readlink(path)
      entries.push(item)
      if (child.isDirectory()) await visit(path, relativePath)
    }
  }
  await visit(profilePath)
  return {
    mode: info.mode & 0o7777,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
    acl: aclListing(profilePath),
    names,
    entries,
  }
}

async function createProfileFixture(label) {
  const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), `agent-commons-${label}-`)))
  const profilePath = join(fixtureRoot, 'profile')
  try {
    await mkdir(profilePath, { mode: 0o700 })
    await writeFile(join(profilePath, SENTINEL), SENTINEL_BYTES, { mode: 0o600, flag: 'wx' })
    return { fixtureRoot, profilePath }
  } catch (error) {
    await rm(fixtureRoot, { recursive: true, force: true })
    throw error
  }
}

async function assertRefusalPreserved(executable, profilePath, expectedMode) {
  const before = await directorySnapshot(profilePath)
  assert.equal(before.mode, expectedMode)
  assert.deepEqual(before.names, [SENTINEL], 'fixture starts without auth, database, or vault data')

  const dialog = await launchRefused(executable, profilePath)
  assert.equal(dialog.title, 'Couldn’t protect Agent Commons data')
  assert.match(dialog.content, /Saved files and existing permissions were not changed/)
  assert.match(dialog.content, /Quit, preserve a backup/)
  assert.match(dialog.content, /mode 0700/)
  assert.match(dialog.content, /grant no ACL access to other users or groups/)
  assert.match(dialog.content, /do not make recursive changes or restore a database/)
  assert.match(dialog.content, /Reopen after repair/)

  const after = await directorySnapshot(profilePath)
  assert.deepEqual(after, before, 'refusal preserves exact fixture entries, contents, permissions and ACL')
  assert.deepEqual(await readFile(join(profilePath, SENTINEL)), SENTINEL_BYTES)
}

async function assertRepairAllowsRelaunch(executable, profilePath) {
  await withReadyProfile(executable, profilePath, async run => {
    assert.match(run.output(), /\[desktop\] ready /)
    const names = await readdir(profilePath)
    assert.ok(names.includes('store.db'), 'the manually repaired profile opens the real SQLite backend')
    assert.ok(names.includes(AUTH_ROOT_FILE), 'the repaired profile creates its normal device auth root')
    assert.deepEqual(await readFile(join(profilePath, SENTINEL)), SENTINEL_BYTES)
    const response = await fetch(run.origin, { redirect: 'error' })
    assert.equal(response.ok, true, 'the repaired native app serves its real local renderer')
  })
}

async function smokeModeRefusal(executable) {
  const fixture = await createProfileFixture('profile-mode-smoke-')
  try {
    await chmod(fixture.profilePath, 0o755)
    await assertRefusalPreserved(executable, fixture.profilePath, 0o755)
    // This chmod is test-owned and applies only to the throwaway fixture.
    await chmod(fixture.profilePath, 0o700)
    await assertRepairAllowsRelaunch(executable, fixture.profilePath)
  } finally {
    await rm(fixture.fixtureRoot, { recursive: true, force: true })
  }
}

async function smokeAbsentLeafStartup(executable) {
  const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'agent-commons-profile-absent-smoke-')))
  const profilePath = join(fixtureRoot, 'fresh-profile')
  try {
    assert.equal(existsSync(profilePath), false, 'fresh-start fixture begins without a profile leaf')
    await withReadyProfile(executable, profilePath, async run => {
      const profile = await lstat(profilePath)
      assert.equal(profile.isDirectory(), true)
      assert.equal(profile.isSymbolicLink(), false)
      assert.equal(profile.mode & 0o7777, 0o700, 'a missing leaf is created privately before startup')
      assert.match(run.output(), /\[desktop\] ready /)
      const names = await readdir(profilePath)
      assert.ok(names.includes('store.db'))
      assert.ok(names.includes(AUTH_ROOT_FILE))
    })
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

async function smokeAclRefusal(executable) {
  const fixture = await createProfileFixture('profile-acl-smoke-')
  let aclInstalled = false
  try {
    const initialAcl = aclListing(fixture.profilePath)
    assert.equal(initialAcl.trim().split(/\r?\n/).length, 1, 'fixture must begin without inherited extended ACL entries')
    execFileSync('/bin/chmod', ['+a', 'everyone allow read,search', fixture.profilePath])
    aclInstalled = true
    const acl = aclListing(fixture.profilePath)
    assert.match(acl, /everyone allow list,search/, 'fixture carries the intended everyone read/search ACL')
    assert.equal((await lstat(fixture.profilePath)).mode & 0o7777, 0o700, 'ACL case keeps private POSIX mode bits')
    await assertRefusalPreserved(executable, fixture.profilePath, 0o700)

    // Remove only the ACL entry this test installed, on its disposable profile.
    execFileSync('/bin/chmod', ['-N', fixture.profilePath])
    aclInstalled = false
    assert.equal(aclListing(fixture.profilePath).trim().split(/\r?\n/).length, 1)
    await assertRepairAllowsRelaunch(executable, fixture.profilePath)
  } finally {
    if (aclInstalled) execFileSync('/bin/chmod', ['-N', fixture.profilePath])
    await rm(fixture.fixtureRoot, { recursive: true, force: true })
  }
}

export async function smokePackagedProfileAdmission({ executable = packagedExecutable() } = {}) {
  if (process.platform !== 'darwin') {
    console.log('[desktop-profile-admission-smoke] skipped: macOS ACL acceptance requires a Darwin host')
    return
  }
  if (!existsSync(executable)) throw new Error(`Packaged desktop executable is missing: ${executable}`)
  await smokeAbsentLeafStartup(executable)
  await smokeModeRefusal(executable)
  await smokeAclRefusal(executable)
  console.log('[desktop-profile-admission-smoke] real packaged mode refusal + preserved files + manual repair + ready relaunch · everyone ACL refusal + preserved files + manual ACL repair + ready relaunch')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await smokePackagedProfileAdmission()
