import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('the shared composer stays provider-neutral without changing its stable accessible name', () => {
  const composer = source('./Composer.tsx')
  assert.ok(composer.includes('aria-label="Message"'))
  assert.ok(composer.includes("disabledLabel ?? 'Generating a reply…'"))
  assert.ok(composer.includes(": 'Message…'"))
  assert.doesNotMatch(composer, /Reply to Claude|Claude is answering/)
  const controls = source('./TurnControls.tsx')
  assert.ok(controls.includes("streaming ? 'Generating a reply…'"))
  assert.doesNotMatch(controls, /Claude is writing/)
})

test('ordinary conversation turns separate recorded model provenance from Agent authorship', () => {
  const message = source('./Message.tsx')
  assert.ok(message.includes('const providers = useProviders()'))
  assert.ok(message.includes("turnProvenance(message, providers.data, providers.status === 'error')"))
  assert.ok(message.includes('driverByline(message.agentId, useAgents().data ?? [])'))
  assert.ok(message.includes('data-turn-author'))
  assert.ok(message.includes('data-turn-model'))
  assert.ok(message.includes('[overflow-wrap:anywhere]'))
  assert.equal((message.match(/<AssistantAvatar\s*\/>/g) ?? []).length, 2,
    'recorded and in-flight replies reuse one provider-neutral avatar')
  assert.doesNotMatch(message, /ClaudeMark|function useIsRelayed|agents\.find/,
    'neither a vendor glyph nor today’s Agent binding can impersonate historical model provenance')
  const embedded = source('./SectionView.tsx')
  assert.ok(embedded.includes("t.role === 'user' ? 'You' : 'Assistant'"),
    'role-only conversation excerpts do not invent a vendor identity')
})
