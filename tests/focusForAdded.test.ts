/** Unit test for focusForAdded (src/data/liveSession.ts) — the pure rule mapping a
 *  just-attached context to the panel that should open. Shared by the manual attach
 *  funnel and the FWD-1 pre-attached entry shortcuts, so a drift here would silently
 *  change which panel opens on attach. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusForAdded, addContextToLive, EMPTY_LIVE, WS_ID, repoIdForLabel } from '../src/data/liveSession.ts'
import type { AddedContext } from '../src/types.ts'

test('folder → the shared workspace panel it merged into', () => {
  const ctx = { kind: 'folder', label: 'docs', artifacts: [] } as unknown as AddedContext
  const live = addContextToLive(EMPTY_LIVE, ctx)
  assert.deepEqual(focusForAdded(ctx, live), { kind: 'workspace', id: live.workspaces[0]?.id ?? WS_ID })
})

test('repo → the repo panel keyed by repoIdForLabel', () => {
  const ctx = { kind: 'repo', label: 'acme/web-app', origin: 'github' } as unknown as AddedContext
  assert.deepEqual(focusForAdded(ctx, EMPTY_LIVE), { kind: 'repo', id: repoIdForLabel('acme/web-app') })
})

test('connector and mcp → the connector panel by its id', () => {
  const c = { kind: 'connector', connector: { id: 'gh', label: 'GitHub', kind: 'connector' } } as unknown as AddedContext
  assert.deepEqual(focusForAdded(c, EMPTY_LIVE), { kind: 'connector', id: 'gh' })
  const m = { kind: 'mcp', connector: { id: 'mcp-x', label: 'X', kind: 'mcp' } } as unknown as AddedContext
  assert.deepEqual(focusForAdded(m, EMPTY_LIVE), { kind: 'connector', id: 'mcp-x' })
})

test('files/photos → the first attachment; an empty attachment list → null', () => {
  const f = { kind: 'files', attachments: [{ id: 'a1', label: 'x', kind: 'file' }] } as unknown as AddedContext
  assert.deepEqual(focusForAdded(f, EMPTY_LIVE), { kind: 'file', id: 'a1' })
  const empty = { kind: 'files', attachments: [] } as unknown as AddedContext
  assert.equal(focusForAdded(empty, EMPTY_LIVE), null)
})
