import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpCredentialLifecycle } from './mcpCredentialLifecycle.mjs'

const binding = (id: string) => ({ tenantId: 'tenant-owner', connectionId: `mcp-connection-${id}`, endpoint: `https://${id.toLowerCase()}.example.test/mcp` })
const ref = (letter: string) => `MCP_DESKTOP_${letter.repeat(32)}`
const entry = (letter: string) => ({ reference: ref(letter), binding: binding(letter) })
function fakeVault() {
  const reconciled: unknown[] = []
  const discarded: unknown[] = []
  const failures = new Set<string>()
  return { reconciled, discarded, failures,
    provision: async () => ref('C'),
    reconcile: async (bindings: unknown) => { reconciled.push(bindings) },
    discard: async (reference: string, expected: unknown) => {
      discarded.push({ reference, binding: expected })
      if (failures.has(reference)) throw new Error('disk failed')
    },
  }
}

test('startup reconciles once; later snapshots preserve unrelated provisional credentials', async () => {
  const vault = fakeVault()
  const lifecycle = createMcpCredentialLifecycle(vault)
  assert.equal(await lifecycle.synchronize([entry('A')]), true)
  await lifecycle.provision(binding('C'), 'secret')
  assert.equal(await lifecycle.synchronize([entry('A'), entry('B')]), true)
  assert.deepEqual(vault.discarded, [])
  assert.deepEqual(vault.reconciled, [[entry('A')]])
  assert.equal(await lifecycle.synchronize([entry('B')]), true)
  assert.deepEqual(vault.discarded, [entry('A')])
})

test('failed retirement retries exact references and a newer reintroduction cancels pending cleanup', async () => {
  const vault = fakeVault()
  const lifecycle = createMcpCredentialLifecycle(vault)
  await lifecycle.synchronize([entry('A'), entry('B')])
  vault.failures.add(ref('A'))
  assert.equal(await lifecycle.synchronize([entry('B')]), false)
  assert.equal(await lifecycle.synchronize([entry('B')]), false)
  assert.deepEqual(vault.discarded, [entry('A'), entry('A')])
  assert.equal(await lifecycle.synchronize([entry('A'), entry('B')]), true)
  assert.deepEqual(vault.discarded, [entry('A'), entry('A')])
  vault.failures.clear()
  assert.equal(await lifecycle.synchronize([]), true)
  assert.deepEqual(vault.discarded.slice(2), [entry('A'), entry('B')])
})

test('late disk completion cannot reorder newer snapshots or provisional publication', async () => {
  const vault = fakeVault()
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  vault.reconcile = async bindings => { vault.reconciled.push(bindings); entered(); await held }
  const lifecycle = createMcpCredentialLifecycle(vault)
  const first = lifecycle.synchronize([entry('A')])
  await started
  let secondDone = false
  const second = lifecycle.synchronize([entry('B')]).then(() => { secondDone = true })
  let provisioned = false
  const provision = lifecycle.provision(binding('C'), 'secret').then(() => { provisioned = true })
  await Promise.resolve()
  assert.equal(secondDone, false)
  assert.equal(provisioned, false)
  assert.deepEqual(vault.discarded, [])
  release()
  await Promise.all([first, second, provision])
  assert.deepEqual(vault.discarded, [entry('A')])
  await lifecycle.synchronize([entry('B'), entry('C')])
  await lifecycle.synchronize([entry('B')])
  assert.deepEqual(vault.discarded, [entry('A'), entry('C')])
})

test('first sync preserves provisional keys and snapshots detach caller input before enqueue', async () => {
  const vault = fakeVault()
  const lifecycle = createMcpCredentialLifecycle(vault)
  await lifecycle.provision(binding('C'), 'secret')
  const input = [entry('A')]
  const sync = lifecycle.synchronize(input)
  input[0].binding.endpoint = 'https://changed.example.test/'
  await sync
  assert.deepEqual(vault.reconciled, [[entry('A'), entry('C')]])
  await assert.rejects(lifecycle.synchronize([entry('A'), entry('A')]), /invalid/)
  assert.equal(vault.reconciled.length, 1)
})
