import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'

const source = stripComments(read(join(ROOT, 'src', 'components', 'ToolActivityCard.tsx')))

test('connector runtime failure has an explicit non-success face and recovery explanation', () => {
  assert.ok(source.includes("const failed = a.status === 'failed'"), 'failed is a first-class rendered state')
  assert.ok(source.includes('<AlertCircle size={14} />'), 'failure cannot reuse the neutral or completed icon')
  assert.ok(source.includes('a.failure?.retryable'), 'stable retry semantics choose the recovery explanation')
  assert.ok(source.includes('Connector setup needs attention before this can run.'), 'terminal setup work is explicit')
})

test('connector consent previews the exact persisted arguments', () => {
  assert.ok(source.includes('pending && !a.op && a.input'), 'connector proposals own a distinct argument preview')
  assert.ok(source.includes('JSON.stringify(a.input, null, 1)'), 'the preview reads the persisted input verbatim')
})
