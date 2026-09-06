import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  bindDesktopCredential,
  desktopCredentialsAvailable,
  discardDesktopCredential,
  provisionDesktopCredential,
  removeDesktopProviderCredentials,
  type DesktopCredentialBridge,
} from './desktopCredentials.ts'

function fixture() {
  const calls: unknown[][] = []
  const agentCommonsDesktop: DesktopCredentialBridge = {
    credentials: {
      async provision(secret) { calls.push(['provision', secret]); return `PROVIDER_DESKTOP_${'A'.repeat(32)}` },
      async bind(reference, providerId) { calls.push(['bind', reference, providerId]) },
      async discard(reference) { calls.push(['discard', reference]) },
      async removeProvider(providerId) { calls.push(['removeProvider', providerId]) },
    },
  }
  return { scope: { agentCommonsDesktop }, calls }
}

test('the desktop adapter exposes write lifecycle verbs but no secret read/list surface', async () => {
  const { scope, calls } = fixture()
  assert.equal(desktopCredentialsAvailable(scope), true)
  const reference = await provisionDesktopCredential('raw-key', scope)
  await bindDesktopCredential(reference, 'provider-4', scope)
  await discardDesktopCredential(reference, scope)
  await removeDesktopProviderCredentials('provider-4', scope)
  assert.deepEqual(calls, [
    ['provision', 'raw-key'],
    ['bind', reference, 'provider-4'],
    ['discard', reference],
    ['removeProvider', 'provider-4'],
  ])
  assert.deepEqual(Object.keys(scope.agentCommonsDesktop.credentials!).sort(), ['bind', 'discard', 'provision', 'removeProvider'])
})

test('web mode keeps the environment-reference path and cleanup is a safe no-op', async () => {
  const scope = {}
  assert.equal(desktopCredentialsAvailable(scope), false)
  await assert.rejects(() => provisionDesktopCredential('raw-key', scope), /unavailable/)
  await discardDesktopCredential(`PROVIDER_DESKTOP_${'B'.repeat(32)}`, scope)
  await removeDesktopProviderCredentials('provider-8', scope)
})

test('the provider dialog switches only credential entry—not the provider HTTP contract', () => {
  const source = readFileSync(new URL('../components/SectionView.tsx', import.meta.url), 'utf8')
  const commands = readFileSync(new URL('./commands.ts', import.meta.url), 'utf8')
  const creationCommands = readFileSync(new URL('./providerCreationCommands.ts', import.meta.url), 'utf8')
  const creationRuntime = readFileSync(new URL('../controller/providerCreationMutationRuntime.ts', import.meta.url), 'utf8')
  const start = source.indexOf('function ProviderDialog(')
  const end = source.indexOf('/** System prompts', start)
  const dialog = source.slice(start, end)
  assert.match(dialog, /desktopCredentialsAvailable\(\)/)
  assert.match(dialog, /type="password"/)
  assert.match(dialog, /enqueueProviderCreation/)
  assert.match(dialog, /deviceSecret: apiKey\.trim\(\)/, 'the raw key enters only the process-local ceremony')
  assert.doesNotMatch(dialog, /provisionDesktopCredential/, 'the form cannot own provisional-key cleanup')
  assert.match(dialog, /config:\s*\{[^]*apiKeyEnv:/)
  assert.match(dialog, /Credential variable/)
  assert.doesNotMatch(dialog, /config:\s*\{[^]*apiKey:/, 'raw keys never enter the provider HTTP request')
  assert.match(creationRuntime, /prepareProviderCreationCredential\(intent, credentials\)[^]*applyProviderCreation/)
  assert.match(creationCommands, /apiKeyEnv: intent\.credentialReference/)
  assert.doesNotMatch(creationCommands, /deviceSecret/, 'the HTTP command can materialize only a vault reference')
  assert.match(source, /label="Add configured provider"/, 'an unconfigured built-in has a direct path into the usable flow')
  assert.match(source, /function ProviderConnectionDialog\(/)
  assert.match(source, /label="Update connection"/)
  assert.match(source, /placeholder="Paste replacement API key"/)
  assert.match(source, /enqueueProviderConnection\(/, 'replacement enters the shell-owned acknowledgement sequence')
  assert.match(source, /createProviderConnectionAttempt\(/, 'one dialog lifetime owns one retryable logical replacement')
  assert.match(source, /provider\.connectionRevision \?\? 0/, 'the dialog pins the public connection revision it reviewed')
  const connectionCommand = commands.slice(
    commands.indexOf('export async function updateProviderConnection'),
    commands.indexOf('/** Patch a provider', commands.indexOf('export async function updateProviderConnection')),
  )
  assert.match(connectionCommand, /idempotencyKey: string/)
  assert.match(connectionCommand, /apiPatch<ModelProvider>\([^]*\{ idempotencyKey \}\)/)
})
