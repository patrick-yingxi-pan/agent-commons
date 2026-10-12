import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function assertExactBindingGate(source: string): void {
  assert.match(source, /preview\.bindingHash === currentHash/, 'adoption only accepts the exact current caller, connection, revision, and schema binding')
}

function assertFreshReplyGate(source: string): void {
  assert.match(source, /const savedReply = sessionQuery\.status === 'success' \? reply : undefined/, 'failed reads never expose cached reply text for adoption')
}

test('Contribution MCP argument drafts stay workspace-scoped, exact-bound, and explicitly adopted', () => {
  const card = stripComments(read(join(ROOT, 'src', 'components', 'ContributionEnvelopeCard.tsx')))
  const helper = stripComments(read(join(ROOT, 'src', 'components', 'ContributionMcpDraftHelper.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredContributionMcpDraftHelper.tsx')))
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const dispatch = stripComments(read(join(ROOT, 'src', 'api', 'dispatchCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'dispatchMutations.ts')))
  const responseDrafts = stripComments(read(join(ROOT, 'src', 'components', 'ProjectWorkDraftPanel.tsx')))

  assert.match(section, /const heldMcpDraft = c\.workItemId \? heldProjectWorkDraftSelection\(project\.id, c\.workItemId\) : null/,
    'navigation recovery is keyed to this exact linked work item')
  assert.match(section, /heldMcpDraft=\{heldMcpDraft\}/)
  assert.match(card, /heldMcpDraft: ReturnType<typeof heldProjectWorkDraftSelection>/)
  assert.match(card, /data-contribution-mcp-draft-recovery[\s\S]*Review held argument draft/,
    'the linked Contribution can reconstruct its held selection after navigation')
  assert.match(card, /mcpConnectionId: heldSelection\.connectionId,[\s\S]*mcpConnectionRevision: heldSelection\.connectionRevision,[\s\S]*mcpToolName: heldSelection\.toolName/,
    'recovery restores the exact frozen connection revision and tool without guessing a replacement')
  assert.match(card, /c\.workItemId !== undefined && workItemsQuery\.status === 'success'[\s\S]*mcpConnections\.status === 'success' && exactWorkItem !== undefined && choice !== undefined && exactTool !== undefined[\s\S]*line\.mcpConnectionRevision === choice\.connection\.revision/,
    'the helper only opens against a healthy exact open MCP work item and live matching tool revision')
  assert.match(card, /data-contribution-mcp-draft-disclosure/)
  assert.match(card, /onAdopt=\{\(argumentsValue\) => updateDraftLine\(index, \{ mcpArgumentsText: formatContributionMcpArguments\(argumentsValue\) \}\)\}/,
    'adoption writes only the existing editable arguments field')

  assert.match(helper, /commission\.mine === true && rolePermits\(role, 'read'\) && agent/,
    'only an owned read-capable Commission and its existing Agent are eligible')
  assert.match(helper, /chosen model receives the selected Agent.s configured system prompt and instructions/,
    'the disclosure names Agent prompt material sent through normal model framing')
  assert.match(helper, /projectWorkMcpDraftBindingText\(tenantId, userId, selection, currentTool\)/)
  assert.match(helper, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(helper, /parseProjectWorkMcpDraftReply\(savedReply\.content, preview\.toolName\)/,
    'the saved reply must parse as the exact expected tool arguments object')
  assertFreshReplyGate(helper)
  assert.match(helper, /reviewRun\.execution\?\.state === 'replied'[\s\S]*sessionQuery\.status === 'success' && !!savedReply/,
    'adoption requires a replied Dispatch run and a fresh successful read of its exact first reply')
  assert.match(helper, /if \(!parsedReply\?\.ok \|\| !runIsCurrent \|\| !readsReady \|\| disabled \|\| dispatchHeld \|\| held\?\.mcpProposal \|\| !reviewRun\) return/,
    'the event handler rechecks every binding and hold even if invoked outside the enabled button')
  assert.match(helper, /data-contribution-mcp-draft-current-arguments/,
    'current editable arguments are shown before the explicit replacement action')
  assert.match(helper, /data-contribution-mcp-draft-adopt[\s\S]*Use draft arguments/)
  assert.match(helper, /data-contribution-mcp-draft-invalid/)
  assert.doesNotMatch(helper, /beginContributionMcpEffect|enqueueContributionEnvelopeApproval|enqueueContributionEnvelopeProposal/,
    'argument drafting does not call a tool or propose/approve the envelope')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ContributionMcpDraftHelper\.tsx'\)/,
    'the helper remains a leaf outside eager navigation chunks')
  assert.doesNotMatch(deferred, /DeferredLoadBoundary|InlineOperationStatus|Spinner/,
    'the helper wrapper does not back-edge into shared SectionPane presentation chunks')
  assert.match(deferred, /ContributionMcpDraftLoadBoundary[\s\S]*data-contribution-mcp-draft-load="failed"[\s\S]*Reload app/)

  assertExactBindingGate(helper)
  const staleHashGate = helper.replace('preview.bindingHash === currentHash', 'preview.bindingHash !== currentHash')
  assert.notEqual(staleHashGate, helper, 'the stale-binding mutation changes the reviewed source')
  assert.throws(() => assertExactBindingGate(staleHashGate), /exact current caller/)
  const cachedReplyGate = helper.replace("sessionQuery.status === 'success' ? reply : undefined", 'reply')
  assert.notEqual(cachedReplyGate, helper, 'the cached-reply mutation changes the reviewed source')
  assert.throws(() => assertFreshReplyGate(cachedReplyGate), /failed reads never expose cached reply text/)

  assert.match(dispatch, /mcpProposal: intent\.mcpProposal/)
  assert.match(dispatch, /ProjectWorkDraftInput/)
  assert.match(controller, /mcpProposal: input\.mcpProposal \? \{ \.\.\.input\.mcpProposal \} : undefined/,
    'the held selector is detached from caller-owned object references')
  assert.match(controller, /mcpProposal: intent\.mcpProposal \? \{ \.\.\.intent\.mcpProposal \} : undefined/,
    'navigation recovery returns a detached exact selector')
  assert.match(responseDrafts, /!run\.execution\?\.mcpProposal/,
    'structured argument drafts never appear as ordinary prose response drafts')
})
