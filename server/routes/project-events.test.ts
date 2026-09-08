/** The HTTP and MCP event doors serialize the same minimal Project hint and
 * re-check current access rather than replaying private relation payloads. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerEvent } from '../../contract/index.ts'
import { store } from '../store/index.ts'
import { eventlog } from '../eventlog.ts'
import { call } from '../testkit/http.ts'
import { buildRouter } from './index.ts'

async function stream(path: string, headers: Record<string, string>) {
  let body = ''
  let status = 0
  let ended = false
  const callbacks = new Map<string, () => void>()
  const req = {
    method: 'GET', headers,
    on(name: string, callback: () => void) { callbacks.set(name, callback); return req },
  }
  const res = {
    writeHead(value: number) { status = value; return res },
    setHeader() {}, flushHeaders() {}, on() {},
    write(chunk: unknown) { body += String(chunk); return true },
    end() { ended = true },
    get writableEnded() { return ended },
  }
  await buildRouter().handle(req as never, res as never, new URL(`http://test${path}`))
  assert.equal(status, 200)
  return {
    close: () => callbacks.get('close')?.(),
    events: (): ServerEvent[] => [...body.matchAll(/^data: (.+)$/gm)].flatMap((match) => {
      const frame = JSON.parse(match[1])
      const event = path === '/mcp' ? frame.params?.data : frame
      return event?.type ? [event] : []
    }),
  }
}

for (const transport of ['events', 'mcp'] as const) {
  test(`${transport} delivers minimal Project changes without widening private payloads or replay`, async () => {
    const owner = `tenant-project-wire-${transport}`
    const audience = 'tenant-beta'
    const foreign = `tenant-project-wire-foreign-${transport}`
    const projectId = `project-wire-${transport}`
    const projectName = `Private name ${transport}`
    const description = `Description omitted from the event wire ${transport}`
    store.applyRelationOp({ kind: 'create-project', projectId, projectName, projectDescription: 'Initial' }, owner)

    const open = async (tenantId: string) => {
      const headers: Record<string, string> = { 'x-tenant-id': tenantId }
      if (transport === 'mcp') {
        const initialized = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' }, headers)
        assert.equal(initialized.status, 200)
        assert.ok(initialized.headers['mcp-session-id'])
        headers['mcp-session-id'] = initialized.headers['mcp-session-id']
      }
      return stream(`/${transport}`, headers)
    }
    const readers = await Promise.all([open(owner), open(audience), open(foreign)])
    const hints = (reader: typeof readers[number]) => reader.events().filter((event) => event.type === 'project.changed')
    try {
      store.applyRelationOp({ kind: 'share-project', projectId, projectName, shared: true }, owner)
      store.applyRelationOp({ kind: 'set-project-description', projectId, projectName, description }, owner)
      const privateInstructions = `Never broadcast these instructions ${transport}`
      store.applyRelationOp({ kind: 'set-project-instructions', projectId, projectName, instructions: privateInstructions }, owner)
      for (const reader of readers) assert.equal(hints(reader).length, 2)
      for (const reader of readers.slice(1)) {
        assert.equal(reader.events().some((event) => event.type === 'relation.applied'), false)
        assert.ok(!JSON.stringify(reader.events()).includes(privateInstructions))
        assert.ok(!JSON.stringify(reader.events()).includes(description))
      }

      const grant = store.createGrant({ subject: { kind: 'project', id: projectId }, audience: { kind: 'org', orgId: audience }, tier: 'view' }, owner)
      assert.ok(grant && typeof grant === 'object')
      store.applyRelationOp({ kind: 'share-project', projectId, projectName, shared: false }, owner)
      for (const reader of readers) assert.deepEqual(hints(reader).at(-1), { type: 'project.changed', projectId, scope: 'public' })

      const beforePrivate = eventlog.seq()
      store.applyRelationOp({ kind: 'set-project-description', projectId, projectName, description: 'Granted-only prose' }, owner)
      assert.deepEqual(hints(readers[1]).at(-1), { type: 'project.changed', projectId, scope: 'readers' })
      assert.equal(hints(readers[2]).length, 3)
      store.revokeGrant(grant.id, owner)
      store.applyRelationOp({ kind: 'set-project-description', projectId, projectName, description: 'Owner-only prose' }, owner)
      assert.equal(hints(readers[0]).length, 5)
      assert.equal(hints(readers[1]).length, 4)
      assert.equal(hints(readers[2]).length, 3)
      for (const reader of readers) {
        for (const event of hints(reader)) assert.deepEqual(Object.keys(event).sort(), ['projectId', 'scope', 'type'])
      }
      if (transport === 'events') {
        const replay = await stream('/events', { 'x-tenant-id': audience, 'last-event-id': String(beforePrivate) })
        try {
          const hello = replay.events().find((event) => event.type === 'hello')
          assert.ok(hello?.type === 'hello' && hello.resumed, 'the replay tail is genuinely retained')
          assert.equal(hints(replay).length, 0, 'revocation closes retained private Project hints too')
        } finally { replay.close() }
      }
    } finally {
      for (const reader of readers) reader.close()
    }
  })
}
