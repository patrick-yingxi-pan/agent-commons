import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LocalGitReviewFile, GitReviewSide } from '../../contract/localGitReview.mjs'
import { findGitRenameSuggestions } from './gitRenameSuggestions.ts'

const missing: GitReviewSide = { kind: 'missing' }
const omitted: GitReviewSide = { kind: 'omitted', reason: 'sparse' }

function text(value: string): GitReviewSide {
  return { kind: 'text', text: value, mode: '100644' }
}

function deleted(path: string, value: string, unstaged: LocalGitReviewFile['unstaged'] = 'unchanged'): LocalGitReviewFile {
  return { path, staged: 'deleted', unstaged, head: text(value), index: missing, working: missing }
}

function added(path: string, value: string, unstaged: LocalGitReviewFile['unstaged'] = 'unchanged'): LocalGitReviewFile {
  return { path, staged: 'added', unstaged, head: missing, index: text(value), working: text(value) }
}

function similarText(ending: string): string {
  return `${'a'.repeat(30)}\n${'b'.repeat(30)}\n${'c'.repeat(30)}\n${ending}`
}

test('exact suggestions require unique byte-identical nonblank staged delete/add pairs and sort paths', () => {
  const files = [
    added('z-new.ts', 'βeta\r\n'),
    deleted('y-old.ts', 'βeta\r\n'),
    added('b-new.ts', 'first line\nsecond line\n'),
    deleted('a-old.ts', 'first line\nsecond line\n'),
    // Unstaged content and other staged statuses do not form rename candidates.
    { ...deleted('unstaged-delete.ts', 'unrelated\n'), staged: 'unchanged', unstaged: 'deleted' },
    { ...added('staged-modified.ts', 'first line\nsecond line\n'), staged: 'modified' },
  ] satisfies LocalGitReviewFile[]
  const before = structuredClone(files)

  const result = findGitRenameSuggestions(files)

  assert.deepEqual(result, {
    pairs: [
      { fromPath: 'a-old.ts', toPath: 'b-new.ts', match: 'exact', sharedPercent: 100 },
      { fromPath: 'y-old.ts', toPath: 'z-new.ts', match: 'exact', sharedPercent: 100 },
    ],
    limited: false,
  })
  assert.deepEqual(files, before, 'matching does not mutate the Git review snapshot')
})

test('edited candidates use complete-line UTF-8 byte coverage and preserve original text', () => {
  const common = '東京猫\n東京猫\n東京猫\n'
  const files = [deleted('old.md', `${common}aaaaa`), added('new.md', `${common}bbbbb`)]
  const before = structuredClone(files)

  const result = findGitRenameSuggestions(files)

  assert.equal(result.limited, false)
  assert.equal(result.pairs.length, 1)
  assert.deepEqual(result.pairs[0], {
    fromPath: 'old.md', toPath: 'new.md', match: 'similar', sharedPercent: 85,
  })
  assert.deepEqual(files, before)
})

test('ambiguous edited candidates are withheld when the best match is not unique', () => {
  const common = `${'x'.repeat(40)}\n${'y'.repeat(40)}\n${'z'.repeat(40)}\n`
  const result = findGitRenameSuggestions([
    deleted('old.md', `${common}old`),
    added('new-a.md', `${common}new`),
    added('new-b.md', `${common}new`),
  ])

  assert.deepEqual(result, { pairs: [], limited: false })
})

test('edited matching admits the 80-percent boundary but rejects 79 percent and fewer than three shared lines', () => {
  const common = `${'a'.repeat(24)}\n${'b'.repeat(24)}\n${'c'.repeat(29)}\n`
  assert.equal(Buffer.byteLength(common), 80)
  const pair = (shared: string, changedBytes: number) => [
    deleted('old.md', shared + 'o'.repeat(changedBytes)),
    added('new.md', shared + 'n'.repeat(changedBytes)),
  ]
  assert.deepEqual(findGitRenameSuggestions(pair(common, 20)), {
    pairs: [{ fromPath: 'old.md', toPath: 'new.md', match: 'similar', sharedPercent: 80 }], limited: false,
  })
  assert.deepEqual(findGitRenameSuggestions(pair(common, 21)), { pairs: [], limited: false })
  const twoLines = `${'x'.repeat(39)}\n${'y'.repeat(39)}\n`
  assert.equal(Buffer.byteLength(twoLines), 80)
  assert.deepEqual(findGitRenameSuggestions(pair(twoLines, 20)), { pairs: [], limited: false })
})

test('a unique destination for each source is insufficient when the destination has ambiguous sources', () => {
  const common = `${'x'.repeat(40)}\n${'y'.repeat(40)}\n${'z'.repeat(40)}\n`
  assert.deepEqual(findGitRenameSuggestions([
    deleted('old-a.md', `${common}one`),
    deleted('old-b.md', `${common}two`),
    added('new.md', `${common}new`),
  ]), { pairs: [], limited: false })
})

test('edited suggestions require at least a ten-point margin over the runner-up', () => {
  const common = `${'x'.repeat(30)}\n${'y'.repeat(30)}\n${'z'.repeat(30)}\n`
  const result = findGitRenameSuggestions([
    deleted('old.md', `${common}old`),
    added('best.md', `${common}x`),
    added('runner-up.md', `${common}1234567890`),
  ])

  assert.deepEqual(result, { pairs: [], limited: false })
})

test('duplicate exact candidate text stays entirely unpaired', () => {
  const duplicate = 'same exact bytes\n'
  const result = findGitRenameSuggestions([
    deleted('old-a.md', duplicate),
    deleted('old-b.md', duplicate),
    added('new-a.md', duplicate),
    added('new-b.md', duplicate),
  ])

  assert.deepEqual(result, { pairs: [], limited: false })
})

test('empty, whitespace-only, case-only, trim-only and final-newline differences are not normalized into pairs', () => {
  const result = findGitRenameSuggestions([
    deleted('empty-old', ''), added('empty-new', ''),
    deleted('spaces-old', ' \t\r\n'), added('spaces-new', '\t\n'),
    deleted('case-old', 'Alpha\n'), added('case-new', 'alpha\n'),
    deleted('trim-old', ' padded\n'), added('trim-new', 'padded\n'),
    deleted('newline-old', 'final line\n'), added('newline-new', 'final line'),
  ])

  assert.deepEqual(result, { pairs: [], limited: false })
})

test('omitted sides, conflicts and incomplete deletion/addition shapes are never inferred as candidates', () => {
  const files: LocalGitReviewFile[] = [
    { ...deleted('omitted-delete', 'same\n'), index: omitted },
    { ...added('omitted-add', 'same\n'), head: omitted },
    { ...deleted('unmerged-delete', 'same\n'), staged: 'unmerged', index: omitted },
    { ...added('unmerged-add', 'same\n'), staged: 'unmerged', head: omitted },
    { ...deleted('modified-not-delete', 'same\n'), staged: 'modified' },
    { ...added('modified-not-add', 'same\n'), staged: 'modified' },
    { ...deleted('wrong-delete-shape', 'same\n'), index: text('not missing\n') },
    { ...added('wrong-add-shape', 'same\n'), head: text('not missing\n') },
  ]

  assert.deepEqual(findGitRenameSuggestions(files), { pairs: [], limited: false })
})

test('candidate text beyond the input budget is refused without emitting suggestions', () => {
  const exact = 'an exact independent match\n'
  const large = 'q'.repeat(40_000)
  const files = [
    deleted('exact-old', exact), added('exact-new', exact),
    deleted('large-old-a', `${large}a`), deleted('large-old-b', `${large}b`),
    added('large-new-a', `${large}c`), added('large-new-b', `${large}d`),
  ]

  const result = findGitRenameSuggestions(files)

  assert.equal(result.limited, true)
  assert.deepEqual(result.pairs, [])
})

test('more than 500 input files are refused without emitting suggestions', () => {
  const exact = 'bounded exact match\n'
  const files: LocalGitReviewFile[] = [deleted('exact-old', exact), added('exact-new', exact)]
  for (let index = 0; index < 499; index += 1) {
    files.push({
      path: `ignored-${String(index).padStart(3, '0')}`,
      staged: 'modified', unstaged: 'unchanged',
      head: text('before'), index: text('after'), working: text('after'),
    })
  }

  const result = findGitRenameSuggestions(files)

  assert.equal(files.length, 501)
  assert.equal(result.limited, true)
  assert.deepEqual(result.pairs, [])
})

test('hitting the edited-pair budget returns no partial edited results but retains exact matches', () => {
  const exact = 'bounded exact match\n'
  const files: LocalGitReviewFile[] = [deleted('exact-old', exact), added('exact-new', exact)]
  for (let index = 0; index < 65; index += 1) {
    const id = String(index).padStart(2, '0')
    const common = `${id}-${'a'.repeat(30)}\n${id}-${'b'.repeat(30)}\n${id}-${'c'.repeat(30)}\n`
    files.push(deleted(`old-${id}`, `${common}old-${id}`))
    files.push(added(`new-${id}`, `${common}new-${id}`))
  }

  const result = findGitRenameSuggestions(files)

  assert.equal(result.limited, true)
  assert.deepEqual(result.pairs, [
    { fromPath: 'exact-old', toPath: 'exact-new', match: 'exact', sharedPercent: 100 },
  ])
})

test('hitting the candidate-line probe budget returns no partial edited results but retains exact matches', () => {
  const exact = 'bounded exact match\n'
  const sharedLines = Array.from({ length: 300 }, (_, index) =>
    `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + index % 26)}`,
  ).join('\n')
  const files: LocalGitReviewFile[] = [deleted('exact-old', exact), added('exact-new', exact)]
  for (let index = 0; index < 64; index += 1) {
    files.push(deleted(`old-${String(index).padStart(2, '0')}`, `${sharedLines}\nd${index}`))
    files.push(added(`new-${String(index).padStart(2, '0')}`, `${sharedLines}\na${index}`))
  }

  const result = findGitRenameSuggestions(files)

  assert.equal(result.limited, true)
  assert.deepEqual(result.pairs, [
    { fromPath: 'exact-old', toPath: 'exact-new', match: 'exact', sharedPercent: 100 },
  ])
})
