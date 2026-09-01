/** Structural lock for the rendered half of SYNC-12. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'

test('relation mutation recovery has one shared shell surface and honest initiators', () => {
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const primitive = stripComments(read(join(ROOT, 'src', 'components', 'InlineOperationStatus.tsx')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'RelationMutationNotice.tsx')))
  const card = stripComments(read(join(ROOT, 'src', 'components', 'RelationActionCard.tsx')))

  assert.equal((shell.match(/<RelationMutationNotice\s*\/>/g) ?? []).length, 1, 'one shell notice, not one per pane')
  assert.match(notice, /<InlineOperationStatus/)
  assert.match(notice, /label: 'Retry'/)
  assert.match(notice, /label: 'Dismiss'/)
  assert.match(notice, /z-\[60\]/, 'shell recovery remains operable above a retained modal')
  assert.match(primitive, /flex-wrap/, 'two recovery actions can wrap at the narrow tier')
  assert.ok(!notice.includes('<button'), 'recovery actions stay in the shared status primitive')
  assert.match(card, /<InlineOperationStatus/)
  assert.match(card, /recordRelationVerdict\(sessionId, messageId, key, verdict\)\.then\(committed/)
})
