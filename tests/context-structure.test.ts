/** ── Locking test: context is an ordered, correlated rule graph ─────────────
 *
 * The earlier context-map lock proved size, reachability, and a few phrases.
 * It could not distinguish an organized rule from a paragraph parked anywhere,
 * nor prove that a rule still named live implementation, evidence, or related
 * laws. The context system now exposes those facts as one Markdown record per
 * rule. This suite parses the records instead of maintaining a second list.
 *
 * Earned mutation checks: a category moved out of order, a dead lock link, and
 * an unknown relation each fail with the owning file/rule in the message. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { ROOT } from './helpers/source.ts'

const CATEGORY_ORDER = ['product', 'architecture', 'experience', 'data-access', 'verification', 'operations'] as const
const CATEGORY_RANK = new Map(CATEGORY_ORDER.map((category, index) => [category, index]))
const SCOPED_ROOTS = ['contract', 'connector', 'desktop', 'e2e', 'server', 'src', 'tests']
const RULE_COLUMNS = ['ID', 'Category', 'Rule', 'Implementation', 'Locks', 'Relations']
const LINK = /\[([^\]]+)\]\(([^)]+)\)/g
const RULE_ID = /\b(?:ROOT|[A-Z][A-Z0-9]*)-[A-Z]\d+\b/g
const EXTERNAL = ['http://', 'https://', 'mailto:']

const rel = (absolute: string) => relative(ROOT, absolute).split('\\').join('/')
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8')

function scopedContextFiles(): string[] {
  const files: string[] = []
  for (const root of SCOPED_ROOTS) {
    for (const entry of readdirSync(resolve(ROOT, root), { recursive: true })) {
      const path = String(entry).split('\\').join('/')
      if (path.endsWith('CLAUDE.md')) files.push(`${root}/${path}`)
    }
  }
  files.sort()
  assert.ok(files.length >= 18, `found only ${files.length} scoped contexts — the scan has lost subjects`)
  return files
}

type RuleRecord = {
  file: string
  id: string
  category: string
  rule: string
  implementation: string
  locks: string
  relations: string
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function ruleRecords(file: string): RuleRecord[] {
  const body = read(file)
  const start = body.indexOf('<!-- context-rules:start -->')
  const end = body.indexOf('<!-- context-rules:end -->')
  assert.ok(start >= 0 && end > start, `${file} must delimit its Rule index with context-rules markers`)
  const lines = body.slice(start, end).split('\n').map((line) => line.trim()).filter((line) => line.startsWith('|'))
  assert.deepEqual(cells(lines[0] ?? ''), RULE_COLUMNS, `${file} must use the six canonical rule columns in order`)
  const rows = lines.slice(2).filter((line) => !/^\|?\s*-+/.test(line))
  assert.ok(rows.length > 0, `${file} has no indexed rules`)
  return rows.map((line) => {
    const row = cells(line)
    assert.equal(row.length, RULE_COLUMNS.length, `${file} has a malformed rule row: ${line}`)
    const [id, category, rule, implementation, locks, relations] = row
    for (const [index, value] of row.entries()) {
      assert.ok(value, `${file} ${id || '(unknown rule)'} leaves ${RULE_COLUMNS[index]} empty`)
    }
    return { file, id, category, rule, implementation, locks, relations }
  })
}

function links(cell: string): Array<{ label: string; target: string }> {
  return [...cell.matchAll(LINK)].map((match) => ({ label: match[1], target: match[2].split('#')[0] }))
}

const CONTEXT_FILES = ['AGENTS.md', ...scopedContextFiles()]
const RECORDS = CONTEXT_FILES.flatMap(ruleRecords)

test('context files follow one progressive-disclosure schema and stay within their level budgets', () => {
  assert.ok(read('AGENTS.md').split('\n').length <= 160, 'AGENTS.md is a boot map, not a manual (160-line budget)')
  assert.ok(read('CLAUDE.md').split('\n').length <= 20, 'root CLAUDE.md is an adapter to AGENTS.md (20-line budget)')

  for (const file of scopedContextFiles()) {
    const body = read(file)
    assert.ok(body.includes('<!-- context-schema: v1 -->'), `${file} does not declare context schema v1`)
    const ordered = ['## Scope', '## Read path', '## Rule index', '## Verification'].map((heading) => body.indexOf(heading))
    assert.ok(ordered.every((index) => index >= 0), `${file} must contain Scope → Read path → Rule index → Verification`)
    assert.deepEqual([...ordered].sort((a, b) => a - b), ordered, `${file} context sections are out of logical order`)
    assert.ok(body.split('\n').length <= 160, `${file} exceeds the 160-line scoped-context budget; move rationale to DESIGN/SPEC/docs`)
  }
})

test('every scoped context and decision companion is transitively reachable from the boot map', () => {
  const reachable = new Set<string>()
  const walk = (file: string) => {
    if (reachable.has(file) || !existsSync(resolve(ROOT, file))) return
    reachable.add(file)
    if (!file.endsWith('.md')) return
    for (const link of links(read(file))) {
      const target = link.target.trim()
      if (!target || target.startsWith('#') || EXTERNAL.some((prefix) => target.startsWith(prefix))) continue
      walk(rel(resolve(ROOT, dirname(file), target)))
    }
  }
  walk('AGENTS.md')

  const directBootTargets = new Set(links(read('AGENTS.md')).map((link) => rel(resolve(ROOT, link.target))))
  for (const file of scopedContextFiles().filter((candidate) => candidate.split('/').length > 2)) {
    assert.ok(!directBootTargets.has(file), `AGENTS.md links directly to module context ${file}; route through its layer index`)
  }
  for (const detail of ['src/DESIGN.md', 'server/DESIGN.md']) {
    assert.ok(!directBootTargets.has(detail), `AGENTS.md links directly to ${detail}; route through the owning layer index`)
  }

  for (const file of scopedContextFiles()) {
    assert.ok(reachable.has(file), `${file} is not reachable from AGENTS.md through scoped read paths`)
  }
  for (const detail of ['src/DESIGN.md', 'server/DESIGN.md', 'docs/context-system.md', 'docs/agent-workflow.md']) {
    assert.ok(reachable.has(detail), `${detail} is an on-demand companion but no context route reaches it`)
  }
})

test('rule categories are controlled and ordered, and rule IDs are repository-unique', () => {
  const seen = new Map<string, string>()
  for (const file of CONTEXT_FILES) {
    let last = -1
    for (const record of RECORDS.filter((candidate) => candidate.file === file)) {
      assert.match(record.id, /^(?:ROOT|[A-Z][A-Z0-9]*)-[A-Z]\d+$/, `${record.file} has malformed rule ID ${record.id}`)
      const rank = CATEGORY_RANK.get(record.category as (typeof CATEGORY_ORDER)[number])
      assert.notEqual(rank, undefined, `${record.file} ${record.id} uses unknown category ${record.category}`)
      assert.ok(rank! >= last, `${record.file} ${record.id} moves category ${record.category} out of the canonical order`)
      last = rank!
      assert.ok(!seen.has(record.id), `${record.id} is duplicated in ${seen.get(record.id)} and ${record.file}`)
      seen.set(record.id, record.file)
    }
  }
})

test('every rule points to live implementation and locking tests', () => {
  for (const record of RECORDS) {
    const implementation = links(record.implementation)
    const locks = links(record.locks)
    assert.ok(implementation.length > 0, `${record.file} ${record.id} has no implementation link`)
    assert.ok(locks.length > 0, `${record.file} ${record.id} has no lock link`)
    for (const link of [...implementation, ...locks]) {
      const absolute = resolve(ROOT, dirname(record.file), link.target)
      assert.ok(existsSync(absolute), `${record.file} ${record.id} links ${link.target}, which does not exist`)
    }
    for (const lock of locks) {
      assert.match(lock.target, /(?:\.test\.|\.spec\.)/, `${record.file} ${record.id} calls ${lock.target} a lock, but it is not a test/spec`)
    }
  }
})

test('every rule relation resolves and every top-level law is refined by scoped context', () => {
  const ids = new Set(RECORDS.map((record) => record.id))
  for (const record of RECORDS) {
    if (record.relations !== 'root') {
      for (const clause of record.relations.split(';').map((part) => part.trim())) {
        assert.match(
          clause,
          /^(?:parent|refines|requires|symmetric-with) (?:ROOT|[A-Z][A-Z0-9]*)-[A-Z]\d+$/,
          `${record.file} ${record.id} must name the relation kind and exactly one related rule per clause`,
        )
      }
    }
    const targets = record.relations.match(RULE_ID) ?? []
    if (record.relations !== 'root') assert.ok(targets.length > 0, `${record.file} ${record.id} has no explicit related rule ID`)
    for (const target of targets) {
      assert.ok(ids.has(target), `${record.file} ${record.id} relates to unknown ${target}`)
      assert.notEqual(target, record.id, `${record.file} ${record.id} relates to itself`)
    }
  }

  const scopedRelations = RECORDS.filter((record) => record.file !== 'AGENTS.md').flatMap((record) => record.relations.match(RULE_ID) ?? [])
  for (const root of RECORDS.filter((record) => record.file === 'AGENTS.md')) {
    assert.ok(scopedRelations.includes(root.id), `${root.id} is top-level but no scoped rule refines or requires it`)
  }
})

test('context implementation/lock paths are relative to their owner, not accidental cwd paths', () => {
  for (const record of RECORDS) {
    for (const link of [...links(record.implementation), ...links(record.locks)]) {
      const normalized = rel(resolve(ROOT, dirname(record.file), link.target))
      assert.ok(!normalized.startsWith('..'), `${record.file} ${record.id} escapes the repository through ${link.target}`)
    }
  }
})
