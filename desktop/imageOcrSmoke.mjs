import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createImageOcrRunner, imageOcrExecutable } from './imageOcr.mjs'
import { imageOcrFixture } from './imageOcrFixture.mjs'

const require = createRequire(import.meta.url)
const { extractFile } = require('@electron/asar')

/** Generated pixels and the shipped executable, not a fixture OCR reply. This
 * checks the internal engine only; it grants no production IPC or save action. */
export async function smokePackagedImageOcr({ executable }) {
  if (process.platform !== 'darwin') return
  const resourcesPath = join(dirname(dirname(executable)), 'Resources')
  const helper = imageOcrExecutable({ packaged: true, resourcesPath })
  assert.deepEqual(extractFile(join(resourcesPath, 'app.asar'), 'desktop/imageOcr.mjs'),
    await readFile(new URL('./imageOcr.mjs', import.meta.url)), 'packaged OCR runtime equals tested source')
  const architecture = spawnSync('/usr/bin/lipo', ['-archs', helper], { encoding: 'utf8', timeout: 5_000, maxBuffer: 8_192 })
  assert.equal(architecture.status, 0, 'packaged OCR is a Mach-O executable')
  assert.equal(architecture.stdout.trim(), process.arch === 'arm64' ? 'arm64' : 'x86_64', 'OCR matches the native release architecture')
  const libraries = spawnSync('/usr/bin/otool', ['-L', helper], { encoding: 'utf8', timeout: 5_000, maxBuffer: 8_192 })
  assert.equal(libraries.status, 0, 'OCR link dependencies can be inspected')
  const dependencies = libraries.stdout.trim().split('\n').slice(1).map(line => line.trim().split(' (')[0])
  assert.ok(dependencies.length > 0 && dependencies.every(path => path.startsWith('/System/Library/') || path.startsWith('/usr/lib/')),
    'OCR links only OS-provided frameworks/libraries')
  const runner = createImageOcrRunner({ executable: helper })
  try {
    const text = 'Cobalt garden 427'
    const result = await runner.recognize(await imageOcrFixture({ text }))
    assert.equal(result.status, 'ready', 'shipped OCR extracts text from generated pixels')
    assert.equal(result.text, text, 'shipped recognition returns the actual complete line')
    assert.deepEqual(await runner.recognize(await imageOcrFixture({ text: '' })), { status: 'no-text' })
    assert.deepEqual(await runner.recognize(Buffer.from('not an image')), { status: 'invalid' })
    assert.deepEqual(await runner.recognize(await imageOcrFixture({ text }), { signal: AbortSignal.abort() }), { status: 'cancelled' })
  } finally {
    runner.dispose()
  }
  console.log('[desktop-smoke] internal on-device OCR · shipped native architecture · system-only frameworks · actual pixels/text · no-text/cancel/refusal · no UI or saved-text claim')
}
