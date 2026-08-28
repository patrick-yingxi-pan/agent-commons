/** The shared-module boundary: contract/graph.ts (the relationship-graph reducer)
 *  and contract/ids.ts (id-derivation) are imported VERBATIM by both ends. The
 *  server uses the reducer for authoritative application; pure callers use it to
 *  validate/project operations without creating persisted client truth. These
 *  locks keep reducer behavior and cross-boundary id derivation byte-identical. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyGraphOp,
  describeOp,
  emptyGraph,
  opAppliedInGraph,
  opKey,
  repoIdForLabel,
  slug,
  runSessionId,
  isRunSessionId,
  type RelationOp,
} from './index.ts'

const mintIds = () => {
  let n = 0
  return () => `art-test-${(n += 1)}`
}

test('applyGraphOp returns a NEW graph and never mutates the input', () => {
  const g0 = emptyGraph()
  const g1 = applyGraphOp(g0, { kind: 'file-session', sessionId: 's1', sessionTitle: 'S', projectId: 'p1', projectName: 'P' }, mintIds())
  assert.notEqual(g1, g0, 'a new graph object is returned')
  assert.deepEqual(g0.sessionProject, {}, 'the input graph is untouched')
  assert.equal(g1.sessionProject.s1, 'p1')
})

test('create-project is idempotent: a replayed op re-files the session, never duplicates the project', () => {
  const op = {
    kind: 'create-project',
    projectId: 'p-new',
    projectName: 'New',
    projectDescription: 'd',
    sessionId: 's1',
    sessionTitle: 'S',
  }
  let g = applyGraphOp(emptyGraph(), op, mintIds())
  assert.equal(g.extraProjects.length, 1)
  assert.equal(g.sessionProject.s1, 'p-new')
  // Replay (e.g. an idempotency boundary invokes the reducer again).
  g = applyGraphOp(g, op, mintIds())
  assert.equal(g.extraProjects.length, 1, 'the project is not duplicated on replay')
})

test('a sessionless create-project (the "New project" button) mints an empty project and files no session', () => {
  const op = {
    kind: 'create-project',
    projectId: 'p-empty',
    projectName: 'Empty',
    projectDescription: 'd',
  }
  let g = applyGraphOp(emptyGraph(), op, mintIds())
  assert.equal(g.extraProjects.length, 1)
  const project = g.extraProjects[0]
  assert.equal(project.id, 'p-empty')
  assert.deepEqual(project.sessionIds, [], 'no session is filed into a user-created project')
  assert.deepEqual(g.sessionProject, {}, 'the session→project map is untouched')
  // Idempotent on replay, exactly like the session-carrying variant.
  g = applyGraphOp(g, op, mintIds())
  assert.equal(g.extraProjects.length, 1, 'the project is not duplicated on replay')
})

test('create-project with a SEED project id is a no-op — never mints a duplicate id (guards the shared reducer)', () => {
  // seedGraph records every seed project as a projectContexts key; the create-project
  // guard treats that as "exists", so a colliding id re-files rather than minting a
  // second project that would surface twice through allProjects().
  const seeded = { ...emptyGraph(), projectContexts: { 'p-seed': [] } }
  const g = applyGraphOp(
    seeded,
    { kind: 'create-project', projectId: 'p-seed', projectName: 'Dupe', projectDescription: 'd' },
    mintIds(),
  )
  assert.equal(g.extraProjects.length, 0, 'no duplicate project is minted for a seed-project id')
})

test('create-project uses op.projectId verbatim — the artifact minter never influences it', () => {
  // Unlike save-artifact (server-minted id), create-project carries a proposed id
  // that the authoritative apply uses as-is. Replaying the same accepted operation
  // therefore addresses the same project regardless of the injected artifact minter.
  const op = { kind: 'create-project', projectId: 'p-fixed', projectName: 'X', projectDescription: 'd' }
  const firstProjection = applyGraphOp(emptyGraph(), op, () => 'art-unused-1')
  const secondProjection = applyGraphOp(emptyGraph(), op, () => 'art-unused-2')
  assert.equal(firstProjection.extraProjects[0].id, 'p-fixed')
  assert.equal(secondProjection.extraProjects[0].id, 'p-fixed', 'the injected minter does not influence a create-project id')
  assert.equal(firstProjection.extraProjects[0].id, secondProjection.extraProjects[0].id)
})

test('create-project stamps updatedAt from the injected clock (a fresh project shows a live "Updated …", not a frozen string)', () => {
  const NOW = 1_700_000_000_000
  const g = applyGraphOp(
    emptyGraph(),
    { kind: 'create-project', projectId: 'p-fixed', projectName: 'X', projectDescription: 'd' },
    mintIds(),
    NOW,
  )
  assert.equal(g.extraProjects[0].updatedAt, NOW, 'the new project carries the caller’s timestamp')
})

test('describeOp(create-project): sessionless variant drops the file phrasing but keeps projectId for the deep-link', () => {
  const d = describeOp({ kind: 'create-project', projectId: 'p1', projectName: 'Empty', projectDescription: 'd' })
  assert.equal(d.text, 'Create the **Empty** project')
  assert.equal(d.projectId, 'p1', 'projectId still drives the "View in projects" deep-link')
})

test('describeOp(create-project): session-carrying variant keeps the file phrasing', () => {
  const d = describeOp({
    kind: 'create-project',
    projectId: 'p1',
    projectName: 'Empty',
    projectDescription: 'd',
    sessionId: 's1',
    sessionTitle: 'S',
  })
  assert.equal(d.text, 'Create the **Empty** project and file **S** into it')
})

test('save-artifact mints a fresh id, prepends the artifact, and files it under the project', () => {
  const mint = mintIds()
  const g = applyGraphOp(
    emptyGraph(),
    { kind: 'save-artifact', artifact: { name: 'Brief', kind: 'doc', meta: 'm' }, sessionId: 's1', sessionTitle: 'S', projectId: 'p1' },
    mint,
  )
  assert.equal(g.extraArtifacts.length, 1)
  const art = g.extraArtifacts[0]
  assert.equal(art.name, 'Brief')
  assert.equal(art.id, 'art-test-1', 'the injected authoritative minter assigns the id')
  assert.equal(g.artifactProject[art.id], 'p1', 'filed under the project when one is given')
})

test('save-artifact is REPLAY-SAFE: re-applying the same save (a concurrent double-confirm) mints no duplicate', () => {
  const op: RelationOp = { kind: 'save-artifact', artifact: { name: 'Brief', kind: 'doc', meta: 'm' }, sessionId: 's1', sessionTitle: 'S', projectId: 'p1' }
  const g1 = applyGraphOp(emptyGraph(), op, mintIds())
  const g2 = applyGraphOp(g1, op, mintIds())
  assert.equal(g2.extraArtifacts.length, 1, 'the second apply of the same (name + source) is a no-op')
  assert.equal(g2, g1, 'and returns the same graph reference (no needless churn)')
})

test('opAppliedInGraph: unscope-context reads APPLIED on a runtime-created project that never scoped anything (the vacuous case)', () => {
  // A create-project seeds no projectContexts key; an unscope on it is vacuously
  // satisfied (the label is absent). The old `in` guard held it pending forever,
  // re-offering a confirmed card on reopen.
  const g = applyGraphOp(emptyGraph(), { kind: 'create-project', projectId: 'p-new', projectName: 'New' }, mintIds())
  assert.equal(opAppliedInGraph(g, { kind: 'unscope-context', projectId: 'p-new', contextLabel: 'Figma' }), true)
  // Still reads NOT-applied while the label is present…
  const scoped = applyGraphOp(g, { kind: 'scope-context', projectId: 'p-new', context: { label: 'Figma', kind: 'connector', meta: '' } }, mintIds())
  assert.equal(opAppliedInGraph(scoped, { kind: 'unscope-context', projectId: 'p-new', contextLabel: 'Figma' }), false)
})

test('a sessionless save-artifact (the "New artifact" button) mints with a neutral source and files under a project', () => {
  const g = applyGraphOp(
    emptyGraph(),
    { kind: 'save-artifact', artifact: { name: 'Brief', kind: 'doc', meta: 'Document' }, projectId: 'p1', projectName: 'P' },
    mintIds(),
  )
  assert.equal(g.extraArtifacts.length, 1)
  const art = g.extraArtifacts[0]
  assert.equal(art.source, 'Created here', 'no session → a neutral source label (not a conversation title)')
  assert.equal(art.projectId, 'p1')
  assert.equal(g.artifactProject[art.id], 'p1', 'filed under the project')
})

test('a sessionless save-artifact with no project lands Unfiled (no artifactProject entry)', () => {
  const g = applyGraphOp(
    emptyGraph(),
    { kind: 'save-artifact', artifact: { name: 'Loose', kind: 'sheet', meta: 'Sheet' } },
    mintIds(),
  )
  const art = g.extraArtifacts[0]
  assert.equal(art.projectId, '', 'an unfiled artifact carries an empty projectId')
  assert.deepEqual(g.artifactProject, {}, 'no project key is written when no project is chosen')
})

test('save-artifact stamps editedAt from the injected clock (the seam that makes "Edited …" real, not a frozen string)', () => {
  const NOW = 1_700_000_000_000
  const g = applyGraphOp(
    emptyGraph(),
    { kind: 'save-artifact', artifact: { name: 'Brief', kind: 'doc', meta: 'm' }, sessionId: 's1', sessionTitle: 'S', projectId: 'p1' },
    mintIds(),
    NOW,
  )
  // The reducer reads the time from its caller (server clock canonically, an
  // optimistic one on the client) rather than calling Date.now() itself, so it
  // stays pure and deterministic — this pins that the stamp is the injected value.
  assert.equal(g.extraArtifacts[0].editedAt, NOW, 'the new artifact carries the caller’s timestamp')
})

test('refile-artifact assigns, reassigns, then unfiles an artifact (null → the Unfiled bucket)', () => {
  let g = emptyGraph()
  g = applyGraphOp(g, { kind: 'refile-artifact', artifactId: 'a1', artifactName: 'A', projectId: 'p1', projectName: 'P1' }, mintIds())
  assert.equal(g.artifactProject['a1'], 'p1', 'assigned to p1')
  g = applyGraphOp(g, { kind: 'refile-artifact', artifactId: 'a1', artifactName: 'A', projectId: 'p2', projectName: 'P2' }, mintIds())
  assert.equal(g.artifactProject['a1'], 'p2', 'reassigned to p2')
  g = applyGraphOp(g, { kind: 'refile-artifact', artifactId: 'a1', artifactName: 'A', projectId: null, projectName: '' }, mintIds())
  assert.equal(g.artifactProject['a1'], '', 'unfiled → an empty id, which the gallery groups under Unfiled')
})

test('describeOp(refile-artifact): assign keeps the project deep-link; unfile reads as a removal', () => {
  const assign = describeOp({ kind: 'refile-artifact', artifactId: 'a1', artifactName: 'Brief', projectId: 'p1', projectName: 'Insights' })
  assert.equal(assign.text, 'Move **Brief** into **Insights**')
  assert.equal(assign.projectId, 'p1', 'the assigned project drives the "View in projects" deep-link')
  const unfile = describeOp({ kind: 'refile-artifact', artifactId: 'a1', artifactName: 'Brief', projectId: null, projectName: '' })
  assert.equal(unfile.text, 'Remove **Brief** from its project')
  assert.equal(unfile.projectId, undefined, 'no project to deep-link to when unfiled')
})

test('scope-context adds a context to a project once (dedup by label), unscope-context removes it', () => {
  const ctx = { kind: 'connector' as const, label: 'Linear', meta: 'INS team' }
  let g = applyGraphOp(emptyGraph(), { kind: 'scope-context', projectId: 'p1', projectName: 'P', context: ctx }, mintIds())
  assert.deepEqual(g.projectContexts['p1'], [ctx], 'scoped to the project')
  // Re-scoping the same label is a no-op (no duplicate row).
  g = applyGraphOp(g, { kind: 'scope-context', projectId: 'p1', projectName: 'P', context: { ...ctx, meta: 'changed' } }, mintIds())
  assert.equal(g.projectContexts['p1'].length, 1, 'a context with an existing label is not added twice')
  // Unscope removes it by label.
  g = applyGraphOp(g, { kind: 'unscope-context', projectId: 'p1', projectName: 'P', contextLabel: 'Linear' }, mintIds())
  assert.deepEqual(g.projectContexts['p1'], [], 'unscope-context removes the context')
})

test('unscope-context on an absent context is a no-op (returns the same graph)', () => {
  const g0 = { ...emptyGraph(), projectContexts: { p1: [{ kind: 'repo' as const, label: 'acme/web', meta: 'main' }] } }
  const g1 = applyGraphOp(g0, { kind: 'unscope-context', projectId: 'p1', projectName: 'P', contextLabel: 'not-there' }, mintIds())
  assert.equal(g1, g0, 'no matching label → the graph is returned unchanged')
})

test('set-project-instructions overlays the project instructions; an empty string clears them', () => {
  let g = applyGraphOp(
    emptyGraph(),
    { kind: 'set-project-instructions', projectId: 'p1', projectName: 'P', instructions: 'Lead with the metric.' },
    mintIds(),
  )
  assert.equal(g.projectInstructions['p1'], 'Lead with the metric.', 'instructions overlaid for the project')
  g = applyGraphOp(g, { kind: 'set-project-instructions', projectId: 'p1', projectName: 'P', instructions: '' }, mintIds())
  assert.equal(g.projectInstructions['p1'], '', 'an empty string is a real value — it clears the instructions')
})

test('describeOp(unscope-context / set-project-instructions): project-scoped, per-action, with the project deep-link', () => {
  const un = describeOp({ kind: 'unscope-context', projectId: 'p1', projectName: 'Insights', contextLabel: 'Linear' })
  assert.equal(un.text, 'Remove **Linear** from **Insights**')
  assert.equal(un.section, 'projects')
  assert.equal(un.projectId, 'p1')
  assert.equal(un.approval, 'per-action')
  const si = describeOp({ kind: 'set-project-instructions', projectId: 'p1', projectName: 'Insights', instructions: 'x' })
  assert.equal(si.text, 'Update the **Insights** project instructions')
  assert.equal(si.projectId, 'p1', 'projectId drives the "View in projects" deep-link')
})

test('describeOp(commission-agent): names the project role (D14) only when set', () => {
  const withRole = describeOp({
    kind: 'commission-agent', agentId: 'a1', agentLabel: 'Scout', projectId: 'p1', projectName: 'Insights', role: 'reader',
  })
  assert.match(withRole.text, /as \*\*reader\*\*/)
  assert.match(withRole.done, /as reader/)
  const noRole = describeOp({
    kind: 'commission-agent', agentId: 'a1', agentLabel: 'Scout', projectId: 'p1', projectName: 'Insights',
  })
  assert.doesNotMatch(noRole.text, / as /)
})

test('opKey is stable + distinct for the project-context ops (per-project, per-label)', () => {
  assert.equal(
    opKey({ kind: 'set-project-instructions', projectId: 'p1', projectName: 'P', instructions: 'a' }),
    'set-project-instructions:p1',
    'instructions key is per-project (a re-edit overwrites, never stacks)',
  )
  assert.equal(
    opKey({ kind: 'unscope-context', projectId: 'p1', projectName: 'P', contextLabel: 'Linear' }),
    'unscope-context:p1:Linear',
  )
})

test('the pure reducer preserves the server-owned graph revision', () => {
  const current = { ...emptyGraph(), revision: 7 }
  const next = applyGraphOp(
    current,
    { kind: 'file-session', sessionId: 's-rev', sessionTitle: 'S', projectId: null, projectName: '' },
    mintIds(),
  )
  assert.equal(next.revision, 7, 'only the canonical store advances revisions')
})

test("attach-context is a no-op on the graph (it's a live-session effect, applied by the caller)", () => {
  const g0 = emptyGraph()
  const g1 = applyGraphOp(
    g0,
    { kind: 'attach-context', sessionTitle: 'S', connectorId: 'gh', connectorLabel: 'GitHub' },
    mintIds(),
  )
  assert.deepEqual(g1, g0, 'the relationship graph is unchanged by an attach')
})

test("standing schedule ops record a standing approval keyed by opKey (the daemon's later authority)", () => {
  const op = { kind: 'set-schedule-artifact', scheduleId: 's-1', scheduleName: 'Digest', cadence: 'Daily', artifactName: 'Digest' }
  const g = applyGraphOp(emptyGraph(), op, mintIds())
  assert.equal(g.scheduleArtifact['s-1'], 'Digest')
  assert.equal(g.standingApprovals[opKey(op)], true, 'the op is marked as a standing approval')
})

test('schedule-add-tool appends a tool to the routine toolbox once (dedup by id) and marks it standing', () => {
  const tool = { id: 'github', label: 'GitHub', tone: 'connector' as const }
  const op = { kind: 'schedule-add-tool' as const, scheduleId: 's-1', scheduleName: 'Triage', cadence: 'Every 2 hours', tool }
  let g = applyGraphOp(emptyGraph(), op, mintIds())
  assert.deepEqual(g.scheduleExtraTools['s-1'], [tool], 'the tool joins the routine’s standing toolbox')
  assert.equal(g.standingApprovals[opKey(op)], true, 'using a tool each run is a standing approval')
  // Re-adding the same tool id is a no-op (the Context-&-tools picker also filters it out).
  g = applyGraphOp(g, { ...op, tool: { ...tool, label: 'GitHub (again)' } }, mintIds())
  assert.equal(g.scheduleExtraTools['s-1'].length, 1, 'a tool already in the toolbox is not duplicated')
})

test('describeOp(schedule-add-tool) reads as a standing, context-schedule edit', () => {
  const d = describeOp({
    kind: 'schedule-add-tool',
    scheduleId: 's-1',
    scheduleName: 'Triage',
    cadence: 'Every 2 hours',
    tool: { id: 'slack', label: 'Slack', tone: 'connector' },
  })
  assert.match(d.text, /Slack/)
  assert.equal(d.approval, 'standing')
  assert.equal(d.relationId, 'context-schedule')
})

// ── Agent Commons CRUD ops (D6/D9/D10/D7) — proposed by Claude, confirmed in the
//    same card, executed server-side. The pure reducer must leave them as graph
//    no-ops; describeOp/opKey give the card its sentence + identity. ──

test('Agent Commons CRUD ops are graph no-ops (executed server-side via the registry mutators, not the reducer)', () => {
  const g0 = { ...emptyGraph(), sessionProject: { s1: 'p1' } }
  const ops: Parameters<typeof applyGraphOp>[1][] = [
    { kind: 'create-provider', label: 'Acme LLM', modelFamily: 'claude' },
    { kind: 'create-prompt', label: 'Researcher', body: 'b', targetFamily: 'claude' },
    { kind: 'create-agent', label: 'Scout', providerId: 'provider-1', providerLabel: 'Acme LLM' },
    { kind: 'commission-agent', agentId: 'agent-1', agentLabel: 'Scout', projectId: 'p1', projectName: 'Insights' },
    { kind: 'uncommission-agent', commissionId: 'commission-1', agentLabel: 'Scout', projectId: 'p1', projectName: 'Insights' },
  ]
  for (const op of ops) {
    assert.equal(applyGraphOp(g0, op, mintIds()), g0, `${op.kind} returns the input graph unchanged`)
  }
})

test('describeOp(Agent Commons CRUD): per-action, lands in the Agents hub, reads as a sentence', () => {
  const prov = describeOp({ kind: 'create-provider', label: 'Acme LLM', modelFamily: 'claude' })
  assert.equal(prov.text, 'Register the **Acme LLM** model provider (claude)')
  assert.equal(prov.section, 'agents')
  assert.equal(prov.approval, 'per-action')

  assert.equal(
    describeOp({ kind: 'create-prompt', label: 'Researcher', body: 'b', targetFamily: 'claude' }).text,
    'Add **Researcher** to the system-prompt library',
  )

  // create-agent: the provider / prompt phrasing appears only when a label is carried,
  // and the tool grant is ALWAYS stated (INV-9: absent = no tools — the card says so
  // rather than leaving the grant implicit).
  const bare = describeOp({ kind: 'create-agent', label: 'Scout' })
  assert.equal(bare.text, 'Create the **Scout** worker agent, granting no tools')
  const bound = describeOp({
    kind: 'create-agent',
    label: 'Scout',
    providerId: 'provider-1',
    providerLabel: 'Acme LLM',
    systemPromptId: 'sp-1',
    systemPromptLabel: 'Researcher',
    tools: ['read', 'write', 'search'],
  })
  assert.equal(
    bound.text,
    'Create the **Scout** worker agent on **Acme LLM** with the **Researcher** prompt, granting **3 tools**',
  )

  const comm = describeOp({ kind: 'commission-agent', agentId: 'agent-1', agentLabel: 'Scout', projectId: 'p1', projectName: 'Insights' })
  assert.equal(comm.text, 'Commission **Scout** to **Insights**')
  assert.equal(comm.section, 'agents')
  const un = describeOp({ kind: 'uncommission-agent', commissionId: 'commission-1', agentLabel: 'Scout', projectId: 'p1', projectName: 'Insights' })
  assert.equal(un.text, 'Remove **Scout** from **Insights**')
})

test('opKey(Agent Commons CRUD) is stable + distinct (by label, or by the ids a move touches)', () => {
  assert.equal(opKey({ kind: 'create-provider', label: 'Acme LLM', modelFamily: 'claude' }), 'create-provider:Acme LLM')
  assert.equal(opKey({ kind: 'create-prompt', label: 'Researcher', body: 'b', targetFamily: 'claude' }), 'create-prompt:Researcher')
  assert.equal(opKey({ kind: 'create-agent', label: 'Scout' }), 'create-agent:Scout')
  assert.equal(
    opKey({ kind: 'commission-agent', agentId: 'agent-1', agentLabel: 'Scout', projectId: 'p1', projectName: 'Insights' }),
    'commission-agent:agent-1:p1',
  )
  assert.equal(
    opKey({ kind: 'uncommission-agent', commissionId: 'commission-9', agentLabel: 'Scout', projectId: 'p1', projectName: 'Insights' }),
    'uncommission-agent:commission-9',
  )
})

test('id-derivation invariants are stable and agree across calls (both backends derive the same ids)', () => {
  assert.equal(slug('Insights Dashboard!'), 'insights-dashboard')
  assert.equal(slug('Insights Dashboard!'), slug('insights dashboard'), 'slug is case/punctuation-insensitive + deterministic')
  assert.equal(repoIdForLabel('acme/web-app'), `repo-${slug('acme/web-app')}`)
  assert.equal(repoIdForLabel('acme/web-app'), 'repo-acme-web-app')
  const id = runSessionId('task-1', 'run-9')
  assert.equal(id, 'srun-task-1-run-9')
  assert.ok(isRunSessionId(id))
  assert.ok(!isRunSessionId('sess-3'))
})

test('handoff-agent (D16): a graph no-op the store applies; describeOp + opKey', () => {
  const op: RelationOp = { kind: 'handoff-agent', sessionId: 's1', sessionTitle: 'Refactor auth', agentId: 'a7', agentLabel: 'Research Scout' }
  // The pure reducer leaves the graph untouched — a Session↔Agent re-bind runs server-side.
  assert.deepEqual(applyGraphOp(emptyGraph(), op, mintIds()), emptyGraph())
  const d = describeOp(op)
  assert.match(d.text, /Hand \*\*Refactor auth\*\* off to \*\*Research Scout\*\*/)
  assert.equal(d.section, 'agents')
  assert.equal(d.relationId, 'session-agent')
  assert.equal(opKey(op), 'handoff-agent:s1:a7')
})

test('set-commission-cap (D13): a graph no-op the store applies; describeOp + opKey', () => {
  const op: RelationOp = { kind: 'set-commission-cap', projectId: 'p-insights', projectName: 'Insights dashboard', cap: 3 }
  // The pure reducer leaves the graph untouched — the cap is a Project mutation run server-side.
  assert.deepEqual(applyGraphOp(emptyGraph(), op, mintIds()), emptyGraph())
  const d = describeOp(op)
  assert.match(d.text, /Set \*\*Insights dashboard\*\*'s commission cap to \*\*3\*\*/)
  assert.equal(d.section, 'agents')
  assert.equal(d.relationId, 'agent-commission-cap')
  assert.equal(opKey(op), 'set-commission-cap:p-insights:3')
})
