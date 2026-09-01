import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Commission } from '../../contract/index.ts'
import { mergeCommissionConfiguration, newestCommissionConfiguration } from './commissionRevision.ts'

const commission = (overrides: Partial<Commission> = {}): Commission => ({
  id: 'commission-revision',
  agentId: 'agent-revision',
  projectId: 'project-revision',
  role: 'writer',
  reservationId: 'reservation-live',
  configurationRevision: 2,
  ...overrides,
})

test('a newer contributor configuration preserves independent identity and reservation projections', () => {
  const current = commission({ agentLabel: 'Live label' })
  const incoming = commission({
    role: 'reader',
    standing: true,
    reservationId: undefined,
    agentLabel: undefined,
    configurationRevision: 3,
  })
  const merged = mergeCommissionConfiguration(current, incoming)
  assert.equal(merged.role, 'reader')
  assert.equal(merged.standing, true)
  assert.equal(merged.configurationRevision, 3)
  assert.equal(merged.reservationId, 'reservation-live')
  assert.equal(merged.agentLabel, 'Live label')
})

test('an older contributor acknowledgement cannot rewind configuration', () => {
  const current = commission({ role: 'maintainer', configurationRevision: 5 })
  const delayed = commission({ role: 'reader', configurationRevision: 4 })
  assert.deepEqual(mergeCommissionConfiguration(current, delayed), current)
})

test('the freshest independently cached contributor roster supplies the next base', () => {
  const projectRow = commission({ role: 'reader', configurationRevision: 3 })
  const globalRow = commission({ role: 'maintainer', configurationRevision: 5 })
  assert.equal(newestCommissionConfiguration(projectRow, globalRow)?.role, 'maintainer')
  assert.equal(
    newestCommissionConfiguration(commission({ configurationRevision: undefined }), commission({ configurationRevision: 0 }))
      ?.configurationRevision,
    0,
    'revisioned truth outranks a legacy row',
  )
})
