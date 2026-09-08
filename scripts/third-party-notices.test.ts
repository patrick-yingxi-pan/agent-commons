import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pdfDependencyNotice, thirdPartyNoticesPlugin } from './thirdPartyNotices.ts'

test('both distributions receive the installed PDF.js license and upstream notice', () => {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const license = readFileSync(join(root, 'LICENSE'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const emitted = []
  const plugin = thirdPartyNoticesPlugin()
  plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) })
  assert.equal(plugin.apply, 'build')
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].fileName, 'third-party/pdfjs-dist.txt')
  assert.equal(emitted[0].source, pdfDependencyNotice())
  assert.ok(emitted[0].source.startsWith(`${manifest.name} ${manifest.version}\n`))
  assert.ok(emitted[0].source.includes('Copyright 2024 Mozilla Foundation'))
  assert.ok(emitted[0].source.includes('@licend'))
  assert.ok(emitted[0].source.endsWith(license))
})
