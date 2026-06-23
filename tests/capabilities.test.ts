/** Unit tests for the agent runtime (server/agent-runtime.ts) — scope matching,
 *  grant enforcement (D3: the agent is the policy point), and mock fulfilment. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CapabilityError, isGranted, runCapability, scopeMatches } from '../server/agent-runtime.ts'
import type { Agent } from '../contract/index.ts'

const agent: Agent = {
  id: 'a1',
  label: 'L',
  host: 'h',
  status: 'online',
  lastSeen: 0,
  capabilities: [
    { type: 'fs.read', scopes: ['~/projects'] },
    { type: 'fs.write', scopes: ['~/projects/out'] },
    { type: 'terminal', scopes: ['*'] },
  ],
}

test('scopeMatches: wildcard, exact, and path-boundary semantics', () => {
  assert.equal(scopeMatches('*', '/anything'), true)
  assert.equal(scopeMatches('~/projects', '~/projects'), true) // exact
  assert.equal(scopeMatches('~/projects', '~/projects/app'), true) // under
  assert.equal(scopeMatches('~/projects', '~/projects-secret'), false) // not a boundary
  assert.equal(scopeMatches('~/projects', '~/other'), false)
})

test('isGranted reflects advertised capability + scope', () => {
  assert.equal(isGranted(agent, 'fs.read', '~/projects/app/main.ts'), true)
  assert.equal(isGranted(agent, 'fs.read', '/etc/passwd'), false)
  assert.equal(isGranted(agent, 'process', '~/projects'), false) // not advertised
})

test('runCapability fulfils fs.read within scope', () => {
  const r = runCapability(agent, { capability: 'fs.read', target: '~/projects/app/main.ts' })
  assert.equal(r.agentId, 'a1')
  assert.equal(r.capability, 'fs.read')
  assert.equal(r.target, '~/projects/app/main.ts')
  assert.match((r.output as { content: string }).content, /mock contents of/)
})

test('runCapability fulfils fs.write and reports bytes written', () => {
  const r = runCapability(agent, {
    capability: 'fs.write',
    target: '~/projects/out/log.txt',
    args: { content: 'hello' },
  })
  assert.deepEqual(r.output, { written: true, bytes: 5, target: '~/projects/out/log.txt' })
})

test('runCapability fulfils terminal under a wildcard grant', () => {
  const r = runCapability(agent, { capability: 'terminal', target: 'npm test' })
  assert.equal((r.output as { exitCode: number }).exitCode, 0)
})

test('runCapability throws forbidden when the target is outside the grant', () => {
  assert.throws(
    () => runCapability(agent, { capability: 'fs.read', target: '/etc/passwd' }),
    (err: unknown) => err instanceof CapabilityError && err.code === 'forbidden',
  )
})

test('runCapability throws capability_unavailable for an unadvertised capability', () => {
  assert.throws(
    () => runCapability(agent, { capability: 'process', target: '~/projects' }),
    (err: unknown) => err instanceof CapabilityError && err.code === 'capability_unavailable',
  )
})

test('fs.write outside its narrower grant is forbidden even though fs.read covers it', () => {
  // fs.write is granted only ~/projects/out, not all of ~/projects.
  assert.throws(
    () => runCapability(agent, { capability: 'fs.write', target: '~/projects/app/x', args: {} }),
    (err: unknown) => err instanceof CapabilityError && err.code === 'forbidden',
  )
})
