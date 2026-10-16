/** Persistence locks for the provider-native assistant text item projection.
 * The visible prose remains Message.content; item metadata is strict, additive,
 * and retained exactly in both live and compacted Session history. */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonFileBackend, SqliteBackend } from './index.ts'
import { STORE_VERSION, type PersistedState } from './persist.ts'
import { hasCorePersistedShape } from './format.ts'

const ROOT = mkdtempSync(join(tmpdir(), `claude-ui-assistant-text-items-${process.pid}-`))
const DATA_FILE = join(ROOT, 'initial.json')
const previousDataFile = process.env.DATA_FILE

after(() => {
  if (previousDataFile === undefined) delete process.env.DATA_FILE
  else process.env.DATA_FILE = previousDataFile
  try { rmSync(ROOT, { recursive: true, force: true }) } catch { /* already gone */ }
})

function readBody(request: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('error', reject)
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(error) }
    })
  })
}

function respond(response: ServerResponse): void {
  const completed = {
    id: 'resp-history-restart', object: 'response', created_at: 1_800_000_000,
    status: 'completed', model: 'responses-history-fixture',
    output: [{ id: 'assistant-output', type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: 'Continued after restart.' }] }],
    usage: { input_tokens: 7, output_tokens: 4 },
  }
  const created = { type: 'response.created', response: {
    id: completed.id, object: 'response', status: 'in_progress', output: [], usage: null,
  } }
  const delta = { type: 'response.output_text.delta', item_id: 'assistant-output', output_index: 0,
    content_index: 0, delta: 'Continued after restart.' }
  const terminal = { type: 'response.completed', response: completed }
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([created, delta, terminal].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
}

function runFreshProcess(source: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = ''
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('close', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }) })
  })
}

function stateWith(messages: unknown[], compactedMessages: unknown[] = []): PersistedState {
  return {
    version: STORE_VERSION,
    sessions: [{ id: 'assistant-text-items', title: 'Text items', caps: ['chat'], preview: 'Text items', messages, compactedMessages }],
    bindings: [],
    workspaces: [],
    schedules: [],
    recents: { files: [], photos: [], folder: [], repo: [], connector: [], mcp: [] },
    graph: {
      sessionProject: {}, artifactProject: {}, scheduleProject: {}, projectContexts: {},
      artifactSource: {}, scheduleArtifact: {}, scheduleSession: {}, scheduleExtraTools: {},
      extraArtifacts: [], extraProjects: [], standingApprovals: {},
    },
    seq: { session: 1, message: 4, schedule: 0, run: 0, artifact: 0, provider: 0, systemPrompt: 0, agent: 0, commission: 0 },
  } as unknown as PersistedState
}

const assistant = (id: string, content: string, assistantTextItems?: unknown) => ({
  id, role: 'assistant', content,
  ...(assistantTextItems !== undefined ? { assistantTextItems } : {}),
})

const textItems = [
  { text: 'Thinking aloud. ', phase: 'commentary' },
  { text: 'The answer is 42.', phase: 'final_answer' },
  { text: ' Citation marker.', phase: null },
  { text: ' Legacy unphased item.' },
]

test('JSON and SQLite preserve assistant text items in active and compacted history, with legacy absence intact', () => {
  const state = stateWith([
    assistant('active-native', 'Thinking aloud. The answer is 42. Citation marker. Legacy unphased item.', textItems),
    { id: 'legacy-assistant', role: 'assistant', content: 'Old assistant prose.' },
    { id: 'legacy-user', role: 'user', content: 'Old user prose.' },
  ], [
    assistant('archived-original', 'Archived thought. Archived answer.', [
      { text: 'Archived thought. ', phase: 'commentary' },
      { text: 'Archived answer.', phase: 'final_answer' },
    ]),
    assistant('archived-summary', 'A synthetic summary without provider item metadata.'),
  ])
  assert.equal(hasCorePersistedShape(state), true, 'the complete fixture is admissible')

  const sqlite = new SqliteBackend(':memory:')
  try {
    sqlite.save(state)
    const loaded = sqlite.load()
    assert.deepEqual(loaded, JSON.parse(JSON.stringify(state)), 'SQLite keeps the JSON-canonical state exactly')
    assert.deepEqual(loaded?.sessions[0]?.messages?.[0]?.assistantTextItems, textItems)
    assert.equal(Object.hasOwn(loaded?.sessions[0]?.messages?.[1] ?? {}, 'assistantTextItems'), false,
      'legacy assistant rows retain the valid absent shape')
    assert.equal(Object.hasOwn(loaded?.sessions[0]?.messages?.[2] ?? {}, 'assistantTextItems'), false,
      'user rows without metadata remain unchanged')
    assert.deepEqual(loaded?.sessions[0]?.compactedMessages?.[0]?.assistantTextItems, [
      { text: 'Archived thought. ', phase: 'commentary' },
      { text: 'Archived answer.', phase: 'final_answer' },
    ], 'compacted originals retain their exact item ordering and phase values')
    assert.equal(Object.hasOwn(loaded?.sessions[0]?.compactedMessages?.[1] ?? {}, 'assistantTextItems'), false,
      'a generated synthetic summary remains ordinary unphased prose')
  } finally { sqlite.close() }

  process.env.DATA_FILE = DATA_FILE
  const json = new JsonFileBackend()
  json.save(state)
  const loaded = json.load()
  assert.deepEqual(loaded, JSON.parse(JSON.stringify(state)), 'JSON keeps the same canonical state as SQLite')
  assert.deepEqual(loaded?.sessions[0]?.messages?.[0]?.assistantTextItems, textItems)
  assert.deepEqual(loaded?.sessions[0]?.compactedMessages?.[0]?.assistantTextItems,
    state.sessions[0]?.compactedMessages?.[0]?.assistantTextItems)
})

test('JSON and SQLite restart history restores ordered native Responses assistant items', async () => {
  const visibleText = 'Commentary before. Final answer. Unphased null. Unphased absent.'
  const items = [
    { text: 'Commentary before. ', phase: 'commentary' },
    { text: 'Final answer.', phase: 'final_answer' },
    { text: ' Unphased null.', phase: null },
    { text: ' Unphased absent.' },
  ]
  const state = stateWith([assistant('restart-assistant', visibleText, items)])
  const ports: any[] = []
  let peer: Server
  peer = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST')
      assert.equal(new URL(request.url ?? '/', 'http://127.0.0.1').pathname, '/v1/responses')
      ports.push(await readBody(request))
      respond(response)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })
  await new Promise<void>((resolve, reject) => {
    peer.once('error', reject)
    peer.listen(0, '127.0.0.1', resolve)
  })
  const address = peer.address()
  assert.ok(address && typeof address === 'object')
  const providerURL = `http://127.0.0.1:${address.port}/v1`

  const persistUrl = JSON.stringify(new URL('./persist.ts', import.meta.url).href)
  const historyUrl = JSON.stringify(new URL('../toolActivityHistory.ts', import.meta.url).href)
  const generateUrl = JSON.stringify(new URL('../generate.ts', import.meta.url).href)
  const agentUrl = JSON.stringify(new URL('../data/workers.ts', import.meta.url).href)
  const childSource = `
    const { loadState } = await import(${persistUrl})
    const { messageHistoryTurn } = await import(${historyUrl})
    const { generateReply } = await import(${generateUrl})
    const { DEFAULT_AGENT } = await import(${agentUrl})
    const state = loadState()
    const message = state.sessions[0].messages[0]
    const history = messageHistoryTurn(message)
    const result = await generateReply(
      { id: 'restart-session', title: 'Restart history' }, DEFAULT_AGENT, 'Continue the answer.',
      { onStart: () => {}, onDelta: () => {} }, undefined,
      { protocol: 'openai-responses', baseURL: process.env.PEER_URL, model: 'responses-history-fixture' },
      undefined, [], undefined, {}, [history],
    )
    console.log(JSON.stringify({ outcome: result.outcome, history }))
  `

  try {
    for (const backend of ['json', 'sqlite'] as const) {
      const file = join(ROOT, `restart-${backend}.${backend === 'json' ? 'json' : 'db'}`)
      if (backend === 'json') {
        const prior = process.env.DATA_FILE
        process.env.DATA_FILE = file
        try { new JsonFileBackend().save(state) }
        finally {
          if (prior === undefined) delete process.env.DATA_FILE
          else process.env.DATA_FILE = prior
        }
      } else {
        const db = new SqliteBackend(file)
        try { db.save(state) }
        finally { db.close() }
      }

      const child = await runFreshProcess(childSource, {
        ...process.env,
        PERSIST_BACKEND: backend,
        DATA_FILE: file,
        DATABASE_PATH: file,
        PEER_URL: providerURL,
      })
      assert.equal(child.code, 0, `${backend} fresh process failed: ${child.stderr || child.stdout}`)
      const result = JSON.parse(child.stdout.trim().split('\n').at(-1)!)
      assert.equal(result.outcome, 'ok', `${backend} restarted conversation completed through the loopback peer`)
      assert.equal(result.history.text, visibleText)
      assert.deepEqual(result.history.assistantTextItems, items,
        `${backend} rehydrates the exact ordered items including null and absent phases`)
    }
  } finally {
    await new Promise<void>((resolve) => peer.close(() => resolve()))
  }

  assert.equal(ports.length, 2, 'each fresh process made exactly one native Responses request')
  const expectedInput = [
    { role: 'assistant', content: 'Commentary before. ', phase: 'commentary' },
    { role: 'assistant', content: 'Final answer.', phase: 'final_answer' },
    { role: 'assistant', content: ' Unphased null.', phase: null },
    { role: 'assistant', content: ' Unphased absent.' },
  ]
  for (const [index, request] of ports.entries()) {
    const restoredItems = request.input.slice(0, expectedInput.length)
    assert.deepEqual(restoredItems, expectedInput, `backend ${index} maps each persisted item to a native Responses item`)
    assert.equal(restoredItems.map((item: any) => item.content).join(''), visibleText,
      `backend ${index} preserves all and only the exact visible text`)
    assert.ok(!request.input.some((item: any) => item.type === 'reasoning'),
      `backend ${index} history contains no provider reasoning item`)
    assert.equal(Object.hasOwn(request, 'reasoning'), false, `backend ${index} adds no reasoning configuration`)
  }
})

test('legacy messages without text items remain admissible and format version is unchanged', () => {
  const legacy = stateWith([
    { id: 'old-assistant', role: 'assistant', content: 'Legacy prose.' },
    { id: 'old-user', role: 'user', content: 'Legacy user prose.' },
  ])
  assert.equal(hasCorePersistedShape(legacy), true)
  assert.equal(legacy.version, STORE_VERSION)
})

test('assistant text item metadata is strict in active and compacted messages alike', () => {
  assert.equal(hasCorePersistedShape(stateWith([
    assistant('at-limit', 'x'.repeat(4096), Array.from({ length: 4096 }, () => ({ text: 'x' }))),
  ])), true, 'the declared 4096-item ceiling is inclusive')

  const invalidMessages = [
    assistant('empty', 'x', []),
    assistant('too-many', 'x'.repeat(4097), Array.from({ length: 4097 }, () => ({ text: 'x' }))),
    assistant('missing-text', 'x', [{ phase: 'commentary' }]),
    assistant('non-string-text', 'x', [{ text: 42 }]),
    assistant('bad-phase', 'x', [{ text: 'x', phase: 'analysis' }]),
    assistant('non-string-phase', 'x', [{ text: 'x', phase: false }]),
    assistant('extra-item-field', 'x', [{ text: 'x', providerBlockType: 'thinking' }]),
    assistant('mismatched-prose', 'xy', [{ text: 'x' }]),
  ]
  for (const message of invalidMessages) {
    assert.equal(hasCorePersistedShape(stateWith([message])), false,
      `active malformed item metadata refuses admission: ${JSON.stringify(message.id)}`)
    assert.equal(hasCorePersistedShape(stateWith([], [message])), false,
      `compacted malformed item metadata refuses admission: ${JSON.stringify(message.id)}`)
  }
})

test('only assistant messages may carry the strict text item metadata', () => {
  const userMessage = {
    id: 'user-with-native-items', role: 'user', content: 'x', assistantTextItems: [{ text: 'x' }],
  }
  assert.equal(hasCorePersistedShape(stateWith([userMessage])), false)
  assert.equal(hasCorePersistedShape(stateWith([], [userMessage])), false)
})
