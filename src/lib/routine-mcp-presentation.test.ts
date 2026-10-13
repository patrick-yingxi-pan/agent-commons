import assert from 'node:assert/strict'
import { test } from 'node:test'
import { routineMcpApprovalIntent, routineMcpTransportLabel, routineMcpRunLabel } from './routineMcpPresentation.ts'

test('Routine approval projection preserves explicit local intent but keeps HTTP requests unchanged', () => {
  const base = { expectedRevision: 2, expectedDefinitionRevision: 5, reviewHash: 'opaque', expiresAt: 9, maxCallsPerRun: 3,
    tools: [], disclosures: ['destination'], labels: { one: 'label' } }
  assert.deepEqual(routineMcpApprovalIntent(base), {
    expectedRevision: 2, expectedDefinitionRevision: 5, reviewHash: 'opaque', expiresAt: 9, maxCallsPerRun: 3, tools: [],
  })
  assert.deepEqual(routineMcpApprovalIntent({ ...base, localPrograms: true }), {
    expectedRevision: 2, expectedDefinitionRevision: 5, reviewHash: 'opaque', expiresAt: 9, maxCallsPerRun: 3, tools: [], localPrograms: true,
  })
})

test('Routine catalog and receipts label transport only from explicit stdio provenance', () => {
  assert.equal(routineMcpTransportLabel(), 'External server')
  assert.equal(routineMcpTransportLabel('stdio'), 'Local program')
})

test('Routine private history distinguishes every durable execution outcome', () => {
  for (const [status, label] of Object.entries({ running: 'Run in progress', ok: 'Run completed', skipped: 'Run skipped', failed: 'Run failed', cancelled: 'Run stopped' })) {
    assert.equal(routineMcpRunLabel(status as Parameters<typeof routineMcpRunLabel>[0]), label, status)
  }
})
