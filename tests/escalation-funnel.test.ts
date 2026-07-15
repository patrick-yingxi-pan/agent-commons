/** Locking tests: the ONE escalation-apply funnel (src/data/liveSession.ts —
 *  universal split Phase 3): the primary thread's controller and a split
 *  pane's approval both apply an approved escalation through
 *  applyEscalationToLive / escalationBinding, and both render the consent
 *  prompt from approvalView — one consent flow, two hosts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_LIVE,
  applyEscalationToLive,
  approvalView,
  escalationBinding,
} from '../src/data/liveSession.ts'
import type { EscalationProposal } from '../contract/index.ts'

const WS_ESC: EscalationProposal = {
  kind: 'workspace',
  artifacts: [{ id: 'a1', name: 'draft.md', kind: 'doc', meta: '1 page' }],
  rootChoices: ['~/launch'],
} as EscalationProposal

const REPO_ESC: EscalationProposal = {
  kind: 'repo',
  remote: 'me/app',
  branch: 'feat/x',
  connectorLabel: 'GitHub',
  files: [],
  diff: [],
  terminal: [],
  connectors: [{ id: 'gh-mcp', label: 'GitHub', kind: 'github' }],
} as unknown as EscalationProposal

test('a workspace escalation attaches the labelled workspace once (id-guarded against replays)', () => {
  const once = applyEscalationToLive(EMPTY_LIVE, WS_ESC, 'launch')
  assert.equal(once.workspaces.length, 1)
  assert.equal(once.workspaces[0]!.label, 'launch')
  const twice = applyEscalationToLive(once, WS_ESC, 'launch')
  assert.equal(twice.workspaces.length, 1, 'a replayed beat cannot duplicate the panel')
})

test('a repo escalation attaches the repo AND its connectors', () => {
  const next = applyEscalationToLive(EMPTY_LIVE, REPO_ESC, 'unused')
  assert.equal(next.repos[0]?.remote, 'me/app')
  assert.equal(next.repos[0]?.branch, 'feat/x')
  assert.ok(next.connectors.some((c) => c.id === 'gh-mcp'))
})

test('escalationBinding derives the binding-of-record; a project escalation has none', () => {
  assert.deepEqual(escalationBinding(WS_ESC, 'launch', '~/launch'), { id: 'ws-demo', type: 'folder', label: 'launch', scope: '~/launch' })
  assert.deepEqual(escalationBinding(REPO_ESC, 'x'), { id: 'repo-demo', type: 'repo', label: 'me/app', scope: '*' })
  const project = { kind: 'project', project: { id: 'p', name: 'P', description: '' }, fileSession: true } as EscalationProposal
  assert.equal(escalationBinding(project, 'x'), null)
})

test('approvalView shapes the consent prompt per kind (root choices default when empty)', () => {
  assert.deepEqual(approvalView(WS_ESC), { kind: 'workspace', rootChoices: ['~/launch'] })
  assert.deepEqual(approvalView({ ...WS_ESC, rootChoices: [] } as EscalationProposal & { rootChoices: string[] }), {
    kind: 'workspace',
    rootChoices: ['~/'],
  })
  assert.deepEqual(approvalView(REPO_ESC), { kind: 'repo', connectorLabel: 'GitHub' })
})
