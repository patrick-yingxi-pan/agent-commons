import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT } from '../../tests/helpers/source.ts'

test('conversation and routine recovery share one accessible shell-notice primitive', () => {
  const shared = read(join(ROOT, 'src', 'components', 'RevisionedMutationNotice.tsx'))
  const session = read(join(ROOT, 'src', 'components', 'SessionMetadataMutationNotice.tsx'))
  const schedule = read(join(ROOT, 'src', 'components', 'ScheduleMutationNotice.tsx'))
  const app = read(join(ROOT, 'src', 'App.tsx'))

  assert.match(shared, /<InlineOperationStatus/, 'pending and failure share the established status anatomy')
  assert.match(shared, /data-revisioned-mutation=/, 'the shell exposes one enumerable recovery role')
  assert.match(shared, /label: 'Retry'/, 'a retryable intent remains actionable')
  assert.match(shared, /label: 'Dismiss'/, 'the user can release a failed queue head')
  assert.match(session, /<RevisionedMutationNotice/, 'conversation metadata uses the shared funnel')
  assert.match(schedule, /<RevisionedMutationNotice/, 'routine definition edits use the shared funnel')
  assert.match(app, /<SessionMetadataMutationNotice\s*\/>/, 'conversation recovery is mounted once')
  assert.match(app, /<ScheduleMutationNotice\s*\/>/, 'routine recovery is mounted once')
})
