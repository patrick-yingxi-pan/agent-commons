import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION } from './mcpProtocol.ts'
import { createMcpStdioClient, McpStdioClientError } from './mcpStdioClient.ts'

type Reply = Record<string, unknown>
type RequestRecord = { method: string; params: Record<string, unknown>; options: Record<string, unknown> }
type Plan = (method: string, params: Record<string, unknown>, options: Record<string, unknown>) => Promise<Reply> | Reply

const rpc = (result: unknown): Reply => ({ jsonrpc: '2.0', id: 91, result })
const rpcError = (code: number, message = 'fixture error', data?: unknown): Reply => ({
  jsonrpc: '2.0', id: 91, error: { code, message, ...(data === undefined ? {} : { data }) },
})
const modern = (): Reply => rpc({
  resultType: 'complete',
  supportedVersions: [MCP_MODERN_VERSION],
  capabilities: { tools: {} },
  _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'fixture-modern', version: '1' } },
})
const legacy = (version: string = MCP_LEGACY_VERSIONS[0]): Reply => rpc({
  protocolVersion: version,
  serverInfo: { name: 'fixture-legacy', version: '1' },
  capabilities: { tools: {} },
})
const page = (tools: unknown[], nextCursor?: string): Reply => rpc({ resultType: 'complete', tools, ...(nextCursor === undefined ? {} : { nextCursor }) })
const legacyPage = (tools: unknown[]): Reply => rpc({ tools })
const tool = (name: string, extra: Record<string, unknown> = {}) => ({ name, inputSchema: { type: 'object', properties: {} }, ...extra })
const invocation = () => ({ tool: tool('echo') as { name: string; inputSchema: Record<string, unknown> }, arguments: { text: 'hello' } })
const completeResult = { resultType: 'complete', content: [{ type: 'text', text: 'done' }], isError: false }
const formResult = {
  resultType: 'input_required',
  inputRequests: {
    profile: {
      method: 'elicitation/create',
      params: { mode: 'form', message: 'Confirm a profile field', requestedSchema: {
        type: 'object', properties: { displayName: { type: 'string' } },
      } },
    },
  },
}

function harness(plans: Plan[], options: { now?: () => number; close?: (index: number) => Promise<{ code: string }> } = {}) {
  const opened: Array<{ options: Record<string, unknown>; requests: RequestRecord[]; guards: unknown[]; dispatched: string[]; closeCount: number; initializedCount: number }> = []
  const client = createMcpStdioClient({
    open(openOptions: Record<string, unknown>) {
      const index = opened.length
      const state = { options: openOptions, requests: [] as RequestRecord[], guards: [] as unknown[], dispatched: [] as string[], closeCount: 0, initializedCount: 0 }
      opened.push(state)
      const plan = plans[index] ?? (() => { throw new Error(`unexpected extra process ${index}`) })
      const closed = Promise.resolve({ code: 'closed' })
      return {
        request(method: string, params: Record<string, unknown> = {}, requestOptions: Record<string, unknown> = {}) {
          state.requests.push({ method, params, options: requestOptions })
          const beforeDispatch = requestOptions.beforeDispatch
          if (typeof beforeDispatch === 'function') {
            const guard = beforeDispatch()
            state.guards.push(guard)
            if (guard !== true) return Promise.reject(Object.assign(new Error('fixture stale fence'), { code: 'stale', mayHaveSubmitted: false }))
          }
          state.dispatched.push(method)
          return Promise.resolve(plan(method, params, requestOptions))
        },
        initialized() { state.initializedCount += 1; return Promise.resolve() },
        async close() { state.closeCount += 1; return options.close ? options.close(index) : { code: 'closed' } },
        closed,
      }
    },
    ...(options.now ? { now: options.now } : {}),
  })
  const requestOptions = { isCurrent: () => true }
  return { client, opened, requestOptions }
}

function clientError(code: string, mayHaveExecuted?: boolean) {
  return (error: unknown) => {
    assert.ok(error instanceof McpStdioClientError)
    assert.equal(error.code, code)
    if (mayHaveExecuted !== undefined) assert.equal(error.mayHaveExecuted, mayHaveExecuted)
    assert.equal(error.message, `Local MCP operation failed (${code}).`)
    return true
  }
}

test('modern discovery pins metadata, paginates within one native process, and closes once', async () => {
  const h = harness([(method, params) => method === 'server/discover' ? modern()
    : params.cursor ? page([tool('second')]) : page([tool('first')], 'next')])

  const result = await h.client.discover(h.requestOptions)
  assert.equal(result.protocolVersion, MCP_MODERN_VERSION)
  assert.deepEqual(result.tools.map((entry: { name: string }) => entry.name), ['first', 'second'])
  assert.equal(result.serverInfo?.name, 'fixture-modern')
  assert.equal(h.opened.length, 1)
  assert.deepEqual(h.opened[0]?.requests.map(row => row.method), ['server/discover', 'tools/list', 'tools/list'])
  for (const row of h.opened[0]!.requests) {
    assert.equal(row.params._meta && (row.params._meta as Record<string, unknown>)['io.modelcontextprotocol/protocolVersion'], MCP_MODERN_VERSION)
    assert.deepEqual((row.params._meta as Record<string, any>)['io.modelcontextprotocol/clientCapabilities'], {})
  }
  assert.equal(h.opened[0]?.closeCount, 1)
  assert.equal(result.cleanup, 'released')
})

test('legacy fallback closes the failed probe before one fresh initialize and lists the latest version', async () => {
  const h = harness([
    () => rpcError(-32601, 'unknown method'),
    method => {
      if (method === 'initialize') return legacy()
      if (method === 'tools/list') return legacyPage([tool('legacy_tool')])
      throw new Error(`unexpected ${method}`)
    },
  ])
  const result = await h.client.discover(h.requestOptions)
  assert.equal(result.protocolVersion, MCP_LEGACY_VERSIONS[0])
  assert.deepEqual(result.tools.map((entry: { name: string }) => entry.name), ['legacy_tool'])
  assert.equal(h.opened.length, 2)
  assert.equal(h.opened[0]?.closeCount, 1)
  assert.deepEqual(h.opened[0]?.requests.map(row => row.method), ['server/discover'])
  assert.deepEqual(h.opened[1]?.requests.map(row => row.method), ['initialize', 'tools/list'])
  assert.equal(h.opened[1]?.initializedCount, 1)
  assert.equal(h.opened[1]?.requests[0]?.params.protocolVersion, MCP_LEGACY_VERSIONS[0])
})

test('recognized modern errors and unsupported modern versions never fall back; unconfirmed probe close refuses fallback', async () => {
  for (const reply of [rpcError(-32020), rpcError(-32021), rpcError(-32022)]) {
    const h = harness([() => reply])
    const expected = reply.error && (reply.error as Record<string, unknown>).code === -32022 ? 'unsupported_version' : 'protocol'
    await assert.rejects(h.client.discover(h.requestOptions), clientError(expected))
    assert.equal(h.opened.length, 1)
    assert.deepEqual(h.opened[0]?.requests.map(row => row.method), ['server/discover'])
  }
  const unsupported = harness([() => rpc({
    resultType: 'complete', supportedVersions: ['2099-01-01'], capabilities: { tools: {} },
  })])
  await assert.rejects(unsupported.client.discover(unsupported.requestOptions), clientError('unsupported_version'))
  assert.equal(unsupported.opened.length, 1)

  const missingModernType = harness([method => method === 'server/discover'
    ? rpc({ supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} } })
    : page([])])
  await assert.rejects(missingModernType.client.discover(missingModernType.requestOptions), clientError('protocol'))
  assert.equal(missingModernType.opened.length, 1)

  const missingPageType = harness([method => method === 'server/discover'
    ? modern()
    : rpc({ tools: [] })])
  await assert.rejects(missingPageType.client.discover(missingPageType.requestOptions), clientError('protocol'))
  assert.deepEqual(missingPageType.opened[0]?.requests.map(row => row.method), ['server/discover', 'tools/list'])

  const unconfirmed = harness([() => rpcError(-32602)], { close: async () => { throw new Error('unconfirmed close') } })
  await assert.rejects(unconfirmed.client.discover(unconfirmed.requestOptions), clientError('closed'))
  assert.equal(unconfirmed.opened.length, 1, 'fallback is refused unless probe process close is confirmed')
})

test('probe transport timeout or close may use one fresh legacy process, but an RPC result is never replayed', async () => {
  for (const failure of ['closed']) {
    const h = harness([
      () => { throw Object.assign(new Error('native failure'), { code: failure }) },
      method => method === 'initialize' ? legacy() : page([]),
    ])
    const result = await h.client.discover(h.requestOptions)
    assert.equal(result.protocolVersion, MCP_LEGACY_VERSIONS[0])
    assert.equal(h.opened.length, 2)
    assert.equal(h.opened[0]?.closeCount, 1)
    assert.equal(h.opened[1]?.initializedCount, 1)
  }

  let timeoutHarness: ReturnType<typeof harness>
  timeoutHarness = harness([() => new Promise((_resolve, reject) => {
    const signal = timeoutHarness.opened[0]?.options.signal as AbortSignal
    signal.addEventListener('abort', () => reject(Object.assign(new Error('probe deadline'), { code: 'cancelled' })), { once: true })
  }), method => method === 'initialize' ? legacy() : legacyPage([])])
  const timeoutFound = await timeoutHarness.client.discover({ ...timeoutHarness.requestOptions, probeTimeoutMs: 1 })
  assert.equal(timeoutFound.protocolVersion, MCP_LEGACY_VERSIONS[0])
  assert.equal(timeoutHarness.opened.length, 2)

  let calls = 0
  const h = harness([method => {
    if (method === 'server/discover') return modern()
    if (method === 'tools/call') { calls += 1; throw Object.assign(new Error('uncertain'), { code: 'io', mayHaveSubmitted: true }) }
    throw new Error(`unexpected ${method}`)
  }])
  await assert.rejects(h.client.callTool(invocation(), h.requestOptions), clientError('io', true))
  assert.equal(calls, 1)
  assert.equal(h.opened.length, 1)
  assert.deepEqual(h.opened[0]?.requests.map(row => row.method), ['server/discover', 'tools/call'])
})

test('calls snapshot intent before negotiation and require an exact synchronous final authority fence', async () => {
  let allowed = true
  let preflight = 0
  const h = harness([method => method === 'server/discover' ? modern() : rpc(completeResult)])
  const intent = invocation()
  const pending = h.client.callTool(intent, {
    isCurrent: () => true,
    beforeCall: () => { preflight += 1; return true },
  })
  intent.arguments.text = 'mutated after call'
  const result = await pending
  assert.deepEqual(result.result, completeResult)
  const call = h.opened[0]?.requests.find(row => row.method === 'tools/call')
  assert.ok(call)
  assert.equal((call.params.arguments as Record<string, unknown>).text, 'hello')
  const beforeDispatch = call.options.beforeDispatch
  assert.equal(typeof beforeDispatch, 'function')
  assert.equal(preflight, 2)
  assert.deepEqual(h.opened[0]?.guards, [true])

  const stale = harness([method => method === 'server/discover' ? modern() : rpc(completeResult)])
  await assert.rejects(stale.client.callTool(invocation(), {
    isCurrent: () => true,
    beforeCall: () => { allowed = false; return allowed },
  }), clientError('stale', false))
  assert.deepEqual(stale.opened[0]?.requests.map(row => row.method), ['server/discover'])

  let checks = 0
  const thenable = harness([method => method === 'server/discover' ? modern() : rpc(completeResult)])
  await assert.rejects(thenable.client.callTool(invocation(), {
    isCurrent: () => true,
    beforeCall: (() => { checks += 1; return Promise.resolve(true) }) as unknown as () => boolean,
  }), clientError('stale', false))
  assert.equal(checks, 2, 'resolved async preflight is not accepted as the synchronous at-write fence')
  assert.deepEqual(thenable.opened[0]?.dispatched, ['server/discover'])
  assert.deepEqual(thenable.opened[0]?.guards.map(value => value === true), [false])
})

test('form capability is opt-in and legacy refuses form calls without continuing or falling back', async () => {
  const ordinary = harness([method => method === 'server/discover' ? modern() : rpc(completeResult)])
  await ordinary.client.callTool(invocation(), ordinary.requestOptions)
  const ordinaryCall = ordinary.opened[0]?.requests.find(row => row.method === 'tools/call')
  assert.deepEqual((ordinaryCall?.params._meta as Record<string, unknown>)['io.modelcontextprotocol/clientCapabilities'], {})

  const forms = harness([method => method === 'server/discover' ? modern() : rpc(formResult)])
  assert.deepEqual((await forms.client.callToolWithForms(invocation(), forms.requestOptions)).result, formResult)
  const formCall = forms.opened[0]?.requests.find(row => row.method === 'tools/call')
  assert.deepEqual((formCall?.params._meta as Record<string, any>)['io.modelcontextprotocol/clientCapabilities'], { elicitation: { form: {} } })

  const legacyForms = harness([() => rpcError(-32601)])
  await assert.rejects(legacyForms.client.callToolWithForms(invocation(), legacyForms.requestOptions), clientError('unsupported_version', false))
  assert.equal(legacyForms.opened.length, 1)
  assert.deepEqual(legacyForms.opened[0]?.requests.map(row => row.method), ['server/discover'])
})

test('catalog duplicate names, cursors, page and aggregate caps fail closed', async () => {
  const duplicate = harness([(method, params) => method === 'server/discover' ? modern()
    : params.cursor ? page([tool('same')]) : page([tool('same')], 'p')])
  await assert.rejects(duplicate.client.discover(duplicate.requestOptions), clientError('catalog'))
  assert.equal(duplicate.opened[0]?.requests.filter(row => row.method === 'tools/list').length, 2)

  const cursor = harness([method => method === 'server/discover' ? modern() : page([], 'loop')])
  await assert.rejects(cursor.client.discover(cursor.requestOptions), clientError('catalog'))

  const tooMany = harness([(method, params) => method === 'server/discover' ? modern()
    : params.cursor ? page([tool('overflow')]) : page(Array.from({ length: 128 }, (_, i) => tool(`tool_${i}`)), 'more')])
  await assert.rejects(tooMany.client.discover(tooMany.requestOptions), clientError('catalog'))

  const largePage = (prefix: string) => Array.from({ length: 40 }, (_, i) => tool(`${prefix}_${i}`, { description: 'd'.repeat(7_000) }))
  const aggregate = harness([(method, params) => method === 'server/discover' ? modern()
    : params.cursor ? page(largePage('b')) : page(largePage('a'), 'more')])
  await assert.rejects(aggregate.client.discover(aggregate.requestOptions), clientError('catalog'))

  let pageCalls = 0
  const pageLimit = harness([method => {
    if (method === 'server/discover') return modern()
    pageCalls += 1
    return page([], `cursor_${pageCalls}`)
  }])
  await assert.rejects(pageLimit.client.discover(pageLimit.requestOptions), clientError('catalog'))
  assert.equal(pageCalls, 8)
})

test('invalid requests, RPC errors, unsupported call versions and malformed results remain distinct', async () => {
  const invalid = harness([])
  let getterCalls = 0
  const getterArguments = Object.defineProperty({}, 'secret', { enumerable: true, get() { getterCalls += 1; return 'private' } })
  await assert.rejects(invalid.client.callTool({ ...invocation(), arguments: getterArguments }, invalid.requestOptions), clientError('request', false))
  assert.equal(getterCalls, 0)
  assert.equal(invalid.opened.length, 0)

  const rpcFailure = harness([method => method === 'server/discover' ? modern() : rpcError(-32000)])
  await assert.rejects(rpcFailure.client.callTool(invocation(), rpcFailure.requestOptions), clientError('rpc_error', true))

  const badResult = harness([method => method === 'server/discover' ? modern() : rpc({ resultType: 'unexpected' })])
  await assert.rejects(badResult.client.callTool(invocation(), badResult.requestOptions), clientError('result', true))

  const pinned = harness([method => method === 'server/discover' ? modern() : rpc(completeResult)])
  await assert.rejects(pinned.client.callTool(invocation(), {
    ...pinned.requestOptions,
    expectedProtocolVersion: MCP_LEGACY_VERSIONS[0],
  }), clientError('unsupported_version', false))
  assert.deepEqual(pinned.opened[0]?.requests.map(row => row.method), ['server/discover'])

  const invalidDeadline = harness([])
  await assert.rejects(invalidDeadline.client.discover({ isCurrent: () => true, timeoutMs: 60_001 }), clientError('request'))
  assert.equal(invalidDeadline.opened.length, 0)

  const noTools = harness([() => rpc({ resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: {} })])
  await assert.rejects(noTools.client.discover(noTools.requestOptions), clientError('tools_unavailable'))
  assert.equal(noTools.opened.length, 1)

  const badInfo = harness([() => rpc({
    resultType: 'complete', supportedVersions: [MCP_MODERN_VERSION], capabilities: { tools: {} },
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: '', version: '1' } },
  })])
  await assert.rejects(badInfo.client.discover(badInfo.requestOptions), clientError('protocol'))

  const inputDuringList = harness([method => method === 'server/discover' ? modern() : rpc({ resultType: 'input_required', inputRequests: {} })])
  await assert.rejects(inputDuringList.client.discover(inputDuringList.requestOptions), clientError('input_required'))
  assert.deepEqual(inputDuringList.opened[0]?.requests.map(row => row.method), ['server/discover', 'tools/list'])
})

test('current-source changes, external cancellation, and total deadlines fence work without replay', async () => {
  const stale = harness([])
  await assert.rejects(stale.client.discover({ isCurrent: () => false }), clientError('stale'))
  assert.equal(stale.opened.length, 0)

  const cancelledBeforeOpen = harness([])
  await assert.rejects(cancelledBeforeOpen.client.discover({ isCurrent: () => true, signal: AbortSignal.abort() }), clientError('cancelled'))
  assert.equal(cancelledBeforeOpen.opened.length, 0)

  let changeCurrent = true
  let finishProbe!: (value: Reply) => void
  const staleAfterProbe = harness([() => new Promise<Reply>(resolve => { finishProbe = resolve })])
  const staleRun = staleAfterProbe.client.discover({ isCurrent: () => changeCurrent })
  await new Promise(resolve => setImmediate(resolve))
  changeCurrent = false
  finishProbe(modern())
  await assert.rejects(staleRun, clientError('stale'))
  assert.deepEqual(staleAfterProbe.opened[0]?.dispatched, ['server/discover'])

  let changedAfterDiscovery = true
  const callStaleAfterNegotiation = harness([method => {
    if (method === 'server/discover') { changedAfterDiscovery = false; return modern() }
    return rpc(completeResult)
  }])
  await assert.rejects(callStaleAfterNegotiation.client.callTool(invocation(), { isCurrent: () => changedAfterDiscovery }), clientError('stale', false))
  assert.deepEqual(callStaleAfterNegotiation.opened[0]?.requests.map(row => row.method), ['server/discover'])

  const abort = new AbortController()
  const cancelled = harness([(method, _params, options) => method === 'server/discover' ? modern() : new Promise<Reply>((_resolve, reject) => {
    const signal = options.signal as AbortSignal
    signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled', mayHaveSubmitted: true })), { once: true })
  })])
  const cancelledRun = cancelled.client.callTool(invocation(), { ...cancelled.requestOptions, signal: abort.signal })
  await new Promise(resolve => setImmediate(resolve))
  abort.abort()
  await assert.rejects(cancelledRun, clientError('cancelled', true))
  assert.equal(cancelled.opened[0]?.requests.filter(row => row.method === 'tools/call').length, 1)
  assert.equal(cancelled.opened.length, 1)

  const timedOut = harness([(_method, _params, options) => new Promise<Reply>((_resolve, reject) => {
    const signal = options.signal as AbortSignal
    signal.addEventListener('abort', () => reject(Object.assign(new Error('deadline'), { code: 'cancelled' })), { once: true })
  })])
  await assert.rejects(timedOut.client.discover({ ...timedOut.requestOptions, timeoutMs: 5 }), clientError('timeout'))
  assert.equal(timedOut.opened.length, 1, 'total deadline does not start a fallback process')

  let clock = 0
  const noReset = harness([method => {
    if (method === 'server/discover') { clock = 100; return modern() }
    return page([])
  }], { now: () => clock })
  await assert.rejects(noReset.client.discover({ ...noReset.requestOptions, timeoutMs: 100 }), clientError('timeout'))
  assert.deepEqual(noReset.opened[0]?.requests.map(row => row.method), ['server/discover'])

  let fallbackClock = 0
  const noLegacyReset = harness([() => { fallbackClock = 100; return rpcError(-32601) }, method => method === 'initialize' ? legacy() : legacyPage([])], {
    now: () => fallbackClock,
  })
  await assert.rejects(noLegacyReset.client.discover({ ...noLegacyReset.requestOptions, timeoutMs: 100 }), clientError('timeout'))
  assert.equal(noLegacyReset.opened.length, 1, 'fallback cannot renew the original transaction budget')

  const hangingGuard = harness([method => method === 'server/discover' ? modern() : rpc(completeResult)])
  const guardAbort = new AbortController()
  const guardCall = hangingGuard.client.callTool(invocation(), {
    ...hangingGuard.requestOptions,
    signal: guardAbort.signal,
    beforeCall: (() => new Promise<boolean>(() => {})) as unknown as () => boolean,
  })
  await new Promise(resolve => setImmediate(resolve))
  guardAbort.abort()
  await assert.rejects(guardCall, clientError('cancelled', false))
  assert.deepEqual(hangingGuard.opened[0]?.requests.map(row => row.method), ['server/discover'])
})

test('cleanup failure is visible for discovery but never erases a completed tool result', async () => {
  const discovery = harness([method => method === 'server/discover' ? modern() : page([tool('kept')])], {
    close: async () => { throw new Error('unconfirmed cleanup') },
  })
  const found = await discovery.client.discover(discovery.requestOptions)
  assert.equal(found.cleanup, 'unconfirmed')
  assert.deepEqual(found.tools.map((entry: { name: string }) => entry.name), ['kept'])

  const call = harness([method => method === 'server/discover' ? modern() : rpc(completeResult)], {
    close: async () => { throw new Error('unconfirmed cleanup') },
  })
  const result = await call.client.callTool(invocation(), call.requestOptions)
  assert.deepEqual(result.result, completeResult)
  assert.equal(result.cleanup, 'unconfirmed')

  const stuck = harness([method => method === 'server/discover' ? modern() : page([])], {
    close: () => new Promise(() => {}),
  })
  const started = Date.now()
  const stuckResult = await stuck.client.discover({ ...stuck.requestOptions, timeoutMs: 3_000 })
  assert.equal(stuckResult.cleanup, 'unconfirmed')
  assert.ok(Date.now() - started < 1_500, 'stuck cleanup is bounded to at most one second')

  let discoveryCurrent = true
  const readOnlyCurrent = harness([method => method === 'server/discover' ? modern() : page([])], {
    close: async () => { discoveryCurrent = false; return { code: 'closed' } },
  })
  await assert.rejects(readOnlyCurrent.client.discover({ isCurrent: () => discoveryCurrent }), clientError('stale'))

  const readAbort = new AbortController()
  const readOnlyCancelled = harness([method => method === 'server/discover' ? modern() : page([])], {
    close: async () => { readAbort.abort(); return { code: 'cancelled' } },
  })
  await assert.rejects(readOnlyCancelled.client.discover({ ...readOnlyCancelled.requestOptions, signal: readAbort.signal }), clientError('cancelled', false))

  const abortDuringCleanup = new AbortController()
  const completedDuringCleanup = harness([method => method === 'server/discover' ? modern() : rpc(completeResult)], {
    close: async () => { abortDuringCleanup.abort(); return { code: 'cancelled' } },
  })
  const completion = await completedDuringCleanup.client.callTool(invocation(), {
    ...completedDuringCleanup.requestOptions,
    signal: abortDuringCleanup.signal,
  })
  assert.deepEqual(completion.result, completeResult)
})
