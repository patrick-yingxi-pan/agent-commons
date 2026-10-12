import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'

const peer = fileURLToPath(new URL('./routineMcpLocalSmokePeer.mjs', import.meta.url))

function fixture(mode = 'normal') {
  const directory = mkdtempSync(join(tmpdir(), 'ac-routine-peer-'))
  const tracePath = join(directory, 'trace.jsonl')
  const controlPath = join(directory, 'control.json')
  writeFileSync(controlPath, JSON.stringify({ mode }), { mode: 0o600 })
  return { directory, tracePath, controlPath }
}

function line(child: ReturnType<typeof spawn>): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => settle(new Error('peer response timed out')), 5_000)
    let buffered = ''
    const onData = (chunk: string) => {
      buffered += chunk
      const end = buffered.indexOf('\n')
      if (end < 0) return
      try { settle(undefined, JSON.parse(buffered.slice(0, end))) }
      catch (error) { settle(error as Error) }
    }
    const onError = (error: Error) => settle(error)
    const onClose = (code: number | null, signal: NodeJS.Signals | null) =>
      settle(new Error(`peer closed before response (code ${code}, signal ${signal})`))
    function settle(error?: Error, value?: Record<string, any>) {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.off('error', onError)
      child.off('close', onClose)
      if (error) reject(error)
      else resolve(value!)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', onData)
    child.once('error', onError)
    child.once('close', onClose)
  })
}

function ownChild(t: TestContext, child: ReturnType<typeof spawn>, directory: string) {
  let closed = false
  const closePromise = new Promise<number | null>(resolve => child.once('close', code => {
    closed = true
    resolve(code)
  }))
  t.after(async () => {
    if (!closed && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (!closed) await closePromise
    rmSync(directory, { recursive: true, force: true })
  })
  return closePromise
}

function send(child: ReturnType<typeof spawn>, method: string, id: number, params?: unknown) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`)
}

async function waitForTrace(path: string, method: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const rows = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(row => JSON.parse(row))
      if (rows.some(row => row.method === method)) return rows
    } catch { /* process may not have created the trace yet */ }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`peer did not trace ${method} within the bound`)
}

test('Routine local peer completes discovery, tool listing and its one exact fixture call', { timeout: 15_000 }, async t => {
  const { directory, tracePath, controlPath } = fixture()
  const child = spawn(process.execPath, [peer, tracePath, controlPath], { stdio: ['pipe', 'pipe', 'pipe'] })
  const closePromise = ownChild(t, child, directory)
  const discovery = line(child)
  send(child, 'server/discover', 1)
  assert.equal((await discovery).result.resultType, 'complete')
  const listing = line(child)
  send(child, 'tools/list', 2)
  const listed = (await listing).result.tools[0]
  assert.equal(listed.name, 'records.search')
  assert.deepEqual(listed.inputSchema.required, ['query'])
  assert.equal(listed.inputSchema.additionalProperties, false)
  const firstCall = line(child)
  send(child, 'tools/call', 3, { name: 'records.search', arguments: { query: 'routine-native-smoke' } })
  assert.deepEqual((await firstCall).result.content, [{ type: 'text', text: 'Local fixture result for: routine-native-smoke' }])
  const duplicateCall = line(child)
  send(child, 'tools/call', 4, { name: 'records.search', arguments: { query: 'routine-native-smoke' } })
  assert.equal((await duplicateCall).result.isError, true, 'a second success is forbidden in one process')
  child.stdin.end()
  const exitCode = await closePromise
  assert.equal(exitCode, 0, `peer exited ${exitCode}`)
  const rows = readFileSync(tracePath, 'utf8').trim().split('\n').map(row => JSON.parse(row))
  assert.deepEqual(rows[0].kind, 'process-start')
  assert.equal(rows[0].pid, child.pid)
  assert.equal(rows[0].mode, 'normal')
  assert.ok(Array.isArray(rows[0].environmentKeys))
  assert.deepEqual(rows.filter(row => row.kind === 'request').map(row => row.method),
    ['server/discover', 'tools/list', 'tools/call', 'tools/call'])
})

for (const [mode, method] of [['hold-startup', 'server/discover'], ['hold-call', 'tools/call']]) {
  test(`Routine local peer ${mode} traces and withholds ${method}`, { timeout: 15_000 }, async t => {
    const { directory, tracePath, controlPath } = fixture(mode)
    const child = spawn(process.execPath, [peer, tracePath, controlPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    const closePromise = ownChild(t, child, directory)
    let response = false
    const collectOutput = (chunk: string) => { if (chunk.includes('"id":11')) response = true }
    child.stdout.setEncoding('utf8').on('data', collectOutput)
    send(child, method, 11, method === 'tools/call'
      ? { name: 'records.search', arguments: { query: 'routine-native-smoke' } } : undefined)
    const rows = await waitForTrace(tracePath, method)
    assert.equal(rows[0].mode, mode)
    assert.ok(rows.some(row => row.kind === 'request' && row.method === method && row.id === 11))
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(response, false)
    child.kill('SIGKILL')
    await closePromise
  })
}

test('Routine local peer rejects invalid argv and unknown modes', t => {
  const { directory, tracePath: trace, controlPath: control } = fixture('unknown')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const args of [[], [trace], [trace, 'relative-control.json']]) {
    const child = spawnSync(process.execPath, [peer, ...args], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(child.status, 64)
  }
  const child = spawnSync(process.execPath, [peer, trace, control], { encoding: 'utf8', timeout: 5_000 })
  assert.equal(child.status, 64)
})
