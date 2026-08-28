/** The production target is dual-topology but deliberately sequenced. The
 * decision ledger, design index, and concrete ops topology must not drift into
 * three different roadmaps while implementation is self-paced. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT } from './helpers/source.ts'

const decisions = read(join(ROOT, 'docs', 'design', 'DECISIONS.md'))
const designIndex = read(join(ROOT, 'docs', 'design', 'README.md'))
const operations = read(join(ROOT, 'docs', 'design', 'F6-persistence-ops.md'))

test('production delivery is desktop-first without becoming desktop-only', () => {
  assert.match(decisions, /PD74 \| Deployment sequence/)
  assert.match(decisions, /native desktop deployment the first production release target/)
  assert.match(decisions, /hosted multi-tenant web service as the long-term target/)
  assert.match(decisions, /may not fork product semantics or remove the remote\/tenant isolation gates/)

  assert.match(designIndex, /Delivery order \(PD74\): desktop first, web service later/)
  assert.match(designIndex, /remote and multi-tenant[\s\S]{0,100}tests remain required/)

  assert.match(operations, /Delivery sequence \(PD74\): desktop first, web service later/)
  for (const nearTerm of ['SQLite migrations', 'OS-keychain', 'export/restore', 'runner/MCP', 'crash/update recovery']) {
    assert.ok(operations.includes(nearTerm), `desktop acceptance path lost ${nearTerm}`)
  }
  assert.match(operations, /hosted multi-tenant service follows by replacing topology adapters/)
  assert.match(operations, /Remote-backend tenancy and[\s\S]{0,100}access-parity suites therefore stay mandatory/)
})
