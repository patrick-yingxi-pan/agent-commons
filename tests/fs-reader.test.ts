/** The served-filesystem reader (server/fs.ts) — real `fs` access rooted at one
 *  directory. Exercised against the in-repo `sample-cloud/` tree so it's
 *  deterministic and needs no env. Locks the scan shape, the ext→kind map, real
 *  text/byte reads, and the traversal guard. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fsReader, kindForExt, isImageExt, contentTypeForExt } from '../server/fs.ts'

const reader = fsReader(join(process.cwd(), 'sample-cloud'))

test('list(): top-level files / photos / folders are classified by kind', () => {
  const { files, photos, folders } = reader.list()
  const fileNames = files.map((f) => f.name)
  assert.ok(fileNames.includes('q3-roadmap.md'), 'a doc file is listed')
  assert.ok(fileNames.includes('metrics.csv'), 'a csv file is listed')
  // Images are split out into photos, never files.
  assert.ok(!fileNames.some((n) => n.endsWith('.svg')), 'no images leak into files')
  assert.ok(photos.map((p) => p.name).includes('mockup.svg'), 'an svg is a photo')
  assert.ok(folders.map((d) => d.name).includes('insights-dashboard'), 'a subdir is a folder')
  // Entry ids are the root-relative path (the content handle).
  assert.equal(files.find((f) => f.name === 'metrics.csv')?.id, 'metrics.csv')
  assert.equal(files.find((f) => f.name === 'metrics.csv')?.kind, 'sheet')
})

test('folderContents(): a sub-folder scans into real artifacts', () => {
  const got = reader.folderContents('insights-dashboard')
  assert.ok(got, 'folder resolves')
  const names = got!.artifacts.map((a) => a.name)
  assert.ok(names.includes('readme.md'))
  assert.ok(names.includes('dashboard-preview.svg'))
  // The image artifact maps to the image kind; its id is the source-relative path.
  const img = got!.artifacts.find((a) => a.name === 'dashboard-preview.svg')!
  assert.equal(img.kind, 'image')
  assert.equal(img.id, 'insights-dashboard/dashboard-preview.svg')
})

test('readText(): real text for a text file; image files report their kind', () => {
  const md = reader.readText('notes.md')
  assert.equal(md?.kind, 'text')
  assert.match(md!.text!, /Insights/)
  const svg = reader.readText('mockup.svg')
  assert.equal(svg?.kind, 'image')
  assert.equal(svg?.contentType, 'image/svg+xml')
  assert.equal(svg?.text, undefined)
})

test('readBytes(): real bytes + content type for an image', () => {
  const got = reader.readBytes('mockup.svg')
  assert.ok(got, 'bytes resolve')
  assert.equal(got!.contentType, 'image/svg+xml')
  assert.ok(got!.bytes.length > 0, 'non-empty bytes')
})

test('traversal guard: a path escaping the root resolves to nothing', () => {
  assert.equal(reader.readText('../package.json'), undefined)
  assert.equal(reader.readBytes('../../etc/passwd'), undefined)
  assert.equal(reader.folderContents('..'), undefined)
})

test('missing entries return undefined, not a throw', () => {
  assert.equal(reader.readText('nope.md'), undefined)
  assert.equal(reader.folderContents('nope'), undefined)
})

test('ext → kind map + helpers', () => {
  assert.equal(kindForExt('md'), 'doc')
  assert.equal(kindForExt('csv'), 'sheet')
  assert.equal(kindForExt('svg'), 'image')
  assert.equal(kindForExt('eml'), 'email')
  assert.equal(kindForExt('pptx'), 'slide')
  assert.equal(isImageExt('png'), true)
  assert.equal(isImageExt('md'), false)
  assert.equal(contentTypeForExt('svg'), 'image/svg+xml')
  assert.equal(contentTypeForExt('json'), 'application/json; charset=utf-8')
})

test('a missing root yields empty listings, never a throw', () => {
  const empty = fsReader(join(process.cwd(), 'does-not-exist-xyz'))
  const { files, photos, folders } = empty.list()
  assert.deepEqual([files.length, photos.length, folders.length], [0, 0, 0])
})
