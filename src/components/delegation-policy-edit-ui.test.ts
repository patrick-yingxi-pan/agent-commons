import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Delegation policy editing keeps owner authority versioned and recovery reachable', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'DelegationPanel.tsx')))
  const editor = stripComments(read(join(ROOT, 'src', 'components', 'DelegationPolicyEditor.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredDelegationPolicyEditor.tsx')))
  const api = stripComments(read(join(ROOT, 'src', 'api', 'delegationPolicyCommands.ts')))
  const revision = stripComments(read(join(ROOT, 'src', 'api', 'delegationRevision.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'delegationPolicyMutations.ts')))
  const drafts = stripComments(read(join(ROOT, 'src', 'controller', 'delegationPolicyDrafts.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'DelegationPolicyMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.ok(/d\.mine === true[\s\S]*?aria-label=\{`Edit \$\{d\.agentLabel\}'s delegation policy`\}/.test(panel), 'editing is owner-only and names its exact Delegation')
  assert.match(panel, /d\.mine === true && project\.own !== false && <button/, 'policy edits require both original delegation and current Project authority')
  assert.match(panel, /d\.mine === true \|\| project\.own !== false/, 'the current Project owner may revoke another delegator’s grant')
  assert.match(panel, /editingDelegationId === d\.id && d\.mine === true && project\.own !== false/, 'restored editors cannot bypass current authority')
  assert.match(editor, /useSyncExternalStore\(subscribeDelegationPolicyDrafts, delegationPolicyDraftGeneration\)/, 'all panes render one live draft')
  assert.doesNotMatch(editor, /\[draft, setDraft\]/, 'pane-local copies cannot overwrite another editor')
  assert.match(panel, /aria-busy=\{revoking \|\| policyHeld\}/)
  assert.match(panel, /disabled=\{revoking \|\| policyHeld\}/, 'the same row cannot revoke during an uncertain policy edit')
  assert.match(view, /d\.expired !== true && !\(d\.expiresAt != null && d\.expiresAt <= delegationNow\)/)
  assert.match(view, /disabled=\{lifecycleHeld \|\| isDelegationPolicyHeld\(delegationAction\.id\)\}/)
  assert.match(panel, /Expired · Ask unavailable/)
  assert.match(panel, /expired \? 'Expired' : 'Expires'\} \{formatDelegationTime\(d\.expiresAt\)\}/)
  assert.match(panel, /Version history \(\{d\.versions!\.length\}\)/)
  assert.match(panel, /d\.mine === true && \(d\.versions\?\.length \?\? 0\) > 0/)
  assert.match(panel, /Times use \{delegationTimeZone\(\)\} and are sent as UTC/)

  assert.match(deferred, /Promise\.all\([\s\S]*import\('\.\/DelegationPolicyEditor\.tsx'\)[\s\S]*prepareDelegationPolicyRuntime\(\)/)
  assert.match(editor, /expectedRevision: draft\.expectedRevision/)
  assert.match(editor, /policy: draft\.policy\.trim\(\)/)
  assert.match(editor, /escalation,/)
  assert.match(editor, /mode: draft\.mode/)
  assert.match(editor, /expiresAt,/)
  assert.match(editor, /draft\.expiryChanged \? parseLocalDateTime\(draft\.expiryInput\) : draft\.expiryAt \?\? null/)
  assert.match(editor, /submittedGeneration !== delegationPolicyAccountGeneration\(\)/)
  assert.match(facade, /settleDelegationPolicyDraft/)
  assert.match(deferred, /label: 'Reload app'/)
  assert.doesNotMatch(deferred, /Try loading again/)
  assert.match(editor, /Review current version and keep my draft/)
  assert.match(editor, /Save policy version/)
  assert.match(drafts, /clearDelegationPolicyDrafts\(\)/)
  assert.match(facade, /issuedGeneration === accountGeneration/)
  assert.match(api, /versions\.some\(\(version\) => sameVersion\(version, intent\.request\)\)/)
  assert.match(revision, /current\.revision \?\? 0\) > \(incoming\.revision \?\? 0\)/)
  assert.match(notice, /Retry exact edit/)
  assert.match(shell, /<DelegationPolicyMutationNotice \/>/)
})

test('deferred Delegation states keep the canonical folded section geometry', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'DelegationPanel.tsx')))
  for (const [name, source] of [['placeholder', view], ['loaded panel', panel]]) {
    assert.match(source, /<FoldSection\s+title="Delegation"\s+defaultFolded/, `${name} must use the same shared folded-section anatomy`)
  }
  assert.match(view, /<Suspense fallback=\{<DelegationPanelPlaceholder \/>\}>/)
  assert.match(view, /\? <DelegationPanelPlaceholder failed \/>/)
})
