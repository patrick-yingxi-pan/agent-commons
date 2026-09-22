/** The real source routes must preserve the reader's refusal, not leak bytes or
 * substitute a fixture. Each source is mapped only to this test's temp tree. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_CONTENT_BYTES } from '../fs.ts'

test('cloud and runner routes hide unsafe paths, preserve real content and refuse oversized bytes', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'agent-commons-fs-route-'))
  const root = join(parent, 'served')
  const outside = join(parent, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  mkdirSync(join(root, 'folder'))
  writeFileSync(join(root, 'notes.md'), 'actual served content')
  writeFileSync(join(root, 'folder', 'inside.txt'), 'actual nested content')
  writeFileSync(join(outside, 'secret.txt'), 'private outside bytes')
  symlinkSync(join(outside, 'secret.txt'), join(root, 'linked.txt'))
  symlinkSync(outside, join(root, 'linked-folder'))
  symlinkSync(join(outside, 'missing'), join(root, 'broken.txt'))
  const large = openSync(join(root, 'large.bin'), 'w')
  try { ftruncateSync(large, MAX_CONTENT_BYTES + 1) } finally { closeSync(large) }
  const prior = [process.env.CONTEXT_CLOUD_ROOT, process.env.CONTEXT_RUNNER_ROOT]
  t.after(() => {
    for (const [i, name] of ['CONTEXT_CLOUD_ROOT', 'CONTEXT_RUNNER_ROOT'].entries()) {
      if (prior[i] === undefined) delete process.env[name]
      else process.env[name] = prior[i]
    }
    rmSync(parent, { recursive: true, force: true })
  })
  process.env.CONTEXT_CLOUD_ROOT = root
  process.env.CONTEXT_RUNNER_ROOT = root
  // Import after the fixture configuration: the real store owns source readers.
  const { call, callRaw } = await import('../testkit/http.ts')
  for (const source of ['cloud', 'runner:runner-local']) {
    const url = (route: string, path?: string) => `/fs/${route}?source=${encodeURIComponent(source)}${path === undefined ? '' : `&path=${encodeURIComponent(path)}`}`
    const catalog = await call('GET', url('catalog'))
    assert.equal(catalog.status, 200)
    assert.deepEqual(catalog.json.files.map((file: { name: string }) => file.name).sort(), ['large.bin', 'notes.md'])
    assert.deepEqual(catalog.json.folders.map((folder: { name: string; fileCount: number }) => [folder.name, folder.fileCount]), [['folder', 1]])
    assert.equal((await call('GET', url('text', 'notes.md'))).json.text, 'actual served content')
    assert.equal((await callRaw('GET', url('content', 'notes.md'))).body, 'actual served content')
    const folder = await call('GET', url('folder', 'folder'))
    assert.equal(folder.status, 200)
    assert.deepEqual(folder.json.artifacts.map((artifact: { id: string }) => artifact.id), ['folder/inside.txt'])
    for (const path of ['linked.txt', 'linked-folder/secret.txt', 'broken.txt', '../outside/secret.txt',
      join(root, 'notes.md'), './notes.md', 'folder/../notes.md', 'notes.md\0']) {
      for (const route of ['text', 'content']) {
        const response = await callRaw('GET', url(route, path))
        assert.equal(response.status, 404, `${source}: ${route} ${JSON.stringify(path)}`)
        assert.ok(!response.body.includes('private outside bytes'))
        // The existing 404 may echo the caller's handle, but must not reveal a
        // configured root that was not already in that handle.
        if (!path.includes(parent)) assert.ok(!response.body.includes(parent), 'no filesystem path from an I/O exception')
      }
    }
    assert.equal((await call('GET', url('folder', 'linked-folder'))).status, 404)
    assert.equal((await call('GET', url('content', 'large.bin'))).status, 404)
  }
})
