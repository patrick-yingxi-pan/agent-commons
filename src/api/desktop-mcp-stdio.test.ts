import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desktopMcpStdioApi, desktopMcpStdioAvailable } from './desktopMcpStdio.ts'
import type { DesktopBridgeScope } from './desktopCredentials.ts'
const response = { flowId: 'flow-fixture', connectionId: 'connection-fixture', revision: 0, status: 'ready' as const }
const request = { connectionId: 'connection-fixture', expectedRevision: 0, source: { tenantId: 'tenant', userId: 'person' }, launch: { executable: '/fixture/node', args: ['literal'], cwd: '/fixture', env: { TOKEN: 'fixture-secret' } } }
function fixture(result: unknown = response) {
  const calls: unknown[] = []
  const invoke = async (request: unknown) => { calls.push(request); return result as typeof response }
  const scope: DesktopBridgeScope = { agentCommonsDesktop: { mcpStdio: { start: invoke, authorize: invoke, reconcile: invoke, cancel: invoke } } }
  return { scope, calls, api: desktopMcpStdioApi(scope) }
}
test('stdio bridge requires all native methods and carries launch data only through start', async () => {
  assert.equal(desktopMcpStdioAvailable({}), false)
  const f = fixture(); assert.equal(desktopMcpStdioAvailable(f.scope), true)
  assert.deepEqual(await f.api.start(request), response)
  await f.api.authorize({ flowId: response.flowId }); await f.api.reconcile({ flowId: response.flowId }); await f.api.cancel({ flowId: response.flowId })
  assert.equal(f.calls[0], request)
  assert.deepEqual(f.calls.slice(1), Array(3).fill({ flowId: response.flowId }))
  await assert.rejects(desktopMcpStdioApi({}).start(request), /unavailable/)
})
test('stdio bridge refuses extra native material and accessors without reflecting private diagnostics', async () => {
  let accessed = 0
  const accessor = { ...response, get status() { accessed++; return 'ready' } }
  for (const result of [{ ...response, launch: request.launch }, { ...response, revision: -1 }, accessor, { ...response, status: 'surprise' }]) {
    await assert.rejects(fixture(result).api.start(request), error => { assert.doesNotMatch(String(error), /fixture-secret|surprise/); return true })
  }
  assert.equal(accessed, 0)
  const f = fixture()
  f.scope.agentCommonsDesktop!.mcpStdio!.start = async () => { throw Object.assign(new Error('fixture-secret'), { code: 'stale' }) }
  await assert.rejects(f.api.start(request), error => { assert.equal((error as { code: string }).code, 'stale'); assert.doesNotMatch(String(error), /fixture-secret/); return true })
})
