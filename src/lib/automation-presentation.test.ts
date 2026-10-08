import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { AUTOMATION_NOTICE_CLASS, automationPresentation } from './automationPresentation.ts'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('automation presentation fails closed for unavailable and unresolved capability state', () => {
  const fixture = automationPresentation(true)
  assert.equal(fixture.state, 'fixture')
  assert.equal(fixture.canSimulate, true)
  assert.match(fixture.dispatch, /Development simulation/)
  assert.match(fixture.dispatch, /does not run an Agent or call tools/)
  assert.match(fixture.standing, /may be marked done without running an Agent/)
  assert.match(fixture.standing, /does not grant real unattended execution/)
  assert.match(fixture.work, /may simulate completion/)

  const unavailable = automationPresentation(false)
  assert.equal(unavailable.state, 'unavailable')
  assert.equal(unavailable.canSimulate, false)
  assert.match(unavailable.dispatch, /No Agent will run/)
  assert.match(unavailable.dispatch, /simulations, not execution receipts/)
  assert.match(unavailable.standing, /saved for coordination only/)
  assert.match(unavailable.standing, /posted work stays open/)
  assert.match(unavailable.work, /Standing execution is unavailable/)

  const unknown = automationPresentation(undefined)
  assert.equal(unknown.state, 'unknown')
  assert.equal(unknown.canSimulate, false)
  assert.match(unknown.dispatch, /availability could not be confirmed/)
  assert.match(unknown.dispatch, /No Agent will run/)
  assert.match(unknown.standing, /availability could not be confirmed/)
  assert.match(unknown.work, /a development backend may simulate completion/)
})

test('SectionView enumerates every automation presentation consumer and gates both Dispatch doors', () => {
  const components = join(ROOT, 'src', 'components')
  const paths = (readdirSync(components, { recursive: true }) as string[])
    .filter((path) => path.endsWith('.tsx'))
    .map((path) => join(components, path))
  const sources = paths.map((path) => ({ path, source: stripComments(read(path)) }))
  const consumers = sources.filter(({ source }) =>
    /automationAvailability\(|automationPresentation\(|AUTOMATION_NOTICE_CLASS|function AutomationNotice\b/.test(source),
  )

  assert.deepEqual(
    consumers.map(({ path }) => relative(components, path)).sort(),
    ['CompositeRailControls.tsx', 'SectionView.tsx'],
    'page and rail must share one posture derivation',
  )

  const source = consumers.find(({ path }) => path.endsWith('/SectionView.tsx'))!.source
  const rail = consumers.find(({ path }) => path.endsWith('/CompositeRailControls.tsx'))!.source
  assert.match(rail, /automationAvailability\(capabilities\.status === 'error' \? undefined : capabilities\.data\?\.features\.simulatedAutomation\)/)
  assert.doesNotMatch(rail, /automationPresentation/, 'lazy disclosure copy cannot enter the eager rail graph')
  assert.match(read(join(ROOT, 'src', 'lib', 'automationPresentation.ts')), /automationAvailability\(simulatedAutomation\)/,
    'rail and page share one capability decision without eagerly loading copy')
  assert.match(rail, /section === 'dispatch' && !automation\.canSimulate/)
  assert.match(rail, /disabled: primaryUnavailable/)
  assert.match(rail, /if \(!primaryUnavailable\) onCommand\('primary-action'\)/)
  assert.match(source, /import \{ automationPresentation, AUTOMATION_NOTICE_CLASS \} from '\.\.\/lib\/automationPresentation\.ts'/)
  assert.equal((source.match(/automationPresentation\(/g) ?? []).length, 3, 'page, dialog, and notice each derive shared posture')
  assert.equal((source.match(/<AutomationNotice\b/g) ?? []).length, 4, 'Dispatch, standing, and work surfaces all disclose posture')
  assert.deepEqual(
    [...source.matchAll(/<AutomationNotice\s+kind="(dispatch|standing|work)"\s*\/>/g)].map((match) => match[1]).sort(),
    ['dispatch', 'dispatch', 'standing', 'work'],
    'every notice kind and placement remains explicitly enumerated',
  )
  assert.match(source, /function AutomationNotice\(\{ kind \}: \{ kind: 'dispatch' \| 'standing' \| 'work' \}\)/)
  assert.match(source, /className=\{AUTOMATION_NOTICE_CLASS\}/, 'notices use the shared readable class')

  assert.match(source, /const openDispatch = \(\) => \{ if \(automation\.canSimulate\) setCreating\(true\) \}/)
  assert.match(source, /disabled=\{!automation\.canSimulate\}/, 'the page action is visibly unavailable')
  assert.match(source, /onRailInvoke=\{automation\.canSimulate \? openDispatch : undefined\}/, 'the rail projection cannot bypass the page gate')
  assert.match(source, /const canCreate = automation\.canSimulate && title\.trim\(\)\.length > 0 && Boolean\(tenantId\)/, 'the dialog requires confirmed fixture capability')
  assert.match(source, /if \(!canCreate \|\| held \|\| !tenantId\) return/, 'the submit handler repeats the dialog gate')
  assert.match(source, /canSubmit=\{canCreate && !held\}/, 'the dialog submit control reflects the same gate')
})

test('automation notice class uses the shared readable text ramp', () => {
  assert.match(AUTOMATION_NOTICE_CLASS, /text-ink-soft/)
  assert.doesNotMatch(AUTOMATION_NOTICE_CLASS, /text-warn-text|text-danger/)
})
