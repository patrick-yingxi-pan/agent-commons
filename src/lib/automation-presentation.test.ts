import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { AUTOMATION_NOTICE_CLASS, automationPresentation } from './automationPresentation.ts'
import { read, ROOT, stripComments } from '../../tests/helpers/source.ts'

test('legacy automation presentation states are explicit and fail closed', () => {
  const fixture = automationPresentation(true)
  assert.equal(fixture.state, 'fixture')
  assert.equal(fixture.canSimulate, true)
  assert.match(fixture.standing, /Legacy Standing simulation only/)
  assert.match(fixture.standing, /without running an Agent or calling tools/)
  assert.match(fixture.standing, /Separately approved real MCP may start automatically/)
  assert.match(fixture.work, /Legacy Standing simulation may mark eligible work done/)
  assert.match(fixture.work, /separately approved real MCP may start automatically/)

  const unavailable = automationPresentation(false)
  assert.equal(unavailable.state, 'unavailable')
  assert.equal(unavailable.canSimulate, false)
  assert.match(unavailable.standing, /saved for coordination only/)
  assert.match(unavailable.standing, /separately approved real MCP may still start automatically/)
  assert.match(unavailable.work, /Legacy Standing simulation is unavailable/)
  assert.match(unavailable.work, /separately approved real MCP may start calls automatically/)

  const unknown = automationPresentation(undefined)
  assert.equal(unknown.state, 'unknown')
  assert.equal(unknown.canSimulate, false)
  assert.match(unknown.standing, /Legacy Standing simulation availability could not be confirmed/)
  assert.match(unknown.standing, /Separately approved real MCP may start automatically within its reviewed limits/)
  assert.match(unknown.work, /Legacy Standing simulation availability could not be confirmed/)
  assert.match(unknown.work, /separately approved real MCP may start automatically within its own review and limits/)
  assert.deepEqual(Object.keys(unknown).sort(), ['canSimulate', 'standing', 'state', 'work'])
})

test('legacy automation disclosure stays on standing/work and cannot gate real Dispatch', () => {
  const components = join(ROOT, 'src', 'components')
  const paths = (readdirSync(components, { recursive: true }) as string[])
    .filter((path) => path.endsWith('.tsx'))
    .map((path) => join(components, path))
  const sources = paths.map((path) => ({ path, source: stripComments(read(path)) }))
  const consumers = sources.filter(({ source }) =>
    /automationPresentation\(|function AutomationNotice\b/.test(source),
  )

  assert.deepEqual(
    consumers.map(({ path }) => relative(components, path)).sort(),
    ['SectionView.tsx'],
    'only the page-level legacy standing/work notice owns this presentation',
  )

  const noticeStyleConsumers = sources.filter(({ source }) => /AUTOMATION_NOTICE_CLASS/.test(source))
  assert.deepEqual(
    noticeStyleConsumers.map(({ path }) => relative(components, path)).sort(),
    ['NewDispatchDialog.tsx', 'SectionView.tsx'],
    'the deferred real Dispatch form may share the notice styling without consuming legacy simulation copy',
  )

  const source = consumers[0]!.source
  assert.equal((source.match(/<AutomationNotice\b/g) ?? []).length, 2)
  assert.deepEqual(
    [...source.matchAll(/<AutomationNotice\s+kind="(standing|work)"\s*\/>/g)].map((match) => match[1]).sort(),
    ['standing', 'work'],
  )
  assert.match(source, /function AutomationNotice\(\{ kind \}: \{ kind: 'standing' \| 'work' \}\)/)
  assert.match(source, /className=\{AUTOMATION_NOTICE_CLASS\}/)
  assert.doesNotMatch(source, /<AutomationNotice\s+kind="dispatch"/,
    'legacy simulation copy must not describe the new real Dispatch path')
  assert.match(source, /dispatchPresentation\(capabilities\.status === 'error' \? undefined : capabilities\.data\?\.features\.dispatchExecution\)/,
    'real Dispatch reads its independent server capability')
  assert.doesNotMatch(source, /automationPresentation\([^)]*simulatedAutomation[^)]*\)[\s\S]{0,500}New dispatch/,
    'the legacy fixture capability cannot gate the real Dispatch action')
})

test('automation notice class uses the shared readable text ramp', () => {
  assert.match(AUTOMATION_NOTICE_CLASS, /text-ink-soft/)
  assert.doesNotMatch(AUTOMATION_NOTICE_CLASS, /text-warn-text|text-danger/)
})
