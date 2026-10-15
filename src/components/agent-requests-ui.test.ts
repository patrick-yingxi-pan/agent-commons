/** Source lock for the private Agent-request page's deferred, explicit action surface. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

test('Requests keeps its named structural section and canonical selected rail row in every projection', () => {
  const page = stripComments(read(join(ROOT, 'src/components/SectionView.tsx')))
  const tree = stripComments(read(join(ROOT, 'src/components/SectionTreeChildren.tsx')))
  const check = (source: string) => {
    assert.match(source, /<AgentNestedGroup title="Requests"[^>]*onOpen=\{\(\) => onOpenSubview\('requests'\)\}>\s*<AgentRequestsSummary/)
    assert.match(source, /<FoldSection title="Requests"[^\n]*onOpenSubview\('requests'\)[^\n]*\n\s*<AgentRequestsSummary/)
  }
  check(page)
  assert.throws(() => check(page.replaceAll('title="Requests"', 'title="Untitled"')))
  const rail = tree.slice(tree.indexOf('function AgentRequestsRail('), tree.indexOf('function AgentStructureRow('))
  assert.ok(rail.includes('active={activeId === row.id}'), 'canonical identity is selected regardless of the entry subview')
  assert.ok(!rail.includes('activeSubview'), 'opening from overview cannot lose selection')
})

test('Agent request decision controls stay behind the lazy page boundary', () => {
  const shell = stripComments(read(join(ROOT, 'src/components/AgentRequestsPage.tsx')))
  const runtime = stripComments(read(join(ROOT, 'src/components/AgentRequestsPageRuntime.tsx')))

  const lazyRuntime = /const Page = lazy\(\(\) => import\('\.\/AgentRequestsPageRuntime\.tsx'\)/
  assert.match(shell, lazyRuntime,
    'decision controls load on demand instead of joining the eager section pane')
  assert.throws(() => assert.match(shell.replace('const Page = lazy(() => import(\'./AgentRequestsPageRuntime.tsx\')', 'const Page = AgentRequestsPageRuntime'), lazyRuntime),
    assert.AssertionError, 'the lazy-load lock rejects an eager runtime binding')
  assert.doesNotMatch(shell, /from ['"]\.\/AgentRequestsPageRuntime\.tsx['"]/, 'the runtime has no eager import edge')
  assert.match(shell, /DeferredLoadBoundary[\s\S]*Suspense[\s\S]*<Page \{\.\.\.props\} \/>/,
    'the lazy page has an announced loading state and a contained failure boundary')
  assert.match(shell, /export \{ AgentRequestsSummary \} from '\.\/AgentRequestsSummary\.tsx'/,
    'lightweight request history remains available without loading decision controls')

  const summary = stripComments(read(join(ROOT, 'src/components/AgentRequestsSummary.tsx')))
  const deferredSummary = /const Summary = lazy\(\(\) => import\('\.\/AgentRequestsSummaryRuntime\.tsx'\)/
  assert.match(summary, deferredSummary, 'shared history cannot be folded back into the navigation chunk')
  assert.throws(() => assert.match(summary.replace('const Summary = lazy(() => import(\'./AgentRequestsSummaryRuntime.tsx\')', 'const Summary = AgentRequestsSummaryRuntime'), deferredSummary), assert.AssertionError)
  assert.doesNotMatch(summary, /from ['"]\.\/AgentRequestsSummaryRuntime\.tsx['"]/)
  assert.match(summary, /DeferredLoadBoundary[\s\S]*Suspense[\s\S]*<Summary \{\.\.\.props\} \/>/)
  assert.match(summary, /Copy unsent workspace text before reloading/)
  const directHistory = (source: string) => {
    assert.match(source, /from '\.\/AgentRequestsSummaryRuntime\.tsx'/)
    assert.doesNotMatch(source, /from '\.\/AgentRequests(?:Summary|Page)\.tsx'/)
  }
  directHistory(runtime)
  assert.throws(() => directHistory(runtime.replace('./AgentRequestsSummaryRuntime.tsx', './AgentRequestsSummary.tsx')), assert.AssertionError,
    'the decision runtime cannot import history through its navigation-owned shell')

  const ownerRunStart = runtime.indexOf('function OwnerRun(')
  const shareStart = runtime.indexOf('function ShareReply(', ownerRunStart)
  const detailStart = runtime.indexOf('function RequestDetail(', shareStart)
  assert.ok(ownerRunStart >= 0 && shareStart > ownerRunStart && detailStart > shareStart,
    'owner execution and reply-sharing surfaces are independently identifiable')
  const ownerRun = runtime.slice(ownerRunStart, shareStart)
  const shareReply = runtime.slice(shareStart, detailStart)

  const startsUnchecked = /setReviewed\(chosen\.transport === 'stdio' \? \{ transport: 'stdio', localPrograms: true, call \} : \{ transport: 'http', call \}\)\s*setLocal\(false\)/
  assert.match(ownerRun, startsUnchecked,
    'reviewing any exact call starts with local-program consent unchecked')
  assert.throws(() => assert.match(ownerRun.replace('setLocal(false)', 'setLocal(true)'), startsUnchecked),
    assert.AssertionError, 'the unchecked-consent lock rejects defaulting local consent on')
  const localCheckbox = /reviewed\.transport === 'stdio' && <CheckboxRow checked=\{local\}/
  assert.match(ownerRun, localCheckbox,
    'the additional consent is only presented for local programs')
  assert.throws(() => assert.match(ownerRun.replace("reviewed.transport === 'stdio' && <CheckboxRow", "reviewed.transport !== 'stdio' && <CheckboxRow"), localCheckbox),
    assert.AssertionError, 'the local-consent lock rejects removing the local-only checkbox')
  const runGate = /disabled=\{held \|\| !fresh \|\| !matches \|\| \(reviewed\.transport === 'stdio' && !local\)\}[\s\S]*>Run once<\//
  assert.match(ownerRun, runGate,
    'execution is unavailable until current review matches and local consent is affirmatively checked')
  assert.throws(() => assert.match(ownerRun.replace("reviewed.transport === 'stdio' && !local", "reviewed.transport === 'stdio' && local"), runGate),
    assert.AssertionError, 'the run-gate lock rejects inverted local-consent gating')
  assert.match(ownerRun, />Review call<\/[\s\S]*>Run once<\//,
    'tool and arguments must be reviewed before the separate execution control appears')

  assert.match(shareReply, /reviewed === null[\s\S]*>Review reply<\/[\s\S]*>Share reply<\//,
    'a reply is reviewed before a separate disclosure action')
  assert.match(shareReply, /decideRequest\(row\.id, \{ action: 'share', expectedRevision: row\.revision, reply: reviewed \}\)/,
    'only the exact reviewed reply is sent to the requester')
  assert.doesNotMatch(shareReply.slice(0, shareReply.indexOf('>Review reply</')), /decideRequest\(/,
    'editing or reviewing reply text does not itself disclose it')
})
