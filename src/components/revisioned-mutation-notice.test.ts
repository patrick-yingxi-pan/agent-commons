import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT } from '../../tests/helpers/source.ts'

test('durable entity recovery shares one accessible shell-notice primitive', () => {
  const shared = read(join(ROOT, 'src', 'components', 'RevisionedMutationNotice.tsx'))
  const session = read(join(ROOT, 'src', 'components', 'SessionMetadataMutationNotice.tsx'))
  const schedule = read(join(ROOT, 'src', 'components', 'ScheduleMutationNotice.tsx'))
  const artifact = read(join(ROOT, 'src', 'components', 'ArtifactContentMutationNotice.tsx'))
  const proposal = read(join(ROOT, 'src', 'components', 'ProposalVerdictMutationNotice.tsx'))
  const agent = read(join(ROOT, 'src', 'components', 'AgentMutationNotice.tsx'))
  const actions = read(join(ROOT, 'src', 'components', 'ProposalVerdictActions.tsx'))
  const genericPanel = read(join(ROOT, 'src', 'components', 'ProposalsPanel.tsx'))
  const sectionView = read(join(ROOT, 'src', 'components', 'SectionView.tsx'))
  const app = read(join(ROOT, 'src', 'App.tsx'))

  assert.match(shared, /<InlineOperationStatus/, 'pending and failure share the established status anatomy')
  assert.match(shared, /data-revisioned-mutation=/, 'the shell exposes one enumerable recovery role')
  assert.match(shared, /label: 'Retry'/, 'a retryable intent remains actionable')
  assert.match(shared, /label: 'Dismiss'/, 'the user can release a failed queue head')
  assert.match(session, /<RevisionedMutationNotice/, 'conversation metadata uses the shared funnel')
  assert.match(schedule, /<RevisionedMutationNotice/, 'routine definition edits use the shared funnel')
  assert.match(artifact, /<RevisionedMutationNotice/, 'artifact body edits use the shared funnel')
  assert.match(proposal, /<RevisionedMutationNotice/, 'proposal verdicts use the shared funnel')
  assert.match(agent, /<RevisionedMutationNotice/, 'Agent configuration edits use the shared funnel')
  assert.match(actions, /decideProposal/, 'the shared owner actions enter the acknowledgement queue')
  assert.doesNotMatch(genericPanel, /landSocialProposal|declineSocialProposal/, 'the generic host has no second command door')
  assert.doesNotMatch(sectionView, /landSocialProposal|declineSocialProposal/, 'the merged ledger has no second command door')
  assert.match(app, /<SessionMetadataMutationNotice\s*\/>/, 'conversation recovery is mounted once')
  assert.match(app, /<ScheduleMutationNotice\s*\/>/, 'routine recovery is mounted once')
  assert.match(app, /<ArtifactContentMutationNotice\s*\/>/, 'artifact recovery is mounted once')
  assert.match(app, /<ProposalVerdictMutationNotice\s*\/>/, 'proposal verdict recovery is mounted once')
  assert.match(app, /<AgentMutationNotice\s*\/>/, 'Agent recovery is mounted once')
})
