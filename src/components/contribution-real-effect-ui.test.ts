/** Source locks for the separately confirmed, non-retrying real MCP workflow. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Contribution real MCP UI reviews exact inputs, gates execution, and renders durable receipts as inert text', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const card = stripComments(read(join(ROOT, 'src', 'components', 'ContributionEnvelopeCard.tsx')))
  const api = stripComments(read(join(ROOT, 'src', 'api', 'contributionMcpEffectCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'contributionMcpEffectMutations.ts')))
  const proposal = stripComments(read(join(ROOT, 'src', 'controller', 'contributionEnvelopeProposalMutations.ts')))
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredContributionEnvelopeCard.tsx')))
  const presentation = stripComments(read(join(ROOT, 'src', 'lib', 'contributionEffectPresentation.ts')))

  assert.match(view, /<DeferredContributionEnvelopeCard[\s\S]*onPropose=\{enqueueContributionEnvelopeProposal\}/)
  assert.match(card, /contributionMcpChoices\(mcpConnections\.data\?\.connections/)
  assert.match(card, /choice\.connection\.revision !== line\.mcpConnectionRevision/,
    'a changed binding invalidates the user-reviewed revision instead of silently retargeting')
  assert.match(card, /This is a real, per-call MCP proposal[\s\S]*visible to every Project reader[\s\S]*credentials remain private/)
  assert.match(card, /Confirming sends these arguments to the selected MCP tool once[\s\S]*visible to every Project reader[\s\S]*Envelope approval alone never sends/)
  assert.match(card, /This is a new call\. If an earlier result is unknown, running again may duplicate its effects\./)
  assert.match(card, /l\.mcp\.canRun === true/)
  assert.match(card, /data-contribution-effect-status=\{receipt\.status\}/)
  assert.match(card, /data-contribution-effect-id=\{receipt\.id\}/)
  assert.match(card, /<time dateTime=\{new Date\(receipt\.startedAt\)\.toISOString\(\)\} title=\{new Date\(receipt\.startedAt\)\.toISOString\(\)\}>[\s\S]*v\{receipt\.envelopeVersion\} · by \{receipt\.actor\}/,
    'saved receipts identify the exact envelope version, actor, and timestamp without active links')
  assert.match(card, /aria-label=\{`Approved arguments for \$\{l\.mcp\.toolName\}`\}[\s\S]*\[overflow-wrap:anywhere\]/,
    'long saved arguments remain keyboard-scrollable and wrap inside a narrow pane')
  assert.match(card, /\{l\.type\} → <span className="font-medium">\{l\.target\}<\/span>[\s\S]*overflow-wrap:anywhere/,
    'long saved tool names and targets wrap instead of disappearing behind ellipsis')
  assert.match(card, /Saved call · \{l\.mcp\.connectionLabel\}[\s\S]*break-words \[overflow-wrap:anywhere\]/,
    'long saved connection/tool labels wrap inside the pane')
  assert.match(card, /aria-label=\{`Arguments for \$\{receipt\.toolName\}`\}/)
  assert.match(card, /aria-label=\{`Saved result for \$\{receipt\.toolName\}`\}/)
  assert.match(card, /tabIndex=\{0\}[\s\S]*role="region"/)
  assert.match(card, /JSON\.stringify\(receipt\.result, null, 2\)/)
  assert.match(card, /This receipt is terminal\. The call will not be repeated automatically\./)
  assert.match(card, /Check saved receipt/)
  assert.doesNotMatch(card, /href=\{[^}]*receipt\.(?:result|arguments)/,
    'untrusted tool output is rendered as plain text, never as an auto-opened link')
  assert.match(view, /const localMcpAttempt = useContributionMcpEffectAttempt\(project\.id, contributionId\)/,
    'the parent observes held attempts synchronously, before the lazy envelope mounts')
  assert.match(view, /const contributionActionHeld = lifecycleHeld \|\| mcpEffectPending/)
  assert.doesNotMatch(view, /onMcpAttemptChange|setLocalMcpAttempt/,
    'lifecycle controls do not wait for a child effect callback to learn about a held call')
  assert.match(view, /<ChangesetCard[^>]*lifecycleHeld=\{contributionActionHeld\}/)
  assert.match(view, /<DeferredContributionReviewPanel[\s\S]*lifecycleHeld=\{contributionActionHeld\}/)
  assert.match(view, /<DeferredDelegatedJudgmentPanel[\s\S]*lifecycleHeld=\{contributionActionHeld\}/)
  assert.match(view, /disabled=\{contributionActionHeld\}[\s\S]*Require review/)
  assert.match(view, /disabled=\{contributionActionHeld\}[\s\S]*Land/)

  assert.match(api, /apiPost<Contribution>[\s\S]*paths\.contributionEffects/)
  assert.match(api, /candidate\.envelopeVersion === intent\.expectedVersion/)
  assert.match(api, /expectedSessionUserId: intent\.sourceUserId/)
  assert.equal((api.match(/invalidate\(keys\.attention\(intent\.projectId\)\)/g) ?? []).length, 2,
    'submit and receipt recovery both refresh the attention ledger as well as Contributions')
  assert.match(api, /async function readContributionMcpEffectReceipt[\s\S]*apiGet<Contribution\[]>[\s\S]*paths\.contributions/)
  const readStart = api.indexOf('export async function readContributionMcpEffectReceipt')
  assert.ok(readStart >= 0)
  assert.doesNotMatch(api.slice(readStart), /apiPost/)
  assert.match(controller, /submitContributionMcpEffectOnce\(attempt\.intent, attempt\.idempotencyKey\)/)
  assert.match(controller, /readContributionMcpEffectReceipt\(attempt\.intent, attempt\.idempotencyKey\)/)
  assert.match(deferred, /Promise\.all\([\s\S]*import\('\.\/ContributionEnvelopeCard\.tsx'\)[\s\S]*import\('\.\.\/controller\/contributionMcpEffectMutations\.ts'\)[\s\S]*prepareContributionMcpEffectCommands\(\)/,
    'the command module is admitted before showing the consent UI, so import failure cannot masquerade as post-send uncertainty')
  const recoveryStart = controller.indexOf('export async function checkContributionMcpEffectReceipt')
  assert.ok(recoveryStart >= 0)
  assert.doesNotMatch(controller.slice(recoveryStart), /submitContributionMcpEffectOnce/,
    'the recovery action only reads a receipt; no POST path is reachable from it')
  assert.match(proposal, /structuredClone\(line\.mcp\.arguments\)/)
  assert.match(proposal, /Object\.freeze\(value\)/)

  assert.match(presentation, /export const CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS = 'repeat\(auto-fit, minmax\(min\(100%, 8rem\), 1fr\)\)'/,
    'the field grid fits the available pane width instead of relying on viewport breakpoints')
  assert.match(presentation, /export const CONTRIBUTION_EFFECT_DISCLOSURE_CLASS = '[^']*text-ink-soft/,
    'multi-line disclosures use the readable text ramp on a tinted surface')
  assert.match(presentation, /export const CONTRIBUTION_EFFECT_DISCLOSURE_HEADING_CLASS = '[^']*text-ink/,
    'short warning headings use the shared readable foreground rather than the warm accent')
  assert.equal((card.match(/className=\{CONTRIBUTION_EFFECT_DISCLOSURE_HEADING_CLASS\}/g) ?? []).length, 3,
    'confirmation and both newly introduced uncertain-receipt headings share the readable class')
  assert.match(card, /<p className=\{CONTRIBUTION_EFFECT_DISCLOSURE_HEADING_CLASS\}>Review this exact external call<\/p>/,
    'the explicit confirmation heading stays readable on its tinted surface')
  assert.doesNotMatch(card, /Review this exact external call<\/p>[\s\S]{0,160}text-warn-text/)
  assert.ok((card.match(/data-contribution-envelope-fields/g) ?? []).length >= 1,
    'the envelope form fields expose one layout seam for measured browser checks')
  assert.match(card, /style=\{\{\s*gridTemplateColumns:\s*CONTRIBUTION_EFFECT_FIELD_GRID_COLUMNS\s*\}\}/)
  const disclosureStamps = [...card.matchAll(/<p[^>]*data-contribution-effect-disclosure[^>]*className=\{([^}]*)\}/g)]
  assert.ok(disclosureStamps.length >= 14, 'every external-action disclosure is stamped for contrast/layout review')
  for (const disclosure of disclosureStamps) {
    assert.match(disclosure[1] ?? '', /CONTRIBUTION_EFFECT_DISCLOSURE_CLASS/)
    assert.doesNotMatch(disclosure[1] ?? '', /text-warn-text/)
  }
  assert.match(card, /No inspected MCP tools are available[\s\S]*add and inspect a server in Contexts/i)
  assert.match(card, /Development-fixture actions are simulation-only[\s\S]*Only explicitly confirmed MCP tool calls use the real execution path/)
  assert.match(card, /Effect type[\s\S]*aria-label=\{`Effect type \$\{index \+ 1\}`\}/)
  assert.match(card, /Max acts[\s\S]*aria-label=\{`Max acts \$\{index \+ 1\}`\}/)
  assert.match(card, /line\.type !== 'mcp\.mutate'[\s\S]*Target[\s\S]*line\.type !== 'mcp\.mutate'[\s\S]*Harness/,
    'MCP target/harness are derived from the inspected tool, while legacy fields stay visible')
  assert.match(card, /transitionContributionEffectDraftType\(line, type\)/,
    'changing effect type uses the shared coherent draft transition')
  assert.match(card, /mcpConnectionId: '',[\s\S]*mcpConnectionRevision: null,[\s\S]*mcpToolName: '',[\s\S]*mcpArgumentsText: '\{\}'/,
    'changing effect type clears MCP selection, revision, tool, and hidden arguments')
  assert.match(card, /CONTRIBUTION_LEGACY_ENVELOPE_HARNESSES\.map\(/)
  assert.doesNotMatch(card, /(?<!LEGACY_)ENVELOPE_HARNESSES\.map\(/,
    'the legacy harness selector does not offer the MCP-only explicit-call authority')
  assert.doesNotMatch(card, /sm:grid-cols-\[minmax\(8rem/,
    'a viewport breakpoint with fixed minimums cannot overflow a narrow split pane')
})
