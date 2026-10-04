/** Failed filesystem enumeration must stay unavailable across served and runner routes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function failReaddir(t: any, target: string, failOnOccurrence = 1) {
  const canonicalTarget = realpathSync(target)
  const original = fs.readdirSync
  let calls = 0
  t.mock.method(fs, 'readdirSync', function (path: any, ...args: any[]) {
    if (typeof path === 'string' && path === canonicalTarget) {
      calls++
      if (calls === failOnOccurrence) {
        throw Object.assign(new Error(`EACCES: private filesystem path ${canonicalTarget}`), { code: 'EACCES' })
      }
    }
    return original.call(this, path, ...args)
  })
  syncBuiltinESMExports()
  return () => calls
}

function clearFailures(t: any) {
  t.mock.restoreAll()
  syncBuiltinESMExports()
}

test('filesystem listing routes distinguish empty trees from failed reads and mapped invokes do not journal success', async (t) => {
  // Register cleanup before setup or dynamic application imports can fail.
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'agent-commons-fs-routes-')))
  const cloudRoot = join(parent, 'cloud')
  const runnerRoot = join(parent, 'runner')
  const priorRoots = [process.env.CONTEXT_CLOUD_ROOT, process.env.CONTEXT_RUNNER_ROOT]
  t.after(() => {
    t.mock.restoreAll()
    syncBuiltinESMExports()
    for (const [index, name] of ['CONTEXT_CLOUD_ROOT', 'CONTEXT_RUNNER_ROOT'].entries()) {
      if (priorRoots[index] === undefined) delete process.env[name]
      else process.env[name] = priorRoots[index]
    }
    rmSync(parent, { recursive: true, force: true })
  })

  mkdirSync(cloudRoot)
  mkdirSync(runnerRoot)
  process.env.CONTEXT_CLOUD_ROOT = cloudRoot
  process.env.CONTEXT_RUNNER_ROOT = runnerRoot
  const { call } = await import('../testkit/http.ts')
  const { store } = await import('../store/index.ts')

  // A genuinely empty root and empty child are successful, useful results.
  const emptyCatalog = await call('GET', '/fs/catalog?source=cloud')
  assert.equal(emptyCatalog.status, 200)
  assert.deepEqual(emptyCatalog.json.files, [])
  assert.deepEqual(emptyCatalog.json.photos, [])
  assert.deepEqual(emptyCatalog.json.folders, [])

  mkdirSync(join(cloudRoot, 'empty-folder'))
  const emptyFolder = await call('GET', '/fs/folder?source=cloud&path=empty-folder')
  assert.equal(emptyFolder.status, 200)
  assert.deepEqual(emptyFolder.json.artifacts, [])

  mkdirSync(join(cloudRoot, 'folder'))
  mkdirSync(join(runnerRoot, 'folder'))
  writeFileSync(join(cloudRoot, 'notes.md'), 'cloud recovery body')
  writeFileSync(join(cloudRoot, 'folder', 'inside.md'), 'cloud folder body')
  writeFileSync(join(runnerRoot, 'notes.md'), 'runner recovery body')
  writeFileSync(join(runnerRoot, 'folder', 'inside.md'), 'runner folder body')

  // Cloud root enumeration failure is a 404 with generic route copy, not 200 []
  // and not an exception containing the configured absolute path.
  assert.equal((await call('GET', '/fs/catalog?source=cloud')).json.files[0].name, 'notes.md')
  let count = failReaddir(t, cloudRoot)
  const failedCloudCatalog = await call('GET', '/fs/catalog?source=cloud')
  assert.equal(count(), 1, 'injection intercepted the real canonical cloud root')
  assert.equal(failedCloudCatalog.status, 404)
  assert.equal(JSON.stringify(failedCloudCatalog.json).includes(parent), false)
  clearFailures(t)
  const recoveredCloudCatalog = await call('GET', '/fs/catalog?source=cloud')
  assert.equal(recoveredCloudCatalog.status, 200)
  assert.deepEqual(recoveredCloudCatalog.json.files.map((file: any) => file.name), ['notes.md'])
  assert.deepEqual(recoveredCloudCatalog.json.folders.map((folder: any) => [folder.name, folder.fileCount]), [
    ['empty-folder', 0], ['folder', 1],
  ])

  // An unreadable child invalidates both its direct workspace read and the
  // parent catalog's file count; it must not be represented as an empty folder.
  count = failReaddir(t, join(cloudRoot, 'folder'))
  const failedCloudFolder = await call('GET', '/fs/folder?source=cloud&path=folder')
  assert.equal(count(), 1, 'injection intercepted the real canonical child folder')
  assert.equal(failedCloudFolder.status, 404)
  assert.equal(JSON.stringify(failedCloudFolder.json).includes(parent), false)
  clearFailures(t)
  const recoveredCloudFolder = await call('GET', '/fs/folder?source=cloud&path=folder')
  assert.equal(recoveredCloudFolder.status, 200)
  assert.deepEqual(recoveredCloudFolder.json.artifacts.map((entry: any) => [entry.id, entry.name]), [
    ['folder/inside.md', 'inside.md'],
  ])

  count = failReaddir(t, join(cloudRoot, 'folder'))
  const failedCloudCatalogChild = await call('GET', '/fs/catalog?source=cloud')
  assert.equal(count(), 1, 'catalog count scan intercepted the unreadable child')
  assert.equal(failedCloudCatalogChild.status, 404)
  assert.equal(JSON.stringify(failedCloudCatalogChild.json).includes(parent), false)
  clearFailures(t)
  const recoveredCloudCatalogChild = await call('GET', '/fs/catalog?source=cloud')
  assert.equal(recoveredCloudCatalogChild.status, 200)
  assert.deepEqual(recoveredCloudCatalogChild.json.folders.map((folder: any) => [folder.name, folder.fileCount]), [
    ['empty-folder', 0], ['folder', 1],
  ])

  // The mapped runner catalog enumerates each visible folder once for its
  // underlying scan and again for grant-filtered file counts. Refuse a failure
  // on that second scan instead of publishing a fabricated zero count.
  count = failReaddir(t, join(runnerRoot, 'folder'), 2)
  const failedRunnerCatalogChild = await call('GET', '/fs/catalog?source=runner:runner-local')
  assert.equal(count(), 2, 'second runner child scan (grant-filtered recount) was intercepted')
  assert.equal(failedRunnerCatalogChild.status, 404)
  assert.equal(JSON.stringify(failedRunnerCatalogChild.json).includes(parent), false)
  clearFailures(t)
  const recoveredRunnerCatalogChild = await call('GET', '/fs/catalog?source=runner:runner-local')
  assert.equal(recoveredRunnerCatalogChild.status, 200)
  assert.deepEqual(recoveredRunnerCatalogChild.json.folders.map((folder: any) => [folder.name, folder.fileCount]), [
    ['folder', 1],
  ])

  // The public runner source routes share the same fixed reader and recover
  // from failed root and child scans without exposing the native path.
  count = failReaddir(t, runnerRoot)
  const failedRunnerCatalog = await call('GET', '/fs/catalog?source=runner:runner-local')
  assert.equal(count(), 1)
  assert.equal(failedRunnerCatalog.status, 404)
  assert.equal(JSON.stringify(failedRunnerCatalog.json).includes(parent), false)
  clearFailures(t)
  const recoveredRunnerCatalog = await call('GET', '/fs/catalog?source=runner:runner-local')
  assert.equal(recoveredRunnerCatalog.status, 200)
  assert.deepEqual(recoveredRunnerCatalog.json.files.map((file: any) => file.name), ['notes.md'])

  count = failReaddir(t, join(runnerRoot, 'folder'))
  const failedRunnerSourceFolder = await call('GET', '/fs/folder?source=runner:runner-local&path=folder')
  assert.equal(count(), 1)
  assert.equal(failedRunnerSourceFolder.status, 404)
  assert.equal(JSON.stringify(failedRunnerSourceFolder.json).includes(parent), false)
  clearFailures(t)
  const recoveredRunnerSourceFolder = await call('GET', '/fs/folder?source=runner:runner-local&path=folder')
  assert.equal(recoveredRunnerSourceFolder.status, 200)
  assert.deepEqual(recoveredRunnerSourceFolder.json.artifacts.map((entry: any) => [entry.id, entry.name]), [
    ['folder/inside.md', 'inside.md'],
  ])

  // A mapped runner's failed root and child listings are refusals, never a
  // successful fs.list effect in the runner journal.
  const sessionId = 'auth-refactor'
  const contextId = 'ctx-fs-listing-failure-regression'
  store.attachContext(sessionId, {
    id: contextId,
    type: 'folder',
    label: 'runner',
    scope: '~/projects',
  })

  const rootCommand = 'cmd-fs-list-failure-root'
  count = failReaddir(t, runnerRoot)
  const failedRunnerRoot = await call('POST', '/runners/runner-local/invoke', {
    sessionId, contextId, capability: 'fs.list', target: '~/projects', commandId: rootCommand,
  })
  assert.equal(count(), 1, 'injection intercepted the real canonical runner root')
  assert.equal(failedRunnerRoot.status, 409)
  assert.equal(failedRunnerRoot.json.error.code, 'capability_unavailable')
  assert.equal(JSON.stringify(failedRunnerRoot.json).includes(parent), false)
  clearFailures(t)
  const runnerRootRetry = await call('POST', '/runners/runner-local/invoke', {
    sessionId, contextId, capability: 'fs.list', target: '~/projects', commandId: `${rootCommand}-retry`,
  })
  assert.equal(runnerRootRetry.status, 200)
  assert.deepEqual(runnerRootRetry.json.output.entries.map((entry: any) => entry.name), ['folder', 'notes.md'])

  const folderCommand = 'cmd-fs-list-failure-folder'
  count = failReaddir(t, join(runnerRoot, 'folder'))
  const failedRunnerFolder = await call('POST', '/runners/runner-local/invoke', {
    sessionId, contextId, capability: 'fs.list', target: '~/projects/folder', commandId: folderCommand,
  })
  assert.equal(count(), 1, 'injection intercepted the real canonical runner child folder')
  assert.equal(failedRunnerFolder.status, 409)
  assert.equal(failedRunnerFolder.json.error.code, 'capability_unavailable')
  assert.equal(JSON.stringify(failedRunnerFolder.json).includes(parent), false)
  clearFailures(t)
  const runnerFolderRetry = await call('POST', '/runners/runner-local/invoke', {
    sessionId, contextId, capability: 'fs.list', target: '~/projects/folder', commandId: `${folderCommand}-retry`,
  })
  assert.equal(runnerFolderRetry.status, 200)
  assert.deepEqual(runnerFolderRetry.json.output.entries.map((entry: any) => [entry.name, entry.kind]), [
    ['inside.md', 'doc'],
  ])

  const effects = await call('GET', '/runners/runner-local/effects')
  assert.equal(effects.status, 200, 'journal state was readable before checking refused and retried commands')
  for (const commandId of [rootCommand, folderCommand]) {
    assert.ok(!effects.json.some((effect: any) => effect.commandId === commandId), `${commandId} was not journaled`)
  }
  for (const commandId of [`${rootCommand}-retry`, `${folderCommand}-retry`]) {
    assert.ok(effects.json.some((effect: any) => effect.commandId === commandId), `${commandId} recovery was journaled`)
  }
})
