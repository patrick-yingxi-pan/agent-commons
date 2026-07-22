/** ── Locking test: the context files stay a progressive-disclosure map ───────
 *  Owner directive (2026-07-18): the always-loaded context files (CLAUDE.md +
 *  AGENTS.md) are a MAP, not a manual — detail lives in directory-scoped
 *  CLAUDE.md files (injected only when working in that directory) and in docs
 *  read on demand. This test locks the three properties that make that true:
 *  (1) the always-loaded files stay within a hard size budget, and the bodies
 *  that were moved out cannot silently reinflate them; (2) every scoped home
 *  exists, is reachable from the map, and still carries the rules that moved
 *  into it (so the move can't quietly LOSE a locked decision); (3) every
 *  relative link in the map and the scoped files resolves — a map with dead
 *  pointers is worse than a flat file. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const lines = (s: string) => s.split('\n').length

/** The scoped context files and the moved rules each must still carry.
 *  An anchor here is the rule's own name — if a refactor drops it from its
 *  home, the decision is LOST, not relocated, and this fails. */
const SCOPED_HOMES: Record<string, string[]> = {
  'src/CLAUDE.md': [
    'One door to the backend',
    'Theming through tokens',
    'Form follows function',
    'Registries have one home',
    'inline disclosure tree',
    'canonical URL',
    'back-history rule',
    'entity page is the shared surface',
    'Surface follows the entity',
    'universal split workspace',
  ],
  'server/CLAUDE.md': [
    '@anthropic-ai/sdk',
    'tool-use loop',
    'AUTH_GATE',
    'server/persist.ts',
    'docs/demo-accounts.md',
  ],
  'contract/CLAUDE.md': ['load-bearing', 'contract/graph.ts', 'INV-9'],
  'tests/CLAUDE.md': ['tests/contract-boundaries.test.ts', 'tests/spec-conformance.test.ts', 'spec ledger'],
  'e2e/CLAUDE.md': ['5183', 'BACKEND=remote', 'fresh draft'],
  'connector/CLAUDE.md': ['session-relay-primer.md', 'delegated-cognition-provider.md'],
  'docs/evaluation.md': ['No mode chosen up front', 'intentionally mock', '11-mock-boundary.md'],
}

test('the always-loaded files stay small, and the moved bodies stay out', () => {
  const agents = read('AGENTS.md')
  const claude = read('CLAUDE.md')
  assert.ok(lines(agents) <= 200, `AGENTS.md is ${lines(agents)} lines — the map's budget is 200; move detail to a scoped CLAUDE.md or docs/`)
  assert.ok(lines(claude) <= 45, `CLAUDE.md is ${lines(claude)} lines — the budget is 45`)
  // Markers of the bodies that moved out — their reappearance means a decision
  // body was pasted back into the map instead of its scoped home.
  for (const marker of ['layoutPanes', 'src/lib/railPanes.ts', 'planPop', 'ValidationError', 'src/lib/urlRoutes.ts']) {
    assert.ok(!agents.includes(marker), `AGENTS.md mentions ${marker} — that body lives in a scoped CLAUDE.md now; keep the map a map`)
  }
})

test('every scoped home exists, is reachable from the map, and keeps its moved rules', () => {
  const agents = read('AGENTS.md')
  for (const [home, anchors] of Object.entries(SCOPED_HOMES)) {
    assert.ok(existsSync(resolve(ROOT, home)), `${home} is missing`)
    assert.ok(agents.includes(home), `AGENTS.md must point at ${home} — an unreachable scoped file is invisible to non-Claude agents`)
    const body = read(home)
    for (const anchor of anchors) {
      assert.ok(body.includes(anchor), `${home} lost its "${anchor}" rule — moved content must survive the move`)
    }
  }
})

test('every relative link in the map and the scoped files resolves', () => {
  const files = ['AGENTS.md', 'CLAUDE.md', ...Object.keys(SCOPED_HOMES)]
  for (const file of files) {
    const body = read(file)
    for (const match of body.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0].trim()
      if (!target || target.startsWith('http') || target.startsWith('mailto:')) continue
      const abs = resolve(ROOT, dirname(file), target)
      assert.ok(existsSync(abs), `${file} links to ${target}, which does not exist`)
    }
  }
})

/** PROPOSAL.md §5 maps each idea to where a reader can SEE it, so its section
 *  list is a factual claim about the shipped rail — and it rotted: it named
 *  "New task" (the row is "New session") and six of the eleven sections did not
 *  exist yet when it was written. A claim a reviewer checks first should not
 *  depend on someone remembering to update prose. Derived from the one registry
 *  (src/lib/sections.tsx), the same source the rail and the body read. */
test('PROPOSAL §5 names the sections the rail actually has', () => {
  const proposal = read('PROPOSAL.md')
  const row = proposal.split('\n').find((l) => l.includes('Cross-cutting tools, not tabs'))
  assert.ok(row, 'the §5 mapping row exists')
  const meta = read('src/lib/sections.tsx')
  // The `admin` section (label "Maintain") is role-gated — the rail filters it
  // out unless `instanceAdmin` — so it is not part of the everyday nav the row
  // describes. Named by its LABEL, which is not its id: this lock's first run
  // caught the author of that very row writing capitalized ids instead.
  const labels = [...meta.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]).filter((l) => l !== 'Maintain')
  assert.ok(labels.length >= 9, 'found the section labels to check against')
  for (const label of labels) {
    assert.ok(row!.includes(label), `PROPOSAL §5 omits the "${label}" section — the rail has it`)
  }
  assert.ok(row!.includes('New session'), 'the create row is called "New session"')
})
