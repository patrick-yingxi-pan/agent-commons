/** System-prompt library (docs/agent-commons.md, D10) — the target-family-tagged
 *  prompts a user picks for an Agent, and the pure (prompt × provider) fit check that
 *  surfaces a non-blocking downgrade warning at selection time. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../server/store.ts'
import { promptFitWarning } from '../contract/index.ts'
import { DEFAULT_AGENT } from '../server/data/workers.ts'
import { DEFAULT_SYSTEM_PROMPT_BODY, SP_DEFAULT_ID } from '../server/data/prompts.ts'
import { call } from './helpers/http.ts'

test('promptFitWarning: matching family is clean, a mismatch warns (non-blocking)', () => {
  const claude = { id: 'x', label: 'X', body: 'b', targetFamily: 'claude' }
  assert.equal(promptFitWarning(claude, 'claude'), null)
  const open = { id: 'y', label: 'Y', body: 'b', targetFamily: 'open' }
  const warn = promptFitWarning(open, 'claude')
  assert.ok(warn && warn.includes('open') && warn.includes('claude'))
})

test('the default Agent single-sources its prompt body from the library (no drift)', () => {
  assert.equal(DEFAULT_AGENT.systemPromptId, SP_DEFAULT_ID)
  assert.equal(DEFAULT_AGENT.systemPrompt, DEFAULT_SYSTEM_PROMPT_BODY)
  const entry = store.getSystemPrompt(SP_DEFAULT_ID)
  assert.equal(entry?.body, DEFAULT_AGENT.systemPrompt)
  assert.equal(entry?.targetFamily, 'claude')
})

test('store: list / get / create the library; unknown id resolves undefined', () => {
  assert.ok(store.listSystemPrompts().some((p) => p.id === SP_DEFAULT_ID))
  assert.equal(store.getSystemPrompt('no-such-prompt'), undefined)
  assert.equal(store.getSystemPrompt(), undefined)
  const added = store.createSystemPrompt({ label: 'New', body: 'hello', targetFamily: 'claude' })
  assert.ok(added.id.startsWith('sp-new-'))
  assert.equal(store.getSystemPrompt(added.id)?.label, 'New')
})

test('a seeded foreign-family prompt warns against the seeded provider (the D10 case)', () => {
  const open = store.getSystemPrompt('sp-open-generalist')
  assert.ok(open, 'the open-weights prompt is seeded')
  // The account's provider is claude-family; the open prompt is the downgrade case.
  const provider = store.getProvider()
  assert.ok(promptFitWarning(open!, provider.modelFamily))
  // A claude-family library prompt against the same provider is clean.
  const dflt = store.getSystemPrompt(SP_DEFAULT_ID)!
  assert.equal(promptFitWarning(dflt, provider.modelFamily), null)
})

test('GET /system-prompts returns the library; an unknown id 404s with the envelope', async () => {
  const list = await call('GET', '/system-prompts')
  assert.equal(list.status, 200)
  assert.ok(Array.isArray(list.json))
  assert.ok(list.json.some((p: any) => p.id === SP_DEFAULT_ID))

  const one = await call('GET', `/system-prompts/${SP_DEFAULT_ID}`)
  assert.equal(one.status, 200)
  assert.equal(one.json.id, SP_DEFAULT_ID)

  const missing = await call('GET', '/system-prompts/nope')
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not_found')
})
