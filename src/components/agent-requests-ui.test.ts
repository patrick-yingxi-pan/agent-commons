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
  assert.match(shareReply, /decideRequest\(row\.id, \{ action: 'share', expectedRevision: reviewed\.revision, reply: reviewed\.reply \}\)/,
    'only the exact reviewed reply and reviewed revision are sent to the requester')
  assert.doesNotMatch(shareReply.slice(0, shareReply.indexOf('>Review reply</')), /decideRequest\(/,
    'editing or reviewing reply text does not itself disclose it')
})

test('owner replies do not depend on optional tool discovery and review pins the request revision', () => {
  const runtime = stripComments(read(join(ROOT, 'src/components/AgentRequestsPageRuntime.tsx')))
  const share = runtime.slice(runtime.indexOf('function ShareReply('), runtime.indexOf('function RequestDetail('))
  const detail = runtime.slice(runtime.indexOf('function RequestDetail('))
  assert.match(detail, /\['waiting', 'awaiting-reply'\]\.includes\(row\.status\) && <ShareReply/,
    'a plain answer is available before tool execution')
  assert.match(detail, /useState\(false\)[\s\S]*toolsOpen && <OwnerRun/,
    'private tool discovery is mounted only after explicit expansion')
  assert.match(detail, /aria-expanded=\{toolsOpen\}/)
  assert.match(detail, /row\.argumentDraft\?\.status === 'pending'/)
  assert.match(detail, /resolveResourceUnavailable\(\[query\], \{ notFoundIsMissing: true \}\)/,
    'an existence-hiding private-request 404 is unavailable, not a connection failure')
  assert.match(share, /const fresh = reviewed === null \|\| reviewed\.revision === row\.revision/)
  assert.match(share, /setReviewed\(\{ reply, revision: row\.revision \}\)/)
  assert.match(share, /disabled=\{held \|\| !fresh\}/)
  assert.match(share, /This request changed after your review/)
  assert.doesNotMatch(runtime, /\btext-danger(?=["\s])/,
    'all request validation and stale-review errors use the readable text token, never the status-swatch red')
  assert.doesNotMatch(share, /useAgentRequestReview|useProviders|action: 'run'|action: 'draft-arguments'/)
})

test('argument advice is explicitly requested, private, stale-bound and only copied into the editable review flow', () => {
  const draft = stripComments(read(join(ROOT, 'src/components/AgentRequestArgumentDraft.tsx')))
  const runtime = stripComments(read(join(ROOT, 'src/components/AgentRequestsPageRuntime.tsx')))
  const ownerRun = runtime.slice(runtime.indexOf('function OwnerRun('), runtime.indexOf('function ShareReply('))

  assert.match(draft, /action: 'draft-arguments', expectedRevision: row\.revision, binding/,
    'the model runs only after an explicit owner action against a frozen current binding')
  assert.match(draft, /This sends the requested outcome, this Agent’s instructions and the selected tool’s description and schema/)
  assert.match(draft, /no conversation history, connection credentials or tool results/)
  assert.match(draft, /One attempt per request; local token limits are not a billing cap/)
  assert.match(draft, /Drafting does not run the tool or share a reply/)
  assert.match(draft, /Drafting arguments… No tool is running/)
  assert.match(draft, /data-agent-request-draft-binding[^\n]*draft\.binding\.toolName[^\n]*draft\.binding\.model/,
    'every saved draft shows its bound tool and model independently of the editable selector')
  assert.match(draft, /Suggested arguments · private to you/)
  assert.match(draft, /<pre \{\.\.\.namedReadRegionProps\('Suggested arguments', 'agent-request'\)\}/,
    'bounded model suggestions use the shared named keyboard-readable region')
  assert.match(draft, /onUse\(JSON\.stringify\(draft\.arguments, null, 2\)\)/,
    'Use draft copies into the controlled arguments editor instead of dispatching a tool')
  assert.doesNotMatch(draft.slice(draft.indexOf('onUse(')), /decideRequest\(.*action: 'run'/s)
  assert.match(draft, /Object\.keys\(binding\)\.every\(key =>[\s\S]*draft\.binding/,
    'a retained suggestion is usable only when every model/tool coordinate still matches')
  assert.match(draft, /suggestion is retained as history; enter arguments manually/)
  assert.match(draft, /attempt will not repeat/)

  assert.match(ownerRun, /row\.argumentDraft\?\.status !== 'pending'/,
    'pending model work blocks the exact-call review/Run path')
  assert.match(ownerRun, /<AgentRequestArgumentDraft row=\{row\} review=\{query\.data\} chosen=\{chosen\}/)
  assert.match(ownerRun, /onUse=\{argumentsJson => setAgentRequestDraft\(row\.id, \{ \.\.\.draft, arguments: argumentsJson \}\)\}/)
  assert.match(ownerRun, /decideRequest\(row\.id, \{ action: 'run', expectedRevision: row\.revision, approval: reviewed \}\)/,
    'execution remains a separate later human-reviewed decision')

  const explicit = /onClick=\{\(\) => \{\s*if \(binding && !held\) decideRequest\(row\.id, \{ action: 'draft-arguments'/
  assert.match(draft, explicit)
  assert.throws(() => assert.match(draft.replace('if (binding && !held)', 'if (binding)'), explicit), assert.AssertionError,
    'a disabled/in-flight held page cannot start another model request')
  const use = /onClick=\{\(\) => \{ if \(!held\) onUse\(JSON\.stringify\(draft\.arguments, null, 2\)\) \}\}/
  assert.match(draft, use)
  assert.throws(() => assert.match(draft.replace('if (!held) onUse(', 'onUse('), use), assert.AssertionError,
    'a held request cannot replace the editable arguments')
})

test('reply advice is lazy, one-shot, private, binding-current and only adopted after an explicit replacement choice', () => {
  const draft = stripComments(read(join(ROOT, 'src/components/AgentRequestReplyDraft.tsx')))
  const runtime = stripComments(read(join(ROOT, 'src/components/AgentRequestsPageRuntime.tsx')))
  const share = runtime.slice(runtime.indexOf('function ShareReply('), runtime.indexOf('function RequestDetail('))
  const detail = runtime.slice(runtime.indexOf('function RequestDetail('))

  assert.match(draft, /useAgentRequestReplyReview\(row\.id, expanded\)/,
    'opening the optional branch is the sole trigger for private model binding reads')
  assert.match(draft, /aria-expanded=\{expanded\}[\s\S]*Draft a reply…/)
  assert.match(draft, /action: 'draft-reply', expectedRevision: row\.revision, binding, notes/,
    'generation is a revision-pinned owner decision with exactly the explicit notes field')
  assert.match(draft, /This sends only the request, Agent instructions and your notes/)
  assert.match(draft, /does not send conversation history, tool descriptions, schemas, tool results or connection credentials/)
  assert.match(draft, /One attempt per request; local token limits are not a billing cap/)
  assert.match(draft, /Suggested reply · private to you/)
  assert.match(draft, /Object\.keys\(binding\)\.every\(key =>[\s\S]*saved\.binding/,
    'the saved text is current only when every server-resolved model coordinate matches')
  assert.match(draft, /!reviewCurrent \|\| !bindingCurrent/,
    'stale request or model review leaves the suggestion private and unusable')
  assert.match(draft, /onClick=\{\(\) => setConfirmReplace\(true\)\}>Use reply draft/)
  assert.match(draft, /onUse\(saved\.text\)/,
    'text moves into the manually editable reply only after explicit confirmation')
  assert.match(draft, /This one attempt will not repeat automatically/)
  assert.doesNotMatch(draft, /localStorage|sessionStorage/)

  assert.match(share, /<AgentRequestReplyDraft row=\{row\}/)
  assert.match(share, /row\.replyDraft\?\.status === 'pending'/,
    'pending model work holds manual Review/Share and remains cancelable')
  const adopt = /onUse=\{text => \{ setAgentRequestDraft\(row\.id, \{ \.\.\.draft, reply: text \}\); setReviewed\(null\) \}\}/
  assert.match(share, adopt, 'adopting new text clears the previous exact-text review')
  assert.throws(() => assert.match(share.replace('; setReviewed(null)', ''), adopt), assert.AssertionError,
    'a suggestion cannot inherit an earlier manual reply review')
  assert.match(detail, /row\?\.replyDraft\?\.status !== 'pending'/,
    'the page polls for the one in-flight reply draft after reload')
  assert.match(detail, /held=\{!editable \|\| row\.replyDraft\?\.status === 'pending'\}/,
    'a reply draft blocks optional tool execution while leaving Cancel request outside this gate')
  assert.match(detail, /row\.replyDraft\?\.status === 'pending'\}\s*title=/,
    'declining cannot overtake a pending private model attempt')
})
