import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseProjectWorkDraftInput,
  parseProjectWorkDraftSource,
} from './projectWorkDraft.ts'

const source = () => ({
  projectId: 'project-1',
  itemId: 'item-1',
  commissionId: 'commission-1',
  expectedRevision: 0,
})

const input = () => ({
  projectWork: source(),
  execution: { agentId: 'agent-1', providerId: 'provider-1', modelId: 'model-1' },
})

test('Project-work source accepts bounded identities and detaches the exact record', () => {
  const value = source()
  const parsed = parseProjectWorkDraftSource(value)
  assert.deepEqual(parsed, value)
  assert.ok(parsed)
  assert.notEqual(parsed, value)

  value.projectId = 'changed'
  assert.equal(parsed.projectId, 'project-1')
  parsed.itemId = 'changed-output'
  assert.equal(value.itemId, 'item-1')

  assert.ok(parseProjectWorkDraftSource({
    projectId: 'p'.repeat(200),
    itemId: 'i'.repeat(200),
    commissionId: 'c'.repeat(200),
    expectedRevision: Number.MAX_SAFE_INTEGER,
  }))
})

test('Project-work input accepts only the exact draft source plus an explicit detached Dispatch binding', () => {
  const value = input()
  const parsed = parseProjectWorkDraftInput(value)
  assert.deepEqual(parsed, value)
  assert.ok(parsed)
  assert.notEqual(parsed, value)
  assert.notEqual(parsed.projectWork, value.projectWork)
  assert.notEqual(parsed.execution, value.execution)

  value.projectWork.projectId = 'changed'
  value.execution.agentId = 'changed'
  assert.equal(parsed.projectWork.projectId, 'project-1')
  assert.equal(parsed.execution.agentId, 'agent-1')
  parsed.projectWork.itemId = 'changed-output'
  parsed.execution.providerId = 'changed-output'
  assert.equal(value.projectWork.itemId, 'item-1')
  assert.equal(value.execution.providerId, 'provider-1')
})

test('Project-work parsers reject missing, unknown, inherited, symbol, and accessor fields', () => {
  const valid = source()
  const missingSource = { ...valid }
  delete (missingSource as Partial<typeof valid>).commissionId
  const unknownSource = { ...valid, ownerId: 'forbidden' }
  const symbolSource = { ...valid, [Symbol('hidden')]: true }
  const inheritedSource = Object.create({ commissionId: 'inherited' }) as Record<string, unknown>
  Object.assign(inheritedSource, valid)
  const accessorSource = { ...valid }
  Object.defineProperty(accessorSource, 'itemId', { get: () => 'item-1', enumerable: true })

  for (const malformed of [
    null, undefined, [], 'draft', missingSource, unknownSource, symbolSource,
    inheritedSource, accessorSource,
  ]) assert.equal(parseProjectWorkDraftSource(malformed), undefined)

  const base = input()
  const missingExecution = { ...base } as Record<string, unknown>
  delete missingExecution.execution
  const titleInput = { ...base, title: 'not admitted' }
  const detailInput = { ...base, detail: 'not admitted' }
  const symbolInput = { ...base, [Symbol('hidden')]: true }
  const inheritedInput = Object.create({ projectWork: base.projectWork }) as Record<string, unknown>
  inheritedInput.execution = base.execution
  const accessorInput = { ...base }
  Object.defineProperty(accessorInput, 'execution', { get: () => base.execution, enumerable: true })
  const malformedInputs = [
    null, undefined, [], missingExecution, titleInput, detailInput, symbolInput,
    inheritedInput, accessorInput,
  ]
  for (const malformed of malformedInputs) assert.equal(parseProjectWorkDraftInput(malformed), undefined)
})

test('Project-work parsers reject invalid IDs, revisions, and malformed execution bindings', () => {
  const valid = source()
  const invalidSources: unknown[] = [
    { ...valid, projectId: '' },
    { ...valid, projectId: '  ' },
    { ...valid, projectId: 'p'.repeat(201) },
    { ...valid, itemId: null },
    { ...valid, commissionId: 1 },
    { ...valid, expectedRevision: -1 },
    { ...valid, expectedRevision: 1.5 },
    { ...valid, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, expectedRevision: NaN },
    { ...valid, expectedRevision: Infinity },
  ]
  for (const malformed of invalidSources) assert.equal(parseProjectWorkDraftSource(malformed), undefined)

  const base = input()
  const invalidInputs: unknown[] = [
    { ...base, projectWork: { ...valid, expectedRevision: -1 } },
    { ...base, execution: { ...base.execution, agentId: ' ' } },
    { ...base, execution: { ...base.execution, providerId: 'p'.repeat(201) } },
    { ...base, execution: { ...base.execution, modelId: null } },
    { ...base, execution: { ...base.execution, extra: true } },
  ]
  for (const malformed of invalidInputs) assert.equal(parseProjectWorkDraftInput(malformed), undefined)
})

test('Project-work parsers accept null-prototype records but reject custom prototypes', () => {
  const nullPrototype = Object.assign(Object.create(null), source())
  assert.deepEqual(parseProjectWorkDraftSource(nullPrototype), source())
  const customPrototype = Object.assign(Object.create({}), source())
  Object.setPrototypeOf(customPrototype, { marker: true })
  assert.equal(parseProjectWorkDraftSource(customPrototype), undefined)
})
