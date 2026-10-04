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
  assert.deepEqual(exactFs!.reader.list().files.map((entry) => entry.name), ['allowed.md'])
  assert.deepEqual(exactFs!.reader.list().photos, [])
  assert.deepEqual(exactFs!.reader.list().folders.map((entry) => [entry.name, entry.fileCount]), [['folder', 1]])
  assert.deepEqual(exactFs!.reader.folderContents('folder')?.artifacts.map((entry) => entry.name), ['inside.md'])
  assert.equal(exactFs!.reader.readText('allowed.md')?.text, 'allowed')
  assert.equal(exactFs!.reader.readText('sibling.md'), undefined)
  assert.equal(exactFs!.relativeTarget(`${scope}/folder/inside.md`), 'folder/inside.md')

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
    assert.equal(resolved!.supports('fs.read'), false)
    assert.equal(resolved!.supports('fs.list'), false)
  }

  renameSync(firstRoot, replacementRoot)
  mkdirSync(firstRoot)
  writeFileSync(join(firstRoot, 'allowed.md'), 'replacement must not be adopted')
  assert.equal(runnerFs(wildcard)!.reader.list(), undefined, 'a replaced root is unavailable, not empty')
  assert.equal(runnerFs(wildcard)!.reader.readText('allowed.md'), undefined)
})

test('runnerFs excludes empty or out-of-binding scopes and unknown/prototype-like ids', async () => {
  const { runnerFs } = await import('./runnerFs.ts')
  for (const id of ['runner-unknown', '__proto__', 'toString', 'constructor']) {
    assert.equal(runnerFs(runner([{ type: 'fs.read', scopes: ['*'] }], id)), undefined, id)
  }
})
