/** The served-filesystem routes (`/fs/*?source=`) — the cloud source (the web
 *  backend's own storage), served on BOTH backends. Real data from the in-repo
 *  `sample-cloud/` tree; the runner source has its own file (runner-fs.test.ts).
 *  Locks the catalog/folder/text/content shapes, the error paths, and the
 *  traversal guard. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { call, callRaw } from './helpers/http.ts'

test('GET /fs/sources lists the cloud source (the always-present one)', async () => {
  const r = await call('GET', '/fs/sources')
  assert.equal(r.status, 200)
  const cloud = r.json.find((s: any) => s.id === 'cloud')
  assert.ok(cloud, 'cloud source is present')
  assert.equal(cloud.kind, 'cloud')
})

test('GET /fs/catalog?source=cloud lists real files / photos / folders', async () => {
  const r = await call('GET', '/fs/catalog?source=cloud')
  assert.equal(r.status, 200)
  assert.equal(r.json.source.id, 'cloud')
  assert.ok(r.json.files.map((f: any) => f.name).includes('q3-roadmap.md'))
  assert.ok(r.json.photos.map((p: any) => p.name).includes('mockup.svg'))
  assert.ok(r.json.folders.map((d: any) => d.name).includes('insights-dashboard'))
})

test('GET /fs/folder?source=cloud&path= scans a folder into artifacts', async () => {
  const r = await call('GET', '/fs/folder?source=cloud&path=insights-dashboard')
  assert.equal(r.status, 200)
  const names = r.json.artifacts.map((a: any) => a.name)
  assert.ok(names.includes('readme.md'))
  assert.ok(names.includes('dashboard-preview.svg'))
})

test('GET /fs/text?source=cloud&path= returns real text; an image reports its kind', async () => {
  const md = await call('GET', '/fs/text?source=cloud&path=notes.md')
  assert.equal(md.status, 200)
  assert.equal(md.json.kind, 'text')
  assert.match(md.json.text, /Insights/)

  const svg = await call('GET', '/fs/text?source=cloud&path=mockup.svg')
  assert.equal(svg.status, 200)
  assert.equal(svg.json.kind, 'image')
  assert.equal(svg.json.contentType, 'image/svg+xml')
})

test('GET /fs/content?source=cloud&path= streams image bytes (200 + content type)', async () => {
  const r = await callRaw('GET', '/fs/content?source=cloud&path=mockup.svg')
  assert.equal(r.status, 200)
  assert.ok(r.body.length > 0, 'a non-empty body was streamed')
})

test('error paths: missing args 400, unknown source 404, missing file 404', async () => {
  assert.equal((await call('GET', '/fs/catalog')).status, 400)
  assert.equal((await call('GET', '/fs/catalog?source=bogus')).status, 404)
  assert.equal((await call('GET', '/fs/text?source=cloud&path=nope.md')).status, 404)
  assert.equal((await call('GET', '/fs/folder?source=cloud')).status, 400)
})

test('traversal guard: a path escaping the root 404s rather than reading outside', async () => {
  const r = await call('GET', '/fs/text?source=cloud&path=' + encodeURIComponent('../package.json'))
  assert.equal(r.status, 404)
})
