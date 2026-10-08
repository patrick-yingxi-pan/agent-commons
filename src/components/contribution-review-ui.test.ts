/** Source lock for owner-selected, version-pinned model review and public results. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('Contribution model reviews freeze a configured reviewer and keep results distinct from discussion', () => {
  const view = stripComments(read(join(ROOT, 'src', 'components', 'SectionView.tsx')))
  const panel = stripComments(read(join(ROOT, 'src', 'components', 'ContributionReviewPanel.tsx')))
  const selection = stripComments(read(join(ROOT, 'src', 'lib', 'contributionReviewSelection.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionReviewCommands.ts')))
  const facade = stripComments(read(join(ROOT, 'src', 'controller', 'contributionReviewMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionReviewMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionReviewMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))

  assert.match(view, /useContributionReviewStatus\(\)/)
  assert.match(view, /const lifecycleHeld =[\s\S]*reviewHeld/)
  assert.match(view, /<DeferredContributionReviewPanel[\s\S]*latestVersion=\{latestVersion\}[\s\S]*lifecycleHeld=\{contributionActionHeld\}/)
  assert.doesNotMatch(view, /import\s+\{\s*ContributionReviewPanel\s*\}/,
    'the heavy review surface remains outside SectionPane until its own module is admitted')
  assert.match(view, /disabled=\{commentHeld\}/,
    'the orthogonal Contribution discussion remains available during review')
  assert.doesNotMatch(view, /mock reviewer|reviewedVersion: latestVersion/)

  assert.match(selection, /agent\.tenantId !== tenantId/)
  assert.match(selection, /provider\.execution !== 'configured'/)
  assert.match(selection, /provider\.kind \?\? 'endpoint'/)
  assert.match(selection, /provider\.defaultModelId/)

  assert.match(panel, /project\.own !== false/)
  assert.match(panel, /aria-label="Reviewing Agent"/)
  assert.match(panel, /expectedVersion: latestVersion/)
  assert.match(panel, /agentRevision: selected\.agent\.revision \?\? 0/)
  assert.match(panel, /providerRevision: selected\.provider\.definitionRevision \?\? 0/)
  assert.match(panel, /connectionRevision: selected\.provider\.connectionRevision \?\? 0/)
  assert.match(panel, /uses budget again/)
  assert.match(panel, /The initiating Project owner’s budget is charged/)
  assert.match(panel, /SOFT_BUTTON_CLASS/)
  assert.match(panel, /review\.status === 'uncertain'/)
  assert.match(panel, /This is not a passing review/)
  assert.match(panel, /review\.status === 'failed'/)
  assert.match(panel, /review\.status === 'stale'/)
  assert.match(panel, /cannot use Agent tools or land changes automatically/)
  assert.match(panel, /No eligible reviewer is available/)
  assert.match(panel, /data-review-status=\{review\.status\}/)
  const publicCard = panel.slice(panel.indexOf('function ReviewRunCard'))
  assert.doesNotMatch(publicCard, /endpointUrl|apiKey|credential|reviewer\.agentId|providerId|agentId/,
    'public review cards do not expose private binding ids or connection material')

  assert.match(facade, /const existing = heldReviews\.get\(key\)[\s\S]*if \(existing\) return existing\.result/)
  assert.match(facade, /intentId: crypto\.randomUUID\(\)/)
  assert.match(facade, /options\.subscribeAccountSwitch \?\? onAccountSwitch\)\(\(\) => \{[\s\S]*heldReviews\.clear\(\)/)
  assert.match(facade, /createRetryableRuntimeLoader/)
  assert.match(facade, /loadFailures\.fail\(key\)/)
  assert.match(facade, /No request was sent/)
  assert.match(commands, /expectedVersion: intent\.expectedVersion/)
  assert.match(commands, /reviewer: intent\.reviewer/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*\{ idempotencyKey \}/)
  assert.match(commands, /review\.id === expectedId && review\.version === expectedVersion/)
  const apply = commands.slice(commands.indexOf('export async function applyContributionReview'), commands.indexOf('export async function reconcileContributionReview'))
  assert.doesNotMatch(apply, /receipt\.status|status === 'passed'/,
    'pending and every terminal receipt settle delivery without converting uncertainty to a pass')
  assert.match(commands, /candidate\.id === intent\.contributionId \? mergeReview\(candidate, receipt\)/,
    'a delayed receipt merges only into its addressed Contribution')
  assert.match(runtime, /createAcknowledgedActionMutationController/)
  assert.match(runtime, /discardReconcileFailure: 'retain'/,
    'an unreadable Dismiss truth check retains a potentially billable review intent')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(panel, /The Contribution changed or closed while this review ran/)
  assert.doesNotMatch(panel, /This result covers an older version/)
  assert.match(notice, /kind="contribution-review"/)
  assert.match(shell, /<ContributionReviewMutationNotice \/>/)
})
