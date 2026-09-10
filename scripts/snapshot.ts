/** ── Portable backup / restore for either persistence backend ──────────────
 *  A play-and-roll-back tool for the durable store (JSON or SQLite). Four
 *  subcommands:
 *
 *    save  [name]   live store  → .data/snapshots/<name>.json   (default: backup)
 *    restore [name] snapshot    → live store     (stop server first; then restart)
 *    list           show every snapshot with size + date
 *    build [--activate]  manufacture a CLEAN, COMPREHENSIVE snapshot that exercises
 *                   every persisted slice once → .data/snapshots/comprehensive.json
 *
 *  Why `build` re-derives instead of copying the live store: the live store is the
 *  seed *plus* whatever the daemon + your clicking accreted (often thousands of
 *  runs, three features never touched). `build` boots the store on a FRESH path so
 *  it re-seeds from the source-controlled fixtures (server/data/*), then drives the
 *  REAL store mutators + relation reducer — so the snapshot can't drift from the
 *  contract, and `npm run snapshot:build` reproduces the identical playground in any
 *  clone. Snapshot files are canonical portable JSON, independent of the live
 *  backend, and stay gitignored under `.data/`; only this generator is checked in.
 *
 *  Persistence loads ONCE on boot (store.initPersistence), so a `restore` only
 *  takes effect after the server restarts — the commands say so. The store is
 *  imported lazily, only for `build`. */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dataFile, databaseFile, type PersistedState } from '../server/persistence/persist.ts'
import { backendKind } from '../server/persistence/index.ts'
import { writePortableSnapshot } from '../server/persistence/portable.ts'
import {
  listSnapshots,
  restoreSnapshot,
  saveSnapshot,
  snapshotPath,
  snapshotsDir,
  storageFilePath,
} from '../server/persistence/backup.ts'

export {
  listSnapshots,
  restoreSnapshot,
  saveSnapshot,
  snapshotPath,
  snapshotsDir,
  storageFilePath,
} from '../server/persistence/backup.ts'

/** Manufacture the comprehensive playground by driving the real store. Assumes
 *  the configured backend path already points at a FRESH (absent) store: the store
 *  re-seeds from the fixtures, then every mutator below persists to that file.
 *  Returns the resulting snapshot (for the test's coverage invariant). Run once
 *  per process — the store is a singleton, so a second call would layer on the
 *  first rather than re-seed. */
export async function buildComprehensive(): Promise<PersistedState> {
  const { store } = await import('../server/store/index.ts')
  const { opKey } = await import('../contract/index.ts')
  const { loadState } = await import('../server/persistence/persist.ts')
  const {
    deriveRelayCreationSecret,
    deriveRelayRotationSecret,
    hashRelaySecret,
    relaySecretHint,
  } = await import('../server/relay.ts')
  const { providerSecretRotationId } = await import('../server/providerSecretRotationIdentity.ts')
  const { mcpConnectionCreationId } = await import('../server/mcpConnections.ts')

  // Re-seed from the source-controlled fixtures (no configured store → seed,
  // then write the baseline). Every store mutation from here persists.
  store.initPersistence()

  const PROJECT_ID = 'p-playground'
  const PROJECT_NAME = 'Playground project'

  const seedArtifacts = store.listArtifacts()
  const seedSchedules = store.listSchedules()
  const seedContexts = store.savedContexts().contexts
  // Exercise durable metering through the same path as a completed model turn.
  store.recordUsage(1234, 4321, 'tenant-snapshot-usage')
  store.setModelPreferences(
    'tenant-snapshot-preferences',
    'user-snapshot-preferences',
    'tenant-snapshot-preferences',
    'user-snapshot-preferences',
    0,
    { providerId: 'provider-snapshot', modelId: 'model-snapshot', effort: 'High', ultracode: true, fast: false },
  )
  const a0 = seedArtifacts[0]
  const a1 = seedArtifacts[1]

  // Exercise the private MCP slice without contacting a server, provisioning a
  // secret or enabling execution. This catalog is an explicit snapshot fixture.
  const mcpOwner = 'tenant-zeta'
  const mcpId = mcpConnectionCreationId(mcpOwner, 'snapshot-active')
  const retiredMcpId = mcpConnectionCreationId(mcpOwner, 'snapshot-retired')
  for (const id of [mcpId, retiredMcpId]) store.createMcpConnection({
    id, label: 'Snapshot MCP fixture', endpoint: 'https://mcp.example/snapshot', authentication: 'none',
  }, mcpOwner)
  store.commitMcpInspection(mcpId, mcpOwner, 0, {
    protocolVersion: '2026-07-28', cleanup: 'not-needed',
    tools: [{ name: 'snapshot_fixture', inputSchema: { type: 'object' } }],
  }, 1)
  store.removeMcpConnection(retiredMcpId, mcpOwner, 0)

  // ── Projects ── a created project (extraProjects) the rest files into.
  store.applyRelationOp({
    kind: 'create-project',
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    projectDescription: 'A created project, here to exercise every relation and feature.',
  })

  // ── Sessions ── a created thread with a real exchange, an attached context
  // (bindings), a full workspace (every panel kind), and filed into the project.
  const session = store.createSession('Draft the launch one-pager for the insights dashboard')
  store.appendMessage(session.id, {
    id: store.mintMessageId('user'),
    role: 'user',
    content: 'Draft the launch one-pager for the insights dashboard — metric-led, one screen.',
  })
  store.appendMessage(session.id, {
    id: store.mintMessageId('assistant'),
    role: 'assistant',
    content: 'Here is a first pass — lead with weekly-active-teams, then the mechanism. Draft is in the workspace on the right.',
  })
  const toolActivityId = 'tool-activity-playground'
  store.appendMessage(session.id, {
    id: store.mintMessageId('assistant'),
    role: 'assistant',
    content: 'The reviewed connector write remains declined.',
    toolActivities: [{
      id: toolActivityId,
      tool: 'connector__playground__publish',
      connector: 'Playground connector',
      connectorId: 'connector-playground',
      kind: 'action',
      status: 'proposed',
      summary: 'Publish the playground draft.',
      input: { document: 'launch-one-pager.md' },
    }],
  })
  const toolDecision = store.resolveToolActivity(
    session.id,
    toolActivityId,
    'decline',
    undefined,
    {
      logicalId: 'tool-activity-decision-000000000000000000000000',
      tenantId: store.defaultTenantId(),
    },
  )
  if (typeof toolDecision !== 'object') throw new Error('Could not create the durable tool-consent fixture')
  const relationProposal = {
    kind: 'save-artifact' as const,
    artifact: { name: 'Held relation decision.md', kind: 'doc' as const, meta: 'Document' },
    sessionId: session.id,
    sessionTitle: session.title,
  }
  const relationProposalKey = opKey(relationProposal)
  const relationProposalMessageId = 'relation-proposal-playground'
  store.appendMessage(session.id, {
    id: relationProposalMessageId,
    role: 'assistant',
    content: 'The reviewed proposed change remains declined.',
    relationActions: [relationProposal],
  })
  const relationDecision = store.decideMessageRelation(
    session.id,
    relationProposalMessageId,
    relationProposalKey,
    'skipped',
    'relation-action-decision-000000000000000000000000',
    store.defaultTenantId(),
  )
  if (typeof relationDecision !== 'object') throw new Error('Could not create the durable relation-consent fixture')
  const compactedSession = store.createSession('Playground compaction receipt')
  for (let index = 0; index < 7; index += 1) {
    store.appendMessage(compactedSession.id, {
      id: store.mintMessageId(index % 2 === 0 ? 'user' : 'assistant'),
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Compaction receipt source ${index}`,
    })
  }
  const compactionPlan = store.prepareSessionCompaction(compactedSession.id)
  if (!compactionPlan || compactionPlan.kind !== 'ready') {
    throw new Error('Could not prepare the durable compaction receipt fixture')
  }
  const compactionReceipt = store.applySessionCompaction(
    compactionPlan,
    'The playground compaction receipt survives restart.',
    {},
    {
      logicalId: 'session-compaction-000000000000000000000000',
      tenantId: store.defaultTenantId(),
    },
  )
  if (typeof compactionReceipt !== 'object') throw new Error('Could not create the durable compaction receipt fixture')
  store.attachContext(session.id, {
    id: 'repo-playground',
    type: 'repo',
    label: 'insights-dashboard',
    scope: '~/projects/insights-dashboard',
  })
  const image = store.putImageAsset(store.defaultTenantId(), {
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    width: 1, height: 1, byteLength: 68,
  })
  store.setSessionWorkspace(session.id, {
    workspaces: [
      {
        id: `ws-${session.id}`,
        label: 'insights/',
        artifacts: [{ id: 'wsa-1', name: 'launch-one-pager.md', kind: 'doc', meta: 'Draft · 1 screen' }],
      },
    ],
    repos: [
      {
        id: 'repo-playground',
        label: 'patrick-yingxi-pan/web-app',
        origin: 'github',
        remote: 'patrick-yingxi-pan/web-app',
        branch: 'feat/insights-dashboard',
        files: [
          { path: 'src/insights/page.tsx', status: 'added' },
          { path: 'src/insights/flag.ts', status: 'modified' },
        ],
        diff: [
          { kind: 'hunk', text: 'src/insights/page.tsx' },
          { kind: 'add', text: '+ export const InsightsPage = () => <Dashboard flag="insights_dashboard" />' },
        ],
        terminal: ['$ npm test -- insights', 'PASS  src/insights/page.test.tsx (1.2s)', 'Tests: 8 passed, 8 total'],
      },
    ],
    connectors: [{ id: 'gh-mcp', label: 'GitHub', kind: 'github' }],
    attachments: [
      { id: 'att-1', label: 'gtm-brief.md', kind: 'file' },
      { id: 'att-image', label: 'sample.png', kind: 'photo', image },
    ],
  })
  store.setSessionPreferences('user-local', session.id, { kind: 'repo', id: 'repo-playground' })
  store.applyRelationOp({
    kind: 'file-session',
    sessionId: session.id,
    sessionTitle: session.title,
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
  })
  // A keyed draft that was explicitly removed exercises the durable retirement
  // slice: a delayed first-send Retry must not resurrect it after restore.
  const retiredDraft = store.createSession(
    'Retired playground draft',
    store.defaultTenantId(),
    undefined,
    undefined,
    { logicalId: 'sess-new-000000000000000000000000' },
  )
  store.removeSession(retiredDraft.id)
  const retiredFork = store.forkSession(
    session.id,
    store.getSession(session.id)!.messages![0]!.id,
    store.defaultTenantId(),
    { logicalId: 'sess-fork-000000000000000000000000' },
  )
  if (!retiredFork || retiredFork === 'forbidden') throw new Error('Could not create the retirement fixture branch')
  store.removeSession(retiredFork.id)

  // ── Artifacts ── created (filed + unfiled), and seed artifacts moved around.
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: {
      name: 'Launch one-pager',
      kind: 'doc',
      meta: 'Created here',
      body: 'Metric-led summary of the insights launch.\n\nThis authored body must survive the portable snapshot path.',
    },
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
  })
  store.applyRelationOp({
    kind: 'save-artifact',
    artifact: { name: 'Launch email', kind: 'email', meta: 'Created here', excerpt: 'Announce the dashboard to the team.' },
  })
  if (a0) {
    store.applyRelationOp({ kind: 'refile-artifact', artifactId: a0.id, artifactName: a0.name, projectId: PROJECT_ID, projectName: PROJECT_NAME })
    store.applyRelationOp({ kind: 'set-artifact-source', artifactId: a0.id, artifactName: a0.name, contextLabel: '~/code/insights-web' })
  }
  if (a1) {
    store.applyRelationOp({ kind: 'refile-artifact', artifactId: a1.id, artifactName: a1.name, projectId: null, projectName: '' })
  }

  // ── Project ↔ Context ── scope a repo to the created project.
  store.applyRelationOp({
    kind: 'scope-context',
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    context: { kind: 'repo', label: 'patrick-yingxi-pan/web-app', meta: 'feat/insights-dashboard' },
  })

  // ── Agent Commons (D6/D9/D10/D7) ── a created Model provider (with its server-only
  // config), a library system prompt, a worker Agent bound to both through the D8
  // funnel, and a Commission onto a seed project — so all four registries (and their
  // id counters) are exercised once, keeping persistence coverage comprehensive.
  const provider = store.createProvider(
    {
      label: 'Playground provider',
      modelFamily: 'claude',
      effortLevels: ['Low', 'Medium', 'High'],
      authority: { tools: ['*'], connectors: ['*'], scopes: ['*'] },
    },
    { model: 'claude-opus-4-8' },
  )
  store.updateProvider(provider.id, { modelFamily: 'claude-playground' }, provider.definitionRevision)
  const relayTenant = store.defaultTenantId()
  const relayProviderId = 'provider-session-playground'
  const initialRelaySecret = deriveRelayCreationSecret(relayTenant, 'playground-session-create')
  const relayProvider = store.createProvider(
    {
      label: 'Playground Session relay',
      modelFamily: 'claude',
      effortLevels: ['Default'],
      kind: 'session',
      secretHint: relaySecretHint(initialRelaySecret),
    },
    { kind: 'session', capabilities: { toolUse: true }, secretHash: hashRelaySecret(initialRelaySecret) },
    relayTenant,
    { logicalId: relayProviderId },
  )
  const relayRotationKey = 'playground-session-rotation'
  const relayRotationSecret = deriveRelayRotationSecret(relayTenant, relayProvider.id, relayRotationKey)
  store.rotateProviderSecret(relayProvider.id, {
    logicalId: providerSecretRotationId(relayTenant, relayProvider.id, relayRotationKey),
    secret: relayRotationSecret,
    expectedRevision: relayProvider.connectionRevision ?? 0,
  })
  const prompt = store.createSystemPrompt({
    label: 'Playground research prompt',
    body: 'You are a focused research assistant. Cite primary sources and stay terse.',
    targetFamily: 'claude',
  })
  store.updateSystemPrompt(prompt.id, { targetFamily: 'claude-playground' }, prompt.definitionRevision)
  const playgroundAgent = store.createAgentFromRequest({
    label: 'Playground research agent',
    providerId: provider.id,
    systemPromptId: prompt.id,
    instructions: 'Prefer primary sources.',
  })
  store.updateAgentFromRequest(
    playgroundAgent.id,
    { instructions: 'Prefer primary and official sources.', published: true },
    playgroundAgent.revision,
  )
  const playgroundProposal = store.proposeAgentChange(
    playgroundAgent.id,
    { fields: { instructions: 'Prefer primary sources and show the evidence trail.' }, note: 'Durable proposal fixture.' },
    store.defaultTenantId(),
    { kind: 'user', id: store.identity({}).user.id },
    { logicalId: 'agent-proposal-new-000000000000000000000000' },
  )
  if (typeof playgroundProposal !== 'object') throw new Error('Could not create the durable Agent proposal fixture')
  const playgroundProposalComment = store.commentOnAgentProposal(
    playgroundAgent.id,
    playgroundProposal.id,
    'Durable proposal comment fixture.',
    store.defaultTenantId(),
    { kind: 'user', id: store.identity({}).user.id },
    { logicalId: 'agent-proposal-comment-new-000000000000000000000000' },
  )
  if (typeof playgroundProposalComment !== 'object') throw new Error('Could not create the durable Agent proposal comment fixture')
  const playgroundProposalVerdict = store.resolveAgentProposal(
    playgroundAgent.id,
    playgroundProposal.id,
    store.defaultTenantId(),
    'decline',
    'Durable proposal verdict fixture.',
    { logicalId: 'agent-proposal-verdict-000000000000000000000000' },
  )
  if (typeof playgroundProposalVerdict !== 'object') throw new Error('Could not create the durable Agent proposal verdict fixture')
  const retiredAgent = store.createAgent(
    { label: 'Retired playground Agent', systemPrompt: 'x', tools: [], instructions: '' },
    store.defaultTenantId(),
    { logicalId: 'agent-new-000000000000000000000000' },
  )
  store.deleteAgent(retiredAgent.id)
  const retiredAgentFork = store.forkAgent(
    playgroundAgent.id,
    store.defaultTenantId(),
    { logicalId: 'agent-fork-000000000000000000000000' },
  )
  if (!retiredAgentFork) throw new Error('Could not create the retirement fixture Agent fork')
  store.deleteAgent(retiredAgentFork.id)
  const retiredAgentImport = store.importAgentFromCard(
    { name: 'Retired imported Agent' },
    'https://agents.example/retired/card.json',
    store.defaultTenantId(),
    { logicalId: 'agent-import-000000000000000000000000' },
  )
  store.deleteAgent(retiredAgentImport.id)
  // Flag the created pair as the pickers' defaults — exercises the registryDefaults
  // persisted slice (the per-tenant default-flag pointers, a UI shortcut).
  store.setDefaultProvider(provider.id)
  store.setDefaultSystemPrompt(prompt.id)
  // A default contributor role on a seed project — exercises the projectDefaultRoles
  // overlay slice (the commissioning pickers' pre-selection, D14/INV-9).
  store.setProjectDefaultRole('p-insights', 'maintainer')
  const playgroundCommission = store.createCommission({ role: 'writer', agentId: playgroundAgent.id, projectId: 'p-insights' })
  // A D13 per-commissioner abuse cap on the (seed) insights project — generous enough not
  // to block, exercising the commissionCaps persisted overlay ("every slice covered").
  store.setCommissionCap('p-insights', 8)
  // Run a Project effect so the D15/OQ7 detective audit trail has an entry (and the
  // Contributor earns a D13 contribution) — exercises the auditLog persisted slice.
  store.runProjectEffect('p-insights', playgroundCommission.id, 'playground-sub', 'connector.read', 'Linear')

  // ── Schedules ── a created routine, linked to the project, carrying all three
  // standing approvals, then RUN once (awaited) so it delivers its standing
  // artifact and lands a completed live run.
  let createdScheduleId = ''
  if (seedSchedules[0]) {
    const cloned = JSON.parse(JSON.stringify(seedSchedules[0])) as Record<string, unknown>
    delete cloned.id
    const created = store.addSchedule({
      ...(cloned as Omit<import('../contract/index.ts').ScheduledTask, 'id'>),
      name: 'Playground weekly digest',
      enabled: true,
      missedFirePolicy: 'catch-up-once',
      lastStatus: 'pending',
      runs: [],
      projectId: undefined,
    })
    createdScheduleId = created.id
    store.applyRelationOp({ kind: 'link-schedule-project', scheduleId: created.id, scheduleName: created.name, projectId: PROJECT_ID, projectName: PROJECT_NAME })
    store.applyRelationOp({ kind: 'set-schedule-artifact', scheduleId: created.id, scheduleName: created.name, cadence: created.cadence, artifactName: 'Weekly digest' })
    store.applyRelationOp({ kind: 'set-schedule-session', scheduleId: created.id, scheduleName: created.name, cadence: created.cadence, sessionLabel: 'Weekly digest run' })
    store.applyRelationOp({ kind: 'schedule-add-tool', scheduleId: created.id, scheduleName: created.name, cadence: created.cadence, tool: { id: 'linear', label: 'Linear', tone: 'connector' } })
  }
  // Disable a different seed schedule so the playground shows a paused routine too.
  if (seedSchedules[1]) store.setScheduleEnabled(seedSchedules[1].id, false)

  // ── Recents ── promote the attached repo + a connector to the front.
  store.pushRecent('repo', 'repo-playground')
  store.pushRecent('connector', 'gh-mcp')
  store.pushRecent('repo', 'repo-tenant-zeta', 'tenant-zeta')

  // ── Contexts (Contexts page) ── flip auth status both directions.
  const connected = seedContexts.find((c) => c.kind === 'connector' && c.status === 'connected')
  const needsAuth = seedContexts.find((c) => c.kind === 'connector' && c.status === 'needs-auth')
  if (connected) store.setConnectorStatus(connected.id, 'needs-auth')
  if (needsAuth) store.setConnectorStatus(needsAuth.id, 'connected')
  store.addSavedContext({
    id: 'ctx-tenant-zeta',
    label: 'Tenant Zeta context',
    kind: 'connector',
    status: 'connected',
    detail: 'tenant-zeta private setup',
    lastUsedAt: null,
    sessions: 0,
  }, 'tenant-zeta')

  // ── Dispatch (P7) ── a one-off run, so the persisted dispatch feed is exercised. It
  // settles to 'done' a beat later — during the schedule-run poll below — and re-persists.
  store.addDispatch('Playground dispatch — refresh the digest', 'Pulling the latest metrics.')

  // FWD-5 Phase 1 — the acts below stamp the backend default USER principal, so the
  // persisted principal sub-slice is exercised too (deterministic on either backend).
  const builder = { kind: 'user' as const, id: store.identity({}).user.id }
  // ── Open work (D19) ── exercise the openSubGoals persisted slice in BOTH states:
  // the standing playground Contributor takes a charge item (→ done, crediting D13),
  // and a connector item the created project can't admit stays open (the backlog face).
  store.updateCommission(playgroundCommission.id, { standing: true })
  store.postOpenSubGoal(
    'p-insights',
    { subGoal: 'playground-open-work', type: 'charge', target: 'budget:playground' },
    store.defaultTenantId(),
    builder,
    undefined,
    undefined,
    { logicalId: 'work-new-000000000000000000000000' },
  )
  store.postOpenSubGoal('p-insights', { subGoal: 'playground-backlog', type: 'connector.write', target: 'no-such-connector' }, store.defaultTenantId(), builder)

  // ── The contribution ledger (Phase A) ── exercise the contributions persisted
  // slice in BOTH states through the real mutators: one landed (L1 — the ledger
  // face, with a discussion note) and one still open (the in-flight face).
  const landedContribution = store.openContribution(
    'p-insights',
    { title: 'Playground contribution — tune the digest template', summary: 'Rewrites the weekly digest opening.', subGoal: 'playground-open-work' },
    store.defaultTenantId(),
    builder,
  )
  if (landedContribution !== 'capped') {
    // Exercise the Phase C envelope sub-slice too: propose → approve → one
    // matched act, so the persisted envelope (lines, used counts, approval
    // stamps) round-trips through the real mutators.
    const withEnvelope = store.proposeEnvelope(
      'p-insights', landedContribution.id,
      {
        lines: [{ type: 'connector.write', target: 'linear:digest', cardinality: 2, harness: 'draft-escrow', note: 'post the digest' }],
        expectedVersion: 0,
      },
      store.defaultTenantId(), builder,
      { logicalId: 'contribution-envelope-proposal-000000000000000000000000' },
    )
    store.approveEnvelope(
      'p-insights',
      landedContribution.id,
      store.defaultTenantId(),
      builder,
      undefined,
      {
        logicalId: 'contribution-envelope-approval-000000000000000000000000',
        expectedVersion: 1,
      },
    )
    if (typeof withEnvelope === 'object' && withEnvelope?.envelope) {
      store.runEnvelopeEffect(
        'p-insights',
        landedContribution.id,
        withEnvelope.envelope.lines[0].id,
        store.defaultTenantId(),
        builder,
        { logicalId: 'contribution-effect-000000000000000000000000' },
      )
    }
    // Phase D: crystallize a changeset version too, so the persisted
    // append-only versions (entries + before/after) round-trip.
    store.crystallizeContribution(
      'p-insights', landedContribution.id,
      { entries: [{ kind: 'note', target: 'digest template', before: 'Weekly numbers below.', after: 'Lead with the metric, then the mechanism.' }] },
      store.defaultTenantId(), builder,
      { logicalId: 'contribution-crystallization-000000000000000000000000' },
    )
    // Phase E: persist the owner's monotonic review requirement and run the
    // mock adversarial review, so both durable receipts round-trip.
    store.requireContributionReview(
      'p-insights',
      landedContribution.id,
      store.defaultTenantId(),
      builder,
      { logicalId: 'contribution-require-review-000000000000000000000000' },
    )
    store.reviewContribution(
      'p-insights',
      landedContribution.id,
      store.defaultTenantId(),
      builder,
      { logicalId: 'contribution-review-000000000000000000000000', expectedVersion: 1 },
    )
    store.noteContribution(
      'p-insights',
      landedContribution.id,
      'Looks right — landing it.',
      store.defaultTenantId(),
      builder,
      { logicalId: 'contribution-comment-new-000000000000000000000000' },
    )
    store.landContribution(
      'p-insights',
      landedContribution.id,
      store.defaultTenantId(),
      builder,
      { logicalId: 'contribution-land-000000000000000000000000' },
    )
  }
  const inFlightContribution = store.openContribution(
    'p-insights',
    { title: 'Playground contribution — still in flight', summary: 'Half-drafted; stays open in the snapshot.' },
    store.defaultTenantId(),
    builder,
  )
  // ── Social S1 grants ── exercise the persisted slice through the real
  // mutator: the default tenant publishes the playground project to a seeded
  // org audience (note present = the publish act).
  store.createGrant(
    {
      subject: { kind: 'project', id: 'p-playground' },
      audience: { kind: 'org', orgId: 'tenant-beta' },
      tier: 'comment',
      note: 'Playground share — exercised for the snapshot.',
    },
    store.defaultTenantId(),
  )
  // ── Social S2 discussions ── exercise the persisted slice through the real
  // mutator: the default tenant opens the playground project's root thread.
  const snapshotDiscussion = store.openDiscussion(
    { anchor: { ref: { kind: 'project', id: 'p-playground' } }, firstPost: 'Playground root thread — exercised for the snapshot.' },
    store.defaultTenantId(),
  )
  if (snapshotDiscussion && snapshotDiscussion !== 'forbidden' && snapshotDiscussion !== 'capped') {
    const postId = snapshotDiscussion.posts[0]?.id
    if (postId) {
      store.setDiscussionReaction(snapshotDiscussion.id, postId, 'tenant-beta', true)
      store.reportDiscussionPost(snapshotDiscussion.id, postId, 'tenant-beta')
    }
    store.setDiscussionState(snapshotDiscussion.id, 'resolved', store.defaultTenantId(), 0)
  }
  // ── Social S3 proposals ── exercise the persisted slice through the real
  // mutator: a suggestion offered on the playground project (its review thread
  // exercises the discussions slice's proposal anchor too).
  store.openSocialProposal(
    { subject: { kind: 'project', id: 'p-playground' }, delta: { kind: 'suggestion', text: 'Playground suggestion — snapshot coverage.' }, rationale: 'Exercised for the snapshot.' },
    store.defaultTenantId(),
  )
  // ── Social S3 artifact bodies ── the body-edit overlay: rewrite one addressed
  // prose block through the REAL mutator — the same call a landed
  // `artifact-patch` runs — so an edited document survives a restart. The target
  // is resolved by ASKING which block is patchable rather than hardcoding an
  // index, so a reshuffled fixture can't turn this into a silent no-op.
  const editable = store
    .listArtifacts(store.defaultTenantId())
    .map((a) => ({ id: a.id, block: [0, 1, 2, 3].find((i) => store.artifactBlockText(a.id, i) !== undefined) }))
    .find((x) => x.block !== undefined)
  if (editable?.block !== undefined) {
    // An applying proposal freezes both the target revision and reviewed block
    // pre-image. Move the body after offering so the snapshot also exercises the
    // durable stale-proposal form (PD80), not only suggestion rows.
    store.openSocialProposal(
      {
        subject: { kind: 'artifact', id: editable.id },
        delta: { kind: 'artifact-patch', block: editable.block, text: 'Playground proposed body edit — snapshot coverage.' },
        rationale: 'Exercise the proposal precondition in the snapshot.',
      },
      store.defaultTenantId(),
    )
    store.updateArtifactBlock(editable.id, editable.block, 'Playground body edit — snapshot coverage.')
    const artifact = store.artifactById(editable.id)!
    store.renameArtifact(editable.id, 'Playground renamed document.md', artifact.metadataRevision ?? 0, store.defaultTenantId())
  }
  // Structured authoring shares the portable body map with documents, but its
  // values must survive as a real sheet/deck rather than a prose scaffold.
  store.applyRelationOp({ kind: 'save-artifact', artifact: {
    name: 'Playground metrics.sheet', kind: 'sheet', meta: 'Sheet',
    body: { type: 'sheet', columns: ['Metric', 'Value'], rows: [['Portable values', '=1+1']], note: 'Literal values; no calculation.' },
  } })
  store.applyRelationOp({ kind: 'save-artifact', artifact: {
    name: 'Playground briefing.slides', kind: 'slide', meta: 'Slides',
    body: { type: 'slides', slides: [{ title: 'Portable briefing', bullets: ['Exact authored slide values.'] }] },
  } })
  // ── Social S6 link grants ── exercise the link-token path through the real
  // mutators: the server mints the token, and a foreign tenant redeems it (the
  // redeemedBy roster is server-private but must survive a restart).
  const linkGrant = store.createGrant(
    { subject: { kind: 'project', id: 'p-playground' }, audience: { kind: 'link', token: '' }, tier: 'view' },
    store.defaultTenantId(),
  )
  if (linkGrant !== undefined && typeof linkGrant === 'object' && linkGrant.audience.kind === 'link') {
    store.redeemGrant(linkGrant.audience.token, 'tenant-playground-watcher')
  }
  // ── Social S5 mutes ── exercise the per-viewer earmuff slice through the
  // real mutator (an actor display name, never a wall).
  store.setMute('Playground muted actor', true, store.defaultTenantId())
  // ── Delegations (CW8, Phase F) ── exercise the persisted roster through the
  // real mint funnel (the default agent is the default tenant's own worker).
  const snapshotDelegation = store.createDelegation(
    'p-insights',
    { agentId: 'agent-default', actKind: 'land', policy: 'Draft routine landing judgments for the dashboard.', mode: 'draft' },
    store.defaultTenantId(),
  )
  if (typeof snapshotDelegation === 'object' && typeof inFlightContribution === 'object') {
    store.runDelegation(
      'p-insights',
      inFlightContribution.id,
      snapshotDelegation.id,
      store.defaultTenantId(),
      builder,
      { logicalId: 'delegated-judgment-000000000000000000000000' },
    )
  }
  const retiredDelegation = store.createDelegation(
    'p-insights',
    { agentId: 'agent-default', actKind: 'land', policy: 'Land exact reviewed changes for snapshot coverage.', mode: 'draft' },
    store.defaultTenantId(),
    { logicalId: 'delegation-new-000000000000000000000000' },
  )
  if (retiredDelegation && typeof retiredDelegation === 'object') {
    store.deleteDelegation(
      'p-insights',
      retiredDelegation.id,
      store.defaultTenantId(),
      {
        expectedCreatedAt: retiredDelegation.createdAt,
        revocationId: 'delegation-revoke-000000000000000000000000',
      },
    )
  }

  // ── Watching + the inbox (D24) ── exercise both persisted slices: share the
  // CREATED project (watch fan-out re-checks visibility at mint time — a private
  // project's audience is its owner alone), a foreign tenant watches it, and a
  // posted-then-commented item (D23) fans notifications out to that watcher.
  store.applyRelationOp({ kind: 'share-project', projectId: PROJECT_ID, projectName: PROJECT_NAME, shared: true })
  store.setWatch({ kind: 'project', id: PROJECT_ID }, 'tenant-playground-watcher', true)

  // ── The Commons lenses (S4) ── the other two per-principal slices: a like on
  // a published feed item, and a recently-viewed entry. Read the item id from
  // the REAL feed rather than composing `share:<id>` by hand, so this exercises
  // the same derived id the UI acts on.
  const watcherFeed = store.listCommons('tenant-playground-watcher')
  const likeable = watcherFeed.find((i) => i.subject.id === PROJECT_ID)
  if (likeable) store.setCommonsLike(likeable.id, 'tenant-playground-watcher', true)
  store.recordView({ kind: 'project', id: PROJECT_ID }, 'tenant-playground-watcher')

  // ── The person layer (S7) ── the two remaining per-principal slices. Both go
  // through the REAL mutators, so the walls they enforce are exercised too: the
  // follow is reachable only because Ada's world publishes to Grace, and the DM
  // is a Discussion anchored to a PRINCIPAL whose get-or-create keys on the
  // pair. Read-mark last, so the round-trip carries a non-zero mark.
  store.setFollow('Ada Lovelace', true, 'tenant-beta')
  // ── The square (S8) ── a POST is a discussion anchored to its author's own
  // principal, so it rides the `discussions` slice — but it is a different
  // SHAPE within it (self-anchored, wall-walled), and a snapshot that carried
  // only DMs would let the wall predicate rot unnoticed on restore. It names
  // somebody, so the mention path is exercised too.
  store.openWallPost('Playground post — @Ada Lovelace this is the square, exercised for the snapshot.', 'tenant-beta')
  const dm = store.openDiscussion(
    { anchor: { ref: { kind: 'principal', id: 'Ada Lovelace' } }, firstPost: 'playground direct message — is the dashboard still on for Thursday?' },
    'tenant-beta',
  )
  if (typeof dm === 'object') store.markDiscussionRead(dm.id, 'tenant-beta')

  // ── The bearer-token registry (INV-11 / PORT-9) ── one minted row, so the
  // `apiTokens` slice round-trips (revocation state must survive a restart).
  const { accounts } = await import('../server/accounts.ts')
  accounts.mintApiTokenWithReceipt('user-ada', 'playground token', 'playground-token-mint')
  store.accountsMutated()
  const watchedItem = store.postOpenSubGoal(PROJECT_ID, { subGoal: 'playground-watched-item', type: 'charge', target: 'budget:playground' }, store.defaultTenantId(), builder)
  store.commentOnOpenSubGoal(
    PROJECT_ID,
    watchedItem.id,
    'playground discussion — still needed?',
    store.defaultTenantId(),
    builder,
    undefined,
    { logicalId: 'work-comment-new-000000000000000000000000' },
  )
  store.retractOpenSubGoal(
    PROJECT_ID,
    watchedItem.id,
    store.defaultTenantId(),
    builder,
    { logicalId: 'work-retract-000000000000000000000000' },
  )

  // Run the created routine through the worker-facing durable transition seam.
  // Snapshot manufacture stays deterministic and offline; the routine worker's
  // model-loop behavior has its own tests and the real server wires it at boot.
  if (createdScheduleId) {
    const scheduledFor = store.listSchedules().find((task) => task.id === createdScheduleId)?.nextFireAt
    const run = store.runSchedule(createdScheduleId, scheduledFor === undefined ? undefined : { scheduledFor })
    if (run) {
      const context = store.routineExecutionContext(createdScheduleId, run.id)
      store.markScheduleRunAttempt(createdScheduleId, run.id, 1, run.at + 100)
      store.completeScheduleRun(
        createdScheduleId,
        run.id,
        { id: `m-${run.id}`, role: 'assistant', content: 'Playground weekly digest — deterministic snapshot output.' },
        {
          agentId: context?.agent.id ?? 'agent-default',
          providerId: context?.provider.id ?? 'provider-anthropic',
          ...(context?.modelId ? { modelId: context.modelId } : {}),
        },
        run.at + 1_000,
      )
    }
  }

  const state = loadState()
  if (!state) throw new Error('buildComprehensive: the snapshot did not persist to the configured backend')
  return state
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function fmt(p: string): string {
  // Show a repo-relative path when possible, else the absolute one.
  const rel = p.startsWith(process.cwd()) ? p.slice(process.cwd().length + 1) : p
  return rel.replace(/\\/g, '/')
}

function cmdSave(name: string): void {
  const { from, to } = saveSnapshot(name)
  console.log(`Saved  ${fmt(from)}  →  ${fmt(to)}`)
}

function cmdRestore(name: string): void {
  const { from, to } = restoreSnapshot(name)
  console.log(`Restored  ${fmt(from)}  →  ${fmt(to)}`)
  console.log('↻  Keep the old server stopped during restore, then restart it to load the recovered state.')
}

function cmdList(): void {
  const snaps = listSnapshots()
  if (snaps.length === 0) {
    console.log(`No snapshots in ${fmt(snapshotsDir())} yet — try \`snapshot save\` or \`snapshot build\`.`)
    return
  }
  console.log(`Snapshots in ${fmt(snapshotsDir())}:`)
  for (const s of snaps) {
    console.log(`  ${s.name.padEnd(22)} ${String(s.sizeKB).padStart(8)} KB   ${s.modified.toISOString()}`)
  }
}

async function cmdBuild(activate: boolean): Promise<void> {
  const kind = backendKind()
  const dir = snapshotsDir()
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, kind === 'sqlite' ? `.build-tmp-${process.pid}.db` : `.build-tmp-${process.pid}.json`)
  const target = snapshotPath('comprehensive')
  const tempFiles = kind === 'sqlite'
    ? [tmp, `${tmp}-wal`, `${tmp}-shm`, `${tmp}-journal`]
    : [tmp, `${tmp}.tmp`]
  for (const file of tempFiles) rmSync(file, { force: true })

  // Build against a fresh temp path so the store seeds clean, then promote it.
  const pathKey = kind === 'sqlite' ? 'DATABASE_PATH' : 'DATA_FILE'
  const prev = process.env[pathKey]
  process.env[pathKey] = tmp
  let state: PersistedState
  try {
    state = await buildComprehensive()
  } finally {
    // SQLite must checkpoint/close before its temp files are removed. Closing
    // the facade also prevents it retaining the temporary location after env is
    // restored (the store normally owns this handle for the process lifetime).
    try {
      const { closePersistence } = await import('../server/persistence/persist.ts')
      closePersistence()
    } finally {
      if (prev === undefined) delete process.env[pathKey]
      else process.env[pathKey] = prev
      for (const file of tempFiles) rmSync(file, { force: true })
    }
  }

  writePortableSnapshot(target, state)

  const g = state.graph
  console.log(`Built comprehensive playground  →  ${fmt(target)}`)
  console.log('  covers:')
  console.log(`    sessions            ${state.sessions.length} (incl. ${state.sessions.filter((s) => s.id.startsWith('sess-')).length} created)`)
  console.log(`    bindings/workspaces ${state.bindings.length} / ${state.workspaces.length}`)
  console.log(`    projects (created)  ${g.extraProjects.length}`)
  console.log(`    artifacts (created) ${g.extraArtifacts.length}`)
  console.log(`    schedules           ${state.schedules.length} (incl. ${state.schedules.filter((s) => s.id.startsWith('s-new-')).length} created)`)
  console.log(`    standing approvals  ${Object.keys(g.standingApprovals).length}`)
  console.log(`    contexts flipped    ${(state.savedContexts ?? []).filter((c) => c.kind === 'connector').length} connectors present`)
  console.log(
    `    agent commons       ${(state.providers ?? []).length} providers / ${(state.systemPrompts ?? []).length} prompts / ${(state.agents ?? []).length} agents / ${(state.commissions ?? []).length} commissions`,
  )

  if (activate) {
    try {
      const { to } = saveSnapshot('pre-build-backup')
      console.log(`Backed up the current live store  →  ${fmt(to)}`)
    } catch (err) {
      // A new install has no live state to protect; every other failure is a
      // hard stop rather than activating without a proven pre-build backup.
      if (!/no live store|no live persisted state/.test((err as Error).message)) throw err
    }
    const { to: live } = restoreSnapshot('comprehensive')
    console.log(`Activated as the live store  →  ${fmt(live)}`)
    console.log('↻  Restart the server to load it.')
  } else {
    console.log('Not activated. To play with it:  npm run snapshot:restore -- comprehensive  (then restart the server)')
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  const args = rest.filter((a) => !a.startsWith('-'))
  const flags = rest.filter((a) => a.startsWith('-'))
  try {
    switch (cmd) {
      case 'save':
        cmdSave(args[0] ?? 'backup')
        break
      case 'restore':
        cmdRestore(args[0] ?? 'backup')
        break
      case 'list':
        cmdList()
        break
      case 'build':
        await cmdBuild(flags.includes('--activate'))
        break
      default:
        console.log('Usage: node scripts/snapshot.ts <save|restore|list|build> [name] [--activate]')
        console.log('  save  [name]        live backend → portable snapshot   (default: backup)')
        console.log('  restore [name]      portable snapshot → live backend   (restart server after)')
        console.log('  list                show every snapshot')
        console.log('  build [--activate]  build the comprehensive playground (--activate makes it live)')
        process.exitCode = cmd ? 1 : 0
    }
  } catch (err) {
    console.error(`snapshot: ${(err as Error).message}`)
    process.exitCode = 1
  }
}

if (import.meta.main) await main()
