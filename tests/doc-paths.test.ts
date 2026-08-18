/** ── Locking test: prose that names a file names a file that EXISTS ─────────
 *
 *  `spec-conformance` has always existsSync'd every path in `docs/spec/`, and
 *  that is why the ledger does not rot. Nothing did the same for the rest of
 *  `docs/`, so eight dead citations accumulated there unnoticed — found only
 *  because a colocation refactor swept every path in the repo (2026-08-12) and
 *  they fell out as residue. Two of them pointed at modules renamed in 2026-07;
 *  one named a suite that never existed at all.
 *
 *  **Why this is not simply "existsSync everything".** Some of `docs/` is an
 *  append-only HISTORY — `IMPLEMENTATION.md`'s numbered rows, the burn-down
 *  plans — where a row records what was true when it landed. A row that says
 *  "renamed `server/agent-runtime.ts` → `server/runner-runtime.ts`" *must* name
 *  the old path; "fixing" it would falsify the record. existsSync is the wrong
 *  oracle for a sentence about the past.
 *
 *  So the rule is: every path in prose resolves, EXCEPT the ones named below
 *  with their reason. Same idiom as the route-owned access classifications and the suite-path
 *  allowlist — an argued exception, never a pattern that would quietly re-open
 *  the hole. A new dead citation fails here; a deliberate reference to history
 *  costs one line and a sentence saying why. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './helpers/source.ts'

/** `file → path` citations that name something gone ON PURPOSE. */
const HISTORICAL: Record<string, string> = {
  'docs/agent-commons-impl-plan.md → server/agent-runtime.ts':
    'the row DOCUMENTS this rename (→ server/runner-runtime.ts); naming the old path is the point',
  'docs/agent-commons-impl-plan.md → server/data/agents.ts':
    'same row, same rename (→ server/data/runners.ts)',
  'docs/notification-routing.md → src/components/NotificationsPanel.tsx':
    'a quoted snapshot of the pre-initiative code; the file is NotificationList.tsx now, and the passage says so',
  'docs/design/IMPLEMENTATION.md → tests/identities-default.test.ts':
    'ledger row 55 records DELETING this suite when P9 tombstoned /v1/identities',
  'docs/design/IMPLEMENTATION.md → tests/identities-route.test.ts':
    'same retirement: rows 49/51 cite it as it stood, row 55 records its removal',
}

/** Every markdown file that makes claims about this repo.
 *
 *  `docs/` was the first cut, and it left out the two places where a dead path
 *  misleads an AGENT rather than a reader: the scoped `CLAUDE.md` / `SPEC.md`
 *  files (context-map checks their markdown LINK targets, and treats backticked
 *  paths only as presence anchors — asserting the string appears, never that
 *  the file exists), and `.claude/skills/`, whose SKILL.md files this very
 *  refactor had to rewrite. A skill with dead pointers misdirects whoever loads
 *  it, which is the failure the context map exists to prevent. */
const DOC_TREES = ['docs', 'contract', 'server', 'src', 'tests', 'e2e', 'connector', '.claude/skills']

function docFiles(): string[] {
  const out = ['AGENTS.md', 'CLAUDE.md', 'README.md']
  for (const tree of DOC_TREES) {
    if (!existsSync(join(ROOT, tree))) continue
    for (const f of readdirSync(join(ROOT, tree), { recursive: true })) {
      const p = String(f).split('\\').join('/')
      if (p.endsWith('.md')) out.push(`${tree}/${p}`)
    }
  }
  assert.ok(out.length > 20, `found only ${out.length} docs — this scan has no subject`)
  return out
}

test('every repo path named in prose exists, or is a declared reference to history', () => {
  const dead: string[] = []
  const unusedExemptions = new Set(Object.keys(HISTORICAL))
  for (const doc of docFiles()) {
    const text = readFileSync(join(ROOT, doc), 'utf8')
    // Backticked paths rooted at a real top-level directory and carrying a
    // source extension — the shape a citation takes in this repo.
    for (const m of text.matchAll(
      /`((?:contract|server|src|tests|e2e|scripts|connector|docs)\/[A-Za-z0-9._/-]+\.(?:ts|tsx|mjs|md|json|css))`/g,
    )) {
      const entry = `${doc} → ${m[1]}`
      // Only a citation that STILL fails to resolve keeps its exemption alive.
      // Marking it used on any sighting meant that if the file came back, the
      // entry stopped exempting anything and was never reported — the allowlist
      // silently accumulating lines that excuse nothing, which is the rot the
      // assertion below exists to catch.
      if (!existsSync(join(ROOT, m[1]))) {
        unusedExemptions.delete(entry)
        if (!(entry in HISTORICAL)) dead.push(entry)
      }
    }
  }
  assert.deepEqual(
    dead,
    [],
    `prose names a file that does not exist — repoint it, or add it to HISTORICAL with the reason:\n${dead.join('\n')}`,
  )
  // An exemption whose citation is gone is itself rot: it makes the next dead
  // path at that spot invisible. Removing the line is the whole fix.
  assert.deepEqual(
    [...unusedExemptions],
    [],
    `HISTORICAL exempts a citation that is no longer in the docs — delete the entry:\n${[...unusedExemptions].join('\n')}`,
  )
})
