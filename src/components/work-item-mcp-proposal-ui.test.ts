import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function assertExactTarget(source: string): void {
  assert.match(source, /candidate\.name === item\.target/, 'only the exact open MCP work-item target is admitted')
}

test('Work item primary MCP path is lazy and hands off to the canonical Contribution page', () => {
  const section = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredWorkItemMcpProposalPanel.tsx')))
  const page = stripComments(read(join(ROOT, 'src', 'components', 'WorkItemMcpProposalPanel.tsx')))

  assert.match(section, /import \{ DeferredWorkItemMcpProposalPanel \} from '\.\/DeferredWorkItemMcpProposalPanel\.tsx'/)
  assert.match(section, /<DeferredWorkItemMcpProposalPanel[\s\S]*project=\{project\}[\s\S]*item=\{o\}[\s\S]*onOpenContribution=\{\(contributionId\) => rel\.navigate\('projects', project\.id, `changes\/\$\{contributionId\}`\)\}/)
  assert.match(section, /DeferredWorkItemMcpProposalPanel[\s\S]*FoldSection[\s\S]*title="Draft response"/,
    'the item-first action precedes the optional prose response path')
  assert.match(section, /heldDraftSelection && !heldDraftSelection\.mcpProposal/,
    'a held MCP argument draft does not open the prose response helper')
  assert.match(section, /!heldMcpDraftSelection && \(showProjectWorkDraft \|\| projectWorkDraftHeld\)/,
    'a held MCP argument draft suppresses any already-open prose panel')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/WorkItemMcpProposalPanel\.tsx'\)/)
  assert.match(deferred, /class WorkItemMcpProposalLoadBoundary extends Component/)
  assert.match(deferred, /data-work-item-mcp-proposal-load="failed"/)
  assert.match(page, /title="Work this item now"/)
  assert.match(page, /label="Work this item now"/)
  assert.match(page, /data-work-item-mcp-proposal-review/)
  assert.match(page, /data-work-item-mcp-proposal-publish[\s\S]*Publish contribution/)
  const helperActionIndex = page.indexOf('data-work-item-mcp-proposal-draft')
  const argumentEditorIndex = page.indexOf('data-work-item-mcp-proposal-arguments')
  const publishIndex = page.indexOf('data-work-item-mcp-proposal-publish')
  assert.ok(helperActionIndex >= 0 && helperActionIndex < argumentEditorIndex,
    'model review/action precedes the final editable MCP arguments')
  assert.ok(argumentEditorIndex < publishIndex,
    'Publish follows the exact editable arguments, not the prior model suggestion')
  assert.match(page, /const adoptArguments = \([\s\S]*setHelperOpen\(false\)[\s\S]*requestAnimationFrame\(\(\) => argumentsInput\.current\?\.focus\(\)\)/,
    'adopting closes the helper and focuses the exact arguments field')
  assert.match(page, /data-work-item-mcp-proposal-adopted[\s\S]*Review these exact arguments before publishing/,
    'adoption leaves an accessible review status beside the editable arguments')
})

test('the proposal is exact-target, live-revision gated, editable, and not execution consent', () => {
  const page = stripComments(read(join(ROOT, 'src', 'components', 'WorkItemMcpProposalPanel.tsx')))
  const helper = stripComments(read(join(ROOT, 'src', 'components', 'ContributionMcpDraftHelper.tsx')))
  const manual = stripComments(read(join(ROOT, 'src', 'components', 'WorkItemContributionPanel.tsx')))

  assert.match(page, /itemQuery\.status === 'success' && eligibleItem/)
  assert.match(page, /connection\.status !== 'connected' \|\| connection\.inspectedAt === null \|\| connection\.execution !== 'approval-required'/)
  assert.match(page, /\!\(connection\.executableTools \?\? \[\]\)\.includes\(item\.target\)/)
  assertExactTarget(page)
  assert.match(page, /connection\.revision === activeSelection\.connectionRevision/)
  assert.match(page, /initialMcpProposal: requestSelection/)
  assert.match(page, /isContributionCreationHeld\(project\.id\)/,
    'the publish handler synchronously rechecks the shared contribution-creation lock')
  assert.match(page, /!dispatchHeld && !dispatchMutation\.busy/,
    'publication waits for any held or running model draft to settle')
  assert.match(page, /parseContributionMcpArguments\(argumentsText\)/)
  assert.match(page, /data-work-item-mcp-proposal-arguments/)
  assert.match(page, /const draftFieldsDisabled = blockedByCreation \|\| !!heldIntent \|\| !!heldDispatchMcp/,
    'the exact held model Dispatch freezes fields whose change handlers reject edits')
  assert.equal((page.match(/disabled=\{draftFieldsDisabled\}/g) ?? []).length, 3,
    'title, summary, and reviewed arguments expose the same honest disabled state')
  assert.match(page, /Review inspected tool schema/)
  assert.match(page, /data-work-item-mcp-proposal-publish/)
  assert.match(page, /isContributionCreationHeld\(project\.id\)/,
    'the submit handler synchronously rechecks the shared held lock')
  assert.match(page, /accountGeneration\(\) === requestedGeneration/)
  assert.match(page, /heldIntent\.request\.initialMcpProposal/)
  assert.match(page, /heldProjectWorkDraftSelection\(project\.id, item\.id\)/)
  assert.match(page, /heldDispatchMcp \?\? heldIntent\?\.request\.initialMcpProposal \?\? selection/,
    'held Dispatch restores and takes priority as the exact tool selection')
  assert.match(page, /!!heldDispatchMcp \|\| !!mcpDraft/,
    'held MCP Dispatch forces the item-first panel and helper visible')
  assert.match(page, /disabled=\{blockedByCreation \|\| connectionsQuery\.status !== 'success'[\s\S]*\|\| !!heldDispatchMcp\}/,
    'the exact tool selection cannot be changed while its Dispatch acknowledgement is held')
  assert.match(page, /helperOpen \|\| !!heldDispatchMcp/)
  assert.match(page, /savedDraft\.initialMcpProposal && !savedDraft\.mcpDraft/,
    'raw JSON edits survive Dismiss instead of being replaced with formatted proposal arguments')
  assert.match(page, /clearContributionCreationDraft\(project\.id, item\.id, 'mcp'\)/,
    'the user can explicitly clear only the unsent MCP draft')
  assert.match(page, /data-work-item-mcp-proposal-cancel[\s\S]*Cancel MCP proposal draft/)
  assert.match(page, /any saved model reply remains in Dispatch/)
  assert.match(page, /if \(manualDraftExists \|\| heldDispatchMcp \|\| blockedByCreation \|\| heldIntent\) return/,
    'MCP editor events cannot overwrite another local draft or a held Dispatch selection')
  assert.match(page, /manualDraftExists && <p role="status" data-work-item-mcp-proposal-manual-draft/,
    'the structured panel explains when a pre-existing manual draft owns this item form')
  assert.match(page, /userId \?\? ''\}\\0\$\{generation/,
    'same-tenant person switches and account generations reset in-memory editor identity')
  assert.match(page, /identity\.current\.userId === requestedUserId && identity\.current\.generation === requestedGeneration/)
  assert.match(page, /savedDraft\.mcpDraft/)
  assert.match(page, /subscribeContributionCreationApplied/)
  assert.match(page, /event\.intentId !== draftRef\.current\.intentId/)
  assert.match(page, /!draftRef\.current\.isMcpProposal/,
    'a prose-only held create cannot be mistaken for this MCP flow')
  assert.match(page, /onOpenContribution\(event\.contributionId\)/)
  assert.match(page, /latestAppliedContributionCreation\(project\.id, item\.id\)/)
  assert.match(page, /contribution\.id === latestApplied\.contributionId && contribution\.workItemId === item\.id/,
    'remount recovery only offers the acknowledged door after a fresh exact linked Contribution read')
  assert.match(page, /aria-label="Open saved Contribution"/)
  assert.match(page, /reveal=\{expanded \|\| !!heldIntent \|\| !!heldDispatchMcp \|\| !!latestApplied\?\.initialMcpProposal\}/,
    'the exact applied receipt is visible after returning to a remounted work item')
  assert.match(page, /<pre tabIndex=\{0\} aria-label="Inspected MCP tool schema"/)
  assert.match(page, /DeferredContributionMcpDraftHelper/)
  assert.match(page, /onAdopt=\{adoptArguments\}/)
  assert.match(page, /CONTRIBUTION_LOCAL_STDIO_DISCLOSURE/)
  assert.match(page, /publishing shares the reviewed arguments with Project readers and creates one unapproved call; approval and Run remain separate/i)
  assert.match(helper, /data-contribution-mcp-draft-adopt[\s\S]*Use draft arguments/)
  assert.match(helper, /rolePermits\(role, 'read'\)/,
    'shared Project contributors can use their own read-capable Commission; this path has no owner-only gate')
  assert.doesNotMatch(page, /project\.own|project\.owner/)
  assert.doesNotMatch(page, /enqueueContributionEnvelopeProposal|enqueueContributionEnvelopeApproval|beginContributionMcpEffect|enqueueContributionMcpEffect/,
    'creating the initial unapproved envelope never proposes, approves, or runs it')
  assert.match(manual, /savedDraft && !savedDraft\.mcpDraft && !savedDraft\.initialMcpProposal/,
    'the prose-only form cannot present the same held structured call as an ordinary declaration')
  assert.match(manual, /structuredDraftExists/)
  assert.match(manual, /disabled=\{!me \|\| held \|\| structuredDraftExists\}/,
    'manual Start contribution is disabled while an MCP draft owns the item form')
  assert.match(manual, /!structuredDraftExists && \(eligible \|\| Boolean\(heldIntent\)/,
    'manual fields are hidden while an MCP draft owns the item form')
  assert.match(manual, /clearContributionCreationDraft\(projectId, item\.id, 'manual'\)/)
  assert.match(manual, /data-work-item-contribution-cancel[\s\S]*Cancel manual draft/)

  const wrongTarget = page.replace('candidate.name === item.target', 'candidate.name !== item.target')
  assert.notEqual(wrongTarget, page, 'the wrong-target negative control changes the current gate')
  assert.throws(() => assertExactTarget(wrongTarget), /exact open MCP work-item target/)
})
