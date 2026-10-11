/** PPTX export is a fresh, read-authorized projection of a saved slide body.
 * The response is JSON metadata plus a base64 OOXML package; it is not an
 * upload, renderer, or source-file passthrough. */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { SaxesParser } from 'saxes'
import type { ArtifactItem } from '../../contract/index.ts'
import { call } from '../testkit/http.ts'
import { store } from '../store/index.ts'
import { closePersistence, loadState } from '../persistence/persist.ts'

before(() => {
  process.env.PERSIST_BACKEND = 'sqlite'
  process.env.DATABASE_PATH = ':memory:'
  store.initPersistence()
})
after(() => closePersistence())

const OWNER = 'tenant-personal'
const READER = 'tenant-beta'
const FOREIGN = 'tenant-growthworks'
const PPTX_MEDIA = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const slides = [
  { title: 'Launch plan', bullets: ['Name the audience', 'Ship the first cut'] },
  { title: 'Next steps', bullets: ['Review literal text', 'Publish the deck'] },
]

async function createSlides(name: string, tenant = OWNER, body = { type: 'slides', slides }) {
  const response = await call('POST', '/relations/ops', {
    op: { kind: 'save-artifact', artifact: { name, kind: 'slide', meta: 'Slides', body } },
  }, { 'x-tenant-id': tenant, 'idempotency-key': `pptx-export-create-${name}` })
  assert.equal(response.status, 200)
  const row = (response.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === name)
  assert.ok(row)
  return row
}

async function zipTexts(base64: string) {
  const reader = new ZipReader(new Uint8ArrayReader(Buffer.from(base64, 'base64')))
  try {
    const entries = await reader.getEntries()
    const files: Record<string, string> = {}
    for (const entry of entries) {
      if (entry.directory) continue
      files[entry.filename] = await entry.getData!(new TextWriter())
    }
    return files
  } finally {
    await reader.close()
  }
}

function slideShapeTexts(xml: string): Array<{ name: string; text: string }> {
  const shapes: Array<{ name: string; text: string }> = []
  let shape: { name: string; text: string } | undefined
  let inText = false
  const parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', (tag) => {
    if (tag.local === 'sp') shape = { name: '', text: '' }
    if (shape && tag.local === 'cNvPr') shape.name = String(tag.attributes.name?.value ?? '')
    if (shape && tag.local === 't') inText = true
    if (shape && tag.local === 'br') shape.text += '\n'
  })
  parser.on('text', (value) => { if (shape && inText) shape.text += value })
  parser.on('closetag', (tag) => {
    if (tag.local === 't') inText = false
    if (tag.local === 'sp' && shape) { shapes.push(shape); shape = undefined }
  })
  parser.write(xml).close()
  return shapes
}

test('PPTX export returns ordered editable slide text to owner and granted reader', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createSlides(`literal-${stamp}.slides`)
  const grant = await call('POST', '/grants', { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: READER }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(grant.status, 200)

  const owner = await call('GET', `/artifacts/${artifact.id}/export?format=pptx`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(owner.status, 200)
  assert.equal(owner.json.artifactId, artifact.id)
  assert.equal(owner.json.filename, `literal-${stamp}.pptx`)
  assert.equal(owner.json.mediaType, PPTX_MEDIA)
  assert.equal(owner.json.encoding, 'base64')
  assert.equal(owner.json.revision, 0)
  assert.match(owner.json.content, /^[A-Za-z0-9+/]+=*$/)
  const files = await zipTexts(owner.json.content)
  const slideFiles = Object.keys(files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort()
  assert.equal(slideFiles.length, slides.length)
  const actualShapes = slideFiles.flatMap((name) => slideShapeTexts(files[name])).filter((shape) => shape.name !== 'Source slide')
  assert.deepEqual(actualShapes, slides.flatMap((slide) => [{ name: 'Slide title', text: slide.title }, ...slide.bullets.map((text, index) => ({ name: `Bullet ${index + 1}`, text }))]))
  assert.equal(Object.keys(files).some((name) => name.startsWith('ppt/media/')), false, 'export adds no images')
  assert.equal(Object.keys(files).some((name) => /(?:vbaProject|oleObject|embeddings)/iu.test(name)), false, 'export adds no macro or embedded object parts')

  const reader = await call('GET', `/artifacts/${artifact.id}/export?format=pptx`, undefined, { 'x-tenant-id': READER })
  assert.equal(reader.status, 200)
  assert.deepEqual(reader.json, owner.json, 'granted reader receives the same PPTX projection')

  const foreign = await call('GET', `/artifacts/${artifact.id}/export?format=pptx`, undefined, { 'x-tenant-id': FOREIGN })
  assert.equal(foreign.status, 404)
  assert.equal((await call('DELETE', `/grants/${grant.json.id}`, undefined, { 'x-tenant-id': OWNER })).status, 200)
  assert.equal((await call('GET', `/artifacts/${artifact.id}/export?format=pptx`, undefined, { 'x-tenant-id': READER })).status, 404)
})

test('PPTX export follows rename, is read-only, and keeps Markdown behavior explicit', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createSlides(`rename-${stamp}.slides`)
  const events: string[] = []
  const off = store.subscribe((event) => events.push(event.type))
  try {
    const renamed = await call('PATCH', `/artifacts/${artifact.id}`, { name: `renamed-${stamp}.slides`, expectedRevision: 0 }, { 'x-tenant-id': OWNER })
    assert.equal(renamed.status, 200)
    events.length = 0
    const before = loadState()
    assert.ok(before?.graph.extraArtifacts.some(row => row.id === artifact.id), 'the compared snapshot contains this test presentation')
    const pptx = await call('GET', `/artifacts/${artifact.id}/export?format=pptx`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(pptx.status, 200)
    assert.equal(pptx.json.filename, `renamed-${stamp}.pptx`)
    assert.equal(pptx.json.revision, 0)
    const omitted = await call('GET', `/artifacts/${artifact.id}/export`, undefined, { 'x-tenant-id': OWNER })
    const markdown = await call('GET', `/artifacts/${artifact.id}/export?format=markdown`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(omitted.status, 409)
    assert.deepEqual(markdown.json, omitted.json)
    assert.deepEqual(loadState(), before, 'exports do not mutate persisted state')
  } finally {
    off()
  }
  assert.deepEqual(events, [], 'exports publish no events')
})

test('PPTX query validation is strict behind the artifact visibility wall', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createSlides(`query-${stamp}.slides`)
  for (const query of [`format=ods`, `format=`, `format=pptx&format=markdown`, `format=pptx&format=pptx`]) {
    const owner = await call('GET', `/artifacts/${artifact.id}/export?${query}`, undefined, { 'x-tenant-id': OWNER })
    assert.equal(owner.status, 400, query)
    assert.equal(owner.json.error.code, 'bad_request')
    const foreign = await call('GET', `/artifacts/${artifact.id}/export?${query}`, undefined, { 'x-tenant-id': FOREIGN })
    assert.equal(foreign.status, 404, `${query}: foreign wall precedes query disclosure`)
  }
  assert.equal((await call('GET', '/artifacts/missing/export?format=ods', undefined, { 'x-tenant-id': OWNER })).status, 404)
})

test('PPTX export rechecks the read wall after its async writer yields', async () => {
  const stamp = Date.now().toString(36)
  const artifact = await createSlides(`race-${stamp}.slides`)
  const grant = await call('POST', '/grants', { subject: { kind: 'artifact', id: artifact.id }, audience: { kind: 'org', orgId: READER }, tier: 'view' }, { 'x-tenant-id': OWNER })
  assert.equal(grant.status, 200)
  const pending = store.exportArtifactPresentation(artifact.id, READER)
  assert.equal(store.revokeGrant(grant.json.id, OWNER), 'ok')
  assert.equal(await pending, undefined, 'revocation wins before the async export resolves')
})

test('PPTX export refuses metadata-only slides without borrowing a fixture body', async () => {
  const stamp = Date.now().toString(36)
  const saved = await call('POST', '/relations/ops', { op: { kind: 'save-artifact', artifact: { name: 'q3-board-deck.slides', kind: 'slide', meta: 'Slides' } } }, { 'x-tenant-id': OWNER, 'idempotency-key': `pptx-metadata-only-${stamp}` })
  assert.equal(saved.status, 200)
  const row = (saved.json.extraArtifacts as ArtifactItem[]).find((artifact) => artifact.name === 'q3-board-deck.slides' && artifact.id !== 'd1')
  assert.ok(row)
  const exported = await call('GET', `/artifacts/${row.id}/export?format=pptx`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(exported.status, 409)
  assert.equal(exported.json.error.code, 'capability_unavailable')
})

test('PPTX export preserves Unicode controls and refuses XML-illegal saved text atomically', async () => {
  const stamp = Date.now().toString(36)
  const validBody = { type: 'slides', slides: [{ title: 'Launch 🚀', bullets: ['Line one\nLine two\t雪'] }] }
  const valid = await createSlides(`unicode-${stamp}.slides`, OWNER, validBody)
  const exported = await call('GET', `/artifacts/${valid.id}/export?format=pptx`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(exported.status, 200)
  const files = await zipTexts(exported.json.content)
  const slideXml = files['ppt/slides/slide1.xml']
  assert.ok(slideXml)
  assert.deepEqual(slideShapeTexts(slideXml).filter((shape) => shape.name !== 'Source slide'), [
    { name: 'Slide title', text: 'Launch 🚀' },
    { name: 'Bullet 1', text: 'Line one\nLine two\t雪' },
  ])

  const invalid = await createSlides(`illegal-${stamp}.slides`, OWNER, { type: 'slides', slides: [{ title: 'Bad\u0000title', bullets: ['never emits'] }] })
  const refused = await call('GET', `/artifacts/${invalid.id}/export?format=pptx`, undefined, { 'x-tenant-id': OWNER })
  assert.equal(refused.status, 409)
  assert.equal(refused.json.error.code, 'capability_unavailable')
  const body = (await call('GET', '/artifact-content', undefined, { 'x-tenant-id': OWNER })).json
  assert.equal(body[invalid.id].slides[0].title, 'Bad\u0000title', 'saved text remains intact after refusal')
})
