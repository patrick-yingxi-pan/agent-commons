import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { ROOT } from '../tests/helpers/source.ts'
import { pdfDependencyNotice, saxesDependencyNotice, thirdPartyNoticesPlugin, xmlcharsDependencyNotice, zipDependencyNotice } from './thirdPartyNotices.ts'

test('both distributions receive installed parser dependency licenses and upstream notices', () => {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const license = readFileSync(join(root, 'LICENSE'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const emitted = []
  const plugin = thirdPartyNoticesPlugin()
  plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) })
  assert.equal(plugin.apply, 'build')
  assert.equal(emitted.length, 4)
  assert.deepEqual(emitted.map((asset) => asset.fileName), [
    'third-party/pdfjs-dist.txt', 'third-party/@zip.js-zip.js.txt', 'third-party/saxes.txt', 'third-party/xmlchars.txt',
  ])
  assert.equal(emitted[0].source, pdfDependencyNotice())
  assert.ok(emitted[0].source.startsWith(`${manifest.name} ${manifest.version}\n`))
  assert.ok(emitted[0].source.includes('Copyright 2024 Mozilla Foundation'))
  assert.ok(emitted[0].source.includes('@licend'))
  assert.ok(emitted[0].source.endsWith(license))
  const packages = [
    ['third-party/@zip.js-zip.js.txt', '@zip.js/zip.js', zipDependencyNotice()],
    ['third-party/saxes.txt', 'saxes', saxesDependencyNotice()],
    ['third-party/xmlchars.txt', 'xmlchars', xmlcharsDependencyNotice()],
  ] as const
  for (const [fileName, name, notice] of packages) {
    const packageRoot = dirname(createRequire(import.meta.url).resolve(`${name}/package.json`))
    const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    const asset = emitted.find((item) => item.fileName === fileName)
    assert.ok(asset)
    assert.equal(asset.source, notice)
    assert.ok(asset.source.startsWith(`${packageManifest.name} ${packageManifest.version}\n`))
    if (name !== 'saxes') {
      assert.ok(asset.source.endsWith(readFileSync(join(packageRoot, 'LICENSE'), 'utf8')))
    } else {
      const vendored = readFileSync(join(ROOT, 'docs/third-party/saxes-6.0.0.txt'), 'utf8')
      assert.ok(vendored.includes('The ISC License'))
      assert.match(vendored, /Permission to use, copy, modify/)
      assert.match(vendored, /Copyright \(c\) Contributors/)
      assert.ok(asset.source.endsWith(vendored))
    }
  }
})
