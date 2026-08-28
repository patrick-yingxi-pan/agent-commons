/** Structural lock for the transport half of SYNC-12. Controller tests prove
 * logical retry behavior; this proves the retained key reaches HTTP and that
 * the API door cannot reintroduce a pre-ack graph projection. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, stripComments, ROOT } from '../../tests/helpers/source.ts'

test('relation mutation transport carries the logical idempotency key and waits for server truth', () => {
  const client = stripComments(read(join(ROOT, 'src', 'api', 'client.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const start = commands.indexOf('export function applyRelationOp')
  const end = commands.indexOf('export function acceptRelationOp')
  assert.ok(start >= 0 && end > start, 'relation command seam exists')
  const apply = commands.slice(start, end)

  assert.match(client, /'Idempotency-Key': options\.idempotencyKey/)
  assert.match(apply, /applyRelationOp\(op: RelationOp, idempotencyKey: string\)/)
  assert.match(apply, /apiPost<RelationGraph>\(paths\.relationOps, body, \{ idempotencyKey \}\)/)
  assert.doesNotMatch(apply, /applyGraphOp|setData|catch\s*\(/, 'the send door cannot paint or swallow failure')
})
