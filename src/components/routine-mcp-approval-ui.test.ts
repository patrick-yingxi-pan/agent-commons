import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ROOT, read, stripComments } from '../../tests/helpers/source.ts'
import { SCHEDULE_SECTIONS } from '../lib/compositeSections.ts'
import { paths, keys } from '../api/keys.ts'
import { routineMcpApprovalIntent, routineMcpRunLabel } from '../lib/routineMcpPresentation.ts'

const source = (...parts: string[]) => stripComments(read(join(ROOT, ...parts)))

test('External MCP is a distinct owner-only, childless Routine page and rail section', () => {
  const section = SCHEDULE_SECTIONS.find((item) => item.id === 'external-mcp')
  assert.deepEqual(section, { id: 'external-mcp', label: 'External MCP', visibility: 'owner', childKinds: [] })
  assert.ok(SCHEDULE_SECTIONS.findIndex((item) => item.id === 'external-mcp') > SCHEDULE_SECTIONS.findIndex((item) => item.id === 'context-tools'))
  assert.equal(paths.scheduleMcpPermission('routine/a'), '/schedules/routine%2Fa/mcp-permission')
  assert.equal(keys.scheduleMcpPermission('routine/a'), 'schedule-mcp-permission:routine/a')
  const detail = source('src', 'components', 'SectionView.tsx')
  assert.match(detail, /showScheduleSection\('external-mcp'\) && \([\s\S]*?DeferredRoutineMcpApprovalPanel/)
  assert.match(source('src', 'components', 'Sidebar.tsx'), /visibleCompositeSections\(SCHEDULE_SECTIONS, task\.own !== false\)/)
  assert.match(source('src', 'lib', 'resourceNature.ts'), /schedule: sectionChildKinds\(SCHEDULE_SECTIONS\)/)
  const deliveryIcon = detail.match(/<span\s+data-routine-delivery-icon[\s\S]*?>/)?.[0]
  assert.ok(deliveryIcon, 'the Routine header delivery glyph has an enumerated source/data stamp')
  assert.match(detail, /import \{ namedIconProps \} from '\.\.\/lib\/namedIcon\.ts'/)
  assert.match(deliveryIcon, /\{\.\.\.namedIconProps\(deliveryLabel\)\}/, 'the named icon uses the shared role+name funnel')
})

test('owner review submits only a frozen decision and waits for server truth', () => {
  const panel = source('src', 'components', 'RoutineMcpApprovalPanel.tsx')
  assert.match(panel, /useRoutineMcpReview\(routineId\)/)
  assert.match(panel, /reviewHash: review\.reviewHash/)
  assert.match(panel, /expectedDefinitionRevision: review\.definitionRevision/)
  assert.match(panel, /requestId: crypto\.randomUUID\(\), action: 'approve', approval: routineMcpApprovalIntent\(reviewing\)/)
  assert.match(panel, /\{\s*'\{\}'\s*\} fixes no values/)
  assert.match(panel, /Third-party MCP providers may apply their own fees and usage limits/)
  assert.match(panel, /not a monetary cap/)
  assert.match(panel, /import \{ namedReadRegionProps \} from '\.\.\/lib\/dialog\.ts'/)
  assert.equal((panel.match(/namedReadRegionProps\(/g) ?? []).length, 5, 'all bounded schema, argument and result readers are named and keyboard-scrollable')
  assert.match(panel, /review && !reviewUnavailable/, 'unavailable owner reviews cannot render retained private policy')
  assert.match(panel, /MCP settings are unavailable for this Routine in the current account\./)
  assert.match(panel, /routineMcpReviewReadErrorKind\(query\.error\) === 'unavailable'/)
  const readerProps = source('src', 'lib', 'dialog.ts')
  assert.match(readerProps, /data-\$\{marker\}-read-region/)
  assert.match(readerProps, /role: 'region', 'aria-label': label, tabIndex: 0/)
  assert.match(panel, /Outcome uncertain/)
  assert.match(panel, /routine is paused; review the external service, re-enable the routine, and renew approval/)
  assert.match(panel, /routineMcpRunLabel\(run\.status\)/, 'ledger phase is not confused with the actual run status')
  assert.match(panel, /Held decision:.*Retry uses the original request unchanged/)
  assert.match(panel, /grid-cols-1 gap-3/)
  assert.doesNotMatch(panel, /\bsm:grid-cols-2/)
  assert.match(panel, /SOFT_BUTTON_CLASS/)
  assert.match(panel, /SECONDARY_BUTTON_CLASS/)
  assert.doesNotMatch(panel, /setData\(|mutate\(|apiPost\(|fetch\(/, 'the rendered panel cannot invent cached approval or bypass the API door')
  const runtime = source('src', 'controller', 'routineMcpMutationRuntime.ts')
  assert.match(runtime, /discardReconcileFailure: 'retain'/)
  assert.match(runtime, /getRoutineMcpReview\(intent\.routineId, intent\.sourceUserId, deadline\(\), intent\)/)
  assert.match(runtime, /response\.requestId !== intent\.request\.requestId/)
  assert.match(runtime, /return false/, 'a matching current policy cannot prove this exact request committed')
  assert.match(runtime, /AbortSignal\.timeout\(DEADLINE_MS\)/)
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.request\.requestId/)
  const facade = source('src', 'controller', 'routineMcpMutations.ts')
  assert.match(facade, /deepFreeze\(structuredClone\(\{ routineId, tenantId: identity\.tenant\.id, userId: identity\.user\.id, accountGeneration: accountGeneration\(\), request, sourceUserId \}\)\)/)
  assert.match(facade, /routineMcpHeldDecision/)
  assert.match(facade, /onAccountSwitch\(\(\) => \{[\s\S]*?generation \+= 1/)
})

test('completed receipts are labeled from actual run status even while their ledger phase is active', () => {
  const completed = { runId: 'run-complete', phase: 'active', status: 'ok', calls: [] } as const
  assert.equal(completed.phase, 'active')
  assert.equal(routineMcpRunLabel(completed.status), 'Run completed')
  assert.notEqual(routineMcpRunLabel(completed.status), 'Run in progress')
})

test('approval request projects presentation-only review details out of the wire body', () => {
  const intent = routineMcpApprovalIntent({
    expectedRevision: 2, expectedDefinitionRevision: 5, reviewHash: 'opaque', expiresAt: 9,
    maxCallsPerRun: 3, tools: [], disclosures: ['destination'], labels: { one: 'label' },
  })
  assert.deepEqual(intent, { expectedRevision: 2, expectedDefinitionRevision: 5, reviewHash: 'opaque', expiresAt: 9, maxCallsPerRun: 3, tools: [] })
  assert.deepEqual(Object.keys(intent).sort(), ['expectedDefinitionRevision', 'expectedRevision', 'expiresAt', 'maxCallsPerRun', 'reviewHash', 'tools'].sort())
})

test('routine and audience events re-read the private approval projection', () => {
  const events = source('src', 'api', 'events.ts')
  assert.match(events, /function invalidateRoutineMcpReviews\(\): void \{\s*invalidatePrefix\('schedule-mcp-permission:'\)/)
  const scheduleChanged = events.split("case 'schedule.changed':")[1]?.split('break')[0] ?? ''
  assert.match(scheduleChanged, /invalidateRoutineMcpReviews\(\)/)
  const grantChanged = events.split("case 'grant.changed':")[1]?.split('break')[0] ?? ''
  assert.match(grantChanged, /invalidateRoutineMcpReviews\(\)/, 'Routine, artifact, Project and run Session grants all contribute to consent')
  assert.doesNotMatch(grantChanged, /if[^\n]*invalidateRoutineMcpReviews/, 'destination grant refresh cannot be narrowed to only one subject kind')
  const runChanged = events.split("case 'run.started':")[1]?.split('break')[0] ?? ''
  assert.match(runChanged, /invalidate\(keys\.scheduleMcpPermission\(e\.taskId\)\)/)
  for (const event of ["case 'agent.changed':", "case 'provider.changed':", "case 'relation.applied':", "case 'connector.status':"]) {
    const body = events.split(event)[1]?.split('break')[0] ?? ''
    assert.match(body, /invalidateRoutineMcpReviews\(\)/, `${event} changes the live review scope or tool catalog`)
  }
})
