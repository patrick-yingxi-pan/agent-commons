import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function changesPanel(): string {
  return stripComments(read(join(ROOT, 'src', 'components', 'ChangesPanel.tsx')))
}

test('Offer a change holds one exact Proposal until server truth', () => {
  const projectHost = changesPanel()
  const genericHost = stripComments(read(join(ROOT, 'src', 'components', 'ProposalsPanel.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'socialProposalCreationCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'socialProposalCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'socialProposalCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'SocialProposalCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const route = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))

  assert.doesNotMatch(legacy, /export async function openSocialProposal/,
    'the invalidate-only creation command is removed')
  assert.doesNotMatch(projectHost, /openSocialProposal\(/)
  assert.doesNotMatch(genericHost, /openSocialProposal\(/)
  assert.match(projectHost, /enqueueSocialProposalCreation\(\{[\s\S]*?tenantId,[\s\S]*?request:/)
  assert.match(genericHost, /enqueueSocialProposalCreation\(\{[\s\S]*?tenantId,[\s\S]*?request:/)
  assert.match(projectHost, /heldOpen=\{changesHeld\}/)
  assert.match(genericHost, /heldOpen=\{held\}/)
  assert.match(projectHost, /data-social-proposal-creation-form[\s\S]*?aria-busy=\{changesHeld\}/)
  assert.match(genericHost, /data-social-proposal-creation-form[\s\S]*?aria-busy=\{held\}/)
  assert.match(projectHost, /disabled=\{changesHeld\}/, 'the Project form freezes its complete payload')
  assert.match(genericHost, /disabled=\{held\}/, 'generic typed forms freeze their selections and prose')
  assert.match(projectHost, /outcome === 'applied'[\s\S]*?setComposing\(null\)/)
  assert.match(genericHost, /outcome === 'applied'[\s\S]*?setComposing\(false\)/)
  assert.match(projectHost, /Your change offer is still here/)
  assert.match(genericHost, /Your change offer is still here/)

  assert.match(controller, /intentId: crypto\.randomUUID\(\)/)
  assert.match(controller, /heldSubjects/, 'the addressed subject is held eagerly while transport stays lazy')
  assert.match(controller, /accountGeneration/, 'late acknowledgement is fenced by account scope')
  assert.match(commands, /apiPost<SocialProposal>[\s\S]*?idempotencyKey/)
  assert.match(commands, /socialProposalCreationId\(intent\.tenantId, idempotencyKey\)/)
  assert.match(route, /const idempotencyKey = headerValue\(req\.headers, 'idempotency-key'\)/)
  assert.doesNotMatch(route, /r\.post\('\/proposals', idempotent\(/,
    'current subject visibility must be rechecked instead of replaying a cached success envelope')
  const represented = route.indexOf("if (represented && represented !== 'invalid') return sendJson(res, represented)")
  const parsed = route.indexOf('const input = await body<OpenProposalRequest>()', represented)
  assert.ok(represented >= 0 && parsed > represented,
    'durable replay returns represented truth before changed Retry input is parsed')
  assert.match(store, /id: options\.logicalId \?\? `sprop-/)
  assert.match(store, /return commitMutationBatch\(\(\) => \{[\s\S]*?socialProposals\.push\(p\)[\s\S]*?openDiscussion\([\s\S]*?persist\(\)/,
    'proposal, review thread, notification, events, and persistence share one commit')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(notice, /kind="social-proposal-create"/)
  assert.match(shell, /<SocialProposalCreationMutationNotice \/>/)
})

test('typed Improvements and Project Changes share one recovery grammar', () => {
  const projectHost = changesPanel()
  const genericHost = stripComments(read(join(ROOT, 'src', 'components', 'ProposalsPanel.tsx')))
  for (const host of [projectHost, genericHost]) {
    assert.match(host, /label=\{[^}]*Offering change[^}]*Offer a change|label="Offer a change"/)
    assert.match(host, /'Offering…' : 'Offer'/)
    assert.match(host, /Why[^"']*opens the review thread/)
  }
  assert.match(genericHost, /scheduleProposalFieldLabel\(f\)/,
    'typed routine choices use the shared human label funnel rather than wire keys')
})
