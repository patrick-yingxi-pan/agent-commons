import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { keys, paths } from '../api/keys.ts'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('consent eligibility is viewer-keyed and has one UI-only route', () => {
  assert.notEqual(keys.toolActivityEligibility('a', 't', 'u'), keys.toolActivityEligibility('a', 't', 'v'))
  assert.notEqual(keys.toolActivityEligibility('a', 't', 'u'), keys.toolActivityEligibility('b', 't', 'u'))
  assert.ok(keys.toolActivityEligibility('a', 't', 'u').startsWith(`${keys.toolActivityEligibilityPrefix('a')}:`))
  assert.equal(keys.toolActivityEligibility('ab', 't', 'u').startsWith(`${keys.toolActivityEligibilityPrefix('a')}:`), false,
    'invalidating session a cannot collide with session ab')
  assert.equal(paths.toolActivityEligibility('a/b'), '/sessions/a%2Fb/tool-activity-eligibility')

  const routes = source('../../server/routes/index.ts')
  assert.match(routes, /r\.uiFormGet\('\/sessions\/:id\/tool-activity-eligibility'/)
  assert.match(routes, /toolActivityDecisionEligibility\(params\.id, identity\.tenant\.id, identity\.user\.id\)/)
  assert.match(routes, /Cache-Control', 'no-store'/)
  assert.match(routes, /accountTransitionSourceMatches\(req, res\)/)
})

test('the rendered card requires a fresh viewer-relative allow-list and never infers consent from the session list', () => {
  const card = source('./ToolActivityCard.tsx')
  assert.match(card, /useToolActivityEligibility\(sessionId\)/)
  assert.doesNotMatch(card, /useSessions\(/)
  assert.match(card, /eligibility\.status === 'success'/)
  assert.match(card, /decisionActivityIds\.includes\(a\.id\)/)
  assert.match(card, /confirmActivityIds\.includes\(a\.id\)/)
  assert.match(card, /decision === 'confirm' && !confirmAllowed/)
  assert.match(card, /!decisionAllowed\s*\|\|\s*!confirmAllowed/)
  assert.match(card, /Checking decision access/)
  assert.match(card, /Couldn’t check decision access · Retry/)
  assert.match(card, /held !== null \|\| !tenantId \|\| !decisionAllowed/,
    'held recovery retains disabled controls but cannot bypass the fresh server allow-list')

  const hooks = source('../api/toolActivityEligibilityHook.ts')
  assert.match(hooks, /keys\.toolActivityEligibility\(sessionId, identity!\.tenant\.id, identity!\.user\.id\)/)
  assert.match(hooks, /readToolActivityEligibility\(sessionId, identity\?\.via === 'session' \? identity\.user\.id : null\), enabled, true\)/,
    'each mount revalidates actor-scoped controls and pins the first-party source when available')

  const events = source('../api/events.ts')
  assert.match(events, /invalidatePrefix\(keys\.toolActivityEligibilityPrefix\(e\.session\.id\)\)/)
  assert.match(events, /invalidatePrefix\(keys\.toolActivityEligibilityPrefix\(e\.sessionId\)\)/)
  assert.match(events, /invalidatePrefix\('tool-activity-eligibility'\)/,
    'MCP lifecycle changes refresh exact-confirm eligibility')
})

test('the eligibility reader and hook stay behind the deferred tool-card boundary', () => {
  const card = source('./ToolActivityCard.tsx')
  assert.match(card, /from '\.\.\/api\/toolActivityEligibilityHook\.ts'/)
  assert.match(card, /from '\.\.\/api\/toolActivityEligibility\.ts'/)
  for (const entry of ['../api/hooks.ts', '../api/index.ts']) {
    assert.doesNotMatch(source(entry), /from ['"][^'"]*toolActivityEligibility(?:Hook)?(?:\.ts)?['"]/,
      `${entry} cannot eagerly import or re-export the conditional consent runtime`)
  }
})

test('shared transcripts retain keyboard scrolling when consent controls are absent', () => {
  assert.match(source('./ConversationView.tsx'), /ref=\{scrollRef\}[^>]*namedReadRegionProps\('Conversation transcript', 'conversation'\)/)
})
