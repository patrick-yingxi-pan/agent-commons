/** Worker entry graphs are invisible to the HTML dependency crawl. Discover
 * their packages before first use so Vite cannot reload an in-flight intake. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { optimizeDeps, resolveConfig } from 'vite'
import { ROOT } from './helpers/source.ts'

test('shared collaboration policy cannot fold a lazy draft back into the full navigation chunk', async () => {
  const config = await resolveConfig({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'silent' }, 'build')
  const output = config.build.rollupOptions.output
  assert.ok(output && !Array.isArray(output))
  assert.equal(typeof output.manualChunks, 'function')
  const chunk = output.manualChunks as (id: string) => string | undefined
  assert.equal(chunk(join(ROOT, 'contract/roles.ts')), 'collaboration-policy')
  assert.equal(chunk(join(ROOT, 'src/lib/dispatchPresentation.ts')), 'collaboration-policy')
  assert.equal(chunk(join(ROOT, 'src/lib/automationPresentation.ts')), 'collaboration-policy')
  assert.equal(chunk(join(ROOT, 'src/lib/countLabel.ts')), 'resource-presentation')
  assert.equal(chunk(join(ROOT, 'src/components/SectionView.tsx')), undefined)
})

test('the cold dependency scan includes lazy document worker dependencies', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'agent-commons-vite-scan-'))
  try {
    const config = await resolveConfig({
      root: ROOT,
      configFile: join(ROOT, 'vite.config.ts'),
      cacheDir: cache,
      logLevel: 'silent',
    }, 'serve')
    const metadata = await optimizeDeps(config, true, true)
    assert.ok(Object.hasOwn(metadata.optimized, 'react'), 'the ordinary HTML entry graph must still be scanned')
    for (const dependency of ['@zip.js/zip.js/lib/zip-core-custom.js', 'saxes', 'pdfjs-dist']) {
      assert.ok(Object.hasOwn(metadata.optimized, dependency), `${dependency} must be discovered before a user imports a document`)
    }
  } finally {
    rmSync(cache, { recursive: true, force: true })
  }
})
