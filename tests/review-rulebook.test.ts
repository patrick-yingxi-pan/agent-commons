/** Locking test: the review rulebook's structure (docs/review-rulebook.md §4).
 *  The rulebook is the exhaustive oracle catalog behind the mechanical
 *  review-and-fix process — it stays mechanical only if every rule keeps a
 *  runnable Detection and a Fix, ids stay unique/sequential, and every repo
 *  path it cites exists. A rule without a detection is a hope, not a rule. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const doc = readFileSync(join(ROOT, 'docs', 'review-rulebook.md'), 'utf8')

/** Each rule section: from its `### X-N ·` heading to the next heading. */
function ruleSections(tier: 'F' | 'A'): Array<{ id: string; n: number; body: string }> {
  const out: Array<{ id: string; n: number; body: string }> = []
  const re = new RegExp(`^### (${tier}-(\\d+)) · .+$`, 'gm')
  const matches = [...doc.matchAll(re)]
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i]!.index! + matches[i]![0].length
    const next = doc.indexOf('\n#', start)
    out.push({ id: matches[i]![1]!, n: Number(matches[i]![2]), body: doc.slice(start, next === -1 ? undefined : next) })
  }
  return out
}

for (const tier of ['F', 'A'] as const) {
  test(`${tier}-rules: ids unique and sequential, each with a Detection and a Fix`, () => {
    const rules = ruleSections(tier)
    assert.ok(rules.length >= 10, `the ${tier} tier stays substantial (found ${rules.length})`)
    assert.deepEqual(
      rules.map((r) => r.n),
      rules.map((_, i) => i + 1),
      `${tier} ids run 1..${rules.length} with no gaps or duplicates`,
    )
    for (const r of rules) {
      assert.match(r.body, /\*\*Detection:\*\*/, `${r.id} names its mechanical detection`)
      assert.match(r.body, /\*\*Fix:\*\*/, `${r.id} names its class-level fix`)
    }
  })
}

test('every repo path the rulebook cites exists (no rotting references)', () => {
  const cited = [...doc.matchAll(/`((?:src|server|contract|tests|e2e|docs|scripts)\/[^`\s]+\.(?:ts|tsx|mjs|md))`/g)]
    .map((m) => m[1]!)
    .filter((p) => !p.includes('*')) // glob patterns (e.g. tests/routes-*.test.ts) are families, not files
  // Multi-file command citations (`node --test a.ts b.ts`) match only their last
  // path (the one abutting the closing backtick) — the floor reflects that.
  assert.ok(cited.length >= 20, `the rulebook cites concrete files (found ${cited.length})`)
  const missing = [...new Set(cited)].filter((p) => !existsSync(join(ROOT, p)))
  assert.deepEqual(missing, [], 'every cited path exists on disk')
})

test('the process section names the detector ladder in cost order', () => {
  const check = doc.slice(doc.indexOf('2. **Check.**'), doc.indexOf('3. **Judge.**'))
  const order = ['npm run typecheck', 'node --test tests/*.test.ts', 'npm run build', 'npm run ui:sweep', 'npm run e2e']
  let at = -1
  for (const cmd of order) {
    const next = check.indexOf(cmd)
    assert.ok(next > at, `${cmd} appears, after its cheaper predecessor`)
    at = next
  }
})

test('the severity table covers consent/tenancy as S1 and keeps taste report-only', () => {
  assert.match(doc, /\| S1 \|[^\n]*Consent bypass[^\n]*tenancy leak/i)
  assert.match(doc, /\| S5 \|[^\n]*Taste[^\n]*\|[^\n]*Report only/i)
})
