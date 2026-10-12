import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

function changesPanel(): string {
  return stripComments(read(join(ROOT, 'src', 'components', 'ChangesPanel.tsx')))
}

test('Declare work holds one exact Contribution until server truth', () => {
  const panel = changesPanel()
  const deferred = stripComments(read(join(ROOT, 'src', 'components', 'DeferredChangesPanel.tsx')))
  const legacy = stripComments(read(join(ROOT, 'src', 'api', 'commands.ts')))
  const commands = stripComments(read(join(ROOT, 'src', 'api', 'contributionCreationCommands.ts')))
  const controller = stripComments(read(join(ROOT, 'src', 'controller', 'contributionCreationMutations.ts')))
  const runtime = stripComments(read(join(ROOT, 'src', 'controller', 'contributionCreationMutationRuntime.ts')))
  const notice = stripComments(read(join(ROOT, 'src', 'components', 'ContributionCreationMutationNotice.tsx')))
  const shell = stripComments(read(join(ROOT, 'src', 'components', 'ShellMutationNotices.tsx')))
  const route = stripComments(read(join(ROOT, 'server', 'routes', 'index.ts')))
  const store = stripComments(read(join(ROOT, 'server', 'store', 'index.ts')))

  assert.doesNotMatch(legacy, /export async function openContribution/,
    'the invalidate-only creation command is removed')
  assert.doesNotMatch(panel, /openContribution\(/,
    'the form cannot bypass acknowledgement-owned creation')
  assert.match(panel, /const changesHeld = contributionHeld \|\| proposalHeld/)
  assert.match(panel, /heldOpen=\{changesHeld\}/,
    'the Changes section cannot fold away held work intent')
  assert.match(panel, /enqueueContributionCreation\(\{[\s\S]*?tenantId,[\s\S]*?projectId: project\.id,[\s\S]*?request:/)
  assert.match(panel, /data-contribution-creation-form[\s\S]*?aria-busy=\{changesHeld\}/)
  assert.match(panel, /disabled=\{changesHeld\}/, 'value-bearing fields freeze')
  assert.match(panel, /event\.key === 'Escape' && !changesHeld/,
    'the keyboard cannot dismiss unresolved work')
  assert.match(panel, /result\.outcome === 'applied'[\s\S]*?openPage\(result\.contributionId\)/,
    'only acknowledged or reconciled truth navigates to the server-derived row')
  assert.match(panel, /Your Contribution is still here/,
    'Dismiss preserves a visible authored form')
  assert.match(deferred, /lazy\(\(\) => import\('\.\/ChangesPanel\.tsx'\)/)

  assert.match(controller, /intentId: crypto\.randomUUID\(\)/)
  assert.match(controller, /heldProjects/, 'the Project host is held eagerly while transport stays lazy')
  assert.match(controller, /accountGeneration/, 'late acknowledgement is fenced by account scope')
  assert.match(controller, /contributionCreationId\(input\.tenantId, input\.projectId, intent\.intentId\)/)
  assert.match(commands, /contributionCreationId\([\s\S]*intent\.tenantId,[\s\S]*intent\.projectId,[\s\S]*idempotencyKey/)
  assert.match(commands, /apiPost<Contribution>[\s\S]*idempotencyKey/, 'Retry retains one logical key')
  assert.match(route, /const openContribution = idempotent\(/)
  assert.match(route, /r\.post\('\/projects\/:id\/contributions',[\s\S]*?return openContribution\(ctx\)/)
  assert.match(route, /if \(represented\) return sendContribution\(res, represented, who\)/,
    'durable replay returns represented work before parsing changed input')
  assert.match(store, /id = options\.logicalId \?\? `contrib-/)
  assert.match(store, /return commitMutationBatch\(\(\) => \{[\s\S]*?contributions\.push\(c\)[\s\S]*?persist\(\)/,
    'row, opening event, and persistence are one store commit')
  assert.match(runtime, /mintIdempotencyKey: \(intent\) => intent\.intentId/)
  assert.match(notice, /kind="contribution-create"/)
  assert.match(shell, /<ContributionCreationMutationNotice \/>/)
})

test('the Contribution form is prioritized, retains text in its host, and speaks in work language', () => {
  const panel = changesPanel()
  const form = panel.indexOf("composing === 'contribution'")
  const ledger = panel.indexOf('{rows.length === 0')
  assert.ok(form >= 0 && ledger > form,
    'the header action reveals the form before the potentially long ledger')
  assert.match(panel, /label="Declare work"/)
  assert.match(panel, /const \[title, setTitle\] = useState\(''\)/)
  assert.match(panel, /const \[summary, setSummary\] = useState\(''\)/)
  assert.match(panel, /Name the intended change before work begins\./)
  assert.match(panel, /What will change\? \(required\)/)
  assert.match(panel, /Why, scope, or constraints \(optional\)…/)
  assert.match(panel, /\{contributionHeld \? 'Declaring…' : 'Declare'\}/)
  assert.doesNotMatch(panel, /Open a contribution — declare work before doing it/)
})
