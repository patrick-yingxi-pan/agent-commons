import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Commission, OpenSubGoal, Project } from '../contract/index.ts'
import { projectWorkDraftPrompt } from './projectWorkDraft.ts'
import { ValidationError } from './conflict.ts'

const project = { id: 'p-draft', name: 'Project', description: 'Visible description', instructions: 'Visible instructions', sessionIds: ['private-session'], contexts: [{ id: 'private-context' }] } as unknown as Project
const item = { id: 'work', subGoal: 'Draft a plan', type: 'charge', target: 'budget', note: 'Reference only', comments: [{ body: 'Excluded discussion' }] } as unknown as OpenSubGoal
const commission = { id: 'commission', role: 'reader', agentId: 'agent', projectId: 'p-draft', grant: { windows: [] } } as Commission

test('Project draft projection includes only the complete allowlisted viewer facts', () => {
  const { title, detail } = projectWorkDraftPrompt(project, item, commission)
  assert.equal(title, 'Draft: Draft a plan')
  const facts = JSON.parse(detail.slice(detail.indexOf('\n\n') + 2))
  assert.deepEqual(facts, {
    project: { name: 'Project', description: 'Visible description', instructions: 'Visible instructions' },
    work: { subGoal: 'Draft a plan', requestedAction: 'charge', target: 'budget', note: 'Reference only' },
    contributor: { role: 'reader' },
  })
  assert.doesNotMatch(detail, /private-session|private-context|Excluded discussion|windows/)
})

test('a Project draft refuses oversized complete source instead of silently shortening it', () => {
  assert.throws(() => projectWorkDraftPrompt({ ...project, instructions: 'x'.repeat(16_000) }, item, commission), ValidationError)
})
