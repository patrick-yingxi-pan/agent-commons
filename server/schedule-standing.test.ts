import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyGraph } from '../contract/graph.ts'
import { parseScheduleStanding, pruneOrphanScheduleStanding, scheduleApprovalKeyMatches, scheduleStandingFailure } from './scheduleStanding.ts'

const tool = { id: 'slack', label: 'Slack', tone: 'connector' as const }

test('standing snapshots are strict detached intent, with explicit absence', () => {
  const input = { artifactName: 'Report.md', tools: [tool] }
  const parsed = parseScheduleStanding(input)!
  assert.deepEqual(parsed, { artifact: { name: 'Report.md', kind: 'doc' }, tools: [tool] })
  assert.notEqual(parsed, input)
  assert.notEqual(parsed.tools, input.tools)
  assert.notEqual(parsed.tools[0], tool)
  assert.deepEqual(parseScheduleStanding({ artifactName: null, tools: [] }), { artifact: null, tools: [] })
  for (const kind of ['doc', 'sheet', 'slide'] as const) {
    const current = { artifact: { name: `Report.${kind}`, kind }, tools: [tool] }
    assert.deepEqual(parseScheduleStanding(current), current)
    assert.notEqual(parseScheduleStanding(current)?.artifact, current.artifact)
  }
  for (const invalid of [
    null, [], {}, { tools: [] }, { artifactName: null },
    { artifactName: '', tools: [] }, { artifactName: ' Report.md ', tools: [] }, { artifactName: 'bad\nname', tools: [] },
    { artifactName: 'x'.repeat(241), tools: [] },
    { artifact: 'Report.xlsx', tools: [] },
    { artifact: { name: 'Report', kind: 'spreadsheet' }, tools: [] },
    { artifact: { name: 'Report', kind: 'sheet', extra: true }, tools: [] },
    { artifactName: { name: 'Report', kind: 'sheet' }, tools: [] },
    { artifact: null, artifactName: null, tools: [] },
    { artifactName: null, tools: [], extra: true },
    Object.create(input),
    ...[{}, { ...tool, tone: {} }, { ...tool, tone: null }, { ...tool, tone: 'invented' },
      { ...tool, id: '' }, { ...tool, needsAuth: 'yes' }, { ...tool, hidden: true }]
      .map((invalidTool) => ({ artifactName: null, tools: [invalidTool] })),
  ]) assert.equal(parseScheduleStanding(invalid), undefined)
})

test('live removal fences frozen intent while additional grants never widen it', () => {
  const graph = emptyGraph()
  const snapshot = { artifact: { name: 'Report.md', kind: 'doc' as const }, tools: [tool] }
  graph.scheduleArtifact.routine = 'Report.md'
  graph.scheduleExtraTools.routine = [{ ...tool }, { id: 'new', label: 'New', tone: 'mcp' }]
  assert.equal(scheduleStandingFailure('routine', snapshot, graph), undefined)
  assert.equal(scheduleStandingFailure('routine', { artifact: null, tools: [] }, graph), undefined)
  assert.match(scheduleStandingFailure('routine', undefined, graph)!, /no saved standing-approval snapshot/)
  delete graph.scheduleArtifact.routine
  assert.match(scheduleStandingFailure('routine', snapshot, graph)!, /standing approvals changed/)
  graph.scheduleArtifact.routine = 'Report.md'
  graph.scheduleExtraTools.routine = []
  assert.match(scheduleStandingFailure('routine', snapshot, graph)!, /standing approvals changed/)
  graph.scheduleArtifact.routine = { name: 'Report.md', kind: 'sheet' }
  assert.match(scheduleStandingFailure('routine', snapshot, graph)!, /standing approvals changed/)
  assert.equal(scheduleStandingFailure('unconfigured', undefined, graph), undefined)
})

test('legacy orphan cleanup preserves live authority and becomes an identity-stable no-op', () => {
  const graph = emptyGraph()
  graph.scheduleArtifact = { live: 'Live.md', gone: 'Old.md' }
  graph.scheduleSession.gone = 'Old conversation'
  graph.scheduleProject.gone = null
  graph.scheduleExtraTools.gone = [tool]
  graph.standingApprovals = { 'set-schedule-artifact:live:Live.md': true, 'schedule-add-tool:gone:slack': true }
  graph.extraArtifacts = [
    { id: 'old', name: 'Old.md', kind: 'doc', meta: 'saved', projectId: '', editedAt: 12,
      source: 'Original run', sourceSessionId: 'original-session', sourceScheduleId: 'gone', tenantId: 'owner' },
    { id: 'current', name: 'Live.md', kind: 'doc', meta: 'saved', projectId: '', editedAt: 12,
      source: 'Current run', sourceScheduleId: 'live', tenantId: 'owner' },
  ]
  const result = pruneOrphanScheduleStanding(graph, [{ id: 'live', tenantId: 'owner' }], 'default')
  assert.equal(result.changed, true)
  assert.equal(result.graph.revision, (graph.revision ?? 0) + 1)
  assert.deepEqual(result.graph.scheduleArtifact, { live: 'Live.md' })
  assert.deepEqual(result.graph.scheduleSession, {})
  assert.deepEqual(result.graph.scheduleProject, {})
  assert.deepEqual(result.graph.scheduleExtraTools, {})
  assert.deepEqual(result.graph.standingApprovals, { 'set-schedule-artifact:live:Live.md': true })
  assert.equal(result.graph.extraArtifacts[0]?.sourceScheduleId, undefined)
  assert.equal(result.graph.extraArtifacts[0]?.sourceSessionId, 'original-session')
  assert.equal(result.graph.extraArtifacts[1], graph.extraArtifacts[1])
  const second = pruneOrphanScheduleStanding(result.graph, [{ id: 'live', tenantId: 'owner' }], 'default')
  assert.equal(second.changed, false)
  assert.equal(second.graph, result.graph)
})

test('structured standing approval keys match exact routine ids and orphan cleanup removes them', () => {
  const liveKey = `set-schedule-output:${JSON.stringify(['live:a', 'Report:sheet', 'sheet'])}`
  const goneKey = `set-schedule-output:${JSON.stringify(['gone', 'Report', 'slide'])}`
  assert.equal(scheduleApprovalKeyMatches(liveKey, 'live:a'), true)
  assert.equal(scheduleApprovalKeyMatches(liveKey, 'live'), false)
  assert.equal(scheduleApprovalKeyMatches('set-schedule-output:["live:a","Report","invented"]', 'live:a'), false)
  assert.equal(scheduleApprovalKeyMatches('set-schedule-output:[ "live:a", "Report", "doc" ]', 'live:a'), false)
  const graph = emptyGraph()
  graph.standingApprovals = { [liveKey]: true, [goneKey]: true }
  const result = pruneOrphanScheduleStanding(graph, [{ id: 'live:a', tenantId: 'owner' }], 'owner')
  assert.deepEqual(result.graph.standingApprovals, { [liveKey]: true })
})
