import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT } from '../../tests/helpers/source.ts'

test('conversation metadata recovery uses the shared accessible operation-status primitive', () => {
  const notice = read(join(ROOT, 'src', 'components', 'SessionMetadataMutationNotice.tsx'))
  const app = read(join(ROOT, 'src', 'App.tsx'))
  assert.match(notice, /<InlineOperationStatus/, 'pending and failure share the established status anatomy')
  assert.match(notice, /data-session-metadata-mutation=/, 'the shell exposes one stable recovery handle')
  assert.match(notice, /retrySessionMetadataMutation/, 'the failed intent remains retryable in place')
  assert.match(notice, /discardSessionMetadataMutation/, 'the user can explicitly release a failed queue head')
  assert.match(app, /<SessionMetadataMutationNotice\s*\/>/, 'every pane shares one shell-level notice')
})
