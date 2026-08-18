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
import { dirname, relative, resolve } from 'node:path'
import { ROOT } from './helpers/source.ts'

/** Link prefixes that leave the repo. Spelled out with their separators: a bare
 *  `startsWith('http')` also swallows a RELATIVE link into a directory named
 *  `http/` — which `server/http/` is, so the link check below silently skipped
 *  it and the reachability check called it unreachable. */
const EXTERNAL = ['http://', 'https://', 'mailto:']
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const lines = (s: string) => s.split('\n').length

/** The scoped context files and the moved rules each must still carry.
 *  An anchor here is the rule's own name — if a refactor drops it from its
 *  home, the decision is LOST, not relocated, and this fails. */
const SCOPED_HOMES: Record<string, string[]> = {
  'src/CLAUDE.md': ['UI-A1', 'UI-E5', 'UI-D2', 'DESIGN.md'],
  'src/DESIGN.md': [
    'Visual language',
    'Interaction grammar',
    'Data coherence',
    'Navigation structure',
    'Navigation identity',
    'Navigation history',
    'Resource identity',
    'Resource form',
    'Workspace architecture',
  ],
  'server/CLAUDE.md': ['SERVER-A1', 'SERVER-D3', 'SERVER-O1', 'DESIGN.md'],
  'server/DESIGN.md': ['@anthropic-ai/sdk', 'tool-use loop', 'AUTH_GATE', 'persistence and snapshots'],
  'contract/CLAUDE.md': ['CONTRACT-A1', 'CONTRACT-D1', 'INV-9'],
  'tests/CLAUDE.md': ['TEST-V1', 'TEST-V3', 'spec ledger'],
  'e2e/CLAUDE.md': ['5183', 'BACKEND=remote', 'fresh draft'],
  'connector/CLAUDE.md': ['session-relay-primer.md', 'delegated-cognition-provider.md'],
  'docs/context-system.md': ['Controlled categories and order', 'Rule record', 'What the structural lock proves'],
  'docs/agent-workflow.md': ['Review UI changes', 'Keep access surfaces symmetric', 'Land the change'],
  'docs/spec/11-mock-boundary.md': ['MOCK-1', 'MOCK-6', 'The declared fixtures'],
  // Module-scoped homes: colocation applied to context, not only to code. Each
  // is one directory's rules, loaded by opening that directory.
  'server/routes/CLAUDE.md': ['ROUTES-A1', 'plain data', 'testkit/http.ts'],
  'server/store/CLAUDE.md': ['STORE-D1', 'rowVisibleTo', 'in-memory'],
  'server/http/CLAUDE.md': ['HTTP-D1', 'No resource knowledge here', 'Router.list()'],
  'server/model/CLAUDE.md': ['MODEL-A1', 'ANTHROPIC_BASE_URL', 'route itself'],
  'server/persistence/CLAUDE.md': ['PERSIST-D1', 'atomic', 'SPEC.md'],
  'server/data/CLAUDE.md': ['SEED-D1', 'reconcileSeedTenancy', 'demo-accounts.md'],
  'server/testkit/CLAUDE.md': ['TESTKIT-A1', 'buildRouter()', 'No fixtures here'],
  'src/lib/CLAUDE.md': ['UILIB-A1', 'A registry has ONE home', 'Primitives are shared, not restyled'],
  'src/components/CLAUDE.md': ['COMPONENT-A1', 'no DOM', 'Form follows function'],
  'src/api/CLAUDE.md': ['API-A1', 'CACHE of the backend', 'One door'],
  'src/controller/CLAUDE.md': ['CONTROLLER-A1', 'sequences; it does not decide policy', 'consent-gated'],
  'src/data/CLAUDE.md': ['UIDATA-A1', 'not a fixture store', 'funnel is one table'],
}

test('the always-loaded files stay small, and the moved bodies stay out', () => {
  const agents = read('AGENTS.md')
  const claude = read('CLAUDE.md')
  assert.ok(lines(agents) <= 200, `AGENTS.md is ${lines(agents)} lines — the map's budget is 200; move detail to a scoped CLAUDE.md or docs/`)
  assert.ok(lines(claude) <= 45, `CLAUDE.md is ${lines(claude)} lines — the budget is 45`)
  // Markers of the bodies that moved out — their reappearance means a decision
  // body was pasted back into the map instead of its scoped home.
  for (const marker of ['layoutPanes', 'src/lib/railSplit.ts', 'planPop', 'ValidationError', 'src/lib/urlRoutes.ts']) {
    assert.ok(!agents.includes(marker), `AGENTS.md mentions ${marker} — that body lives in a scoped CLAUDE.md now; keep the map a map`)
  }
})

test('every scoped home exists, is reachable from the map, and keeps its moved rules', () => {
  // Reachability is TRANSITIVE, not direct. Colocation pushed context down a
  // level — a module's rules live in its own directory — and a map that had to
  // name every one of them directly would stop being a map, which is the thing
  // the 200-line budget above exists to prevent. So the claim is the weaker,
  // truer one: starting at AGENTS.md and following relative links through the
  // scoped files, you ARRIVE at every home. A home nothing links to is
  // invisible to a non-Claude agent (which gets no automatic injection) and
  // fails here just as a missing direct mention used to.
  // NB: the scheme test below is a regex, not startsWith('http') — a relative
  // link into a directory named `http/` starts with those four letters too.
  const reachable = new Set<string>()
  const walk = (file: string) => {
    if (reachable.has(file) || !existsSync(resolve(ROOT, file))) return
    reachable.add(file)
    if (!/\.md$/.test(file)) return
    for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0].trim()
      if (!target || EXTERNAL.some((p) => target.startsWith(p))) continue
      walk(relative(ROOT, resolve(ROOT, dirname(file), target)).split('\\').join('/'))
    }
  }
  walk('AGENTS.md')

  for (const [home, anchors] of Object.entries(SCOPED_HOMES)) {
    assert.ok(existsSync(resolve(ROOT, home)), `${home} is missing`)
    assert.ok(reachable.has(home), `nothing links to ${home} — an unreachable scoped file is invisible to non-Claude agents`)
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
      if (!target || EXTERNAL.some((p) => target.startsWith(p))) continue
      const abs = resolve(ROOT, dirname(file), target)
      assert.ok(existsSync(abs), `${file} links to ${target}, which does not exist`)
    }
  }
})

/** README is the engineering tour, so its most checkable claims — which
 *  commands exist, what the tree contains, and the dependency at the model
 *  boundary — are derived, not remembered.
 *  Those claims had drifted: it named neither `npm test` nor `npm run e2e` (a reviewer
 *  could not find the 1400+ locks), and its layout omitted tests/, e2e/,
 *  scripts/ and connector/ entirely. */
test('README names only real npm scripts, and names the verification ones', () => {
  const readme = read('README.md')
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
  // Every `npm run X` / `npm test` the README mentions must exist.
  for (const m of readme.matchAll(/npm run ([a-z0-9:.-]+)/g)) {
    assert.ok(pkg.scripts[m[1]], `README documents "npm run ${m[1]}" which package.json does not define`)
  }
  // …and the ones a reviewer needs in order to CHECK the work must be present.
  for (const required of ['test', 'e2e', 'ui:sweep']) {
    const cited = required === 'test' ? /npm (run )?test\b/.test(readme) : readme.includes(`npm run ${required}`)
    assert.ok(cited, `README should tell a reader how to run "${required}"`)
  }
})

test('README project layout lists every top-level source directory', () => {
  const layout = read('README.md').split('## Project layout')[1] ?? ''
  assert.ok(layout, 'the layout section exists')
  for (const dir of ['contract', 'server', 'src', 'docs', 'tests', 'e2e', 'scripts', 'connector']) {
    assert.ok(new RegExp('(^|\n)' + dir + '/').test(layout), `README layout omits ${dir}/`)
  }
})

test('README names the SDK dependency at the model boundary', () => {
  const readme = read('README.md')
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
  const serverDependency = '@anthropic-ai/sdk'
  assert.ok(pkg.dependencies[serverDependency], `${serverDependency} remains the generation-boundary dependency`)
  assert.ok(readme.includes(serverDependency), `README should name ${serverDependency}`)
})
