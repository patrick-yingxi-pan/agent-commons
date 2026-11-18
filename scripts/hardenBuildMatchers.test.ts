import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import picomatch from 'picomatch'
import { rollup } from 'rollup'
import { globSync } from 'tinyglobby'

const repeatedGroupError = /Repeated extglobs are disabled/
const repeatedGroups = ['+(entry).ts', '*(entry).ts']

test('the installed parser inventory passes the read-only build guard', () => {
  const script = fileURLToPath(new URL('./hardenBuildMatchers.mjs', import.meta.url))
  const check = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' })
  assert.ifError(check.error)
  assert.equal(check.status, 0, check.stderr || check.stdout)
})

test('dependency glob APIs refuse repeated groups before matching', () => {
  for (const pattern of repeatedGroups) {
    assert.throws(() => picomatch(pattern), repeatedGroupError)
    assert.throws(() => picomatch.makeRe(pattern), repeatedGroupError)
    assert.throws(() => picomatch.parse(pattern), repeatedGroupError)
    assert.throws(() => globSync(pattern, { cwd: import.meta.dirname }), repeatedGroupError)
  }
  const acceptsSource = picomatch('**/*.{js,ts}')
  assert.ok(acceptsSource('src/controllers/entry.ts'))
  assert.equal(acceptsSource('src/controllers/entry.png'), false)
  assert.ok(picomatch('@(entry|index).?(c)js')('index.cjs'))
  assert.ok(globSync('hardenBuildMatchers*.{mjs,ts}', { cwd: import.meta.dirname }).includes('hardenBuildMatchers.test.ts'))
})

// Rollup compiles plugin filters with an embedded parser. An in-memory entry
// exercises that independent copy through an ordinary public build call.
async function transformsEntry(include: string): Promise<boolean> {
  const entry = join(tmpdir(), 'matcher-contract-entry.js')
  let transformed = false
  const bundle = await rollup({
    input: entry,
    plugins: [{
      name: 'matcher-contract',
      resolveId(id) { return id === entry ? entry : null },
      load(id) { return id === entry ? 'export const value = 1' : null },
      transform: {
        filter: { id: { include } },
        handler() { transformed = true; return null },
      },
    }],
  })
  await bundle.close()
  return transformed
}

test('Rollup preserves ordinary plugin filters and rejects repeated groups in its embedded matcher', async () => {
  assert.equal(await transformsEntry('**/matcher-contract-entry.js'), true)
  assert.equal(await transformsEntry('**/another-entry.js'), false)
  for (const pattern of repeatedGroups) {
    await assert.rejects(transformsEntry(pattern), repeatedGroupError)
  }
})
