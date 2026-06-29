/** Spec ⇄ code drift guard (docs/spec/). The behavioral conformance run is
 *  `node --test` itself — every ✅ requirement names a locking test that fails on a
 *  regression. This meta-test guards the *other* failure modes: the spec rotting
 *  against the tree, and the spec quietly under-covering what's built.
 *
 *  It checks: (1) every repo path the spec references in backticks exists;
 *  (2) every requirement row carries a status; (3) every ✅ row cites a test or is
 *  marked in-app (no silent ✅); (4) every server route is mentioned somewhere in
 *  the spec (inverse coverage — a built endpoint with no requirement fails);
 *  (5) every 📝 "not built" requirement is surfaced in the README Known-gaps list;
 *  plus the two structural invariants the spec claims (INV-1, INV-3).
 *
 *  It does NOT prove a named test truly exercises its requirement — that's the
 *  author's discipline. It makes a broken reference, an unverified ✅, an unspecced
 *  endpoint, or a hidden gap fail loudly. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, read, filesUnder, concatSource } from './helpers/source.ts'

const STATUS_GLYPHS = ['✅', '🟡', '🧭', '📝']
const specFiles = () => filesUnder('docs/spec', ['.md'])
const pillarFiles = () => specFiles().filter((f) => !f.endsWith('README.md'))
const rel = (f) => f.slice(ROOT.length + 1)

/** Table rows whose first cell is a requirement id (ADAPT-1, CTX-FS-1, BROKER-EXP-1,
 *  FWD-1, MOCK-2, …). Skips header / separator / legend / pillar-list rows. */
function requirementRows(markdown) {
  const rows = []
  for (const line of markdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 2) continue
    if (/^[A-Z][A-Z-]*-\w+$/.test(cells[0])) rows.push({ id: cells[0], cells, text: cells.join(' ') })
  }
  return rows
}

/** Inline-code tokens that look like a repo path (dir-prefixed or a known root file);
 *  excludes globs/URLs/flags and strips a trailing :line. */
const DIR_PREFIX = /^(contract|server|src|tests|scripts|docs|sample-cloud|sample-runner-host)\//
const ROOT_FILES = new Set(['vite.config.ts', 'package.json', 'tsconfig.json'])
function repoPathsIn(markdown) {
  const out = []
  for (const m of markdown.matchAll(/`([^`]+)`/g)) {
    const token = m[1].trim().replace(/:\d+(-\d+)?$/, '').replace(/\/$/, '')
    if (/[\s*?=()]/.test(token)) continue
    if (DIR_PREFIX.test(token) || ROOT_FILES.has(token)) out.push(token)
  }
  return out
}

test('every repo path referenced in docs/spec exists on disk', () => {
  const files = specFiles()
  assert.ok(files.length >= 8, 'expected the spec pillar files to be present')
  const missing = []
  for (const file of files) {
    for (const ref of repoPathsIn(read(file))) {
      if (!existsSync(join(ROOT, ref))) missing.push(`${rel(file)} → \`${ref}\``)
    }
  }
  assert.deepEqual(missing, [], `spec references point at missing paths:\n${missing.join('\n')}`)
})

test('every requirement row carries a status from the legend', () => {
  const bad = []
  for (const file of pillarFiles()) {
    for (const row of requirementRows(read(file))) {
      const statusCell = row.cells[row.cells.length - 1]
      if (!STATUS_GLYPHS.some((g) => statusCell.includes(g))) bad.push(`${rel(file)} ${row.id}: "${statusCell}"`)
    }
  }
  assert.deepEqual(bad, [], `requirement rows missing a status glyph:\n${bad.join('\n')}`)
})

test('every ✅ requirement cites a locking test or is marked in-app (no silent ✅)', () => {
  const unverified = []
  for (const file of pillarFiles()) {
    for (const row of requirementRows(read(file))) {
      const statusCell = row.cells[row.cells.length - 1]
      if (!statusCell.includes('✅')) continue
      if (!/tests\//.test(row.text) && !/in-app/i.test(row.text)) unverified.push(`${rel(file)} ${row.id}`)
    }
  }
  assert.deepEqual(unverified, [], `✅ rows with no test / in-app verification:\n${unverified.join('\n')}`)
})

test('inverse coverage: every server route is mentioned in the spec', () => {
  const routes = read(join(ROOT, 'server/routes/index.ts'))
  const segments = new Set()
  for (const m of routes.matchAll(/r\.(?:get|post|patch|delete)\(\s*'\/([a-z0-9-]+)/g)) segments.add(m[1])
  const specText = specFiles().map(read).join('\n').toLowerCase()
  const uncovered = [...segments].filter((s) => !specText.includes(s))
  assert.deepEqual(uncovered, [], `built routes with no spec mention (add a requirement row):\n${uncovered.join(', ')}`)
})

test('every 📝 (not-built) requirement is surfaced in the README Known-gaps list', () => {
  const readme = read(join(ROOT, 'docs/spec/README.md'))
  const unlisted = []
  for (const file of pillarFiles()) {
    for (const row of requirementRows(read(file))) {
      const statusCell = row.cells[row.cells.length - 1]
      if (statusCell.includes('📝') && !readme.includes(row.id)) unlisted.push(`${rel(file)} ${row.id}`)
    }
  }
  assert.deepEqual(unlisted, [], `📝 requirements not surfaced in README Known-gaps:\n${unlisted.join('\n')}`)
})

test('INV-1: light theme only — no Tailwind `dark:` variants in src', () => {
  const src = concatSource('src', ['.ts', '.tsx', '.css'])
  assert.ok(!/\bdark:/.test(src), 'found a `dark:` variant — the prototype is light-theme only (INV-1)')
})

test('INV-3: the dev server binds IPv4 (127.0.0.1)', () => {
  const vite = read(join(ROOT, 'vite.config.ts'))
  assert.ok(vite.includes('127.0.0.1'), 'vite.config.ts must bind 127.0.0.1 (INV-3)')
})
