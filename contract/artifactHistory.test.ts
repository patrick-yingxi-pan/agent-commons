import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseArtifactHistoryPage,
  parseArtifactHistoryVersion,
  parseArtifactHistoryVersionResult,
  parseArtifactHistoryEntries,
  parseArtifactHistoryBody,
  parseRestoreArtifactHistoryRequest,
  type ArtifactHistoryPage,
  type ArtifactHistoryVersion,
} from './artifactHistory.ts'

const doc = { type: 'doc' as const, title: 'Notes', blocks: [{ p: 'Saved text' }] }
const version: ArtifactHistoryVersion = {
  revision: 4,
  savedAt: '2026-01-02T03:04:05.000Z',
  reason: 'restore',
  restoredFromRevision: 2,
  body: doc,
}

test('artifact history parses bounded immutable versions with exact body provenance', () => {
  assert.deepEqual(parseArtifactHistoryVersion(version), version)
  assert.equal(parseArtifactHistoryVersion({ ...version, revision: 0 }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, restoredFromRevision: 4 }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, savedAt: 'not a timestamp' }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, extra: true }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, body: { ...doc, revision: 4 } }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, body: { type: 'doc', title: '', blocks: [] } }), undefined)
  assert.equal(parseArtifactHistoryVersion({ ...version, reason: 'edit', savedAt: null }), undefined)
  assert.equal(parseArtifactHistoryVersionResult({ artifactId: 'artifact-1', currentRevision: 3, version }), undefined)
})

test('history pages keep exact descending revisions and bounded pagination metadata', () => {
  const page: ArtifactHistoryPage = {
    artifactId: 'artifact-1', currentRevision: 4,
    versions: [
      { revision: 4, savedAt: '2026-01-02T03:04:05.000Z', reason: 'restore', restoredFromRevision: 2 },
      { revision: 3, savedAt: '2026-01-02T03:03:00.000Z', reason: 'edit' },
    ],
    nextBeforeRevision: 3,
  }
  assert.deepEqual(parseArtifactHistoryPage(page), page)
  assert.equal(parseArtifactHistoryPage({ ...page, versions: [...page.versions].reverse() }), undefined)
  assert.equal(parseArtifactHistoryPage({ ...page, nextBeforeRevision: 4 }), undefined)
  assert.equal(parseArtifactHistoryPage({ ...page, versions: Array.from({ length: 51 }, (_, i) => ({ revision: 50 - i, savedAt: null, reason: 'baseline' })) }), undefined)
})

test('restore intent is closed and pins an exact safe current revision', () => {
  assert.deepEqual(parseRestoreArtifactHistoryRequest({ expectedRevision: 4 }), { expectedRevision: 4 })
  assert.equal(parseRestoreArtifactHistoryRequest({ expectedRevision: 4, revision: 2 }), undefined)
  assert.equal(parseRestoreArtifactHistoryRequest({ expectedRevision: -1 }), undefined)
  assert.equal(parseRestoreArtifactHistoryRequest({ expectedRevision: Number.MAX_SAFE_INTEGER + 1 }), undefined)
})

test('history preserves valid large legacy prose bodies and rejects malformed append ordering', () => {
  const body = { type: 'doc', title: 'Large legacy body', blocks: Array.from({ length: 12 }, () => ({ p: 'x'.repeat(2_000) })) }
  assert.ok(parseArtifactHistoryBody(body), 'history bounds honor the existing 100 × 2,000 prose-block envelope')
  assert.throws(() => parseArtifactHistoryEntries([['artifact-1', [
    { revision: 4, savedAt: null, reason: 'baseline', body: doc },
    { revision: 6, savedAt: '2026-01-02T03:04:05.000Z', reason: 'edit', body: doc },
  ]]]), /contiguous and monotonic/)
  assert.throws(() => parseArtifactHistoryEntries([['artifact-1', [
    { revision: 4, savedAt: null, reason: 'baseline', body: doc },
    { revision: 5, savedAt: '2026-01-02T03:04:05.000Z', reason: 'restore', restoredFromRevision: 3, body: doc },
  ]]]), /restore source is missing/)
  assert.throws(() => parseArtifactHistoryEntries([['artifact-1', [
    { revision: 4, savedAt: null, reason: 'baseline', body: doc },
    { revision: 5, savedAt: '2026-01-02T03:04:05.000Z', reason: 'restore', restoredFromRevision: 4, body: { ...doc, blocks: [{ p: 'different' }] } },
  ]]]), /differs from its source/)
})

test('identified Document history supports all block variants and returns a detached body', () => {
  const sourceList = ['first', 'second']
  const sourceCode = ['const x = 1']
  const sourceEmail = { to: 'team@example.test', subject: 'Hello' }
  const source = {
    type: 'doc',
    title: 'Identified blocks',
    blocks: [
      { h: 'Heading', id: 'heading-1' },
      { p: 'Paragraph', id: 'paragraph_2' },
      { ul: sourceList, id: 'list3' },
      { code: sourceCode, id: 'code-4' },
      { email: sourceEmail, id: 'email5' },
    ],
  }
  const parsed = parseArtifactHistoryBody(source)
  assert.deepEqual(parsed, source, 'every supported block shape retains its exact id')
  assert.ok(parsed && parsed.type === 'doc')
  if (!parsed || parsed.type !== 'doc') return

  assert.notStrictEqual(parsed, source)
  assert.notStrictEqual(parsed.blocks, source.blocks)
  for (let index = 0; index < parsed.blocks.length; index += 1) {
    assert.notStrictEqual(parsed.blocks[index], source.blocks[index])
  }
  const parsedList = parsed.blocks[2]
  const parsedCode = parsed.blocks[3]
  const parsedEmail = parsed.blocks[4]
  assert.ok(parsedList && 'ul' in parsedList)
  assert.ok(parsedCode && 'code' in parsedCode)
  assert.ok(parsedEmail && 'email' in parsedEmail)
  if (parsedList && 'ul' in parsedList && parsedCode && 'code' in parsedCode && parsedEmail && 'email' in parsedEmail) {
    assert.notStrictEqual(parsedList.ul, sourceList)
    assert.notStrictEqual(parsedCode.code, sourceCode)
    assert.notStrictEqual(parsedEmail.email, sourceEmail)
  }
  sourceList[0] = 'mutated source'
  sourceCode[0] = 'mutated source'
  sourceEmail.to = 'mutated@example.test'
  assert.deepEqual(parsed.blocks[2], { ul: ['first', 'second'], id: 'list3' })
  assert.deepEqual(parsed.blocks[3], { code: ['const x = 1'], id: 'code-4' })
  assert.deepEqual(parsed.blocks[4], { email: { to: 'team@example.test', subject: 'Hello' }, id: 'email5' })
})

test('Document history accepts only wholly legacy or wholly identified block lists', () => {
  const legacy = { type: 'doc', title: 'Legacy', blocks: [{ h: 'Heading' }, { p: 'Paragraph' }] }
  assert.deepEqual(parseArtifactHistoryBody(legacy), legacy, 'pre-ID saved bodies remain readable')

  const mixed = { type: 'doc', title: 'Mixed', blocks: [{ p: 'identified', id: 'p1' }, { p: 'legacy' }] }
  assert.equal(parseArtifactHistoryBody(mixed), undefined, 'partially migrated bodies are refused')
  const mixedReverse = { type: 'doc', title: 'Mixed', blocks: [{ p: 'legacy' }, { p: 'identified', id: 'p2' }] }
  assert.equal(parseArtifactHistoryBody(mixedReverse), undefined, 'legacy-first partial identity is also refused')
})

test('Document history rejects malformed, duplicate, and extra block IDs', () => {
  const body = (blocks: unknown[]) => ({ type: 'doc', title: 'IDs', blocks })
  const invalidIds: unknown[] = [
    '',
    'x'.repeat(97),
    '_leading',
    '-leading',
    'has.dot',
    'has space',
    'é',
    'trailing-newline\n',
    'trailing-return\r',
    'trailing-line-separator\u2028',
    null,
    4,
  ]
  for (const id of invalidIds) {
    assert.equal(parseArtifactHistoryBody(body([{ p: 'text', id }])), undefined, `refused ID ${String(id)}`)
  }
  assert.equal(parseArtifactHistoryBody(body([{ p: 'one', id: 'duplicate' }, { h: 'two', id: 'duplicate' }])), undefined)
  assert.equal(parseArtifactHistoryBody(body([{ p: 'text', id: undefined }])), undefined, 'present-but-undefined is not legacy absence')
  assert.equal(parseArtifactHistoryBody(body([{ p: 'text', id: 'valid', debug: true }])), undefined, 'unknown metadata is refused')
  assert.equal(parseArtifactHistoryBody({ type: 'doc', title: 'IDs', blocks: [{ p: 'text', id: 'valid' }], source: 'unknown' }), undefined)

  assert.deepEqual(parseArtifactHistoryBody(body([{ p: 'one character', id: 'a' }])), {
    type: 'doc', title: 'IDs', blocks: [{ p: 'one character', id: 'a' }],
  }, 'the one-character lower boundary is valid')
  const maxLengthId = `a${'_'.repeat(95)}`
  assert.equal(maxLengthId.length, 96)
  assert.deepEqual(parseArtifactHistoryBody(body([{ p: '96 characters', id: maxLengthId }])), {
    type: 'doc', title: 'IDs', blocks: [{ p: '96 characters', id: maxLengthId }],
  }, 'the 96-character upper boundary is valid')
  assert.equal(parseArtifactHistoryBody(body([{ p: '97 characters', id: `a${'_'.repeat(96)}` }])), undefined)
})

test('Document history refuses a block carrying more than one variant shape', () => {
  const variants = [
    { h: 'Heading', id: 'h1' },
    { p: 'Paragraph', id: 'p1' },
    { ul: ['item'], id: 'ul1' },
    { code: ['line'], id: 'code1' },
    { email: { to: 'team@example.test', subject: 'Hello' }, id: 'email1' },
  ]
  const ambiguous = [
    { h: 'Heading', p: 'Also paragraph', id: 'h1' },
    { p: 'Paragraph', ul: ['Also list'], id: 'p1' },
    { ul: ['item'], code: ['Also code'], id: 'ul1' },
    { code: ['line'], email: { to: 'a@example.test', subject: 'Also email' }, id: 'code1' },
    { email: { to: 'team@example.test', subject: 'Hello' }, h: 'Also heading', id: 'email1' },
  ]
  for (let index = 0; index < variants.length; index += 1) {
    assert.ok(parseArtifactHistoryBody({ type: 'doc', title: 'Variants', blocks: [variants[index]] }),
      `valid variant ${index} is admitted`)
    assert.equal(parseArtifactHistoryBody({ type: 'doc', title: 'Variants', blocks: [ambiguous[index]] }), undefined,
      `ambiguous variant ${index} is rejected`)
  }
})

test('identified and legacy history keep the original maximum document bounds', () => {
  const atLimit = Array.from({ length: 100 }, (_, index) => ({ p: `p${index}`.padEnd(2_000, 'x') }))
  assert.ok(parseArtifactHistoryBody({ type: 'doc', title: 'Legacy limit', blocks: atLimit }),
    'the former 100 × 2,000 legacy envelope remains accepted')
  assert.equal(parseArtifactHistoryBody({ type: 'doc', title: 'Legacy over limit', blocks: [...atLimit, { p: 'extra' }] }), undefined)

  const identifiedAtLimit = atLimit.map((block, index) => ({ ...block, id: `block-${index}` }))
  assert.ok(parseArtifactHistoryBody({ type: 'doc', title: 'ID limit', blocks: identifiedAtLimit }),
    'IDs do not reduce the existing prose budget')
})

test('identified list and code blocks refuse sparse arrays rather than synthesizing null lines', () => {
  for (const field of ['ul', 'code']) {
    assert.equal(parseArtifactHistoryBody({
      type: 'doc', title: 'Sparse lines', blocks: [{ id: 'block-lines', [field]: new Array(2) }],
    }), undefined, `${field} must contain actual strings at every position`)
  }
})

test('restore history preserves exact block IDs and rejects same-text identity substitution', () => {
  const first = { type: 'doc', title: 'Restore', blocks: [{ p: 'same text', id: 'block-original' }] }
  const edited = { type: 'doc', title: 'Restore', blocks: [{ p: 'edited', id: 'block-original' }] }
  const entries = parseArtifactHistoryEntries([['artifact-ids', [
    { revision: 0, savedAt: null, reason: 'baseline', body: first },
    { revision: 1, savedAt: '2026-01-02T03:04:05.000Z', reason: 'edit', body: edited },
    { revision: 2, savedAt: '2026-01-02T03:05:05.000Z', reason: 'restore', restoredFromRevision: 0, body: first },
  ]]])
  assert.deepEqual(entries[0]?.[1].map((item) => item.body), [first, edited, first])

  assert.throws(() => parseArtifactHistoryEntries([['artifact-ids', [
    { revision: 0, savedAt: null, reason: 'baseline', body: first },
    { revision: 1, savedAt: '2026-01-02T03:04:05.000Z', reason: 'restore', restoredFromRevision: 0,
      body: { type: 'doc', title: 'Restore', blocks: [{ p: 'same text', id: 'different-block' }] } },
  ]]]), /differs from its source/)
})
