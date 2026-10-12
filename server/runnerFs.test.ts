/** Shared runner filesystem authority: one fixed logical binding per runner,
 * with grants filtering the view rather than rebinding the physical root. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runner } from '../contract/index.ts'

const scope = '~/projects'

function runner(capabilities: Runner['capabilities'], id = 'runner-local'): Runner {
  return { id, label: id, host: 'fixture', status: 'online', lastSeen: 1, capabilities }
}

test('runnerFs caches its configured root, filters exact file grants, and keeps fixed mapping', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agent-commons-runner-fs-'))
  const originalEnv = process.env.CONTEXT_RUNNER_ROOT
  const firstRoot = join(parent, 'first-root')
  const replacementRoot = join(parent, 'replacement-root')
  mkdirSync(firstRoot)
  mkdirSync(join(firstRoot, 'folder'))
  writeFileSync(join(firstRoot, 'allowed.md'), 'allowed')
  writeFileSync(join(firstRoot, 'sibling.md'), 'sibling')
  writeFileSync(join(firstRoot, 'folder', 'inside.md'), 'inside')
  writeFileSync(join(firstRoot, 'folder', 'sibling.md'), 'folder sibling')
  for (let index = 0; index < 24; index += 1) {
    writeFileSync(join(firstRoot, 'folder', `${String(index).padStart(2, '0')}-private.md`), 'private')
  }
  writeFileSync(join(firstRoot, 'folder', 'zz-listed.md'), 'listed')
  mkdirSync(join(firstRoot, 'single'))
  writeFileSync(join(firstRoot, 'single', 'one.md'), 'one')
  process.env.CONTEXT_RUNNER_ROOT = firstRoot
  t.after(() => {
    if (originalEnv === undefined) delete process.env.CONTEXT_RUNNER_ROOT
    else process.env.CONTEXT_RUNNER_ROOT = originalEnv
    rmSync(parent, { recursive: true, force: true })
  })

  // This file has no static runnerFs import: the configured root must be read
  // after the isolated fixture is installed.
  const { runnerFs } = await import('./runnerFs.ts')

  const exact = runner([
    { type: 'fs.read', scopes: [`${scope}/allowed.md`, `${scope}/folder/inside.md`] },
    { type: 'fs.list', scopes: [`${scope}/allowed.md`, `${scope}/folder/inside.md`] },
  ])
  const exactFs = runnerFs(exact)
  assert.ok(exactFs)
  assert.deepEqual(exactFs.reader.list().files.map((entry) => entry.name), ['allowed.md'])
  assert.deepEqual(exactFs.reader.list().photos, [])
  assert.deepEqual(exactFs.reader.list().folders.map((entry) => [entry.name, entry.fileCount]), [['folder', 1]])
  assert.deepEqual(exactFs.reader.folderContents('folder')?.artifacts.map((entry) => entry.name), ['inside.md'])
  assert.equal(exactFs.reader.readText('allowed.md')?.text, 'allowed')
  assert.deepEqual(exactFs.reader.readSnapshot('allowed.md'), { name: 'allowed.md', text: 'allowed' })
  assert.equal(exactFs.reader.readSnapshot('sibling.md'), undefined, 'snapshot requires an exact fs.read grant')
  assert.equal(exactFs.reader.readText('sibling.md'), undefined)
  assert.equal(exactFs.relativeTarget(`${scope}/folder/inside.md`), 'folder/inside.md')

  // Folder capture exposes listed names only, and then applies an independent
  // exact fs.read check to each body. A read grant cannot reveal an unlisted name.
  const capture = (fs: NonNullable<ReturnType<typeof runnerFs>>, scope: 'flat' | 'recursive' = 'flat') => fs.reader.folderSnapshot('folder', undefined, scope)
  assert.deepEqual(await capture(exactFs), [
    { name: 'inside.md', sizeBytes: 6, snapshot: { text: 'inside' } },
  ])

  const listedAfterUnlistedCap = runnerFs(runner([
    { type: 'fs.list', scopes: [`${scope}/folder/zz-listed.md`] },
    { type: 'fs.read', scopes: [`${scope}/folder/zz-listed.md`] },
  ]))
  assert.ok(listedAfterUnlistedCap)
  assert.deepEqual(await capture(listedAfterUnlistedCap), [
    { name: 'zz-listed.md', sizeBytes: 6, snapshot: { text: 'listed' } },
  ], 'unlisted files do not consume the 24 readable-file budget or leak names')

  const listOnlyFolder = runnerFs(runner([
    { type: 'fs.list', scopes: [`${scope}/folder/inside.md`, `${scope}/folder/sibling.md`] },
  ]))
  assert.ok(listOnlyFolder)
  assert.equal(await capture(listOnlyFolder), undefined, 'listing alone cannot start a folder capture')

  const readWithoutList = runnerFs(runner([
    { type: 'fs.read', scopes: [`${scope}/folder/inside.md`] },
  ]))
  assert.ok(readWithoutList)
  assert.equal(await capture(readWithoutList), undefined)

  const mixedFolder = runnerFs(runner([
    { type: 'fs.list', scopes: [`${scope}/folder/inside.md`] },
    { type: 'fs.read', scopes: [`${scope}/folder/sibling.md`] },
  ]))
  assert.ok(mixedFolder)
  assert.deepEqual(await capture(mixedFolder), [
    { name: 'inside.md', sizeBytes: 6, snapshot: { omitted: 'unreadable' } },
  ])

  const maliciousAccess = {
    canList: () => true,
    canRead: () => true,
  }
  assert.deepEqual(await mixedFolder.reader.folderSnapshot('folder', maliciousAccess), [
    { name: 'inside.md', sizeBytes: 6, snapshot: { omitted: 'unreadable' } },
  ], 'caller access callbacks cannot widen runner grants')
  assert.deepEqual(await exactFs.reader.folderSnapshot('folder', maliciousAccess), [
    { name: 'inside.md', sizeBytes: 6, snapshot: { text: 'inside' } },
  ], 'caller access callbacks cannot expose unlisted names')

  mkdirSync(join(firstRoot, 'folder', 'branch', 'nested'), { recursive: true })
  writeFileSync(join(firstRoot, 'folder', 'branch', 'nested', 'only.md'), 'only')
  mkdirSync(join(firstRoot, 'folder', 'private-branch'))
  writeFileSync(join(firstRoot, 'folder', 'private-branch', 'hidden.md'), 'hidden')
  const narrowNested = runnerFs(runner([
    { type: 'fs.list', scopes: [`${scope}/folder/branch/nested/only.md`] },
    { type: 'fs.read', scopes: [`${scope}/folder/branch/nested/only.md`] },
  ]))
  assert.ok(narrowNested)
  assert.deepEqual(await capture(narrowNested, 'recursive'), [
    { name: 'branch/nested/only.md', sizeBytes: 4, snapshot: { text: 'only' } },
  ], 'list grants on a nested file permit traversing only its ancestors')
  assert.deepEqual(await narrowNested.reader.folderSnapshot('folder', maliciousAccess, 'recursive'), [
    { name: 'branch/nested/only.md', sizeBytes: 4, snapshot: { text: 'only' } },
  ], 'caller predicates cannot expose sibling names or bodies in recursive mode')

  const asyncTree = join(firstRoot, 'async-tree')
  const asyncNested = join(asyncTree, 'branch', 'nested')
  const asyncTarget = join(asyncNested, 'only.md')
  mkdirSync(asyncNested, { recursive: true })
  mkdirSync(join(asyncTree, 'empty-branch'))
  writeFileSync(asyncTarget, 'only')
  const asyncPath = `${scope}/async-tree`
  const nestedGrant = `${asyncPath}/branch/nested`
  const exactTargetGrant = `${nestedGrant}/only.md`
  const recursiveOnly = runnerFs(runner([
    { type: 'fs.list', scopes: [nestedGrant] },
    { type: 'fs.read', scopes: [exactTargetGrant] },
  ]))
  assert.ok(recursiveOnly)
  assert.deepEqual(await recursiveOnly.reader.folderSnapshot('async-tree', undefined, 'recursive'), [
    { name: 'branch/nested/only.md', sizeBytes: 4, snapshot: { text: 'only' } },
  ], 'the async fixture starts with one exact recursive file')

  // Recursive capture awaits its shared builder's dynamic import before body
  // reads. Queue grant changes only after the nested body's actual read, then
  // prove current authority is checked before any snapshot can be published.
  const captureAfterNestedRead = async (
    activeRunner: Runner,
    changedCapability: 'fs.list' | 'fs.read',
    changedScopes: string[],
  ) => {
    const mapped = runnerFs(activeRunner)
    assert.ok(mapped)
    const originalOpen = fs.openSync
    const originalRead = fs.readSync
    const targetDescriptors = new Set<number>()
    let changed = false
    t.mock.method(fs, 'openSync', (...args: any[]) => {
      const descriptor = originalOpen(...args)
      if (String(args[0]).endsWith('/async-tree/branch/nested/only.md')) targetDescriptors.add(descriptor)
      return descriptor
    })
    t.mock.method(fs, 'readSync', (...args: any[]) => {
      const count = originalRead(...args)
      if (!changed && targetDescriptors.has(args[0]) && count > 0) {
        changed = true
        queueMicrotask(() => {
          activeRunner.capabilities.find((capability) => capability.type === changedCapability)!.scopes = changedScopes
        })
      }
      return count
    })
    syncBuiltinESMExports()
    try {
      const result = await mapped.reader.folderSnapshot('async-tree', undefined, 'recursive')
      assert.equal(changed, true, 'authority mutation follows an actual nested file-body read')
      return result
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
    }
  }

  const asyncReadNarrowing = runner([
    { type: 'fs.list', scopes: [nestedGrant] },
    { type: 'fs.read', scopes: [exactTargetGrant] },
  ])
  assert.equal(await captureAfterNestedRead(asyncReadNarrowing, 'fs.read', [`${nestedGrant}/other.md`]), undefined,
    'a recursive body read cannot publish after its exact read grant narrows')

  const asyncListNarrowing = runner([
    { type: 'fs.list', scopes: [nestedGrant] },
    { type: 'fs.read', scopes: [exactTargetGrant] },
  ])
  assert.equal(await captureAfterNestedRead(asyncListNarrowing, 'fs.list', [`${nestedGrant}/other.md`]), undefined,
    'a recursive file cannot publish after its exact list grant narrows')

  const asyncTraversalNarrowing = runner([
    { type: 'fs.list', scopes: [exactTargetGrant, `${asyncPath}/empty-branch`] },
    { type: 'fs.read', scopes: [exactTargetGrant] },
  ])
  assert.equal(await captureAfterNestedRead(asyncTraversalNarrowing, 'fs.list', [exactTargetGrant]), undefined,
    'losing traversal authority for an enumerated empty branch invalidates the otherwise-authorized file')

  // Snapshot reads yield between files. Revoking read authority while capture
  // is in flight must invalidate the complete result after it rechecks grants.
  const revokingReadRunner = runner([
    { type: 'fs.list', scopes: [`${scope}/folder`] },
    { type: 'fs.read', scopes: [`${scope}/folder`] },
  ])
  const revokingReadFs = runnerFs(revokingReadRunner)
  assert.ok(revokingReadFs)
  const pendingReadCapture = capture(revokingReadFs!)
  revokingReadRunner.capabilities = [{ type: 'fs.list', scopes: [`${scope}/folder`] }]
  assert.equal(await pendingReadCapture, undefined, 'read authority revoked during capture invalidates the result')

  const narrowingReadRunner = runner([
    { type: 'fs.list', scopes: [`${scope}/folder`] },
    { type: 'fs.read', scopes: [`${scope}/folder`] },
  ])
  const narrowingReadFs = runnerFs(narrowingReadRunner)
  assert.ok(narrowingReadFs)
  const pendingNarrowReadCapture = capture(narrowingReadFs!)
  narrowingReadRunner.capabilities = [
    { type: 'fs.list', scopes: [`${scope}/folder`] },
    { type: 'fs.read', scopes: [`${scope}/allowed.md`] },
  ]
  assert.equal(await pendingNarrowReadCapture, undefined,
    'losing one captured file read grant invalidates the result even when another read grant remains')

  const revokingListRunner = runner([
    { type: 'fs.list', scopes: [`${scope}/folder`] },
    { type: 'fs.read', scopes: [`${scope}/folder`] },
  ])
  const revokingListFs = runnerFs(revokingListRunner)
  assert.ok(revokingListFs)
  const pendingListCapture = capture(revokingListFs!)
  revokingListRunner.capabilities = [{ type: 'fs.read', scopes: [`${scope}/folder`] }]
  assert.equal(await pendingListCapture, undefined, 'list authority revoked during capture invalidates the result')

  const narrowingListRunner = runner([
    { type: 'fs.list', scopes: [`${scope}/folder`] },
    { type: 'fs.read', scopes: [`${scope}/folder`] },
  ])
  const narrowingListFs = runnerFs(narrowingListRunner)
  assert.ok(narrowingListFs)
  const pendingNarrowListCapture = capture(narrowingListFs!)
  narrowingListRunner.capabilities = [
    { type: 'fs.list', scopes: [`${scope}/folder/sibling.md`] },
    { type: 'fs.read', scopes: [`${scope}/folder`] },
  ]
  assert.equal(await pendingNarrowListCapture, undefined,
    'losing one captured file list grant invalidates the result even when another list grant remains')

  // With one eligible file, two microtasks place narrowing after the base
  // reader's final check but before the runner facade resumes its own await.
  for (const capability of ['fs.read', 'fs.list'] as const) {
    const lateRunner = runner([
      { type: 'fs.list', scopes: [`${scope}/single`] },
      { type: 'fs.read', scopes: [`${scope}/single`] },
    ])
    const lateFs = runnerFs(lateRunner)
    assert.ok(lateFs)
    const pending = lateFs.reader.folderSnapshot('single')
    queueMicrotask(() => queueMicrotask(() => {
      lateRunner.capabilities.find((entry) => entry.type === capability)!.scopes = [`${scope}/single/other.md`]
    }))
    assert.equal(await pending, undefined, `${capability} narrowing across the facade await cannot publish a now-unpermitted copy`)
  }

  const wildcard = runner([
    { type: 'fs.read', scopes: ['*'] },
    { type: 'fs.list', scopes: ['*'] },
  ])
  const wildcardFs = runnerFs(wildcard)
  assert.ok(wildcardFs)
  assert.deepEqual(wildcardFs!.reader.list().files.map((entry) => entry.name).sort(), ['allowed.md', 'sibling.md'])
  assert.equal(wildcardFs!.reader.readText('folder/inside.md')?.text, 'inside')
  assert.equal(wildcardFs!.relativeTarget(`${scope}/folder/inside.md`), 'folder/inside.md')
  assert.equal(wildcardFs!.relativeTarget('~/other/inside.md'), undefined)

  for (const capabilities of [
    [],
    [{ type: 'fs.read', scopes: [] }],
    [{ type: 'fs.list', scopes: [] }],
    [{ type: 'fs.read', scopes: ['~/other'] }, { type: 'fs.list', scopes: ['~/other'] }],
  ] as Runner['capabilities'][]) {
    const resolved = runnerFs(runner(capabilities))
    assert.ok(resolved)
    assert.deepEqual(resolved!.reader.list(), { files: [], photos: [], folders: [] })
    assert.equal(resolved!.reader.folderContents('folder'), undefined)
    assert.equal(resolved!.reader.readText('allowed.md'), undefined)
    assert.equal(resolved!.reader.readSnapshot('allowed.md'), undefined)
    assert.equal(resolved!.supports('fs.read'), false)
    assert.equal(resolved!.supports('fs.list'), false)
  }

  const pendingReplacementCapture = capture(wildcardFs!)
  renameSync(firstRoot, replacementRoot)
  mkdirSync(firstRoot)
  writeFileSync(join(firstRoot, 'allowed.md'), 'replacement must not be adopted')
  assert.equal(await pendingReplacementCapture, undefined, 'folder capture refuses a root replaced in flight')
  assert.equal(runnerFs(wildcard)!.reader.list(), undefined, 'a replaced root is unavailable, not empty')
  assert.equal(runnerFs(wildcard)!.reader.readText('allowed.md'), undefined)
  assert.equal(await capture(wildcardFs!), undefined, 'folder capture refuses a replaced root')
})

test('runnerFs excludes empty or out-of-binding scopes and unknown/prototype-like ids', async () => {
  const { runnerFs } = await import('./runnerFs.ts')
  for (const id of ['runner-unknown', '__proto__', 'toString', 'constructor']) {
    assert.equal(runnerFs(runner([{ type: 'fs.read', scopes: ['*'] }], id)), undefined, id)
  }
})
