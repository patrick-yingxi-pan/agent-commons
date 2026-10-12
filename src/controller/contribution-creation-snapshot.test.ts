import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { OpenContributionRequest } from '../../contract/index.ts'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'
import { editableContributionDraft, snapshotContributionCreation, submittedContributionDraft } from './contributionCreationSnapshot.ts'

const request = (): OpenContributionRequest => ({
  title: 'Reviewed work', summary: 'Chosen scope', workItemId: 'work-1',
  initialMcpProposal: { connectionId: 'mcp-external-reviewed', connectionRevision: 7, toolName: 'write_note',
    arguments: { note: { title: 'Reviewed', tags: ['chosen'], nested: { approved: false } } } },
})

test('Contribution creation freezes a detached exact selection and every nested argument', () => {
  const original = request()
  const frozen = snapshotContributionCreation(original)
  original.initialMcpProposal!.connectionRevision = 8
  const originalNote = original.initialMcpProposal!.arguments.note as { title: string; tags: string[] }
  originalNote.title = 'Changed after click'
  originalNote.tags.push('not reviewed')
  assert.deepEqual(frozen, request())
  assert.ok(Object.isFrozen(frozen))
  assert.ok(Object.isFrozen(frozen.initialMcpProposal))
  assert.ok(Object.isFrozen(frozen.initialMcpProposal!.arguments))
  const note = frozen.initialMcpProposal!.arguments.note as { title: string; tags: string[]; nested: { approved: boolean } }
  assert.ok(Object.isFrozen(note))
  assert.ok(Object.isFrozen(note.tags))
  assert.ok(Object.isFrozen(note.nested))
  assert.throws(() => { note.tags.push('tamper') }, TypeError)
  assert.throws(() => { note.nested.approved = true }, TypeError)
})

test('held and dismissed Contribution drafts retain exact MCP selection and raw editable JSON', () => {
  const input = request()
  const mcpDraft = { selection: { connectionId: 'mcp-external-reviewed', connectionRevision: 7, toolName: 'write_note' },
    argumentsText: '{\n  "note": {"title":"Reviewed"}\n}', connectionLabel: 'My local writer', transport: 'stdio' as const }
  const held = submittedContributionDraft(input, 'intent-1', { title: 'old', summary: '', mcpDraft })
  mcpDraft.argumentsText = '{unfinished'
  input.initialMcpProposal!.toolName = 'different_tool'
  assert.equal(held.intentId, 'intent-1')
  assert.equal(held.initialMcpProposal!.toolName, 'write_note')
  assert.equal(held.mcpDraft!.argumentsText, '{\n  "note": {"title":"Reviewed"}\n}')
  assert.equal(held.mcpDraft!.transport, 'stdio')
  const editable = editableContributionDraft(held)
  assert.equal(Object.hasOwn(editable, 'intentId'), false)
  assert.deepEqual(editable.initialMcpProposal, request().initialMcpProposal)
  assert.deepEqual(editable.mcpDraft, held.mcpDraft)
  assert.notEqual(editable.mcpDraft, held.mcpDraft)
  assert.ok(Object.isFrozen(editable.mcpDraft!.selection))
  const invalidEdit = snapshotContributionCreation({ title: 'still editing', summary: '', mcpDraft: { ...editable.mcpDraft!, argumentsText: '{unfinished' } })
  assert.equal(invalidEdit.mcpDraft.argumentsText, '{unfinished', 'invalid unsent text is retained, never parsed away')
})

test('ordinary Contribution creation does not inherit an MCP proposal from another form', () => {
  const previous = submittedContributionDraft(request(), 'old')
  assert.deepEqual(submittedContributionDraft({ title: 'Manual', workItemId: 'work-1' }, 'new', previous),
    { title: 'Manual', summary: '', intentId: 'new' })
  assert.deepEqual(snapshotContributionCreation({ title: 'Manual' }), { title: 'Manual' }, 'absence stays absent')
})

test('the production creation facade uses the same complete snapshots for submit, remount, and dismissal', () => {
  const source = stripComments(read(join(ROOT, 'src/controller/contributionCreationMutations.ts')))
  assert.ok(source.includes("from './contributionCreationSnapshot.ts'"))
  assert.ok(source.includes('request: snapshotContributionCreation(input.request)'))
  assert.ok(source.includes('existing.set(workItemId, snapshotContributionCreation(draft))'))
  assert.ok(source.includes('submittedContributionDraft(intent.request, intent.intentId, projectDrafts.get(workItemId))'))
  assert.ok(source.includes('projectDrafts!.set(workItemId, editableContributionDraft(draft))'))
  assert.ok(source.includes('onAccountSwitch(() => {') && source.includes('drafts.clear()'))
  assert.ok(source.includes('issuedGeneration === accountGeneration'), 'late completion cannot restore drafts to a new account')
  assert.ok(source.includes('appliedByItem.clear()'), 'published navigation receipts are account-scoped too')
  assert.ok(source.includes('if (isContributionCreationHeld(projectId) || draft?.intentId) return false'), 'local Cancel cannot dismiss a submitted publication')
  assert.ok(source.includes("Boolean(draft.mcpDraft || draft.initialMcpProposal) !== (kind === 'mcp')"), 'local Cancel cannot erase another kind of editor')
  assert.ok(source.includes('appliedItems.set(workItemId, Object.freeze(event))'), 'off-page completion retains only its exact acknowledged door')
  assert.ok(source.includes('createRetryableRuntimeLoader<Runtime>'))
  assert.ok(source.includes("() => 'discarded' as const,"), 'a failed module load cannot strand an unsent form behind a held intent ID')
})
