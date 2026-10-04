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
  const capture = (fs: NonNullable<ReturnType<typeof runnerFs>>) => fs.reader.folderSnapshot('folder')
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
